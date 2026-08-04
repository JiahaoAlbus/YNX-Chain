package aiproduct

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
)

//go:embed product-ai-registry.json
var embeddedProductAIRegistry []byte

const selectedProductContext = "selected_product_context"

type ProductAIRegistry struct {
	SchemaVersion   string                    `json:"schemaVersion"`
	RegistryVersion string                    `json:"registryVersion"`
	DefaultPolicy   ProductAIDefaultPolicy    `json:"defaultPolicy"`
	Products        []ProductAIRegistryPolicy `json:"products"`
}

type ProductAIDefaultPolicy struct {
	UnknownProduct           string `json:"unknownProduct"`
	UnknownContext           string `json:"unknownContext"`
	UnselectedPrivateContext string `json:"unselectedPrivateContext"`
	CrossProductContextReuse string `json:"crossProductContextReuse"`
	SecretBearingContext     string `json:"secretBearingContext"`
	ToolExecution            string `json:"toolExecution"`
}

type ProductAIRegistryPolicy struct {
	ID                  string                    `json:"id"`
	DisplayName         string                    `json:"displayName"`
	Owner               string                    `json:"owner"`
	Workflows           []string                  `json:"workflows"`
	AllowedContexts     []ProductAIContextPolicy  `json:"allowedContexts"`
	ForbiddenContexts   []string                  `json:"forbiddenContexts"`
	DataClasses         []string                  `json:"dataClasses"`
	MaxContextBytes     int64                     `json:"maxContextBytes"`
	Tools               []string                  `json:"tools"`
	RequiredApproval    string                    `json:"requiredApproval"`
	Retention           ProductAIRetentionPolicy  `json:"retention"`
	ProviderModelPolicy ProductAIProviderPolicy   `json:"providerModelPolicy"`
	CostBudget          ProductAICostBudgetPolicy `json:"costBudget"`
	Audit               ProductAIAuditPolicy      `json:"audit"`
}

type ProductAIContextPolicy struct {
	Type          string   `json:"type"`
	Label         string   `json:"label"`
	DataClasses   []string `json:"dataClasses"`
	MaxBytes      int64    `json:"maxBytes"`
	Approval      string   `json:"approval"`
	RequiredScope string   `json:"requiredScope"`
	Authority     string   `json:"authority"`
	SourceOwner   string   `json:"sourceOwner"`
	MaxAgeSeconds int64    `json:"maxAgeSeconds"`
}

type ProductAIRetentionPolicy struct {
	Mode    string `json:"mode"`
	MaxDays int    `json:"maxDays"`
}

type ProductAIProviderPolicy struct {
	Selection           string `json:"selection"`
	Fallback            string `json:"fallback"`
	LocalModelCandidate string `json:"localModelCandidate"`
}

type ProductAICostBudgetPolicy struct {
	ProviderCost    string `json:"providerCost"`
	UserBudget      string `json:"userBudget"`
	FreeQuota       string `json:"freeQuota"`
	MaxContextBytes int64  `json:"maxContextBytes"`
}

type ProductAIAuditPolicy struct {
	RequiredFields   []string `json:"requiredFields"`
	RawContextStored bool     `json:"rawContextStored"`
}

type ProductContextSelection struct {
	ProductID           string   `json:"productId"`
	ContextType         string   `json:"contextType"`
	DataClass           string   `json:"dataClass"`
	ReferenceIDs        []string `json:"referenceIds"`
	SizeBytes           int64    `json:"sizeBytes"`
	ExplicitlySelected  bool     `json:"explicitlySelected"`
	PermissionGatewayID string   `json:"permissionGatewayId,omitempty"`
	SourceVersion       string   `json:"sourceVersion"`
	AsOf                string   `json:"asOf"`
}

type ResolvedProductContext struct {
	ProductID           string   `json:"productId"`
	ContextType         string   `json:"contextType"`
	DataClass           string   `json:"dataClass"`
	ReferenceIDs        []string `json:"-"`
	ReferenceHashes     []string `json:"referenceHashes"`
	SizeBytes           int64    `json:"sizeBytes"`
	PermissionGatewayID string   `json:"permissionGatewayId,omitempty"`
	SourceVersion       string   `json:"sourceVersion"`
	AsOf                string   `json:"asOf"`
	Authority           string   `json:"authority"`
	SourceOwner         string   `json:"sourceOwner"`
}

