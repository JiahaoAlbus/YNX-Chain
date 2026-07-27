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

const currentStateSchemaVersion = 9

type persistentState struct {
	SchemaVersion      int                          `json:"schemaVersion"`
	Sequence           int64                        `json:"sequence"`
	EventSequence      int64                        `json:"eventSequence"`
	CustodyAddress     string                       `json:"custodyAddress"`
	Challenges         map[string]WalletChallenge   `json:"challenges"`
	Sessions           map[string]WalletSession     `json:"sessions"`
	Balances           map[string]Balance           `json:"balances"`
	Ledger             []LedgerEntry                `json:"ledger"`
	DepositIntents     map[string]DepositIntent     `json:"depositIntents"`
	Deposits           map[string]Deposit           `json:"deposits"`
	Withdrawals        map[string]Withdrawal        `json:"withdrawals"`
	Orders             map[string]Order             `json:"orders"`
	ConditionalOrders  map[string]ConditionalOrder  `json:"conditionalOrders"`
	OCOGroups          map[string]OCOGroup          `json:"ocoGroups"`
	TWAPOrders         map[string]TWAPOrder         `json:"twapOrders"`
	ScaleOrders        map[string]ScaleOrder        `json:"scaleOrders"`
	DeadMan            map[string]DeadManSwitch     `json:"deadMan"`
	QuantStrategyKills map[string]QuantStrategyKill `json:"quantStrategyKills"`
	ExecutionEvents    []ExecutionEvent             `json:"executionEvents"`
	Trades             []Trade                      `json:"trades"`
	Fees               []FeeRecord                  `json:"fees"`
	Security           map[string]SecuritySettings  `json:"security"`
	Support            map[string]SupportCase       `json:"support"`
	AI                 map[string]AIRecord          `json:"ai"`
	Idempotency        map[string]idempotencyRecord `json:"idempotency"`
	Audit              []AuditEvent                 `json:"audit"`
	IntegrityHash      string                       `json:"integrityHash"`
}

