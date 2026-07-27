package commerce

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCanonicalSellerRolePermissionMatrix(t *testing.T) {
	tests := []struct {
		role       string
		permission sellerPermission
		allowed    bool
	}{
		{SellerRoleOwner, permissionCatalogWrite, true},
		{SellerRoleAdmin, permissionRefundApprove, true},
		{SellerRoleCatalog, permissionCatalogWrite, true},
		{SellerRoleCatalog, permissionInventoryWrite, false},
		{SellerRoleInventory, permissionInventoryWrite, true},
		{SellerRoleInventory, permissionCatalogWrite, false},
		{SellerRoleFulfillment, permissionFulfillmentWrite, true},
		{SellerRoleFulfillment, permissionRefundApprove, false},
		{SellerRoleFinance, permissionRefundApprove, true},
		{SellerRoleFinance, permissionReturnResolve, false},
		{SellerRoleSupport, permissionReturnResolve, true},
		{SellerRoleSupport, permissionRefundApprove, false},
		{SellerRoleViewer, permissionAuditRead, true},
		{SellerRoleViewer, permissionCatalogWrite, false},
		{SellerRoleOwner, sellerPermission("unknown.permission"), false},
		{"unknown", permissionSellerRead, false},
	}
	for _, tt := range tests {
		if got := sellerRoleAllows(tt.role, tt.permission); got != tt.allowed {
			t.Fatalf("role=%s permission=%s got=%v want=%v", tt.role, tt.permission, got, tt.allowed)
		}
	}
	if isAssignableSellerRole(SellerRoleOwner) || isAssignableSellerRole("manager") {
		t.Fatal("owner or legacy manager must not be assignable through the role API")
	}
}

func TestSellerRoleCapabilitiesFailClosed(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 90)
	_, catalog := actor(t, 91)
	_, inventory := actor(t, 92)
	_, legacy := actor(t, 93)
	store, product := setupCatalog(t, s, owner, 5)
	acceptSellerRole(t, s, owner, store.ID, catalog, SellerRoleCatalog)
	acceptSellerRole(t, s, owner, store.ID, inventory, SellerRoleInventory)

	update := UpdateProductInput{Title: "Catalog-managed kit", Description: product.Description, Category: product.Category, Media: product.Media, Variants: product.Variants, IdempotencyKey: "catalog-role-update"}
	if _, err := s.UpdateProduct(catalog, product.ID, update); err != nil {
		t.Fatalf("catalog role could not update product: %v", err)
	}
	if _, err := s.SetInventory(catalog, InventoryInput{StoreID: store.ID, ProductID: product.ID, VariantID: product.Variants[0].ID, Inventory: 6, IdempotencyKey: "catalog-inventory-denied"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("catalog role changed inventory: %v", err)
	}
	if _, err := s.SetInventory(inventory, InventoryInput{StoreID: store.ID, ProductID: product.ID, VariantID: product.Variants[0].ID, Inventory: 6, IdempotencyKey: "inventory-role-update"}); err != nil {
		t.Fatalf("inventory role could not change inventory: %v", err)
	}
	if _, err := s.UpdateProduct(inventory, product.ID, UpdateProductInput{IdempotencyKey: "inventory-catalog-denied"}); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("inventory role changed catalog: %v", err)
	}
	if err := s.SetSellerRole(owner, store.ID, legacy, "manager"); err == nil {
		t.Fatal("legacy manager role accepted by new API")
	}
}

func TestSnapshotV2ManagerMigratesToAdmin(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	snapshot := emptySnapshot()
	snapshot.Version = 2
	snapshot.SellerRoles["store_legacy"] = map[string]string{"ynx_legacy": "manager"}
	data, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	migrated, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if migrated.s.Version != 6 || migrated.s.SellerRoles["store_legacy"]["ynx_legacy"] != SellerRoleAdmin || migrated.s.SellerRevocations == nil || migrated.s.SellerInvitations == nil || migrated.s.SellerEvents == nil {
		t.Fatalf("legacy role was not migrated: version=%d roles=%v revocations=%v invitations=%v events=%v", migrated.s.Version, migrated.s.SellerRoles, migrated.s.SellerRevocations, migrated.s.SellerInvitations, migrated.s.SellerEvents)
	}
}

