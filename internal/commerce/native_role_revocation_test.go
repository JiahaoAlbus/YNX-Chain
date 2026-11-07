package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeSellerRoleRevocationColdOriginalReadKeepsWalletPending(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shop.json")
	s, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	_, owner := actor(t, 101)
	_, member := actor(t, 102)
	_, foreign := actor(t, 103)
	store, _ := setupCatalog(t, s, owner, 1)
	acceptSellerRole(t, s, owner, store.ID, member, SellerRoleSupport)
	in := NativeSellerRoleRevocationInput{Reason: "Original member access removal", IdempotencyKey: "original-native-role-revoke"}
	result, e := s.RevokeOriginalSellerRole(owner, store.ID, member, in)
	if e != nil || !result.RoleRevoked || !result.OriginalApplied || result.QueryOnly || result.SessionInvalidation != "pending" || result.Revocation.SessionRevocationID != "" {
		t.Fatal(result, e)
	}
	if _, e = s.SellerProducts(member, store.ID); !errors.Is(e, ErrUnauthorized) {
		t.Fatal("local role was not actually retired", e)
	}
	cold, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(path)
	body, _ := json.Marshal(in)
	lookup := sellerMutationLookupInput{Method: "POST", Path: "/seller/stores/" + store.ID + "/roles/" + member + "/native-revoke", OriginalBody: string(body)}
	for i := 0; i < 2; i++ {
		v, key, e := cold.lookupSellerMutation(owner, lookup)
		if e != nil || key != in.IdempotencyKey {
			t.Fatal(v, key, e)
		}
		raw, _ := json.Marshal(v)
		var got NativeSellerRoleRevocationResult
		if json.Unmarshal(raw, &got) != nil || got.Revocation.ID != result.Revocation.ID || !got.QueryOnly || got.SessionInvalidation != "pending" {
			t.Fatal(string(raw))
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("original query mutated durable state")
	}
	again, e := cold.RevokeOriginalSellerRole(owner, store.ID, member, in)
	if e != nil || again.Revocation.ID != result.Revocation.ID {
		t.Fatal(again, e)
	}
	changed := in
	changed.Reason = "A different original reason"
	if _, e = cold.RevokeOriginalSellerRole(owner, store.ID, member, changed); !errors.Is(e, ErrConflict) {
		t.Fatal("changed body reused original key", e)
	}
	if _, _, e = cold.lookupSellerMutation(foreign, lookup); !errors.Is(e, ErrUnauthorized) {
		t.Fatal("foreign owner read original", e)
	}
	if e = cold.SetSellerRole(owner, store.ID, member, SellerRoleViewer); !errors.Is(e, ErrConflict) {
		t.Fatal("pending Wallet invalidation permitted regrant", e)
	}
}
func TestNativeSellerRoleRevocationPersistenceFailureRollsBackOriginal(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 104)
	_, member := actor(t, 105)
	store, _ := setupCatalog(t, s, owner, 1)
	acceptSellerRole(t, s, owner, store.ID, member, SellerRoleSupport)
	before, _ := json.Marshal(s.s)
	s.path = t.TempDir()
	_, e := s.RevokeOriginalSellerRole(owner, store.ID, member, NativeSellerRoleRevocationInput{Reason: "Original failed persistence", IdempotencyKey: "original-role-write-fail"})
	if e == nil {
		t.Fatal("expected persistent directory target failure")
	}
	after, _ := json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("failed persist changed roles, original key, audit or revocation")
	}
}
func TestNativeSellerRoleRevocationNormalRouteRequiresExistingV2Owner(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 106)
	_, member := actor(t, 107)
	_, outsider := actor(t, 108)
	store, _ := setupCatalog(t, s, owner, 1)
	acceptSellerRole(t, s, owner, store.ID, member, SellerRoleSupport)
	path := "/api/seller/stores/" + store.ID + "/roles/" + member + "/native-revoke"
	in := NativeSellerRoleRevocationInput{Reason: "Normal original owner action", IdempotencyKey: "normal-original-role-revoke"}
	body, _ := json.Marshal(in)
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	if w := businessHTTPRequest(server, "POST", path, "", string(body)); w.Code != 401 {
		t.Fatal("missing proof fell back", w.Code, w.Body.String())
	}
	foreign := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: outsider, role: "seller"}})
	if w := businessHTTPRequest(foreign, "POST", path, strings.Repeat("f", 43), string(body)); w.Code < 400 {
		t.Fatal("foreign Seller revoked", w.Body.String())
	}
	w := businessHTTPRequest(server, "POST", path, strings.Repeat("n", 43), string(body))
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"SessionInvalidation":"pending"`)) {
		t.Fatal(w.Code, w.Body.String())
	}
	lookup, _ := json.Marshal(sellerMutationLookupInput{Method: "POST", Path: strings.TrimPrefix(path, "/api"), OriginalBody: string(body)})
	w = businessHTTPRequest(server, "POST", "/api/seller/mutations/lookup", strings.Repeat("q", 43), string(lookup))
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"QueryOnly":true`)) {
		t.Fatal(w.Code, w.Body.String())
	}
}
