package consensus

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
	"github.com/syndtr/goleveldb/leveldb/opt"
)

func TestOperatorCheckpointBackupSameLockedCheckpointPreservesSourceAndPartial(t *testing.T) {
	f := newOperatorInspectionFixture(t, "block-journal")
	f.options.BackupOutput = filepath.Join(t.TempDir(), "committed-source.tar.gz")
	roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
	before := inspectionInventory(t, roots...)
	result, err := f.inspect()
	if err != nil || !result.BackupCreated || result.Backup == nil || !result.Backup.SourceConsistent || !result.SourceReadOnly || result.Height != f.actual.LastBlockHeight {
		t.Fatal("locked source backup failed", result, err)
	}
	raw, err := os.ReadFile(f.options.BackupOutput)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if result.Backup.SHA256 != hex.EncodeToString(digest[:]) || result.Backup.Bytes != int64(len(raw)) {
		t.Fatal("backup receipt differs from actual retained archive")
	}
	partial, err := os.ReadFile(f.options.BackupOutput + ".partial")
	if err != nil || !bytes.Equal(raw, partial) {
		t.Fatal("completion lost original retained partial", err)
	}
	compressed, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer compressed.Close()
	archive := tar.NewReader(compressed)
	seen := make(map[string][]byte)
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Typeflag == tar.TypeReg {
			value, err := io.ReadAll(archive)
			if err != nil {
				t.Fatal(err)
			}
			seen["/"+header.Name] = value
		}
	}
	for _, path := range []string{f.h.path, f.h.path + ".writer.lock", f.h.path + ".lock", f.h.path + ".read.lock", f.options.SigningStatePath, f.options.SigningStatePath + ".writer.lock", f.options.BackupLegacyKeyPath, f.options.BackupNodeKeyPath} {
		if !bytes.Equal(seen[path], before[path].Data) {
			t.Fatal("exact source file or sidecar absent from backup", path)
		}
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
		t.Fatal("backup changed original App/history/HRS/DB/locks")
	}
	if _, err := f.inspect(); err == nil {
		t.Fatal("existing backup was overwritten or automatically retried")
	}
	again, err := os.ReadFile(f.options.BackupOutput)
	if err != nil || !bytes.Equal(raw, again) {
		t.Fatal("refused retry changed retained archive", err)
	}
}

func TestOperatorCheckpointBackupInterruptionKeepsAllWriterFencesAndFirstCause(t *testing.T) {
	f := newOperatorInspectionFixture(t, "snapshot-journal")
	f.options.BackupOutput = filepath.Join(t.TempDir(), "interrupted.tar.gz")
	app, err := existingInspectionWriterLease(f.h.path)
	if err != nil {
		t.Fatal(err)
	}
	defer app()
	signer, err := existingInspectionWriterLease(f.options.SigningStatePath)
	if err != nil {
		t.Fatal(err)
	}
	defer signer()
	database, err := dbm.NewGoLevelDBWithOpts("state", f.options.CometDataDirectory, &opt.Options{ReadOnly: true, ErrorIfMissing: true})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	before := inspectionInventory(t, filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory))
	first := errors.New("actual archive streaming interruption fixture")
	_, err = createOperatorCheckpointBackup(f.options, &operatorCheckpointBackupHooks{afterEntry: func(string) error {
		for _, path := range []string{f.h.path, f.options.SigningStatePath} {
			lease, err := AcquireApplicationStateWriterLease(path)
			if err == nil {
				_ = lease.Close()
				t.Fatal("writer entered the locked backup interval")
			}
		}
		writer, err := dbm.NewGoLevelDB("state", f.options.CometDataDirectory)
		if err == nil {
			_ = writer.Close()
			t.Fatal("Comet database writer entered the locked backup interval")
		}
		return first
	}})
	if !errors.Is(err, first) {
		t.Fatal("archive lost its actual first cause", err)
	}
	partial, err := os.ReadFile(f.options.BackupOutput + ".partial")
	if err != nil || len(partial) == 0 {
		t.Fatal("interrupted backup discarded partial bytes", err)
	}
	if _, err := os.Lstat(f.options.BackupOutput); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("interrupted archive was promoted to completion", err)
	}
	if _, err := createOperatorCheckpointBackup(f.options, nil); err == nil {
		t.Fatal("uncertain original archive was resent")
	}
	after, err := os.ReadFile(f.options.BackupOutput + ".partial")
	if err != nil || !bytes.Equal(partial, after) {
		t.Fatal("retry changed original partial", err)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory))) {
		t.Fatal("interruption modified original source")
	}
}

func TestOperatorCheckpointBackupDoesNotScanPrivateSigningSiblings(t *testing.T) {
	f := newOperatorInspectionFixture(t, "atomic-json")
	privateSibling := filepath.Join(filepath.Dir(f.options.SigningStatePath), "unrelated-paused-product.key")
	if err := os.WriteFile(privateSibling, []byte("never include unrelated private key"), 0o600); err != nil {
		t.Fatal(err)
	}
	f.options.BackupOutput = filepath.Join(t.TempDir(), "exact-source.tar.gz")
	if _, err := f.inspect(); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(f.options.BackupOutput)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer compressed.Close()
	archive := tar.NewReader(compressed)
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(header.Name, "unrelated-paused-product") {
			t.Fatal("backup scanned unrelated private signing directory")
		}
	}
}
