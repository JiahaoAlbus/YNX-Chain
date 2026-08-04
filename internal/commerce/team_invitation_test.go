package commerce

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSellerRoleUpdateRequiresAcceptedMembership(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 123)
	_, target := actor(t, 124)
	store, _ := setupCatalog(t, s, owner, 1)
	if err := s.SetSellerRole(owner, store.ID, target, SellerRoleCatalog); !errors.Is(err, ErrConflict) {
		t.Fatalf("direct first-time role assignment bypassed invitation acceptance: %v", err)
	}
	acceptSellerRole(t, s, owner, store.ID, target, SellerRoleCatalog)
	if err := s.SetSellerRole(owner, store.ID, target, SellerRoleInventory); err != nil {
		t.Fatalf("existing member role update failed: %v", err)
	}
	roles, err := s.SellerRoles(owner, store.ID)
	if err != nil || roles[target] != SellerRoleInventory {
		t.Fatalf("existing member role update was not persisted: roles=%v err=%v", roles, err)
	}
	events, err := s.SellerIntegrationEvents(owner, store.ID)
	if err != nil {
		t.Fatal(err)
	}
	seenUpdate := false
	for _, event := range events {
		if event.EventName == "ynx.seller.role.updated.v1" {
			seenUpdate = event.Account == target && event.Actor == owner && event.PreviousRole == SellerRoleCatalog && event.Role == SellerRoleInventory && event.Status == "updated" && event.SchemaVersion == 1 && !event.OccurredAt.IsZero()
		}
	}
	if !seenUpdate {
		t.Fatalf("role update event binding missing: %+v", events)
	}
}

func TestSellerTeamInvitationLifecycleIsAccountBoundAndOneTime(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.July, 27, 15, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	_, owner := actor(t, 110)
	_, target := actor(t, 111)
	_, outsider := actor(t, 112)
	_, cancelledTarget := actor(t, 113)
	store, _ := setupCatalog(t, s, owner, 1)

	if _, err := s.CreateSellerInvitation(outsider, store.ID, target, SellerRoleCatalog, time.Hour); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("non-owner created invitation: %v", err)
	}
	if _, err := s.CreateSellerInvitation(owner, store.ID, owner, SellerRoleCatalog, time.Hour); err == nil {
		t.Fatal("owner self invitation accepted")
	}
	if _, err := s.CreateSellerInvitation(owner, store.ID, target, "manager", time.Hour); err == nil {
		t.Fatal("legacy invitation role accepted")
	}
	if _, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleCatalog, 5*time.Minute); err == nil {
		t.Fatal("short-lived invitation accepted")
	}

	invitation, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleCatalog, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if invitation.Status != sellerInvitationPending || invitation.Account != target || invitation.Role != SellerRoleCatalog || invitation.CreatedBy != owner || invitation.ExpiresAt.Sub(invitation.CreatedAt) != 24*time.Hour {
		t.Fatalf("invitation binding invalid: %+v", invitation)
	}
	if _, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleInventory, time.Hour); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate active invitation accepted: %v", err)
	}
	mine := s.SellerInvitationsForAccount(target)
	if len(mine) != 1 || mine[0].ID != invitation.ID || mine[0].Status != sellerInvitationPending {
		t.Fatalf("target invitation listing invalid: %+v", mine)
	}
	if _, err := s.AcceptSellerInvitation(outsider, invitation.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong account learned or accepted invitation: %v", err)
	}
	if _, ok := s.s.SellerRoles[store.ID][outsider]; ok {
		t.Fatal("wrong account received Seller role")
	}

	accepted, err := s.AcceptSellerInvitation(target, invitation.ID)
	if err != nil {
		t.Fatal(err)
	}
	if accepted.Status != sellerInvitationAccepted || accepted.AcceptedAt.IsZero() || accepted.Role != SellerRoleCatalog {
		t.Fatalf("accepted invitation invalid: %+v", accepted)
	}
	roles, err := s.SellerRoles(owner, store.ID)
	if err != nil || roles[target] != SellerRoleCatalog {
		t.Fatalf("invitation did not assign bound role: roles=%v err=%v", roles, err)
	}
	if _, err := s.AcceptSellerInvitation(target, invitation.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("replayed acceptance succeeded: %v", err)
	}

	cancelled, err := s.CreateSellerInvitation(owner, store.ID, cancelledTarget, SellerRoleSupport, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cancelled, err = s.CancelSellerInvitation(owner, store.ID, cancelled.ID, "Support access no longer required")
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != sellerInvitationCancelled || cancelled.CancelledAt.IsZero() || cancelled.Reason == "" {
		t.Fatalf("cancelled invitation invalid: %+v", cancelled)
	}
	if _, err := s.CancelSellerInvitation(owner, store.ID, cancelled.ID, "Repeated cancellation request"); !errors.Is(err, ErrConflict) {
		t.Fatalf("replayed cancellation succeeded: %v", err)
	}
	if _, err := s.AcceptSellerInvitation(cancelledTarget, cancelled.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("cancelled invitation was accepted: %v", err)
	}

	events, err := s.SellerIntegrationEvents(owner, store.ID)
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, event := range events {
		if event.InvitationID == "" {
			continue
		}
		if event.Source != "seller-console" || event.SchemaVersion != 1 || event.StoreID != store.ID || event.Account == "" || event.Role == "" || event.Status == "" || event.ExpiresAt.IsZero() || event.OccurredAt.IsZero() {
			t.Fatalf("invitation event binding invalid: %+v", event)
		}
		seen[event.EventName] = true
	}
	for _, name := range []string{"ynx.seller.team.invitation.created.v1", "ynx.seller.team.invitation.accepted.v1", "ynx.seller.team.invitation.cancelled.v1"} {
		if !seen[name] {
			t.Fatalf("missing invitation event %s: %+v", name, events)
		}
	}
}

