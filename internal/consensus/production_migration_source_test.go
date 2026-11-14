package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestProductionMigrationHeldHistoricalJSONParity(t *testing.T) {
	root, _, _, doc, canonical := productionReferencePackageFixture(t)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(canonical, &fields); err != nil {
		t.Fatal(err)
	}
	if len(fields["runtime"]) == 0 {
		t.Fatal("fixture must include real runtime")
	}
	withField := func(name string, value []byte) []byte {
		raw := bytes.TrimSpace(canonical)
		return append(append(bytes.Clone(raw[:len(raw)-1]), []byte(","+name+":")...), append(bytes.Clone(value), '}')...)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, canonical); err != nil {
		t.Fatal(err)
	}
	unknownRuntime := append([]byte(`{"historicalUnknown":true,`), fields["runtime"][1:]...)
	var runtimeFields map[string]json.RawMessage
	if err := json.Unmarshal(fields["runtime"], &runtimeFields); err != nil {
		t.Fatal(err)
	}
	var blocks []json.RawMessage
	if err := json.Unmarshal(runtimeFields["blocks"], &blocks); err != nil || len(blocks) == 0 {
		t.Fatal("fixture requires original block", err)
	}
	blocks[0] = append([]byte(`{"historicalUnknown":true,`), blocks[0][1:]...)
	runtimeFields["blocks"], _ = json.Marshal(blocks)
	unknownBlock, _ := json.Marshal(runtimeFields)
	cases := []struct {
		name string
		raw  []byte
		fast bool
	}{
		{"canonical-LF", canonical, true},
		{"canonical-no-LF", bytes.TrimSuffix(canonical, []byte("\n")), true},
		{"compact", compact.Bytes(), false},
		{"whitespace", append(append([]byte(" \t\n"), canonical...), '\n'), false},
		{"unknown-root", append([]byte(`{"historicalUnknown":true,`), canonical[1:]...), false},
		{"unknown-runtime", withField(`"runtime"`, unknownRuntime), false},
		{"unknown-block", withField(`"runtime"`, unknownBlock), false},
		{"duplicate-height", withField(`"height"`, fields["height"]), false},
		{"folded-height", withField(`"HEIGHT"`, fields["height"]), false},
		{"folded-runtime-merge", withField(`"RUNTIME"`, []byte(`{}`)), false},
		{"escaped-name", bytes.Replace(canonical, []byte(`"height"`), []byte(`"\u0068eight"`), 1), false},
		{"wrong-type-then-correct", append([]byte(`{"height":[],`), canonical[1:]...), false},
		{"wrong-runtime-then-correct", append([]byte(`{"runtime":[],`), canonical[1:]...), false},
		{"runtime-array", withField(`"runtime"`, []byte(`[]`)), false},
		{"runtime-null", withField(`"runtime"`, []byte(`null`)), false},
		{"root-null", []byte(`null`), false},
		{"root-array", []byte(`[]`), false},
		{"trailing-document", append(bytes.Clone(canonical), []byte(`{}`)...), false},
		{"trailing-junk", append(bytes.Clone(canonical), 'x'), false},
		{"truncated", bytes.TrimSpace(canonical)[:len(bytes.TrimSpace(canonical))-1], false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var old chain.ConsensusMigrationState
			oldErr := json.Unmarshal(tc.raw, &old)
			if strings.HasPrefix(tc.name, "unknown-") {
				_, strictErr := chain.ReadConsensusMigrationState(bytes.NewReader(tc.raw))
				if oldErr != nil || strictErr == nil {
					t.Fatal("counterexample must be historically accepted and strict-reader refused", oldErr, strictErr)
				}
			}
			path := filepath.Join(root, "test-input.json")
			if err := os.WriteFile(path, tc.raw, 0600); err != nil {
				t.Fatal(err)
			}
			source, err := readProductionMigrationSource(path, doc.AppState)
			if (err == nil) != (oldErr == nil) {
				t.Fatal("historical decode acceptance changed", err, oldErr)
			}
			if oldErr != nil {
				if source != nil {
					t.Fatal("failed decode returned a held source")
				}
				var oldSyntax, gotSyntax *json.SyntaxError
				if errors.As(oldErr, &oldSyntax) && (!errors.As(err, &gotSyntax) || oldSyntax.Offset != gotSyntax.Offset) {
					t.Fatal("original syntax cause changed")
				}
				var oldType, gotType *json.UnmarshalTypeError
				if errors.As(oldErr, &oldType) && (!errors.As(err, &gotType) || !reflect.DeepEqual(oldType, gotType)) {
					t.Fatal("original type cause changed")
				}
				return
			}
			if !reflect.DeepEqual(source.state, old) {
				t.Fatal("decoded original state changed")
			}
			if (source.raw == nil) != (tc.fast && productionPackageHeldStreaming) {
				t.Fatal("unexpected streaming/fallback selection")
			}
			if source.raw != nil && !bytes.Equal(source.raw, tc.raw) {
				t.Fatal("fallback did not retain original bytes")
			}
			oldValidation := old.ValidateConsensusValidatorKeys()
			newValidation := source.state.ValidateConsensusValidatorKeys()
			if (oldValidation == nil) != (newValidation == nil) {
				t.Fatal("complete validator validation changed")
			}
			_, _, oldBinding := validateBootstrapMigrationAppState(doc.AppState, old)
			_, _, newBinding := validateBootstrapMigrationAppState(doc.AppState, source.state)
			if (oldBinding == nil) != (newBinding == nil) {
				t.Fatal("complete reference binding changed")
			}
			got, err := source.hash()
			if err != nil || got != productionOperatorSHA(tc.raw) {
				t.Fatal("held full input hash changed", err)
			}
			if err := source.close(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestProductionMigrationHeldPackageHistoricalRoles(t *testing.T) {
	root, pin, manifest, _, canonical := productionReferencePackageFixture(t)
	paths := []string{"common/bound-migration.json"}
	for _, role := range manifest.Roles {
		paths = append(paths, "roles/"+role+"/config/bound-migration.json")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(canonical, &fields); err != nil {
		t.Fatal(err)
	}
	raw := bytes.TrimSpace(canonical)
	cases := []struct {
		name string
		raw  []byte
	}{
		{"normal", canonical},
		{"unknown", append([]byte(`{"historicalUnknown":true,`), canonical[1:]...)},
		{"folded-duplicate", append(append(bytes.Clone(raw[:len(raw)-1]), []byte(`,"HEIGHT":`)...), append(bytes.Clone(fields["height"]), '}')...)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			for _, path := range paths {
				if err := os.WriteFile(filepath.Join(root, path), tc.raw, 0600); err != nil {
					t.Fatal(err)
				}
				manifest.Files[path] = productionOperatorSHA(tc.raw)
			}
			if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err := VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
				t.Fatal("historical full package refused", err)
			}
			for _, path := range paths[1:] {
				changed := append(bytes.Clone(tc.raw), '\n')
				if err := os.WriteFile(filepath.Join(root, path), changed, 0600); err != nil {
					t.Fatal(err)
				}
				manifest.Files[path] = productionOperatorSHA(changed)
				if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
					t.Fatal(err)
				}
				if err := VerifyProductionOperatorCandidatePackage(root, pin); err == nil || !strings.Contains(err.Error(), "migration differs from common migration") {
					t.Fatal("self-rehashed role byte mismatch accepted", err)
				}
				if err := os.WriteFile(filepath.Join(root, path), tc.raw, 0600); err != nil {
					t.Fatal(err)
				}
				manifest.Files[path] = productionOperatorSHA(tc.raw)
			}
		})
	}
}

func TestProductionMigrationHeldDescriptorAndCanonicalComparison(t *testing.T) {
	root, _, manifest, doc, raw := productionReferencePackageFixture(t)
	path := filepath.Join(root, "common", "bound-migration.json")
	source, err := readProductionMigrationSource(path, doc.AppState)
	if err != nil {
		t.Fatal(err)
	}
	original := source.file
	before, err := original.Stat()
	if err != nil {
		t.Fatal(err)
	}
	for _, role := range manifest.Roles {
		if err := source.compareRole(filepath.Join(root, "roles", role, "config", "bound-migration.json")); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := source.hash(); err != nil || got != productionOperatorSHA(raw) {
		t.Fatal("held hash differs", err)
	}
	after, err := original.Stat()
	if err != nil || source.file != original || !os.SameFile(before, after) {
		t.Fatal("original descriptor was reopened", err)
	}
	if err := source.close(); err != nil {
		t.Fatal(err)
	}
	if _, err := original.ReadAt(make([]byte, 1), 0); !errors.Is(err, os.ErrClosed) {
		t.Fatal("descriptor debt remained", err)
	}
	// Exercise multi-chunk writes and every suffix without a history-sized
	// allocation in the comparator. This is PUBLIC synthetic byte data only.
	payload := bytes.Repeat([]byte("PUBLIC"), 32<<10)
	for _, suffix := range []string{"", "\n", "\n\n", " ", "x"} {
		comparison := newProductionCanonicalComparison(bytes.NewReader(append(bytes.Clone(payload), suffix...)))
		if n, err := comparison.Write(payload); err != nil || n != len(payload) {
			t.Fatal("complete chunk comparison failed", err)
		}
		err := comparison.finish()
		if (err == nil) != (suffix == "" || suffix == "\n") {
			t.Fatal("canonical suffix was widened")
		}
	}
	comparison := newProductionCanonicalComparison(io.LimitReader(bytes.NewReader(payload), int64(len(payload)-1)))
	if _, err := comparison.Write(payload); err == nil {
		t.Fatal("short original accepted")
	}
}
