package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func originalReturnDecisionFixture(t *testing.T) (*Store, Order, string, string, ServerConfig, *int) {
	t.Helper()
	s, buyer, o, cfg, _, gets := nativePaymentFixture(t)
	_, owner := actor(t, 1)
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	var err error
	o, err = s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "PUBLIC original", TrackingNumber: "PUBLIC return"}, nil, nil, "return-decision-original-ship")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "delivered", nil, nil, nil, "return-decision-original-deliver")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "return_requested", nil, &Resolution{Kind: "return", Reason: "PUBLIC original reason"}, nil, "return-decision-original-request")
	if err != nil {
		t.Fatal(err)
	}
	cfg.businessV2 = controlledBusinessVerifier{account: owner, role: "seller"}
	return s, o, owner, o.Timeline[len(o.Timeline)-1].ID, cfg, gets
}

func TestOriginalReturnDecisionSemanticLegacyBytesAndAtomicSelector(t *testing.T) {
	old := struct {
		OrderID, Next string
		Shipment      *Shipment
		Resolution    *Resolution
		Review        *Review
	}{"order", "shipped", &Shipment{Carrier: "actual", TrackingNumber: "original"}, nil, nil}
	before, _ := json.Marshal(old)
	after, _ := json.Marshal(originalTransitionRequest(old.OrderID, old.Next, old.Shipment, old.Resolution, old.Review, ""))
	if !bytes.Equal(before, after) {
		t.Fatal("old transition digest bytes changed")
	}
	s, o, _, returnID, cfg, _ := originalReturnDecisionFixture(t)
	stock := cloneProduct(s.s.Products[o.Lines[0].ProductID])
	payment := *o.NativePayment
	request := map[string]any{"Action": "return_approved", "OriginalReturnID": "event_foreign", "IdempotencyKey": "original-return-decision-01", "Explanation": ""}
	invoke := func(nonce string) int {
		body, _ := json.Marshal(request)
		return businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/transition", strings.Repeat(nonce, 43), string(body)).Code
	}
	if code := invoke("c"); code != 409 || s.s.Orders[o.ID].Status != "return_requested" {
		t.Fatal("foreign original return selector changed state", code)
	}
	request["OriginalReturnID"] = returnID
	if code := invoke("d"); code != 200 {
		t.Fatal("exact original return not approved", code)
	}
	count := len(s.s.Orders[o.ID].Timeline)
	var err error
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if code := invoke("e"); code != 200 || len(s.s.Orders[o.ID].Timeline) != count {
		t.Fatal("cold exact original decision duplicated", code)
	}
	body, _ := json.Marshal(request)
	lookup, _ := json.Marshal(map[string]any{"Method": "POST", "Path": "/orders/" + o.ID + "/transition", "OriginalBody": string(body)})
	if w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/seller/mutations/lookup", strings.Repeat("f", 43), string(lookup)); w.Code != 200 {
		t.Fatal("new selector not retained in exact original lookup digest", w.Code, w.Body.String())
	}
	request["OriginalReturnID"] = "event_replaced"
	if code := invoke("g"); code != 409 {
		t.Fatal("same key rebound return selection", code)
	}
	got := s.s.Orders[o.ID]
	if len(got.Timeline) != count || got.Status != "return_approved" || len(got.ReturnReceipts) != 0 || !reflect.DeepEqual(payment, *got.NativePayment) || !reflect.DeepEqual(stock, s.s.Products[o.Lines[0].ProductID]) {
		t.Fatal("return approval changed funds/goods/stock or old original")
	}
	_, foreign := actor(t, 9)
	cfg.businessV2 = controlledBusinessVerifier{account: foreign, role: "seller"}
	request["OriginalReturnID"] = returnID
	if code := invoke("h"); code != 409 {
		t.Fatal("foreign Seller replayed original return decision", code)
	}
}

func TestOriginalReturnDecisionConcurrentOppositeChoicesApplyOnce(t *testing.T) {
	s, o, owner, returnID, _, _ := originalReturnDecisionFixture(t)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, action := range []string{"return_approved", "return_rejected"} {
		wg.Add(1)
		go func(next string) {
			defer wg.Done()
			_, err := s.transitionOriginalReturn(owner, "seller", o.ID, next, nil, &Resolution{Kind: "return", Explanation: "PUBLIC actual decision"}, nil, returnID, "concurrent-"+next)
			results <- err
		}(action)
	}
	wg.Wait()
	close(results)
	success := 0
	for err := range results {
		if err == nil {
			success++
		}
	}
	if success != 1 || len(s.s.Orders[o.ID].Timeline) != len(o.Timeline)+1 || len(s.s.Orders[o.ID].ReturnReceipts) != 0 {
		t.Fatal("opposite decisions both applied or implied goods return", success)
	}
}

