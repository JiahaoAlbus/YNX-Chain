package governance

import (
	"crypto/ed25519"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

const (
	SignedDelegationVersion       = "ynx-governance-delegation/v1"
	DelegationOperationRegister   = "register"
	DelegationOperationRedelegate = "redelegate"
	DelegationOperationRevoke     = "revoke"
	maxDelegationLifetime         = 365 * 24 * time.Hour
)

type SignedDelegationEnvelope struct {
	Version             string    `json:"version"`
	Domain              string    `json:"domain"`
	ChainID             string    `json:"chainId"`
	Delegator           string    `json:"delegator"`
	Delegate            string    `json:"delegate"`
	Scope               Scope     `json:"scope"`
	Amount              uint64    `json:"amount"`
	Operation           string    `json:"operation"`
	Revision            uint64    `json:"revision"`
	Nonce               string    `json:"nonce"`
	PublicKey           string    `json:"publicKey"`
	StartsAt            time.Time `json:"startsAt"`
	ExpiresAt           time.Time `json:"expiresAt"`
	DirectVoteOverride  bool      `json:"directVoteOverride"`
	SupersedesAuditHash string    `json:"supersedesAuditHash,omitempty"`
	Signature           string    `json:"signature"`
}

type Delegation struct {
	ID                  string    `json:"id"`
	Version             string    `json:"version"`
	Domain              string    `json:"domain"`
	ChainID             string    `json:"chainId"`
	Delegator           string    `json:"delegator"`
	Delegate            string    `json:"delegate"`
	Scope               Scope     `json:"scope"`
	Amount              uint64    `json:"amount"`
	Operation           string    `json:"operation"`
	Revision            uint64    `json:"revision"`
	Nonce               string    `json:"nonce"`
	PublicKey           string    `json:"publicKey"`
	StartsAt            time.Time `json:"startsAt"`
	ExpiresAt           time.Time `json:"expiresAt"`
	DirectVoteOverride  bool      `json:"directVoteOverride"`
	SupersedesAuditHash string    `json:"supersedesAuditHash,omitempty"`
	Signature           string    `json:"signature"`
	AppliedAt           time.Time `json:"appliedAt"`
	AuditHash           string    `json:"auditHash"`
}

type delegationSigningRecord struct {
	Version             string `json:"version"`
	Domain              string `json:"domain"`
	ChainID             string `json:"chainId"`
	Delegator           string `json:"delegator"`
	Delegate            string `json:"delegate"`
	Scope               Scope  `json:"scope"`
	Amount              uint64 `json:"amount"`
	Operation           string `json:"operation"`
	Revision            uint64 `json:"revision"`
	Nonce               string `json:"nonce"`
	PublicKey           string `json:"publicKey"`
	StartsAt            string `json:"startsAt"`
	ExpiresAt           string `json:"expiresAt"`
	DirectVoteOverride  bool   `json:"directVoteOverride"`
	SupersedesAuditHash string `json:"supersedesAuditHash,omitempty"`
}

func delegationDomain(policy Policy) string {
	return policy.VoteDomain + ".delegation"
}

func DelegationSigningPayload(envelope SignedDelegationEnvelope) ([]byte, error) {
	if envelope.Version != SignedDelegationVersion {
		return nil, fmt.Errorf("%w: unsupported delegation envelope version", ErrInvalid)
	}
	record := delegationSigningRecord{
		Version: envelope.Version, Domain: strings.TrimSpace(envelope.Domain), ChainID: strings.TrimSpace(envelope.ChainID),
		Delegator: strings.TrimSpace(envelope.Delegator), Delegate: strings.TrimSpace(envelope.Delegate), Scope: envelope.Scope,
		Amount: envelope.Amount, Operation: strings.ToLower(strings.TrimSpace(envelope.Operation)), Revision: envelope.Revision,
		Nonce: strings.TrimSpace(envelope.Nonce), PublicKey: strings.TrimSpace(envelope.PublicKey),
		StartsAt: envelope.StartsAt.UTC().Format(time.RFC3339Nano), ExpiresAt: envelope.ExpiresAt.UTC().Format(time.RFC3339Nano),
		DirectVoteOverride: envelope.DirectVoteOverride, SupersedesAuditHash: strings.ToLower(strings.TrimSpace(envelope.SupersedesAuditHash)),
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return nil, err
	}
	return append([]byte("YNX-GOVERNANCE-DELEGATION\x00"), encoded...), nil
}

func SignDelegationEnvelope(envelope SignedDelegationEnvelope, privateKey ed25519.PrivateKey) (SignedDelegationEnvelope, error) {
	if len(privateKey) != ed25519.PrivateKeySize {
		return SignedDelegationEnvelope{}, fmt.Errorf("%w: invalid delegation signing key", ErrInvalid)
	}
	payload, err := DelegationSigningPayload(envelope)
	if err != nil {
		return SignedDelegationEnvelope{}, err
	}
	envelope.Signature = nativewallet.Sign(privateKey, payload)
	return envelope, nil
}

func (s *Service) ApplySignedDelegation(envelope SignedDelegationEnvelope, now time.Time) (Delegation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	if err := validateDelegationEnvelope(envelope, s.policy, now); err != nil {
		return Delegation{}, err
	}
	nonceID := delegationNonceID(envelope)
	if _, exists := s.delegationNonces[nonceID]; exists {
		return Delegation{}, ErrReplay
	}
	key := delegationKey(envelope.Delegator, envelope.Scope)
	current, hasCurrent := s.delegations[key]
	activeCurrent := hasCurrent && current.Operation != DelegationOperationRevoke && current.ExpiresAt.After(now)
	switch envelope.Operation {
	case DelegationOperationRegister:
		if activeCurrent || (!hasCurrent && (envelope.Revision != 1 || envelope.SupersedesAuditHash != "")) || (hasCurrent && (envelope.Revision != current.Revision+1 || !strings.EqualFold(envelope.SupersedesAuditHash, current.AuditHash))) {
			return Delegation{}, ErrConflict
		}
	case DelegationOperationRedelegate:
		if !activeCurrent || envelope.Revision != current.Revision+1 || !strings.EqualFold(envelope.SupersedesAuditHash, current.AuditHash) || envelope.Delegate == current.Delegate {
			return Delegation{}, fmt.Errorf("%w: invalid redelegation", ErrForbidden)
		}
	case DelegationOperationRevoke:
		if !activeCurrent || envelope.Revision != current.Revision+1 || !strings.EqualFold(envelope.SupersedesAuditHash, current.AuditHash) || envelope.Delegate != current.Delegate || envelope.Amount != current.Amount || !envelope.StartsAt.Equal(current.StartsAt) || !envelope.ExpiresAt.Equal(current.ExpiresAt) || envelope.DirectVoteOverride != current.DirectVoteOverride {
			return Delegation{}, fmt.Errorf("%w: invalid delegation revocation", ErrForbidden)
		}
	default:
		return Delegation{}, ErrInvalid
	}
	if envelope.Operation != DelegationOperationRevoke {
		if err := s.validateDelegationTopologyLocked(envelope.Delegator, envelope.Delegate, envelope.Scope, now); err != nil {
			return Delegation{}, err
		}
	}
	record := delegationFromEnvelope(envelope, now)
	s.delegations[key] = record
	s.delegationHistory[key] = append(s.delegationHistory[key], record)
	s.delegationNonces[nonceID] = struct{}{}
	return record, nil
}

func validateDelegationEnvelope(envelope SignedDelegationEnvelope, policy Policy, now time.Time) error {
	if envelope.Version != SignedDelegationVersion || envelope.Domain != delegationDomain(policy) || envelope.ChainID != policy.ChainID || !validGovernanceScope(envelope.Scope) ||
		envelope.Delegator != strings.TrimSpace(envelope.Delegator) || envelope.Delegate != strings.TrimSpace(envelope.Delegate) || envelope.Delegator == "" || envelope.Delegate == "" ||
		envelope.Delegator == envelope.Delegate || envelope.Amount == 0 || envelope.Revision == 0 || len(strings.TrimSpace(envelope.Nonce)) < 16 ||
		envelope.Operation != strings.ToLower(strings.TrimSpace(envelope.Operation)) || envelope.PublicKey != strings.TrimSpace(envelope.PublicKey) ||
		envelope.StartsAt.IsZero() || envelope.ExpiresAt.IsZero() || envelope.StartsAt.After(now.Add(policy.VoteMaxClockSkew)) ||
		!envelope.ExpiresAt.After(now) || !envelope.ExpiresAt.After(envelope.StartsAt) || envelope.ExpiresAt.After(now.Add(maxDelegationLifetime)) {
		return ErrInvalid
	}
	if envelope.Operation == DelegationOperationRevoke && envelope.StartsAt.After(now) {
		return fmt.Errorf("%w: future delegation cannot be revoked as active", ErrForbidden)
	}
	delegatorID, err := GovernanceVoterID(envelope.PublicKey)
	if err != nil || delegatorID != envelope.Delegator {
		return fmt.Errorf("%w: delegator does not match signing key", ErrForbidden)
	}
	payload, err := DelegationSigningPayload(envelope)
	if err != nil || !nativewallet.Verify(envelope.PublicKey, payload, envelope.Signature) {
		return fmt.Errorf("%w: invalid delegation signature", ErrForbidden)
	}
	return nil
}

func (s *Service) validateDelegationTopologyLocked(delegator, delegate string, scope Scope, now time.Time) error {
	for _, current := range s.delegations {
		if current.Scope != scope || current.Operation == DelegationOperationRevoke || !current.ExpiresAt.After(now) || current.Delegator == delegator {
			continue
		}
		if current.Delegator == delegate || current.Delegate == delegator {
			return fmt.Errorf("%w: multi-hop and cyclic delegation are disabled", ErrForbidden)
		}
	}
	return nil
}

func (s *Service) bindPersistentDelegationsLocked(scope Scope, snapshot VotingSnapshot, at time.Time) (VotingSnapshot, error) {
	out := cloneVotingSnapshot(snapshot)
	for key := range s.delegationHistory {
		current, ok := s.delegationAtLocked(key, at)
		if !ok {
			continue
		}
		if current.Scope != scope || current.Operation == DelegationOperationRevoke || current.StartsAt.After(at) || !current.ExpiresAt.After(at) {
			continue
		}
		if out.BasePower[current.Delegator] < current.Amount || out.BasePower[current.Delegate] == 0 {
			return VotingSnapshot{}, fmt.Errorf("%w: persistent delegation is not covered by electorate power", ErrForbidden)
		}
		if supplied := out.Delegations[current.Delegator]; supplied != "" && supplied != current.Delegate {
			return VotingSnapshot{}, fmt.Errorf("%w: electorate conflicts with persistent delegation", ErrConflict)
		}
		out.Delegations[current.Delegator] = current.Delegate
		out.DelegatedPower[current.Delegator] = current.Amount
		out.DelegationOverrides[current.Delegator] = current.DirectVoteOverride
	}
	return out, nil
}

func (s *Service) delegationAtLocked(key string, at time.Time) (Delegation, bool) {
	var selected Delegation
	found := false
	for _, record := range s.delegationHistory[key] {
		if record.AppliedAt.After(at) {
			continue
		}
		if !found || record.AppliedAt.After(selected.AppliedAt) || (record.AppliedAt.Equal(selected.AppliedAt) && record.Revision > selected.Revision) {
			selected, found = record, true
		}
	}
	return selected, found
}

func (s *Service) ListDelegations() []Delegation {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out []Delegation
	for _, history := range s.delegationHistory {
		out = append(out, history...)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].AppliedAt.Equal(out[j].AppliedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].AppliedAt.Before(out[j].AppliedAt)
	})
	return out
}

