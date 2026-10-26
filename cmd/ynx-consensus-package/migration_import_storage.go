package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	abci "github.com/cometbft/cometbft/abci/types"
	"golang.org/x/sys/unix"
)

const importStorageVersion = "YNX-MIGRATION-IMPORTED-STORAGE/v1"
const importStorageStateName = "state.blocks"

// One original V2 checkpoint frame, including its existing framing/header.
// This does not increase the core's 512MiB checkpoint payload bound or admit
// block deltas. The original migration remains a separate, complete input.
const importStorageCheckpointMaximum int64 = (512 << 20) + int64(len("YNX_ABCI_BLOCK_JOURNAL_V2\n")) + 64 + 1 + 8 + 2*sha256.Size

type importStorageReceipt struct {
	Version               string                      `json:"version"`
	Classification        string                      `json:"classification"`
	Scope                 string                      `json:"scope"`
	Phase                 string                      `json:"phase"`
	SourceSHA256          string                      `json:"sourceSHA256"`
	SourceBytes           string                      `json:"sourceBytes"`
	CheckpointSHA256      string                      `json:"checkpointSHA256"`
	CheckpointBytes       string                      `json:"checkpointBytes"`
	RestoredImportedState bool                        `json:"restoredImportedState"`
	ConsensusColdRestore  string                      `json:"consensusColdRestore"`
	Preservation          migrationPreservationResult `json:"preservation"`
}

// These handles guard only this explicit private DATA directory and its four
// fixed files. They never open validator custody, keys, HRS or a live database.
type importStorageDirectory struct {
	path   string
	file   *os.File
	before unix.Stat_t
}

type importStorageFile struct {
	path   string
	file   *os.File
	before unix.Stat_t
}

func sameImportStorageDirectory(a, b unix.Stat_t) bool {
	// Creating the child directory legitimately changes its parent's link count,
	// timestamps and size. The inode, owner and permissions must stay the same.
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Mode == b.Mode && a.Uid == b.Uid && a.Gid == b.Gid
}

func openImportStorageDirectory(path string) (*importStorageDirectory, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return nil, errors.New("import storage requires a canonical directory without symlinks")
	}
	var before unix.Stat_t
	if err := unix.Lstat(path, &before); err != nil {
		return nil, err
	}
	if before.Mode&unix.S_IFMT != unix.S_IFDIR || before.Mode&07777 != 0700 || before.Uid != uint32(os.Geteuid()) {
		return nil, errors.New("import storage directory must be private 0700 and owned by the caller")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	d := &importStorageDirectory{path: path, file: os.NewFile(uintptr(fd), "import-storage-directory"), before: before}
	if err := d.check(); err != nil {
		_ = d.file.Close()
		return nil, err
	}
	return d, nil
}

func (d *importStorageDirectory) check() error {
	var opened, current unix.Stat_t
	if unix.Fstat(int(d.file.Fd()), &opened) != nil || unix.Lstat(d.path, &current) != nil || !sameImportStorageDirectory(d.before, opened) || !sameImportStorageDirectory(d.before, current) {
		return errors.New("import storage directory identity changed")
	}
	resolved, err := filepath.EvalSymlinks(d.path)
	if err != nil || resolved != d.path {
		return errors.New("import storage directory path changed")
	}
	return nil
}

func (f *importStorageFile) check() error {
	var opened, current unix.Stat_t
	if unix.Fstat(int(f.file.Fd()), &opened) != nil || unix.Lstat(f.path, &current) != nil || !sameMigrationSummaryInput(f.before, opened) || !sameMigrationSummaryInput(f.before, current) {
		return errors.New("original import checkpoint or lock identity changed")
	}
	return nil
}

func openImportStorageFiles(directory *importStorageDirectory) (files []*importStorageFile, resultErr error) {
	names := []string{importStorageStateName, importStorageStateName + ".lock", importStorageStateName + ".read.lock", importStorageStateName + ".writer.lock"}
	if err := directory.check(); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(directory.path)
	if err != nil || len(entries) != len(names) {
		return nil, errors.New("import storage must contain exactly the original checkpoint and three lock files")
	}
	wanted := make(map[string]bool, len(names))
	for _, name := range names {
		wanted[name] = true
	}
	for _, entry := range entries {
		if !wanted[entry.Name()] {
			return nil, errors.New("import storage contains unrecognized or partial material")
		}
	}
	defer func() {
		if resultErr != nil {
			for _, f := range files {
				_ = f.file.Close()
			}
			files = nil
		}
	}()
	for i, name := range names {
		path := filepath.Join(directory.path, name)
		var before unix.Stat_t
		if err := unix.Lstat(path, &before); err != nil {
			return files, err
		}
		if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Mode&07777 != 0600 || before.Nlink != 1 || before.Uid != uint32(os.Geteuid()) || (i == 0 && (before.Size <= 0 || before.Size > importStorageCheckpointMaximum)) || (i != 0 && before.Size != 0) {
			return files, errors.New("import checkpoint and empty locks must be caller-owned private single-link regular files within their existing bounds")
		}
		fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
		if err != nil {
			return files, err
		}
		f := &importStorageFile{path: path, file: os.NewFile(uintptr(fd), "original-import-storage"), before: before}
		files = append(files, f)
		if err := f.check(); err != nil {
			return files, err
		}
	}
	return files, directory.check()
}

