package commerce

import (
	"os"
	"reflect"
	"testing"
	"time"
)

// Corrupt legacy stock relationships stay readable for recovery. They may not
// turn a matching receipt into payment, silently release another reservation,
// manufacture a missing SKU, or be clamped into an apparently healthy catalog.
func TestOrderReservationIntegrityAcrossSettlementCancellationAndExpiry(t *testing.T) {
	for _, action := range []string{"settlement", "cancel", "expiry"} {
		for _, fault := range []string{"missing-product", "missing-variant", "duplicate-variant", "foreign-store", "negative-reserved", "insufficient-reserved", "negative-quantity"} {
			t.Run(action+"/"+fault, func(t *testing.T) {
				s, buyer, order, receipt := settlementFixture(t)
				p := s.s.Products[order.Lines[0].ProductID]
				switch fault {
				case "missing-product":
					delete(s.s.Products, p.ID)
				case "missing-variant":
					p.Variants = nil
					s.s.Products[p.ID] = p
				case "duplicate-variant":
					p.Variants = append(p.Variants, p.Variants[0])
					s.s.Products[p.ID] = p
				case "foreign-store":
					p.StoreID = "different-store"
					s.s.Products[p.ID] = p
				case "negative-reserved":
					p.Variants[0].Reserved = -1
					s.s.Products[p.ID] = p
				case "insufficient-reserved":
					p.Variants[0].Reserved = 0
					s.s.Products[p.ID] = p
				case "negative-quantity":
					order.Lines[0].Quantity = -1
					s.s.Orders[order.ID] = order
				}
				if err := s.persistLocked(); err != nil {
					t.Fatal(err)
				}
				before, err := cloneSnapshot(s.s)
				if err != nil {
					t.Fatal(err)
				}
				disk, err := os.ReadFile(s.path)
				if err != nil {
					t.Fatal(err)
				}
				switch action {
				case "settlement":
					_, err = s.ConfirmSettlement(order.ID, receipt)
				case "cancel":
					_, err = s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, "integrity-cancel-original")
				case "expiry":
					s.now = func() time.Time { return order.ReservationExpiresAt.Add(time.Second) }
					err = s.Recover()
				}
				if err == nil {
					t.Fatal("invalid original inventory relationship was accepted")
				}
				if !reflect.DeepEqual(s.s, before) {
					t.Fatal("invalid inventory changed original order, stock or recovery history")
				}
				after, err := os.ReadFile(s.path)
				if err != nil || string(after) != string(disk) {
					t.Fatal("invalid operation changed durable source", err)
				}
				if _, err = s.Order(buyer, "buyer", order.ID); err != nil {
					t.Fatal("historical order became unreadable", err)
				}
			})
		}
	}
}

func TestReservationRecoveryFailureIsAtomicAndScopedForNewCheckout(t *testing.T) {
	s, first, second, _, _ := attachmentOrders(t)
	p := s.s.Products[first.Lines[0].ProductID]
	p.Variants[0].Reserved = 1 // Two original orders cannot both release this one.
	s.s.Products[p.ID] = p
	s.now = func() time.Time { return first.ReservationExpiresAt.Add(time.Minute) }
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Recover(); err == nil || !reflect.DeepEqual(s.s, before) {
		t.Fatal("partial batch expiry changed the first order before the second failed", err)
	}
	if s.s.Orders[first.ID].Status != "payment_pending" || s.s.Orders[second.ID].Status != "payment_pending" {
		t.Fatal("original expiry facts lost")
	}
	_, otherOwner := actor(t, 241)
	_, otherBuyer := actor(t, 242)
	store, product := setupCatalog(t, s, otherOwner, 2)
	created, err := s.CreateOrder(otherBuyer, orderInput(store, product, "unrelated-store-checkout"))
	if err != nil || created.StoreID != store.ID {
		t.Fatal("unrelated merchant checkout blocked by other store's corrupt expiry", err)
	}
	if s.s.Orders[first.ID].Status != "payment_pending" || s.s.Products[p.ID].Variants[0].Reserved != 1 {
		t.Fatal("unrelated checkout rewrote damaged history")
	}
}
