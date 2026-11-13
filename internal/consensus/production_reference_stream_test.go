package consensus

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmttypes "github.com/cometbft/cometbft/types"
)

func productionReferencePackageFixture(t *testing.T) (string, string, ProductionCandidatePackageManifest, *cmttypes.GenesisDoc, []byte) {
	t.Helper()
	f := newProductionOperatorFixture(t, false, false)
	for i := range f.plan.Roles {
		r := &f.plan.Roles[i]
		// PUBLIC destination declarations only; generation does not open these.
		r.LegacyKeyPath = "/etc/ynx/test-public/" + r.Role + "/priv_validator_key.json"
		r.NodeKeyPath = "/etc/ynx/test-public/" + r.Role + "/node_key.json"
		r.LegacyStatePath = r.Home + "/data/priv_validator_state.json"
	}
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	doc, err := BuildCometGenesis(f.migration, f.genesisTime)
	if err != nil {
		t.Fatal(err)
	}
	// The existing reference representation is valid even for a small complete
	// source. Use that actual path without creating large histories or PQ keys.
	doc.AppState, err = json.Marshal(newCometMigrationReference(f.migration, canonical))
	if err != nil {
		t.Fatal(err)
	}
	f.plan.ConsensusGenesis, err = cmtjson.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	f.plan.ConsensusGenesisSHA256 = productionOperatorSHA(f.plan.ConsensusGenesis)
	plan, pin := productionOperatorPlanBytes(t, f.plan)
	root := filepath.Join(t.TempDir(), "candidate")
	manifest, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, plan, pin)
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionCandidatePackage(root); err == nil {
		t.Fatal("reference package granted its own operator pin")
	}
	if err := VerifyProductionOperatorCandidatePackage(root, strings.Repeat("0", 64)); err == nil {
		t.Fatal("reference package replaced the independent operator pin")
	}
	return root, pin, manifest, doc, append(canonical, '\n')
}

func TestProductionPackageReferenceCompleteSourceAndStrictBindings(t *testing.T) {
	root, pin, manifest, doc, common := productionReferencePackageFixture(t)
	path := filepath.Join(root, "common", "bound-migration.json")
	raw, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(raw, common) {
		t.Fatal("normal reference package changed complete original M", err)
	}
	originalRef := bytes.Clone(doc.AppState)
	ref, err := decodeCometMigrationReference(originalRef)
	if err != nil {
		t.Fatal(err)
	}
	check := func(t *testing.T, bad []byte) {
		t.Helper()
		if bytes.Equal(bad, originalRef) {
			t.Fatal("counterexample did not change reference")
		}
		changed := *doc
		changed.AppState = bad
		// RawMessage may reject trailing malformed JSON before the package
		// verifier. All cases below are complete JSON values of wrong semantics.
		genesis, err := cmtjson.MarshalIndent(&changed, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "common", "genesis.json"), genesis, 0600); err != nil {
			t.Fatal(err)
		}
		manifest.GenesisHash = productionOperatorSHA(genesis)
		manifest.Files["common/genesis.json"] = manifest.GenesisHash
		if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
			t.Fatal(err)
		}
		err = VerifyProductionOperatorCandidatePackage(root, pin)
		if err == nil || !strings.Contains(err.Error(), "common genesis differs from complete original migration sidecar") {
			t.Fatal("reference was not refused by the complete source validator", err)
		}
		retained, err := os.ReadFile(filepath.Join(root, "common", "genesis.json"))
		if err != nil || !bytes.Equal(retained, genesis) {
			t.Fatal("rejected bytes were modified", err)
		}
	}
	for i := 0; i < reflect.TypeOf(ref).NumField(); i++ {
		field := reflect.TypeOf(ref).Field(i).Name
		t.Run(field, func(t *testing.T) {
			changed := ref
			value := reflect.ValueOf(&changed).Elem().Field(i)
			value.SetString("changed-" + value.String())
			raw, err := json.Marshal(changed)
			if err != nil {
				t.Fatal(err)
			}
			check(t, raw)
		})
	}
	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{"unknown", append([]byte(`{"foreign":0,`), originalRef[1:]...)},
		{"duplicate", append([]byte(`{"version":"YNX-COMET-MIGRATION-REFERENCE/v1",`), originalRef[1:]...)},
		{"folded", bytes.Replace(originalRef, []byte(`"version"`), []byte(`"Version"`), 1)},
		{"numeric-count", bytes.Replace(originalRef, []byte(`"migrationCanonicalBytes":`+strconv.Quote(ref.MigrationCanonicalBytes)), []byte(`"migrationCanonicalBytes":`+ref.MigrationCanonicalBytes), 1)},
		{"missing-field", bytes.Replace(originalRef, []byte(`"migrationStateHash":`+strconv.Quote(ref.MigrationStateHash)+","), nil, 1)},
	} {
		t.Run(tc.name, func(t *testing.T) { check(t, tc.raw) })
	}
}

func TestProductionPackageReferenceRawRoleBytesRemainExact(t *testing.T) {
	root, pin, manifest, _, canonical := productionReferencePackageFixture(t)
	paths := []string{"common/bound-migration.json"}
	for _, role := range manifest.Roles {
		paths = append(paths, "roles/"+role+"/config/bound-migration.json")
	}
	// Preserve the verifier's original raw JSON whitespace acceptance. Every
	// role must match these exact original bytes, not just the canonical digest.
	common := append(append([]byte(" \t\n"), canonical...), '\n')
	for _, relative := range paths {
		if err := os.WriteFile(filepath.Join(root, relative), common, 0600); err != nil {
			t.Fatal(err)
		}
		manifest.Files[relative] = productionOperatorSHA(common)
	}
	if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
		t.Fatal("original raw whitespace acceptance changed", err)
	}
	for _, tc := range []struct {
		name string
		raw  []byte
	}{
		{"canonical-only", canonical},
		{"extra-LF", append(bytes.Clone(common), '\n')},
		{"truncated", common[:len(common)-1]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			relative := paths[1]
			if err := os.WriteFile(filepath.Join(root, relative), tc.raw, 0600); err != nil {
				t.Fatal(err)
			}
			manifest.Files[relative] = productionOperatorSHA(tc.raw)
			if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err := VerifyProductionOperatorCandidatePackage(root, pin); err == nil || !strings.Contains(err.Error(), "migration differs from common migration") {
				t.Fatal("self-rehashed different raw role bytes accepted", err)
			}
		})
	}
}
