package assetauth

import (
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	UserOperationVersion = 1
	SignatureEd25519     = "ed25519"
	SignatureP256SHA256  = "p256-sha256"
)

type SmartAccount struct {
	SchemaVersion  int                    `json:"schemaVersion"`
	ChainID        string                 `json:"chainId"`
	Address        string                 `json:"address"`
	OwnerAlgorithm string                 `json:"ownerAlgorithm"`
	OwnerPublicKey []byte                 `json:"ownerPublicKey"`
	NonceByDomain  map[string]uint64      `json:"nonceByDomain"`
	SessionKeys    map[string]SessionKey  `json:"sessionKeys"`
	Recovery       GuardianRecoveryPolicy `json:"recovery"`
	CreatedAt      time.Time              `json:"createdAt"`
}

type SessionKey struct {
	ID             string     `json:"id"`
	Algorithm      string     `json:"algorithm"`
	PublicKey      []byte     `json:"publicKey"`
	Scopes         []string   `json:"scopes"`
	NonceDomain    string     `json:"nonceDomain"`
	SpendLimitYNXT uint64     `json:"spendLimitYnxt"`
	SpentYNXT      uint64     `json:"spentYnxt"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	RevokedAt      *time.Time `json:"revokedAt,omitempty"`
}

type AccountCall struct {
	Target      string `json:"target"`
	Method      string `json:"method"`
	ValueYNXT   uint64 `json:"valueYnxt"`
	Asset       string `json:"asset,omitempty"`
	PayloadHash string `json:"payloadHash"`
}

type UserOperation struct {
	Version         int           `json:"version"`
	ChainID         string        `json:"chainId"`
	Account         string        `json:"account"`
	ProductID       string        `json:"productId"`
	NonceDomain     string        `json:"nonceDomain"`
	Nonce           uint64        `json:"nonce"`
	Calls           []AccountCall `json:"calls"`
	MaxFeeYNXT      uint64        `json:"maxFeeYnxt"`
	ValidAfter      time.Time     `json:"validAfter"`
	ValidUntil      time.Time     `json:"validUntil"`
	SessionKeyID    string        `json:"sessionKeyId,omitempty"`
	PaymasterPolicy string        `json:"paymasterPolicy,omitempty"`
	Signature       []byte        `json:"signature"`
}

func (account SmartAccount) Validate() error {
	if account.SchemaVersion != 1 || account.ChainID != MandateChainID || account.Address == "" || account.CreatedAt.IsZero() {
		return errors.New("smart account identity is invalid")
	}
	if err := validatePublicKey(account.OwnerAlgorithm, account.OwnerPublicKey); err != nil {
		return fmt.Errorf("smart account owner key: %w", err)
	}
	for domain := range account.NonceByDomain {
		if strings.TrimSpace(domain) == "" {
			return errors.New("smart account nonce domain is empty")
		}
	}
	for id, session := range account.SessionKeys {
		if id != session.ID || session.ID == "" || session.NonceDomain == "" || session.ExpiresAt.IsZero() || !isNormalizedSet(session.Scopes) {
			return errors.New("smart account session key is invalid")
		}
		if err := validatePublicKey(session.Algorithm, session.PublicKey); err != nil {
			return err
		}
		for _, scope := range session.Scopes {
			if scope == "*" || strings.Contains(scope, "**") || !strings.Contains(scope, ":") {
				return errors.New("wildcard or malformed session scope is forbidden")
			}
		}
		if session.SpentYNXT > session.SpendLimitYNXT {
			return errors.New("session spend exceeds its limit")
		}
	}
	return account.Recovery.Validate()
}

func (operation UserOperation) SigningBytes() ([]byte, error) {
	clone := operation
	clone.Signature = nil
	if err := clone.validateFields(); err != nil {
		return nil, err
	}
	payload, err := json.Marshal(clone)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(append([]byte("YNX_USER_OPERATION_V1\x00"), payload...))
	return sum[:], nil
}

func (operation UserOperation) validateFields() error {
	if operation.Version != UserOperationVersion || operation.ChainID != MandateChainID || operation.Account == "" || operation.ProductID == "" || operation.NonceDomain == "" || len(operation.Calls) == 0 {
		return errors.New("user operation identity is invalid")
	}
	if operation.ValidAfter.IsZero() || operation.ValidUntil.IsZero() || !operation.ValidUntil.After(operation.ValidAfter) {
		return errors.New("user operation validity window is invalid")
	}
	var total uint64
	for _, call := range operation.Calls {
		if call.Target == "" || call.Method == "" || len(call.PayloadHash) != sha256.Size*2 || strings.ToLower(call.PayloadHash) != call.PayloadHash {
			return errors.New("user operation call is invalid")
		}
		if _, err := hex.DecodeString(call.PayloadHash); err != nil {
			return errors.New("user operation payload hash is invalid")
		}
		if ^uint64(0)-total < call.ValueYNXT {
			return errors.New("user operation value overflow")
		}
		total += call.ValueYNXT
	}
	return nil
}

func (account SmartAccount) AuthorizeUserOperation(operation UserOperation, at time.Time) (SmartAccount, error) {
	if err := account.Validate(); err != nil {
		return account, err
	}
	account = account.clone()
	if err := operation.validateFields(); err != nil {
		return account, err
	}
	if operation.Account != account.Address || at.Before(operation.ValidAfter) || !at.Before(operation.ValidUntil) {
		return account, errors.New("user operation account or validity window mismatch")
	}
	expectedNonce := account.NonceByDomain[operation.NonceDomain]
	if operation.Nonce != expectedNonce {
		return account, errors.New("user operation nonce mismatch")
	}
	algorithm, publicKey := account.OwnerAlgorithm, account.OwnerPublicKey
	if operation.SessionKeyID != "" {
		session, ok := account.SessionKeys[operation.SessionKeyID]
		if !ok || session.RevokedAt != nil || !at.Before(session.ExpiresAt) || session.NonceDomain != operation.NonceDomain {
			return account, errors.New("session key is absent, revoked, expired, or in the wrong nonce domain")
		}
		var value uint64
		for _, call := range operation.Calls {
			scope := strings.ToLower(strings.TrimSpace(call.Target)) + ":" + strings.ToLower(strings.TrimSpace(call.Method))
			if !containsString(session.Scopes, scope) {
				return account, fmt.Errorf("session key does not allow scope %s", scope)
			}
			if ^uint64(0)-value < call.ValueYNXT {
				return account, errors.New("session value overflow")
			}
			value += call.ValueYNXT
		}
		if value > session.SpendLimitYNXT-session.SpentYNXT {
			return account, errors.New("session spend limit exceeded")
		}
		session.SpentYNXT += value
		account.SessionKeys[session.ID] = session
		algorithm, publicKey = session.Algorithm, session.PublicKey
	}
	message, err := operation.SigningBytes()
	if err != nil {
		return account, err
	}
	if err := verifySignature(algorithm, publicKey, message, operation.Signature); err != nil {
		return account, err
	}
	account.NonceByDomain[operation.NonceDomain] = expectedNonce + 1
	return account, nil
}

func (account SmartAccount) RevokeSession(ownerOperation bool, sessionID string, at time.Time) (SmartAccount, error) {
	if !ownerOperation {
		return account, errors.New("session revocation requires an owner-authorized operation")
	}
	session, ok := account.SessionKeys[sessionID]
	if !ok {
		return account, errors.New("session key not found")
	}
	if session.RevokedAt == nil {
		value := at.UTC()
		session.RevokedAt = &value
		account.SessionKeys[sessionID] = session
	}
	return account, nil
}

func validatePublicKey(algorithm string, publicKey []byte) error {
	switch algorithm {
	case SignatureEd25519:
		if len(publicKey) != ed25519.PublicKeySize {
			return errors.New("Ed25519 public key length is invalid")
		}
	case SignatureP256SHA256:
		if x, y := elliptic.UnmarshalCompressed(elliptic.P256(), publicKey); x == nil || y == nil {
			return errors.New("P-256 public key is invalid")
		}
	default:
		return errors.New("signature algorithm is unsupported")
	}
	return nil
}

func verifySignature(algorithm string, publicKey, message, signature []byte) error {
	switch algorithm {
	case SignatureEd25519:
		if !ed25519.Verify(ed25519.PublicKey(publicKey), message, signature) {
			return errors.New("Ed25519 user operation signature is invalid")
		}
	case SignatureP256SHA256:
		x, y := elliptic.UnmarshalCompressed(elliptic.P256(), publicKey)
		if x == nil || !ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, message, signature) {
			return errors.New("P-256 user operation signature is invalid")
		}
	default:
		return errors.New("signature algorithm is unsupported")
	}
	return nil
}

type PaymasterPolicy struct {
	ID                  string            `json:"id"`
	Sponsor             string            `json:"sponsor"`
	Products            []string          `json:"products"`
	Scopes              []string          `json:"scopes"`
	PerAccountBudget    uint64            `json:"perAccountBudgetYnxt"`
	GlobalBudget        uint64            `json:"globalBudgetYnxt"`
	GlobalSpent         uint64            `json:"globalSpentYnxt"`
	AccountSpent        map[string]uint64 `json:"accountSpentYnxt"`
	RequiresAttestation bool              `json:"requiresAttestation"`
	ExpiresAt           time.Time         `json:"expiresAt"`
}

func (policy PaymasterPolicy) SponsorOperation(operation UserOperation, actualFee uint64, attestationHash string, at time.Time) (PaymasterPolicy, error) {
	if policy.ID == "" || policy.Sponsor == "" || !isNormalizedSet(policy.Products) || !isNormalizedSet(policy.Scopes) || policy.PerAccountBudget == 0 || policy.GlobalBudget == 0 || policy.GlobalSpent > policy.GlobalBudget || policy.ExpiresAt.IsZero() {
		return policy, errors.New("paymaster policy is invalid")
	}
	if operation.PaymasterPolicy != policy.ID || !at.Before(policy.ExpiresAt) || actualFee == 0 || actualFee > operation.MaxFeeYNXT || !containsString(policy.Products, operation.ProductID) {
		return policy, errors.New("user operation is not eligible for this paymaster")
	}
	if policy.RequiresAttestation && (len(attestationHash) != sha256.Size*2 || strings.ToLower(attestationHash) != attestationHash) {
		return policy, errors.New("paymaster anti-sybil attestation is required")
	}
	if policy.RequiresAttestation {
		if _, err := hex.DecodeString(attestationHash); err != nil {
			return policy, errors.New("paymaster anti-sybil attestation is invalid")
		}
	}
	for _, call := range operation.Calls {
		scope := strings.ToLower(strings.TrimSpace(call.Target)) + ":" + strings.ToLower(strings.TrimSpace(call.Method))
		if !containsString(policy.Scopes, scope) {
			return policy, errors.New("paymaster scope does not cover every call")
		}
	}
	spent := policy.AccountSpent[operation.Account]
	if spent > policy.PerAccountBudget {
		return policy, errors.New("paymaster account spend exceeds its budget")
	}
	if actualFee > policy.PerAccountBudget-spent || actualFee > policy.GlobalBudget-policy.GlobalSpent {
		return policy, errors.New("paymaster budget exhausted")
	}
	accountSpent := make(map[string]uint64, len(policy.AccountSpent)+1)
	for account, value := range policy.AccountSpent {
		accountSpent[account] = value
	}
	policy.GlobalSpent += actualFee
	policy.AccountSpent = accountSpent
	policy.AccountSpent[operation.Account] = spent + actualFee
	return policy, nil
}

func (account SmartAccount) clone() SmartAccount {
	nonces := make(map[string]uint64, len(account.NonceByDomain))
	for domain, nonce := range account.NonceByDomain {
		nonces[domain] = nonce
	}
	sessions := make(map[string]SessionKey, len(account.SessionKeys))
	for id, session := range account.SessionKeys {
		session.PublicKey = append([]byte(nil), session.PublicKey...)
		session.Scopes = append([]string(nil), session.Scopes...)
		sessions[id] = session
	}
	account.OwnerPublicKey = append([]byte(nil), account.OwnerPublicKey...)
	account.NonceByDomain = nonces
	account.SessionKeys = sessions
	account.Recovery = account.Recovery.clone()
	return account
}

func canonicalScopes(values []string) []string {
	result := normalizedSet(values)
	sort.Strings(result)
	return result
}
