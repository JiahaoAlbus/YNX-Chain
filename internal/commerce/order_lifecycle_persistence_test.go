package commerce

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Controlled evidence exercises the original local projection, not V5 funds
// admission. Failed writes must not become paid/shipped/refunded in memory or
// consume stock/idempotency before the original durable operation can recover.
func TestOrderLifecyclePersistenceFailureThenOriginalRetry(t *testing.T) {
	for _, action := range []string{"settlement", "cancel", "shipment", "refund", "inventory", "expiry"} {
		t.Run(action, func(t *testing.T) {
			s, buyer, order, receipt := settlementFixture(t)
			_, owner := actor(t, 1)
			if action == "shipment" || action == "refund" {
				var err error
				order, err = s.ConfirmSettlement(order.ID, receipt)
				if err != nil {
					t.Fatal(err)
				}
			}
			if action == "refund" {
				var err error
				order, err = s.transition(buyer, "buyer", order.ID, "refund_requested", nil, &Resolution{Kind: "refund", Reason: "return"}, nil, "lifecycle-refund-request")
				if err != nil {
					t.Fatal(err)
				}
				order, err = s.transition(owner, "seller", order.ID, "refund_approved", nil, &Resolution{Kind: "refund"}, nil, "lifecycle-refund-approve")
				if err != nil {
					t.Fatal(err)
				}
			}
			e := RefundEvidence{ID: "lifecycle_refund", IntentID: order.PayIntentID, Merchant: order.PayMerchant, Currency: NativeSymbol, Status: "recorded", AmountYNXT: order.TotalYNXT, BlockHeight: 82, RecordedAt: time.Now().UTC(), TransactionHash: strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64), RequestHash: strings.Repeat("c", 64)}
			apply := func() (Order, error) {
				switch action {
				case "expiry":
					s.now = func() time.Time { return order.ReservationExpiresAt.Add(time.Second) }
					if err := s.Recover(); err != nil {
						return Order{}, err
					}
					return s.Order(buyer, "buyer", order.ID)
				case "inventory":
					_, err := s.SetInventory(owner, InventoryInput{StoreID: order.StoreID, ProductID: order.Lines[0].ProductID, VariantID: order.Lines[0].VariantID, Inventory: 10, IdempotencyKey: "lifecycle-inventory"})
					if err != nil {
						return Order{}, err
					}
					return s.Order(buyer, "buyer", order.ID)
				case "settlement":
					return s.ConfirmSettlement(order.ID, receipt)
				case "cancel":
					return s.transition(buyer, "buyer", order.ID, "cancelled", nil, nil, nil, "lifecycle-cancel")
				case "shipment":
					return s.transition(owner, "seller", order.ID, "shipped", &Shipment{Carrier: "Carrier", TrackingNumber: "TRACK"}, nil, nil, "lifecycle-shipment")
				default:
					return s.BindRefundEvidence(owner, order.ID, e)
				}
			}
			before, err := cloneSnapshot(s.s)
			if err != nil {
				t.Fatal(err)
			}
			path := s.path
			durable, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			blocked := filepath.Join(t.TempDir(), "blocked")
			if err = os.WriteFile(blocked, []byte("blocked"), 0600); err != nil {
				t.Fatal(err)
			}
			s.path = filepath.Join(blocked, "state.json")
			if _, err = apply(); err == nil {
				t.Fatal("failed write reported success")
			}
			if !reflect.DeepEqual(s.s, before) {
				t.Fatal("failed persistence left memory-only order, stock, audit or idempotency")
			}
			unchanged, err := os.ReadFile(path)
			if err != nil || string(unchanged) != string(durable) {
				t.Fatal("failed write changed original state", err)
			}
			s.path = path
			result, err := apply()
			if err != nil {
				t.Fatal("original operation could not retry", err)
			}
			committed, err := cloneSnapshot(s.s)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = apply(); err != nil || !reflect.DeepEqual(s.s, committed) {
				t.Fatal("retry duplicated effects", err)
			}
			reopened, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			read, err := reopened.Order(buyer, "buyer", order.ID)
			if err != nil || !reflect.DeepEqual(read, result) {
				t.Fatal("restart lost same original result", err)
			}
		})
	}
}