func TestReturnDecisionCLIActualHTTPNativeOriginalColdRecovery(t *testing.T) {
	fixture := os.Getenv("YNX_SHOP_RETURN_DECISION_CLI_FIXTURE")
	if fixture == "" {
		t.Skip("original CI supplies official SDK-bundled PUBLIC return decision fixture")
	}
	for _, command := range []string{"approve", "reject"} {
		t.Run(command, func(t *testing.T) {
			s, o, owner, returnID, cfg, gets := originalReturnDecisionFixture(t)
			journal := filepath.Join(t.TempDir(), "PUBLIC-return-decision-identities.json")
			if root := os.Getenv("YNX_SHOP_RETURN_DECISION_EVIDENCE_DIR"); root != "" {
				if !filepath.IsAbs(root) {
					t.Fatal("absolute PUBLIC evidence directory required")
				}
				if err := os.MkdirAll(root, 0700); err != nil {
					t.Fatal(err)
				}
				evidence, err := os.MkdirTemp(root, "PUBLIC-return-decision-")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() {
					for name, path := range map[string]string{"original-shop.json": s.path, "original-identities.json": journal} {
						raw, e := os.ReadFile(path)
						if os.IsNotExist(e) {
							continue
						}
						if e != nil {
							t.Error(e)
							continue
						}
						if e = os.WriteFile(filepath.Join(evidence, name), raw, 0600); e != nil {
							t.Error(e)
						}
					}
					t.Log("retained PUBLIC original return decision", evidence)
				})
			}
			body := map[string]string{"ReturnID": returnID}
			if command == "reject" {
				body["Explanation"] = "PUBLIC original actual rejection"
			}
			drive := func(cmd string, input any, expectedFailure bool) map[string]json.RawMessage {
				t.Helper()
				server := httptest.NewServer(NewServer(s, cfg).Handler())
				defer server.Close()
				wire, _ := json.Marshal(map[string]any{"command": cmd, "orderID": o.ID, "storeID": o.StoreID, "actor": owner, "body": input, "journal": journal, "origin": server.URL, "expectedFailure": expectedFailure})
				ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
				defer cancel()
				process := exec.CommandContext(ctx, "node", fixture)
				process.Stdin = bytes.NewReader(wire)
				raw, err := process.CombinedOutput()
				if err != nil {
					t.Fatalf("actual original return CLI: %v %s", err, raw)
				}
				var result map[string]json.RawMessage
				if json.Unmarshal(raw, &result) != nil {
					t.Fatal(string(raw))
				}
				return result
			}
			payment := *o.NativePayment
			stock := cloneProduct(s.s.Products[o.Lines[0].ProductID])
			first := drive(command, body, false)
			if string(first["unknown"]) != "true" || string(first["writes"]) != "1" || string(first["reads"]) != "1" {
				t.Fatal("lost original decision not retained", first)
			}
			decided := cloneOrder(s.s.Orders[o.ID])
			original, _ := os.ReadFile(journal)
			replacement := map[string]string{"ReturnID": "event_replacement"}
			if command == "reject" {
				replacement["Explanation"] = body["Explanation"]
			}
			rejected := drive(command, replacement, true)
			unchanged, _ := os.ReadFile(journal)
			if string(rejected["code"]) != "\"SELLER_MUTATION_UNRESOLVED\"" || string(rejected["writes"]) != "0" || !bytes.Equal(original, unchanged) {
				t.Fatal("UNKNOWN original return was replaced", rejected)
			}
			var err error
			s, err = Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			result := drive("recover-"+command, body, false)
			if string(result["writes"]) != "0" || string(result["reads"]) != "0" || string(result["lookups"]) != "1" {
				t.Fatal("cold recovery retried decision or read replacement", result)
			}
			var observed struct{ OrderID, StoreID, ReturnID, Decision string }
			if json.Unmarshal(result["result"], &observed) != nil || observed.OrderID != o.ID || observed.StoreID != o.StoreID || observed.ReturnID != returnID || observed.Decision != map[string]string{"approve": "return_approved", "reject": "return_rejected"}[command] {
				t.Fatal("wrong original decision recovered", result)
			}
			got := s.s.Orders[o.ID]
			if len(got.Timeline) != len(decided.Timeline) || len(got.ReturnReceipts) != 0 || !reflect.DeepEqual(payment, *got.NativePayment) || !reflect.DeepEqual(stock, s.s.Products[o.Lines[0].ProductID]) || *gets != 1 {
				t.Fatal("decision/recovery changed money/goods/stock or re-read Pay")
			}
		})
	}
}
