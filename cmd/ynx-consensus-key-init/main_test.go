package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

// These tests use only newly generated, temporary synthetic Ed/P2P custody.
// Private/HRS bytes are compared in memory and never printed or exported.
func temporaryCeremony(t *testing.T) (string, string, consensus.ProductionKeyCeremonyRecord) {
	t.Helper()
	root := t.TempDir()
	keys, public := filepath.Join(root, "keys"), filepath.Join(root, "public.json")
	record, err := consensus.InitializeProductionKeyFiles("seoul", keys, public)
	if err != nil {
		t.Fatal(err)
	}
	observed, err := consensus.ReadProductionKeyRecord("seoul", keys)
	if err != nil || observed != record {
		t.Fatalf("normal temporary ceremony identity could not be read: %v", err)
	}
	return keys, public, record
}

func assertPublicCollisionUnchanged(t *testing.T, path string, record consensus.ProductionKeyCeremonyRecord) {
	t.Helper()
	before, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	var original []byte
	if before.Mode().IsRegular() {
		original, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := writePublicRecord(path, record); !errors.Is(err, os.ErrExist) {
		t.Fatalf("inspection did not reject the original output collision: %v", err)
	}
	after, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("inspection replaced or modified original evidence: %v", err)
	}
	if before.Mode().IsRegular() {
		actual, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(actual, original) {
			t.Fatalf("inspection changed original file bytes: %v", err)
		}
	}
}

func TestInspectPublicRecordCannotOverwriteOriginalKeysHRSNodeOrPublic(t *testing.T) {
	keys, public, record := temporaryCeremony(t)
	for _, path := range []string{filepath.Join(keys, "priv_validator_key.json"), filepath.Join(keys, "priv_validator_state.json"), filepath.Join(keys, "node_key.json"), public} {
		t.Run(filepath.Base(path), func(t *testing.T) {
			assertPublicCollisionUnchanged(t, path, record)
			observed, err := consensus.ReadProductionKeyRecord("seoul", keys)
			if err != nil || observed != record {
				t.Fatalf("inspection collision changed the original normal identity: %v", err)
			}
		})
	}
}

func TestInspectPublicRecordRejectsSymlinksDirectoriesAndEmptyEvidence(t *testing.T) {
	keys, _, record := temporaryCeremony(t)
	root := filepath.Dir(keys)
	for _, kind := range []string{"private-key-symlink", "dangling-symlink", "directory", "empty-public", "original-public-mode"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(root, kind)
			switch kind {
			case "private-key-symlink":
				if err := os.Symlink(filepath.Join(keys, "priv_validator_key.json"), path); err != nil {
					t.Fatal(err)
				}
			case "dangling-symlink":
				if err := os.Symlink(filepath.Join(root, "absent-original"), path); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(path, 0o700); err != nil {
					t.Fatal(err)
				}
			case "empty-public":
				if err := os.WriteFile(path, nil, 0o600); err != nil {
					t.Fatal(err)
				}
			case "original-public-mode":
				if err := os.WriteFile(path, []byte("original public evidence\n"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			var target string
			if kind == "private-key-symlink" || kind == "dangling-symlink" {
				var err error
				target, err = os.Readlink(path)
				if err != nil {
					t.Fatal(err)
				}
			}
			assertPublicCollisionUnchanged(t, path, record)
			if target != "" {
				actual, err := os.Readlink(path)
				if err != nil || actual != target {
					t.Fatalf("inspection replaced an original symlink: %v", err)
				}
			}
			observed, err := consensus.ReadProductionKeyRecord("seoul", keys)
			if err != nil || observed != record {
				t.Fatalf("inspection changed original key through an output alias: %v", err)
			}
		})
	}
}

func TestInspectPublicRecordCreatesExactNewDurablePublicOutput(t *testing.T) {
	keys, _, record := temporaryCeremony(t)
	output := filepath.Join(filepath.Dir(keys), "inspected-new-public.json")
	if err := writePublicRecord(output, record); err != nil {
		t.Fatal(err)
	}
	expected, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	expected = append(expected, '\n')
	actual, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatalf("inspection changed the normal public record encoding: %v", err)
	}
	info, err := os.Lstat(output)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
		t.Fatalf("new inspection output is missing or permissive: %v", err)
	}
	assertPublicCollisionUnchanged(t, output, record)
	observed, err := consensus.ReadProductionKeyRecord("seoul", keys)
	if err != nil || observed != record {
		t.Fatalf("normal inspection changed source custody: %v", err)
	}
}

type publicRecordFaultFile struct {
	*os.File
	limit                       int
	writeErr, syncErr, closeErr error
	syncCalls, closeCalls       int
}

func (f *publicRecordFaultFile) Write(payload []byte) (int, error) {
	if f.limit >= 0 && f.limit < len(payload) {
		payload = payload[:f.limit]
	}
	n, err := f.File.Write(payload)
	return n, errors.Join(err, f.writeErr)
}

func (f *publicRecordFaultFile) Sync() error {
	f.syncCalls++
	return errors.Join(f.File.Sync(), f.syncErr)
}

func (f *publicRecordFaultFile) Close() error {
	f.closeCalls++
	return errors.Join(f.File.Close(), f.closeErr)
}

func TestInspectPublicRecordPersistenceFailuresRetainPartialAndFirstCause(t *testing.T) {
	syntheticIO := errors.New("synthetic public-file I/O failure")
	payload := []byte("synthetic public ceremony record; no private material\n")
	for _, kind := range []string{"partial-write-error", "short-write", "sync-error", "close-error"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "uncertain-public.json")
			file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
			if err != nil {
				t.Fatal(err)
			}
			fault := &publicRecordFaultFile{File: file, limit: -1}
			expected, expectedErr := payload, syntheticIO
			switch kind {
			case "partial-write-error":
				fault.limit, fault.writeErr, expected = 7, syntheticIO, payload[:7]
			case "short-write":
				fault.limit, expected, expectedErr = 7, payload[:7], io.ErrShortWrite
			case "sync-error":
				fault.syncErr = syntheticIO
			case "close-error":
				fault.closeErr = syntheticIO
			}
			if err := persistPublicRecordFile(fault, payload); !errors.Is(err, expectedErr) {
				t.Fatalf("public persistence lost the original failure: %v", err)
			}
			if fault.syncCalls != 1 || fault.closeCalls != 1 {
				t.Fatal("failed public write skipped sync or close")
			}
			actual, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(actual, expected) {
				t.Fatalf("failed public write removed or rewrote retained bytes: %v", err)
			}
			// The production top-level writer cannot silently replace this
			// partial/uncertain original after the failed operation.
			assertPublicCollisionUnchanged(t, path, consensus.ProductionKeyCeremonyRecord{})
		})
	}
}
