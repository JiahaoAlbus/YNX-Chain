package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// CommittedAccountAuthorization is detached DATA from one committed instance.
// Policy is the complete global ledger, including other owners and revocations;
// it is not the owner projection exposed by the Wallet RPC. ExecutionHeight is
// the next execution height, not an assertion that a transaction was executed.
type CommittedAccountAuthorization struct {
	Owner            string
	NativeChainID    int64
	CommittedHeight  int64
	CommittedAppHash [32]byte
	ExecutionHeight  uint64
	LedgerNonce      uint64
	Policy           *ynxauth.State
}

// CommittedPQExecution identifies an existing standalone ABCI execution. There
// is deliberately no block index: the original Node's ProofSourceView must load
// the actual block at ExecutionHeight and match Envelope byte for byte.
type CommittedPQExecution struct {
	NativeHash          string
	ABCITransactionHash string
	ExecutionHeight     uint64
	CommittedHeight     int64
	CommittedAppHash    [32]byte
	Envelope            []byte
}

// committedSourceCheckpointLocked checks the independently installed bootstrap
// and the actual committed state together. The caller holds a.mu.RLock for the
// entire read. A caller-supplied tuple does not create authority or finality.
func (a *Application) committedSourceCheckpointLocked(chainID string, height int64, appHash []byte) ([32]byte, error) {
	var hash [32]byte
	s, b, m := &a.committed, a.bootstrap, &a.migration
	if b == nil || chainID == "" || chainID != b.record.ChainID || !s.Initialized || height <= 0 || height == math.MaxInt64 || height != s.Height || height < b.record.InitialHeight {
		return hash, errors.New("original application has no matching initialized committed checkpoint")
	}
	if b.record.OriginalGenesisHash != m.OriginalGenesisHash || b.record.MigrationStateHash != m.StateHash || s.MigrationStateHash != m.StateHash || s.ChainID <= 0 || s.ChainID != m.Network.ChainID {
		return hash, errors.New("committed source differs from the original bootstrap migration")
	}
	if len(appHash) != len(hash) || !walletHex(s.AppHash, len(hash), false) {
		return hash, errors.New("committed source requires the complete canonical AppHash")
	}
	stored, err := hex.DecodeString(s.AppHash)
	if err != nil || !bytes.Equal(stored, appHash) {
		return hash, errors.New("committed source differs from the actual current AppHash")
	}
	copy(hash[:], stored)
	return hash, nil
}

// CommittedAccountAuthorizationForState reads the normal original Application
// in process, under one read lock. The tuple must come from the original Node;
// this method neither authenticates its caller nor supplies Root/finality or a
// lifecycle epoch. Pending Finalize state is never read. Signing eligibility
// must still be resolved through Policy.TrustedRegistration at ExecutionHeight.
func (a *Application) CommittedAccountAuthorizationForState(chainID string, height int64, appHash []byte, owner string) (CommittedAccountAuthorization, error) {
	var out CommittedAccountAuthorization
	if a == nil {
		return out, errors.New("original application is unavailable")
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	hash, err := a.committedSourceCheckpointLocked(chainID, height, appHash)
	if err != nil {
		return out, err
	}
	if !accountaddress.IsCanonical(owner) {
		return out, errors.New("committed authorization owner must be canonical")
	}
	i, exists := accountIndex(a.committed.Accounts, owner)
	if !exists {
		return out, errors.New("committed authorization account does not exist")
	}
	policy := a.committed.AccountPolicy
	network, err := hex.DecodeString(a.migration.OriginalGenesisHash)
	if policy == nil || policy.Version == "" || err != nil || len(network) != 32 || policy.Validate(network) != nil {
		return out, errors.New("complete committed account policy is unavailable or invalid")
	}
	clone := policy.Clone()
	return CommittedAccountAuthorization{Owner: owner, NativeChainID: a.committed.ChainID, CommittedHeight: height, CommittedAppHash: hash, ExecutionHeight: uint64(height) + 1, LedgerNonce: a.committed.Accounts[i].Nonce, Policy: &clone}, nil
}

// CommittedPQExecutionForState locates only new committed BFT history. Native
// wire identity and the exact canonical ABCI envelope identity are both bound;
// imported native history has no invented Comet height/index. Whole/member
// derived identities are not standalone transactions and are not supported by
// this method. Use the existing Whole proof/results path for those identities.
func (a *Application) CommittedPQExecutionForState(chainID string, height int64, appHash []byte, nativeHash string, exactEnvelope []byte) (CommittedPQExecution, error) {
	var out CommittedPQExecution
	if a == nil {
		return out, errors.New("original application is unavailable")
	}
	a.mu.RLock()
	defer a.mu.RUnlock()
	hash, err := a.committedSourceCheckpointLocked(chainID, height, appHash)
	if err != nil {
		return out, err
	}
	if !walletHex(nativeHash, 32, true) || len(exactEnvelope) == 0 || len(exactEnvelope) > MaxPQWholeTransactionBytes {
		return out, errors.New("canonical native hash and bounded exact ABCI envelope are required")
	}
	// Normal construction/restore validates PQHistory as unique new BFT
	// executions strictly after migration.Height. Read that retained set only;
	// scanning the original chain cannot add a legitimate BFT location.
	var entry PQCommittedAuthorization
	count := 0
	for _, candidate := range a.committed.PQHistory {
		if candidate.Transaction.Hash == nativeHash {
			entry, count = candidate, count+1
		}
	}
	if count != 1 || entry.Transaction.BlockNum <= a.migration.Height || entry.Transaction.BlockNum > uint64(height) {
		return out, errors.New("unique committed standalone BFT execution was not found")
	}
	_, envelope, err := pqWalletOriginalEnvelope(entry.Transaction)
	if err != nil {
		envelope, err = pqActionOriginal(entry)
		if err != nil {
			return out, err
		}
		wire, action, decodeErr := DecodePQActionTransport(envelope)
		if decodeErr != nil || SignedTransactionHash(wire) != nativeHash || action.Kind != entry.Transaction.Type || action.Owner != entry.Transaction.From || action.Nonce != entry.Transaction.Nonce || action.NativeChainID != uint64(a.committed.ChainID) {
			return out, errors.New("committed action original differs from its native execution")
		}
	}
	if !bytes.Equal(envelope, exactEnvelope) || !walletHex(entry.ABCITransactionHash, 32, true) || entry.ABCITransactionHash != SignedTransactionHash(envelope) {
		return out, errors.New("committed execution differs from the exact ABCI envelope or hash")
	}
	return CommittedPQExecution{NativeHash: nativeHash, ABCITransactionHash: entry.ABCITransactionHash, ExecutionHeight: entry.Transaction.BlockNum, CommittedHeight: height, CommittedAppHash: hash, Envelope: bytes.Clone(envelope)}, nil
}
