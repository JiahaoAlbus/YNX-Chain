package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

const pqTransferMemo = "ynx-pq-transfer-v1:"
const pqMigrationMemo = "ynx-pq-migration-v1:"

func readSnapshotIntegrityVersion(path string) (int, error) {
	if path == "" {
		return 0, nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	switch string(b) {
	case "2\n":
		return 2, nil
	case "3\n":
		return 3, nil
	default:
		return 0, errors.New("invalid snapshot integrity marker")
	}
}

func (d *Devnet) accountExecutionHeightLocked() uint64 {
	h := d.blocks[len(d.blocks)-1].Height
	if h == math.MaxUint64 {
		return h
	}
	return h + 1
}

func (d *Devnet) requireLegacyAccountLocked(owner string) error {
	if d.accountPolicy == nil {
		return nil
	}
	return d.accountPolicy.RequireLegacy(owner, d.accountExecutionHeightLocked())
}

// EnableAccountPQ schedules the protocol in persisted state before admission.
// It is a node/operator rollout API, never an account HTTP request. All nodes
// must receive the same schedule and original genesis identity before cutover.
// An existing schedule cannot be removed or rewritten by restarting a node.
func (d *Devnet) EnableAccountPQ(height uint64) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if height == 0 {
		return errors.New("PQ admission height must be positive")
	}
	if d.accountPolicy != nil {
		if d.accountPolicy.EnableAt != height {
			return errors.New("existing PQ schedule is immutable")
		}
		// A previous rename/marker/sync may have returned UNKNOWN. Equal in-memory
		// configuration is not evidence that the schedule is durable.
		err := d.persistSnapshotLocked()
		d.recordPersistenceErrorLocked(err)
		return err
	}
	if height <= d.blocks[len(d.blocks)-1].Height {
		return errors.New("PQ schedule must be in the future")
	}
	network, err := hex.DecodeString(d.blocks[0].Hash)
	if err != nil || len(network) != 32 {
		return errors.New("original genesis identity is invalid")
	}
	s := ynxauth.State{Version: ynxauth.PolicyVersion, NetworkID: network, EnableAt: height}
	if err = s.Validate(network); err != nil {
		return err
	}
	d.accountPolicy = &s
	err = d.persistSnapshotLocked()
	d.recordPersistenceErrorLocked(err)
	if err != nil && !errors.Is(err, ErrSnapshotDurabilityUncertain) {
		d.accountPolicy = nil
	}
	return err
}

// AccountAuthorization returns public registration metadata and a height from
// one locked snapshot. Callers never receive mutable ledger-owned key buffers.
func (d *Devnet) AccountAuthorization(owner string) (*ynxauth.State, uint64) {
	s, h, _ := d.AccountAuthorizationSnapshot(owner)
	return s, h
}

func (d *Devnet) AccountAuthorizationSnapshot(owner string) (*ynxauth.State, uint64, uint64) {
	view := d.AccountAuthorizationDetails(owner)
	return view.State, view.ExecutionHeight, view.LedgerNonce
}

type AccountAuthorizationDetail struct {
	State                                         *ynxauth.State
	ExecutionHeight, LedgerNonce, CommittedHeight uint64
	CommittedBlockHash                            string
	CheckpointStatus, CheckpointIntegrity         string
}

// AccountAuthorizationDetails returns next-execution policy and committed tip
// from one lock. The producer tip is not a BFT finality or light-client proof.
func (d *Devnet) AccountAuthorizationDetails(owner string) AccountAuthorizationDetail {
	d.mu.RLock()
	defer d.mu.RUnlock()
	tip := d.blocks[len(d.blocks)-1]
	view := AccountAuthorizationDetail{ExecutionHeight: d.accountExecutionHeightLocked(), CommittedHeight: tip.Height, CommittedBlockHash: tip.Hash}
	view.CheckpointStatus = "uncertain"
	if d.dataDir == "" {
		view.CheckpointStatus = "memory_only"
	} else if cp := d.durableCheckpoint.Load(); cp != nil && cp.height == tip.Height && cp.hash == tip.Hash && cp.integrity != "" && d.lastPersistenceError == "" {
		view.CheckpointStatus, view.CheckpointIntegrity = "durable", cp.integrity
	}
	if a := d.accounts[owner]; a != nil {
		view.LedgerNonce = a.Nonce
	}
	if d.accountPolicy == nil {
		return view
	}
	s := d.accountPolicy.Clone()
	out := s.Records[:0]
	for _, r := range s.Records {
		if r.Owner == owner {
			out = append(out, r)
		}
	}
	s.Records = out
	view.State = &s
	return view
}

