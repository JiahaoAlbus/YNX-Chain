package commerce

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
)

func listingInput(p Product, key string) PublishListingInput {
	return PublishListingInput{ExpectedRevision: strconv.FormatInt(p.Revision, 10), Product: UpdateProductInput{Title: p.Title, Description: p.Description, Category: p.Category, Media: p.Media, Variants: append([]Variant(nil), p.Variants...), IdempotencyKey: key}}
}

func TestP0701ListingCASPreservesReservedOrderAndRecoversOriginalOperation(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 231)
	_, buyer := actor(t, 232)
	store, p := setupCatalog(t, s, owner, 4)
	stale := listingInput(p, "listing-old-snapshot")
	first, err := s.CreateOrder(buyer, orderInput(store, p, "listing-original-order"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishListing(owner, p.ID, stale); !errors.Is(err, ErrConflict) {
		t.Fatal("reservation did not invalidate stock revision", err)
	}
	p, err = s.Product(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	in := listingInput(p, "listing-new-price")
	in.Product.Variants[0].PriceYNXT = 99
	body, _ := json.Marshal(in)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	w := businessHTTPRequest(server, "POST", "/api/seller/products/"+p.ID+"/listing", strings.Repeat("s", 43), string(body))
	var result Product
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil {
		t.Fatal(w.Code, w.Body.String())
	}
	if !result.Published || result.Variants[0].Reserved != 1 {
		t.Fatal("listing lost reservation", result)
	}
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.PublishListing(owner, p.ID, in); err != nil || !reflect.DeepEqual(before, s.s) {
		t.Fatal("original retry wrote a second listing", err)
	}
	second, err := s.CreateOrder(buyer, orderInput(store, result, "listing-new-order"))
	if err != nil {
		t.Fatal(err)
	}
	old, err := s.Order(buyer, "buyer", first.ID)
	if err != nil || old.TotalYNXT != 25 || second.TotalYNXT != 99 {
		t.Fatal("price edit changed existing order", old.TotalYNXT, second.TotalYNXT, err)
	}
	body, _ = json.Marshal(in)
	if _, _, err = s.lookupSellerMutation(owner, sellerMutationLookupInput{Method: "POST", Path: "/seller/products/" + p.ID + "/listing", OriginalBody: string(body)}); err != nil {
		t.Fatal("original operation unavailable for recovery", err)
	}
	_, foreign := actor(t, 233)
	if _, err = s.PublishListing(foreign, p.ID, in); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("foreign seller reused original operation", err)
	}
}

func TestP0701ListingPublicationAndDiskFailuresAreAtomic(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 234)
	_, p := setupCatalog(t, s, owner, 4)
	before, err := cloneSnapshot(s.s)
	if err != nil {
		t.Fatal(err)
	}
	in := listingInput(p, "listing-invalid-image")
	in.Product.Media = nil
	in.Product.Title = "must not leak draft"
	if _, err = s.PublishListing(owner, p.ID, in); err == nil || !reflect.DeepEqual(s.s, before) {
		t.Fatal("publication failure left partial draft", err)
	}
	in = listingInput(p, "listing-disk-recovery")
	in.Product.Title = "new listing title"
	path := s.path
	blocked := filepath.Join(t.TempDir(), "blocked")
	if err = os.WriteFile(blocked, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	s.path = filepath.Join(blocked, "state.json")
	if _, err = s.PublishListing(owner, p.ID, in); err == nil || !reflect.DeepEqual(s.s, before) {
		t.Fatal("disk failure left listing or idempotency", err)
	}
	s.path = path
	if _, err = s.PublishListing(owner, p.ID, in); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := reopened.Product(p.ID)
	if err != nil || got.Title != in.Product.Title || !got.Published {
		t.Fatal(got, err)
	}
}

func TestP0701ConcurrentListingRevisionHasOneWinner(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 235)
	_, p := setupCatalog(t, s, owner, 4)
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, key := range []string{"listing-concurrent-a", "listing-concurrent-b"} {
		in := listingInput(p, key)
		in.Product.Title = key
		wg.Add(1)
		go func() { defer wg.Done(); _, err := s.PublishListing(owner, p.ID, in); results <- err }()
	}
	wg.Wait()
	close(results)
	winners, conflicts := 0, 0
	for err := range results {
		if err == nil {
			winners++
		} else if errors.Is(err, ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if winners != 1 || conflicts != 1 {
		t.Fatal(winners, conflicts)
	}
}
