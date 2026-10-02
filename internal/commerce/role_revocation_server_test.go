package commerce

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type revocationTestAuth struct {
	principals map[string]Principal
	request    ProductAuthorizationRevocationRequest
	receipt    ProductAuthorizationRevocationReceipt
	err        error
}

func (a *revocationTestAuth) Available() bool { return true }
func (a *revocationTestAuth) Verify(_ context.Context, token string) (Principal, error) {
	principal, ok := a.principals[token]
	if !ok {
		return Principal{}, ErrUnauthorized
	}
	return principal, nil
}
func (a *revocationTestAuth) Begin(context.Context, json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("not used")
}
func (a *revocationTestAuth) Complete(context.Context, json.RawMessage) (json.RawMessage, error) {
	return nil, errors.New("not used")
}
func (a *revocationTestAuth) RevokeProductAuthorization(_ context.Context, request ProductAuthorizationRevocationRequest) (ProductAuthorizationRevocationReceipt, error) {
	a.request = request
	return a.receipt, a.err
}

func sellerPrincipal(account string) Principal {
	binding := SellerBinding()
	return Principal{Account: account, Role: binding.Role, ProductClientID: binding.ProductClientID, BundleID: binding.BundleID, SessionBinding: strings.Repeat("a", 64), Scopes: binding.Scopes, ExpiresAt: time.Now().UTC().Add(time.Hour)}
}

func TestHTTPRoleRevocationConfirmsCentralSessionInvalidation(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 101)
	_, member := actor(t, 102)
	merchant, _ := setupCatalog(t, store, owner, 1)
	acceptSellerRole(t, store, owner, merchant.ID, member, SellerRoleSupport)
	auth := &revocationTestAuth{
		principals: map[string]Principal{"owner-revoke-token-123456": sellerPrincipal(owner), "member-revoke-token-12345": sellerPrincipal(member)},
		receipt:    ProductAuthorizationRevocationReceipt{Revoked: true, RevocationID: "wallet-revoke-http-001", Account: member, ProductClientID: SellerClientID, BundleID: SellerBundleID, ResourceType: "seller_store", ResourceID: merchant.ID, SessionCount: 3, RevokedAt: time.Now().UTC()},
	}
	server := httptest.NewServer(NewServer(store, ServerConfig{Auth: auth}).Handler())
	defer server.Close()

	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/roles/"+member+"/revoke", "member-revoke-token-12345", map[string]any{"Reason": "Member access removed"}, http.StatusForbidden, nil)
	var response struct {
		RoleRevoked         bool
		SessionInvalidation string
		Revocation          SellerRoleRevocation
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/roles/"+member+"/revoke", "owner-revoke-token-123456", map[string]any{"Reason": "Member access removed"}, http.StatusOK, &response)
	if !response.RoleRevoked || response.SessionInvalidation != "confirmed" || response.Revocation.SessionStatus != "confirmed" || response.Revocation.SessionCount != 3 {
		t.Fatalf("confirmed revoke response invalid: %+v", response)
	}
	if auth.request.Account != member || auth.request.ProductClientID != SellerClientID || auth.request.BundleID != SellerBundleID || auth.request.ResourceType != "seller_store" || auth.request.ResourceID != merchant.ID || auth.request.RequestID != response.Revocation.ID {
		t.Fatalf("central revoke request binding invalid: %+v", auth.request)
	}
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", "member-revoke-token-12345", nil, http.StatusForbidden, nil)
	var independentStore StoreProfile
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores", "member-revoke-token-12345", CreateStoreInput{Name: "Independent Store", Policy: "Independent owner policy", IdempotencyKey: "member-independent-store-001"}, http.StatusCreated, &independentStore)
	if independentStore.ID == "" || independentStore.Owner != member {
		t.Fatalf("store-scoped revocation blocked unrelated Seller authority: %+v", independentStore)
	}
	var regrant struct {
		Invitation SellerInvitation
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations", "owner-revoke-token-123456", map[string]any{"Account": member, "Role": "viewer", "ExpiresInMinutes": 60}, http.StatusCreated, &regrant)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/invitations/"+regrant.Invitation.ID+"/accept", "member-revoke-token-12345", map[string]any{}, http.StatusOK, nil)
}

func TestHTTPRoleRevocationReportsUnavailableAndBlocksRegrant(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 103)
	_, member := actor(t, 104)
	merchant, _ := setupCatalog(t, store, owner, 1)
	acceptSellerRole(t, store, owner, merchant.ID, member, SellerRoleFinance)
	auth := testAuth{principals: map[string]Principal{"owner-unavailable-token-1": sellerPrincipal(owner), "member-unavailable-token": sellerPrincipal(member)}}
	server := httptest.NewServer(NewServer(store, ServerConfig{Auth: auth}).Handler())
	defer server.Close()

	var response struct {
		RoleRevoked         bool
		SessionInvalidation string
		Revocation          SellerRoleRevocation
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/roles/"+member+"/revoke", "owner-unavailable-token-1", map[string]any{"Reason": "Finance access removed"}, http.StatusAccepted, &response)
	if !response.RoleRevoked || response.SessionInvalidation != "unavailable" || response.Revocation.SessionStatus != "unavailable" || response.Revocation.LastError == "" {
		t.Fatalf("unavailable revoke response invalid: %+v", response)
	}
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/seller/settlements", "member-unavailable-token", nil, http.StatusForbidden, nil)
	if settlements, err := store.Settlements(member); !errors.Is(err, ErrUnauthorized) || len(settlements) != 0 {
		t.Fatalf("revoked finance member did not fail closed: settlements=%+v err=%v", settlements, err)
	}
	requestJSON(t, server.Client(), http.MethodPut, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", "owner-unavailable-token-1", map[string]any{"Account": member, "Role": "viewer"}, http.StatusConflict, nil)
}

func TestHTTPRoleRevocationRejectsMismatchedCentralReceipt(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 105)
	_, member := actor(t, 106)
	_, wrongAccount := actor(t, 107)
	merchant, _ := setupCatalog(t, store, owner, 1)
	acceptSellerRole(t, store, owner, merchant.ID, member, SellerRoleCatalog)
	auth := &revocationTestAuth{
		principals: map[string]Principal{"owner-mismatch-token-123": sellerPrincipal(owner)},
		receipt: ProductAuthorizationRevocationReceipt{
			Revoked: true, RevocationID: "wallet-revoke-wrong-001", Account: wrongAccount,
			ProductClientID: SellerClientID, BundleID: SellerBundleID, ResourceType: "seller_store",
			ResourceID: merchant.ID, SessionCount: 1, RevokedAt: time.Now().UTC(),
		},
	}
	server := httptest.NewServer(NewServer(store, ServerConfig{Auth: auth}).Handler())
	defer server.Close()

	var response struct {
		RoleRevoked         bool
		SessionInvalidation string
		Revocation          SellerRoleRevocation
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/roles/"+member+"/revoke", "owner-mismatch-token-123", map[string]any{"Reason": "Catalog access removed"}, http.StatusAccepted, &response)
	if !response.RoleRevoked || response.SessionInvalidation != "unavailable" || response.Revocation.SessionStatus != "unavailable" || response.Revocation.SessionRevocationID != "" {
		t.Fatalf("mismatched receipt was not rejected fail closed: %+v", response)
	}
	requestJSON(t, server.Client(), http.MethodPut, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", "owner-mismatch-token-123", map[string]any{"Account": member, "Role": "viewer"}, http.StatusConflict, nil)
}
