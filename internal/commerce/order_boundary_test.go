package commerce

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func paidBoundaryOrder(t *testing.T, s *Store, owner, buyer string) (StoreProfile, Order) {
	t.Helper()
	store, product := setupCatalog(t, s, owner, 2)
	order, err := s.CreateOrder(buyer, orderInput(store, product, "boundary-order-create"))
	if err != nil {
		t.Fatal(err)
	}
	order, err = s.BindInvoice(buyer, order.ID, PayInvoiceHandoff{InvoiceID: "boundary-invoice", IntentID: "boundary-intent", Merchant: "boundary-merchant", PayoutAddress: owner})
	if err != nil {
		t.Fatal(err)
	}
	order, err = s.ConfirmSettlement(order.ID, SettlementEvidence{InvoiceID: order.InvoiceID, IntentID: order.PayIntentID, Merchant: order.PayMerchant, PayoutAddress: owner, TransactionHash: "0x" + strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64), Status: "paid", Payer: buyer, Currency: NativeSymbol, AmountYNXT: order.TotalYNXT, BlockHeight: 50, ConfirmedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	return store, order
}

func TestOrderReadRejectsUnknownRole(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, outsider := actor(t, 3)
	_, order := paidBoundaryOrder(t, s, owner, buyer)
	for _, role := range []string{"", "admin", "system", "Buyer", "user"} {
		for _, account := range []string{buyer, owner, outsider} {
			if _, err := s.Order(account, role, order.ID); !errors.Is(err, ErrUnauthorized) {
				t.Errorf("unknown role %q read order as %s: %v", role, account, err)
			}
		}
	}
}

func TestOrderTransitionReplayRequiresCurrentActionPermission(t *testing.T) {
	for _, action := range []string{"shipped", "delivered", "return_approved", "refund_approved"} {
		for _, change := range []string{"downgrade", "revoke"} {
			t.Run(action+"/"+change, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "commerce.json")
				s, err := Open(path)
				if err != nil {
					t.Fatal(err)
				}
				_, owner := actor(t, 1)
				_, buyer := actor(t, 2)
				_, member := actor(t, 3)
				store, order := paidBoundaryOrder(t, s, owner, buyer)
				role := SellerRoleFulfillment
				if action == "return_approved" {
					role = SellerRoleSupport
				}
				if action == "refund_approved" {
					role = SellerRoleFinance
				}
				acceptSellerRole(t, s, owner, store.ID, member, role)
				transition := func(account, asRole, next, key string, shipment *Shipment, resolution *Resolution) Order {
					t.Helper()
					result, err := s.transition(account, asRole, order.ID, next, shipment, resolution, nil, key)
					if err != nil {
						t.Fatal(err)
					}
					return result
				}
				if action == "delivered" || action == "return_approved" {
					transition(owner, "seller", "shipped", "boundary-owner-shipped", &Shipment{Carrier: "Carrier", TrackingNumber: "TRACK"}, nil)
				}
				if action == "return_approved" {
					transition(buyer, "buyer", "delivered", "boundary-buyer-delivered", nil, nil)
					transition(buyer, "buyer", "return_requested", "boundary-buyer-return", nil, &Resolution{Kind: "return", Reason: "Damaged"})
				}
				if action == "refund_approved" {
					transition(buyer, "buyer", "refund_requested", "boundary-buyer-refund", nil, &Resolution{Kind: "refund", Reason: "Damaged"})
				}
				input := func() (*Shipment, *Resolution) {
					switch action {
					case "shipped":
						return &Shipment{Carrier: "Carrier", TrackingNumber: "TRACK"}, nil
					case "return_approved":
						return nil, &Resolution{Kind: "return"}
					case "refund_approved":
						return nil, &Resolution{Kind: "refund"}
					default:
						return nil, nil
					}
				}
				shipment, resolution := input()
				before := transition(member, "seller", action, "boundary-member-action", shipment, resolution)
				shipment, resolution = input()
				if replay := transition(member, "seller", action, "boundary-member-action", shipment, resolution); !reflect.DeepEqual(before, replay) {
					t.Fatal("authorized replay appended events or changed the committed order")
				}
				if change == "downgrade" {
					err = s.SetSellerRole(owner, store.ID, member, SellerRoleViewer)
				} else {
					_, _, err = s.RevokeSellerRole(owner, store.ID, member, "Access ended")
				}
				if err != nil {
					t.Fatal(err)
				}
				s, err = Open(path)
				if err != nil {
					t.Fatal(err)
				}
				shipment, resolution = input()
				if leaked, err := s.transition(member, "seller", order.ID, action, shipment, resolution, nil, "boundary-member-action"); err == nil || leaked.ID != "" {
					t.Fatalf("old mutation key bypassed current %s permission: %+v %v", change, leaked, err)
				}
				after, err := s.Order(buyer, "buyer", order.ID)
				if err != nil || !reflect.DeepEqual(before, after) {
					t.Fatalf("denied replay changed the committed order: %v", err)
				}
			})
		}
	}
}

