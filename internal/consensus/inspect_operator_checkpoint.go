package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	dbm "github.com/cometbft/cometbft-db"
	cmtstate "github.com/cometbft/cometbft/proto/tendermint/state"
	sm "github.com/cometbft/cometbft/state"
	"github.com/cosmos/gogoproto/proto"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

const OperatorCheckpointVersion = "YNX-OPERATOR-CHECKPOINT/v1"

// All authorities are independent normal operator inputs. The database,
// rather than a plan or an RPC result, supplies the actual committed H/AppHash.
type OperatorCheckpointOptions struct {
	StatePath, StateLayout, CometDataDirectory, SigningStatePath string
	BackupOutput                                                 string
	BackupLegacyKeyPath, BackupNodeKeyPath                       string
	SigningLockKind                                              string
	ProposePQActivationHeight                                    int64
	Authorization, NextAuthorization                             *PQEngineAuthorization
	RuntimeUpgrade                                               *RuntimeUpgradeAuthorization
}

// OperatorCheckpointResult is stopped-source observation, not a signature,
// process source qualification, deployment or permission to activate a profile.
type OperatorCheckpointResult struct {
	Version                  string                               `json:"version"`
	ChainID                  string                               `json:"chainId"`
	Height                   int64                                `json:"height,string"`
	AppHash                  string                               `json:"appHash"`
	AppVersion               uint64                               `json:"appVersion,string"`
	ConsensusGenesisSHA256   string                               `json:"consensusGenesisSHA256"`
	OriginalGenesisHash      string                               `json:"originalGenesisHash"`
	MigrationStateHash       string                               `json:"migrationStateHash"`
	StateLayout              string                               `json:"stateLayout"`
	RegistryRoot             string                               `json:"registryRoot"`
	RegistryEventCount       uint64                               `json:"registryEventCount,string"`
	CommittedScheduleHash    *string                              `json:"committedScheduleHash"`
	NextScheduleHash         *string                              `json:"nextScheduleHash"`
	ReadOnly                 bool                                 `json:"readOnly"`
	WriterExcluded           bool                                 `json:"writerExcluded"`
	SigningWriterExcluded    bool                                 `json:"signingWriterExcluded"`
	EngineCheckpointVerified bool                                 `json:"engineCheckpointVerified"`
	PQActivationVerified     bool                                 `json:"pqActivationVerified"`
	SourceReadOnly           bool                                 `json:"sourceReadOnly"`
	BackupCreated            bool                                 `json:"backupCreated"`
	Backup                   *OperatorCheckpointBackup            `json:"backup"`
	ScheduleCandidate        *OperatorCheckpointScheduleCandidate `json:"scheduleCandidate,omitempty"`
}

