package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

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
	return action == ActionResourceDelegate || action == ActionResourceRent
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
	default:
		return nil, fmt.Errorf("unsupported Resource action %q", action)
	}
}

func validResourceAccount(value string) bool {
	return value != "" && len(value) <= 128 && strings.TrimSpace(value) == value && !strings.ContainsAny(value, "\t\r\n ")
}

func validResourceIdempotencyKey(value string) bool {
	return len(value) >= 3 && len(value) <= 128 && strings.TrimSpace(value) == value
}
