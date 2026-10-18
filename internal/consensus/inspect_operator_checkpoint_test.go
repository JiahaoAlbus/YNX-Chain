package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	dbm "github.com/cometbft/cometbft-db"
	sm "github.com/cometbft/cometbft/state"
	cmttypes "github.com/cometbft/cometbft/types"
)

type operatorInspectionFixture struct {
	h       *engineWiringHarness
	options OperatorCheckpointOptions
	actual  sm.State
	next    *PQEngineAuthorization
}

// The actual original BlockExecutor, Application.Commit and normal Store.Save
// write this real GoLevelDB. No requested height, RPC response or hand-built
// registry supplies the positive checkpoint.
func newOperatorInspectionFixture(t *testing.T, layout string) *operatorInspectionFixture {
	t.Helper()
	h := newEngineWiringHarness(t)
	if layout != "atomic-json" {
		path := filepath.Join(t.TempDir(), "original-application")
		var app *Application
		var err error
		if layout == "snapshot-journal" {
			app, err = NewJournaledApplicationWithBootstrap(h.f.migration, path, h.f.bootstrap)
		} else {
			app, err = NewBlockJournaledApplicationWithBootstrap(h.f.migration, path, h.f.bootstrap)
		}
		if err != nil {
			t.Fatal(err)
		}
		_ = h.proxy.Stop()
		h.app, h.source.app, h.path = app, app, path
		h.proxy = startEngineTestProxy(t, app)
	}
	initial, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(t.TempDir(), "original-home", "data")
	if err := os.MkdirAll(data, 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := dbm.NewGoLevelDB("state", data)
	if err != nil {
		t.Fatal(err)
	}
	h.raw = sm.NewStore(database, sm.StoreOptions{})
	if err := h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	var registrations cmttypes.Txs
	for i := range h.f.bootstrap.record.Members {
		key, wire := engineRegistration(t, h.f, i, h.f.doc.InitialHeight)
		h.keys = append(h.keys, key)
		payload, err := EncodeValidatorRegistryTransaction(wire)
		if err != nil {
			t.Fatal(err)
		}
		registrations = append(registrations, payload)
	}
	actual := h.apply(t, registrations)
	schedule, err := NewPQEngineSchedule(h.f.bootstrap, h.app.committed.ValidatorRegistry, actual.LastBlockHeight, actual.LastBlockHeight+4)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	pin, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	next, err := NewPQEngineAuthorization(raw, pin)
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	signing := filepath.Join(t.TempDir(), "original-signing-state.json")
	if err := os.WriteFile(signing, []byte("{\"height\":\"0\",\"round\":0,\"step\":0}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{h.path, signing} {
		lease, err := AcquireApplicationStateWriterLease(path)
		if err != nil {
			t.Fatal(err)
		}
		if err := lease.Close(); err != nil {
			t.Fatal(err)
		}
	}
	legacyKey, nodeKey := filepath.Join(filepath.Dir(signing), "original-legacy-key.json"), filepath.Join(filepath.Dir(signing), "original-node-key.json")
	for _, path := range []string{legacyKey, nodeKey} {
		if err := os.WriteFile(path, []byte("isolated backup fixture key bytes; never a production credential\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return &operatorInspectionFixture{h: h, options: OperatorCheckpointOptions{StatePath: h.path, StateLayout: layout, CometDataDirectory: data, SigningStatePath: signing, BackupLegacyKeyPath: legacyKey, BackupNodeKeyPath: nodeKey}, actual: actual, next: next}
}

func (f *operatorInspectionFixture) inspect() (OperatorCheckpointResult, error) {
	return InspectOperatorCheckpoint(f.h.f.migration, f.h.f.raw, f.h.f.pins, f.options)
}

type inspectionInventoryFile struct {
	Mode os.FileMode
	Data []byte
}

func inspectionInventory(t *testing.T, roots ...string) map[string]inspectionInventoryFile {
	t.Helper()
	result := make(map[string]inspectionInventoryFile)
	for _, root := range roots {
		if err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			var raw []byte
			if info.Mode()&os.ModeSymlink != 0 {
				value, err := os.Readlink(path)
				if err != nil {
					return err
				}
				raw = []byte(value)
			} else if info.Mode().IsRegular() {
				raw, err = os.ReadFile(path)
				if err != nil {
					return err
				}
			}
			result[path] = inspectionInventoryFile{info.Mode(), raw}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	return result
}

func TestInspectOperatorCheckpointActualStoppedDBAllLayoutsAndNextSchedule(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := newOperatorInspectionFixture(t, layout)
			roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
			before := inspectionInventory(t, roots...)
			f.options.NextAuthorization = f.next
			result, err := f.inspect()
			if err != nil || result.Version != OperatorCheckpointVersion || result.Height != f.actual.LastBlockHeight || result.AppHash != f.h.app.committed.AppHash || result.AppVersion != ApplicationVersion || result.RegistryRoot != f.h.app.committed.ValidatorRegistry.Root || result.RegistryEventCount != uint64(len(f.h.f.bootstrap.record.Members)) || result.CommittedScheduleHash != nil || result.NextScheduleHash == nil || *result.NextScheduleHash != f.next.hash || !result.EngineCheckpointVerified || !result.WriterExcluded || !result.SigningWriterExcluded || !result.ReadOnly || !result.SourceReadOnly || result.PQActivationVerified || result.BackupCreated {
				t.Fatal("actual stopped checkpoint failed", result, err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
				t.Fatal("read-only checkpoint inspection modified original files, DB, HRS or locks")
			}
			f.options.NextAuthorization = nil
			if result, err := f.inspect(); err != nil || result.NextScheduleHash != nil {
				t.Fatal("normal unscheduled current profile was replaced by its candidate", result, err)
			}
		})
	}
}

func TestInspectOperatorCheckpointRejectsOriginalWriterMissingLocksAndUnknown(t *testing.T) {
	for _, kind := range []string{"app-writer", "signer-writer", "comet-writer", "missing-app-lock", "missing-db-lock", "unknown-app", "pending-current", "symlink-state", "wrong-layout", "wrong-DB-hash", "wrong-DB-version", "corrupt-protobuf", "next-wrong-height"} {
		t.Run(kind, func(t *testing.T) {
			f := newOperatorInspectionFixture(t, "atomic-json")
			var closeWriter func()
			switch kind {
			case "app-writer", "signer-writer":
				path := f.h.path
				if kind == "signer-writer" {
					path = f.options.SigningStatePath
				}
				lease, err := AcquireApplicationStateWriterLease(path)
				if err != nil {
					t.Fatal(err)
				}
				closeWriter = func() { _ = lease.Close() }
			case "comet-writer":
				database, err := dbm.NewGoLevelDB("state", f.options.CometDataDirectory)
				if err != nil {
					t.Fatal(err)
				}
				closeWriter = func() { _ = database.Close() }
			case "missing-app-lock":
				if err := os.Remove(f.h.path + ".writer.lock"); err != nil {
					t.Fatal(err)
				}
			case "missing-db-lock":
				if err := os.Remove(filepath.Join(f.options.CometDataDirectory, "state.db", "LOCK")); err != nil {
					t.Fatal(err)
				}
			case "unknown-app":
				if err := os.WriteFile(f.h.path+".UNKNOWN", []byte("retain-first-cause"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "pending-current":
				if err := os.WriteFile(filepath.Join(f.options.CometDataDirectory, "state.db", "CURRENT.999"), []byte("pending-original-rename\n"), 0o600); err != nil {
					t.Fatal(err)
				}
			case "symlink-state":
				link := filepath.Join(t.TempDir(), "alias")
				if err := os.Symlink(f.h.path, link); err != nil {
					t.Fatal(err)
				}
				f.options.StatePath = link
			case "wrong-layout":
				f.options.StateLayout = "block-journal"
			case "wrong-DB-hash", "wrong-DB-version", "corrupt-protobuf":
				database, err := dbm.NewGoLevelDB("state", f.options.CometDataDirectory)
				if err != nil {
					t.Fatal(err)
				}
				if kind == "corrupt-protobuf" {
					err = database.SetSync([]byte("stateKey"), []byte{0xff, 0xff, 0xff})
				} else {
					actual := f.actual
					if kind == "wrong-DB-hash" {
						actual.AppHash = bytes.Repeat([]byte{2}, 32)
					} else {
						actual.Version.Consensus.App++
					}
					err = sm.NewStore(database, sm.StoreOptions{}).Save(actual)
				}
				if err != nil {
					t.Fatal(err)
				}
				if err := database.Close(); err != nil {
					t.Fatal(err)
				}
			case "next-wrong-height":
				candidate := *f.next.schedule
				candidate.RegistryHeight++
				candidate.AuthorizedAt++
				candidate.ParamsUpdateHeight++
				candidate.ValidatorUpdateHeight++
				candidate.ActivationHeight++
				raw, _ := json.Marshal(candidate)
				pin, _ := candidate.Hash()
				var err error
				f.options.NextAuthorization, err = NewPQEngineAuthorization(raw, pin)
				if err != nil {
					t.Fatal(err)
				}
			}
			if closeWriter != nil {
				defer closeWriter()
			}
			roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
			before := inspectionInventory(t, roots...)
			if result, err := f.inspect(); err == nil {
				t.Fatal("unsafe stopped checkpoint accepted", kind, result)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
				t.Fatal("refused checkpoint changed source, locks, UNKNOWN or database", kind)
			}
		})
	}
}

func TestInspectOperatorCheckpointIndependentPinsDoNotComeFromActualState(t *testing.T) {
	f := newOperatorInspectionFixture(t, "atomic-json")
	before := inspectionInventory(t, filepath.Dir(f.h.path), filepath.Dir(f.options.CometDataDirectory))
	pins := f.h.f.pins
	pins.CometGenesisSHA256 = strings.Repeat("a", 64)
	if _, err := InspectOperatorCheckpoint(f.h.f.migration, f.h.f.raw, pins, f.options); err == nil {
		t.Fatal("actual DB replaced independent genesis pin")
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, filepath.Dir(f.h.path), filepath.Dir(f.options.CometDataDirectory))) {
		t.Fatal("wrong pin changed original source")
	}
}
