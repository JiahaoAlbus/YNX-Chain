package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type freshInspectionOriginal struct {
	info   os.FileInfo
	digest [32]byte
}

func freshInspectionOriginals(t *testing.T, dir string) map[string]freshInspectionOriginal {
	t.Helper()
	out := map[string]freshInspectionOriginal{}
	if err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		var digest [32]byte
		if info.Mode().IsRegular() {
			raw, e := os.ReadFile(path)
			if e != nil {
				return e
			}
			digest = sha256.Sum256(raw)
		}
		out[path] = freshInspectionOriginal{info, digest}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return out
}
func assertFreshInspectionOriginals(t *testing.T, before map[string]freshInspectionOriginal, dir string) {
	t.Helper()
	after := freshInspectionOriginals(t, dir)
	if len(before) != len(after) {
		t.Fatal("read-only inspection created or deleted original material")
	}
	for path, a := range before {
		b, ok := after[path]
		if !ok || !os.SameFile(a.info, b.info) || a.info.Mode() != b.info.Mode() || a.info.Size() != b.info.Size() || !a.info.ModTime().Equal(b.info.ModTime()) || a.digest != b.digest {
			t.Fatal("read-only inspection changed original", path)
		}
	}
}
func TestInspectFreshApplicationAllLayoutsOriginalSourceAndDigestScopes(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "application", "state")
			init, err := InitializeApplication(f.migration, f.raw, f.pins, ApplicationInitializationOptions{StatePath: path, StateLayout: layout})
			if err != nil {
				t.Fatal(err)
			}
			before := freshInspectionOriginals(t, filepath.Dir(path))
			checks := validatedMigrationFullChecks.Load()
			result, err := InspectFreshApplication(f.migration, f.raw, f.pins, FreshApplicationInspectionOptions{path, layout})
			if err != nil {
				t.Fatal(err)
			}
			if validatedMigrationFullChecks.Load()-checks != 1 {
				t.Fatal("fresh read duplicated complete migration ownership")
			}
			physical, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(physical)
			if result.StateSHA256 != init.StateSHA256 || result.StateFileSHA256 != hex.EncodeToString(digest[:]) || result.StateFileBytes != int64(len(physical)) || result.ProcessID != os.Getpid() || result.Height != int64(f.migration.Height) || result.AppHash != f.migration.StateHash || result.AccountCount != len(f.migration.Accounts) || result.ContractCount != 1 || result.HistoricalBlockCount != len(f.migration.Runtime.Blocks) {
				t.Fatal("source, nonce, executed contract, complete history or digest scopes differ", result)
			}
			if !result.ReadOnly || !result.SourceReadOnly || !result.WriterExcluded || !result.FreshApplicationVerified || result.Initialized || result.EngineCheckpointVerified || result.ConsensusVerified || result.AuthorityGranted || result.NodeStarted || result.SigningPerformed || result.PQActivated {
				t.Fatal("fresh DATA inspection claimed runtime authority", result)
			}
			if layout != "atomic-json" && result.StateSHA256 == result.StateFileSHA256 {
				t.Fatal("framed physical file was mislabeled as canonical state JSON")
			}
			assertFreshInspectionOriginals(t, before, filepath.Dir(path))
		})
	}
}
func TestInspectFreshApplicationRefusesWritersMissingLocksAndUnknown(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, kind := range []string{"active-application-writer", "active-journal-writer", "active-readlock-writer", "missing-application-lock", "missing-journal-lock", "missing-read-lock", "unknown"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "application", "state.blocks")
			if _, err := InitializeApplication(f.migration, f.raw, f.pins, ApplicationInitializationOptions{StatePath: path, StateLayout: "block-journal"}); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "active-application-writer":
				lease, err := AcquireApplicationStateWriterLease(path)
				if err != nil {
					t.Fatal(err)
				}
				defer lease.Close()
			case "active-journal-writer":
				release, err := existingInspectionLockFile(path + ".lock")
				if err != nil {
					t.Fatal(err)
				}
				defer release()
			case "active-readlock-writer":
				file, err := journalRegularFile(path+".read.lock", os.O_RDONLY)
				if err != nil {
					t.Fatal(err)
				}
				if err = lockSnapshotJournalReadersForWrite(file); err != nil {
					t.Fatal(err)
				}
				defer func() { unlockSnapshotJournal(file); file.Close() }()
			case "missing-application-lock":
				if err := os.Remove(path + ".writer.lock"); err != nil {
					t.Fatal(err)
				}
			case "missing-journal-lock":
				if err := os.Remove(path + ".lock"); err != nil {
					t.Fatal(err)
				}
			case "missing-read-lock":
				if err := os.Remove(path + ".read.lock"); err != nil {
					t.Fatal(err)
				}
			case "unknown":
				if err := os.WriteFile(filepath.Join(filepath.Dir(path), "PUBLIC-original.UNKNOWN"), []byte("PUBLIC retained UNKNOWN"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			before := freshInspectionOriginals(t, filepath.Dir(path))
			if result, err := InspectFreshApplication(f.migration, f.raw, f.pins, FreshApplicationInspectionOptions{path, "block-journal"}); err == nil || result.Version != "" {
				t.Fatal("active/missing/UNKNOWN source accepted", kind, err)
			}
			assertFreshInspectionOriginals(t, before, filepath.Dir(path))
		})
	}
}
func TestInspectFreshApplicationRefusesPartialCorruptForeignAndReplacedSource(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	for _, kind := range []string{"partial", "corrupt", "foreign-genesis", "foreign-migration", "symlink", "replaced-inode", "initialized"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "application", "state.blocks")
			if _, err := InitializeApplication(f.migration, f.raw, f.pins, ApplicationInitializationOptions{StatePath: path, StateLayout: "block-journal"}); err != nil {
				t.Fatal(err)
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			pins := f.pins
			options := FreshApplicationInspectionOptions{path, "block-journal"}
			var hooks *freshApplicationInspectionHooks
			switch kind {
			case "partial":
				raw = append(raw, make([]byte, 32)...)
				if err = os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "corrupt":
				raw[len(raw)-1] ^= 1
				if err = os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "foreign-genesis":
				pins.CometGenesisSHA256 = strings.Repeat("a", 64)
			case "foreign-migration":
				pins.MigrationStateHash = strings.Repeat("b", 64)
			case "symlink":
				options.StatePath = filepath.Join(filepath.Dir(path), "PUBLIC-alias")
				if err = os.Symlink(path, options.StatePath); err != nil {
					t.Fatal(err)
				}
			case "initialized":
				state := initialCommittedState(f.migration)
				state.Initialized = true
				payload, e := encodeBlockCheckpoint(state)
				if e != nil {
					t.Fatal(e)
				}
				raw = append([]byte(blockJournalMagic+f.migration.StateHash+"\n"), blockJournalFrame(payload)...)
				raw = append(raw, payload...)
				if err = os.WriteFile(path, raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "replaced-inode":
				hooks = &freshApplicationInspectionHooks{afterOriginalHeld: func() error {
					if e := os.Rename(path, path+".PUBLIC-retained-original"); e != nil {
						return e
					}
					return os.WriteFile(path, bytes.Clone(raw), 0600)
				}}
			}
			before := freshInspectionOriginals(t, filepath.Dir(path))
			result, err := inspectFreshApplication(f.migration, f.raw, pins, options, hooks)
			if err == nil || result.Version != "" {
				t.Fatal("corrupt/partial/substituted/initialized state accepted", kind)
			}
			if kind != "replaced-inode" {
				assertFreshInspectionOriginals(t, before, filepath.Dir(path))
			} else {
				after, e := os.ReadFile(path)
				old, oe := os.ReadFile(path + ".PUBLIC-retained-original")
				if e != nil || oe != nil || !bytes.Equal(after, raw) || !bytes.Equal(old, raw) {
					t.Fatal("refused replacement was repaired or deleted")
				}
			}
		})
	}
}

