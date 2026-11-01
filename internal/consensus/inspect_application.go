package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const FreshApplicationInspectionVersion = "YNX-FRESH-APPLICATION-INSPECTION/v1"

type FreshApplicationInspectionOptions struct{ StatePath, StateLayout string }

// This DATA result verifies an existing fresh migration projection. It does not
// inspect a Comet database, acquire signing custody or attest running consensus.
type FreshApplicationInspectionResult struct {
	Version                string `json:"version"`
	ProcessID              int    `json:"processId"`
	ChainID                string `json:"chainId"`
	NativeChainID          int64  `json:"nativeChainId,string"`
	Height                 int64  `json:"height,string"`
	AppHash                string `json:"appHash"`
	StatePath              string `json:"statePath"`
	StateLayout            string `json:"stateLayout"`
	ConsensusGenesisSHA256 string `json:"consensusGenesisSHA256"`
	OriginalGenesisHash    string `json:"originalGenesisHash"`
	MigrationStateHash     string `json:"migrationStateHash"`
	// StateSHA256 hashes canonical committed-state JSON, as InitializeApplication
	// does. StateFileSHA256 instead hashes the complete original physical file.
	StateSHA256              string `json:"stateSHA256"`
	StateFileSHA256          string `json:"stateFileSHA256"`
	StateFileBytes           int64  `json:"stateFileBytes,string"`
	AccountCount             int    `json:"accountCount"`
	ContractCount            int    `json:"contractCount"`
	HistoricalBlockCount     int    `json:"historicalBlockCount"`
	ReadOnly                 bool   `json:"readOnly"`
	SourceReadOnly           bool   `json:"sourceReadOnly"`
	WriterExcluded           bool   `json:"writerExcluded"`
	FreshApplicationVerified bool   `json:"freshApplicationVerified"`
	Initialized              bool   `json:"initialized"`
	EngineCheckpointVerified bool   `json:"engineCheckpointVerified"`
	ConsensusVerified        bool   `json:"consensusVerified"`
	AuthorityGranted         bool   `json:"authorityGranted"`
	NodeStarted              bool   `json:"nodeStarted"`
	SigningPerformed         bool   `json:"signingPerformed"`
	PQActivated              bool   `json:"pqActivated"`
}

// InspectFreshApplication uses existing O_RDONLY locks and the normal complete
// migration/state validators. No writer constructor, Sync, tail repair, InitChain,
// key/HRS or Comet database is opened. An initialized checkpoint is not accepted.
func InspectFreshApplication(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options FreshApplicationInspectionOptions) (FreshApplicationInspectionResult, error) {
	return inspectFreshApplication(migration, rawGenesis, pins, options, nil)
}

type freshApplicationInspectionHooks struct{ afterOriginalHeld func() error }

