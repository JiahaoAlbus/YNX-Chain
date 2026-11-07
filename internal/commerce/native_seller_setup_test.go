package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNativeSellerSetupOriginalActivationAndInvitationAreColdQueryOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shop.json")
	s, _ := Open(path)
	_, owner := actor(t, 109)
	_, target := actor(t, 110)
	store, e := s.CreateStore(owner, CreateStoreInput{Name: "Original Native Store", Policy: "Original owner policy", SettlementAccount: owner, IdempotencyKey: "original-native-store-create"})
	if e != nil {
		t.Fatal(e)
	}
	activation := NativeStoreActivationInput{ExpectedUpdatedAt: store.UpdatedAt.Format(time.RFC3339Nano), ExpectedPolicy: store.Policy, ExpectedSettlementAccount: store.SettlementAccount, IdempotencyKey: "original-store-activation"}
	active, e := s.ActivateOriginalStore(owner, store.ID, activation)
	if e != nil || !active.OriginalApplied || active.QueryOnly || active.Store.Status != "active" {
		t.Fatal(active, e)
	}
	in := NativeSellerInvitationInput{Account: target, Role: SellerRoleSupport, TTLSeconds: "900", IdempotencyKey: "original-native-invitation"}
	invitation, e := s.CreateOriginalSellerInvitation(owner, store.ID, in)
	if e != nil || invitation.Invitation.Status != "pending" || !invitation.OriginalApplied || invitation.QueryOnly {
		t.Fatal(invitation, e)
	}
	if _, ok := s.s.SellerRoles[store.ID][target]; ok {
		t.Fatal("pending invitation granted a role without target acceptance")
	}
	cold, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	before, _ := os.ReadFile(path)
	for _, entry := range []struct {
		path  string
		input any
		kind  string
	}{{"/seller/stores/" + store.ID + "/native-activate", activation, "Store"}, {"/seller/stores/" + store.ID + "/native-invitations", in, "Invitation"}} {
		body, _ := json.Marshal(entry.input)
		result, _, e := cold.lookupSellerMutation(owner, sellerMutationLookupInput{Method: "POST", Path: entry.path, OriginalBody: string(body)})
		if e != nil {
			t.Fatal(e)
		}
		raw, _ := json.Marshal(result)
		if !bytes.Contains(raw, []byte(`"QueryOnly":true`)) || !bytes.Contains(raw, []byte(entry.kind)) {
			t.Fatal(string(raw))
		}
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("original setup lookup mutated stored state")
	}
	repeat, e := cold.CreateOriginalSellerInvitation(owner, store.ID, in)
	if e != nil || repeat.Invitation.ID != invitation.Invitation.ID {
		t.Fatal(repeat, e)
	}
	changed := in
	changed.Role = SellerRoleAdmin
	if _, e = cold.CreateOriginalSellerInvitation(owner, store.ID, changed); !errors.Is(e, ErrConflict) {
		t.Fatal("changed invitation replaced an original key", e)
	}
	if _, e = cold.CreateOriginalSellerInvitation(target, store.ID, in); !errors.Is(e, ErrUnauthorized) {
		t.Fatal("target or foreign actor created owner invitation", e)
	}
}
func TestNativeSellerSetupActivationRejectsChangedTermsAtSameTimestamp(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 111)
	store, _ := s.CreateStore(owner, CreateStoreInput{Name: "Own Store", Policy: "Reviewed original policy", SettlementAccount: owner, IdempotencyKey: "original-policy-store"})
	in := NativeStoreActivationInput{ExpectedUpdatedAt: store.UpdatedAt.Format(time.RFC3339Nano), ExpectedPolicy: store.Policy, ExpectedSettlementAccount: store.SettlementAccount, IdempotencyKey: "reviewed-original-activation"}
	for _, field := range []string{"policy", "settlement"} {
		t.Run(field, func(t *testing.T) {
			changed := store
			if field == "policy" {
				changed.Policy = "Different unreviewed terms"
			} else {
				_, changed.SettlementAccount = actor(t, 112)
			}
			s.s.Stores[store.ID] = changed
			before, _ := json.Marshal(s.s)
			if _, e := s.ActivateOriginalStore(owner, store.ID, in); !errors.Is(e, ErrConflict) {
				t.Fatal("same timestamp silently activated changed terms", e)
			}
			after, _ := json.Marshal(s.s)
			if !bytes.Equal(before, after) {
				t.Fatal("conflict mutated store, audit or original key")
			}
		})
	}
}
func TestNativeSellerSetupNormalV2RoutesRequireOwnerAndKeepInvitePending(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 113)
	_, member := actor(t, 114)
	store, _ := s.CreateStore(owner, CreateStoreInput{Name: "Native Owner Store", Policy: "Reviewed terms", SettlementAccount: owner, IdempotencyKey: "http-native-setup-store"})
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	inputs := []struct {
		path  string
		input any
	}{{"/api/seller/stores/" + store.ID + "/native-activate", NativeStoreActivationInput{ExpectedUpdatedAt: store.UpdatedAt.Format(time.RFC3339Nano), ExpectedPolicy: store.Policy, ExpectedSettlementAccount: store.SettlementAccount, IdempotencyKey: "http-original-activation"}}, {"/api/seller/stores/" + store.ID + "/native-invitations", NativeSellerInvitationInput{Account: member, Role: SellerRoleViewer, TTLSeconds: "900", IdempotencyKey: "http-original-invitation"}}}
	for i, in := range inputs {
		body, _ := json.Marshal(in.input)
		if w := businessHTTPRequest(server, "POST", in.path, "", string(body)); w.Code != 401 {
			t.Fatal("no proof accepted", w.Code)
		}
		w := businessHTTPRequest(server, "POST", in.path, strings.Repeat(string(rune('a'+i)), 43), string(body))
		if w.Code != 200 && w.Code != 201 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if _, ok := s.s.SellerRoles[store.ID][member]; ok {
		t.Fatal("HTTP invitation manufactured membership")
	}
}
