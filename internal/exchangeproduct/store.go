package exchangeproduct

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

type idempotencyRecord struct {
	Action   string `json:"action"`
	Digest   string `json:"digest"`
	ObjectID string `json:"objectId"`
}

type persistentState struct {
	SchemaVersion  int                          `json:"schemaVersion"`
	Sequence       int64                        `json:"sequence"`
	CustodyAddress string                       `json:"custodyAddress"`
	Challenges     map[string]WalletChallenge   `json:"challenges"`
	Sessions       map[string]WalletSession     `json:"sessions"`
	Balances       map[string]Balance           `json:"balances"`
	Ledger         []LedgerEntry                `json:"ledger"`
	DepositIntents map[string]DepositIntent     `json:"depositIntents"`
	Deposits       map[string]Deposit           `json:"deposits"`
	Withdrawals    map[string]Withdrawal        `json:"withdrawals"`
	Orders         map[string]Order             `json:"orders"`
	Trades         []Trade                      `json:"trades"`
	Fees           []FeeRecord                  `json:"fees"`
	Security       map[string]SecuritySettings  `json:"security"`
	Support        map[string]SupportCase       `json:"support"`
	AI             map[string]AIRecord          `json:"ai"`
	Idempotency    map[string]idempotencyRecord `json:"idempotency"`
	Audit          []AuditEvent                 `json:"audit"`
	IntegrityHash  string                       `json:"integrityHash"`
}

func newState() persistentState {
	return persistentState{SchemaVersion: 1, CustodyAddress: "", Challenges: map[string]WalletChallenge{}, Sessions: map[string]WalletSession{}, Balances: map[string]Balance{}, Ledger: []LedgerEntry{}, DepositIntents: map[string]DepositIntent{}, Deposits: map[string]Deposit{}, Withdrawals: map[string]Withdrawal{}, Orders: map[string]Order{}, Trades: []Trade{}, Fees: []FeeRecord{}, Security: map[string]SecuritySettings{}, Support: map[string]SupportCase{}, AI: map[string]AIRecord{}, Idempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
}

func normalizeState(s *persistentState) {
	if s.Challenges == nil {
		s.Challenges = map[string]WalletChallenge{}
	}
	if s.Sessions == nil {
		s.Sessions = map[string]WalletSession{}
	}
	if s.Balances == nil {
		s.Balances = map[string]Balance{}
	}
	if s.Ledger == nil {
		s.Ledger = []LedgerEntry{}
	}
	if s.DepositIntents == nil {
		s.DepositIntents = map[string]DepositIntent{}
	}
	if s.Deposits == nil {
		s.Deposits = map[string]Deposit{}
	}
	if s.Withdrawals == nil {
		s.Withdrawals = map[string]Withdrawal{}
	}
	if s.Orders == nil {
		s.Orders = map[string]Order{}
	}
	if s.Trades == nil {
		s.Trades = []Trade{}
	}
	if s.Fees == nil {
		s.Fees = []FeeRecord{}
	}
	if s.Security == nil {
		s.Security = map[string]SecuritySettings{}
	}
	if s.Support == nil {
		s.Support = map[string]SupportCase{}
	}
	if s.AI == nil {
		s.AI = map[string]AIRecord{}
	}
	if s.Idempotency == nil {
		s.Idempotency = map[string]idempotencyRecord{}
	}
	if s.Audit == nil {
		s.Audit = []AuditEvent{}
	}
}

func normalizeAuditChain(s *persistentState) (bool, error) {
	changed := false
	previous := ""
	for i := range s.Audit {
		e := s.Audit[i]
		if e.Hash == "" { // migrate schema-v1 events created before per-event chaining
			e.PreviousHash = previous
			e.Hash = digest(e)
			s.Audit[i] = e
			changed = true
		} else {
			if e.PreviousHash != previous {
				return false, errors.New("exchange audit chain verification failed")
			}
			stored := e.Hash
			e.Hash = ""
			if digest(e) != stored {
				return false, errors.New("exchange audit event verification failed")
			}
		}
		previous = s.Audit[i].Hash
	}
	return changed, nil
}

func stateIntegrity(s persistentState) (string, error) {
	s.IntegrityHash = ""
	b, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

func loadState(path string) (persistentState, bool, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return newState(), false, nil
	}
	if err != nil {
		return persistentState{}, false, fmt.Errorf("read exchange state: %w", err)
	}
	var s persistentState
	if err := json.Unmarshal(b, &s); err != nil {
		return persistentState{}, false, fmt.Errorf("decode exchange state: %w", err)
	}
	if s.SchemaVersion != 1 || s.IntegrityHash == "" {
		return persistentState{}, false, errors.New("exchange state schema or integrity hash invalid")
	}
	expected, err := stateIntegrity(s)
	if err != nil || expected != s.IntegrityHash {
		return persistentState{}, false, errors.New("exchange state integrity verification failed")
	}
	normalizeState(&s)
	return s, true, nil
}

func saveState(path string, s *persistentState) error {
	h, err := stateIntegrity(*s)
	if err != nil {
		return err
	}
	s.IntegrityHash = h
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".exchange-state-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if err := f.Chmod(0o600); err != nil {
		f.Close()
		return err
	}
	if _, err := f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
