package commerce

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"
	"time"
)

// P06's staged cross-process protocol. Every received invoiceIntent is ignored
// for authority: Shop performs its own actual normal Pay HTTP preparation/read.
func TestP06OriginalPayShopDriver(t *testing.T) {
	if os.Getenv("PAY_SHOP_ORIGINAL_DRIVER") != "1" {
		t.Skip("explicit staged original P06/Shop PUBLIC QA only")
	}
	type message struct {
		Phase, Merchant, Payer, Genesis, NativeChainID, RefundID, Origin string
		MultiRefund                                                      bool
		Terms                                                            NativeShopPayTerms
		Original                                                         NativeShopInvoiceRequestDATA
	}
	input := json.NewDecoder(os.Stdin)
	output := json.NewEncoder(os.Stdout)
	var m message
	if err := input.Decode(&m); err != nil || m.Phase != "init" {
		t.Fatal("original staged init required", err)
	}
	multiRefund := m.MultiRefund
	// Keep PUBLIC original UNKNOWN/first-cause evidence after a failed joint
	// subprocess; never let t.TempDir cleanup erase the operation under diagnosis.
	stateDir, err := os.MkdirTemp(filepath.Dir(os.Args[0]), "PUBLIC-pay-shop-original-")
	if err != nil {
		t.Fatal(err)
	}
	fmt.Fprintln(os.Stderr, "P07_PUBLIC_ORIGINAL_STATE "+filepath.Join(stateDir, "original-shop.json"))
	s, err := Open(filepath.Join(stateDir, "original-shop.json"))
	if err != nil {
		t.Fatal(err)
	}
	owner, buyer := m.Merchant, m.Payer
	st, product := setupCatalog(t, s, owner, 5)
	o, err := s.CreateOrder(buyer, orderInput(st, product, "PUBLIC-staged-original-order"))
	if err != nil {
		t.Fatal(err)
	}
	price := ShopNativeInvoicePriceDATA{Merchant: owner, Recipient: m.Terms.Recipient, Genesis: m.Genesis, NativeChainID: m.NativeChainID, AssetID: m.Terms.AssetID, UnitVersion: m.Terms.UnitVersion, AmountAtoms: m.Terms.AmountAtoms, PriceApprovalRef: "PUBLIC-staged-approved-original"}
	original, err := nativeInvoiceRequestDATA(o, price)
	if err != nil {
		t.Fatal(err)
	}
	if err = output.Encode(map[string]any{"phase": "original", "request": original}); err != nil {
		t.Fatal(err)
	}
	if err = input.Decode(&m); err != nil || (m.Phase != "prepare" && m.Phase != "paid") {
		t.Fatal("actual original prepare stage required", err)
	}
	earlyPreparation := m.Phase == "prepare"
	a, _ := json.Marshal(original)
	b, _ := json.Marshal(m.Original)
	if !bytes.Equal(a, b) {
		t.Fatal("staged original input replaced")
	}
	// P06's normal test server is loopback HTTP. This transport and origin are
	// PUBLIC test-only; production's HTTPS-only constructor is unchanged.
	u, err := url.Parse(m.Origin)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Path != "" || !net.ParseIP(u.Hostname()).IsLoopback() {
		t.Fatal("PUBLIC loopback normal Pay server required")
	}
	transport := &http.Transport{}
	defer transport.CloseIdleConnections()
	trace := nativeShopPayTransport(func(r *http.Request) (*http.Response, error) {
		start := time.Now()
		fmt.Fprintf(os.Stderr, "P07_PUBLIC_PAY_DISPATCH method=%s path=%s length=%d\n", r.Method, r.URL.EscapedPath(), r.ContentLength)
		response, e := transport.RoundTrip(r)
		status := 0
		if response != nil {
			status = response.StatusCode
		}
		fmt.Fprintf(os.Stderr, "P07_PUBLIC_PAY_RETURN method=%s path=%s status=%d elapsed=%s error=%v\n", r.Method, r.URL.EscapedPath(), status, time.Since(start), e)
		return response, e
	})
	client := &NativeShopPayClient{origin: m.Origin, client: http.Client{Transport: trace, Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	cfg := ServerConfig{NativeInvoiceOnly: true, NativePay: client, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, NativeInvoiceDATA: nativeInvoiceDATAFixture(func(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
		return price, nil
	})}
	w := businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/native-pay-intent", fmt.Sprintf("%043d", 1), `{"IdempotencyKey":"PUBLIC-staged-original-intent"}`)
	if w.Code != 200 && w.Code != 201 {
		for _, record := range s.s.BusinessEffects {
			fmt.Fprintf(os.Stderr, "P07_PUBLIC_EFFECT kind=%s phase=%s target=%s steps=%d resultBytes=%d\n", record.Kind, record.Phase, record.Target, len(record.Steps), len(record.Result))
			for _, step := range record.Steps {
				fmt.Fprintf(os.Stderr, "P07_PUBLIC_EFFECT_STEP method=%s path=%s phase=%s status=%d responseBytes=%d requestDigest=%s\n", step.Method, step.Path, step.Phase, step.Status, len(step.Response), step.RequestDigest)
			}
		}
		t.Fatal("actual Shop preparation", w.Code, w.Body.String())
	}
	o = s.s.Orders[o.ID]
	if earlyPreparation {
		if err = output.Encode(map[string]any{"phase": "prepared", "result": map[string]any{"httpStatus": w.Code, "originalOperation": o.PayIntentID, "statePath": s.path, "SourceAdmission": false}}); err != nil {
			t.Fatal(err)
		}
		if err = input.Decode(&m); err != nil || m.Phase != "paid" {
			t.Fatal("actual normal Pay paid stage required", err)
		}
		if m.Origin != "" && m.Origin != client.origin {
			t.Fatal("original qualified Pay origin changed")
		}
	}
	w = businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/confirm-payment", fmt.Sprintf("%043d", 2), `{}`)
	if w.Code != 200 {
		t.Fatal("actual normal paid receipt", w.Code, w.Body.String())
	}
	paid := s.s.Orders[o.ID]
	if paid.Status != "paid" || paid.NativePayment == nil || paid.NativePayment.PaidAtoms != "100" {
		t.Fatal("actual proof receipt not applied")
	}
	afterPaid := cloneProduct(s.s.Products[product.ID])
	o, err = s.transition(owner, "seller", o.ID, "shipped", &Shipment{Carrier: "PUBLIC-staged", TrackingNumber: "PUBLIC-original"}, nil, nil, "PUBLIC-staged-ship")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "delivered", nil, nil, nil, "PUBLIC-staged-deliver")
	if err != nil {
		t.Fatal(err)
	}
	o, err = s.transition(buyer, "buyer", o.ID, "return_requested", nil, &Resolution{Kind: "return", Reason: "PUBLIC-original"}, nil, "PUBLIC-staged-return")
	if err != nil {
		t.Fatal(err)
	}
	returnID := o.Timeline[len(o.Timeline)-1].ID
	o, err = s.transition(owner, "seller", o.ID, "return_approved", nil, &Resolution{Kind: "return"}, nil, "PUBLIC-staged-approve")
	if err != nil {
		t.Fatal(err)
	}
	if err = output.Encode(map[string]any{"phase": "refund", "result": map[string]any{"paidAtoms": paid.NativePayment.PaidAtoms, "returnID": returnID, "receiptOrigin": "normal Pay product receipt GET", "SourceAdmission": false}}); err != nil {
		t.Fatal(err)
	}
	if multiRefund {
		var stages []map[string]any
		for stage, expected := range []struct{ refunded, net string }{{"30", "70"}, {"50", "50"}, {"100", "0"}} {
			if err = input.Decode(&m); err != nil || m.Phase != "refunded" {
				t.Fatal("actual next archived original refund stage required", stage, err)
			}
			s, err = Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			w = businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/confirm-payment", fmt.Sprintf("%043d", 3+stage*2), `{}`)
			if w.Code != 200 {
				t.Fatal("actual cumulative refund receipt", stage, w.Code, w.Body.String())
			}
			o = s.s.Orders[o.ID]
			if o.NativePayment == nil || o.NativePayment.PaidAtoms != "100" || o.NativePayment.RefundedAtoms != expected.refunded || o.NativePayment.NetPaidAtoms != expected.net || len(o.NativePayment.Receipts) != stage+2 || !reflect.DeepEqual(afterPaid, s.s.Products[product.ID]) || len(o.ReturnReceipts) != 0 {
				t.Fatal("cumulative refund changed original amount/stock/goods", stage, o.Status)
			}
			if (stage < 2 && (o.Status != "return_approved" || o.RefundStatus != "native_partial_refund")) || (stage == 2 && (o.Status != "refunded" || o.RefundStatus != "native_refunded")) {
				t.Fatal("financial refund state differs", stage, o.Status, o.RefundStatus)
			}
			projection := *o.NativePayment
			s, err = Open(s.path)
			if err != nil {
				t.Fatal(err)
			}
			w = businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/confirm-payment", fmt.Sprintf("%043d", 4+stage*2), `{}`)
			if w.Code != 200 || !reflect.DeepEqual(projection, *s.s.Orders[o.ID].NativePayment) || !reflect.DeepEqual(afterPaid, s.s.Products[product.ID]) {
				t.Fatal("cumulative cold duplicate changed original claims or stock", stage, w.Code)
			}
			var ids []string
			var coordinates []map[string]string
			for _, receipt := range projection.Receipts[1:] {
				ids = append(ids, receipt.RefundID)
				coordinates = append(coordinates, map[string]string{"height": receipt.ExecutionHeight, "index": receipt.ExecutionIndex, "member": receipt.ExecutionMember, "event": receipt.ExecutionEvent})
			}
			if stage >= 1 {
				first, second := projection.Receipts[1], projection.Receipts[2]
				if first.ExecutionHeight != second.ExecutionHeight || first.ExecutionIndex != "0" || second.ExecutionIndex != "1" {
					t.Fatal("actual same-block original refund index0/1 required")
				}
			}
			facts := map[string]any{"stage": stage + 1, "paidAtoms": projection.PaidAtoms, "refundedAtoms": projection.RefundedAtoms, "netPaidAtoms": projection.NetPaidAtoms, "refundIDs": ids, "coordinates": coordinates, "returnID": returnID, "cold": true, "duplicateSafe": true, "stockUnchanged": true, "goodsReceived": false, "SourceAdmission": false}
			stages = append(stages, facts)
			if stage < 2 {
				if err = output.Encode(map[string]any{"phase": "refund-progress", "result": facts}); err != nil {
					t.Fatal(err)
				}
			}
		}
		received, e := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "PUBLIC-multi-goods-original", "PUBLIC-multi-receive", 1))
		if e != nil {
			t.Fatal("full refund must retain original approved return", e)
		}
		if !reflect.DeepEqual(afterPaid, s.s.Products[product.ID]) {
			t.Fatal("full refund goods receipt automatically restocked")
		}
		restock := RestockReturnInput{ReceiptID: received.ReturnReceipts[0].ID, IdempotencyKey: "PUBLIC-multi-restock"}
		if _, err = s.RestockReturn(owner, o.ID, restock); err != nil {
			t.Fatal(err)
		}
		afterRestock := cloneProduct(s.s.Products[product.ID])
		s, err = Open(s.path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = s.RestockReturn(owner, o.ID, restock); err != nil || !reflect.DeepEqual(afterRestock, s.s.Products[product.ID]) {
			t.Fatal("full-refund cold restock duplicated", err)
		}
		if err = output.Encode(map[string]any{"phase": "done", "result": map[string]any{"paidAtoms": "100", "refundedAtoms": "100", "netPaidAtoms": "0", "stages": stages, "cold": true, "duplicateSafe": true, "returnReceived": true, "restocked": true, "returnID": returnID, "SourceAdmission": false}}); err != nil {
			t.Fatal(err)
		}
		return
	}
	if err = input.Decode(&m); err != nil || m.Phase != "refunded" {
		t.Fatal("actual archived refund stage required", err)
	}
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	w = businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/confirm-payment", fmt.Sprintf("%043d", 3), `{}`)
	if w.Code != 200 {
		t.Fatal("actual partial refund receipt", w.Code, w.Body.String())
	}
	o = s.s.Orders[o.ID]
	if o.Status != "return_approved" || o.NativePayment == nil || o.NativePayment.NetPaidAtoms != "70" || o.RefundStatus != "native_partial_refund" || !reflect.DeepEqual(afterPaid, s.s.Products[product.ID]) {
		t.Fatal("partial refund changed physical state", o.Status)
	}
	partial := *o.NativePayment
	s, err = Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	w = businessHTTPRequest(NewServer(s, cfg), "POST", "/api/orders/"+o.ID+"/confirm-payment", fmt.Sprintf("%043d", 4), `{}`)
	if w.Code != 200 {
		t.Fatal("actual cold duplicate receipt", w.Code, w.Body.String())
	}
	if !reflect.DeepEqual(partial, *s.s.Orders[o.ID].NativePayment) || !reflect.DeepEqual(afterPaid, s.s.Products[product.ID]) {
		t.Fatal("actual cold duplicate changed claims or stock")
	}
	received, err := s.ReceiveReturn(owner, o.ID, receiveInput(o, returnID, "PUBLIC-staged-goods-original", "PUBLIC-staged-receive", 1))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(afterPaid, s.s.Products[product.ID]) {
		t.Fatal("goods receipt changed stock before restock")
	}
	restock := RestockReturnInput{ReceiptID: received.ReturnReceipts[0].ID, IdempotencyKey: "PUBLIC-staged-restock"}
	if _, err = s.RestockReturn(owner, o.ID, restock); err != nil {
		t.Fatal(err)
	}
	afterRestock := cloneProduct(s.s.Products[product.ID])
	if _, err = s.RestockReturn(owner, o.ID, restock); err != nil || !reflect.DeepEqual(afterRestock, s.s.Products[product.ID]) {
		t.Fatal("actual original restock duplicated", err)
	}
	if _, err = Open(s.path); err != nil {
		t.Fatal("actual receipt/warehouse cold verification", err)
	}
	if err = output.Encode(map[string]any{"phase": "done", "result": map[string]any{"paidAtoms": partial.PaidAtoms, "refundedAtoms": partial.RefundedAtoms, "netPaidAtoms": partial.NetPaidAtoms, "cold": true, "duplicateSafe": true, "returnReceived": true, "restocked": true, "returnID": returnID, "refundID": partial.Receipts[len(partial.Receipts)-1].RefundID, "SourceAdmission": false}}); err != nil {
		t.Fatal(err)
	}
}