func readImportStorageCheckpoint(f *importStorageFile, migration chain.ConsensusMigrationState, independentPin string) (string, error) {
	if err := f.check(); err != nil {
		return "", err
	}
	if _, err := f.file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	// Keep the complete independent byte pin, but do not retain a second
	// full journal buffer alongside the decoded Application checkpoint.
	digest := sha256.New()
	n, err := io.CopyBuffer(digest, io.LimitReader(f.file, importStorageCheckpointMaximum+1), make([]byte, 64<<10))
	if err != nil || n != f.before.Size || n > importStorageCheckpointMaximum {
		return "", errors.New("import checkpoint changed or exceeded its existing complete-frame bound")
	}
	if err := f.check(); err != nil {
		return "", err
	}
	pin := hex.EncodeToString(digest.Sum(nil))
	if independentPin != "" && pin != independentPin {
		return "", errors.New("import checkpoint differs from the independent SHA256")
	}
	// ReaderAt leaves the hash reader's offset unchanged. The exact original
	// FD remains held, with its path and nanosecond identity checked again
	// after the decoder's final read; no repair or tail truncation is allowed.
	decoded, err := consensus.DecodeBlockJournalReader(context.Background(), f.file, f.before.Size, migration)
	if identityErr := f.check(); identityErr != nil {
		return "", identityErr
	}
	if err != nil {
		return "", fmt.Errorf("decode complete original import checkpoint: %w", err)
	}
	if decoded.IncompleteTail || int64(decoded.CompleteBytes) != f.before.Size || decoded.ReplayedBlocks != 0 || decoded.ReplayedTransactionInputs != 0 || decoded.State.Initialized || decoded.State.Height != int64(migration.Height) || decoded.State.AppHash != migration.StateHash || decoded.State.ValidatorRegistry != nil || decoded.State.PQEngineSchedule != nil {
		return "", errors.New("import checkpoint must be complete, uninitialized, without deltas or validator authority, at the exact original migration height and hash")
	}
	return pin, nil
}

func confirmImportStorageFiles(directory *importStorageDirectory, files []*importStorageFile, checkpointPin string) error {
	if err := directory.check(); err != nil {
		return err
	}
	entries, err := os.ReadDir(directory.path)
	if err != nil || len(entries) != len(files) {
		return errors.New("import storage file set changed")
	}
	for i, f := range files {
		if err := f.check(); err != nil {
			return err
		}
		if _, err := f.file.Seek(0, io.SeekStart); err != nil {
			return err
		}
		hash := sha256.New()
		n, err := io.Copy(hash, io.LimitReader(f.file, f.before.Size+1))
		if err != nil || n != f.before.Size {
			return errors.New("original import checkpoint or lock bytes changed")
		}
		if i == 0 && hex.EncodeToString(hash.Sum(nil)) != checkpointPin {
			return errors.New("original import checkpoint SHA256 changed during inspection")
		}
		if err := f.check(); err != nil {
			return err
		}
	}
	return directory.check()
}

