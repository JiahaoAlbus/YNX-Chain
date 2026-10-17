package chain

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
)

// ConsensusRuntimeState is the typed, complete authoritative state boundary.
// Its fields follow devnetSnapshot so a new persisted business module cannot
// silently disappear from exports. Node-local observations and checkpoint time
// are normalized; all business records, original history and policy remain.
// Possessing this document does not prove the ABCI executor supports a module.
type ConsensusRuntimeState devnetSnapshot

func (d *Devnet) exportConsensusRuntimeLocked() (ConsensusRuntimeState, error) {
	snapshot := d.snapshotLocked()
	if d.dataDir != "" {
		wire, err := os.ReadFile(d.snapshotPath())
		if err != nil {
			return ConsensusRuntimeState{}, fmt.Errorf("read cutover checkpoint: %w", err)
		}
		var persisted devnetSnapshot
		if err := json.Unmarshal(wire, &persisted); err != nil {
			return ConsensusRuntimeState{}, err
		}
		if err := validateReplicationSnapshot(persisted, d.cfg); err != nil {
			return ConsensusRuntimeState{}, fmt.Errorf("invalid cutover checkpoint: %w", err)
		}
		currentHash, err := replicationApplicationStateIntegrity(snapshot)
		if err != nil {
			return ConsensusRuntimeState{}, err
		}
		durableHash, err := replicationApplicationStateIntegrity(persisted)
		if err != nil || currentHash != durableHash || len(persisted.Blocks) != len(snapshot.Blocks) || persisted.Blocks[len(persisted.Blocks)-1].Hash != snapshot.Blocks[len(snapshot.Blocks)-1].Hash {
			return ConsensusRuntimeState{}, errors.New("cutover checkpoint does not cover current application state and tip")
		}
	}
	snapshot.SavedAt = time.Time{}
	snapshot.StateIntegrity = ""
	snapshot.Peers, snapshot.PeerSyncs = nil, nil
	snapshot.Validators = append([]Validator(nil), snapshot.Validators...)
	for i := range snapshot.Validators {
		snapshot.Validators[i].PeerReady = false
		snapshot.Validators[i].PeerStatus = ""
		snapshot.Validators[i].LatestHeight = 0
		snapshot.Validators[i].LastSeenAt = nil
		snapshot.Validators[i].UpdatedAt = nil
		snapshot.Validators[i].PeerEvidence = ""
	}
	// Detach every nested map/slice before the caller releases the state lock.
	wire, err := json.Marshal(snapshot)
	if err != nil {
		return ConsensusRuntimeState{}, err
	}
	var runtime ConsensusRuntimeState
	if err := json.Unmarshal(wire, &runtime); err != nil {
		return ConsensusRuntimeState{}, err
	}
	return runtime, nil
}