func TestSellerTeamInvitationExpiryAndRevocationBoundary(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, time.July, 27, 16, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return now }
	_, owner := actor(t, 114)
	_, target := actor(t, 115)
	_, revokedTarget := actor(t, 116)
	store, _ := setupCatalog(t, s, owner, 1)

	invitation, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleViewer, minSellerInvitationTTL)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(minSellerInvitationTTL + time.Second)
	mine := s.SellerInvitationsForAccount(target)
	if len(mine) != 1 || mine[0].Status != sellerInvitationExpired {
		t.Fatalf("expired invitation was not reported truthfully: %+v", mine)
	}
	if _, err := s.AcceptSellerInvitation(target, invitation.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("expired invitation accepted: %v", err)
	}
	persisted := s.s.SellerInvitations[invitation.ID]
	if persisted.Status != sellerInvitationExpired {
		t.Fatalf("expired state was not persisted after attempted acceptance: %+v", persisted)
	}

	acceptSellerRole(t, s, owner, store.ID, revokedTarget, SellerRoleInventory)
	if _, _, err := s.RevokeSellerRole(owner, store.ID, revokedTarget, "Inventory access revoked"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateSellerInvitation(owner, store.ID, revokedTarget, SellerRoleViewer, time.Hour); !errors.Is(err, ErrConflict) {
		t.Fatalf("invitation bypassed unconfirmed Wallet invalidation: %v", err)
	}
}