func verifyMigrationImportStorage(migrationPath, directory, phase, checkpointPin string, output io.Writer) (resultErr error) {
	if output == nil || (phase != "create" && phase != "reopen") {
		return errors.New("import storage requires an output and explicit create or reopen phase")
	}
	if phase == "create" && checkpointPin != "" {
		return errors.New("create cannot accept a checkpoint pin or reuse an existing checkpoint")
	}
	if phase == "reopen" {
		pin, err := hex.DecodeString(checkpointPin)
		if err != nil || len(pin) != sha256.Size || hex.EncodeToString(pin) != checkpointPin || checkpointPin == strings.Repeat("0", 64) {
			return errors.New("reopen requires an independent nonzero canonical SHA256")
		}
	}
	if directory == "" || strings.ContainsRune(directory, 0) || !filepath.IsAbs(directory) || filepath.Clean(directory) != directory || directory == string(filepath.Separator) {
		return errors.New("import storage requires an explicit canonical absolute directory")
	}
	var lease *consensus.ApplicationStateWriterLease
	defer func() {
		if lease != nil {
			resultErr = errors.Join(resultErr, lease.Close())
		}
	}()
	encoded, err := withVerifiedMigrationInput(migrationPath, func(migration chain.ConsensusMigrationState, sourceSHA256, sourceBytes string) (encoded []byte, resultErr error) {
		parent, err := openImportStorageDirectory(filepath.Dir(directory))
		if err != nil {
			return nil, err
		}
		defer func() { resultErr = errors.Join(resultErr, parent.file.Close()) }()
		if phase == "create" {
			if err := os.Mkdir(directory, 0700); err != nil {
				return nil, fmt.Errorf("reserve exclusive import storage directory (existing or partial material retained): %w", err)
			}
			if err := parent.file.Sync(); err != nil {
				return nil, err
			}
		}
		if err := parent.check(); err != nil {
			return nil, err
		}
		dir, err := openImportStorageDirectory(directory)
		if err != nil {
			return nil, err
		}
		defer func() { resultErr = errors.Join(resultErr, dir.file.Close()) }()
		var files []*importStorageFile
		defer func() {
			for _, f := range files {
				resultErr = errors.Join(resultErr, f.file.Close())
			}
		}()
		if phase == "reopen" {
			files, err = openImportStorageFiles(dir)
			if err != nil {
				return nil, err
			}
		}
		statePath := filepath.Join(directory, importStorageStateName)
		lease, err = consensus.AcquireApplicationStateWriterLease(statePath)
		if err != nil {
			return nil, err
		}
		if phase == "create" {
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 1 || entries[0].Name() != importStorageStateName+".writer.lock" {
				return nil, errors.New("new import directory changed before checkpoint creation; original material retained")
			}
		}
		if phase == "reopen" {
			// The normal unbound constructor accepts a complete prefix and Syncs
			// existing storage. Reject every incomplete/delta form before it runs;
			// never use recovery or an invented block to obtain a success receipt.
			if _, err := readImportStorageCheckpoint(files[0], migration, checkpointPin); err != nil {
				return nil, err
			}
			if err := confirmImportStorageFiles(dir, files, checkpointPin); err != nil {
				return nil, err
			}
		}
		application, err := consensus.NewBlockJournaledApplication(migration, statePath)
		if err != nil {
			return nil, err
		}
		if phase == "create" {
			files, err = openImportStorageFiles(dir)
			if err != nil {
				return nil, err
			}
			checkpointPin, err = readImportStorageCheckpoint(files[0], migration, "")
			if err != nil {
				return nil, err
			}
		}
		preservation, err := checkMigrationPreservationApplication(migration, application)
		if err != nil {
			return nil, err
		}
		preservation.SourceSHA256, preservation.SourceBytes = sourceSHA256, sourceBytes
		response, err := application.Query(context.Background(), &abci.RequestQuery{Path: consensus.ApplicationPersistencePath})
		if err != nil || response == nil || response.Code != 0 || response.Height != int64(migration.Height) {
			return nil, errors.New("import checkpoint persistence query failed")
		}
		var persistence consensus.ApplicationPersistenceView
		if json.Unmarshal(response.Value, &persistence) != nil || consensus.ValidateApplicationPersistenceView(persistence) != nil || !persistence.Persistence || persistence.Storage != "block-journal-v2" || persistence.StateHeight != int64(migration.Height) || persistence.StateAppHash != migration.StateHash {
			return nil, errors.New("normal application did not confirm persistence at the original imported height and hash")
		}
		if err := confirmImportStorageFiles(dir, files, checkpointPin); err != nil {
			return nil, err
		}
		if err := parent.check(); err != nil {
			return nil, err
		}
		receipt := importStorageReceipt{Version: importStorageVersion, Classification: "data", Scope: "uninitialized-import-checkpoint", Phase: phase,
			SourceSHA256: sourceSHA256, SourceBytes: sourceBytes, CheckpointSHA256: checkpointPin, CheckpointBytes: strconv.FormatInt(files[0].before.Size, 10),
			RestoredImportedState: phase == "reopen", ConsensusColdRestore: "unchecked", Preservation: preservation}
		encoded, err = json.Marshal(receipt)
		if err != nil || len(encoded)+1 > 64<<10 {
			return nil, errors.New("import storage receipt exceeds its bounded public output")
		}
		return encoded, nil
	})
	if err != nil {
		return err
	}
	// A failed or short stdout write leaves the new checkpoint and all partial
	// evidence intact. It cannot authorize an automatic create retry.
	return writeMigrationCheckOutput(output, encoded)
}
