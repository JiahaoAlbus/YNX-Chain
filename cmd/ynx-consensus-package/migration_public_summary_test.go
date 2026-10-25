package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"golang.org/x/sys/unix"
)

func migrationSummaryFixture(t *testing.T) (string, []byte, chain.ConsensusMigrationState) {
	t.Helper()
	d := chain.NewDevnet(chain.DefaultNetworkConfig("devnet"))
	for _, account := range []string{"ynx_public_summary_label", "0x" + strings.Repeat("1", 40), "0x" + strings.Repeat("2", 40)} {
		if _, err := d.Faucet(account, 25); err != nil {
			t.Fatal(err)
		}
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	path, raw := writeMigrationFixture(t, migration)
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatal(err)
	}
	return path, raw, migration
}

func TestMigrationPublicSummaryNormalCommandCompleteOriginal(t *testing.T) {
	path, raw, migration := migrationSummaryFixture(t)
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var output, stderr bytes.Buffer
	if err := runCommand([]string{"-verify-migration-state", path, "-migration-public-summary", "json"}, &output, &stderr); err != nil {
		t.Fatal(err)
	}
	if stderr.Len() != 0 || output.Len() > 4096 {
		t.Fatal("summary transport is not bounded public JSON")
	}
	var summary migrationPublicSummary
	if err := json.Unmarshal(output.Bytes(), &summary); err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if summary.Version != migrationPublicSummaryVersion || summary.Classification != "data" || summary.SourceSHA256 != hex.EncodeToString(digest[:]) || summary.SourceBytes != strconv.Itoa(len(raw)) || summary.Height != strconv.FormatUint(migration.Height, 10) || summary.StateHash != migration.StateHash || summary.LastBlockHash != migration.LastBlockHash || summary.FirstCanonicalAccount != "0x"+strings.Repeat("1", 40) {
		t.Fatalf("summary differs from complete actual source: %+v", summary)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(output.Bytes(), &fields); err != nil || len(fields) != 8 {
		t.Fatal("summary changed its closed public fields")
	}
	for name, value := range fields {
		var text string
		if json.Unmarshal(value, &text) != nil {
			t.Fatalf("%s is not a decimal-safe/public string", name)
		}
	}
	canonical, err := json.Marshal(summary)
	if err != nil || !bytes.Equal(output.Bytes(), append(canonical, '\n')) {
		t.Fatal("summary is not one canonical JSON line")
	}
	assertMigrationFileUnchanged(t, path, raw, before)
	output.Reset()
	if err := runCommand([]string{"-verify-migration-state", path}, &output, &stderr); err != nil || !strings.HasPrefix(output.String(), "consensus migration state passed: height=") || strings.Contains(output.String(), migrationPublicSummaryVersion) {
		t.Fatalf("original text CLI changed: %v %s", err, output.String())
	}
}

func TestMigrationPublicSummaryRejectsInvalidCompleteInput(t *testing.T) {
	path, raw, migration := migrationSummaryFixture(t)
	for name, payload := range map[string][]byte{
		"trailing":   append(bytes.Clone(raw), []byte("{}")...),
		"unknown":    append([]byte(`{"foreign":true,`), raw[1:]...),
		"state-hash": bytes.Replace(raw, []byte(migration.StateHash), []byte(strings.Repeat("0", 64)), 1),
	} {
		t.Run(name, func(t *testing.T) {
			if err := os.WriteFile(path, payload, 0600); err != nil {
				t.Fatal(err)
			}
			before, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			var output, stderr bytes.Buffer
			if err := runCommand([]string{"-verify-migration-state", path, "-migration-public-summary", "json"}, &output, &stderr); err == nil || output.Len() != 0 {
				t.Fatalf("invalid full original emitted a summary: %v", err)
			}
			if _, err := verifyMigrationState(path); err == nil {
				t.Fatal("summary rejected something accepted by the original strict verifier")
			}
			assertMigrationFileUnchanged(t, path, payload, before)
		})
	}
}

func TestMigrationPublicSummaryRejectsMixedFlagsBeforeRead(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "must-not-open.json")
	for _, args := range [][]string{
		{"-migration-public-summary", "json"},
		{"-verify-migration-execution", missing, "-migration-public-summary", "json"},
		{"-verify-package", missing, "-migration-public-summary", "json"},
		{"-verify-migration-state", missing, "-migration-public-summary", ""},
		{"-verify-migration-state", missing, "-migration-public-summary", "JSON"},
		{"-verify-migration-state", missing, "-migration-public-summary=json", "--migration-public-summary", "json"},
		{"-verify-migration-state", missing, "-migration-public-summary", "json", "-output", missing},
	} {
		var output, stderr bytes.Buffer
		if err := runCommand(args, &output, &stderr); err == nil || output.Len() != 0 || strings.Contains(err.Error(), "no such file") {
			t.Fatalf("invalid summary mode reached source read: %q %v", args, err)
		}
	}
}

