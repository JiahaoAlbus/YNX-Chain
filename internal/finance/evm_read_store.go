package finance

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var evmReadToken = regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`)

// EVMReadChallengeRecord and EVMReadSessionRecord are Finance's durable
// authority records. The exact protocol JSON is opaque here: Wallet/Auth owns
// signature, schema and device-key verification. These records never grant a
// native Product Session v2 scope or a trading/write permission.
type EVMReadChallengeRecord struct {
	RequestID      string     `json:"requestId"`
	Nonce          string     `json:"nonce"`
	State          string     `json:"state"`
	Account        string     `json:"account"`
	ExactChallenge string     `json:"exactChallenge"`
	IssuedAt       time.Time  `json:"issuedAt"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	AttemptCount   uint8      `json:"attemptCount,omitempty"`
	ConsumedAt     *time.Time `json:"consumedAt,omitempty"`
}

type EVMReadSessionRecord struct {
	SessionID    string               `json:"sessionId"`
	RequestID    string               `json:"requestId"`
	Account      string               `json:"account"`
	ExactSession string               `json:"exactSession"`
	IssuedAt     time.Time            `json:"issuedAt"`
	ExpiresAt    time.Time            `json:"expiresAt"`
	ChainID      int                  `json:"chainId"`
	Connected    bool                 `json:"connected"`
	RevokedAt    *time.Time           `json:"revokedAt,omitempty"`
	ProofNonces  map[string]time.Time `json:"proofNonces,omitempty"`
}

func validateEVMReadChallenge(record EVMReadChallengeRecord) error {
	if !walletLoginRequestID.MatchString(record.RequestID) || !evmReadToken.MatchString(record.Nonce) || !evmReadToken.MatchString(record.State) || !evmLoginAccount.MatchString(record.Account) {
		return errors.New("EVM read challenge identity is invalid")
	}
	if len(record.ExactChallenge) == 0 || len(record.ExactChallenge) > maxWalletLoginChallengeBytes || !json.Valid([]byte(record.ExactChallenge)) {
		return errors.New("EVM read challenge JSON is invalid")
	}
	var exact struct {
		RequestID string `json:"requestId"`
		Nonce     string `json:"nonce"`
		State     string `json:"state"`
		Account   string `json:"account"`
		IssuedAt  string `json:"issuedAt"`
		ExpiresAt string `json:"expiresAt"`
	}
	if json.Unmarshal([]byte(record.ExactChallenge), &exact) != nil || exact.RequestID != record.RequestID || exact.Nonce != record.Nonce || exact.State != record.State || exact.Account != record.Account || exact.IssuedAt != evmReadTime(record.IssuedAt) || exact.ExpiresAt != evmReadTime(record.ExpiresAt) {
		return errors.New("EVM read challenge JSON differs from its stored identity")
	}
	if record.IssuedAt.IsZero() || !record.ExpiresAt.After(record.IssuedAt) || record.ExpiresAt.Sub(record.IssuedAt) > 5*time.Minute || record.AttemptCount > 5 {
		return errors.New("EVM read challenge lifetime or attempt count is invalid")
	}
	if record.ConsumedAt != nil && (record.AttemptCount == 0 || record.ConsumedAt.Before(record.IssuedAt) || !record.ConsumedAt.Before(record.ExpiresAt)) {
		return errors.New("EVM read challenge consumption is invalid")
	}
	return nil
}

