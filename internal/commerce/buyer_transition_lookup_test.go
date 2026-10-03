package commerce

import (
	"bytes"
	"encoding/json"
	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"net/http"
	"strings"
	"testing"
)

func TestBuyerTransitionLookupColdOriginalLaterStateAndPureRead(t *testing.T) {
	s, buyer, order, evidence := settlementFixture(t)
	_, seller := actor(t, 1)
	if _, err := s.ConfirmSettlement(order.ID, evidence); err != nil {
		t.Fatal(err)
	}
	if _, err := s.transition(seller, "seller", order.ID, "shipped", &Shipment{Carrier: "Original carrier", TrackingNumber: "Original tracking"}, nil, nil, "original-shipment"); err != nil {
		t.Fatal(err)
	}
	in := orderTransitionInput{Action: "delivered", IdempotencyKey: "original-buyer-delivery"}
	if _, err := s.transition(buyer, "buyer", order.ID, in.Action, nil, nil, nil, in.IdempotencyKey); err != nil {
		t.Fatal(err)
	}
	if _, err := s.transition(buyer, "buyer", order.ID, "reviewed", nil, nil, &Review{Rating: 2, Body: "Actual review"}, "original-buyer-review"); err != nil {
		t.Fatal(err)
	}
	cold, err := Open(s.path)
	if err != nil {
		t.Fatal(err)
	}
	before := transitionDomainSnapshot(t, cold)
	got, err := cold.lookupBuyerTransition(buyer, order.ID, in)
	if err != nil || got.ID != order.ID || got.Status != "reviewed" || got.Review.Rating != 2 {
		t.Fatal(got, err)
	}
	got.Review.Body = "caller mutation"
	again, _ := cold.lookupBuyerTransition(buyer, order.ID, in)
	if again.Review.Body != "Actual review" {
		t.Fatal("readback aliases original state")
	}
	if !bytes.Equal(before, transitionDomainSnapshot(t, cold)) {
		t.Fatal("lookup changed original domain")
	}
	for _, bad := range []orderTransitionInput{{Action: "reviewed", Rating: 5, Body: "changed", IdempotencyKey: "original-buyer-review"}, {Action: "delivered", IdempotencyKey: "missing-buyer-delivery"}, {Action: "shipped", IdempotencyKey: "original-shipment"}} {
		if _, err := cold.lookupBuyerTransition(buyer, order.ID, bad); err == nil {
			t.Fatal("changed or unsupported intent accepted")
		}
	}
	_, other := actor(t, 3)
	if _, err := cold.lookupBuyerTransition(other, order.ID, in); err != ErrUnauthorized {
		t.Fatal("foreign buyer accepted", err)
	}
	if _, err := cold.lookupBuyerTransition(buyer, "another-order", in); err == nil {
		t.Fatal("target substitution accepted")
	}
	if !bytes.Equal(before, transitionDomainSnapshot(t, cold)) {
		t.Fatal("rejected lookup changed original domain")
	}
}
func TestBuyerTransitionLookupHTTPRequiresCurrentRoleAndOriginalKey(t *testing.T) {
	s, buyer, order, _ := settlementFixture(t)
	in := orderTransitionInput{Action: "cancelled", IdempotencyKey: "original-cancel-intent"}
	if _, err := s.transition(buyer, "buyer", order.ID, in.Action, nil, nil, nil, in.IdempotencyKey); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(in)
	route := "/api/orders/" + order.ID + "/transition-intent-lookup"
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	before := len(s.s.Idempotency)
	w := businessHTTPRequest(server, "POST", route, strings.Repeat("a", 43), string(raw))
	if w.Code != 200 || !strings.Contains(w.Body.String(), "original-cancel-intent") {
		t.Fatal(w.Code, w.Body)
	}
	if len(s.s.Idempotency) != before {
		t.Fatal("lookup registered replacement intent")
	}
	bad := in
	bad.IdempotencyKey = "missing-cancel-intent"
	body, _ := json.Marshal(bad)
	w = businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), string(body))
	if w.Code != 409 || strings.Contains(w.Body.String(), "cancelled") {
		t.Fatal("missing key exposed order", w.Code, w.Body)
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "seller"}})
	w = businessHTTPRequest(server, "POST", route, strings.Repeat("c", 43), string(raw))
	if w.Code != 401 && w.Code != 403 {
		t.Fatal("seller role accepted buyer lookup", w.Code, w.Body)
	}
	s.s.RetiredIdempotency[retiredIdempotencyDigest(buyer, "order.transition."+order.ID, in.IdempotencyKey)] = struct{}{}
	if _, err := s.lookupBuyerTransition(buyer, order.ID, in); err != ErrConflict {
		t.Fatal("retired intent revived", err)
	}
}

// The controlled verifier exercises product routing and Wallet projection, not
// real public authority. Current fences must run before any receipt is exposed.
type buyerLookupWireVerifier struct {
	controlledBusinessVerifier
	wallet string
}

func (v buyerLookupWireVerifier) verify(r *http.Request, body []byte, route businessRoutePolicy) (*verifiedBusinessRequest, error) {
	result, err := v.controlledBusinessVerifier.verify(r, body, route)
	if err == nil {
		result.walletAccount = v.wallet
	}
	return result, err
}
func TestBuyerTransitionLookupCurrentFenceAndWalletProjection(t *testing.T) {
	s, buyer, order, _ := settlementFixture(t)
	in := orderTransitionInput{Action: "cancelled", IdempotencyKey: "original-wire-cancel"}
	if _, err := s.transition(buyer, "buyer", order.ID, in.Action, nil, nil, nil, in.IdempotencyKey); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(in)
	route := "/api/orders/" + order.ID + "/transition-intent-lookup"
	wallet, err := accountaddress.Encode(buyer)
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(s, ServerConfig{businessV2: buyerLookupWireVerifier{controlledBusinessVerifier: controlledBusinessVerifier{account: buyer, role: "buyer"}, wallet: wallet}})
	w := businessHTTPRequest(server, "POST", route, strings.Repeat("d", 43), string(raw))
	var got struct {
		Actor string
		Order struct{ Buyer, WalletBuyer string }
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || got.Actor != wallet || got.Order.Buyer != buyer || got.Order.WalletBuyer != wallet {
		t.Fatal(w.Code, w.Body)
	}
	before := transitionDomainSnapshot(t, s)
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer", fence: func() error { return &businessHTTPError{"CURRENT_AUTH_REVOKED", 403} }}})
	w = businessHTTPRequest(server, "POST", route, strings.Repeat("e", 43), string(raw))
	if w.Code != 403 || strings.Contains(w.Body.String(), in.IdempotencyKey) || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("revoked current authority exposed original receipt", w.Code, w.Body)
	}
}