func inspectFreshApplication(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options FreshApplicationInspectionOptions, hooks *freshApplicationInspectionHooks) (result FreshApplicationInspectionResult, err error) {
	var finish []func() error
	defer func() {
		for i := len(finish) - 1; i >= 0; i-- {
			err = errors.Join(err, finish[i]())
		}
		if err != nil {
			result = FreshApplicationInspectionResult{}
		}
	}()
	if options.StateLayout != "atomic-json" && options.StateLayout != "snapshot-journal" && options.StateLayout != "block-journal" {
		return result, errors.New("fresh application inspection requires an explicit original layout")
	}
	bootstrap, err := NewConsensusBootstrap(rawGenesis, pins, migration)
	if err != nil {
		return result, err
	}
	if bootstrap.record.Params.Version == nil || bootstrap.record.Params.Version.App != ApplicationVersion {
		return result, errors.New("fresh application inspection requires the original current runtime; historical checkpoints require their existing operator path")
	}
	if err = requireInspectionPath(options.StatePath); err != nil {
		return result, err
	}
	release, err := existingInspectionWriterLease(options.StatePath)
	if err != nil {
		return result, err
	}
	finish = append(finish, release)
	if options.StateLayout != "atomic-json" {
		release, err = existingInspectionLockFile(options.StatePath + ".lock")
		if err != nil {
			return result, err
		}
		finish = append(finish, release)
		unlock, lockErr := LockSnapshotJournalRead(options.StatePath)
		if lockErr != nil {
			return result, lockErr
		}
		finish = append(finish, func() error { unlock(); return nil })
	}
	if err = rejectInspectionUnknown(filepath.Dir(options.StatePath)); err != nil {
		return result, err
	}
	original, err := journalRegularFile(options.StatePath, os.O_RDONLY)
	if err != nil {
		return result, err
	}
	finish = append(finish, original.Close)
	info, err := original.Stat()
	if err != nil {
		return result, err
	}
	stamp, err := freshInspectionStamp(info)
	if err != nil {
		return result, err
	}
	beforeHash, err := freshInspectionFileHash(original, info.Size())
	if err != nil {
		return result, err
	}
	if hooks != nil && hooks.afterOriginalHeld != nil {
		if err = hooks.afterOriginalHeld(); err != nil {
			return result, err
		}
	}
	witness, err := newValidatedMigration(migration, bootstrap)
	if err != nil {
		return result, err
	}
	var captured *pqEngineStateRead
	capture := func(path string) (*pqEngineStateRead, error) {
		r, e := capturePQEngineState(path)
		if e != nil {
			return nil, e
		}
		if r.layout != options.StateLayout || !os.SameFile(r.info, info) {
			return nil, errors.New("fresh application source layout or inode differs")
		}
		got, e := freshInspectionStamp(r.info)
		if e != nil || got != stamp {
			return nil, errors.New("fresh application source changed while capturing")
		}
		sum := sha256.Sum256(r.data)
		if hex.EncodeToString(sum[:]) != beforeHash {
			return nil, errors.New("fresh application physical bytes changed while capturing")
		}
		captured = r
		return r, nil
	}
	view, err := capture(options.StatePath)
	if err != nil {
		return result, err
	}
	var state CommittedState
	// The original fresh snapshot writer stores exactly its hash-bound header;
	// its first snapshot must advance height. A live engine reader deliberately
	// rejects an empty journal. This DATA-only fresh inspector neither changes
	// that rule nor manufactures a record: accept only this EXACT original
	// header, with the full owned initial-state validation below.
	freshHeader := []byte(snapshotJournalMagic + witness.migration.StateHash + "\n")
	if options.StateLayout == "snapshot-journal" && bytes.Equal(view.data, freshHeader) {
		state = initialCommittedState(witness.migration)
		state.bootstrap = witness.bootstrap
		err = state.validateOwned(witness)
	} else {
		state, err = readPQEngineCommittedStateOwned(options.StatePath, witness, nil, nil, func(string) (*pqEngineStateRead, error) { return view, nil })
	}
	if err != nil {
		return result, err
	}
	if state.Initialized || state.Height != int64(witness.migration.Height) || state.AppHash != witness.migration.StateHash || state.Version <= 13 {
		return result, errors.New("inspection accepts only the exact fresh uninitialized current-runtime migration projection")
	}
	canonical, err := json.Marshal(state)
	if err != nil {
		return result, err
	}
	expected, err := json.Marshal(initialCommittedState(witness.migration))
	if err != nil {
		return result, err
	}
	if !bytes.Equal(canonical, expected) {
		return result, errors.New("fresh application differs from the complete original migration projection")
	}
	if captured == nil {
		return result, errors.New("fresh application source capture absent")
	}
	if err = captured.unchanged(); err != nil {
		return result, err
	}
	after, err := original.Stat()
	if err != nil {
		return result, err
	}
	afterStamp, err := freshInspectionStamp(after)
	if err != nil || afterStamp != stamp {
		return result, errors.New("original held application identity changed")
	}
	pathInfo, err := os.Lstat(options.StatePath)
	if err != nil {
		return result, err
	}
	pathStamp, err := freshInspectionStamp(pathInfo)
	if err != nil || pathStamp != stamp {
		return result, errors.New("original application path replaced")
	}
	afterHash, err := freshInspectionFileHash(original, info.Size())
	if err != nil || afterHash != beforeHash {
		return result, errors.New("original application physical bytes changed")
	}
	final, err := os.Lstat(options.StatePath)
	if err != nil {
		return result, err
	}
	finalStamp, err := freshInspectionStamp(final)
	if err != nil || finalStamp != stamp {
		return result, errors.New("original application changed during final hash")
	}
	if err = rejectInspectionUnknown(filepath.Dir(options.StatePath)); err != nil {
		return result, err
	}
	digest := sha256.Sum256(canonical)
	result = FreshApplicationInspectionResult{Version: FreshApplicationInspectionVersion, ProcessID: os.Getpid(), ChainID: bootstrap.record.ChainID, NativeChainID: state.ChainID, Height: state.Height, AppHash: state.AppHash, StatePath: options.StatePath, StateLayout: options.StateLayout, ConsensusGenesisSHA256: pins.CometGenesisSHA256, OriginalGenesisHash: pins.OriginalGenesisHash, MigrationStateHash: pins.MigrationStateHash, StateSHA256: hex.EncodeToString(digest[:]), StateFileSHA256: beforeHash, StateFileBytes: info.Size(), AccountCount: len(state.Accounts), ContractCount: len(state.Contracts), HistoricalBlockCount: len(witness.migration.Runtime.Blocks), ReadOnly: true, SourceReadOnly: true, WriterExcluded: true, FreshApplicationVerified: true, Initialized: state.Initialized}
	return result, nil
}

func freshInspectionFileHash(f *os.File, size int64) (string, error) {
	if size <= 0 {
		return "", errors.New("empty original application")
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	hash := sha256.New()
	n, err := io.Copy(hash, io.LimitReader(f, size+1))
	if err != nil {
		return "", err
	}
	if n != size {
		return "", errors.New("original application size changed while hashing")
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

// Unix file metadata omits atime, which a read may legitimately update. The
// original ctime, mtime, inode, ownership, private mode and link count are bound.
func freshInspectionStamp(info os.FileInfo) (string, error) {
	if info == nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		return "", errors.New("original application must remain regular and 0600")
	}
	value := reflect.Indirect(reflect.ValueOf(info.Sys()))
	if !value.IsValid() || value.Kind() != reflect.Struct {
		return "", errors.New("original application identity unavailable")
	}
	field := func(name string) (string, error) {
		v := value.FieldByName(name)
		if !v.IsValid() {
			return "", errors.New("original application identity field unavailable")
		}
		return fmt.Sprint(v.Interface()), nil
	}
	var parts []string
	for _, name := range []string{"Dev", "Ino", "Uid", "Gid", "Nlink"} {
		v, err := field(name)
		if err != nil {
			return "", err
		}
		parts = append(parts, v)
	}
	if parts[4] != "1" {
		return "", errors.New("original application has additional links")
	}
	changed := value.FieldByName("Ctim")
	if !changed.IsValid() {
		changed = value.FieldByName("Ctimespec")
	}
	if !changed.IsValid() {
		return "", errors.New("original application change-time unavailable")
	}
	return fmt.Sprintf("%v:%d:%d:%d:%v", parts, info.Mode(), info.Size(), info.ModTime().UnixNano(), changed.Interface()), nil
}
