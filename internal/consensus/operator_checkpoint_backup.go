package consensus

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type OperatorCheckpointBackup struct {
	SHA256           string `json:"sha256"`
	Bytes            int64  `json:"bytes,string"`
	SourceConsistent bool   `json:"sourceConsistent"`
}

type operatorCheckpointBackupHooks struct{ afterEntry func(string) error }

// Called only while InspectOperatorCheckpoint owns the original App/signing
// writer leases and the original Comet database's read-only LOCK. It archives
// approved exact source paths, never scans the signing file's private siblings.
// All partials and completed archives are private, exclusive and retained.
func createOperatorCheckpointBackup(options OperatorCheckpointOptions, hooks *operatorCheckpointBackupHooks) (_ *OperatorCheckpointBackup, result error) {
	output := options.BackupOutput
	if output == "" || !filepath.IsAbs(output) || filepath.Clean(output) != output {
		return nil, errors.New("checkpoint backup requires an exact new absolute archive path")
	}
	parent := filepath.Dir(output)
	if err := requireInspectionPath(parent); err != nil {
		return nil, err
	}
	parentInfo, err := os.Stat(parent)
	if err != nil || !parentInfo.IsDir() || parentInfo.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("checkpoint backup parent must already be a private directory")
	}
	if filepath.Base(options.CometDataDirectory) != "data" {
		return nil, errors.New("checkpoint backup requires the original normal Comet home/data layout")
	}
	home := filepath.Dir(options.CometDataDirectory)
	if home == "/" {
		return nil, errors.New("checkpoint backup refuses a filesystem root as Comet home")
	}
	signingLock := options.SigningStatePath + ".writer.lock"
	if options.SigningLockKind == "pq-signer" {
		signingLock = options.SigningStatePath + ".lock"
	}
	paths := []string{home, options.StatePath, options.StatePath + ".writer.lock", options.SigningStatePath, signingLock}
	if options.BackupLegacyKeyPath == options.BackupNodeKeyPath {
		return nil, errors.New("backup must preserve distinct original validator and P2P key identities")
	}
	for _, key := range []string{options.BackupLegacyKeyPath, options.BackupNodeKeyPath} {
		if err := requireInspectionPath(key); err != nil {
			return nil, err
		}
		info, err := os.Lstat(key)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || info.Size() == 0 {
			return nil, errors.New("backup requires both exact original private regular validator and P2P key paths")
		}
		paths = append(paths, key)
	}
	if options.StateLayout != "atomic-json" {
		paths = append(paths, options.StatePath+".lock", options.StatePath+".read.lock")
	}
	for _, source := range paths {
		if source == output || strings.HasPrefix(output, source+string(os.PathSeparator)) || filepath.Dir(source) == parent {
			return nil, errors.New("checkpoint archive must be outside the original home/application/signing source directories")
		}
	}
	for _, path := range []string{output, output + ".partial"} {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			return nil, errors.New("original checkpoint backup or partial already exists; retain UNKNOWN without retry")
		}
	}
	inventory := make(map[string]os.FileInfo)
	for _, source := range paths {
		if err := requireInspectionPath(source); err != nil {
			return nil, err
		}
		if err := filepath.Walk(source, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() && !info.Mode().IsRegular() {
				return errors.New("checkpoint backup refuses symlink or special source material")
			}
			name := strings.ToLower(info.Name())
			if strings.Contains(name, "unknown") || strings.HasSuffix(name, ".partial") || strings.HasSuffix(name, ".tmp") {
				return errors.New("checkpoint backup source contains unreconciled partial or UNKNOWN")
			}
			inventory[path] = info
			return nil
		}); err != nil {
			return nil, err
		}
	}
	names := make([]string, 0, len(inventory))
	for name := range inventory {
		names = append(names, name)
	}
	sort.Strings(names)
	partial, err := os.OpenFile(output+".partial", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	defer func() { result = errors.Join(result, partial.Close()) }()
	digest := sha256.New()
	zipped := gzip.NewWriter(io.MultiWriter(partial, digest))
	archive := tar.NewWriter(zipped)
	for _, name := range names {
		before := inventory[name]
		current, err := os.Lstat(name)
		if err != nil || !samePQStateFile(before, current) {
			return nil, errors.New("checkpoint source changed before archive read")
		}
		header, err := tar.FileInfoHeader(before, "")
		if err != nil {
			return nil, err
		}
		header.Name = strings.TrimPrefix(name, string(os.PathSeparator))
		if err := archive.WriteHeader(header); err != nil {
			return nil, err
		}
		if before.Mode().IsRegular() {
			f, err := os.Open(name)
			if err != nil {
				return nil, err
			}
			opened, statErr := f.Stat()
			if statErr != nil || !samePQStateFile(before, opened) {
				f.Close()
				return nil, errors.New("checkpoint source replaced while opening archive input")
			}
			n, copyErr := io.CopyN(archive, f, before.Size())
			after, statErr := f.Stat()
			closeErr := f.Close()
			if copyErr != nil || n != before.Size() || statErr != nil || closeErr != nil || !samePQStateFile(before, after) {
				return nil, errors.Join(errors.New("checkpoint source changed or failed during archive streaming"), copyErr, statErr, closeErr)
			}
		}
		if hooks != nil && hooks.afterEntry != nil {
			if err := hooks.afterEntry(name); err != nil {
				return nil, err
			}
		}
	}
	if err := errors.Join(archive.Close(), zipped.Close()); err != nil {
		return nil, err
	}
	if err := partial.Sync(); err != nil {
		return nil, err
	}
	info, err := partial.Stat()
	if err != nil {
		return nil, err
	}
	for name, before := range inventory {
		current, err := os.Lstat(name)
		if err != nil || !samePQStateFile(before, current) {
			return nil, errors.New("checkpoint source changed before completing locked archive")
		}
	}
	// Rewalk the approved home only to detect a newly created/removed entry;
	// never discover or copy private siblings outside the exact signing path.
	observed := 0
	if err := filepath.Walk(home, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		observed++
		if before := inventory[path]; before == nil || !samePQStateFile(before, info) {
			return errors.New("original Comet home changed during archive streaming")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if observed == 0 || info.Size() <= 0 {
		return nil, errors.New("checkpoint archive is incomplete")
	}
	if err := syncInitializationDirectory(parent); err != nil {
		return nil, err
	}
	if err := os.Link(output+".partial", output); err != nil {
		return nil, fmt.Errorf("exclusive checkpoint archive completion (partial retained): %w", err)
	}
	if err := syncInitializationDirectory(parent); err != nil {
		return nil, err
	}
	return &OperatorCheckpointBackup{SHA256: hex.EncodeToString(digest.Sum(nil)), Bytes: info.Size(), SourceConsistent: true}, nil
}
