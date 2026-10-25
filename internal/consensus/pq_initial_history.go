package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func inspectPQInitialRegistrationHistory(tx chain.Transaction, policy *ynxauth.State, actualHeight uint64) ([]byte, ynxauth.RegistrationIntent, error) {
	var zero ynxauth.RegistrationIntent
	if policy == nil || policy.Validate(policy.NetworkID) != nil || actualHeight == 0 || tx.BlockNum != actualHeight || tx.Type != PQInitialRegistrationType || tx.From != tx.To || tx.Amount != 0 || tx.Fee != 0 || tx.Nonce != 1 || tx.Timestamp.IsZero() || tx.BlockHash != "" || len(tx.Logs) != 0 || len(tx.LotFlows) != 0 || tx.Sponsor != "" || tx.SponsorPoolID != "" || tx.ResourceSource != "" || tx.ResourceType != "" || tx.ResourceConsumed != 0 || tx.ActionReference != "" || !strings.HasPrefix(tx.Memo, pqInitialRegistrationMemo) {
		return nil, zero, errors.New("invalid committed zero-value initial registration effects")
	}
	if len(tx.Memo) > len(pqInitialRegistrationMemo)+2*ynxauth.MaxPQInitialRegistrationBytes {
		return nil, zero, errors.New("initial registration original wire exceeds bound")
	}
	wire, err := hex.DecodeString(strings.TrimPrefix(tx.Memo, pqInitialRegistrationMemo))
	if err != nil || len(wire) > ynxauth.MaxPQInitialRegistrationBytes || tx.Memo != pqInitialRegistrationMemo+hex.EncodeToString(wire) || tx.Hash != SignedTransactionHash(wire) {
		return nil, zero, errors.New("initial registration original wire mismatch")
	}
	intent, _, err := ynxauth.DecodePQInitialRegistrationMember(wire)
	if err != nil || intent.Owner != tx.From || !bytes.Equal(intent.ChainID, policy.NetworkID) {
		return nil, zero, errors.New("initial registration original owner or network mismatch")
	}
	count := 0
	for _, record := range policy.Records {
		if record.Owner == intent.Owner && record.Revision == 1 {
			if record.AlgorithmVersion != ynxbatch.Version || record.RegisteredAt != actualHeight || record.ActiveFrom != intent.ActivateAt || record.LedgerNonce != 1 || !bytes.Equal(record.PKA, intent.PKA) || !bytes.Equal(record.PKB, intent.PKB) {
				return nil, zero, errors.New("initial registration differs from its committed complete first record")
			}
			count++
		}
	}
	if count != 1 {
		return nil, zero, errors.New("initial registration is missing its unique complete first policy record")
	}
	return wire, intent, nil
}

// ValidatePQInitialRegistrationObservation checks original bytes, exact effects
// and BOTH signatures against the supplied committed-view first record. This is
// only configured-RPC DATA consistency, never independent Genesis authority.
// Only the Application's pinned bootstrap can admit or restore the account.
func ValidatePQInitialRegistrationObservation(tx chain.Transaction, policy *ynxauth.State, actualHeight uint64) error {
	wire, intent, err := inspectPQInitialRegistrationHistory(tx, policy, actualHeight)
	if err != nil {
		return err
	}
	observed := ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, Owner: intent.Owner, Purpose: ynxauth.TransactionPurpose, PolicyRevision: "OBSERVED-FIRST-REGISTRATION", ChainID: bytes.Clone(intent.ChainID), PKA: bytes.Clone(intent.PKA), PKB: bytes.Clone(intent.PKB), Enabled: true, ActiveFrom: actualHeight}
	_, err = ynxauth.VerifyPQInitialRegistrationPossession(wire, observed, actualHeight)
	return err
}

// Revalidate original first-registration proof against the independent Genesis,
// not against the keys copied into the checkpoint record being checked.
func validatePQInitialRegistrationHistory(state CommittedState, migration chain.ConsensusMigrationState, entry PQCommittedAuthorization) error {
	tx := entry.Transaction
	if state.bootstrap == nil || state.AccountPolicy == nil || tx.Type != PQInitialRegistrationType || tx.From != tx.To || tx.Amount != 0 || tx.Fee != 0 || tx.Nonce != 1 || len(tx.LotFlows) != 0 || tx.BlockNum <= migration.Height || tx.BlockNum > uint64(state.Height) || tx.Timestamp.IsZero() || !strings.HasPrefix(tx.Memo, pqInitialRegistrationMemo) {
		return errors.New("invalid committed zero-value initial registration effects")
	}
	wire, intent, err := inspectPQInitialRegistrationHistory(tx, state.AccountPolicy, tx.BlockNum)
	if err != nil {
		return err
	}
	payload, err := EncodePQInitialRegistrationTransaction(wire)
	if err != nil || entry.ABCITransactionHash != SignedTransactionHash(payload) {
		return errors.New("initial registration ABCI envelope mismatch")
	}
	trusted, err := state.bootstrap.initialAccountRegistration(intent.Owner, tx.BlockNum)
	if err != nil {
		return err
	}
	if _, err := ynxauth.VerifyPQInitialRegistrationPossession(wire, trusted, tx.BlockNum); err != nil {
		return err
	}
	if _, exists := accountIndex(migration.Accounts, tx.From); exists {
		return errors.New("initial registration replaced an original account")
	}
	index, exists := accountIndex(state.Accounts, tx.From)
	if !exists || state.Accounts[index].Nonce < 1 || state.Accounts[index].ResourceUsage.BandwidthUsed < 1 {
		return errors.New("initial registration has no consumed ledger nonce and bandwidth")
	}
	if !bytes.Equal(trusted.ChainID, state.AccountPolicy.NetworkID) {
		return errors.New("initial registration is missing unique pinned policy evidence")
	}
	return nil
}
