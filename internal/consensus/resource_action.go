package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type ResourcePoolCreatePayload struct {
	PoolType             string              `json:"poolType"`
	Name                 string              `json:"name"`
	Public               bool                `json:"public"`
	AllowedBeneficiaries []string            `json:"allowedBeneficiaries,omitempty"`
	AllowedScopes        []string            `json:"allowedScopes"`
	AllowedResourceTypes []string            `json:"allowedResourceTypes"`
	PerActionLimit       chain.ResourceUnits `json:"perActionLimit"`
	CumulativeAllowance  chain.ResourceUnits `json:"cumulativeAllowance"`
	ExpiresAt            time.Time           `json:"expiresAt"`
	IdempotencyKey       string              `json:"idempotencyKey"`
}

type ResourcePoolFundPayload struct {
	PoolID             string              `json:"poolId"`
	Additional         chain.ResourceUnits `json:"additional"`
	ExpectedPolicyHash string              `json:"expectedPolicyHash"`
	IdempotencyKey     string              `json:"idempotencyKey"`
}

type ResourcePoolPolicyPayload struct {
	PoolID               string              `json:"poolId"`
	Public               bool                `json:"public"`
	AllowedBeneficiaries []string            `json:"allowedBeneficiaries,omitempty"`
	AllowedScopes        []string            `json:"allowedScopes"`
	AllowedResourceTypes []string            `json:"allowedResourceTypes"`
	PerActionLimit       chain.ResourceUnits `json:"perActionLimit"`
	ExpiresAt            time.Time           `json:"expiresAt"`
	ExpectedPolicyHash   string              `json:"expectedPolicyHash"`
	IdempotencyKey       string              `json:"idempotencyKey"`
}

type ResourcePoolStatusPayload struct {
	PoolID             string `json:"poolId"`
	Status             string `json:"status"`
	ExpectedPolicyHash string `json:"expectedPolicyHash"`
	IdempotencyKey     string `json:"idempotencyKey"`
}

type ResourceSponsorshipPayload struct {
	PoolID          string `json:"poolId,omitempty"`
	Beneficiary     string `json:"beneficiary"`
	Scope           string `json:"scope"`
	ResourceType    string `json:"resourceType"`
	Amount          int64  `json:"amount"`
	ActionReference string `json:"actionReference"`
	IdempotencyKey  string `json:"idempotencyKey"`
}

var bftResourceScopes = map[string]struct{}{
	"ai_service": {}, "contract_call": {}, "dapp_action": {}, "pay_api": {}, "trust_service": {}, "wallet_action": {},
}

var bftResourceTypes = map[string]struct{}{
	"ai_credits": {}, "bandwidth": {}, "compute": {}, "trust_credits": {},
}

type ResourceDelegationPayload struct {
	Provider       string `json:"provider"`
	Beneficiary    string `json:"beneficiary"`
	AmountYNXT     int64  `json:"amountYnxt"`
	PolicyHash     string `json:"policyHash"`
	IdempotencyKey string `json:"idempotencyKey"`
	RequestHash    string `json:"requestHash"`
}

type ResourceRentalPayload struct {
	Address        string    `json:"address"`
	Provider       string    `json:"provider"`
	Bandwidth      int64     `json:"bandwidth"`
	Compute        int64     `json:"compute"`
	AICredits      int64     `json:"aiCredits"`
	TrustCredits   int64     `json:"trustCredits"`
	QuoteID        string    `json:"quoteId"`
	QuoteExpiresAt time.Time `json:"quoteExpiresAt"`
	PolicyHash     string    `json:"policyHash"`
	MaxPriceYNXT   int64     `json:"maxPriceYnxt"`
	IdempotencyKey string    `json:"idempotencyKey"`
	RequestHash    string    `json:"requestHash"`
}

func isResourceAction(action string) bool {
	return action == ActionResourceDelegate || action == ActionResourceRent || isResourceSponsorAction(action)
}

func isResourceSponsorAction(action string) bool {
	switch action {
	case ActionResourcePoolCreate, ActionResourcePoolFund, ActionResourcePoolPolicy, ActionResourcePoolStatus, ActionResourceSponsor:
		return true
	default:
		return false
	}
}

