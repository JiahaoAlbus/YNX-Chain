//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"golang.org/x/sys/unix"
)

func operatorMigrationStreamFixture(t *testing.T) (chain.ConsensusMigrationState, []byte) {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet("ynx_stream_source_owner", 100); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Transfer("ynx_stream_source_owner", "ynx_stream_source_recipient", 7); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime == nil || len(m.Runtime.Blocks) == 0 || len(m.Accounts) < 2 {
		t.Fatal("fixture lacks complete original accounts and history")
	}
	// Compare readers against the previous reader's decoded representation,
	// rather than the producer's in-memory nil/empty bookkeeping. The exact
	// complete canonical bytes must also survive that original round trip.
	var previous chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &previous); err != nil {
		t.Fatal(err)
	}
	previousRaw, err := previous.CanonicalJSON()
	if err != nil || !bytes.Equal(previousRaw, raw) {
		t.Fatal("original reader changed complete fixture bytes", err)
	}
	return previous, raw
}

func TestPQOperatorMigrationStreamNormalFilesKeepCompleteSourceAndPermissions(t *testing.T) {
	want, raw := operatorMigrationStreamFixture(t)
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []os.FileMode{0o600, 0o644} {
		for _, wire := range [][]byte{raw, compact.Bytes(), append(append([]byte(" \n\t"), raw...), '\n')} {
			path := filepath.Join(t.TempDir(), "migration.json")
			if err := os.WriteFile(path, wire, mode); err != nil {
				t.Fatal(err)
			}
			before, _ := os.Stat(path)
			got, err := readPQOperatorMigration(path, 1<<30, nil)
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatal("stream changed original complete source", err)
			}
			after, _ := os.Stat(path)
			unchanged, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(unchanged, wire) || !os.SameFile(before, after) || after.Mode() != before.Mode() {
				t.Fatal("public operator migration reader changed source identity/permission/bytes", err)
			}
		}
	}
	// Unlike the initializer, the existing operator API also accepts relative
	// paths. Preserve that IO contract without a new arbitrary-path CLI option.
	path := filepath.Join(t.TempDir(), "relative-source.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	relative, err := filepath.Rel(cwd, path)
	if err != nil {
		t.Fatal(err)
	}
	if got, err := readPQOperatorMigration(relative, 1<<30, nil); err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal("original relative operator path no longer works", err)
	}
}

func TestPQOperatorMigrationStreamActualLoaderRejectsCanonicalAndHistoryCounterexamples(t *testing.T) {
	want, raw := operatorMigrationStreamFixture(t)
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		t.Fatal(err)
	}
	wire := compact.Bytes()
	var tampered chain.ConsensusMigrationState
	if err := json.Unmarshal(wire, &tampered); err != nil {
		t.Fatal(err)
	}
	tampered.Runtime.Blocks[0].Hash = strings.Repeat("0", 64)
	history, err := json.Marshal(tampered)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{"duplicate-root", append([]byte(`{"version":2,`), wire[1:]...)},
		{"folded-root", bytes.Replace(wire, []byte(`"version"`), []byte(`"Version"`), 1)},
		{"unknown-root", append([]byte(`{"foreign":0,`), wire[1:]...)},
		{"noncanonical-escape", bytes.Replace(wire, []byte(`"ynx`), []byte(`"\u0079nx`), 1)},
		{"trailing-document", append(append([]byte(nil), wire...), '{', '}')},
		{"truncated", wire[:len(wire)-1]},
		{"modified-complete-history", history},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if bytes.Equal(tc.raw, wire) {
				t.Fatal("counterexample did not change original bytes")
			}
			if tc.name == "duplicate-root" || tc.name == "folded-root" {
				var previous chain.ConsensusMigrationState
				if err := json.Unmarshal(tc.raw, &previous); err != nil || !reflect.DeepEqual(previous, want) {
					t.Fatal("counterexample did not reproduce old remote Unmarshal acceptance", err)
				}
			}
			path := filepath.Join(t.TempDir(), "migration.json")
			if err := os.WriteFile(path, tc.raw, 0o600); err != nil {
				t.Fatal(err)
			}
			// Both the real remote Node constructor and signer serve call this
			// exact loader. Later files deliberately do not exist: the malformed
			// migration must be rejected before any later state/custody access.
			in, err := LoadPQOperatorInputs(PQOperatorFiles{Migration: path, State: path + ".absent-state", Genesis: path + ".absent-genesis"})
			if err == nil || in != nil || !(strings.Contains(err.Error(), "canonical") || strings.Contains(err.Error(), "decode complete migration JSON")) {
				t.Fatal("normal operator loader did not reject the complete migration first", err)
			}
			got, readErr := os.ReadFile(path)
			if readErr != nil || !bytes.Equal(got, tc.raw) {
				t.Fatal("rejected input was rewritten", readErr)
			}
			if _, statErr := os.Stat(path + ".absent-state"); !os.IsNotExist(statErr) {
				t.Fatal("rejection created application state", statErr)
			}
		})
	}
}