// InspectOperatorCheckpoint never calls an application writer constructor,
// InitChain, Commit, node constructor, store repair or a genesis fallback.
func InspectOperatorCheckpoint(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options OperatorCheckpointOptions) (result OperatorCheckpointResult, err error) {
	bootstrap, err := NewConsensusBootstrap(rawGenesis, pins, migration)
	if err != nil {
		return result, err
	}
	if options.ProposePQActivationHeight < 0 || options.ProposePQActivationHeight != 0 && options.NextAuthorization != nil {
		return result, errors.New("schedule proposal requires a positive activation height and cannot consume next authorization")
	}
	if options.RuntimeUpgrade != nil {
		if err := validateRuntimeUpgradeBootstrap(migration, bootstrap, options.RuntimeUpgrade); err != nil {
			return result, err
		}
	} else if bootstrap.record.Params.Version == nil || bootstrap.record.Params.Version.App != ApplicationVersion {
		return result, errors.New("historical original runtime requires its independent upgrade plan")
	}
	if options.StateLayout != "atomic-json" && options.StateLayout != "snapshot-journal" && options.StateLayout != "block-journal" {
		return result, errors.New("checkpoint inspection requires an explicit original state layout")
	}
	for _, path := range []string{options.StatePath, options.SigningStatePath, options.CometDataDirectory} {
		if err := requireInspectionPath(path); err != nil {
			return result, err
		}
	}
	if options.StatePath == options.SigningStatePath {
		return result, errors.New("application and signing state identities must be distinct")
	}
	signingLock := options.SigningStatePath + ".writer.lock"
	if options.SigningLockKind == "pq-signer" {
		signingLock = options.SigningStatePath + ".lock"
	} else if options.SigningLockKind != "" && options.SigningLockKind != "legacy-writer" {
		return result, errors.New("inspection requires explicit original legacy-writer or pq-signer lock kind")
	} else if options.Authorization != nil {
		return result, errors.New("PQ-configured inspection requires the original PQ signer state and its pq-signer lock; legacy HRS cannot replace it")
	}
	// The signing file's body is not opened; inspection only fences its original
	// existing normal writer lock. No lock file may be created or reset here.
	signingInfo, err := os.Lstat(options.SigningStatePath)
	if err != nil || !signingInfo.Mode().IsRegular() || signingInfo.Mode().Perm() != 0o600 || signingInfo.Size() == 0 {
		return result, errors.New("original private regular signing-state identity is required")
	}
	applicationInfo, err := os.Lstat(options.StatePath)
	if err != nil || os.SameFile(applicationInfo, signingInfo) {
		return result, errors.New("original application and signing files must not share one identity")
	}
	appLease, err := existingInspectionWriterLease(options.StatePath)
	if err != nil {
		return result, err
	}
	defer func() { err = errors.Join(err, appLease()) }()
	signerLease, err := existingInspectionLockFile(signingLock)
	if err != nil {
		return result, err
	}
	defer func() { err = errors.Join(err, signerLease()) }()
	if err := rejectInspectionUnknown(filepath.Dir(options.StatePath)); err != nil {
		return result, err
	}
	if err := rejectInspectionUnknown(filepath.Dir(options.SigningStatePath)); err != nil {
		return result, err
	}
	captured, err := capturePQEngineState(options.StatePath)
	if err != nil {
		return result, err
	}
	if captured.layout != options.StateLayout {
		return result, errors.New("actual application layout differs from independent operator selection")
	}
	dbDirectory := filepath.Join(options.CometDataDirectory, "state.db")
	before, err := inspectionDatabaseFiles(dbDirectory)
	if err != nil {
		return result, err
	}
	// ReadOnly does not create LOG or recover files. Requiring LOCK beforehand
	// also prevents the library's missing-lock creation path in normal use.
	database, err := dbm.NewGoLevelDBWithOpts("state", options.CometDataDirectory, &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
	if err != nil {
		return result, fmt.Errorf("open original stopped Comet state database read-only: %w", err)
	}
	defer func() { err = errors.Join(err, database.Close()) }()
	// Normal store.Load exits the process on malformed protobuf. Read its exact
	// original stateKey and use the same proto/FromProto conversion with errors.
	wire, err := database.Get([]byte("stateKey"))
	if err != nil || len(wire) == 0 || len(wire) > 64<<20 {
		return result, errors.New("original Comet database has no bounded actual committed state")
	}
	var persisted cmtstate.State
	if err := proto.Unmarshal(wire, &persisted); err != nil {
		return result, fmt.Errorf("decode original Comet committed state: %w", err)
	}
	actual, err := sm.FromProto(&persisted)
	if err != nil {
		return result, err
	}
	if actual.IsEmpty() || actual.ChainID != bootstrap.record.ChainID || actual.InitialHeight != bootstrap.record.InitialHeight || actual.LastBlockHeight < actual.InitialHeight || actual.LastBlockHeight <= 0 || len(actual.AppHash) != 32 || actual.LastBlockTime.IsZero() {
		return result, errors.New("original Comet state is missing, uncommitted or differs from pinned genesis identity")
	}
	snapshot, err := loadPQEngineSnapshotWithRuntime(migration, options.StatePath, bootstrap, options.Authorization, options.RuntimeUpgrade, actual.LastBlockHeight, actual.AppHash)
	if err != nil {
		return result, err
	}
	state, err := readPQEngineCommittedState(options.StatePath, migration, bootstrap, options.Authorization, options.RuntimeUpgrade)
	if err != nil {
		return result, err
	}
	if !state.Initialized || state.Height != actual.LastBlockHeight || state.AppHash != hex.EncodeToString(actual.AppHash) {
		return result, errors.New("application checkpoint is not the exact initialized actual Comet checkpoint")
	}
	appVersion, err := runtimeStateApplicationVersion(state, options.RuntimeUpgrade)
	if err != nil {
		return result, err
	}
	if state.Version <= 13 && options.RuntimeUpgrade == nil || actual.Version.Consensus.App != appVersion {
		return result, errors.New("actual Comet application version differs from independently authorized historical runtime")
	}
	if _, err := sm.BindConsensusState(*actual, snapshot); err != nil {
		return result, fmt.Errorf("authenticate actual Comet parameters and three validator sets: %w", err)
	}
	root := snapshot.history.Root()
	result = OperatorCheckpointResult{Version: OperatorCheckpointVersion, ChainID: actual.ChainID, Height: actual.LastBlockHeight, AppHash: state.AppHash, AppVersion: actual.Version.Consensus.App, ConsensusGenesisSHA256: pins.CometGenesisSHA256, OriginalGenesisHash: pins.OriginalGenesisHash, MigrationStateHash: pins.MigrationStateHash, StateLayout: options.StateLayout, RegistryRoot: hex.EncodeToString(root[:]), RegistryEventCount: uint64(snapshot.history.EventCount()), ReadOnly: true, SourceReadOnly: true, WriterExcluded: true, SigningWriterExcluded: true, EngineCheckpointVerified: true}
	if state.PQEngineSchedule != nil {
		hash, err := state.PQEngineSchedule.Hash()
		if err != nil {
			return OperatorCheckpointResult{}, err
		}
		result.CommittedScheduleHash = &hash
	}
	if options.NextAuthorization != nil {
		next := options.NextAuthorization
		if state.PQEngineSchedule != nil || next.schedule == nil || next.schedule.RegistryHeight != actual.LastBlockHeight || next.schedule.RegistryRoot != result.RegistryRoot || next.schedule.RegistryEventCount != result.RegistryEventCount {
			return OperatorCheckpointResult{}, errors.New("next schedule must bind the exact actual unscheduled registry checkpoint; no replacement authority")
		}
		if _, err := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, next.schedule, next.schedule.AuthorizedAt); err != nil {
			return OperatorCheckpointResult{}, err
		}
		hash, err := next.schedule.Hash()
		if err != nil || hash != next.hash {
			return OperatorCheckpointResult{}, errors.New("next independent schedule authorization is invalid")
		}
		result.NextScheduleHash = &hash
	}
	if options.ProposePQActivationHeight != 0 {
		result.ScheduleCandidate, err = proposeOperatorCheckpointSchedule(bootstrap, state, actual.LastBlockHeight, options.ProposePQActivationHeight)
		if err != nil {
			return OperatorCheckpointResult{}, err
		}
	}
	if options.BackupOutput != "" {
		result.Backup, err = createOperatorCheckpointBackup(options, nil)
		if err != nil {
			return OperatorCheckpointResult{}, err
		}
		result.BackupCreated = true
	}
	if err := captured.unchanged(); err != nil {
		return OperatorCheckpointResult{}, err
	}
	if err := rejectInspectionUnknown(filepath.Dir(options.StatePath)); err != nil {
		return OperatorCheckpointResult{}, err
	}
	if err := rejectInspectionUnknown(filepath.Dir(options.SigningStatePath)); err != nil {
		return OperatorCheckpointResult{}, err
	}
	currentSigning, err := os.Lstat(options.SigningStatePath)
	if err != nil || !samePQStateFile(signingInfo, currentSigning) {
		return OperatorCheckpointResult{}, errors.New("original signing state changed during stopped checkpoint inspection")
	}
	after, err := inspectionDatabaseFiles(dbDirectory)
	if err != nil || !sameInspectionDatabase(before, after) {
		return OperatorCheckpointResult{}, errors.New("original Comet database identity or material changed during read-only inspection")
	}
	wireAfter, err := database.Get([]byte("stateKey"))
	if err != nil || !bytes.Equal(wire, wireAfter) {
		return OperatorCheckpointResult{}, errors.New("actual Comet checkpoint changed during inspection")
	}
	return result, nil
}

