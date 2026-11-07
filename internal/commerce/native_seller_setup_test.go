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

func TestNativeSellerSetupInvitationDecisionColdRecovery(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shop.json")
	s, _ := Open(path)
	_, owner := actor(t, 121)
	_, target := actor(t, 122)
	_, other := actor(t, 123)
	store, err := s.CreateStore(owner, CreateStoreInput{Name: "Original Store", Policy: "Reviewed", IdempotencyKey: "invitation-decision-store"})
	if err != nil {
		t.Fatal(err)
	}
	invite, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleSupport, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	in := NativeInvitationDecisionInput{ExpectedUpdatedAt: invite.UpdatedAt.Format(time.RFC3339Nano), ExpectedRole: invite.Role, ExpectedAccount: target, IdempotencyKey: "original-invitation-accept"}
	if _, err = s.DecideOriginalSellerInvitation(other, store.ID, invite.ID, true, in); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign actor accepted", err)
	}
	changed := in
	changed.ExpectedRole = SellerRoleAdmin
	if _, err = s.DecideOriginalSellerInvitation(target, store.ID, invite.ID, true, changed); !errors.Is(err, ErrConflict) {
		t.Fatal("unreviewed role accepted", err)
	}
	result, err := s.DecideOriginalSellerInvitation(target, store.ID, invite.ID, true, in)
	if err != nil || result.Invitation.Status != "accepted" || s.s.SellerRoles[store.ID][target] != SellerRoleSupport {
		t.Fatal(result, err)
	}
	// A subsequent local role revocation must never be undone by recovery.
	if _, _, err = s.RevokeSellerRole(owner, store.ID, target, "No longer required"); err != nil {
		t.Fatal(err)
	}
	cold, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	raw, _ := json.Marshal(in)
	route := "/seller/stores/" + store.ID + "/invitations/" + invite.ID + "/native-accept"
	recovered, _, err := cold.lookupSellerMutation(target, sellerMutationLookupInput{"POST", route, string(raw)})
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(recovered)
	if !bytes.Contains(encoded, []byte(`"QueryOnly":true`)) {
		t.Fatal(string(encoded))
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) || cold.s.SellerRoles[store.ID][target] != "" {
		t.Fatal("original query changed role or Store")
	}
	if _, _, err = cold.lookupSellerMutation(other, sellerMutationLookupInput{"POST", route, string(raw)}); err == nil {
		t.Fatal("foreign lookup admitted")
	}
	changed = in
	changed.IdempotencyKey = "unknown-original-key"
	raw, _ = json.Marshal(changed)
	if _, _, err = cold.lookupSellerMutation(target, sellerMutationLookupInput{"POST", route, string(raw)}); err == nil {
		t.Fatal("new key inferred an original result")
	}
	// Owner cancellation is a separate original, never an acceptance.
	invitation, err := cold.CreateSellerInvitation(owner, store.ID, other, SellerRoleViewer, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cancel := NativeInvitationDecisionInput{ExpectedUpdatedAt: invitation.UpdatedAt.Format(time.RFC3339Nano), ExpectedRole: invitation.Role, ExpectedAccount: other, Reason: "Invitation no longer needed", IdempotencyKey: "original-invitation-cancel"}
	if _, err = cold.DecideOriginalSellerInvitation(target, store.ID, invitation.ID, false, cancel); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("nonowner cancelled", err)
	}
	cancelled, err := cold.DecideOriginalSellerInvitation(owner, store.ID, invitation.ID, false, cancel)
	if err != nil || cancelled.Invitation.Status != "cancelled" {
		t.Fatal(cancelled, err)
	}
	if _, err = cold.DecideOriginalSellerInvitation(other, store.ID, invitation.ID, true, NativeInvitationDecisionInput{ExpectedUpdatedAt: invitation.UpdatedAt.Format(time.RFC3339Nano), ExpectedRole: invitation.Role, ExpectedAccount: other, IdempotencyKey: "accept-cancelled-invitation"}); !errors.Is(err, ErrConflict) {
		t.Fatal("cancelled invitation accepted", err)
	}
	raw, _ = json.Marshal(cancel)
	if _, _, err = cold.lookupSellerMutation(owner, sellerMutationLookupInput{"POST", "/seller/stores/" + store.ID + "/invitations/" + invitation.ID + "/native-cancel", string(raw)}); err != nil {
		t.Fatal(err)
	}
}

func TestNativeSellerSetupInvitationDecisionNormalProofFence(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 124)
	_, target := actor(t, 125)
	store, _ := s.CreateStore(owner, CreateStoreInput{Name: "Own Store", Policy: "Reviewed", IdempotencyKey: "native-decision-http-store"})
	invitation, _ := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleCatalog, time.Hour)
	input := NativeInvitationDecisionInput{ExpectedUpdatedAt: invitation.UpdatedAt.Format(time.RFC3339Nano), ExpectedRole: invitation.Role, ExpectedAccount: target, IdempotencyKey: "native-decision-http-accept"}
	raw, _ := json.Marshal(input)
	route := "/api/seller/stores/" + store.ID + "/invitations/" + invitation.ID + "/native-accept"
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: target, role: "seller"}})
	if w := businessHTTPRequest(server, "POST", route, "", string(raw)); w.Code != 401 {
		t.Fatal("no proof accepted", w.Code)
	}
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("a", 43), string(raw)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if s.s.SellerRoles[store.ID][target] != SellerRoleCatalog {
		t.Fatal("reviewed target role absent")
	}
	ownerServer := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	if w := businessHTTPRequest(ownerServer, "POST", route, strings.Repeat("b", 43), string(raw)); w.Code != 404 {
		t.Fatal("owner accepted on behalf of target", w.Code, w.Body.String())
	}
}

