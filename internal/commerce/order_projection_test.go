package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

func TestP0708ProjectionSameOrderRedactionAndNoPersistence(t *testing.T) {
	s, order, buyer, owner := invoiceRecoveryFixture(t)
	before, _ := os.ReadFile(s.path)
	view, err := s.ReadScopedOrder(buyer, "buyer", order.ID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if view.OrderID != order.ID || len(view.Snapshot) != 128 || len(view.Data) != 3 || view.Data["status"] != order.Status || view.Data["totalYNXT"] != strconv.FormatInt(order.TotalYNXT, 10) {
		t.Fatal(view)
	}
	raw, _ := json.Marshal(view)
	for _, secret := range []string{buyer, owner, "inv_original", "intent_original", "Address", "Recipient", "Timeline", "PayPayoutAddress"} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("projection exposed %s", secret)
		}
	}
	// A caller changing the returned object must not mutate stored authority.
	view.Data["status"] = "paid"
	view.Fields[0] = "address"
	again, err := s.ReadScopedOrder(owner, "seller", order.ID, []string{"status"}, view.Snapshot)
	if err != nil || again.Data["status"] != order.Status {
		t.Fatal(again, err)
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(before, after) {
		t.Fatal("read changed persisted state")
	}
}

func TestP0708ProjectionRechecksSellerRevocation(t *testing.T) {
	s, order, _, owner := invoiceRecoveryFixture(t)
	_, member := actor(t, 209)
	acceptSellerRole(t, s, owner, order.StoreID, member, SellerRoleViewer)
	view, err := s.ReadScopedOrder(member, "seller", order.ID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.RevokeSellerRole(owner, order.StoreID, member, "membership withdrawn"); err != nil {
		t.Fatal(err)
	}
	if result, err := s.ReadScopedOrder(member, "seller", order.ID, nil, view.Snapshot); !errors.Is(err, ErrUnauthorized) || result.Data != nil {
		t.Fatal("snapshot reused revoked membership", result, err)
	}
}

func TestP0708ProjectionHTTPRejectsInjectedIdentityAndStaleAuthority(t *testing.T) {
	s, order, buyer, _ := invoiceRecoveryFixture(t)
	legacy := NewServer(s, ServerConfig{Auth: testAuth{principals: map[string]Principal{"buyer-token": principal(buyer, "buyer")}}})
	r := httptest.NewRequest("POST", "/api/orders/"+order.ID+"/projection", strings.NewReader(`{"fields":["status"],"actor":"other","tenant":"claimed"}`))
	r.Header.Set("Authorization", "Bearer buyer-token")
	w := httptest.NewRecorder()
	legacy.Handler().ServeHTTP(w, r)
	if w.Code != 400 || strings.Contains(w.Body.String(), order.ID) {
		t.Fatal(w.Code, w.Body.String())
	}
	checks := 0
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error {
		checks++
		if checks >= 3 {
			return ErrUnauthorized
		}
		return nil
	}}})
	w = businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/projection", strings.Repeat("r", 43), `{"fields":["status"]}`)
	if w.Code != 403 || strings.Contains(w.Body.String(), order.ID) || len(s.s.BusinessNonces) != 0 {
		t.Fatal("revoked action published projection", w.Code, w.Body.String())
	}
}

func TestP0708ProjectionRejectsFieldExpansionAndForeignActor(t *testing.T) {
	s, order, buyer, _ := invoiceRecoveryFixture(t)
	for _, fields := range [][]string{{"address"}, {"buyer"}, {"lines"}, {"shipment"}, {"timeline"}, {"status", "status"}, {"*"}, {"Status"}, {"status", "address"}} {
		if result, err := s.ReadScopedOrder(buyer, "buyer", order.ID, fields, ""); !errors.Is(err, ErrInvalidState) || result.Data != nil {
			t.Fatal(fields, result, err)
		}
	}
	for _, role := range []string{"buyer", "seller", "agent", "admin"} {
		if result, err := s.ReadScopedOrder("foreign-account", role, order.ID, nil, ""); !errors.Is(err, ErrUnauthorized) || result.Data != nil {
			t.Fatal(role, result, err)
		}
	}
}

func TestP0708ProjectionRejectsStaleSnapshotAndCrossOrder(t *testing.T) {
	s, first, second, buyer, _ := attachmentOrders(t)
	view, err := s.ReadScopedOrder(buyer, "buyer", first.ID, nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadScopedOrder(buyer, "buyer", second.ID, nil, view.Snapshot); !errors.Is(err, ErrConflict) {
		t.Fatal("cross-order snapshot accepted", err)
	}
	// A private-field change with the same timestamp must invalidate the full
	// snapshot, even when the selected public values did not change.
	s.mu.Lock()
	o := s.s.Orders[first.ID]
	o.Address.Recipient = "changed-recipient"
	s.s.Orders[first.ID] = o
	s.mu.Unlock()
	if view, err := s.ReadScopedOrder(buyer, "buyer", first.ID, nil, view.Snapshot); !errors.Is(err, ErrConflict) || view.Data != nil {
		t.Fatal("stale snapshot accepted", view, err)
	}
}

func TestP0708ProjectionHTTPAndTaskAuthorityStaySeparate(t *testing.T) {
	s, order, buyer, _ := invoiceRecoveryFixture(t)
	for _, v2 := range []bool{false, true} {
		cfg := ServerConfig{Auth: testAuth{principals: map[string]Principal{"buyer-token": principal(buyer, "buyer")}}}
		if v2 {
			cfg.businessV2 = controlledBusinessVerifier{account: buyer, role: "buyer"}
		}
		server := NewServer(s, cfg)
		var response *httptest.ResponseRecorder
		if v2 {
			response = businessHTTPRequest(server, "POST", "/api/orders/"+order.ID+"/projection", strings.Repeat("q", 43), `{"fields":["status"]}`)
		} else {
			request := httptest.NewRequest("POST", "/api/orders/"+order.ID+"/projection", strings.NewReader(`{"fields":["status"]}`))
			request.Header.Set("Authorization", "Bearer buyer-token")
			response = httptest.NewRecorder()
			server.Handler().ServeHTTP(response, request)
		}
		if response.Code != 200 {
			t.Fatal(v2, response.Code, response.Body.String())
		}
		var body OrderProjection
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || !reflect.DeepEqual(body.Fields, []string{"status"}) {
			t.Fatal(body, err)
		}
		request := httptest.NewRequest("POST", "/api/tools/shop.order.read", strings.NewReader(`{"tenant":"claimed","grant":{"allowed":true},"orderId":"`+order.ID+`"}`))
		request.Header.Set("Authorization", "Bearer buyer-token")
		request.Header.Set("X-Tool-Class", "read")
		response = httptest.NewRecorder()
		server.Handler().ServeHTTP(response, request)
		if response.Code != 503 || !strings.Contains(response.Body.String(), "SHOP_TASK_ORDER_READ_NOT_ADMITTED") || strings.Contains(response.Body.String(), order.ID) {
			t.Fatal("session or claimed grant admitted task", v2, response.Code, response.Body.String())
		}
	}
}
