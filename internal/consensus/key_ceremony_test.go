package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionKeyCeremonyExistingPublicRecordIsPreservedBeforeGeneration(t *testing.T) {
	for _, kind := range []string{"record", "empty-record", "directory", "dangling-symlink"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			keyDir := filepath.Join(root, "new-keys")
			public := filepath.Join(root, "original-public.json")
			original := []byte("original public ceremony evidence\n")
			switch kind {
			case "record":
				if err := os.WriteFile(public, original, 0o600); err != nil {
					t.Fatal(err)
				}
			case "empty-record":
				original = nil
				if err := os.WriteFile(public, original, 0o600); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(public, 0o700); err != nil {
					t.Fatal(err)
				}
			case "dangling-symlink":
				if err := os.Symlink(filepath.Join(root, "absent-original"), public); err != nil {
					t.Fatal(err)
				}
			}
			before, err := os.Lstat(public)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := InitializeProductionKeyFiles("primary", keyDir, public); err == nil {
				t.Fatal("existing public evidence accepted for a new key ceremony")
			}
			if _, err := os.Lstat(keyDir); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("public conflict reached key directory reservation: %v", err)
			}
			after, err := os.Lstat(public)
			if err != nil || !os.SameFile(before, after) || before.Mode() != after.Mode() || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
				t.Fatalf("original public evidence was changed: %v", err)
			}
			if kind == "record" || kind == "empty-record" {
				actual, err := os.ReadFile(public)
				if err != nil || !bytes.Equal(actual, original) {
					t.Fatalf("original public record bytes changed: %v", err)
				}
			}
			if kind == "dangling-symlink" {
				target, err := os.Readlink(public)
				if err != nil || target != filepath.Join(root, "absent-original") {
					t.Fatalf("original symlink was replaced: %v", err)
				}
			}
		})
	}
}

func TestProductionKeyCeremonyPostGenerationFailureRetainsOriginalCustody(t *testing.T) {
	root := t.TempDir()
	keyDir := filepath.Join(root, "new-keys")
	// This absent parent is a real final-publication I/O failure. The normal
	// callee has already generated and saved the synthetic temporary Ed/P2P
	// keys; no alternate generator or successful mock is substituted.
	public := filepath.Join(root, "missing-output-parent", "public.json")
	record, err := InitializeProductionKeyFiles("seoul", keyDir, public)
	if err == nil || !errors.Is(err, errProductionKeyCeremonyRetained) || !strings.Contains(err.Error(), "do not delete, reset or automatically generate again") {
		t.Fatalf("post-generation failure did not preserve an uncertain ceremony: %v", err)
	}
	if _, err := os.Lstat(public); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("failed publication invented a public record: %v", err)
	}
	observed, err := ReadProductionKeyRecord("seoul", keyDir)
	if err != nil || observed != record || observed.ValidatorAddress != "ynx_validator_seoul" || observed.CustodyBoundary != "owner-controlled-host-local" {
		t.Fatalf("normal inspection cannot recover the retained original identity: %+v %v", observed, err)
	}
	originals := make(map[string][]byte)
	identities := make(map[string]os.FileInfo)
	for _, name := range []string{productionKeyCeremonyIntentFile, "priv_validator_key.json", "priv_validator_state.json", "node_key.json"} {
		path := filepath.Join(keyDir, name)
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 {
			t.Fatalf("failed ceremony lost its private original %s: %v", name, err)
		}
		raw, err := os.ReadFile(path)
		if err != nil || len(raw) == 0 {
			t.Fatalf("failed ceremony lost bytes of %s: %v", name, err)
		}
		originals[name], identities[name] = raw, info
	}
	retryPublic := filepath.Join(root, "retry-public.json")
	if _, err := InitializeProductionKeyFiles("seoul", keyDir, retryPublic); err == nil {
		t.Fatal("failed original ceremony was silently generated again")
	}
	if _, err := os.Lstat(retryPublic); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("retry created a different public result: %v", err)
	}
	for name, expected := range originals {
		path := filepath.Join(keyDir, name)
		actual, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(actual, expected) {
			t.Fatalf("retry changed retained %s bytes: %v", name, err)
		}
		info, err := os.Lstat(path)
		if err != nil || !os.SameFile(info, identities[name]) || !info.ModTime().Equal(identities[name].ModTime()) {
			t.Fatalf("retry replaced retained %s identity: %v", name, err)
		}
	}
}

