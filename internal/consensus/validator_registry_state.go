package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
)

const ValidatorRegistryStateVersion = 16

// ValidatorRegistryState is application-committed registration evidence. It
// neither changes Comet's active Ed25519 set nor activates a PQ signing profile.
type ValidatorRegistryState struct {
	Version   uint32                   `json:"version"`
	Bootstrap ValidatorBootstrapRecord `json:"bootstrap"`
	Root      string                   `json:"root"`
	Events    []ValidatorRegistryEvent `json:"events"`
}

type ValidatorRegistryEvent struct {
	Index            uint64 `json:"index"`
	Height           int64  `json:"height"`
	TransactionIndex uint32 `json:"transactionIndex"`
	ABCIHash         string `json:"abciHash"`
	OperationHash    string `json:"operationHash"`
	Wire             []byte `json:"wire"`
}

func cloneValidatorBootstrapRecord(value ValidatorBootstrapRecord) ValidatorBootstrapRecord {
	// The closed record contains only deterministic serializable fields.
	raw, _ := json.Marshal(value)
	var out ValidatorBootstrapRecord
	_ = json.Unmarshal(raw, &out)
	return out
}

func cloneValidatorRegistry(value *ValidatorRegistryState) *ValidatorRegistryState {
	if value == nil {
		return nil
	}
	out := *value
	out.Bootstrap = cloneValidatorBootstrapRecord(value.Bootstrap)
	out.Events = make([]ValidatorRegistryEvent, len(value.Events))
	for i, event := range value.Events {
		out.Events[i] = event
		out.Events[i].Wire = bytes.Clone(event.Wire)
	}
	return &out
}

func replayValidatorRegistry(value *ValidatorRegistryState, bootstrap *ConsensusBootstrap, through int64) (*ynxconsensusauth.KeyHistory, error) {
	if bootstrap == nil {
		return nil, errors.New("validator registry requires independent operator-pinned bootstrap")
	}
	history, err := ynxconsensusauth.NewKeyHistory(ynxconsensusauth.RegistryAnchor{GenesisID: bytes.Clone(bootstrap.genesisID), ChainID: bootstrap.record.ChainID})
	if err != nil {
		return nil, err
	}
	if value == nil {
		return history, nil
	}
	if value.Version != 1 || len(value.Events) == 0 || !reflect.DeepEqual(value.Bootstrap, bootstrap.record) {
		return nil, errors.New("registry substituted its original pinned bootstrap or has empty history")
	}
	var previousHeight int64
	var previousIndex uint32
	seen := make(map[string]bool, len(value.Events))
	for i, event := range value.Events {
		if event.Index != uint64(i) || event.Height < bootstrap.record.InitialHeight || event.Height > through || event.Height < previousHeight || (i > 0 && event.Height == previousHeight && event.TransactionIndex <= previousIndex) {
			return nil, errors.New("registry history index/height/order invalid")
		}
		payload, err := EncodeValidatorRegistryTransaction(event.Wire)
		if err != nil {
			return nil, err
		}
		hash, err := ynxconsensusauth.RegistrationHash(event.Wire)
		if err != nil || event.OperationHash != "0x"+hex.EncodeToString(hash[:]) || event.ABCIHash != SignedTransactionHash(payload) || seen[event.ABCIHash] {
			return nil, errors.New("registry original operation or ABCI identity mismatch")
		}
		next, err := history.Append(event.Wire, event.Height, bootstrap.membershipAt(through))
		if err != nil {
			return nil, fmt.Errorf("replay validator registry event %d: %w", i, err)
		}
		history = next
		seen[event.ABCIHash] = true
		previousHeight, previousIndex = event.Height, event.TransactionIndex
	}
	root := history.Root()
	if value.Root != hex.EncodeToString(root[:]) {
		return nil, errors.New("validator registry root differs from complete original history")
	}
	return history, nil
}

func validateValidatorRegistryState(s CommittedState, migration chain.ConsensusMigrationState) error {
	if s.ValidatorRegistry == nil {
		if s.Version == ValidatorRegistryStateVersion {
			return errors.New("registry state version cannot omit registry history")
		}
		return nil
	}
	if s.Version != ValidatorRegistryStateVersion {
		return errors.New("legacy state version cannot carry validator registry")
	}
	if err := s.bootstrap.matchesMigration(migration); err != nil {
		return err
	}
	_, err := replayValidatorRegistry(s.ValidatorRegistry, s.bootstrap, s.Height)
	return err
}

func validateValidatorRegistryContinuation(previous, next CommittedState) error {
	if previous.ValidatorRegistry == nil {
		return nil
	}
	old, current := previous.ValidatorRegistry, next.ValidatorRegistry
	if next.Version != ValidatorRegistryStateVersion || current == nil || current.Version != old.Version || len(current.Events) < len(old.Events) || !reflect.DeepEqual(current.Bootstrap, old.Bootstrap) {
		return errors.New("validator registry downgrade, history removal or bootstrap substitution")
	}
	for i := range old.Events {
		if !reflect.DeepEqual(old.Events[i], current.Events[i]) {
			return errors.New("committed validator registry history must be append-only")
		}
	}
	if len(current.Events) == len(old.Events) && current.Root != old.Root {
		return errors.New("unchanged registry history changed root")
	}
	return nil
}

// A post-rename error means the exact pending candidate is visible but its
// directory entry may not be durable. Application.pending remains the fence:
// retries persist this candidate, never execute its transactions again.
var ErrCommittedStateDurabilityUncertain = errors.New("committed state durability UNKNOWN")

// Per-application unexported hooks exist only for deterministic persistence
// fault tests; nil production hooks always call the real filesystem operations.
type committedPersistenceHooks struct {
	beforeRename  func() error
	syncDirectory func(string) error
}

func syncCommittedDirectory(path string, hooks *committedPersistenceHooks) error {
	if hooks != nil && hooks.syncDirectory != nil {
		return hooks.syncDirectory(path)
	}
	dir, err := os.Open(path)
	if err != nil {
		return err
	}
	syncErr := dir.Sync()
	closeErr := dir.Close()
	return errors.Join(syncErr, closeErr)
}

// A cold process cannot know whether a visible prior rename returned UNKNOWN.
// Validate the full state and independent pins first, then confirm its actual
// directory entry before exposing it through Info/Query as committed.
func confirmLoadedCommittedState(path string, hooks *committedPersistenceHooks) error {
	if path == "" {
		return nil
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	if err := syncCommittedDirectory(filepath.Dir(path), hooks); err != nil {
		return fmt.Errorf("%w: cold directory sync: %w", ErrCommittedStateDurabilityUncertain, err)
	}
	return nil
}
