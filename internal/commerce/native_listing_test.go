package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"
)

func nativeListingInputFor(p Product) NativeListingInput {
	in := NativeListingInput{StoreID: p.StoreID, ExpectedRevision: strconv.FormatInt(p.Revision, 10), Title: p.Title, Description: p.Description, Category: p.Category, Media: append([]MediaAsset{}, p.Media...)}
	for _, v := range p.Variants {
		in.Variants = append(in.Variants, NativeListingVariantInput{v.ID, v.Name, v.SKU, strconv.FormatInt(v.PriceYNXT, 10), strconv.FormatInt(v.Inventory, 10), nil, false})
	}
	return in
}

func TestNativeListingLegacyBytesExactStoreAndIntegerBoundary(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 231)
	_, outsider := actor(t, 232)
	_, p := setupCatalog(t, s, owner, 4)
	legacy := listingInput(p, "PUBLIC-old-key")
	old := struct {
		ExpectedRevision string
		Product          UpdateProductInput
	}{legacy.ExpectedRevision, legacy.Product}
	a, _ := json.Marshal(legacy)
	b, _ := json.Marshal(old)
	if !bytes.Equal(a, b) {
		t.Fatal("old omitted-Store semantic bytes changed")
	}
	in := nativeListingInputFor(p)
	in.IdempotencyKey = "PUBLIC-native-listing"
	in.Variants[0].PriceYNXT = strconv.FormatInt(math.MaxInt64, 10)
	in.Variants[0].Inventory = strconv.FormatInt(math.MaxInt64, 10)
	converted, err := nativeListingOriginal(in)
	if err != nil {
		t.Fatal(err)
	}
	wrong := converted
	wrong.ExpectedStoreID = "other-store"
	before := requestHash(s.s)
	if _, err = s.PublishListing(owner, p.ID, wrong); err == nil {
		t.Fatal("wrong Store published")
	}
	if requestHash(s.s) != before {
		t.Fatal("wrong Store changed original")
	}
	if _, err = s.PublishListing(outsider, p.ID, converted); err == nil {
		t.Fatal("outsider published")
	}
	if requestHash(s.s) != before {
		t.Fatal("outsider changed original")
	}
	result, err := s.PublishListing(owner, p.ID, converted)
	if err != nil {
		t.Fatal(err)
	}
	view := nativeListingView(result, true, false)
	if view.Product.Variants[0].PriceYNXT != in.Variants[0].PriceYNXT || view.Product.Variants[0].Inventory != in.Variants[0].Inventory {
		t.Fatal("native integer changed")
	}
	// Two original product revisions are needed for update+publication.
	exhausted := s.s.Products[p.ID]
	exhausted.Revision = math.MaxInt64 - 1
	s.s.Products[p.ID] = exhausted
	overflow := in
	overflow.ExpectedRevision = strconv.FormatInt(exhausted.Revision, 10)
	overflow.IdempotencyKey = "PUBLIC-exhausted-revision"
	bound, err := nativeListingOriginal(overflow)
	if err != nil {
		t.Fatal(err)
	}
	before = requestHash(s.s)
	if _, err = s.PublishListing(owner, p.ID, bound); err == nil {
		t.Fatal("listing wrapped two-step revision")
	}
	if requestHash(s.s) != before {
		t.Fatal("exhausted revision mutated original")
	}
	if _, err = s.PublishListing(owner, p.ID, converted); err != nil {
		t.Fatal("completed original replay rejected at exhausted current revision", err)
	}
	for _, bad := range []string{"-1", "01", "1.5", "9223372036854775808"} {
		input := in
		input.Variants = append([]NativeListingVariantInput(nil), in.Variants...)
		input.Variants[0].PriceYNXT = bad
		if _, err := nativeListingOriginal(input); err == nil {
			t.Fatal("bad native price accepted", bad)
		}
	}
}