// PQTransactionExecutionHeight observes either the mined transaction or its
// pending execution height atomically, avoiding a racy tip query in API receipts.
func (d *Devnet) PQTransactionExecutionHeight(hash string) (uint64, bool) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	tx, ok := d.transactionLocked(hash)
	if !ok {
		return 0, false
	}
	if tx.BlockNum != 0 {
		return tx.BlockNum, true
	}
	return d.accountExecutionHeightLocked(), true
}

func (d *Devnet) verifyPQTransferLocked(input SignedTransferInput) error {
	if len(input.PQMember) == 0 {
		return d.requireLegacyAccountLocked(input.From)
	}
	if len(input.EthereumRaw) != 0 || d.accountPolicy == nil {
		return ynxauth.ErrPolicy
	}
	m, err := ynxbatch.DecodeMember(input.PQMember)
	if err != nil {
		return err
	}
	t, err := ynxauth.DecodeTransfer(m.Message)
	if err != nil {
		return err
	}
	if t.NativeChainID != uint64(d.cfg.ChainID) || t.From != input.From || t.To != input.To || t.Amount != uint64(input.Amount) || t.Fee != uint64(input.Fee) || t.Nonce != input.Nonce || !bytes.Equal(t.ChainID, d.accountPolicy.NetworkID) {
		return errors.New("PQ proof differs from transfer execution")
	}
	digest := sha256.Sum256(input.PQMember)
	if input.Hash != "0x"+hex.EncodeToString(digest[:]) {
		return errors.New("PQ transfer hash differs from submitted bytes")
	}
	return d.accountPolicy.VerifyMember(input.From, ynxauth.TransactionPurpose, m.Message, input.PQMember, d.accountExecutionHeightLocked())
}

// SubmitPQTransfer accepts the complete protocol MemberWire. The ordinary
// transfer state machine re-verifies it under the lock, then applies existing
// nonce/balance/fee/lot/durability rules. No classic signature is requested.
func (d *Devnet) SubmitPQTransfer(wire []byte) (Transaction, bool, error) {
	m, err := ynxbatch.DecodeMember(wire)
	if err != nil {
		return Transaction{}, false, err
	}
	t, err := ynxauth.DecodeTransfer(m.Message)
	if err != nil {
		return Transaction{}, false, err
	}
	hash := sha256.Sum256(wire)
	return d.SubmitSignedTransfer(SignedTransferInput{Hash: "0x" + hex.EncodeToString(hash[:]), From: t.From, To: t.To, Amount: int64(t.Amount), Fee: int64(t.Fee), Nonce: t.Nonce, PQMember: bytes.Clone(wire)})
}

// SubmitAccountMigration keeps policy, fee, account nonce and original signed
// intent in one existing durable mutation. A lost durability acknowledgement is
// retained as UNKNOWN by the same machinery as native transfers.
func (d *Devnet) SubmitAccountMigration(wire []byte) (Transaction, bool, error) {
	m, err := ynxauth.DecodeMigration(wire)
	if err != nil {
		return Transaction{}, false, err
	}
	wire = bytes.Clone(wire)
	hash := sha256.Sum256(wire)
	txHash := "0x" + hex.EncodeToString(hash[:])
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, ok := d.transactionLocked(txHash); ok {
		if existing.Type != "account_migration" || existing.Memo != pqMigrationMemo+hex.EncodeToString(wire) {
			return Transaction{}, false, errors.New("migration hash conflict")
		}
		if _, uncertain := d.uncertainTransactions[txHash]; uncertain || (d.dataDir != "" && !d.transactionCheckpointCovers(existing)) {
			if err = d.confirmTransactionPersistenceLocked(); err != nil {
				return existing, false, err
			}
		}
		return existing, true, nil
	}
	if d.accountPolicy == nil {
		return Transaction{}, false, ynxauth.ErrPolicy
	}
	sender := d.accounts[m.Intent.Owner]
	if sender == nil {
		return Transaction{}, false, errors.New("migration account does not exist")
	}
	if sender.Balance < 1 || sender.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return Transaction{}, false, errors.New("insufficient migration fee or bandwidth")
	}
	next, err := d.accountPolicy.AdmitMigration(m, d.accountExecutionHeightLocked(), sender.Nonce)
	if err != nil {
		return Transaction{}, false, err
	}
	feeAddress := d.nextValidatorAddressLocked()
	feeRecipient := d.accountReadOnly(feeAddress)
	if feeAddress != m.Intent.Owner && feeRecipient.Balance == math.MaxInt64 {
		return Transaction{}, false, errors.New("migration fee recipient overflow")
	}
	flows, err := d.planLotMovementLocked(sender, feeRecipient, 1)
	if err != nil {
		return Transaction{}, false, err
	}
	undo := d.transferUndoLocked(m.Intent.Owner, feeAddress, feeAddress, flows)
	oldPolicy := d.accountPolicy
	feeRecipient = d.account(feeAddress)
	d.applyLotFlowsLocked(sender, feeRecipient, flows)
	sender.Balance--
	sender.Nonce = m.Intent.LedgerNonce
	sender.ResourceUsage.BandwidthUsed++
	feeRecipient.Balance++
	d.accountPolicy = &next
	tx := Transaction{Hash: txHash, Type: "account_migration", From: m.Intent.Owner, To: m.Intent.Owner, Fee: 1, Nonce: m.Intent.LedgerNonce, Timestamp: time.Now().UTC(), LotFlows: flows, Memo: pqMigrationMemo + hex.EncodeToString(wire)}
	d.pending = append(d.pending, tx)
	tx, err = d.persistMutationLocked(tx, func() { d.rollbackTransferLocked(undo); d.accountPolicy = oldPolicy })
	return tx, false, err
}