func (s *Service) PublicDelegations() []Delegation {
	return s.ListDelegations()
}

func (s *Service) restoreDelegation(record Delegation) error {
	if record.ID != hash("delegation", record.Delegator, string(record.Scope), fmt.Sprint(record.Revision)) || record.AuditHash != delegationAudit(record) || record.AppliedAt.IsZero() {
		return fmt.Errorf("%w: invalid stored delegation audit", ErrForbidden)
	}
	envelope := delegationEnvelope(record)
	if err := validateDelegationEnvelope(envelope, s.policy, record.AppliedAt); err != nil {
		return fmt.Errorf("%w: invalid stored signed delegation: %v", ErrForbidden, err)
	}
	nonceID := delegationNonceID(envelope)
	if _, exists := s.delegationNonces[nonceID]; exists {
		return ErrReplay
	}
	key := delegationKey(record.Delegator, record.Scope)
	current, hasCurrent := s.delegations[key]
	if !hasCurrent {
		if record.Operation != DelegationOperationRegister || record.Revision != 1 || record.SupersedesAuditHash != "" {
			return fmt.Errorf("%w: invalid initial delegation revision", ErrForbidden)
		}
	} else {
		validSuccessor := record.Operation == DelegationOperationRedelegate || record.Operation == DelegationOperationRevoke || (record.Operation == DelegationOperationRegister && !current.ExpiresAt.After(record.AppliedAt))
		if !validSuccessor || record.Revision != current.Revision+1 || !strings.EqualFold(record.SupersedesAuditHash, current.AuditHash) {
			return fmt.Errorf("%w: invalid delegation revision chain", ErrForbidden)
		}
		if record.Operation == DelegationOperationRedelegate && record.Delegate == current.Delegate {
			return fmt.Errorf("%w: redelegation did not change delegate", ErrForbidden)
		}
		if record.Operation == DelegationOperationRevoke && (record.Delegate != current.Delegate || record.Amount != current.Amount || !record.StartsAt.Equal(current.StartsAt) || !record.ExpiresAt.Equal(current.ExpiresAt) || record.DirectVoteOverride != current.DirectVoteOverride) {
			return fmt.Errorf("%w: revocation does not bind prior delegation", ErrForbidden)
		}
	}
	if record.Operation != DelegationOperationRevoke {
		if err := s.validateDelegationTopologyLocked(record.Delegator, record.Delegate, record.Scope, record.AppliedAt); err != nil {
			return err
		}
	}
	s.delegations[key] = record
	s.delegationHistory[key] = append(s.delegationHistory[key], record)
	s.delegationNonces[nonceID] = struct{}{}
	return nil
}