func TestInspectFreshApplicationSnapshotFreshHeaderDoesNotRelaxEngineReader(t *testing.T) {
	f := newApplicationInitializationFixture(t)
	path := filepath.Join(t.TempDir(), "application", "state.snapshot")
	if _, err := InitializeApplication(f.migration, f.raw, f.pins, ApplicationInitializationOptions{StatePath: path, StateLayout: "snapshot-journal"}); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = readPQEngineCommittedState(path, f.migration, f.bootstrap, nil, nil); err == nil {
		t.Fatal("DATA-only fresh inspection changed the normal live engine empty-journal rejection")
	}
	for _, kind := range []string{"partial", "foreign-hash"} {
		t.Run(kind, func(t *testing.T) {
			raw := bytes.Clone(original)
			if kind == "partial" {
				raw = append(raw, 0)
			} else {
				raw[len(snapshotJournalMagic)] ^= 1
			}
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			before := freshInspectionOriginals(t, filepath.Dir(path))
			if _, err := InspectFreshApplication(f.migration, f.raw, f.pins, FreshApplicationInspectionOptions{path, "snapshot-journal"}); err == nil {
				t.Fatal("noncanonical fresh snapshot header accepted", kind)
			}
			assertFreshInspectionOriginals(t, before, filepath.Dir(path))
		})
	}
}