func ResourceRequestHash(action string, value any) (string, error) {
	payload, err := json.Marshal(struct {
		Domain string `json:"domain"`
		Action string `json:"action"`
		Value  any    `json:"value"`
	}{Domain: "YNX_RESOURCE_REQUEST_V1", Action: action, Value: value})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func ResourceDelegationRequestHash(provider, beneficiary string, amount int64, policyHash, key string) string {
	doc := struct {
		Provider       string `json:"provider"`
		Beneficiary    string `json:"beneficiary"`
		AmountYNXT     int64  `json:"amountYnxt"`
		PolicyHash     string `json:"policyHash"`
		IdempotencyKey string `json:"idempotencyKey"`
	}{provider, beneficiary, amount, policyHash, key}
	hash, _ := ResourceRequestHash(ActionResourceDelegate, doc)
	return hash
}

func ResourceRentalRequestHash(address, provider string, bandwidth, compute, aiCredits, trustCredits int64, quoteID string, expiresAt time.Time, policyHash string, maxPrice int64, key string) string {
	doc := struct {
		Address        string    `json:"address"`
		Provider       string    `json:"provider"`
		Bandwidth      int64     `json:"bandwidth"`
		Compute        int64     `json:"compute"`
		AICredits      int64     `json:"aiCredits"`
		TrustCredits   int64     `json:"trustCredits"`
		QuoteID        string    `json:"quoteId"`
		QuoteExpiresAt time.Time `json:"quoteExpiresAt"`
		PolicyHash     string    `json:"policyHash"`
		MaxPriceYNXT   int64     `json:"maxPriceYnxt"`
		IdempotencyKey string    `json:"idempotencyKey"`
	}{address, provider, bandwidth, compute, aiCredits, trustCredits, quoteID, expiresAt.UTC(), policyHash, maxPrice, key}
	hash, _ := ResourceRequestHash(ActionResourceRent, doc)
	return hash
}

func ResourceIdempotencyID(signer, key string) string {
	sum := sha256.Sum256([]byte("YNX_RESOURCE_IDEMPOTENCY_V1|" + signer + "|" + key))
	return hex.EncodeToString(sum[:])[:24]
}

func canonicalResourceActionPayload(action string, raw []byte) ([]byte, error) {
	switch action {
	case ActionResourceDelegate:
		var p ResourceDelegationPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Provider = strings.ToLower(strings.TrimSpace(p.Provider))
		p.Beneficiary = strings.TrimSpace(p.Beneficiary)
		p.PolicyHash = strings.ToLower(strings.TrimSpace(p.PolicyHash))
		p.IdempotencyKey = strings.TrimSpace(p.IdempotencyKey)
		p.RequestHash = strings.ToLower(strings.TrimSpace(p.RequestHash))
		if !IsNativeAddress(p.Provider) || !validResourceAccount(p.Beneficiary) || p.AmountYNXT <= 0 {
			return nil, errors.New("invalid Resource delegation identity or amount")
		}
		if !payHashPattern.MatchString(p.PolicyHash) || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid Resource delegation policy or idempotency key")
		}
		if p.RequestHash != ResourceDelegationRequestHash(p.Provider, p.Beneficiary, p.AmountYNXT, p.PolicyHash, p.IdempotencyKey) {
			return nil, errors.New("Resource delegation request hash mismatch")
		}
		return json.Marshal(p)
	case ActionResourceRent:
		var p ResourceRentalPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.Address = strings.ToLower(strings.TrimSpace(p.Address))
		p.Provider = strings.TrimSpace(p.Provider)
		p.QuoteID = strings.ToLower(strings.TrimSpace(p.QuoteID))
		p.PolicyHash = strings.ToLower(strings.TrimSpace(p.PolicyHash))
		p.IdempotencyKey = strings.TrimSpace(p.IdempotencyKey)
		p.RequestHash = strings.ToLower(strings.TrimSpace(p.RequestHash))
		p.QuoteExpiresAt = p.QuoteExpiresAt.UTC()
		if !IsNativeAddress(p.Address) || !validResourceAccount(p.Provider) || p.Bandwidth < 0 || p.Compute < 0 || p.AICredits < 0 || p.TrustCredits < 0 {
			return nil, errors.New("invalid Resource rental identity or amount")
		}
		if p.Bandwidth == 0 && p.Compute == 0 && p.AICredits == 0 && p.TrustCredits == 0 || !payIDPattern.MatchString(p.QuoteID) || p.QuoteExpiresAt.IsZero() || p.MaxPriceYNXT <= 0 {
			return nil, errors.New("Resource rental requires resources, quote metadata, and positive max price")
		}
		if !payHashPattern.MatchString(p.PolicyHash) || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid Resource rental policy or idempotency key")
		}
		if p.RequestHash != ResourceRentalRequestHash(p.Address, p.Provider, p.Bandwidth, p.Compute, p.AICredits, p.TrustCredits, p.QuoteID, p.QuoteExpiresAt, p.PolicyHash, p.MaxPriceYNXT, p.IdempotencyKey) {
			return nil, errors.New("Resource rental request hash mismatch")
		}
		return json.Marshal(p)
	case ActionResourcePoolCreate:
		var p ResourcePoolCreatePayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.PoolType, p.Name, p.IdempotencyKey = strings.ToLower(strings.TrimSpace(p.PoolType)), strings.TrimSpace(p.Name), strings.TrimSpace(p.IdempotencyKey)
		p.ExpiresAt = p.ExpiresAt.UTC()
		var err error
		if p.AllowedBeneficiaries, err = canonicalResourceBeneficiaries(p.AllowedBeneficiaries); err != nil {
			return nil, err
		}
		if p.AllowedScopes, err = canonicalResourceSet(p.AllowedScopes, bftResourceScopes, "scope"); err != nil {
			return nil, err
		}
		if p.AllowedResourceTypes, err = canonicalResourceSet(p.AllowedResourceTypes, bftResourceTypes, "resource type"); err != nil {
			return nil, err
		}
		if p.PoolType != "merchant" && p.PoolType != "dapp" || p.Name == "" || len(p.Name) > 100 || p.ExpiresAt.IsZero() || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid Resource sponsor pool identity, expiry, or idempotency key")
		}
		if p.Public == (len(p.AllowedBeneficiaries) != 0) || !validBFTResourceUnits(p.CumulativeAllowance, true) || !validBFTResourceUnits(p.PerActionLimit, true) || !resourceUnitsWithin(p.PerActionLimit, p.CumulativeAllowance) || !resourceUnitsMatchTypes(p.PerActionLimit, p.AllowedResourceTypes, true) || !resourceUnitsMatchTypes(p.CumulativeAllowance, p.AllowedResourceTypes, false) {
			return nil, errors.New("invalid Resource sponsor pool policy or allowance")
		}
		return json.Marshal(p)
	case ActionResourcePoolFund:
		var p ResourcePoolFundPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.PoolID, p.ExpectedPolicyHash, p.IdempotencyKey = strings.TrimSpace(p.PoolID), strings.ToLower(strings.TrimSpace(p.ExpectedPolicyHash)), strings.TrimSpace(p.IdempotencyKey)
		if !validBFTResourcePoolID(p.PoolID) || !validResourceHash(p.ExpectedPolicyHash) || !validResourceIdempotencyKey(p.IdempotencyKey) || !validBFTResourceUnits(p.Additional, true) {
			return nil, errors.New("invalid Resource pool funding payload")
		}
		return json.Marshal(p)
	case ActionResourcePoolPolicy:
		var p ResourcePoolPolicyPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.PoolID, p.ExpectedPolicyHash, p.IdempotencyKey, p.ExpiresAt = strings.TrimSpace(p.PoolID), strings.ToLower(strings.TrimSpace(p.ExpectedPolicyHash)), strings.TrimSpace(p.IdempotencyKey), p.ExpiresAt.UTC()
		var err error
		if p.AllowedBeneficiaries, err = canonicalResourceBeneficiaries(p.AllowedBeneficiaries); err != nil {
			return nil, err
		}
		if p.AllowedScopes, err = canonicalResourceSet(p.AllowedScopes, bftResourceScopes, "scope"); err != nil {
			return nil, err
		}
		if p.AllowedResourceTypes, err = canonicalResourceSet(p.AllowedResourceTypes, bftResourceTypes, "resource type"); err != nil {
			return nil, err
		}
		if !validBFTResourcePoolID(p.PoolID) || !validResourceHash(p.ExpectedPolicyHash) || !validResourceIdempotencyKey(p.IdempotencyKey) || p.ExpiresAt.IsZero() || p.Public == (len(p.AllowedBeneficiaries) != 0) || !validBFTResourceUnits(p.PerActionLimit, true) || !resourceUnitsMatchTypes(p.PerActionLimit, p.AllowedResourceTypes, true) {
			return nil, errors.New("invalid Resource pool policy payload")
		}
		return json.Marshal(p)
	case ActionResourcePoolStatus:
		var p ResourcePoolStatusPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.PoolID, p.Status, p.ExpectedPolicyHash, p.IdempotencyKey = strings.TrimSpace(p.PoolID), strings.ToLower(strings.TrimSpace(p.Status)), strings.ToLower(strings.TrimSpace(p.ExpectedPolicyHash)), strings.TrimSpace(p.IdempotencyKey)
		if !validBFTResourcePoolID(p.PoolID) || p.Status != "active" && p.Status != "paused" && p.Status != "revoked" || !validResourceHash(p.ExpectedPolicyHash) || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid Resource pool status payload")
		}
		return json.Marshal(p)
	case ActionResourceSponsor:
		var p ResourceSponsorshipPayload
		if err := decodeCanonicalPayload(raw, &p); err != nil {
			return nil, err
		}
		p.PoolID, p.Scope, p.ResourceType, p.ActionReference, p.IdempotencyKey = strings.TrimSpace(p.PoolID), strings.ToLower(strings.TrimSpace(p.Scope)), strings.ToLower(strings.TrimSpace(p.ResourceType)), strings.TrimSpace(p.ActionReference), strings.TrimSpace(p.IdempotencyKey)
		beneficiary, err := accountaddress.Normalize(p.Beneficiary)
		if err != nil {
			return nil, errors.New("Resource sponsorship beneficiary must be canonical")
		}
		p.Beneficiary = beneficiary
		_, scopeOK := bftResourceScopes[p.Scope]
		_, typeOK := bftResourceTypes[p.ResourceType]
		if p.PoolID != "" && !validBFTResourcePoolID(p.PoolID) || !scopeOK || !typeOK || p.Amount <= 0 || p.Amount > math.MaxInt32 || len(p.ActionReference) < 3 || len(p.ActionReference) > 160 || !validResourceIdempotencyKey(p.IdempotencyKey) {
			return nil, errors.New("invalid Resource sponsorship payload")
		}
		return json.Marshal(p)
	default:
		return nil, fmt.Errorf("unsupported Resource action %q", action)
	}
}

