package chain

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

const pqRevocationMemo = "ynx-pq-revocation-v1:"

func accountPolicyVersionSupported(version string) bool {
	return version == ynxauth.PolicyVersion || version == ynxauth.PolicyRevocationVersion
}

// SubmitAccountRevocation commits the original current-pair proof, terminal
// policy, fixed fee, traceable lot flow, bandwidth and nonce in the same durable
// mutation. Replaying the identical wire reconciles the original receipt; it
// never re-signs, creates a new intent or executes a fee twice. Revocation becomes
// effective at its signed execution height+1 and never enables classic recovery.
func (d *Devnet) SubmitAccountRevocation(wire []byte) (Transaction, bool, error) {
	revocation, err := ynxauth.DecodeRevocation(wire)
	if err != nil {
		return Transaction{}, false, err
	}
	wire = bytes.Clone(wire)
	digest := sha256.Sum256(wire)
	hash := "0x" + hex.EncodeToString(digest[:])
	memo := pqRevocationMemo + hex.EncodeToString(wire)
	d.mu.Lock()
	defer d.mu.Unlock()
	if existing, found := d.transactionLocked(hash); found {
		if existing.Type != "account_revocation" || existing.Memo != memo {
			return Transaction{}, false, errors.New("revocation hash conflict")
		}
		if _, uncertain := d.uncertainTransactions[hash]; uncertain || (d.dataDir != "" && !d.transactionCheckpointCovers(existing)) {
			if err = d.confirmTransactionPersistenceLocked(); err != nil {
				return existing, false, err
			}
		}
		return existing, true, nil
	}
	if d.accountPolicy == nil {
		return Transaction{}, false, ynxauth.ErrPolicy
	}
	sender := d.accounts[revocation.Intent.Owner]
	if sender == nil {
		return Transaction{}, false, errors.New("revocation account does not exist")
	}
	if sender.Balance < 1 || sender.ResourceUsage.BandwidthUsed == math.MaxInt64 {
		return Transaction{}, false, errors.New("insufficient revocation fee or bandwidth")
	}
	next, err := d.accountPolicy.AdmitRevocation(revocation, d.accountExecutionHeightLocked(), sender.Nonce)
	if err != nil {
		return Transaction{}, false, err
	}
	feeAddress := d.nextValidatorAddressLocked()
	feeRecipient := d.accountReadOnly(feeAddress)
	if feeAddress != revocation.Intent.Owner && feeRecipient.Balance == math.MaxInt64 {
		return Transaction{}, false, errors.New("revocation fee recipient overflow")
	}
	flows, err := d.planLotMovementLocked(sender, feeRecipient, 1)
	if err != nil {
		return Transaction{}, false, err
	}
	undo := d.transferUndoLocked(revocation.Intent.Owner, feeAddress, feeAddress, flows)
	oldPolicy := d.accountPolicy
	feeRecipient = d.account(feeAddress)
	d.applyLotFlowsLocked(sender, feeRecipient, flows)
	sender.Balance--
	sender.Nonce = revocation.Intent.LedgerNonce
	sender.ResourceUsage.BandwidthUsed++
	feeRecipient.Balance++
	d.accountPolicy = &next
	tx := Transaction{Hash: hash, Type: "account_revocation", From: revocation.Intent.Owner, To: revocation.Intent.Owner, Fee: 1, Nonce: revocation.Intent.LedgerNonce, Timestamp: time.Now().UTC(), LotFlows: flows, Memo: memo}
	d.pending = append(d.pending, tx)
	tx, err = d.persistMutationLocked(tx, func() { d.rollbackTransferLocked(undo); d.accountPolicy = oldPolicy })
	return tx, false, err
}

// accountPolicyBeforeEvent reconstructs only public authorization state before
// one owner's original event. Same-height events for this owner are ordered by
// its strictly consumed ledger nonce, so a later revocation cannot invalidate a
// preceding migration. Other owners' same-height events are independent and
// may remain; no cross-account transaction ordering is fabricated. Future-height
// records/tombstones are excluded. This detached historical view is never stored.
func accountPolicyBeforeEvent(state *ynxauth.State, owner string, height, nonce uint64) (ynxauth.State, error) {
	if state == nil {
		return ynxauth.State{}, errors.New("account policy history is missing")
	}
	if err := state.Validate(state.NetworkID); err != nil {
		return ynxauth.State{}, err
	}
	before := state.Clone()
	records := before.Records[:0]
	for _, record := range before.Records {
		if record.RegisteredAt > height || (record.Owner == owner && record.RegisteredAt == height && record.LedgerNonce >= nonce) {
			continue
		}
		records = append(records, record)
	}
	before.Records = records
	revocations := before.Revocations[:0]
	for _, revoked := range before.Revocations {
		if revoked.RegisteredAt > height || (revoked.Owner == owner && revoked.RegisteredAt == height && revoked.LedgerNonce >= nonce) {
			continue
		}
		revocations = append(revocations, revoked)
	}
	before.Revocations = revocations
	if len(before.Revocations) == 0 {
		before.Version = ynxauth.PolicyVersion
	}
	return before, before.Validate(before.NetworkID)
}

func validateHistoricalPQRevocation(tx Transaction, state *ynxauth.State, height uint64) error {
	if state == nil {
		return errors.New("PQ revocation history without policy")
	}
	wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqRevocationMemo))
	if err != nil {
		return err
	}
	revocation, err := ynxauth.DecodeRevocation(wire)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(wire)
	intent := revocation.Intent
	if tx.Type != "account_revocation" || tx.Hash != "0x"+hex.EncodeToString(digest[:]) || tx.From != intent.Owner || tx.To != intent.Owner || tx.Amount != 0 || tx.Fee != 1 || tx.Nonce != intent.LedgerNonce || height != intent.ExecuteAt || tx.Memo != pqRevocationMemo+hex.EncodeToString(wire) {
		return errors.New("PQ revocation historical execution mismatch")
	}
	expected := ynxauth.RevocationRecord{Owner: intent.Owner, AuthorizingRevision: intent.AuthorizingRevision, ThroughRevision: intent.ThroughRevision, RegisteredAt: height, RevokedFrom: intent.RevokeAt, LedgerNonce: intent.LedgerNonce}
	found := false
	for _, revoked := range state.Revocations {
		if revoked.Owner == intent.Owner {
			if revoked != expected || found {
				return errors.New("PQ revocation differs from immutable tombstone")
			}
			found = true
		}
	}
	if !found {
		return errors.New("PQ revocation lacks its terminal tombstone")
	}
	before, err := accountPolicyBeforeEvent(state, intent.Owner, height, intent.LedgerNonce)
	if err != nil {
		return err
	}
	_, err = before.AdmitRevocation(revocation, height, intent.LedgerNonce-1)
	return err
}