func delegationFromEnvelope(envelope SignedDelegationEnvelope, appliedAt time.Time) Delegation {
	record := Delegation{
		Version: envelope.Version, Domain: envelope.Domain, ChainID: envelope.ChainID, Delegator: envelope.Delegator,
		Delegate: envelope.Delegate, Scope: envelope.Scope, Amount: envelope.Amount, Operation: envelope.Operation,
		Revision: envelope.Revision, Nonce: envelope.Nonce, PublicKey: envelope.PublicKey, StartsAt: envelope.StartsAt.UTC(),
		ExpiresAt: envelope.ExpiresAt.UTC(), DirectVoteOverride: envelope.DirectVoteOverride,
		SupersedesAuditHash: strings.ToLower(envelope.SupersedesAuditHash), Signature: envelope.Signature, AppliedAt: appliedAt.UTC(),
	}
	record.ID = hash("delegation", record.Delegator, string(record.Scope), fmt.Sprint(record.Revision))
	record.AuditHash = delegationAudit(record)
	return record
}

func delegationEnvelope(record Delegation) SignedDelegationEnvelope {
	return SignedDelegationEnvelope{
		Version: record.Version, Domain: record.Domain, ChainID: record.ChainID, Delegator: record.Delegator, Delegate: record.Delegate,
		Scope: record.Scope, Amount: record.Amount, Operation: record.Operation, Revision: record.Revision, Nonce: record.Nonce,
		PublicKey: record.PublicKey, StartsAt: record.StartsAt, ExpiresAt: record.ExpiresAt, DirectVoteOverride: record.DirectVoteOverride,
		SupersedesAuditHash: record.SupersedesAuditHash, Signature: record.Signature,
	}
}