func TestOrderTransitionKeepsCallerIntentStableAndDetached(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, order := paidBoundaryOrder(t, s, owner, buyer)
	shipment := &Shipment{Carrier: "Carrier", TrackingNumber: "TRACK"}
	resolution := &Resolution{Kind: "return", Reason: "Damaged", Explanation: "Package arrived damaged"}
	review := &Review{Rating: 3, Body: "Package damaged"}
	for _, step := range []struct {
		actor, role, action string
		shipment            *Shipment
		resolution          *Resolution
		review              *Review
	}{
		{owner, "seller", "shipped", shipment, nil, nil},
		{buyer, "buyer", "delivered", nil, nil, nil},
		{buyer, "buyer", "reviewed", nil, nil, review},
		{buyer, "buyer", "return_requested", nil, resolution, nil},
		{owner, "seller", "return_approved", nil, &Resolution{Kind: "return"}, nil},
	} {
		t.Run(step.action, func(t *testing.T) {
			intent := func() []byte {
				data, _ := json.Marshal([]any{step.shipment, step.resolution, step.review})
				return data
			}
			original := intent()
			key := "boundary-stable-" + step.action
			first, err := s.transition(step.actor, step.role, order.ID, step.action, step.shipment, step.resolution, step.review, key)
			if err != nil {
				t.Fatal(err)
			}
			if string(original) != string(intent()) {
				t.Error("transition mutated its caller's retry intent")
			}
			retry, err := s.transition(step.actor, step.role, order.ID, step.action, step.shipment, step.resolution, step.review, key)
			if err != nil || !reflect.DeepEqual(first, retry) {
				t.Fatalf("same intent could not replay without duplicating history: %v", err)
			}
		})
	}
	before, _ := s.Order(buyer, "buyer", order.ID)
	shipment.TrackingNumber = "changed outside store"
	resolution.Reason = "changed outside store"
	review.Body = "changed outside store"
	after, _ := s.Order(buyer, "buyer", order.ID)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("caller pointer changed persisted order evidence")
	}
	if after.Resolution.Reason != "Damaged" || after.Resolution.Explanation != "Package arrived damaged" {
		t.Fatal("approval failed to preserve the original buyer resolution")
	}
	// Idempotency returns the latest record even after the order progresses,
	// without requiring that the original state transition can run again.
	replayed, err := s.transition(owner, "seller", order.ID, "shipped", &Shipment{Carrier: "Carrier", TrackingNumber: "TRACK"}, nil, nil, "boundary-stable-shipped")
	if err != nil || !reflect.DeepEqual(after, replayed) {
		t.Fatalf("authorized earlier intent did not return the current order: %v", err)
	}
}

func mutateOrderSnapshot(order Order) {
	order.Lines[0].Quantity = 999
	order.Timeline[0].Detail = "changed outside store"
	if order.Settlement != nil {
		order.Settlement.TransactionHash = "changed outside store"
	}
	if order.Refund != nil {
		order.Refund.TransactionHash = "changed outside store"
	}
	if order.Shipment != nil {
		order.Shipment.TrackingNumber = "changed outside store"
	}
	if order.Resolution != nil {
		order.Resolution.Reason = "changed outside store"
	}
	if order.Review != nil {
		order.Review.Body = "changed outside store"
	}
	if order.TrustCase != nil {
		order.TrustCase.CaseID = "changed outside store"
	}
}