func TestNativeListingCLIActualHTTPColdOriginalPublishRecovery(t *testing.T) {
	fixture := os.Getenv("YNX_SHOP_LISTING_CLI_FIXTURE")
	if fixture == "" {
		t.Skip("explicit official SDK-bundled Native listing fixture required")
	}
	s, err := Open(filepath.Join(t.TempDir(), "original-shop.json"))
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 231)
	_, buyer := actor(t, 232)
	st, p := setupCatalog(t, s, owner, 4)
	original, err := s.CreateOrder(buyer, orderInput(st, p, "PUBLIC-before-native-listing-order"))
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.Product(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	beforeOrder := requestHash(original)
	in := nativeListingInputFor(p)
	in.Title = "PUBLIC original native listing"
	in.Variants[0].PriceYNXT = strconv.FormatInt(math.MaxInt64, 10)
	journal := filepath.Join(t.TempDir(), "PUBLIC-listing-identities.json")
	storePath := s.path
	if root := os.Getenv("YNX_SHOP_LISTING_EVIDENCE_DIR"); root != "" {
		if !filepath.IsAbs(root) {
			t.Fatal("absolute PUBLIC evidence root required")
		}
		if err := os.MkdirAll(root, 0700); err != nil {
			t.Fatal(err)
		}
		evidence, err := os.MkdirTemp(root, "PUBLIC-listing-case-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			for name, path := range map[string]string{"original-shop.json": storePath, "original-identities.json": journal} {
				data, err := os.ReadFile(path)
				if err == nil {
					if err = os.WriteFile(filepath.Join(evidence, name), data, 0600); err != nil {
						t.Error(err)
					}
				}
			}
			t.Log("retained PUBLIC listing evidence", evidence)
		})
	}
	drive := func(command string, body any) map[string]json.RawMessage {
		t.Helper()
		server := httptest.NewServer(NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}}).Handler())
		defer server.Close()
		wire, _ := json.Marshal(map[string]any{"command": command, "productID": p.ID, "body": body, "actor": owner, "journal": journal, "origin": server.URL})
		ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "node", fixture)
		cmd.Stdin = bytes.NewReader(wire)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatal(command, err, string(out))
		}
		var result map[string]json.RawMessage
		if json.Unmarshal(out, &result) != nil {
			t.Fatal(string(out))
		}
		return result
	}
	// Explicit wire DTO: no duplicate top-level key or nested legacy numeric body.
	body := map[string]any{"StoreID": in.StoreID, "ExpectedRevision": in.ExpectedRevision, "Title": in.Title, "Description": in.Description, "Category": in.Category, "Media": in.Media, "Variants": in.Variants}
	first := drive("inspect", map[string]string{"StoreID": st.ID})
	if string(first["reads"]) != "1" || string(first["writes"]) != "0" {
		t.Fatal(string(first["result"]))
	}
	unknown := drive("publish", body)
	if string(unknown["unknown"]) != "true" || string(unknown["writes"]) != "1" {
		t.Fatal(unknown)
	}
	saved, err := os.ReadFile(journal)
	if err != nil {
		t.Fatal(err)
	}
	published := s.s.Products[p.ID]
	if !published.Published || published.Title != in.Title || published.Variants[0].PriceYNXT != math.MaxInt64 || published.Variants[0].Reserved != p.Variants[0].Reserved {
		t.Fatal("actual native listing not applied atomically", published)
	}
	s, err = Open(storePath)
	if err != nil {
		t.Fatal(err)
	}
	// Another legitimate publication then unpublish cannot be undone by recovery.
	later := listingInput(s.s.Products[p.ID], "PUBLIC-later-actual-listing")
	later.Product.Title = "PUBLIC later legitimate title"
	if _, err = s.PublishListing(owner, p.ID, later); err != nil {
		t.Fatal(err)
	}
	if _, err = s.UnpublishProduct(owner, p.ID); err != nil {
		t.Fatal(err)
	}
	after := requestHash(s.s.Products[p.ID])
	recovered := drive("recover", body)
	if string(recovered["writes"]) != "0" || string(recovered["lookups"]) != "1" || string(recovered["reads"]) != "0" {
		t.Fatal(recovered)
	}
	if requestHash(s.s.Products[p.ID]) != after || requestHash(s.s.Orders[original.ID]) != beforeOrder {
		t.Fatal("original readback changed listing or old frozen order")
	}
	var readback NativeListingResult
	if json.Unmarshal(recovered["result"], &readback) != nil || !readback.OriginalApplied {
		t.Fatal("original Native listing result missing", string(recovered["result"]))
	}
	if readback.Product.Published || readback.Product.Title != later.Product.Title || readback.Product.Variants[0].PriceYNXT != strconv.FormatInt(math.MaxInt64, 10) {
		t.Fatal("recovery replaced current DATA", readback)
	}
	if final, err := os.ReadFile(journal); err != nil || reflect.DeepEqual(final, saved) || strings.Contains(string(final), `"phase":"unknown"`) {
		t.Fatal("original opaque recovery not confirmed", err)
	}
	if _, err = Open(storePath); err != nil {
		t.Fatal(err)
	}
}
