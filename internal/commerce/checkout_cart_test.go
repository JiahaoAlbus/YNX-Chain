package commerce

import (
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"
)

func TestCheckoutConsumesCartOnceAndReplayPreservesNewCart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, _ := Open(path)
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	_, other := actor(t, 3)
	st, p := setupCatalog(t, s, owner, 40)
	in := orderInput(st, p, "checkout-cart-0001")
	c, err := s.SaveCart(buyer, in.Items)
	if err != nil {
		t.Fatal(err)
	}
	in.CartRevision = &c.Revision
	order, err := s.CreateOrder(buyer, in)
	if err != nil {
		t.Fatal(err)
	}
	if order.CartConsumption == nil || order.CartConsumption.PreviousRevision != c.Revision || s.Cart(buyer).Revision != order.CartConsumption.Revision || len(s.Cart(buyer).Items) != 0 {
		t.Fatal("order/cart not consumed atomically")
	}
	newCart, err := s.SaveCart(buyer, in.Items)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := s.CreateOrder(buyer, in)
	if err != nil || replay.ID != order.ID || !reflect.DeepEqual(s.Cart(buyer), newCart) {
		t.Fatalf("replay consumed replacement: %v", err)
	}
	replay.CartConsumption.Revision = "mutated"
	lookup, err := s.OrderIntent(buyer, in.IdempotencyKey)
	if err != nil || lookup.CartConsumption.Revision == "mutated" {
		t.Fatal("receipt aliased")
	}
	if _, err = s.OrderIntent(other, in.IdempotencyKey); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign intent leaked", err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := reopened.OrderIntent(buyer, in.IdempotencyKey); err != nil || got.ID != order.ID {
		t.Fatal("receipt not durable", err)
	}
	if err = s.ExportRollbackSnapshot(filepath.Join(t.TempDir(), "old.json"), 8); !errors.Is(err, ErrConflict) {
		t.Fatal("CAS downgrade allowed", err)
	}
}

func TestCartRevisionRejectsStaleSameContentAndConcurrentCheckouts(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 40)
	in := orderInput(st, p, "checkout-cart-0002")
	empty := ""
	c, err := s.SaveCartRevision(buyer, in.Items, &empty)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.SaveCartRevision(buyer, in.Items, &c.Revision)
	if err != nil || second.Revision == c.Revision {
		t.Fatal("same content did not advance revision", err)
	}
	if _, err = s.SaveCartRevision(buyer, nil, &c.Revision); !errors.Is(err, ErrCartRevisionConflict) {
		t.Fatal("stale clear accepted", err)
	}
	in.CartRevision = &c.Revision
	if _, err = s.CreateOrder(buyer, in); !errors.Is(err, ErrCartRevisionConflict) {
		t.Fatal("stale checkout accepted", err)
	}
	in.CartRevision = &second.Revision
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"checkout-cart-race-a", "checkout-cart-race-b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			req := in
			req.IdempotencyKey = key
			_, err := s.CreateOrder(buyer, req)
			results <- err
		}(key)
	}
	wg.Wait()
	close(results)
	ok, conflict := 0, 0
	for err := range results {
		if err == nil {
			ok++
		} else if errors.Is(err, ErrCartRevisionConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if ok != 1 || conflict != 1 || len(s.s.Orders) != 1 {
		t.Fatal("duplicate purchase", ok, conflict)
	}
}

func TestCheckoutAndSaveCartPersistenceFailuresRestoreEntireSnapshot(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 40)
	in := orderInput(st, p, "checkout-cart-failure")
	old, err := s.CreateOrder(buyer, orderInput(st, p, "expiring-checkout-before-failure"))
	if err != nil {
		t.Fatal(err)
	}
	old.ReservationExpiresAt = s.now().Add(-time.Minute)
	s.s.Orders[old.ID] = old
	c, err := s.SaveCart(buyer, in.Items)
	if err != nil {
		t.Fatal(err)
	}
	in.CartRevision = &c.Revision
	before, _ := cloneSnapshot(s.s)
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err = os.WriteFile(blocked, []byte("file"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocked, "state.json")
	if _, err = s.CreateOrder(buyer, in); err == nil {
		t.Fatal("persistence failure hidden")
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("failed checkout changed snapshot")
	}
	if _, err = s.SaveCartRevision(buyer, nil, &c.Revision); err == nil {
		t.Fatal("save failure hidden")
	}
	if !reflect.DeepEqual(before, s.s) {
		t.Fatal("failed save changed snapshot")
	}
	s.path = ""
	if _, err = s.CreateOrder(buyer, in); err != nil {
		t.Fatal("original retry rejected", err)
	}
}

func TestLegacyOrderHashAndHTTPCartProtocol(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 1)
	_, buyer := actor(t, 2)
	st, p := setupCatalog(t, s, owner, 40)
	in := orderInput(st, p, "checkout-legacy-hash")
	legacy := struct {
		StoreID        string
		Items          []CartItem
		Address        Address
		IdempotencyKey string
	}{in.StoreID, in.Items, in.Address, in.IdempotencyKey}
	if requestHash(in) != requestHash(legacy) {
		t.Fatal("legacy input hash changed")
	}
	server := httptest.NewServer(NewServer(s, ServerConfig{Auth: testAuth{principals: map[string]Principal{"buyer-token": principal(buyer, "buyer")}}}).Handler())
	defer server.Close()
	var c Cart
	requestJSON(t, server.Client(), "PUT", server.URL+"/api/cart", "buyer-token", map[string]any{"Items": in.Items, "ExpectedRevision": ""}, 200, &c)
	var conflict map[string]string
	requestJSON(t, server.Client(), "PUT", server.URL+"/api/cart", "buyer-token", map[string]any{"Items": in.Items, "ExpectedRevision": ""}, 409, &conflict)
	if conflict["code"] != "CART_REVISION_CONFLICT" {
		t.Fatal(conflict)
	}
	in.CartRevision = &c.Revision
	var order Order
	requestJSON(t, server.Client(), "POST", server.URL+"/api/orders", "buyer-token", in, 201, &order)
	var found Order
	requestJSON(t, server.Client(), "POST", server.URL+"/api/orders/intent-lookup", "buyer-token", map[string]string{"IdempotencyKey": in.IdempotencyKey}, 200, &found)
	if found.ID != order.ID {
		t.Fatal("lookup did not recover original")
	}
	requestJSON(t, server.Client(), "POST", server.URL+"/api/orders/intent-lookup", "", map[string]string{"IdempotencyKey": in.IdempotencyKey}, 401, nil)
}