func validateEVMReadSession(record EVMReadSessionRecord) error {
	if !evmReadToken.MatchString(record.SessionID) || !walletLoginRequestID.MatchString(record.RequestID) || !evmLoginAccount.MatchString(record.Account) || record.ChainID != 6423 || !record.Connected {
		return errors.New("EVM read session identity is invalid")
	}
	if len(record.ExactSession) == 0 || len(record.ExactSession) > maxWalletLoginChallengeBytes || !json.Valid([]byte(record.ExactSession)) {
		return errors.New("EVM read session JSON is invalid")
	}
	var exact struct {
		SessionID string `json:"sessionId"`
		RequestID string `json:"requestId"`
		Account   string `json:"account"`
		ChainID   int    `json:"chainId"`
		IssuedAt  string `json:"issuedAt"`
		ExpiresAt string `json:"expiresAt"`
	}
	if json.Unmarshal([]byte(record.ExactSession), &exact) != nil || exact.SessionID != record.SessionID || exact.RequestID != record.RequestID || exact.Account != record.Account || exact.ChainID != record.ChainID || exact.IssuedAt != evmReadTime(record.IssuedAt) || exact.ExpiresAt != evmReadTime(record.ExpiresAt) {
		return errors.New("EVM read session JSON differs from its stored identity")
	}
	if record.IssuedAt.IsZero() || !record.ExpiresAt.After(record.IssuedAt) || record.ExpiresAt.Sub(record.IssuedAt) > 5*time.Minute {
		return errors.New("EVM read session lifetime is invalid")
	}
	if record.RevokedAt != nil && (record.RevokedAt.Before(record.IssuedAt) || record.RevokedAt.After(record.ExpiresAt)) {
		return errors.New("EVM read session revocation time is invalid")
	}
	if len(record.ProofNonces) > 512 {
		return errors.New("EVM read session proof nonce capacity exceeded")
	}
	for nonce, expires := range record.ProofNonces {
		if !evmReadToken.MatchString(nonce) || expires.IsZero() || expires.After(record.ExpiresAt) {
			return errors.New("EVM read session proof nonce is invalid")
		}
	}
	return nil
}

func (s *Store) PutEVMReadChallenge(record EVMReadChallengeRecord, now time.Time) error {
	if record.ConsumedAt != nil || record.AttemptCount != 0 || validateEVMReadChallenge(record) != nil || !record.ExpiresAt.After(now.UTC()) {
		return errors.New("new EVM read challenge is invalid or expired")
	}
	return s.updateAllState(record.Account, "evm_read.challenge_issued", record.RequestID, func(state *persistedState) error {
		if state.EVMReadChallenges == nil {
			state.EVMReadChallenges = map[string]EVMReadChallengeRecord{}
		}
		active := 0
		for id, previous := range state.EVMReadChallenges {
			if !previous.ExpiresAt.After(now.UTC()) {
				delete(state.EVMReadChallenges, id)
			} else if previous.Account == record.Account && previous.ConsumedAt == nil {
				active++
			}
		}
		if active >= 3 || state.EVMReadChallenges[record.RequestID].RequestID != "" {
			return errors.New("EVM read challenge capacity or request ID conflict")
		}
		for _, previous := range state.EVMReadChallenges {
			if previous.Nonce == record.Nonce || previous.State == record.State {
				return errors.New("EVM read challenge nonce or state already exists")
			}
		}
		state.EVMReadChallenges[record.RequestID] = record
		return nil
	})
}

func (s *Store) EVMReadChallenge(account, requestID string) (EVMReadChallengeRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return EVMReadChallengeRecord{}, err
	}
	record, exists := s.state.EVMReadChallenges[requestID]
	if !exists || record.Account != account {
		return EVMReadChallengeRecord{}, errors.New("EVM read challenge not found")
	}
	return record, nil
}

func (s *Store) ReserveEVMReadVerification(account, requestID, nonce string, now time.Time) error {
	return s.updateAllState(account, "evm_read.verification_attempt", requestID, func(state *persistedState) error {
		record, exists := state.EVMReadChallenges[requestID]
		if !exists || record.Account != account || record.Nonce != nonce || record.ConsumedAt != nil || !record.ExpiresAt.After(now.UTC()) || record.AttemptCount >= 5 {
			return errors.New("EVM read challenge unavailable or verification attempt cap reached")
		}
		record.AttemptCount++
		state.EVMReadChallenges[requestID] = record
		return nil
	})
}