// legacyPersistentStateV1 preserves the exact JSON field set and field order
// used by the original exchange state schema. Integrity hashes were computed
// from this shape, so a v1 file must be verified against it before new fields
// are normalized and the state is migrated to the current schema.
type legacyPersistentStateV1 struct {
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

// legacyPersistentStateV8 preserves the exact field set and order emitted by
// schema v8 so its integrity hash can be verified before adding strategy kills.
type legacyPersistentStateV8 struct {
	SchemaVersion     int                          `json:"schemaVersion"`
	Sequence          int64                        `json:"sequence"`
	EventSequence     int64                        `json:"eventSequence"`
	CustodyAddress    string                       `json:"custodyAddress"`
	Challenges        map[string]WalletChallenge   `json:"challenges"`
	Sessions          map[string]WalletSession     `json:"sessions"`
	Balances          map[string]Balance           `json:"balances"`
	Ledger            []LedgerEntry                `json:"ledger"`
	DepositIntents    map[string]DepositIntent     `json:"depositIntents"`
	Deposits          map[string]Deposit           `json:"deposits"`
	Withdrawals       map[string]Withdrawal        `json:"withdrawals"`
	Orders            map[string]Order             `json:"orders"`
	ConditionalOrders map[string]ConditionalOrder  `json:"conditionalOrders"`
	OCOGroups         map[string]OCOGroup          `json:"ocoGroups"`
	TWAPOrders        map[string]TWAPOrder         `json:"twapOrders"`
	ScaleOrders       map[string]ScaleOrder        `json:"scaleOrders"`
	DeadMan           map[string]DeadManSwitch     `json:"deadMan"`
	ExecutionEvents   []ExecutionEvent             `json:"executionEvents"`
	Trades            []Trade                      `json:"trades"`
	Fees              []FeeRecord                  `json:"fees"`
	Security          map[string]SecuritySettings  `json:"security"`
	Support           map[string]SupportCase       `json:"support"`
	AI                map[string]AIRecord          `json:"ai"`
	Idempotency       map[string]idempotencyRecord `json:"idempotency"`
	Audit             []AuditEvent                 `json:"audit"`
	IntegrityHash     string                       `json:"integrityHash"`
}

func newState() persistentState {
	return persistentState{SchemaVersion: currentStateSchemaVersion, CustodyAddress: "", Challenges: map[string]WalletChallenge{}, Sessions: map[string]WalletSession{}, Balances: map[string]Balance{}, Ledger: []LedgerEntry{}, DepositIntents: map[string]DepositIntent{}, Deposits: map[string]Deposit{}, Withdrawals: map[string]Withdrawal{}, Orders: map[string]Order{}, ConditionalOrders: map[string]ConditionalOrder{}, OCOGroups: map[string]OCOGroup{}, TWAPOrders: map[string]TWAPOrder{}, ScaleOrders: map[string]ScaleOrder{}, DeadMan: map[string]DeadManSwitch{}, QuantStrategyKills: map[string]QuantStrategyKill{}, ExecutionEvents: []ExecutionEvent{}, Trades: []Trade{}, Fees: []FeeRecord{}, Security: map[string]SecuritySettings{}, Support: map[string]SupportCase{}, AI: map[string]AIRecord{}, Idempotency: map[string]idempotencyRecord{}, Audit: []AuditEvent{}}
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
	if s.ConditionalOrders == nil {
		s.ConditionalOrders = map[string]ConditionalOrder{}
	}
	if s.OCOGroups == nil {
		s.OCOGroups = map[string]OCOGroup{}
	}
	if s.TWAPOrders == nil {
		s.TWAPOrders = map[string]TWAPOrder{}
	}
	if s.ScaleOrders == nil {
		s.ScaleOrders = map[string]ScaleOrder{}
	}
	if s.DeadMan == nil {
		s.DeadMan = map[string]DeadManSwitch{}
	}
	if s.QuantStrategyKills == nil {
		s.QuantStrategyKills = map[string]QuantStrategyKill{}
	}
	if s.ExecutionEvents == nil {
		s.ExecutionEvents = []ExecutionEvent{}
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

func verifyExecutionChain(s *persistentState) error {
	previous := ""
	var sequence int64
	for _, event := range s.ExecutionEvents {
		if event.Sequence <= sequence || event.PreviousHash != previous || event.Hash == "" {
			return errors.New("exchange execution event chain verification failed")
		}
		stored := event.Hash
		event.Hash = ""
		if digest(event) != stored {
			return errors.New("exchange execution event verification failed")
		}
		sequence = event.Sequence
		previous = stored
	}
	if len(s.ExecutionEvents) > 0 && s.EventSequence < sequence {
		return errors.New("exchange execution sequence invalid")
	}
	return nil
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

func legacyStateV1(s persistentState) legacyPersistentStateV1 {
	return legacyPersistentStateV1{
		SchemaVersion:  s.SchemaVersion,
		Sequence:       s.Sequence,
		CustodyAddress: s.CustodyAddress,
		Challenges:     s.Challenges,
		Sessions:       s.Sessions,
		Balances:       s.Balances,
		Ledger:         s.Ledger,
		DepositIntents: s.DepositIntents,
		Deposits:       s.Deposits,
		Withdrawals:    s.Withdrawals,
		Orders:         s.Orders,
		Trades:         s.Trades,
		Fees:           s.Fees,
		Security:       s.Security,
		Support:        s.Support,
		AI:             s.AI,
		Idempotency:    s.Idempotency,
		Audit:          s.Audit,
		IntegrityHash:  s.IntegrityHash,
	}
}

func legacyStateIntegrityV1(s legacyPersistentStateV1) (string, error) {
	s.IntegrityHash = ""
	b, err := json.Marshal(s)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:]), nil
}

func legacyStateV8(s persistentState) legacyPersistentStateV8 {
	return legacyPersistentStateV8{
		SchemaVersion:     s.SchemaVersion,
		Sequence:          s.Sequence,
		EventSequence:     s.EventSequence,
		CustodyAddress:    s.CustodyAddress,
		Challenges:        s.Challenges,
		Sessions:          s.Sessions,
		Balances:          s.Balances,
		Ledger:            s.Ledger,
		DepositIntents:    s.DepositIntents,
		Deposits:          s.Deposits,
		Withdrawals:       s.Withdrawals,
		Orders:            s.Orders,
		ConditionalOrders: s.ConditionalOrders,
		OCOGroups:         s.OCOGroups,
		TWAPOrders:        s.TWAPOrders,
		ScaleOrders:       s.ScaleOrders,
		DeadMan:           s.DeadMan,
		ExecutionEvents:   s.ExecutionEvents,
		Trades:            s.Trades,
		Fees:              s.Fees,
		Security:          s.Security,
		Support:           s.Support,
		AI:                s.AI,
		Idempotency:       s.Idempotency,
		Audit:             s.Audit,
		IntegrityHash:     s.IntegrityHash,
	}
}

func legacyStateIntegrityV8(s legacyPersistentStateV8) (string, error) {
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
	if s.SchemaVersion < 1 || s.SchemaVersion > currentStateSchemaVersion || s.IntegrityHash == "" {
		return persistentState{}, false, errors.New("exchange state schema or integrity hash invalid")
	}
	expected, err := stateIntegrity(s)
	if err != nil {
		return persistentState{}, false, errors.New("exchange state integrity verification failed")
	}
	if expected != s.IntegrityHash {
		switch s.SchemaVersion {
		case 1:
			var legacy legacyPersistentStateV1
			if err := json.Unmarshal(b, &legacy); err != nil {
				return persistentState{}, false, errors.New("exchange state integrity verification failed")
			}
			legacyExpected, legacyErr := legacyStateIntegrityV1(legacy)
			if legacyErr != nil || legacyExpected != legacy.IntegrityHash {
				return persistentState{}, false, errors.New("exchange state integrity verification failed")
			}
		case 8:
			var legacy legacyPersistentStateV8
			if err := json.Unmarshal(b, &legacy); err != nil {
				return persistentState{}, false, errors.New("exchange state integrity verification failed")
			}
			legacyExpected, legacyErr := legacyStateIntegrityV8(legacy)
			if legacyErr != nil || legacyExpected != legacy.IntegrityHash {
				return persistentState{}, false, errors.New("exchange state integrity verification failed")
			}
		default:
			return persistentState{}, false, errors.New("exchange state integrity verification failed")
		}
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