func requireInspectionPath(path string) error {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("inspection requires exact original canonical absolute paths")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return errors.New("inspection refuses missing original paths or symlink aliases")
	}
	return nil
}

func existingInspectionWriterLease(path string) (func() error, error) {
	return existingInspectionLockFile(path + ".writer.lock")
}

func existingInspectionLockFile(lockPath string) (func() error, error) {
	if err := requireInspectionPath(lockPath); err != nil {
		return nil, err
	}
	f, err := journalRegularFile(lockPath, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	before, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, err
	}
	if err := lockSnapshotJournal(f); err != nil {
		f.Close()
		return nil, errors.New("original application or signing state still has an active writer")
	}
	return func() error {
		current, err := os.Lstat(lockPath)
		if err != nil || !samePQStateFile(before, current) {
			err = errors.New("original stopped-state writer lock identity changed during inspection")
		}
		unlockSnapshotJournal(f)
		return errors.Join(err, f.Close())
	}, nil
}

func rejectInspectionUnknown(directory string) error {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		name := strings.ToLower(entry.Name())
		if strings.Contains(name, "unknown") || strings.HasSuffix(name, ".partial") || strings.HasSuffix(name, ".tmp") || strings.HasPrefix(name, ".ynx-abci-state-") || strings.HasPrefix(name, ".ynx-journal-compact-") {
			return errors.New("uncertain original state material must be reconciled before checkpoint inspection")
		}
	}
	return nil
}