func canonicalResourceBeneficiaries(values []string) ([]string, error) {
	out, seen := make([]string, 0, len(values)), map[string]struct{}{}
	for _, value := range values {
		normalized, err := accountaddress.Normalize(value)
		if err != nil {
			return nil, errors.New("Resource pool beneficiary must be canonical")
		}
		if _, ok := seen[normalized]; !ok {
			seen[normalized] = struct{}{}
			out = append(out, normalized)
		}
	}
	sort.Strings(out)
	if len(out) > 256 {
		return nil, errors.New("Resource pool beneficiary list exceeds 256")
	}
	return out, nil
}

func canonicalResourceSet(values []string, allowed map[string]struct{}, label string) ([]string, error) {
	out, seen := make([]string, 0, len(values)), map[string]struct{}{}
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if _, ok := allowed[value]; !ok {
			return nil, fmt.Errorf("unsupported Resource %s %q", label, value)
		}
		if _, ok := seen[value]; !ok {
			seen[value] = struct{}{}
			out = append(out, value)
		}
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil, fmt.Errorf("Resource pool requires at least one %s", label)
	}
	return out, nil
}

func validBFTResourcePoolID(value string) bool {
	return strings.HasPrefix(value, "rsp_") && len(value) == 28 && payIDPattern.MatchString(strings.TrimPrefix(value, "rsp_"))
}
func validResourceHash(value string) bool { return payHashPattern.MatchString(value) }