func TestMigrationPublicSummaryOriginalFileBoundsAndIdentity(t *testing.T) {
	path, raw, _ := migrationSummaryFixture(t)
	for name, prepare := range map[string]func(string){
		"symlink": func(target string) {
			if err := os.Symlink(path, target); err != nil {
				t.Fatal(err)
			}
		},
		"hardlink": func(target string) {
			if err := os.Link(path, target); err != nil {
				t.Fatal(err)
			}
		},
		"empty": func(target string) {
			if err := os.WriteFile(target, nil, 0600); err != nil {
				t.Fatal(err)
			}
		},
		"oversize-sparse": func(target string) {
			f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
			if err != nil {
				t.Fatal(err)
			}
			if err := f.Truncate(migrationPublicSummaryMaximum + 1); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(name, func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "source.json")
			prepare(target)
			var output bytes.Buffer
			if err := writeMigrationPublicSummary(target, &output); err == nil || output.Len() != 0 {
				t.Fatalf("%s original boundary accepted: %v", name, err)
			}
			if name == "hardlink" {
				if err := os.Remove(target); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
	if current, err := os.ReadFile(path); err != nil || !bytes.Equal(current, raw) {
		t.Fatal("original source bytes changed")
	}
	var before unix.Stat_t
	if err := unix.Lstat(path, &before); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"atime", "mtime", "ctime", "inode", "size"} {
		after := before
		switch field {
		case "atime", "mtime", "ctime":
			names := map[string][]string{"atime": {"Atim", "Atimespec"}, "mtime": {"Mtim", "Mtimespec"}, "ctime": {"Ctim", "Ctimespec"}}[field]
			changed := false
			for _, name := range names {
				stamp := reflect.ValueOf(&after).Elem().FieldByName(name)
				if !stamp.IsValid() {
					continue
				}
				if stamp.Kind() != reflect.Struct {
					t.Fatalf("malformed %s time field", name)
				}
				nsec := stamp.FieldByName("Nsec")
				if !nsec.IsValid() || !nsec.CanSet() || !nsec.CanInt() {
					t.Fatalf("unavailable nanosecond field %s", name)
				}
				if nsec.Int() < 999_999_999 {
					nsec.SetInt(nsec.Int() + 1)
				} else {
					nsec.SetInt(nsec.Int() - 1)
				}
				changed = true
			}
			if !changed {
				t.Fatalf("missing platform %s field", field)
			}
		case "inode":
			after.Ino++
		case "size":
			after.Size++
		}
		if sameMigrationSummaryInput(before, after) != (field == "atime") {
			t.Fatalf("wrong stable identity policy for %s", field)
		}
	}
}

func TestMigrationPublicSummaryTimeLayoutsFailClosed(t *testing.T) {
	type stamp struct{ Sec, Nsec int64 }
	linux := struct{ Mtim, Ctim stamp }{stamp{71, 123456789}, stamp{72, 987654321}}
	darwin := struct{ Mtimespec, Ctimespec stamp }{linux.Mtim, linux.Ctim}
	for _, names := range [][]string{{"Mtim", "Mtimespec"}, {"Ctim", "Ctimespec"}} {
		left, leftOK := migrationSummaryTime(linux, names...)
		right, rightOK := migrationSummaryTime(darwin, names...)
		if !leftOK || !rightOK || left != right || left[1] == 0 {
			t.Fatal("Linux/Darwin nanosecond identity differs")
		}
		for _, malformed := range []any{
			nil, struct{}{}, struct{ Other stamp }{stamp{71, 1}},
			struct{ Mtim, Mtimespec, Ctim, Ctimespec stamp }{},
			struct{ Mtim, Ctim string }{},
			struct{ Mtim, Ctim stamp }{stamp{71, -1}, stamp{71, -1}},
			struct{ Mtimespec, Ctimespec stamp }{stamp{71, 1_000_000_000}, stamp{71, 1_000_000_000}},
		} {
			if _, ok := migrationSummaryTime(malformed, names...); ok {
				t.Fatalf("missing/malformed/ambiguous time identity accepted: %T", malformed)
			}
		}
	}
}
