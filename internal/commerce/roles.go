package commerce

import "strings"

const (
	SellerRoleOwner       = "owner"
	SellerRoleAdmin       = "admin"
	SellerRoleCatalog     = "catalog"
	SellerRoleInventory   = "inventory"
	SellerRoleFulfillment = "fulfillment"
	SellerRoleFinance     = "finance"
	SellerRoleSupport     = "support"
	SellerRoleViewer      = "viewer"
)

type sellerPermission string

const (
	permissionSellerRead       sellerPermission = "seller.read"
	permissionCatalogWrite     sellerPermission = "catalog.write"
	permissionInventoryWrite   sellerPermission = "inventory.write"
	permissionFulfillmentWrite sellerPermission = "fulfillment.write"
	permissionReturnResolve    sellerPermission = "returns.resolve"
	permissionRefundApprove    sellerPermission = "refunds.approve"
	permissionFinanceRead      sellerPermission = "finance.read"
	permissionTeamRead         sellerPermission = "team.read"
	permissionAuditRead        sellerPermission = "audit.read"
)

var assignableSellerRoles = map[string]bool{
	SellerRoleAdmin:       true,
	SellerRoleCatalog:     true,
	SellerRoleInventory:   true,
	SellerRoleFulfillment: true,
	SellerRoleFinance:     true,
	SellerRoleSupport:     true,
	SellerRoleViewer:      true,
}

func canonicalSellerRole(role string) (string, bool) {
	role = strings.ToLower(strings.TrimSpace(role))
	if role == "manager" { // Snapshot v2 migration only; new requests must use admin.
		return SellerRoleAdmin, true
	}
	switch role {
	case SellerRoleOwner, SellerRoleAdmin, SellerRoleCatalog, SellerRoleInventory,
		SellerRoleFulfillment, SellerRoleFinance, SellerRoleSupport, SellerRoleViewer:
		return role, true
	default:
		return "", false
	}
}

func isAssignableSellerRole(role string) bool {
	role = strings.ToLower(strings.TrimSpace(role))
	return assignableSellerRoles[role]
}

func knownSellerPermission(permission sellerPermission) bool {
	switch permission {
	case permissionSellerRead, permissionCatalogWrite, permissionInventoryWrite,
		permissionFulfillmentWrite, permissionReturnResolve, permissionRefundApprove,
		permissionFinanceRead, permissionTeamRead, permissionAuditRead:
		return true
	default:
		return false
	}
}

func sellerRoleAllows(role string, permission sellerPermission) bool {
	role, ok := canonicalSellerRole(role)
	if !ok || !knownSellerPermission(permission) {
		return false
	}
	if role == SellerRoleOwner || role == SellerRoleAdmin {
		return true
	}
	if permission == permissionSellerRead {
		return true
	}
	switch role {
	case SellerRoleCatalog:
		return permission == permissionCatalogWrite
	case SellerRoleInventory:
		return permission == permissionInventoryWrite
	case SellerRoleFulfillment:
		return permission == permissionFulfillmentWrite
	case SellerRoleFinance:
		return permission == permissionFinanceRead || permission == permissionRefundApprove
	case SellerRoleSupport:
		return permission == permissionReturnResolve
	case SellerRoleViewer:
		return permission == permissionFinanceRead || permission == permissionTeamRead || permission == permissionAuditRead
	default:
		return false
	}
}