// Historical PQ envelopes retain their complete signed bytes. This is separate
// from current account policy; a key rotation cannot invalidate old history.
func validateHistoricalPQTransaction(tx Transaction, state *ynxauth.State, height uint64, chainID int64) error {
	if strings.HasPrefix(tx.Memo, pqActionMemo) {
		return validateHistoricalPQAction(tx, state, height, chainID)
	}
	if strings.HasPrefix(tx.Memo, pqTransferMemo) {
		if state == nil {
			return errors.New("PQ history without policy")
		}
		wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqTransferMemo))
		if err != nil {
			return err
		}
		m, err := ynxbatch.DecodeMember(wire)
		if err != nil {
			return err
		}
		t, err := ynxauth.DecodeTransfer(m.Message)
		if err != nil {
			return err
		}
		h := sha256.Sum256(wire)
		if tx.Type != "transfer" || tx.Hash != "0x"+hex.EncodeToString(h[:]) || t.NativeChainID != uint64(chainID) || t.From != tx.From || t.To != tx.To || t.Amount != uint64(tx.Amount) || t.Fee != uint64(tx.Fee) || t.Nonce != tx.Nonce {
			return errors.New("PQ historical execution mismatch")
		}
		return state.VerifyMember(tx.From, ynxauth.TransactionPurpose, m.Message, wire, height)
	}
	if strings.HasPrefix(tx.Memo, pqMigrationMemo) {
		if state == nil {
			return errors.New("PQ migration history without policy")
		}
		wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqMigrationMemo))
		if err != nil {
			return err
		}
		m, err := ynxauth.DecodeMigration(wire)
		if err != nil {
			return err
		}
		h := sha256.Sum256(wire)
		if tx.Type != "account_migration" || tx.Hash != "0x"+hex.EncodeToString(h[:]) || tx.From != m.Intent.Owner || tx.To != m.Intent.Owner || tx.Nonce != m.Intent.LedgerNonce || tx.Amount != 0 || tx.Fee != 1 {
			return errors.New("PQ migration historical execution mismatch")
		}
		before := state.Clone()
		kept := before.Records[:0]
		var record *ynxauth.Record
		for _, r := range before.Records {
			if r.Owner == m.Intent.Owner && r.Revision >= m.Intent.NewRevision {
				if r.Revision == m.Intent.NewRevision {
					copy := r
					record = &copy
				}
				continue
			}
			kept = append(kept, r)
		}
		before.Records = kept
		if record == nil || record.RegisteredAt != height || record.ActiveFrom != m.Intent.ActivateAt || record.LedgerNonce != m.Intent.LedgerNonce || !bytes.Equal(record.PKA, m.Intent.PKA) || !bytes.Equal(record.PKB, m.Intent.PKB) {
			return errors.New("PQ migration differs from registered history")
		}
		_, err = before.AdmitMigration(m, height, m.Intent.LedgerNonce-1)
		return err
	}
	if tx.Type == "account_migration" {
		return errors.New("missing original migration proof")
	}
	// Classic history remains valid at its original height. Once active, no
	// unrecognized classic/action/delegation envelope can spend for this owner.
	if state != nil {
		if _, active := state.PolicyAt(tx.From, height); active {
			return ynxauth.ErrPolicy
		}
	}
	return nil
}
