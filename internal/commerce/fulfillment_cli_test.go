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
	"testing"
	"time"
)

// Actual original CLI/HTTP/Store control. Its receipt and V2 principal are
// PUBLIC fixtures; this does not rerun or relabel independent Core/Pay proof QA.
func TestFulfillmentCLIActualHTTPNativePaidColdOriginalRecovery(t *testing.T) {
	fixture := os.Getenv("YNX_SHOP_FULFILLMENT_CLI_FIXTURE")
	if fixture == "" {
		t.Skip("original Native CI supplies official SDK-bundled PUBLIC fulfillment fixture")
	}
	s, buyer, o, cfg, _, gets := nativePaymentFixture(t)
	_, owner := actor(t, 1)
	journal := filepath.Join(t.TempDir(), "PUBLIC-fulfillment-identities.json")
	if root := os.Getenv("YNX_SHOP_FULFILLMENT_EVIDENCE_DIR"); root != "" {
		if !filepath.IsAbs(root) {
			t.Fatal("absolute PUBLIC evidence directory required")
		}
		if err := os.MkdirAll(root, 0700); err != nil {
			t.Fatal(err)
		}
		evidence, err := os.MkdirTemp(root, "PUBLIC-fulfillment-case-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			for name, path := range map[string]string{"original-shop.json": s.path, "original-identities.json": journal} {
				data, e := os.ReadFile(path)
				if os.IsNotExist(e) {
					continue
				}
				if e != nil {
					t.Error(e)
					continue
				}
				if e = os.WriteFile(filepath.Join(evidence, name), data, 0600); e != nil {
					t.Error(e)
				}
			}
			t.Log("retained PUBLIC original fulfillment evidence", evidence)
		})
	}
	body := map[string]string{"Carrier": "PUBLIC original carrier", "TrackingNumber": "PUBLIC original tracking"}
	unpaid, err := s.CreateOrder(buyer, orderInput(s.s.Stores[o.StoreID], s.s.Products[o.Lines[0].ProductID], "PUBLIC-unpaid-shipping-original"))
	if err != nil {
		t.Fatal(err)
	}
	targetID := unpaid.ID
	sellerActor := owner
	drive := func(command string, input any, expectedFailure bool) map[string]json.RawMessage {
		t.Helper()
		config := cfg
		config.businessV2 = controlledBusinessVerifier{account: sellerActor, role: "seller"}
		server := httptest.NewServer(NewServer(s, config).Handler())
		defer server.Close()
		wire, _ := json.Marshal(map[string]any{"command": command, "orderID": targetID, "storeID": o.StoreID, "body": input, "actor": sellerActor, "journal": journal, "origin": server.URL, "expectedFailure": expectedFailure})
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", fixture)
		cmd.Stdin = bytes.NewReader(wire)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("actual fulfillment CLI: %v %s", err, out)
		}
		var result map[string]json.RawMessage
		if json.Unmarshal(out, &result) != nil {
			t.Fatal(string(out))
		}
		return result
	}
	// Unpaid original remains unpaid and its first refusal identity survives.
	denied := drive("ship", body, true)
	if string(denied["rejected"]) != "true" || s.s.Orders[unpaid.ID].Status != "payment_pending" {
		t.Fatal("unpaid shipment accepted", denied)
	}
	// The unpaid order's UNKNOWN remains in the same original journal. The
	// independent paid original uses its own existing account/order namespace.
	unpaidBytes, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	var unpaidRows map[string]string
	if json.Unmarshal(unpaidBytes, &unpaidRows) != nil {
		t.Fatal("unpaid original identity missing")
	}
	targetID = o.ID
	if w := readNativeReceipt(t, s, o, cfg, "b"); w.code != 200 {
		t.Fatal(w.code, w.body)
	}
	_, foreign := actor(t, 9)
	sellerActor = foreign
	deniedForeign := drive("ship", body, true)
	if string(deniedForeign["rejected"]) != "true" || string(deniedForeign["status"]) != "409" || s.s.Orders[o.ID].Status != "paid" {
		t.Fatal("foreign Seller shipped an owned paid order", deniedForeign)
	}
	foreignBytes, err := os.ReadFile(journal)
	if err != nil || json.Unmarshal(foreignBytes, &unpaidRows) != nil {
		t.Fatal("original negative identities missing", err)
	}
	sellerActor = owner
	paid := cloneOrder(s.s.Orders[o.ID])
	stock := cloneProduct(s.s.Products[o.Lines[0].ProductID])
	first := drive("ship", body, false)
	if string(first["unknown"]) != "true" || string(first["writes"]) != "1" {
		t.Fatal("original lost shipment reply not preserved", first)
	}
	shipped := cloneOrder(s.s.Orders[o.ID])
	if shipped.Status != "shipped" || shipped.Shipment == nil {
		t.Fatal("actual paid shipment missing")
	}
	raw, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	changed := map[string]string{"Carrier": body["Carrier"], "TrackingNumber": "PUBLIC replacement"}
	refused := drive("ship", changed, true)
	after, err := os.ReadFile(journal)
	if err != nil || !bytes.Equal(raw, after) || string(refused["code"]) != "\"SELLER_MUTATION_UNRESOLVED\"" || string(refused["writes"]) != "0" {
		t.Fatal("replacement UNKNOWN was dispatched or rewritten", refused, err)
	}
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	recovered := drive("recover-ship", body, false)
	if string(recovered["writes"]) != "0" || string(recovered["lookups"]) != "1" {
		t.Fatal("cold original recovery resent shipment", recovered)
	}
	var result struct {
		OrderID, StoreID, Status string
		Shipment                 *Shipment
	}
	if json.Unmarshal(recovered["result"], &result) != nil || result.OrderID != o.ID || result.StoreID != o.StoreID || result.Status != "shipped" || result.Shipment == nil || result.Shipment.TrackingNumber != body["TrackingNumber"] {
		t.Fatal("original shipment result not recovered", recovered)
	}
	current := s.s.Orders[o.ID]
	if len(current.Timeline) != len(shipped.Timeline) || !reflect.DeepEqual(current.NativePayment, paid.NativePayment) || !reflect.DeepEqual(stock, s.s.Products[o.Lines[0].ProductID]) || current.Buyer != buyer {
		t.Fatal("recovery duplicated shipment, stock or changed financial original")
	}
	retained, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	var currentRows map[string]string
	if json.Unmarshal(retained, &currentRows) != nil {
		t.Fatal("original journals invalid")
	}
	for key, value := range unpaidRows {
		if currentRows[key] != value {
			t.Fatal("unpaid original UNKNOWN was replaced or removed")
		}
	}

	if *gets != 1 {
		t.Fatal("fulfillment/recovery re-read Pay instead of using accepted original payment")
	}
	inspected := drive("inspect", map[string]any{}, false)
	if string(inspected["reads"]) != "1" || string(inspected["writes"]) != "0" {
		t.Fatal("inspection mutated", inspected)
	}
}
