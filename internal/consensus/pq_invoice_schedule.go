package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const PQInvoiceLedgerStateVersion = 21
const MaxPQInvoiceScheduleBytes = 4096

// This is public configuration, never authority recovered from a transaction.
// Its hash must be independently pinned by every application operator.
type PQInvoiceSchedule struct {
	Version             uint32 `json:"version"`
	ChainID             string `json:"chainId"`
	NativeChainID       int64  `json:"nativeChainId,string"`
	CometGenesisSHA256  string `json:"cometGenesisSHA256"`
	OriginalGenesisHash string `json:"originalGenesisHash"`
	MigrationStateHash  string `json:"migrationStateHash"`
	PreviousHeight      int64  `json:"previousHeight,string"`
	PreviousAppHash     string `json:"previousAppHash"`
	AuthorizedAt        int64  `json:"authorizedAt,string"`
	ActivationHeight    int64  `json:"activationHeight,string"`
}

func (s *PQInvoiceSchedule) Validate() error {
	if s == nil || s.Version != 1 || s.NativeChainID <= 0 || s.ChainID != fmt.Sprintf("ynx_%d-1", s.NativeChainID) || s.PreviousHeight < 0 || s.PreviousHeight == math.MaxInt64 || s.AuthorizedAt != s.PreviousHeight+1 || s.ActivationHeight < s.AuthorizedAt {
		return errors.New("invalid independent invoice schedule")
	}
	for _, h := range []string{s.CometGenesisSHA256, s.OriginalGenesisHash, s.MigrationStateHash, s.PreviousAppHash} {
		if _, err := canonicalBootstrapHash(h); err != nil {
			return err
		}
	}
	return nil
}

func (s *PQInvoiceSchedule) Hash() (string, error) {
	if err := s.Validate(); err != nil {
		return "", err
	}
	raw, err := json.Marshal(struct {
		Domain   string             `json:"domain"`
		Schedule *PQInvoiceSchedule `json:"schedule"`
	}{"YNX-PQ-INVOICE-SCHEDULE/v1", s})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}

type PQInvoiceAuthorization struct {
	schedule PQInvoiceSchedule
	hash     string
}

func NewPQInvoiceAuthorization(raw []byte, expectedHash string) (*PQInvoiceAuthorization, error) {
	if len(raw) == 0 || len(raw) > MaxPQInvoiceScheduleBytes {
		return nil, errors.New("invoice schedule exceeds bounded input")
	}
	if _, err := canonicalBootstrapHash(expectedHash); err != nil {
		return nil, err
	}
	var s PQInvoiceSchedule
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(s)
	if err != nil || !bytes.Equal(raw, canonical) {
		return nil, errors.New("invoice schedule requires exact canonical JSON without duplicate, unknown or trailing fields")
	}
	h, err := s.Hash()
	if err != nil || h != expectedHash {
		return nil, errors.New("invoice schedule differs from independent operator pin")
	}
	return &PQInvoiceAuthorization{schedule: s, hash: h}, nil
}

func (a *PQInvoiceAuthorization) Schedule() (*PQInvoiceSchedule, error) {
	if a == nil {
		return nil, errors.New("missing independent invoice authorization")
	}
	h, err := a.schedule.Hash()
	if err != nil || h != a.hash {
		return nil, errors.New("invalid independent invoice authorization")
	}
	s := a.schedule
	return &s, nil
}

func (a *PQInvoiceAuthorization) ValidateCommittedLedger(ledger *PQInvoiceLedger, height int64) error {
	if a == nil {
		if ledger != nil {
			return errors.New("invoice ledger requires independent operator authorization")
		}
		return nil
	}
	s, err := a.Schedule()
	if err != nil {
		return err
	}
	if ledger == nil {
		if height != s.PreviousHeight {
			return errors.New("invoice authorization requires its exact preceding committed height")
		}
		return nil
	}
	if height < s.AuthorizedAt || !reflect.DeepEqual(ledger.Schedule, s) {
		return errors.New("committed invoice schedule differs from independent operator authorization")
	}
	return nil
}