func TestNativeSellerSetupProfileCASOriginalRecoveryAndRollback(t *testing.T) {
	path := filepath.Join(t.TempDir(), "store.json")
	s, _ := Open(path)
	_, owner := actor(t, 126)
	_, target := actor(t, 127)
	st, e := s.CreateStore(owner, CreateStoreInput{Name: "Original", Policy: "Original policy", SettlementAccount: owner, IdempotencyKey: "native-profile-store"})
	if e != nil {
		t.Fatal(e)
	}
	in := NativeStoreProfileInput{Expected: st, Update: StoreUpdate{Name: "Reviewed replacement", Description: "Actual replacement", Policy: "Reviewed policy", TrustURL: "https://example.com/evidence", SettlementAccount: target}, IdempotencyKey: "original-profile-change"}
	// Same timestamp does not permit changed unseen fields to be overwritten.
	changed := st
	changed.Policy = "Concurrent policy"
	s.s.Stores[st.ID] = changed
	before, _ := json.Marshal(s.s)
	if _, e = s.UpdateOriginalStoreProfile(owner, st.ID, in); !errors.Is(e, ErrConflict) {
		t.Fatal("stale policy overwritten", e)
	}
	after, _ := json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("rejected CAS mutated Store")
	}
	s.s.Stores[st.ID] = st
	// A failed atomic persistence also retains the entire original and no key.
	blocker := filepath.Join(t.TempDir(), "not-dir")
	if e = os.WriteFile(blocker, []byte("block"), 0600); e != nil {
		t.Fatal(e)
	}
	s.path = filepath.Join(blocker, "store.json")
	before, _ = json.Marshal(s.s)
	if _, e = s.UpdateOriginalStoreProfile(owner, st.ID, in); e == nil {
		t.Fatal("failed persistence reported applied")
	}
	after, _ = json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("failed persistence changed profile, key or audit")
	}
	s.path = path
	out, e := s.UpdateOriginalStoreProfile(owner, st.ID, in)
	if e != nil || !out.OriginalApplied || out.Store.Name != in.Update.Name || out.Applied != in.Update {
		t.Fatal(out, e)
	}
	// A newer legitimate update may exist before original recovery; return both
	// the original applied fields and current Store without replaying the former.
	newer := StoreUpdate{Name: "Newer current", Policy: "Newer terms", SettlementAccount: owner, IdempotencyKey: "newer-independent-profile"}
	if _, e = s.UpdateStore(owner, st.ID, newer); e != nil {
		t.Fatal(e)
	}
	cold, e := Open(path)
	if e != nil {
		t.Fatal(e)
	}
	before, _ = os.ReadFile(path)
	raw, _ := json.Marshal(in)
	result, _, e := cold.lookupSellerMutation(owner, sellerMutationLookupInput{"POST", "/seller/stores/" + st.ID + "/native-profile", string(raw)})
	if e != nil {
		t.Fatal(e)
	}
	b, _ := json.Marshal(result)
	var recovered NativeStoreProfileResult
	if e = json.Unmarshal(b, &recovered); e != nil {
		t.Fatal(e)
	}
	if !recovered.QueryOnly || !recovered.OriginalApplied || recovered.Store.Name != newer.Name || recovered.Applied != in.Update {
		t.Fatal(recovered)
	}
	after, _ = os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("lookup replayed old profile")
	}
	modified := in
	modified.Update.Name = "Changed under same key"
	if _, e = cold.UpdateOriginalStoreProfile(owner, st.ID, modified); !errors.Is(e, ErrConflict) {
		t.Fatal("original key replaced", e)
	}
	if _, _, e = cold.lookupSellerMutation(target, sellerMutationLookupInput{"POST", "/seller/stores/" + st.ID + "/native-profile", string(raw)}); e == nil {
		t.Fatal("foreign profile lookup admitted")
	}
}
func TestNativeSellerSetupProfileNormalV2ProofAndOwner(t *testing.T) {
	s, _ := Open("")
	_, owner := actor(t, 128)
	_, target := actor(t, 129)
	st, _ := s.CreateStore(owner, CreateStoreInput{Name: "Original", Policy: "Owner terms", IdempotencyKey: "http-profile-store"})
	in := NativeStoreProfileInput{Expected: st, Update: StoreUpdate{Name: "Reviewed", Policy: "Reviewed terms"}, IdempotencyKey: "http-profile-original"}
	raw, _ := json.Marshal(in)
	route := "/api/seller/stores/" + st.ID + "/native-profile"
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: owner, role: "seller"}})
	if w := businessHTTPRequest(server, "POST", route, "", string(raw)); w.Code != 401 {
		t.Fatal("missing proof admitted", w.Code)
	}
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("a", 43), string(raw)); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	server = NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: target, role: "seller"}})
	if w := businessHTTPRequest(server, "POST", route, strings.Repeat("b", 43), string(raw)); w.Code != 403 {
		t.Fatal("foreign actor edited", w.Code, w.Body.String())
	}
}
