package finance

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	walletLoginRequestID = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
	walletLoginNonce     = regexp.MustCompile(`^[A-Za-z0-9]{16,64}$`)
	evmLoginAccount      = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
)

const maxWalletLoginChallengeBytes = 16 << 10

// WalletLoginChallengeRecord is Finance-owned durable state for one exact
// Wallet/Auth-issued EVM product-login challenge. The protocol payload remains
// opaque here: only the exact accepted Wallet package may parse or verify it.
type WalletLoginChallengeRecord struct {
	RequestID      string     `json:"requestId"`
	Nonce          string     `json:"nonce"`
	Account        string     `json:"account"`
	ExactChallenge string     `json:"exactChallenge"`
	IssuedAt       time.Time  `json:"issuedAt"`
	ExpiresAt      time.Time  `json:"expiresAt"`
	ConsumedAt     *time.Time `json:"consumedAt,omitempty"`
}

func validateWalletLoginChallenge(record WalletLoginChallengeRecord) error {
	if !walletLoginRequestID.MatchString(record.RequestID) || !walletLoginNonce.MatchString(record.Nonce) || !evmLoginAccount.MatchString(record.Account) {
		return errors.New("Finance Wallet login challenge identity is invalid")
	}
	if len(record.ExactChallenge) == 0 || len(record.ExactChallenge) > maxWalletLoginChallengeBytes || !json.Valid([]byte(record.ExactChallenge)) {
		return errors.New("Finance Wallet login challenge payload is invalid")
	}
	if record.IssuedAt.IsZero() || record.ExpiresAt.IsZero() || !record.ExpiresAt.After(record.IssuedAt) || record.ExpiresAt.Sub(record.IssuedAt) > 10*time.Minute {
		return errors.New("Finance Wallet login challenge lifetime is invalid")
	}
	if record.ConsumedAt != nil && (record.ConsumedAt.Before(record.IssuedAt) || record.ConsumedAt.After(record.ExpiresAt)) {
		return errors.New("Finance Wallet login challenge consumption time is invalid")
	}
	return nil
}

func cloneWalletLoginChallenge(record WalletLoginChallengeRecord) WalletLoginChallengeRecord {
	if record.ConsumedAt != nil {
		consumed := record.ConsumedAt.UTC()
		record.ConsumedAt = &consumed
	}
	return record
}

func (s *Store) PutWalletLoginChallenge(record WalletLoginChallengeRecord, now time.Time) error {
	record.RequestID = strings.TrimSpace(record.RequestID)
	record.Nonce = strings.TrimSpace(record.Nonce)
	record.Account = strings.ToLower(strings.TrimSpace(record.Account))
	record.IssuedAt = record.IssuedAt.UTC()
	record.ExpiresAt = record.ExpiresAt.UTC()
	if record.ConsumedAt != nil {
		return errors.New("new Finance Wallet login challenge cannot already be consumed")
	}
	if err := validateWalletLoginChallenge(record); err != nil {
		return err
	}
	now = now.UTC()
	if now.Before(record.IssuedAt.Add(-2*time.Minute)) || !record.ExpiresAt.After(now) {
		return errors.New("Finance Wallet login challenge is outside its server lifetime")
	}
	return s.updateAllState(record.Account, "wallet_login.challenge_issued", record.RequestID, func(state *persistedState) error {
		if state.WalletLoginChallenges == nil {
			state.WalletLoginChallenges = map[string]WalletLoginChallengeRecord{}
		}
		for requestID, existing := range state.WalletLoginChallenges {
			if !existing.ExpiresAt.After(now) && existing.ConsumedAt == nil {
				delete(state.WalletLoginChallenges, requestID)
			}
		}
		if _, exists := state.WalletLoginChallenges[record.RequestID]; exists {
			return errors.New("Finance Wallet login requestId already exists")
		}
		for _, existing := range state.WalletLoginChallenges {
			if existing.Nonce == record.Nonce {
				return errors.New("Finance Wallet login nonce already exists")
			}
		}
		state.WalletLoginChallenges[record.RequestID] = cloneWalletLoginChallenge(record)
		return nil
	})
}

func (s *Store) WalletLoginChallenge(account, requestID string) (WalletLoginChallengeRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.refreshLocked(); err != nil {
		return WalletLoginChallengeRecord{}, err
	}
	record, exists := s.state.WalletLoginChallenges[strings.TrimSpace(requestID)]
	if !exists || record.Account != strings.ToLower(strings.TrimSpace(account)) {
		return WalletLoginChallengeRecord{}, errors.New("Finance Wallet login challenge was not found")
	}
	return cloneWalletLoginChallenge(record), nil
}

func (s *Store) ConsumeWalletLoginChallenge(account, requestID, nonce string, now time.Time) error {
	account = strings.ToLower(strings.TrimSpace(account))
	requestID, nonce, now = strings.TrimSpace(requestID), strings.TrimSpace(nonce), now.UTC()
	return s.updateAllState(account, "wallet_login.challenge_consumed", requestID, func(state *persistedState) error {
		record, exists := state.WalletLoginChallenges[requestID]
		if !exists || record.Account != account || record.Nonce != nonce {
			return errors.New("Finance Wallet login challenge binding is invalid")
		}
		if record.ConsumedAt != nil {
			return errors.New("Finance Wallet login challenge was already consumed")
		}
		if now.Before(record.IssuedAt.Add(-2*time.Minute)) || !now.Before(record.ExpiresAt) {
			return errors.New("Finance Wallet login challenge expired or is not active")
		}
		record.ConsumedAt = &now
		state.WalletLoginChallenges[requestID] = record
		return nil
	})
}