func validBFTResourceUnits(value chain.ResourceUnits, positive bool) bool {
	values := []int64{value.Bandwidth, value.Compute, value.AICredits, value.TrustCredits}
	hasPositive := false
	for _, amount := range values {
		if amount < 0 || amount > math.MaxInt32 {
			return false
		}
		hasPositive = hasPositive || amount > 0
	}
	return !positive || hasPositive
}

func resourceUnitsWithin(value, limit chain.ResourceUnits) bool {
	return value.Bandwidth <= limit.Bandwidth && value.Compute <= limit.Compute && value.AICredits <= limit.AICredits && value.TrustCredits <= limit.TrustCredits
}

func resourceUnitAmount(value chain.ResourceUnits, kind string) int64 {
	switch kind {
	case "bandwidth":
		return value.Bandwidth
	case "compute":
		return value.Compute
	case "ai_credits":
		return value.AICredits
	case "trust_credits":
		return value.TrustCredits
	}
	return 0
}

func resourceUnitsMatchTypes(value chain.ResourceUnits, types []string, exact bool) bool {
	for kind := range bftResourceTypes {
		allowed := containsSortedString(types, kind)
		if exact && allowed != (resourceUnitAmount(value, kind) > 0) || !exact && !allowed && resourceUnitAmount(value, kind) != 0 || !exact && allowed && resourceUnitAmount(value, kind) <= 0 {
			return false
		}
	}
	return true
}

func containsSortedString(values []string, target string) bool {
	i := sort.SearchStrings(values, target)
	return i < len(values) && values[i] == target
}

func validResourceAccount(value string) bool {
	return value != "" && len(value) <= 128 && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\t\r\n ")
}

func validResourceIdempotencyKey(value string) bool {
	return len(value) >= 3 && len(value) <= 128 && strings.TrimSpace(value) == value
}