func TestProductionKeyCeremonyPublicPathCannotReplaceGeneratedPrivateKey(t *testing.T) {
	root := t.TempDir()
	keyDir := filepath.Join(root, "keys")
	// This public target does not exist at preflight but becomes the private
	// Ed file during the real normal ceremony. Final publication must still be
	// exclusive, rather than overwrite it with a superficially valid record.
	public := filepath.Join(keyDir, "priv_validator_key.json")
	if _, err := InitializeProductionKeyFiles("primary", keyDir, public); err == nil || !errors.Is(err, errProductionKeyCeremonyRetained) {
		t.Fatalf("public output replaced generated custody or hid the failure: %v", err)
	}
	record, err := ReadProductionKeyRecord("primary", keyDir)
	if err != nil || record.ValidatorAddress != "ynx_validator_primary" || record.CustodyBoundary != "owner-controlled-host-local" {
		t.Fatalf("failed public publication destroyed original private identity: %+v %v", record, err)
	}
	if _, err := os.Lstat(filepath.Join(keyDir, productionKeyCeremonyIntentFile)); err != nil {
		t.Fatalf("failed output collision removed original intent: %v", err)
	}
	before, err := os.ReadFile(public)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := InitializeProductionKeyFiles("primary", keyDir, filepath.Join(root, "different-result.json")); err == nil {
		t.Fatal("retained conflicting ceremony was generated again")
	}
	after, err := os.ReadFile(public)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("retry changed retained private key: %v", err)
	}
}

func TestProductionKeyCeremonyExclusiveIntentAndPublicCommit(t *testing.T) {
	root := t.TempDir()
	keyDir, public := filepath.Join(root, "keys"), filepath.Join(root, "public.json")
	record, err := InitializeProductionKeyFiles("singapore", keyDir, public)
	if err != nil {
		t.Fatal(err)
	}
	intentPath := filepath.Join(keyDir, productionKeyCeremonyIntentFile)
	raw, err := os.ReadFile(intentPath)
	if err != nil {
		t.Fatal(err)
	}
	var intent map[string]string
	if err := json.Unmarshal(raw, &intent); err != nil || len(intent) != 4 || intent["version"] != "YNX-PRODUCTION-KEY-CEREMONY-INTENT/v1" || intent["role"] != "singapore" || intent["keyDirectory"] != keyDir || intent["publicRecordPath"] != public {
		t.Fatalf("exclusive public intent differs from the original ceremony: %v %s", err, raw)
	}
	publicBytes, err := os.ReadFile(public)
	if err != nil {
		t.Fatal(err)
	}
	var result ProductionKeyCeremonyRecord
	if err := json.Unmarshal(publicBytes, &result); err != nil || result != record || record.ValidatorAddress != "ynx_validator_singapore" {
		t.Fatalf("successful normal public result changed: %v %+v", err, result)
	}
	// This exercises the production final-create primitive against a late
	// collision. Neither partial evidence nor a completed record is truncatable.
	for _, path := range []string{intentPath, public} {
		expected, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		before, err := os.Lstat(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := writeProductionKeyCeremonyExclusive(path, []byte("replacement")); !errors.Is(err, os.ErrExist) {
			t.Fatalf("exclusive original create did not refuse collision: %v", err)
		}
		after, err := os.Lstat(path)
		if err != nil || !os.SameFile(before, after) {
			t.Fatalf("exclusive collision replaced the original file: %v", err)
		}
		actual, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(actual, expected) {
			t.Fatalf("exclusive collision changed the original bytes: %v", err)
		}
	}
}

func TestProductionKeyCeremonyPartialDirectoryAndDanglingDirectoryRefuse(t *testing.T) {
	for _, kind := range []string{"partial-directory", "dangling-symlink"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			keyDir, public := filepath.Join(root, "keys"), filepath.Join(root, "public.json")
			if kind == "partial-directory" {
				if err := os.Mkdir(keyDir, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(keyDir, productionKeyCeremonyIntentFile), []byte("partial original intent"), 0o600); err != nil {
					t.Fatal(err)
				}
			} else if err := os.Symlink(filepath.Join(root, "absent-keys"), keyDir); err != nil {
				t.Fatal(err)
			}
			before, err := os.Lstat(keyDir)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := InitializeProductionKeyFiles("primary", keyDir, public); err == nil {
				t.Fatal("partial or symlink original directory accepted")
			}
			after, err := os.Lstat(keyDir)
			if err != nil || !os.SameFile(before, after) {
				t.Fatalf("original directory or symlink changed: %v", err)
			}
			if _, err := os.Lstat(public); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("refused ceremony wrote public output: %v", err)
			}
			if kind == "partial-directory" {
				raw, err := os.ReadFile(filepath.Join(keyDir, productionKeyCeremonyIntentFile))
				if err != nil || string(raw) != "partial original intent" {
					t.Fatalf("partial original intent was changed: %v", err)
				}
			}
		})
	}
}
