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
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const ApplicationInitializationVersion = "YNX-APPLICATION-INITIALIZATION/v1"

// ApplicationInitializationOptions selects one new, independently approved
// state path. Its immediate directory must not exist, even if it looks empty.
// This operation never restores, converts or resets an existing application.
type ApplicationInitializationOptions struct {
	StatePath      string
	StateLayout    string
	RuntimeUpgrade *RuntimeUpgradeAuthorization
}

// ApplicationInitializationResult is an offline persistence result only. The
// migration anchor remains uninitialized until the normal engine executes its
// first block; no consensus checkpoint or activation authority is invented.
type ApplicationInitializationResult struct {
	Version            string `json:"version"`
	StatePath          string `json:"statePath"`
	StateLayout        string `json:"stateLayout"`
	MigrationStateHash string `json:"migrationStateHash"`
	Height             int64  `json:"height,string"`
	AppHash            string `json:"appHash"`
	StateSHA256        string `json:"stateSHA256"`
	ColdReadVerified   bool   `json:"coldReadVerified"`
	Initialized        bool   `json:"initialized"`
	Deployed           bool   `json:"deployed"`
	PQActivated        bool   `json:"pqActivated"`
}

type applicationInitializationHooks struct {
	afterReservation func(string) error
}

// InitializeApplication imports a complete native migration into a fresh
// single-App destination through the original application constructors and
// storage formats. Independent pins are checked before any destination write.
// All errors retain any reserved directory, attempt marker and partial files.
func InitializeApplication(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options ApplicationInitializationOptions) (ApplicationInitializationResult, error) {
	return initializeApplication(migration, rawGenesis, pins, options, nil)
}

func initializeApplication(migration chain.ConsensusMigrationState, rawGenesis []byte, pins ConsensusBootstrapPins, options ApplicationInitializationOptions, hooks *applicationInitializationHooks) (result ApplicationInitializationResult, err error) {
	bootstrap, err := NewConsensusBootstrap(rawGenesis, pins, migration)
	if err != nil {
		return result, err
	}
	if err := validateInitializationRuntime(bootstrap, migration, options.RuntimeUpgrade); err != nil {
		return result, err
	}
	if options.StateLayout != "atomic-json" && options.StateLayout != "snapshot-journal" && options.StateLayout != "block-journal" {
		return result, errors.New("initialization requires an explicit supported application state layout")
	}
	// Construct and validate the complete original migration projection before
	// reserving disk. This includes account policy, contracts and source history.
	expected, err := NewPersistentApplicationWithBootstrap(migration, "", bootstrap)
	if err != nil {
		return result, err
	}
	if err = expected.ValidateNormalRuntime(); err != nil {
		return result, err
	}
	want, err := json.Marshal(expected.committed)
	if err != nil {
		return result, err
	}
	directory, parent, err := initializationDestination(options.StatePath)
	if err != nil {
		return result, err
	}
	// Mkdir, rather than MkdirAll, is the exclusive reservation. An old state,
	// lock, UNKNOWN record or partial attempt is never opened for replacement.
	if err = os.Mkdir(directory, 0o700); err != nil {
		return result, fmt.Errorf("reserve new application directory (existing material is retained): %w", err)
	}
	if err = syncInitializationDirectory(parent); err != nil {
		return result, err
	}
	directoryInfo, err := os.Lstat(directory)
	if err != nil || !directoryInfo.IsDir() || directoryInfo.Mode().Perm() != 0o700 {
		return result, errors.New("reserved application directory must remain private and regular")
	}
	marker, err := json.Marshal(struct {
		Version string                 `json:"version"`
		Path    string                 `json:"statePath"`
		Layout  string                 `json:"stateLayout"`
		Pins    ConsensusBootstrapPins `json:"independentPins"`
	}{ApplicationInitializationVersion, options.StatePath, options.StateLayout, pins})
	if err != nil {
		return result, err
	}
	if err = writeInitializationFile(filepath.Join(directory, ".ynx-initialization-attempt.json"), marker); err != nil {
		return result, err
	}
	if hooks != nil && hooks.afterReservation != nil {
		if err = hooks.afterReservation(directory); err != nil {
			return result, err
		}
	}
	lease, err := AcquireApplicationStateWriterLease(options.StatePath)
	if err != nil {
		return result, err
	}
	defer func() { err = errors.Join(err, lease.Close()) }()
	if options.StateLayout == "atomic-json" {
		// The normal encoder supplies the exact original snapshot format. An
		// exclusive direct write, only inside our new private directory, keeps
		// partial bytes on failure instead of a rename helper deleting them.
		payload, encodeErr := encodeCommittedStateJSON(expected.committed)
		if encodeErr != nil {
			return result, encodeErr
		}
		if err = writeInitializationFile(options.StatePath, payload); err != nil {
			return result, err
		}
	} else {
		// The original snapshot-journal fresh anchor is its hash-bound header;
		// its first snapshot must advance migration.Height. The block journal
		// constructor writes its complete initial checkpoint. Do not manufacture
		// a first block or relax either format's original height rule.
		if _, err = openInitializedApplication(migration, options, bootstrap); err != nil {
			return result, err
		}
	}
	if err = syncInitializationDirectory(directory); err != nil {
		return result, err
	}
	cold, err := openInitializedApplication(migration, options, bootstrap)
	if err != nil {
		return result, fmt.Errorf("cold read initialized application: %w", err)
	}
	got, err := json.Marshal(cold.committed)
	if err != nil || !bytes.Equal(want, got) || cold.committed.Height != int64(migration.Height) || cold.committed.AppHash != migration.StateHash || cold.committed.Initialized {
		return result, errors.New("cold initialized application differs from complete original migration state")
	}
	currentDirectory, err := os.Lstat(directory)
	if err != nil || !os.SameFile(directoryInfo, currentDirectory) || !currentDirectory.IsDir() || currentDirectory.Mode().Perm() != 0o700 {
		return result, errors.New("reserved application directory changed during initialization")
	}
	stateInfo, err := os.Lstat(options.StatePath)
	if err != nil || !stateInfo.Mode().IsRegular() || stateInfo.Mode().Perm() != 0o600 || stateInfo.Size() == 0 {
		return result, errors.New("initialized state must be a nonempty private regular file")
	}
	digest := sha256.Sum256(got)
	return ApplicationInitializationResult{Version: ApplicationInitializationVersion, StatePath: options.StatePath, StateLayout: options.StateLayout, MigrationStateHash: migration.StateHash, Height: cold.committed.Height, AppHash: cold.committed.AppHash, StateSHA256: hex.EncodeToString(digest[:]), ColdReadVerified: true}, nil
}