func TestSellerRoleRevocationBlocksRegrantUntilSessionInvalidationConfirmed(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 96)
	_, support := actor(t, 97)
	_, outsider := actor(t, 98)
	store, _ := setupCatalog(t, s, owner, 1)
	acceptSellerRole(t, s, owner, store.ID, support, SellerRoleSupport)
	if _, _, err := s.RevokeSellerRole(outsider, store.ID, support, "Unauthorized attempt"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("non-owner revoked role: %v", err)
	}
	if _, _, err := s.RevokeSellerRole(owner, store.ID, owner, "Owner self revoke"); err == nil {
		t.Fatal("owner self-revocation accepted")
	}
	revocation, created, err := s.RevokeSellerRole(owner, store.ID, support, "Member access removed")
	if err != nil || !created || revocation.SessionStatus != "pending" || revocation.PreviousRole != SellerRoleSupport {
		t.Fatalf("local revoke failed: %+v created=%v err=%v", revocation, created, err)
	}
	if _, err := s.SellerProducts(support, store.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("revoked member retained seller read access: %v", err)
	}
	if err := s.SetSellerRole(owner, store.ID, support, SellerRoleViewer); !errors.Is(err, ErrConflict) {
		t.Fatalf("role regrant allowed before session invalidation: %v", err)
	}
	repeated, created, err := s.RevokeSellerRole(owner, store.ID, support, "Member access removed")
	if err != nil || created || repeated.ID != revocation.ID {
		t.Fatalf("idempotent revoke failed: %+v created=%v err=%v", repeated, created, err)
	}
	if _, _, err := s.RevokeSellerRole(owner, store.ID, support, "Different revoke reason"); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflicting repeated revoke accepted: %v", err)
	}
	unavailable, err := s.UpdateSellerRoleRevocation(owner, revocation.ID, "unavailable", "", 0, "central Wallet contract unavailable")
	if err != nil || unavailable.SessionStatus != "unavailable" || unavailable.LastError == "" {
		t.Fatalf("unavailable state not persisted: %+v err=%v", unavailable, err)
	}
	if err := s.SetSellerRole(owner, store.ID, support, SellerRoleViewer); !errors.Is(err, ErrConflict) {
		t.Fatalf("role regrant allowed while central invalidation unavailable: %v", err)
	}
	confirmed, err := s.UpdateSellerRoleRevocation(owner, revocation.ID, "confirmed", "wallet-revoke-001", 2, "central Wallet store-scoped Seller authorization invalidated")
	if err != nil || confirmed.SessionStatus != "confirmed" || confirmed.SessionCount != 2 || confirmed.SessionRevocationID != "wallet-revoke-001" {
		t.Fatalf("confirmed invalidation not persisted: %+v err=%v", confirmed, err)
	}
	accepted := acceptSellerRole(t, s, owner, store.ID, support, SellerRoleViewer)
	if accepted.Role != SellerRoleViewer {
		t.Fatalf("role regrant used wrong invitation role: %+v", accepted)
	}
	revocations, err := s.SellerRoleRevocations(owner, store.ID)
	if err != nil || len(revocations) != 1 || revocations[0].ID != revocation.ID {
		t.Fatalf("revocation history unavailable: %+v err=%v", revocations, err)
	}
	events, err := s.SellerIntegrationEvents(owner, store.ID)
	if err != nil {
		t.Fatal(err)
	}
	revocationEvents := []SellerIntegrationEvent{}
	for _, event := range events {
		if event.RevocationID == revocation.ID {
			revocationEvents = append(revocationEvents, event)
		}
	}
	if len(revocationEvents) != 3 {
		t.Fatalf("seller revocation integration events unavailable: %+v", revocationEvents)
	}
	seenRoleRevoked := false
	seenStatuses := map[string]bool{}
	for _, event := range revocationEvents {
		if event.Source != "seller-console" || event.SchemaVersion != 1 || event.StoreID != store.ID || event.Account != support || event.Actor != owner || event.RevocationID != revocation.ID || event.PreviousRole != SellerRoleSupport || event.OccurredAt.IsZero() {
			t.Fatalf("seller integration event binding invalid: %+v", event)
		}
		switch event.EventName {
		case "ynx.seller.role.revoked.v1":
			seenRoleRevoked = event.SessionStatus == "pending"
		case "ynx.seller.authorization.revocation.updated.v1":
			seenStatuses[event.SessionStatus] = true
			if event.SessionStatus == "confirmed" && (event.SessionRevocationID != "wallet-revoke-001" || event.SessionCount != 2) {
				t.Fatalf("confirmed event receipt binding invalid: %+v", event)
			}
		default:
			t.Fatalf("unknown seller integration event: %+v", event)
		}
	}
	if !seenRoleRevoked || !seenStatuses["unavailable"] || !seenStatuses["confirmed"] {
		t.Fatalf("seller integration event sequence incomplete: %+v", events)
	}
	if _, err := s.SellerIntegrationEvents(outsider, store.ID); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("outsider read seller integration events: %v", err)
	}
}

func TestSellerRoleRevocationEventsPersistAcrossRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, owner := actor(t, 108)
	_, member := actor(t, 109)
	store, _ := setupCatalog(t, s, owner, 1)
	acceptSellerRole(t, s, owner, store.ID, member, SellerRoleInventory)
	revocation, _, err := s.RevokeSellerRole(owner, store.ID, member, "Inventory access removed")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateSellerRoleRevocation(owner, revocation.ID, "confirmed", "wallet-revoke-restart-001", 1, "central Wallet store-scoped Seller authorization invalidated"); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	events, err := restored.SellerIntegrationEvents(owner, store.ID)
	if err != nil {
		t.Fatal(err)
	}
	revocationEvents := []SellerIntegrationEvent{}
	for _, event := range events {
		if event.RevocationID == revocation.ID {
			revocationEvents = append(revocationEvents, event)
		}
	}
	if len(revocationEvents) != 2 || revocationEvents[0].SessionStatus != "confirmed" || revocationEvents[1].SessionStatus != "pending" {
		t.Fatalf("restart lost seller revocation events: %+v", revocationEvents)
	}
	roles, err := restored.SellerRoles(owner, store.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := roles[member]; ok {
		t.Fatalf("restart restored revoked role: %+v", roles)
	}
}
