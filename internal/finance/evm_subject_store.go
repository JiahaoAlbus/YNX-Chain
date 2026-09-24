package finance

import (
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

var evmSubjectRequestID = regexp.MustCompile(`^[A-Za-z0-9._~-]{16,128}$`)

// These records are Finance-owned durable state. Only the Wallet/Auth verifier
// may approve a commit; storing or loading a record alone grants no scope.
type EVMSubjectChallengeRecord struct {
	RequestID      string     `json:"requestId"`
	Nonce          string     `json:"nonce"`
	State          string     `json:"state"`
	Account        string     `json:"account"`
	AccountType    string     `json:"accountType"`
	ExactChallenge string     `json:"exactChallenge"`
	IssuedAt       time.Time  `json:"issuedAt"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	AttemptCount   uint8      `json:"attemptCount,omitempty"`
	ConsumedAt     *time.Time `json:"consumedAt,omitempty"`
}

type EVMSubjectSessionRecord struct {
	SessionID    string               `json:"sessionId"`
	RequestID    string               `json:"requestId"`
	SubjectID    string               `json:"subjectId"`
	Account      string               `json:"account"`
	AccountType  string               `json:"accountType"`
	ExactSession string               `json:"exactSession"`
	IssuedAt     time.Time            `json:"issuedAt"`
	ExpiresAt    time.Time            `json:"expiresAt"`
	RevokedAt    *time.Time           `json:"revokedAt,omitempty"`
	ProofNonces  map[string]time.Time `json:"proofNonces,omitempty"`
}

func validateEVMSubjectChallenge(record EVMSubjectChallengeRecord) error {
	if !evmReadToken.MatchString(record.Nonce) || !evmReadToken.MatchString(record.State) || !evmSubjectRequestID.MatchString(record.RequestID) || !accountaddress.IsCanonical(record.Account) || (record.AccountType != "eoa" && record.AccountType != "contract") || len(record.ExactChallenge) == 0 || len(record.ExactChallenge) > maxWalletLoginChallengeBytes {
		return errors.New("EVM subject challenge identity is invalid")
	}
	var exact struct {
		Version     string `json:"version"`
		ProductID   string `json:"productId"`
		Namespace   string `json:"subjectNamespace"`
		Origin      string `json:"origin"`
		Callback    string `json:"callback"`
		ChainID     int    `json:"chainId"`
		Scope       string `json:"scope"`
		RequestID   string `json:"requestId"`
		Nonce       string `json:"nonce"`
		State       string `json:"state"`
		Account     string `json:"account"`
		AccountType string `json:"accountType"`
		IssuedAt    string `json:"issuedAt"`
		ExpiresAt   string `json:"expiresAt"`
	}
	if json.Unmarshal([]byte(record.ExactChallenge), &exact) != nil || exact.Version != "1" || exact.ProductID != "finance" || exact.Namespace != "evm" || exact.Origin != "https://finance.ynxweb4.com" || exact.Callback != "/wallet-auth/callback" || exact.ChainID != 6423 || exact.Scope != "finance.evm.private.read" || exact.RequestID != record.RequestID || exact.Nonce != record.Nonce || exact.State != record.State || exact.Account != record.Account || exact.AccountType != record.AccountType || exact.IssuedAt != evmReadTime(record.IssuedAt) || exact.ExpiresAt != evmReadTime(record.ExpiresAt) {
		return errors.New("EVM subject challenge differs from stored identity")
	}
	if record.IssuedAt.IsZero() || !record.ExpiresAt.After(record.IssuedAt) || record.ExpiresAt.Sub(record.IssuedAt) > 5*time.Minute || record.AttemptCount > 5 || (record.ConsumedAt != nil && (record.AttemptCount == 0 || record.ConsumedAt.Before(record.IssuedAt) || !record.ConsumedAt.Before(record.ExpiresAt))) {
		return errors.New("EVM subject challenge lifetime or attempt count is invalid")
	}
	return nil
}

func validateEVMSubjectSession(record EVMSubjectSessionRecord) error {
	derived, err := DeriveFinanceEVMSubjectID(record.Account)
	if err != nil || !evmReadToken.MatchString(record.SessionID) || !evmSubjectRequestID.MatchString(record.RequestID) || record.SubjectID != derived || (record.AccountType != "eoa" && record.AccountType != "contract") || len(record.ExactSession) == 0 || len(record.ExactSession) > maxWalletLoginChallengeBytes {
		return errors.New("EVM subject session identity is invalid")
	}
	var exact struct {
		Version       string  `json:"version"`
		ProductID     string  `json:"productId"`
		Namespace     string  `json:"subjectNamespace"`
		Origin        string  `json:"origin"`
		ChainID       int     `json:"chainId"`
		Scope         string  `json:"scope"`
		NativeAccount *string `json:"nativeAccount"`
		SessionID     string  `json:"sessionId"`
		SubjectID     string  `json:"subjectId"`
		Account       string  `json:"account"`
		AccountType   string  `json:"accountType"`
		IssuedAt      string  `json:"issuedAt"`
		ExpiresAt     string  `json:"expiresAt"`
	}
	if json.Unmarshal([]byte(record.ExactSession), &exact) != nil || exact.Version != "1" || exact.ProductID != "finance" || exact.Namespace != "evm" || exact.Origin != "https://finance.ynxweb4.com" || exact.ChainID != 6423 || exact.Scope != "finance.evm.private.read" || exact.NativeAccount != nil || exact.SessionID != record.SessionID || exact.SubjectID != record.SubjectID || exact.Account != record.Account || exact.AccountType != record.AccountType || exact.IssuedAt != evmReadTime(record.IssuedAt) || exact.ExpiresAt != evmReadTime(record.ExpiresAt) {
		return errors.New("EVM subject session differs from stored identity")
	}
	if record.IssuedAt.IsZero() || !record.ExpiresAt.After(record.IssuedAt) || record.ExpiresAt.Sub(record.IssuedAt) > 5*time.Minute || (record.RevokedAt != nil && (record.RevokedAt.Before(record.IssuedAt) || record.RevokedAt.After(record.ExpiresAt))) || len(record.ProofNonces) > 512 {
		return errors.New("EVM subject session lifetime or replay capacity is invalid")
	}
	for nonce, expires := range record.ProofNonces {
		if !evmReadToken.MatchString(nonce) || expires.IsZero() || expires.After(record.ExpiresAt) {
			return errors.New("EVM subject proof nonce is invalid")
		}
	}
	return nil
}

func (s *Store) PutEVMSubjectChallenge(record EVMSubjectChallengeRecord, now time.Time) error {
	if validateEVMSubjectChallenge(record) != nil || record.AttemptCount != 0 || record.ConsumedAt != nil || !record.ExpiresAt.After(now.UTC()) {
		return errors.New("new EVM subject challenge is invalid or expired")
	}
	return s.updateAllState(record.Account, "evm_subject.challenge_issued", record.RequestID, func(state *persistedState) error {
		if state.EVMSubjectChallenges == nil {
			state.EVMSubjectChallenges = map[string]EVMSubjectChallengeRecord{}
		}
		active := 0
		for id, prior := range state.EVMSubjectChallenges {
			if !prior.ExpiresAt.After(now.UTC()) {
				delete(state.EVMSubjectChallenges, id)
			} else if prior.Account == record.Account && prior.ConsumedAt == nil {
				active++
			}
		}
		if active >= 3 || state.EVMSubjectChallenges[record.RequestID].RequestID != "" {
			return errors.New("EVM subject challenge capacity or request ID conflict")
		}
		for _, prior := range state.EVMSubjectChallenges {
			if prior.Nonce == record.Nonce || prior.State == record.State {
				return errors.New("EVM subject challenge nonce or state conflict")
			}
		}
		state.EVMSubjectChallenges[record.RequestID] = record
		return nil
	})
}

func (s *Store) EVMSubjectChallenge(account, requestID string) (EVMSubjectChallengeRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return EVMSubjectChallengeRecord{}, err
	}
	record, ok := s.state.EVMSubjectChallenges[requestID]
	if !ok || record.Account != account {
		return EVMSubjectChallengeRecord{}, errors.New("EVM subject challenge not found")
	}
	return record, nil
}

func (s *Store) ReserveEVMSubjectVerification(account, requestID, nonce string, now time.Time) error {
	return s.updateAllState(account, "evm_subject.verification_attempt", requestID, func(state *persistedState) error {
		record, ok := state.EVMSubjectChallenges[requestID]
		if !ok || record.Account != account || record.Nonce != nonce || record.ConsumedAt != nil || !record.ExpiresAt.After(now.UTC()) || record.AttemptCount >= 5 {
			return errors.New("EVM subject challenge unavailable or attempts exhausted")
		}
		record.AttemptCount++
		state.EVMSubjectChallenges[requestID] = record
		return nil
	})
}

// CommitEVMSubjectSession is called only by the accepted Wallet/Auth verifier's
// synchronous commit callback after both EVM and P-256 signatures pass.
func (s *Store) CommitEVMSubjectSession(record EVMSubjectSessionRecord, nonce, stateToken string, now time.Time) error {
	if validateEVMSubjectSession(record) != nil || record.RevokedAt != nil || len(record.ProofNonces) != 0 || !record.ExpiresAt.After(now.UTC()) {
		return errors.New("new EVM subject session is invalid or expired")
	}
	return s.updateAllState(record.Account, "evm_subject.session_issued", record.SessionID, func(state *persistedState) error {
		challenge, ok := state.EVMSubjectChallenges[record.RequestID]
		if !ok || challenge.Account != record.Account || challenge.AccountType != record.AccountType || challenge.Nonce != nonce || challenge.State != stateToken || challenge.AttemptCount == 0 || challenge.ConsumedAt != nil || !challenge.ExpiresAt.After(now.UTC()) || record.IssuedAt.Before(challenge.IssuedAt) || record.ExpiresAt.After(challenge.ExpiresAt) || state.EVMSubjectSessions[record.SessionID].SessionID != "" {
			return errors.New("EVM subject session cannot consume challenge")
		}
		key := evmSubjectKey(record.Account)
		subject, exists := state.EVMSubjects[key]
		if exists && (subject.SubjectID != record.SubjectID || subject.AccountType != record.AccountType || subject.NativeAccount != nil) {
			return errors.New("EVM subject ownership conflicts with existing identity")
		}
		if state.EVMSubjects == nil {
			state.EVMSubjects = map[string]EVMSubjectRecord{}
		}
		if state.EVMSubjectSessions == nil {
			state.EVMSubjectSessions = map[string]EVMSubjectSessionRecord{}
		}
		if !exists {
			state.EVMSubjects[key] = EVMSubjectRecord{SubjectID: record.SubjectID, EVMAccount: record.Account, AccountType: record.AccountType, ChainID: 6423, NativeAccount: nil, CreatedAt: now.UTC()}
		}
		consumed := now.UTC()
		challenge.ConsumedAt = &consumed
		state.EVMSubjectChallenges[record.RequestID] = challenge
		state.EVMSubjectSessions[record.SessionID] = record
		return nil
	})
}

func (s *Store) EVMSubjectSession(sessionID string) (EVMSubjectSessionRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return EVMSubjectSessionRecord{}, err
	}
	record, ok := s.state.EVMSubjectSessions[sessionID]
	if !ok {
		return EVMSubjectSessionRecord{}, errors.New("EVM subject session not found")
	}
	record.ProofNonces = cloneEVMProofNonces(record.ProofNonces)
	return record, nil
}

// ConsumeEVMSubjectReadProof is called only after Wallet/Auth has verified the
// exact GET target, digest, scope and device signature. The repository CAS
// rechecks the EVM-only identity and consumes the nonce before private data is
// returned; it never authorizes a native account or Broker write.
func (s *Store) ConsumeEVMSubjectReadProof(account, subjectID, sessionID, nonce string, proofExpires, now time.Time) error {
	if !evmReadToken.MatchString(nonce) || !proofExpires.After(now.UTC()) {
		return errors.New("EVM subject read proof nonce or expiry is invalid")
	}
	return s.updateAllState(account, "evm_subject.read_proof_consumed", sessionID, func(state *persistedState) error {
		record, ok := state.EVMSubjectSessions[sessionID]
		subject, subjectOK := state.EVMSubjects[evmSubjectKey(account)]
		if !ok || !subjectOK || record.Account != account || record.SubjectID != subjectID || subject.SubjectID != subjectID || subject.NativeAccount != nil || record.RevokedAt != nil || !record.ExpiresAt.After(now.UTC()) || proofExpires.After(record.ExpiresAt) {
			return errors.New("EVM-only subject session missing, revoked, or expired")
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
			return errors.New("EVM subject read proof replay or capacity exceeded")
		}
		record.ProofNonces[nonce] = proofExpires.UTC()
		state.EVMSubjectSessions[sessionID] = record
		return nil
	})
}

// RevokeEVMSubjectSession consumes the signed revoke nonce and revokes the
// matching EVM-only session in the same CAS mutation.
func (s *Store) RevokeEVMSubjectSession(account, subjectID, sessionID, nonce string, now time.Time) error {
	if !evmReadToken.MatchString(nonce) {
		return errors.New("EVM subject revoke nonce is invalid")
	}
	return s.updateAllState(account, "evm_subject.session_revoked", sessionID, func(state *persistedState) error {
		record, ok := state.EVMSubjectSessions[sessionID]
		subject, subjectOK := state.EVMSubjects[evmSubjectKey(account)]
		if !ok || !subjectOK || record.Account != account || record.SubjectID != subjectID || subject.SubjectID != subjectID || subject.NativeAccount != nil || record.RevokedAt != nil || !record.ExpiresAt.After(now.UTC()) {
			return errors.New("EVM-only subject session missing, revoked, or expired")
		}
		if _, exists := record.ProofNonces[nonce]; exists {
			return errors.New("EVM subject revoke proof replayed")
		}
		revoked := now.UTC()
		record.RevokedAt = &revoked
		if record.ProofNonces == nil {
			record.ProofNonces = map[string]time.Time{}
		}
		record.ProofNonces[nonce] = record.ExpiresAt
		state.EVMSubjectSessions[sessionID] = record
		return nil
	})
}
