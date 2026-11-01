package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Retain the exact failed normal command's previous Compact/strict Decode/
// Marshal acceptance oracle. This is only used for small public test inputs.
func oldInitializationMigrationOracle(raw []byte) (chain.ConsensusMigrationState, error) {
	var compact bytes.Buffer
	var migration chain.ConsensusMigrationState
	if err := json.Compact(&compact, raw); err != nil {
		return migration, err
	}
	err := decodeStrict(compact.Bytes(), &migration)
	return migration, err
}

func TestInitializeApplicationStreamRetainsOriginalStrictJSONAcceptance(t *testing.T) {
	f := newInitializeCommandFixture(t)
	wire := f.originals[f.options.migration]
	var compact bytes.Buffer
	if err := json.Compact(&compact, wire); err != nil {
		t.Fatal(err)
	}
	raw := compact.Bytes()
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatal(err)
	}
	reordered, err := json.Marshal(object)
	if err != nil || bytes.Equal(reordered, raw) {
		t.Fatal("fixture needs a different valid root field order", err)
	}
	var runtime map[string]json.RawMessage
	if err := json.Unmarshal(object["runtime"], &runtime); err != nil || len(runtime) == 0 {
		t.Fatal("fixture must contain the original source runtime", err)
	}
	var duplicateRuntime []byte
	for key, value := range runtime {
		name, _ := json.Marshal(key)
		prefix := append(append(append([]byte(`"runtime":{`), name...), ':'), value...)
		prefix = append(prefix, ',')
		duplicateRuntime = bytes.Replace(raw, []byte(`"runtime":{`), prefix, 1)
		break
	}
	if bytes.Equal(duplicateRuntime, raw) {
		t.Fatal("runtime duplicate counterexample did not change input")
	}
	source, _ := json.Marshal(f.migration.SourceFormat)
	if len(f.migration.SourceFormat) == 0 {
		t.Fatal("source format is empty")
	}
	// The source fixture starts with ASCII 'y'; the old strict contract rejects
	// an equivalent Unicode escape rather than silently changing signed bytes.
	if f.migration.SourceFormat[0] != 'y' {
		t.Fatal("fixture source format must start with y")
	}
	escaped := []byte(`"\u0079` + f.migration.SourceFormat[1:] + `"`)
	cases := []struct {
		name string
		wire []byte
		pass bool
	}{
		{"original-pretty", wire, true},
		{"original-compact", raw, true},
		{"outer-whitespace", append(append([]byte(" \n\t"), wire...), '\r', '\n'), true},
		{"field-whitespace", bytes.Replace(raw, []byte(`"version":`), []byte("\"version\" \t : \n"), 1), true},
		{"duplicate-root", append([]byte(`{"version":2,`), raw[1:]...), false},
		{"duplicate-runtime", duplicateRuntime, false},
		{"folded-root", bytes.Replace(raw, []byte(`"version"`), []byte(`"Version"`), 1), false},
		{"unknown-root", append([]byte(`{"foreign":0,`), raw[1:]...), false},
		{"foreign-field-order", reordered, false},
		{"noncanonical-string-escape", bytes.Replace(raw, source, escaped, 1), false},
		{"noncanonical-number", bytes.Replace(raw, []byte(`"version":2`), []byte(`"version":2.0`), 1), false},
		{"missing-required-field", bytes.Replace(raw, []byte(`"version":2,`), nil, 1), false},
		{"trailing-document", append(append([]byte(nil), raw...), '{', '}'), false},
		{"truncated", raw[:len(raw)-1], false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			want, oldErr := oldInitializationMigrationOracle(test.wire)
			if (oldErr == nil) != test.pass {
				t.Fatal("counterexample did not reproduce the original strict contract", oldErr)
			}
			path := filepath.Join(t.TempDir(), "migration.json")
			if err := os.WriteFile(path, test.wire, 0o600); err != nil {
				t.Fatal(err)
			}
			got, err := readInitializationMigration(path, 1<<30, nil)
			if (err == nil) != test.pass {
				t.Fatal("stream reader changed original acceptance", err)
			}
			if test.pass && !reflect.DeepEqual(want, got) {
				t.Fatal("stream reader changed any original decoded state")
			}
		})
	}
}

func TestInitializeApplicationStreamKeepsSameFDAndOriginalBounds(t *testing.T) {
	f := newInitializeCommandFixture(t)
	wire := f.originals[f.options.migration]
	for _, kind := range []string{"replacement", "same-fd-size-change", "symlink", "size-bound"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "migration.json")
			if err := os.WriteFile(path, wire, 0o600); err != nil {
				t.Fatal(err)
			}
			maximum := int64(1 << 30)
			hooks := &initializationMigrationReadHooks{}
			switch kind {
			case "replacement":
				hooks.afterDecode = func() error {
					other := filepath.Join(dir, "replacement.json")
					if err := os.WriteFile(other, wire, 0o600); err != nil {
						return err
					}
					return os.Rename(other, path)
				}
			case "same-fd-size-change":
				hooks.afterDecode = func() error {
					return os.WriteFile(path, append(append([]byte(nil), wire...), '\n'), 0o600)
				}
			case "symlink":
				link := filepath.Join(dir, "alias.json")
				if err := os.Symlink(path, link); err != nil {
					t.Fatal(err)
				}
				path = link
			case "size-bound":
				maximum = int64(len(wire) - 1)
			}
			if _, err := readInitializationMigration(path, maximum, hooks); err == nil {
				t.Fatal("changed, aliased or oversized original input was accepted")
			}
			if _, err := os.Stat(filepath.Join(dir, "application")); !os.IsNotExist(err) {
				t.Fatal("failed migration read created an application destination", err)
			}
		})
	}
}

func TestInitializeApplicationStreamWhitespaceAndEscapesAcrossChunks(t *testing.T) {
	value := map[string]any{"a": "spaces stay inside \"quotes\" \\ backslashes \t\n <>&\u2028 😀", "b": []any{true, nil, 42}}
	canonical, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	pretty, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	compare := initializationCanonicalComparator{input: bufio.NewReaderSize(bytes.NewReader(pretty), 16)}
	for _, b := range canonical {
		if _, err := compare.Write([]byte{b}); err != nil {
			t.Fatal("string/escape state was lost at chunk boundary", err)
		}
	}
	if err := compare.finish(); err != nil {
		t.Fatal(err)
	}
	bad := bytes.Replace(pretty, []byte("spaces stay"), []byte("spaces  stay"), 1)
	compare = initializationCanonicalComparator{input: bufio.NewReader(bytes.NewReader(bad))}
	if _, err := compare.Write(canonical); err == nil {
		t.Fatal("whitespace inside a JSON string was ignored")
	}
}

func TestInitializeApplicationStreamLongWhitespacePreservesCompleteState(t *testing.T) {
	f := newInitializeCommandFixture(t)
	wire := f.originals[f.options.migration]
	want, err := oldInitializationMigrationOracle(wire)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "migration.json")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = io.Copy(file, io.LimitReader(zeroInitializationSpaces{}, 2<<20)); err == nil {
		_, err = file.Write(wire)
	}
	err = errors.Join(err, file.Close())
	if err != nil {
		t.Fatal(err)
	}
	got, err := readInitializationMigration(path, 1<<30, nil)
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatal("large original whitespace span changed decoded source", err)
	}
}

type zeroInitializationSpaces struct{}

func (zeroInitializationSpaces) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = ' '
	}
	return len(p), nil
}