// Opt-in test subprocess for P06's actual normal verifier/HTTP/Store workflow.
// No production entry, Root setter or financial JSON-import command is added.
// stdout records are prefixed P07_JOINT_JSON so Go's test harness remains intact.
func TestNativePaymentReceiptJointDriver(t *testing.T) {
	if os.Getenv("P07_PUBLIC_PAY_JOINT_DRIVER") != "1" {
		t.Skip("explicit PUBLIC cross-owner integration driver only")
	}
	type command struct {
		Command       string `json:"command"`
		Origin        string `json:"origin"`
		CAPEM         string `json:"caPEM"`
		Merchant      string `json:"merchant"`
		Payer         string `json:"payer"`
		Recipient     string `json:"recipient"`
		Genesis       string `json:"genesis"`
		NativeChainID string `json:"nativeChainId"`
		AmountAtoms   string `json:"amountAtoms"`
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	var s *Store
	var order Order
	var buyer, owner, returnID string
	var cfg ServerConfig
	var request NativeShopInvoiceRequestDATA
	var transport *http.Transport
	var sequence int
	var receive, restockKey string
	defer func() {
		if transport != nil {
			transport.CloseIdleConnections()
		}
	}()
	reply := func(v any) {
		raw, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		fmt.Fprintln(os.Stdout, "P07_JOINT_JSON "+string(raw))
	}
	for scanner.Scan() {
		var c command
		if json.Unmarshal(scanner.Bytes(), &c) != nil {
			t.Fatal("invalid PUBLIC command")
		}
		sequence++
		result := map[string]any{"command": c.Command, "PUBLICSource": true, "SourceAdmission": false, "fundsAuthorized": false}
		var err error
		switch c.Command {
		case "init":
			if s != nil {
				t.Fatal("original init repeated")
			}
			ca := x509.NewCertPool()
			if !ca.AppendCertsFromPEM([]byte(c.CAPEM)) {
				t.Fatal("actual PUBLIC TLS server certificate required")
			}
			transport = &http.Transport{TLSClientConfig: &tls.Config{RootCAs: ca, MinVersion: tls.VersionTLS13}}
			client, e := NewOriginalNativeShopPayClient(c.Origin, &http.Client{Transport: transport, Timeout: 20 * time.Second})
			if e != nil {
				t.Fatal(e)
			}
			s, e = Open(filepath.Join(t.TempDir(), "original-shop.json"))
			if e != nil {
				t.Fatal(e)
			}
			buyer, owner = c.Payer, c.Merchant
			st, p := setupCatalog(t, s, owner, 5)
			order, e = s.CreateOrder(buyer, orderInput(st, p, "PUBLIC-actual-Pay-joint-order"))
			if e != nil {
				t.Fatal(e)
			}
			price := ShopNativeInvoicePriceDATA{Merchant: owner, Recipient: c.Recipient, Genesis: c.Genesis, NativeChainID: c.NativeChainID, AssetID: "YNXT", UnitVersion: "1", AmountAtoms: c.AmountAtoms, PriceApprovalRef: "PUBLIC-original-P06-approved-price"}
			request, e = nativeInvoiceRequestDATA(order, price)
			if e != nil {
				t.Fatal(e)
			}
			cfg = ServerConfig{NativeInvoiceOnly: true, NativePay: client, businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}, NativeInvoiceDATA: nativeInvoiceDATAFixture(func(context.Context, ShopNativeInvoiceSelectionDATA) (ShopNativeInvoicePriceDATA, error) {
				return price, nil
			})}
			result["request"] = request
			result["statePath"] = s.path
		case "prepare", "confirm":
			if s == nil {
				t.Fatal("init required")
			}
			path := "/api/orders/" + order.ID + "/confirm-payment"
			body := `{}`
			if c.Command == "prepare" {
				path = "/api/orders/" + order.ID + "/native-pay-intent"
				body = `{"IdempotencyKey":"PUBLIC-joint-original-intent"}`
			}
			w := businessHTTPRequest(NewServer(s, cfg), "POST", path, fmt.Sprintf("%043d", sequence), body)
			result["httpStatus"] = w.Code
			result["response"] = json.RawMessage(w.Body.Bytes())
		case "cold":
			if s == nil {
				t.Fatal("init required")
			}
			s, err = Open(s.path)
		case "open-return":
			if s == nil {
				t.Fatal("init required")
			}
			var v Order
			v, err = s.transition(owner, "seller", order.ID, "shipped", &Shipment{Carrier: "PUBLIC-actual", TrackingNumber: "PUBLIC-original-tracking"}, nil, nil, "PUBLIC-joint-original-shipment")
			if err == nil {
				v, err = s.transition(buyer, "buyer", order.ID, "delivered", nil, nil, nil, "PUBLIC-joint-original-delivery")
			}
			if err == nil {
				v, err = s.transition(buyer, "buyer", order.ID, "return_requested", nil, &Resolution{Kind: "return", Reason: "PUBLIC-original-return"}, nil, "PUBLIC-joint-original-return")
			}
			if err == nil {
				returnID = v.Timeline[len(v.Timeline)-1].ID
				_, err = s.transition(owner, "seller", order.ID, "return_approved", nil, &Resolution{Kind: "return"}, nil, "PUBLIC-joint-original-return-approval")
			}
			result["returnID"] = returnID
		case "receive":
			if s == nil || returnID == "" {
				t.Fatal("original approved return required")
			}
			var v Order
			v, err = s.ReceiveReturn(owner, order.ID, receiveInput(order, returnID, "PUBLIC-joint-warehouse-original", "PUBLIC-joint-receive-original", 1))
			if err == nil {
				receive = v.ReturnReceipts[0].ID
				restockKey = "PUBLIC-joint-restock-original"
			}
			result["receiptID"] = receive
		case "restock":
			if s == nil || receive == "" {
				t.Fatal("original goods receipt required")
			}
			_, err = s.RestockReturn(owner, order.ID, RestockReturnInput{ReceiptID: receive, IdempotencyKey: restockKey})
		case "snapshot":
		case "quit":
			reply(result)
			return
		default:
			t.Fatal("unknown PUBLIC joint command", c.Command)
		}
		if err != nil {
			result["error"] = err.Error()
		}
		if s != nil {
			v, e := s.Order(buyer, "buyer", order.ID)
			if e != nil {
				t.Fatal(e)
			}
			order = v
			result["order"] = order
			result["products"] = s.s.Products
			result["sequence"] = strconv.Itoa(sequence)
		}
		reply(result)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
}