func loadProductAIRegistry() (ProductAIRegistry, error) {
	var registry ProductAIRegistry
	decoder := json.NewDecoder(strings.NewReader(string(embeddedProductAIRegistry)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&registry); err != nil {
		return ProductAIRegistry{}, fmt.Errorf("decode Product AI Registry: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return ProductAIRegistry{}, errors.New("Product AI Registry must contain exactly one JSON value")
	}
	if err := validateProductAIRegistry(registry); err != nil {
		return ProductAIRegistry{}, err
	}
	return registry, nil
}

func validApprovalPolicy(value string) bool {
	return value == "session_scope" || value == "explicit_selection" || value == "explicit_selection_and_permission"
}

func hashProductAccount(account, conversationID string) string {
	digest := sha256.Sum256([]byte("ynx-ai-account\x00" + strings.TrimSpace(conversationID) + "\x00" + strings.TrimSpace(account)))
	return hex.EncodeToString(digest[:])
}

func hashProductReference(account, conversationID, productID, contextType, referenceID string) string {
	accountHash := hashProductAccount(account, conversationID)
	digest := sha256.Sum256([]byte("ynx-ai-reference\x00" + accountHash + "\x00" + productID + "\x00" + contextType + "\x00" + referenceID))
	return hex.EncodeToString(digest[:])
}

func containsAll(values, required []string) bool {
	set := map[string]bool{}
	for _, value := range values {
		set[value] = true
	}
	for _, value := range required {
		if !set[value] {
			return false
		}
	}
	return true
}

func validateUniqueBoundedList(values []string, maxItems, maxRunes int, kind, productID string) error {
	if len(values) == 0 || len(values) > maxItems {
		return fmt.Errorf("Product AI Registry product %s has an invalid %s list", productID, kind)
	}
	seen := map[string]bool{}
	for _, rawValue := range values {
		value := strings.TrimSpace(rawValue)
		if value == "" || rawValue != value || value != strings.ToLower(value) || len([]rune(value)) > maxRunes || seen[value] {
			return fmt.Errorf("Product AI Registry product %s has a non-canonical or duplicate %s", productID, kind)
		}
		seen[value] = true
	}
	return nil
}

func forbiddenExecutableTool(tool string) bool {
	first := strings.Split(strings.ToLower(strings.TrimSpace(tool)), "_")[0]
	return map[string]bool{
		"sign": true, "pay": true, "refund": true, "trade": true, "swap": true,
		"withdraw": true, "issue": true, "freeze": true, "publish": true,
		"send": true, "delete": true, "ban": true, "mint": true, "burn": true,
		"execute": true, "deploy": true, "change": true, "rollback": true,
	}[first]
}

func (registry ProductAIRegistry) productPolicy(productID string) (ProductAIRegistryPolicy, bool) {
	for _, policy := range registry.Products {
		if policy.ID == productID {
			return policy, true
		}
	}
	return ProductAIRegistryPolicy{}, false
}

func contextPolicy(product ProductAIRegistryPolicy, contextType string) (ProductAIContextPolicy, bool) {
	for _, policy := range product.AllowedContexts {
		if policy.Type == contextType {
			return policy, true
		}
	}
	return ProductAIContextPolicy{}, false
}

func validateProductAIRegistry(registry ProductAIRegistry) error {
	if registry.SchemaVersion != "ynx.ai.product-registry.v1" || strings.TrimSpace(registry.RegistryVersion) == "" {
		return errors.New("Product AI Registry schemaVersion and registryVersion are required")
	}
	defaults := []string{
		registry.DefaultPolicy.UnknownProduct,
		registry.DefaultPolicy.UnknownContext,
		registry.DefaultPolicy.UnselectedPrivateContext,
		registry.DefaultPolicy.CrossProductContextReuse,
		registry.DefaultPolicy.SecretBearingContext,
		registry.DefaultPolicy.ToolExecution,
	}
	for _, value := range defaults {
		if value != "deny" {
			return errors.New("every Product AI Registry default policy must deny")
		}
	}
	requiredProducts := map[string]bool{
		"ai": true, "wallet": true, "social": true, "pay": true, "card": true,
		"exchange": true, "quant": true, "shop": true, "seller": true,
		"developer": true, "explorer": true, "monitor": true, "trust": true,
		"resource": true, "cloud": true, "browser": true, "search": true,
		"finance": true, "mail": true, "music": true, "video": true,
		"creator-studio": true, "docs": true, "calendar": true,
	}
	if len(registry.Products) != len(requiredProducts) {
		return fmt.Errorf("Product AI Registry must contain exactly %d applicable products", len(requiredProducts))
	}
	seen := map[string]bool{}
	for _, product := range registry.Products {
		if product.ID != strings.ToLower(strings.TrimSpace(product.ID)) || !requiredProducts[product.ID] || seen[product.ID] {
			return fmt.Errorf("Product AI Registry product %q is unknown, duplicated, or non-canonical", product.ID)
		}
		seen[product.ID] = true
		if err := validateProductAIRegistryPolicy(product); err != nil {
			return err
		}
	}
	for id := range requiredProducts {
		if !seen[id] {
			return fmt.Errorf("Product AI Registry is missing product %s", id)
		}
	}
	return nil
}

func validateProductAIRegistryPolicy(product ProductAIRegistryPolicy) error {
	if strings.TrimSpace(product.DisplayName) == "" || strings.TrimSpace(product.Owner) == "" || len(product.Workflows) == 0 || len(product.AllowedContexts) == 0 || len(product.DataClasses) == 0 || len(product.Tools) == 0 {
		return fmt.Errorf("Product AI Registry product %s is incomplete", product.ID)
	}
	if product.MaxContextBytes <= 0 || product.MaxContextBytes > 1<<20 || product.CostBudget.MaxContextBytes != product.MaxContextBytes {
		return fmt.Errorf("Product AI Registry product %s has an invalid context budget", product.ID)
	}
	if !validApprovalPolicy(product.RequiredApproval) {
		return fmt.Errorf("Product AI Registry product %s has an invalid approval policy", product.ID)
	}
	if product.Retention.Mode != "request_only" && product.Retention.Mode != "account_policy" {
		return fmt.Errorf("Product AI Registry product %s has an invalid retention mode", product.ID)
	}
	if product.Retention.Mode == "request_only" && product.Retention.MaxDays != 0 {
		return fmt.Errorf("Product AI Registry product %s request-only retention must be zero days", product.ID)
	}
	if product.Retention.Mode == "account_policy" && (product.Retention.MaxDays < 1 || product.Retention.MaxDays > 90) {
		return fmt.Errorf("Product AI Registry product %s account retention is out of bounds", product.ID)
	}
	if product.ProviderModelPolicy.Selection != "gateway_model_registry_only" || product.ProviderModelPolicy.Fallback != "truthful_unavailable" || product.ProviderModelPolicy.LocalModelCandidate != "explicit_capability_only" {
		return fmt.Errorf("Product AI Registry product %s has unsafe Provider/model policy", product.ID)
	}
	if product.CostBudget.ProviderCost != "disclose_when_reported" || product.CostBudget.UserBudget != "required_before_paid_request" || product.CostBudget.FreeQuota != "explicit_not_inferred" {
		return fmt.Errorf("Product AI Registry product %s has incomplete cost/budget truth", product.ID)
	}
	if product.Audit.RawContextStored || !containsAll(product.Audit.RequiredFields, []string{"requestId", "accountHash", "conversationId", "productId", "contextType", "dataClass", "sourceOwner", "sourceVersion", "asOf", "permissionId", "referenceHashes"}) {
		return fmt.Errorf("Product AI Registry product %s has incomplete or unsafe audit policy", product.ID)
	}
	for _, check := range []struct {
		values   []string
		maxItems int
		maxRunes int
		kind     string
	}{
		{product.Workflows, 32, 80, "workflow"},
		{product.DataClasses, 16, 80, "data class"},
		{product.ForbiddenContexts, 32, 120, "forbidden context"},
		{product.Tools, 32, 120, "tool"},
	} {
		if err := validateUniqueBoundedList(check.values, check.maxItems, check.maxRunes, check.kind, product.ID); err != nil {
			return err
		}
	}
	for _, tool := range product.Tools {
		if forbiddenExecutableTool(tool) {
			return fmt.Errorf("Product AI Registry product %s contains executable tool %q", product.ID, tool)
		}
	}
	seenContexts := map[string]bool{}
	for _, policy := range product.AllowedContexts {
		if policy.Type != strings.ToLower(strings.TrimSpace(policy.Type)) || seenContexts[policy.Type] || strings.TrimSpace(policy.Label) == "" {
			return fmt.Errorf("Product AI Registry product %s has an invalid or duplicate context", product.ID)
		}
		seenContexts[policy.Type] = true
		if err := validateProductAIContextPolicy(product, policy); err != nil {
			return err
		}
	}
	return nil
}

func validateProductAIContextPolicy(product ProductAIRegistryPolicy, policy ProductAIContextPolicy) error {
	if policy.MaxBytes <= 0 || policy.MaxBytes > product.MaxContextBytes || policy.MaxAgeSeconds <= 0 || policy.MaxAgeSeconds > 7*24*60*60 {
		return fmt.Errorf("Product AI Registry product %s context %s has invalid bounds", product.ID, policy.Type)
	}
	if !validApprovalPolicy(policy.Approval) || policy.Approval != product.RequiredApproval {
		return fmt.Errorf("Product AI Registry product %s context %s has inconsistent approval", product.ID, policy.Type)
	}
	if policy.Approval == "explicit_selection_and_permission" && strings.TrimSpace(policy.RequiredScope) == "" {
		return fmt.Errorf("Product AI Registry product %s context %s requires an exact permission scope", product.ID, policy.Type)
	}
	if policy.Approval == "explicit_selection" && policy.RequiredScope != "" {
		return fmt.Errorf("Product AI Registry product %s public context %s must not invent a permission scope", product.ID, policy.Type)
	}
	if policy.Approval == "session_scope" && !strings.HasPrefix(policy.RequiredScope, "ai:") {
		return fmt.Errorf("Product AI Registry product %s context %s requires an AI product session scope", product.ID, policy.Type)
	}
	if policy.Authority != "ynx-authoritative" && policy.Authority != "third-party" && policy.Authority != "user-selected" {
		return fmt.Errorf("Product AI Registry product %s context %s has invalid authority", product.ID, policy.Type)
	}
	if strings.TrimSpace(policy.SourceOwner) == "" || len(policy.DataClasses) == 0 || !containsAll(product.DataClasses, policy.DataClasses) {
		return fmt.Errorf("Product AI Registry product %s context %s has incomplete data/source policy", product.ID, policy.Type)
	}
	return validateUniqueBoundedList(policy.DataClasses, 8, 80, "context data class", product.ID)
}

func (s *Server) validateProductContextSelections(session ProductSession, conversationID string, included []string, selections []ProductContextSelection, now time.Time) ([]ResolvedProductContext, error) {
	includesProductContext := listContains(cleanList(included), selectedProductContext)
	if len(selections) == 0 {
		if includesProductContext {
			return nil, errors.New("selected_product_context requires at least one explicit product context selection")
		}
		return nil, nil
	}
	if !includesProductContext {
		return nil, errors.New("productContexts require selected_product_context in includedContext")
	}
	if len(selections) > 8 {
		return nil, errors.New("at most 8 product context selections are allowed")
	}

	seenContexts := map[string]bool{}
	seenPermissions := map[string]bool{}
	productBytes := map[string]int64{}
	resolved := make([]ResolvedProductContext, 0, len(selections))
	var totalBytes int64
	for _, selection := range selections {
		selection.ProductID = strings.ToLower(strings.TrimSpace(selection.ProductID))
		selection.ContextType = strings.ToLower(strings.TrimSpace(selection.ContextType))
		selection.DataClass = strings.TrimSpace(selection.DataClass)
		selection.PermissionGatewayID = strings.TrimSpace(selection.PermissionGatewayID)
		selection.SourceVersion = strings.TrimSpace(selection.SourceVersion)
		if !selection.ExplicitlySelected {
			return nil, fmt.Errorf("product context %s/%s was not explicitly selected", selection.ProductID, selection.ContextType)
		}
		product, ok := s.registry.productPolicy(selection.ProductID)
		if !ok {
			return nil, fmt.Errorf("product context product %q is not registered", selection.ProductID)
		}
		policy, ok := contextPolicy(product, selection.ContextType)
		if !ok {
			return nil, fmt.Errorf("context type %q is not allowed for product %s", selection.ContextType, selection.ProductID)
		}
		contextKey := selection.ProductID + "\x00" + selection.ContextType
		if seenContexts[contextKey] {
			return nil, fmt.Errorf("product context %s/%s is duplicated", selection.ProductID, selection.ContextType)
		}
		seenContexts[contextKey] = true
		if !containsAll(policy.DataClasses, []string{selection.DataClass}) {
			return nil, fmt.Errorf("data class %q is not allowed for product context %s/%s", selection.DataClass, selection.ProductID, selection.ContextType)
		}
		if selection.SizeBytes <= 0 || selection.SizeBytes > policy.MaxBytes || productBytes[product.ID]+selection.SizeBytes > product.MaxContextBytes || totalBytes+selection.SizeBytes > 1<<20 {
			return nil, fmt.Errorf("product context %s/%s exceeds its byte budget", selection.ProductID, selection.ContextType)
		}
		productBytes[product.ID] += selection.SizeBytes
		totalBytes += selection.SizeBytes
		if selection.SourceVersion == "" || len([]rune(selection.SourceVersion)) > 80 {
			return nil, fmt.Errorf("product context %s/%s requires a bounded sourceVersion", selection.ProductID, selection.ContextType)
		}
		asOf, err := time.Parse(time.RFC3339, strings.TrimSpace(selection.AsOf))
		if err != nil {
			return nil, fmt.Errorf("product context %s/%s requires RFC3339 asOf", selection.ProductID, selection.ContextType)
		}
		if asOf.After(now.Add(5*time.Minute)) || now.Sub(asOf) > time.Duration(policy.MaxAgeSeconds)*time.Second {
			return nil, fmt.Errorf("product context %s/%s is stale or future-dated", selection.ProductID, selection.ContextType)
		}
		references := cleanList(selection.ReferenceIDs)
		if len(references) == 0 || len(references) > 16 || len(references) != len(selection.ReferenceIDs) {
			return nil, fmt.Errorf("product context %s/%s requires 1-16 unique referenceIds", selection.ProductID, selection.ContextType)
		}
		referenceHashes := make([]string, 0, len(references))
		for _, referenceID := range references {
			if len([]rune(referenceID)) > 160 {
				return nil, fmt.Errorf("product context %s/%s contains an oversized referenceId", selection.ProductID, selection.ContextType)
			}
			referenceHashes = append(referenceHashes, hashProductReference(session.Account, conversationID, selection.ProductID, selection.ContextType, referenceID))
		}
		if err := s.validateProductContextApproval(session, conversationID, policy, selection.PermissionGatewayID, seenPermissions, now); err != nil {
			return nil, fmt.Errorf("product context %s/%s: %w", selection.ProductID, selection.ContextType, err)
		}
		resolved = append(resolved, ResolvedProductContext{
			ProductID: selection.ProductID, ContextType: selection.ContextType, DataClass: selection.DataClass,
			ReferenceIDs: references, ReferenceHashes: referenceHashes, SizeBytes: selection.SizeBytes,
			PermissionGatewayID: selection.PermissionGatewayID, SourceVersion: selection.SourceVersion,
			AsOf: asOf.UTC().Format(time.RFC3339), Authority: policy.Authority, SourceOwner: policy.SourceOwner,
		})
	}
	return resolved, nil
}

func (s *Server) validateProductContextApproval(session ProductSession, conversationID string, policy ProductAIContextPolicy, permissionGatewayID string, seen map[string]bool, now time.Time) error {
	switch policy.Approval {
	case "session_scope":
		if !hasScope(session.Scopes, policy.RequiredScope) || permissionGatewayID != "" {
			return errors.New("exact product session scope is required")
		}
	case "explicit_selection":
		if permissionGatewayID != "" {
			return errors.New("public selected context must not claim an unrelated permission")
		}
	case "explicit_selection_and_permission":
		if permissionGatewayID == "" || seen[permissionGatewayID] {
			return errors.New("a unique permissionGatewayId is required")
		}
		permission, found := s.store.PermissionByGatewayID(session.Account, permissionGatewayID)
		if !found || permission.Status != "active" || !permission.ExpiresAt.After(now) || permission.Scope != policy.RequiredScope || permission.SessionID != conversationID {
			return errors.New("an active permission for this account, conversation, and exact scope is required")
		}
		seen[permissionGatewayID] = true
	default:
		return errors.New("Product AI Registry approval policy is invalid")
	}
	return nil
}