func validateInitializationRuntime(bootstrap *ConsensusBootstrap, migration chain.ConsensusMigrationState, runtime *RuntimeUpgradeAuthorization) error {
	if bootstrap.record.Params.Version == nil {
		return errors.New("initialization requires an explicit application runtime version")
	}
	version := bootstrap.record.Params.Version.App
	if version != ApplicationVersion {
		if runtime == nil {
			return errors.New("historical application runtime requires an independently pinned runtime upgrade plan and its existing initialized checkpoint")
		}
		if err := validateRuntimeUpgradeBootstrap(migration, bootstrap, runtime); err != nil {
			return err
		}
		return errors.New("fresh initialization cannot replace the existing initialized historical checkpoint required by the runtime upgrade plan")
	}
	if runtime != nil {
		return errors.New("a historical runtime upgrade plan cannot authorize fresh current-runtime initialization")
	}
	return nil
}

func openInitializedApplication(migration chain.ConsensusMigrationState, options ApplicationInitializationOptions, bootstrap *ConsensusBootstrap) (*Application, error) {
	var app *Application
	var err error
	switch options.StateLayout {
	case "atomic-json":
		app, err = NewPersistentApplicationWithBootstrap(migration, options.StatePath, bootstrap)
	case "snapshot-journal":
		app, err = NewJournaledApplicationWithBootstrap(migration, options.StatePath, bootstrap)
	case "block-journal":
		app, err = NewBlockJournaledApplicationWithBootstrap(migration, options.StatePath, bootstrap)
	default:
		return nil, errors.New("unsupported initialization layout")
	}
	if err == nil {
		err = app.ValidateNormalRuntime()
	}
	return app, err
}

func initializationDestination(path string) (string, string, error) {
	if path == "" || strings.TrimSpace(path) != path || !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Base(path) == "." || filepath.Base(path) == string(os.PathSeparator) {
		return "", "", errors.New("initialization state path must be exact, absolute and canonical")
	}
	directory := filepath.Dir(path)
	parent := filepath.Dir(directory)
	if directory == parent {
		return "", "", errors.New("initialization requires a new dedicated destination directory")
	}
	resolved, err := filepath.EvalSymlinks(parent)
	if err != nil || resolved != parent {
		return "", "", errors.New("initialization parent must already exist without symlink aliases")
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0o022 != 0 {
		return "", "", errors.New("initialization parent must be a directory without group or other write access")
	}
	entries, err := os.ReadDir(parent)
	if err != nil {
		return "", "", err
	}
	base := filepath.Base(directory)
	for _, entry := range entries {
		if entry.Name() == base || strings.HasPrefix(entry.Name(), base+".") {
			return "", "", errors.New("initialization destination or related sidecar already exists; original material retained")
		}
	}
	return directory, parent, nil
}

func writeInitializationFile(path string, payload []byte) (result error) {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, f.Close()) }()
	if n, err := f.Write(payload); err != nil || n != len(payload) {
		return errors.Join(err, io.ErrShortWrite)
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return syncInitializationDirectory(filepath.Dir(path))
}

func syncInitializationDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}