func delegationKey(delegator string, scope Scope) string {
	return delegator + "\x00" + string(scope)
}

func delegationNonceID(envelope SignedDelegationEnvelope) string {
	return hash("delegation-nonce", envelope.ChainID, envelope.Domain, envelope.Delegator, string(envelope.Scope), envelope.Nonce)
}

func delegationAudit(record Delegation) string {
	return hash(record.ID, record.Version, record.Domain, record.ChainID, record.Delegator, record.Delegate, string(record.Scope),
		fmt.Sprint(record.Amount), record.Operation, fmt.Sprint(record.Revision), record.Nonce, record.PublicKey,
		record.StartsAt.Format(time.RFC3339Nano), record.ExpiresAt.Format(time.RFC3339Nano), fmt.Sprint(record.DirectVoteOverride),
		record.SupersedesAuditHash, record.Signature, record.AppliedAt.Format(time.RFC3339Nano))
}

func validGovernanceScope(scope Scope) bool {
	switch scope {
	case ScopeProtocolUpgrade, ScopeConsensusUpgrade, ScopeGenesis, ScopeEconomics, ScopeTreasury, ScopeStablecoin, ScopeOracle,
		ScopeBridge, ScopeExchange, ScopeDEX, ScopeVault, ScopeSafety, ScopeServiceSecurity, ScopeResource, ScopeProductRegistry,
		ScopeGrants, ScopeRetentionPolicy, ScopeSecurityPolicy, ScopeReleasePolicy:
		return true
	default:
		return false
	}
}