func TestOrderReadAndExportSnapshotsCannotMutateRecords(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	store, order := paidBoundaryOrder(t, s, owner, buyer)
	// A complete historical record exercises every nested evidence field.
	order.Shipment = &Shipment{TrackingNumber: "TRACK"}
	order.Resolution = &Resolution{Reason: "Damaged"}
	order.Review = &Review{Body: "Review"}
	order.Refund = &RefundEvidence{TransactionHash: "Refund"}
	order.TrustCase = &TrustCaseEvidence{CaseID: "Trust"}
	s.s.Orders[order.ID] = order
	original, _ := json.Marshal(order)
	for _, read := range []struct {
		name string
		get  func() Order
	}{
		{"buyer read", func() Order { result, _ := s.Order(buyer, "buyer", order.ID); return result }},
		{"seller read", func() Order { result, _ := s.Order(owner, "seller", order.ID); return result }},
		{"buyer list", func() Order { return s.Orders(buyer, "buyer")[0] }},
		{"seller list", func() Order { return s.Orders(owner, "seller")[0] }},
		{"buyer export", func() Order { return s.ExportBuyerData(buyer).Orders[0] }},
		{"seller export", func() Order {
			result, err := s.ExportSellerData(owner, store.ID, "data portability")
			if err != nil {
				t.Fatal(err)
			}
			return result.Orders[0]
		}},
	} {
		t.Run(read.name, func(t *testing.T) {
			mutateOrderSnapshot(read.get())
			current, _ := json.Marshal(s.s.Orders[order.ID])
			if string(current) != string(original) {
				t.Fatal("response aliases the persisted order")
			}
		})
	}
}

func TestOrderMutationResultsAreDetachedFromCommittedEvidence(t *testing.T) {
	for _, finish := range []string{"refund", "trust"} {
		t.Run(finish, func(t *testing.T) {
			s, _ := Open("")
			_, owner := actor(t, 1)
			_, buyer := actor(t, 2)
			store, product := setupCatalog(t, s, owner, 2)
			check := func(result Order, err error) Order {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
				before, _ := json.Marshal(s.s.Orders[result.ID])
				mutateOrderSnapshot(result)
				after, _ := json.Marshal(s.s.Orders[result.ID])
				if string(before) != string(after) {
					t.Fatal("mutation response changed the committed order")
				}
				fresh, err := s.Order(buyer, "buyer", result.ID)
				if err != nil {
					t.Fatal(err)
				}
				return fresh
			}
			input := orderInput(store, product, "boundary-mutation-result")
			order := check(s.CreateOrder(buyer, input))
			check(s.CreateOrder(buyer, input))
			order = check(s.BindInvoice(buyer, order.ID, PayInvoiceHandoff{InvoiceID: "boundary-invoice", IntentID: "boundary-intent", Merchant: "boundary-merchant", PayoutAddress: owner}))
			settlement := SettlementEvidence{InvoiceID: order.InvoiceID, IntentID: order.PayIntentID, Merchant: order.PayMerchant, PayoutAddress: owner, TransactionHash: "0x" + strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64), Status: "paid", Payer: buyer, Currency: NativeSymbol, AmountYNXT: order.TotalYNXT, BlockHeight: 50, ConfirmedAt: time.Now().UTC()}
			order = check(s.ConfirmSettlement(order.ID, settlement))
			check(s.ConfirmSettlement(order.ID, settlement))
			if finish == "refund" {
				resolution := &Resolution{Kind: "refund", Reason: "Damaged"}
				order = check(s.transition(buyer, "buyer", order.ID, "refund_requested", nil, resolution, nil, "boundary-mutation-refund"))
				check(s.transition(buyer, "buyer", order.ID, "refund_requested", nil, resolution, nil, "boundary-mutation-refund"))
				order = check(s.transition(owner, "seller", order.ID, "refund_approved", nil, &Resolution{Kind: "refund"}, nil, "boundary-mutation-approve"))
				approvedSnapshot := order
				evidence := RefundEvidence{ID: "boundary-refund", Signer: owner, IntentID: order.PayIntentID, Merchant: order.PayMerchant, Currency: NativeSymbol, Status: "recorded", AmountYNXT: order.TotalYNXT, BlockHeight: 51, TransactionHash: strings.Repeat("c", 64), AuditHash: strings.Repeat("d", 64), RequestHash: strings.Repeat("e", 64), RecordedAt: time.Now().UTC()}
				check(s.BindRefundEvidence(owner, order.ID, evidence))
				check(s.BindRefundEvidence(owner, order.ID, evidence))
				if approvedSnapshot.Resolution.Status != "refund_approved" {
					t.Fatal("committing refund modified an earlier response snapshot")
				}
			} else {
				order = check(s.transition(buyer, "buyer", order.ID, "disputed", nil, &Resolution{Kind: "dispute", Reason: "Damaged"}, nil, "boundary-mutation-dispute"))
				evidence := &TrustCaseEvidence{CaseID: "boundary-trust", Status: "open", Source: "ynx-trust-center-api", SubmittedAt: time.Now().UTC()}
				check(s.BindTrustCase(buyer, order.ID, evidence, false))
				evidence.CaseID = "changed outside store"
				if s.s.Orders[order.ID].TrustCase.CaseID != "boundary-trust" {
					t.Fatal("Trust input pointer changed persisted evidence")
				}
			}
		})
	}
}
