package commerce

import (
	"errors"
	"os"
	"reflect"
	"testing"
	"time"
)

func TestP0704ExpiredReservationCannotBeMarkedPaidBeforeRecovery(t *testing.T) {
	s, buyer, order, receipt := settlementFixture(t)
	s.now = func() time.Time { return order.ReservationExpiresAt.Add(time.Second) }
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConfirmSettlement(order.ID, receipt); !errors.Is(err, ErrInvalidState) {
		t.Fatal("a receipt received after reservation expiry must require reconciliation, never auto-pay/ship", err)
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("late receipt changed stock, order or audit before reconciliation")
	}
	if err := s.Recover(); err != nil {
		t.Fatal(err)
	}
	expired, err := s.Order(buyer, "buyer", order.ID)
	if err != nil || expired.Status != "expired" || expired.Settlement != nil {
		t.Fatal("normal expiry recovery lost original order boundary", err)
	}
}

func TestP0704LateReceiptCannotConsumeAnotherBuyersReservation(t *testing.T) {
	s, buyer, order, receipt := settlementFixture(t)
	s.now = func() time.Time { return order.ReservationExpiresAt.Add(time.Second) }
	if err := s.Recover(); err != nil {
		t.Fatal(err)
	}
	_, other := actor(t, 221)
	product := s.s.Products[order.Lines[0].ProductID]
	store := s.s.Stores[order.StoreID]
	newOrder, err := s.CreateOrder(other, orderInput(store, product, "new-buyer-after-expiry"))
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ConfirmSettlement(order.ID, receipt); !errors.Is(err, ErrInvalidState) {
		t.Fatal("expired original order consumed replacement reservation", err)
	}
	read, err := s.Order(other, "buyer", newOrder.ID)
	if err != nil || read.Status != "payment_pending" {
		t.Fatal("new buyer order changed", err)
	}
	after, err := os.ReadFile(s.path)
	if err != nil || string(before) != string(after) {
		t.Fatal("late original receipt changed durable replacement stock/order", err)
	}
	original, err := s.Order(buyer, "buyer", order.ID)
	if err != nil || original.Status != "expired" {
		t.Fatal("historical order became paid", err)
	}
}