func validatePQInvoiceSchedule(s *PQInvoiceSchedule, b *ConsensusBootstrap, m chain.ConsensusMigrationState, height int64) error {
	if err := s.Validate(); err != nil {
		return err
	}
	if b == nil || s.ChainID != b.record.ChainID || s.NativeChainID != m.Network.ChainID || s.CometGenesisSHA256 != b.record.CometGenesisSHA256 || s.OriginalGenesisHash != m.OriginalGenesisHash || s.MigrationStateHash != m.StateHash || s.PreviousHeight < int64(m.Height) || height < s.AuthorizedAt {
		return errors.New("invoice schedule is outside original bootstrap or committed height")
	}
	return nil
}

func (a *Application) validateInvoiceAuthorization() error {
	if err := a.pqInvoiceAuthorization.ValidateCommittedLedger(a.committed.InvoiceLedger, a.committed.Height); err != nil {
		return err
	}
	if a.pqInvoiceAuthorization == nil {
		return nil
	}
	s, err := a.pqInvoiceAuthorization.Schedule()
	if err != nil {
		return err
	}
	if err := validatePQInvoiceSchedule(s, a.bootstrap, a.migration, s.AuthorizedAt); err != nil {
		return err
	}
	if a.committed.InvoiceLedger == nil && (!a.committed.Initialized || a.committed.AppHash != s.PreviousAppHash) {
		return errors.New("invoice authorization does not bind the actual initialized preceding AppHash")
	}
	return nil
}

// This gate runs on the actual recovered checkpoint, before recovery Sync or
// exposing a live Application. Saved schedule bytes are never an authorization.
func validateInvoiceStartup(state CommittedState, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, authorization *PQInvoiceAuthorization) error {
	a := &Application{committed: state, migration: migration, bootstrap: bootstrap, pqInvoiceAuthorization: authorization}
	return a.validateInvoiceAuthorization()
}

func (a *Application) preparePQInvoiceExecution(state executionState, height int64) (executionState, error) {
	if err := a.validateInvoiceAuthorization(); err != nil {
		return state, err
	}
	if state.invoiceLedger != nil {
		return state, nil
	}
	if a.pqInvoiceAuthorization == nil {
		return state, nil
	}
	s, err := a.pqInvoiceAuthorization.Schedule()
	if err != nil {
		return state, err
	}
	if height != s.AuthorizedAt || a.committed.Height != s.PreviousHeight || a.committed.AppHash != s.PreviousAppHash || state.hashVersion != 0 {
		return state, errors.New("invoice schedule missed exact authorization height or historical runtime is still active")
	}
	state.invoiceLedger = &PQInvoiceLedger{Schedule: s, Records: []PQInvoiceRecord{}}
	return state, nil
}

func validatePQInvoiceContinuation(previous, next *PQInvoiceLedger) error {
	if previous == nil {
		return nil
	}
	if next == nil || !reflect.DeepEqual(previous.Schedule, next.Schedule) {
		return errors.New("committed invoice schedule cannot be removed or rewritten")
	}
	return nil
}

// Existing constructors remain default-off. This constructor admits only a
// pinned schedule against an existing original checkpoint, never a new chain.
func NewPersistentApplicationWithInvoiceAuthorization(m chain.ConsensusMigrationState, path string, b *ConsensusBootstrap, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization, invoice *PQInvoiceAuthorization) (*Application, error) {
	if invoice == nil || b == nil {
		return nil, errors.New("invoice mode requires independent bootstrap and invoice authorization")
	}
	if runtime != nil {
		if err := validateRuntimeUpgradeBootstrap(m, b, runtime); err != nil {
			return nil, err
		}
	}
	w, err := newValidatedMigration(m, b)
	if err != nil {
		return nil, err
	}
	a, err := newPersistentApplicationOwned(w, path, nil, pq, invoice)
	if err != nil {
		return nil, err
	}
	a.runtimeUpgradeAuthorization = runtime
	if err := a.ValidateNormalRuntime(); err != nil {
		return nil, err
	}
	return a, nil
}

func NewJournaledApplicationWithInvoiceAuthorization(m chain.ConsensusMigrationState, path string, b *ConsensusBootstrap, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization, invoice *PQInvoiceAuthorization) (*Application, error) {
	if invoice == nil || b == nil {
		return nil, errors.New("invoice mode requires independent bootstrap and invoice authorization")
	}
	if runtime != nil {
		if err := validateRuntimeUpgradeBootstrap(m, b, runtime); err != nil {
			return nil, err
		}
	}
	return newJournaledApplicationWithRuntimeAuthority(m, path, b, pq, runtime, false, invoice)
}