// CommitEVMReadSession is the single repository-CAS mutation that consumes the
// exact server-issued challenge and persists the Wallet/Auth-verified session.
func (s *Store) CommitEVMReadSession(record EVMReadSessionRecord, nonce, stateToken string, now time.Time) error {
	if validateEVMReadSession(record) != nil || record.RevokedAt != nil || len(record.ProofNonces) != 0 || !record.ExpiresAt.After(now.UTC()) {
		return errors.New("new EVM read session is invalid or expired")
	}
	return s.updateAllState(record.Account, "evm_read.session_issued", record.SessionID, func(state *persistedState) error {
		challenge, exists := state.EVMReadChallenges[record.RequestID]
		if !exists || challenge.Account != record.Account || challenge.Nonce != nonce || challenge.State != stateToken || challenge.ConsumedAt != nil || challenge.AttemptCount == 0 || !challenge.ExpiresAt.After(now.UTC()) {
			return errors.New("EVM read challenge is missing, unverified, replayed, or expired")
		}
		if state.EVMReadSessions == nil {
			state.EVMReadSessions = map[string]EVMReadSessionRecord{}
		}
		if _, exists := state.EVMReadSessions[record.SessionID]; exists {
			return errors.New("EVM read session ID already exists")
		}
		consumed := now.UTC()
		challenge.ConsumedAt = &consumed
		state.EVMReadChallenges[record.RequestID] = challenge
		state.EVMReadSessions[record.SessionID] = record
		return nil
	})
}

func (s *Store) EVMReadSession(sessionID string) (EVMReadSessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return EVMReadSessionRecord{}, err
	}
	record, exists := s.state.EVMReadSessions[sessionID]
	if !exists {
		return EVMReadSessionRecord{}, errors.New("EVM read session not found")
	}
	record.ProofNonces = cloneEVMProofNonces(record.ProofNonces)
	return record, nil
}

// ConsumeEVMReadProof must be called only after Wallet/Auth verifies the exact
// request bytes and P-256 device signature. A CAS conflict fails closed.
func (s *Store) ConsumeEVMReadProof(account, sessionID, nonce string, proofExpires, now time.Time) error {
	if !evmReadToken.MatchString(nonce) || !proofExpires.After(now.UTC()) {
		return errors.New("EVM read proof nonce or expiry is invalid")
	}
	return s.updateAllState(account, "evm_read.proof_consumed", sessionID, func(state *persistedState) error {
		record, exists := state.EVMReadSessions[sessionID]
		if !exists || record.Account != account || record.RevokedAt != nil || !record.ExpiresAt.After(now.UTC()) || proofExpires.After(record.ExpiresAt) {
			return errors.New("EVM read session is missing, revoked, or expired")
		}
		if record.ProofNonces == nil {
			record.ProofNonces = map[string]time.Time{}
		}
		for oldNonce, expiry := range record.ProofNonces {
			if !expiry.After(now.UTC()) {
				delete(record.ProofNonces, oldNonce)
			}
		}
		if _, exists := record.ProofNonces[nonce]; exists || len(record.ProofNonces) >= 512 {
			return errors.New("EVM read proof replay or capacity exceeded")
		}
		record.ProofNonces[nonce] = proofExpires.UTC()
		state.EVMReadSessions[sessionID] = record
		return nil
	})
}

// RevokeEVMReadSession is called after the shared authenticated revoke proof
// verifier succeeds. The same repository mutation also consumes its nonce.
func (s *Store) RevokeEVMReadSession(account, sessionID, nonce string, proofExpires, now time.Time) error {
	if !evmReadToken.MatchString(nonce) || !proofExpires.After(now.UTC()) {
		return errors.New("EVM read revoke proof is invalid")
	}
	return s.updateAllState(account, "evm_read.session_revoked", sessionID, func(state *persistedState) error {
		record, exists := state.EVMReadSessions[sessionID]
		if !exists || record.Account != account || record.RevokedAt != nil || !record.ExpiresAt.After(now.UTC()) || proofExpires.After(record.ExpiresAt) {
			return errors.New("EVM read session is missing, revoked, or expired")
		}
		if _, exists := record.ProofNonces[nonce]; exists {
			return errors.New("EVM read revoke proof was replayed")
		}
		revoked := now.UTC()
		record.RevokedAt = &revoked
		if record.ProofNonces == nil {
			record.ProofNonces = map[string]time.Time{}
		}
		record.ProofNonces[nonce] = proofExpires.UTC()
		state.EVMReadSessions[sessionID] = record
		return nil
	})
}

func cloneEVMProofNonces(values map[string]time.Time) map[string]time.Time {
	if values == nil {
		return nil
	}
	cloned := make(map[string]time.Time, len(values))
	for key, value := range values {
		cloned[strings.Clone(key)] = value
	}
	return cloned
}

func evmReadTime(value time.Time) string {
	return value.UTC().Format("2006-01-02T15:04:05.000Z")
}