var inspectionDatabaseName = regexp.MustCompile(`^(LOCK|CURRENT|CURRENT\.bak|LOG|LOG\.old|MANIFEST-[0-9]+|[0-9]+\.(ldb|sst|log))$`)

func inspectionDatabaseFiles(directory string) (map[string]os.FileInfo, error) {
	if err := requireInspectionPath(directory); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, err
	}
	result := make(map[string]os.FileInfo, len(entries))
	for _, entry := range entries {
		info, err := os.Lstat(filepath.Join(directory, entry.Name()))
		if err != nil || !info.Mode().IsRegular() || !inspectionDatabaseName.MatchString(entry.Name()) {
			return nil, errors.New("Comet state database contains non-original, partial, UNKNOWN or symlink material")
		}
		result[entry.Name()] = info
	}
	if result["LOCK"] == nil || result["CURRENT"] == nil {
		return nil, errors.New("existing original Comet LOCK and CURRENT are required; never create or recover them")
	}
	current, err := os.Open(filepath.Join(directory, "CURRENT"))
	if err != nil {
		return nil, err
	}
	raw, readErr := io.ReadAll(io.LimitReader(current, 257))
	closeErr := current.Close()
	manifest := strings.TrimSuffix(string(raw), "\n")
	if readErr != nil || closeErr != nil || len(raw) > 256 || !strings.HasPrefix(manifest, "MANIFEST-") || result[manifest] == nil || string(raw) != manifest+"\n" {
		return nil, errors.New("actual Comet CURRENT must resolve its original complete manifest without recovery fallback")
	}
	return result, nil
}

func sameInspectionDatabase(a, b map[string]os.FileInfo) bool {
	if len(a) != len(b) {
		return false
	}
	for name, info := range a {
		if !samePQStateFile(info, b[name]) {
			return false
		}
	}
	return true
}
