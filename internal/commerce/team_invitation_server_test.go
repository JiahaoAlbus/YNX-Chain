package commerce

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPSellerTeamInvitationIsWalletAccountBoundAndReplaySafe(t *testing.T) {
	store, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 119)
	_, target := actor(t, 120)
	_, outsider := actor(t, 121)
	_, cancelledTarget := actor(t, 122)
	merchant, _ := setupCatalog(t, store, owner, 1)
	auth := &revocationTestAuth{principals: map[string]Principal{
		"owner-invite-token-12345":   sellerPrincipal(owner),
		"target-invite-token-1234":   sellerPrincipal(target),
		"outsider-invite-token-123":  sellerPrincipal(outsider),
		"cancelled-invite-token-123": sellerPrincipal(cancelledTarget),
	}}
	server := httptest.NewServer(NewServer(store, ServerConfig{Auth: auth}).Handler())
	defer server.Close()

	var created struct {
		Status     string
		Invitation SellerInvitation
	}
	requestJSON(t, server.Client(), http.MethodPut, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", "owner-invite-token-12345", map[string]any{"Account": target, "Role": "catalog"}, http.StatusConflict, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations", "owner-invite-token-12345", map[string]any{"Account": target, "Role": "catalog", "ExpiresInMinutes": 14}, http.StatusBadRequest, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations", "owner-invite-token-12345", map[string]any{"Account": target, "Role": "catalog", "ExpiresInMinutes": 10081}, http.StatusBadRequest, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations", "outsider-invite-token-123", map[string]any{"Account": target, "Role": "catalog", "ExpiresInMinutes": 60}, http.StatusForbidden, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations", "owner-invite-token-12345", map[string]any{"Account": target, "Role": "catalog", "ExpiresInMinutes": 60}, http.StatusCreated, &created)
	if created.Status != sellerInvitationPending || created.Invitation.ID == "" || created.Invitation.Account != target || created.Invitation.StoreID != merchant.ID || created.Invitation.Role != SellerRoleCatalog {
		t.Fatalf("created invitation response invalid: %+v", created)
	}

	var own struct{ Invitations []SellerInvitation }
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/seller/invitations", "target-invite-token-1234", nil, http.StatusOK, &own)
	if len(own.Invitations) != 1 || own.Invitations[0].ID != created.Invitation.ID || own.Invitations[0].Status != sellerInvitationPending {
		t.Fatalf("target invitation list invalid: %+v", own)
	}
	var outsiderOwn struct{ Invitations []SellerInvitation }
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/seller/invitations", "outsider-invite-token-123", nil, http.StatusOK, &outsiderOwn)
	if len(outsiderOwn.Invitations) != 0 {
		t.Fatalf("outsider saw another account invitation: %+v", outsiderOwn)
	}

	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/invitations/"+created.Invitation.ID+"/accept", "outsider-invite-token-123", map[string]any{}, http.StatusNotFound, nil)
	var accepted struct {
		Status     string
		StoreID    string
		Role       string
		Invitation SellerInvitation
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/invitations/"+created.Invitation.ID+"/accept", "target-invite-token-1234", map[string]any{}, http.StatusOK, &accepted)
	if accepted.Status != sellerInvitationAccepted || accepted.StoreID != merchant.ID || accepted.Role != SellerRoleCatalog || accepted.Invitation.AcceptedAt.IsZero() {
		t.Fatalf("accepted invitation response invalid: %+v", accepted)
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/invitations/"+created.Invitation.ID+"/accept", "target-invite-token-1234", map[string]any{}, http.StatusConflict, nil)
	requestJSON(t, server.Client(), http.MethodPut, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", "owner-invite-token-12345", map[string]any{"Account": target, "Role": "inventory"}, http.StatusOK, nil)

	var team struct {
		Roles       map[string]string
		Invitations []SellerInvitation
		ActorRole   string
	}
	requestJSON(t, server.Client(), http.MethodGet, server.URL+"/api/seller/stores/"+merchant.ID+"/roles", "owner-invite-token-12345", nil, http.StatusOK, &team)
	if team.Roles[target] != SellerRoleInventory || team.ActorRole != SellerRoleOwner || len(team.Invitations) != 1 || team.Invitations[0].Status != sellerInvitationAccepted {
		t.Fatalf("owner team view did not reflect accepted invite: %+v", team)
	}

	var second struct {
		Invitation SellerInvitation
	}
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations", "owner-invite-token-12345", map[string]any{"Account": cancelledTarget, "Role": "support", "ExpiresInMinutes": 60}, http.StatusCreated, &second)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations/"+second.Invitation.ID+"/cancel", "outsider-invite-token-123", map[string]any{"Reason": "Unauthorized cancellation request"}, http.StatusForbidden, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/stores/"+merchant.ID+"/invitations/"+second.Invitation.ID+"/cancel", "owner-invite-token-12345", map[string]any{"Reason": "Support access no longer required"}, http.StatusOK, nil)
	requestJSON(t, server.Client(), http.MethodPost, server.URL+"/api/seller/invitations/"+second.Invitation.ID+"/accept", "cancelled-invite-token-123", map[string]any{}, http.StatusConflict, nil)
}
