//go:build pay_pq && pay_native_price_joint

package payproduct

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

// Two original normal Go services and the installed Main/SDK review consumer.
// PUBLIC authority controls are isolated from production; no signer, Native
// grant, new Core execution or original UNKNOWN replay occurs in this delta.
func TestNativePriceOriginalSellerHTTPSFirstInvoiceAndInstalledMain(t *testing.T) {
	shopBinary, node, driver := os.Getenv("PAY_PRICE_SHOP_BINARY"), os.Getenv("PAY_NODE_BINARY"), os.Getenv("PAY_PRICE_MAIN_DRIVER")
	for _, p := range []string{shopBinary, node, driver} {
		if !filepath.IsAbs(p) {
			t.Fatal("exact original Shop driver/Node/Main consumer required")
		}
	}
	binary, err := os.ReadFile(shopBinary)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(binary)
	if hex.EncodeToString(sum[:]) != os.Getenv("PAY_PRICE_SHOP_SHA256") {
		t.Fatal("frozen original Shop driver differs")
	}
	shop := exec.CommandContext(t.Context(), shopBinary, "-test.run=^TestP06NativePriceOriginalShopDriver$", "-test.timeout=90s")
	shop.Env = append(os.Environ(), "P06_PUBLIC_PRICE_DRIVER=1")
	shopInput, err := shop.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	shopOutput, err := shop.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	shopErrors, err := os.CreateTemp(t.TempDir(), "PUBLIC-shop-stderr-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = shopErrors.Close() })
	shopErrorText := func() string { b, _ := os.ReadFile(shopErrors.Name()); return string(b) }
	shop.Stderr = shopErrors
	if err = shop.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = shopInput.Close()
		if shop.ProcessState == nil {
			_ = shop.Process.Kill()
		}
	})
	scanner := bufio.NewScanner(shopOutput)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	next := func() map[string]json.RawMessage {
		t.Helper()
		if !scanner.Scan() {
			t.Fatalf("original Shop driver closed: %v %s", scanner.Err(), shopErrorText())
		}
		var value map[string]json.RawMessage
		if e := json.Unmarshal(scanner.Bytes(), &value); e != nil {
			failure := string(scanner.Bytes())
			for scanner.Scan() {
				failure += "\n" + string(scanner.Bytes())
			}
			t.Fatal(e, failure, shopErrorText())
		}
		return value
	}
	exchange := func(message any) map[string]json.RawMessage {
		t.Helper()
		if e := json.NewEncoder(shopInput).Encode(message); e != nil {
			t.Fatal(e)
		}
		return next()
	}
	ready := next()
	var original NativeInvoiceProductIntent
	var buyer string
	if json.Unmarshal(ready["original"], &original) != nil || json.Unmarshal(ready["buyer"], &buyer) != nil || original.AmountAtoms != "9" {
		t.Fatal("actual original Seller request missing")
	}
	var legacy int
	_ = json.Unmarshal(ready["legacyTotal"], &legacy)
	if legacy != 25 {
		t.Fatal("original legacy display amount changed")
	}
	f := newNativeServiceFixture(t) // fresh disposable PUBLIC registration only
	network, err := hex.DecodeString(original.Genesis)
	if err != nil {
		t.Fatal(err)
	}
	f.service.cfg.Genesis = network
	f.source.grant.Principal = original.Merchant
	f.source.grant.Registration.Owner = original.Merchant
	f.source.grant.Registration.ChainID = network
	f.source.grant.Registration.ActiveFrom = 2
	f.source.grant.BoundOrderID = original.SourceOrder
	f.source.grant.BoundInvoiceID = "invoice-native-price"
	f.source.grant.BoundSessionID = "session-native-price"
	f.terms.InvoiceID = "invoice-native-price"
	f.terms.SessionID = "session-native-price"
	f.terms.Recipient = original.Recipient
	f.terms.Payer = buyer
	f.terms.Amount = 9
	payout, _ := accountaddress.Encode(original.Recipient)
	owner, _ := accountaddress.Encode(original.Merchant)
	merchant, err := f.service.parent.Onboard(OnboardInput{DisplayName: "PUBLIC original Seller native price", PayoutAddress: payout, OwnerAccount: owner, IdempotencyKey: "PUBLIC-original-price-merchant"})
	if err != nil {
		t.Fatal(err)
	}
	reader := &nativeIntentSourceFixture{snapshot: NativeInvoiceSourceSnapshot{Caller: original.Merchant, Intent: original, ProductMerchantID: merchant.Merchant.ID, MerchantAccount: original.Merchant, StoreID: original.StoreID, Terms: f.terms, AllowedOperations: []string{"create", "lookup", "read", "merchant_review"}, Until: time.Now().Add(time.Hour), Current: func() error { return nil }}}
	source, err := NewRegisteredNativeInvoiceIntentSource(f.service.parent, reader)
	if err != nil {
		t.Fatal(err)
	}
	server, _, err := NewPrivateNativePayServer(f.service.parent, f.service.cfg, source, buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var creates, lookups, termReviews, effects atomic.Int32
	endpoint := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/v5/pay/invoice-intents":
			creates.Add(1)
			raw, e := io.ReadAll(r.Body)
			if e != nil {
				t.Error(e)
				w.WriteHeader(400)
				return
			}
			var got NativeInvoiceProductIntent
			if json.Unmarshal(raw, &got) != nil || hashJSON(got) != hashJSON(original) {
				t.Error("normal Shop first create replaced original price/bill")
				w.WriteHeader(400)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(raw))
		case r.Method == "POST" && r.URL.Path == "/v5/pay/invoice-intents/lookup":
			lookups.Add(1)
		case r.Method == "POST" && r.URL.Path == "/v5/pay/invoice-intents/"+nativeIntentSlot(original)+"/merchant-review":
			termReviews.Add(1)
		default:
			effects.Add(1)
			w.WriteHeader(405)
			return
		}
		server.Handler().ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	certificate := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: endpoint.Certificate().Raw}))
	created := exchange(map[string]any{"Type": "create", "Origin": endpoint.URL, "Certificate": certificate})
	var captured NativeInvoiceProductIntent
	if json.Unmarshal(created["original"], &captured) != nil || hashJSON(captured) != hashJSON(original) || creates.Load() != 1 || f.writes != 0 {
		t.Fatal("normal Seller first create did not preserve original Native request")
	}
	before, err := os.ReadFile(f.service.parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	reg := f.source.grant.Registration
	publicAuthorization := map[string]any{"owner": original.Merchant, "executionHeight": "5", "ledgerNonce": "1", "algorithmVersion": "YNX-BATCH/v0.1", "enabled": true, "records": []any{map[string]any{"algorithmVersion": "YNX-BATCH/v0.1", "owner": original.Merchant, "pkA": hex.EncodeToString(reg.PKA), "pkB": hex.EncodeToString(reg.PKB), "revision": "1", "registeredAt": "1", "activeFrom": "2", "ledgerNonce": "1"}}, "policyVersion": "YNX-ACCOUNT-POLICY/v1", "networkId": original.Genesis, "enableAt": "1", "activeRevision": "1"}
	app := os.Getenv("PAY_CLIENT_MAIN_SOURCE")
	if !filepath.IsAbs(app) {
		t.Fatal("exact installed Main source required")
	}
	// Pin every installed production module to the original frozen P06 manifest.
	hraw, err := os.ReadFile(os.Getenv("PAY_PRICE_SOURCE_HANDOFF"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Source []struct {
			Path, SHA256 string
			Bytes        int64
		}
	}
	if json.Unmarshal(hraw, &manifest) != nil || len(manifest.Source) != 9 {
		t.Fatal("complete original nine-module manifest required")
	}
	var pins []map[string]string
	for _, r := range manifest.Source {
		p := filepath.Join(app, "apps/wallet-desktop/src/native-pay-client", filepath.Base(r.Path))
		b, e := os.ReadFile(p)
		if e != nil {
			t.Fatal(e)
		}
		s := sha256.Sum256(b)
		if int64(len(b)) != r.Bytes || hex.EncodeToString(s[:]) != r.SHA256 {
			t.Fatal("installed Pay source drift", filepath.Base(p))
		}
		pins = append(pins, map[string]string{"name": filepath.Base(p), "sha256": r.SHA256})
	}
	wrapper, err := os.ReadFile(filepath.Join(app, "apps/wallet-desktop/src/wallet-native-pay-product.mjs"))
	if err != nil {
		t.Fatal(err)
	}
	wrapperSHA := sha256.Sum256(wrapper)
	command := exec.CommandContext(t.Context(), node, driver)
	input, err := command.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var nodeErrors bytes.Buffer
	command.Stderr = &nodeErrors
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = input.Close()
		if command.ProcessState == nil {
			_ = command.Process.Kill()
		}
	})
	send := json.NewEncoder(input)
	if err = send.Encode(map[string]any{"original": original, "origin": endpoint.URL, "certificate": certificate, "intentId": nativeIntentSlot(original), "publicAuthorization": publicAuthorization, "payPins": pins, "wrapperSHA256": hex.EncodeToString(wrapperSHA[:])}); err != nil {
		t.Fatal(err)
	}
	lines := bufio.NewScanner(output)
	lines.Buffer(make([]byte, 4096), 2<<20)
	retireNext, done, reads := false, false, 0
	for lines.Scan() {
		var message struct {
			Type                                         string
			Reference                                    map[string]string
			LookupRequests, Published, Rejected, Reviews int
			SameIntentID                                 string
		}
		if err = json.Unmarshal(lines.Bytes(), &message); err != nil {
			t.Fatal(err, string(lines.Bytes()))
		}
		switch message.Type {
		case "source-read":
			if message.Reference["sourceOrder"] != original.SourceOrder || message.Reference["productId"] != "shop.order" {
				t.Fatal("original Source selector changed")
			}
			reads++
			value := exchange(map[string]string{"Type": "read"})
			reply := map[string]any{"original": value["original"], "retire": retireNext}
			if err = send.Encode(reply); err != nil {
				t.Fatal(err)
			}
		case "reprice-cold":
			value := exchange(map[string]string{"Type": "reprice-cold"})
			if err = send.Encode(value); err != nil {
				t.Fatal(err)
			}
		case "retire-next-source-read":
			retireNext = true
			if err = send.Encode(map[string]bool{"ready": true}); err != nil {
				t.Fatal(err)
			}
		case "done":
			done = message.Published == 1 && message.Rejected == 1 && message.Reviews == 1 && message.LookupRequests == 5 && message.SameIntentID == nativeIntentSlot(original)
		default:
			t.Fatal("unexpected Main joint command", message.Type)
		}
		if done {
			break
		}
	}
	if err = lines.Err(); err != nil {
		t.Fatal(err)
	}
	_ = input.Close()
	if err = command.Wait(); err != nil {
		t.Fatalf("installed Main native-price consumer: %v %s", err, nodeErrors.String())
	}
	value := exchange(map[string]string{"Type": "done"})
	if string(value["type"]) != `"done"` {
		t.Fatal("original Shop did not close")
	}
	_ = shopInput.Close()
	if err = shop.Wait(); err != nil {
		t.Fatal(err, shopErrorText())
	}
	after, err := os.ReadFile(f.service.parent.store.path)
	if err != nil || !bytes.Equal(before, after) || !done || reads != 6 || creates.Load() != 1 || lookups.Load() != 5 || termReviews.Load() != 1 || effects.Load() != 0 || f.writes != 0 {
		t.Fatalf("first-price joint changed original or effect: done=%v reads=%d creates=%d lookups=%d reviews=%d effects=%d Core=%d err=%v", done, reads, creates.Load(), lookups.Load(), termReviews.Load(), effects.Load(), f.writes, err)
	}
	t.Log("ACTUAL_NATIVE_PRICE_JOINT SellerHTTP=1 checkout=1 explicitNativeAtoms=9 legacyDisplay=25 normalHTTPSCreate=1 sameOriginalLookup=5 originalShopSourceReads=6 installedMainTypedReview=1 publishCancelOnce=1 currentRevocationBeforeLookup=true coldStoreAndLater999Keep9=true originalPayDiskUnchanged=true signing=0 moneyPOST=0 CoreExecution=0 SourceAdmission=false")
}