func (s ConsensusMigrationState) validateRuntimeBoundary() error {
	if s.Version == LegacyConsensusMigrationVersion {
		if s.Runtime != nil || s.AccountPolicy != nil || s.OriginalGenesisHash != "" {
			return errors.New("legacy migration cannot carry uncommitted v2 runtime or account policy")
		}
		return nil
	}
	if s.Runtime == nil {
		return errors.New("v2 migration requires complete typed source runtime")
	}
	r := devnetSnapshot(*s.Runtime)
	if !reflect.DeepEqual(r.Config, s.Network) || len(r.Blocks) == 0 || len(r.Pending) != 0 {
		return errors.New("migration runtime network/history/quiescence mismatch")
	}
	genesis := hashParts("genesis", s.Network.Slug, fmt.Sprint(s.Network.ChainID))
	if s.OriginalGenesisHash != genesis || r.Blocks[0].Hash != genesis {
		return errors.New("migration original genesis identity mismatch")
	}
	if tip := r.Blocks[len(r.Blocks)-1]; tip.Height != s.Height || tip.Hash != s.LastBlockHash {
		return errors.New("migration runtime tip does not match cutover anchor")
	}
	if !reflect.DeepEqual(r.AccountPolicy, s.AccountPolicy) {
		return errors.New("migration runtime and top-level account policies disagree")
	}
	if s.AccountPolicy != nil {
		network, err := hex.DecodeString(s.OriginalGenesisHash)
		if err != nil || !bytes.Equal(network, s.AccountPolicy.NetworkID) {
			return errors.New("migration account policy is not bound to original genesis")
		}
	}
	if len(r.Accounts) != len(s.Accounts) {
		return errors.New("migration runtime account inventory mismatch")
	}
	for _, account := range s.Accounts {
		original := r.Accounts[account.Address]
		if original == nil || original.Address != account.Address || original.Balance != account.Balance || original.Staked != account.Staked || original.Nonce != account.Nonce || original.ResourceUsage != account.ResourceUsage || !reflect.DeepEqual(original.Lots, account.Lots) {
			return fmt.Errorf("migration runtime account mismatch: %s", account.Address)
		}
	}
	if !reflect.DeepEqual(r.Policy, s.ResourcePolicy) {
		return errors.New("migration runtime resource policy mismatch")
	}
	if len(r.Validators) != len(s.Validators) {
		return errors.New("migration validator inventory mismatch")
	}
	byValidator := make(map[string]Validator, len(r.Validators))
	for _, v := range r.Validators {
		byValidator[v.Address] = v
	}
	for _, v := range s.Validators {
		old, ok := byValidator[v.Address]
		if !ok || old.Moniker != v.Moniker || old.VotingPower != v.VotingPower || old.Active != v.Active {
			return errors.New("migration validator authority differs from source")
		}
	}
	if len(r.DexAssets) != len(s.DexAssets) || len(r.DexPools) != len(s.DexPools) || !reflect.DeepEqual(r.DexEvents, s.DexEvents) {
		return errors.New("migration DEX inventory mismatch")
	}
	for _, asset := range s.DexAssets {
		if !reflect.DeepEqual(r.DexAssets[asset.ID], asset) {
			return errors.New("migration DEX asset mismatch")
		}
	}
	for _, pool := range s.DexPools {
		if !reflect.DeepEqual(r.DexPools[pool.ID], pool) {
			return errors.New("migration DEX pool mismatch")
		}
	}
	balanceCount := 0
	for _, balances := range r.DexBalances {
		balanceCount += len(balances)
	}
	if balanceCount != len(s.DexBalances) {
		return errors.New("migration DEX balance inventory mismatch")
	}
	for _, balance := range s.DexBalances {
		amount, ok := r.DexBalances[balance.AssetID][balance.Account]
		if !ok || amount != balance.Amount {
			return errors.New("migration DEX balance mismatch")
		}
	}
	if err := validateReplicationBlockHistory(r, s.Network); err != nil {
		return err
	}
	if err := validateResourceSponsorSnapshot(r); err != nil {
		return err
	}
	return validateAccountPolicySnapshot(r)
}

// RestoreSourceRuntime reconstructs the actual source business maps for
// inspection and module-adapter validation. It starts no producer, opens no
// listener and writes no checkpoint. It is not permission to run nondeterministic
// Devnet mutators inside ABCI; each consensus adapter must prove its semantics.
func (s ConsensusMigrationState) RestoreSourceRuntime() (*Devnet, error) {
	if err := s.Validate(); err != nil {
		return nil, err
	}
	if s.Runtime == nil {
		return nil, errors.New("legacy account-only migration has no full runtime")
	}
	wire, err := json.Marshal(s.Runtime)
	if err != nil {
		return nil, err
	}
	var snapshot devnetSnapshot
	if err := json.Unmarshal(wire, &snapshot); err != nil {
		return nil, err
	}
	d := NewDevnet(s.Network)
	d.applySnapshotLocked(snapshot)
	return d, nil
}

// Pure validation shared by the authoritative runtime and the ABCI bridge.
func ValidateConsensusAccountPolicyContinuation(previous, next *ynxauth.State) error {
	return validateAccountPolicyContinuation(previous, next)
}

func ValidateConsensusHistoricalPQTransaction(tx Transaction, state *ynxauth.State, height uint64, chainID int64) error {
	return validateHistoricalPQTransaction(tx, state, height, chainID)
}