func TestSellerTeamInvitationPersistenceFailuresRollbackState(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 125)
	_, target := actor(t, 126)
	_, cancelledTarget := actor(t, 127)
	store, _ := setupCatalog(t, s, owner, 1)
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("block persistence"), 0o600); err != nil {
		t.Fatal(err)
	}
	badPath := filepath.Join(blocker, "commerce.json")

	initialAuditLen := len(s.s.Audits)
	initialEventLen := len(s.s.SellerEvents)
	s.path = badPath
	if _, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleCatalog, time.Hour); err == nil {
		t.Fatal("invitation creation succeeded despite persistence failure")
	}
	if len(s.s.SellerInvitations) != 0 || len(s.s.Audits) != initialAuditLen || len(s.s.SellerEvents) != initialEventLen {
		t.Fatalf("failed creation was not rolled back: invitations=%v audits=%d events=%d", s.s.SellerInvitations, len(s.s.Audits), len(s.s.SellerEvents))
	}

	s.path = ""
	invitation, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleCatalog, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	acceptAuditLen := len(s.s.Audits)
	acceptEventLen := len(s.s.SellerEvents)
	s.path = badPath
	if _, err := s.AcceptSellerInvitation(target, invitation.ID); err == nil {
		t.Fatal("invitation acceptance succeeded despite persistence failure")
	}
	if s.s.SellerInvitations[invitation.ID].Status != sellerInvitationPending || s.s.SellerRoles[store.ID][target] != "" || len(s.s.Audits) != acceptAuditLen || len(s.s.SellerEvents) != acceptEventLen {
		t.Fatalf("failed acceptance was not rolled back: invitation=%+v roles=%v audits=%d events=%d", s.s.SellerInvitations[invitation.ID], s.s.SellerRoles[store.ID], len(s.s.Audits), len(s.s.SellerEvents))
	}

	s.path = ""
	if _, err := s.AcceptSellerInvitation(target, invitation.ID); err != nil {
		t.Fatal(err)
	}
	roleAuditLen := len(s.s.Audits)
	roleEventLen := len(s.s.SellerEvents)
	s.path = badPath
	if err := s.SetSellerRole(owner, store.ID, target, SellerRoleInventory); err == nil {
		t.Fatal("role update succeeded despite persistence failure")
	}
	if s.s.SellerRoles[store.ID][target] != SellerRoleCatalog || len(s.s.Audits) != roleAuditLen || len(s.s.SellerEvents) != roleEventLen {
		t.Fatalf("failed role update was not rolled back: roles=%v audits=%d events=%d", s.s.SellerRoles[store.ID], len(s.s.Audits), len(s.s.SellerEvents))
	}

	s.path = ""
	cancelled, err := s.CreateSellerInvitation(owner, store.ID, cancelledTarget, SellerRoleSupport, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	cancelAuditLen := len(s.s.Audits)
	cancelEventLen := len(s.s.SellerEvents)
	s.path = badPath
	if _, err := s.CancelSellerInvitation(owner, store.ID, cancelled.ID, "Support access no longer required"); err == nil {
		t.Fatal("invitation cancellation succeeded despite persistence failure")
	}
	rolledBack := s.s.SellerInvitations[cancelled.ID]
	if rolledBack.Status != sellerInvitationPending || rolledBack.Reason != "" || !rolledBack.CancelledAt.IsZero() || len(s.s.Audits) != cancelAuditLen || len(s.s.SellerEvents) != cancelEventLen {
		t.Fatalf("failed cancellation was not rolled back: invitation=%+v audits=%d events=%d", rolledBack, len(s.s.Audits), len(s.s.SellerEvents))
	}
}

func TestSellerTeamInvitationPersistsAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 117)
	_, target := actor(t, 118)
	store, _ := setupCatalog(t, s, owner, 1)
	invitation, err := s.CreateSellerInvitation(owner, store.ID, target, SellerRoleFulfillment, time.Hour)
	if err != nil {
		t.Fatal(err)
	}

	restored, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restored.AcceptSellerInvitation(target, invitation.ID); err != nil {
		t.Fatal(err)
	}
	restoredAgain, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if restoredAgain.s.Version != CurrentPersistenceSchemaVersion || restoredAgain.s.SellerInvitations[invitation.ID].Status != sellerInvitationAccepted || restoredAgain.s.SellerRoles[store.ID][target] != SellerRoleFulfillment {
		t.Fatalf("restart lost accepted invitation state: version=%d invitation=%+v roles=%v", restoredAgain.s.Version, restoredAgain.s.SellerInvitations[invitation.ID], restoredAgain.s.SellerRoles[store.ID])
	}
}