func TestPQOperatorMigrationStreamSameFDNamespaceAndBounds(t *testing.T) {
	_, raw := operatorMigrationStreamFixture(t)
	for _, kind := range []string{"replacement", "same-fd-size-change", "mode-change", "link-count-change", "symlink", "size-bound", "empty", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "migration.json")
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			hooks := &pqOperatorMigrationReadHooks{}
			maximum := int64(1 << 30)
			switch kind {
			case "replacement":
				hooks.afterDecode = func() error {
					other := filepath.Join(dir, "replacement")
					if err := os.WriteFile(other, raw, 0o600); err != nil {
						return err
					}
					return os.Rename(other, path)
				}
			case "same-fd-size-change":
				hooks.afterDecode = func() error { return os.WriteFile(path, append(append([]byte(nil), raw...), '\n'), 0o600) }
			case "mode-change":
				hooks.afterDecode = func() error { return os.Chmod(path, 0o644) }
			case "link-count-change":
				hooks.afterDecode = func() error { return os.Link(path, filepath.Join(dir, "alias")) }
			case "symlink":
				link := filepath.Join(dir, "symlink")
				if err := os.Symlink(path, link); err != nil {
					t.Fatal(err)
				}
				path = link
			case "size-bound":
				maximum = int64(len(raw) - 1)
			case "empty":
				if err := os.WriteFile(path, nil, 0o600); err != nil {
					t.Fatal(err)
				}
			case "fifo":
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if err := unix.Mkfifo(path, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := readPQOperatorMigration(path, maximum, hooks); err == nil {
				t.Fatal("changed/aliased/unbounded source accepted")
			}
		})
	}
}

func TestPQOperatorMigrationStreamLeadingWhitespaceHasNoWholeDocumentBuffer(t *testing.T) {
	want, raw := operatorMigrationStreamFixture(t)
	path := filepath.Join(t.TempDir(), "large-original.json")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(f, io.LimitReader(strings.NewReader(strings.Repeat(" \t\r\n", 1<<19)), 2<<20)); err == nil {
		_, err = f.Write(raw)
	}
	if closeErr := f.Close(); err != nil || closeErr != nil {
		t.Fatal(err, closeErr)
	}
	runtime.GC()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	got, err := readPQOperatorMigration(path, 1<<30, nil)
	runtime.ReadMemStats(&after)
	runtime.KeepAlive(got)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal("leading whitespace changed complete original state", err)
	}
	allocated := after.TotalAlloc - before.TotalAlloc
	t.Logf("public 2MiB whitespace fixture remote-reader allocated=%d", allocated)
	if allocated >= 2<<20 {
		t.Fatal("remote decoder retained the complete whitespace prefix", allocated)
	}
	for _, bad := range [][]byte{append([]byte(" \t\f"), raw...),
		bytes.Replace(raw, []byte(`"version": 2`), []byte(`"version": 2 0`), 1)} {
		if bytes.Equal(bad, raw) {
			t.Fatal("malformed JSON fixture was not changed")
		}
		if err := os.WriteFile(path, bad, 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := readPQOperatorMigration(path, 1<<30, nil); err == nil {
			t.Fatal("leading-space fix altered a non-JSON whitespace byte or interior token separator")
		}
	}
}
