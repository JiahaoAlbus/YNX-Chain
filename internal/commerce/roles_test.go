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
	if err := s.SetSellerRole(owner, store.ID, catalog, SellerRoleCatalog); err != nil {
		t.Fatal(err)
	}
	if err := s.SetSellerRole(owner, store.ID, inventory, SellerRoleInventory); err != nil {
		t.Fatal(err)
	}

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
	if migrated.s.Version != 3 || migrated.s.SellerRoles["store_legacy"]["ynx_legacy"] != SellerRoleAdmin {
		t.Fatalf("legacy role was not migrated: version=%d roles=%v", migrated.s.Version, migrated.s.SellerRoles)
	}
}
