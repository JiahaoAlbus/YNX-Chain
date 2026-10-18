package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cometed25519 "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/p2p"
	"golang.org/x/sys/unix"
)

func operatorFixtureHash(raw []byte) string {
	hash := sha256.Sum256(raw)
	return hex.EncodeToString(hash[:])
}

type operatorCLIFixture struct {
	root          string
	migrationPath string
	manifestPath  string
	genesisTime   string
	plan          consensus.ProductionOperatorPlan
}

func newOperatorCLIFixture(t *testing.T) operatorCLIFixture {
	t.Helper()
	roles := []string{"primary", "singapore", "silicon-valley", "seoul"}
	addresses := []string{"ynx_validator_primary", "ynx_validator_singapore", "ynx_validator_silicon_valley", "ynx_validator_seoul"}
	validators := make([]chain.Validator, 0, len(roles))
	for i, role := range roles {
		validators = append(validators, chain.Validator{Address: addresses[i], Moniker: "synthetic-" + role, VotingPower: 1, Active: true})
	}
	d := chain.NewDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), validators)
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	manifest := consensus.ProductionValidatorManifest{Version: consensus.ProductionValidatorManifestVersion, Purpose: consensus.ProductionValidatorManifestPurpose, ChainID: fmt.Sprintf("ynx_%d-1", migration.Network.ChainID)}
	for i, role := range roles {
		// In-memory test-only identities; only the public records enter a package.
		key := cometed25519.GenPrivKeyFromSecret([]byte("synthetic operator CLI consensus " + role))
		node := p2p.NodeKey{PrivKey: cometed25519.GenPrivKeyFromSecret([]byte("synthetic operator CLI transport " + role))}
		manifest.Validators = append(manifest.Validators, consensus.ProductionValidatorNode{
			ValidatorAddress: addresses[i], Role: role, PrivateP2PHost: fmt.Sprintf("10.42.0.%d", i+1), P2PPort: 27656,
			NodeID: string(node.ID()), ConsensusKeyType: chain.ConsensusPubKeyTypeEd25519,
			ConsensusPubKey: base64.StdEncoding.EncodeToString(key.PubKey().Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(key.PubKey().Address())),
		})
	}
	root := t.TempDir()
	migrationRaw, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	manifestRaw, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifestHash, err := consensus.ProductionValidatorManifestHash(manifest)
	if err != nil {
		t.Fatal(err)
	}
	f := operatorCLIFixture{root: root, migrationPath: filepath.Join(root, "migration.json"), manifestPath: filepath.Join(root, "validators.json"), genesisTime: "2026-08-01T00:00:00Z"}
	for path, raw := range map[string][]byte{f.migrationPath: migrationRaw, f.manifestPath: manifestRaw} {
		if err := os.WriteFile(path, raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// The public source is produced by the original real generator. This test
	// does not replace production genesis/authority with a hand-written object.
	legacyRoot := filepath.Join(root, "original-legacy-package")
	legacy, err := consensus.GenerateProductionCandidatePackage(migration, manifest, legacyRoot, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	rawGenesis, err := os.ReadFile(filepath.Join(legacyRoot, "common", "genesis.json"))
	if err != nil {
		t.Fatal(err)
	}
	f.plan = consensus.ProductionOperatorPlan{
		Version: "YNX-PRODUCTION-OPERATOR/v1", ChainID: manifest.ChainID,
		ConsensusGenesis: rawGenesis, ConsensusGenesisSHA256: legacy.GenesisHash,
		OriginalGenesisHash: migration.OriginalGenesisHash, MigrationStateHash: legacy.MigrationStateHash,
		ValidatorManifestSHA256: manifestHash,
		StateLayout:             "atomic-json",
	}
	for _, role := range roles {
		home := "/var/lib/ynx-chain/operator-" + role
		keys := "/etc/ynx/consensus-candidate/" + role
		f.plan.Roles = append(f.plan.Roles, consensus.ProductionOperatorRole{
			Role: role, Home: home, ABCIState: home + "/data/ynx-abci-state.json",
			LegacyKeyPath: keys + "/priv_validator_key.json", LegacyStatePath: home + "/data/priv_validator_state.json", NodeKeyPath: keys + "/node_key.json",
		})
	}
	return f
}

func (f operatorCLIFixture) generationArgs(output, plan, pin string) []string {
	args := []string{"-migration-state", f.migrationPath, "-validator-manifest", f.manifestPath, "-genesis-time", f.genesisTime, "-output", output}
	if plan != "" || pin != "" {
		args = append(args, "-operator-plan", plan, "-operator-plan-hash", pin)
	}
	return args
}

func writeOperatorCLIPlan(t *testing.T, plan consensus.ProductionOperatorPlan) (string, []byte, string) {
	t.Helper()
	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "operator.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return path, raw, operatorFixtureHash(raw)
}

func TestConsensusPackageOperatorRealGenerationAndIndependentVerification(t *testing.T) {
	f := newOperatorCLIFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			plan := f.plan
			plan.StateLayout = layout
			path, original, pin := writeOperatorCLIPlan(t, plan)
			output := filepath.Join(t.TempDir(), "operator-package")
			var out, diagnostic bytes.Buffer
			if err := runCommand(f.generationArgs(output, path, pin), &out, &diagnostic); err != nil {
				t.Fatal(err)
			}
			for _, marker := range []string{"mode=single-app-operator", "source=independently-pinned-public-operator-plan", "operatorPlanHash=" + pin, "runtimeStarted=false", "deployment=not-performed", "pqActivation=not-performed"} {
				if !strings.Contains(out.String(), marker) {
					t.Fatalf("operator generation lost its actual scope: %q", out.String())
				}
			}
			if err := consensus.VerifyProductionOperatorCandidatePackage(output, pin); err != nil {
				t.Fatal(err)
			}
			generatedGenesis, err := os.ReadFile(filepath.Join(output, "common", "genesis.json"))
			if err != nil || !bytes.Equal(generatedGenesis, plan.ConsensusGenesis) {
				t.Fatalf("operator package replaced its original genesis: %v", err)
			}
			for _, role := range plan.Roles {
				services := filepath.Join(output, "roles", role.Role, "systemd")
				entries, err := os.ReadDir(services)
				if err != nil {
					t.Fatal(err)
				}
				starts := 0
				for _, entry := range entries {
					raw, err := os.ReadFile(filepath.Join(services, entry.Name()))
					if err != nil {
						t.Fatal(err)
					}
					text := string(raw)
					starts += strings.Count(text, "ExecStart=")
					if entry.Name() == "ynx-consensus-abci-candidate.service" || entry.Name() == "ynx-consensus-comet-candidate.service" || strings.Contains(text, "/bin/ynx-abci ") || strings.Contains(text, "Requires=ynx-consensus-abci") || strings.Contains(text, "Requires=ynx-consensus-comet") {
						t.Fatal("operator package introduced a separate ABCI writer")
					}
					if strings.Contains(text, "ExecStart=") && (!strings.Contains(text, "ExecStart="+consensus.ProductionCandidateRoot+"/scripts/start-operator.sh") || !strings.Contains(text, "Conflicts=ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service")) {
						t.Fatal("single Application service lost its launcher or competing-writer exclusion")
					}
				}
				if starts != 1 {
					t.Fatalf("operator role has %d application service starts", starts)
				}
				launcher, err := os.ReadFile(filepath.Join(output, "roles", role.Role, "scripts", "start-operator.sh"))
				if err != nil {
					t.Fatal(err)
				}
				for _, required := range []string{"exec '" + consensus.ProductionCandidateRoot + "/bin/ynx-comet'", "'--home' '" + role.Home + "'", "'--abci-state' '" + role.ABCIState + "'", "'--abci-state-layout' '" + layout + "'", "'--consensus-genesis-sha256' '" + plan.ConsensusGenesisSHA256 + "'", "'--original-genesis-hash' '" + plan.OriginalGenesisHash + "'", "'--bound-migration-state-hash' '" + plan.MigrationStateHash + "'"} {
					if !strings.Contains(string(launcher), required) {
						t.Fatalf("single Application launcher lost exact argument %s", required)
					}
				}
			}
			out.Reset()
			if err := runCommand([]string{"-verify-package", output, "-operator-plan-hash", pin}, &out, &diagnostic); err != nil || !strings.Contains(out.String(), "mode=single-app-operator") {
				t.Fatalf("normal pinned verify failed: %v %q", err, out.String())
			}
			for _, args := range [][]string{{"-verify-package", output}, {"-verify-package", output, "-operator-plan-hash", strings.Repeat("a", 64)}} {
				out.Reset()
				if err := runCommand(args, &out, &diagnostic); err == nil || out.Len() != 0 {
					t.Fatalf("operator package self-authorized verification: %v %q", err, out.String())
				}
			}
			actual, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(actual, original) {
				t.Fatal("operator generation or verify rewrote its independent plan")
			}
		})
	}
}

func TestConsensusPackageOperatorRejectsPinnedMalformedOrMismatchedPlans(t *testing.T) {
	f := newOperatorCLIFixture(t)
	_, valid, _ := writeOperatorCLIPlan(t, f.plan)
	mutate := func(edit func(*consensus.ProductionOperatorPlan)) []byte {
		plan := f.plan
		plan.Roles = append([]consensus.ProductionOperatorRole(nil), plan.Roles...)
		edit(&plan)
		raw, err := json.Marshal(plan)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	cases := map[string][]byte{
		"unknown-field":            append(append([]byte(nil), valid[:len(valid)-1]...), []byte(`,"unapprovedAuthority":true}`)...),
		"duplicate-field":          append([]byte(`{"version":"YNX-PRODUCTION-OPERATOR/v1",`), valid[1:]...),
		"trailing-object":          append(append([]byte(nil), valid...), []byte(`{}`)...),
		"noncanonical":             append(append([]byte(nil), valid...), '\n'),
		"unknown-version":          mutate(func(p *consensus.ProductionOperatorPlan) { p.Version = "YNX-PRODUCTION-OPERATOR/v999" }),
		"other-chain":              mutate(func(p *consensus.ProductionOperatorPlan) { p.ChainID = "ynx_999-1" }),
		"other-genesis-pin":        mutate(func(p *consensus.ProductionOperatorPlan) { p.ConsensusGenesisSHA256 = strings.Repeat("a", 64) }),
		"other-native-pin":         mutate(func(p *consensus.ProductionOperatorPlan) { p.OriginalGenesisHash = strings.Repeat("b", 64) }),
		"other-migration":          mutate(func(p *consensus.ProductionOperatorPlan) { p.MigrationStateHash = strings.Repeat("c", 64) }),
		"other-validator-manifest": mutate(func(p *consensus.ProductionOperatorPlan) { p.ValidatorManifestSHA256 = strings.Repeat("d", 64) }),
		"unknown-layout":           mutate(func(p *consensus.ProductionOperatorPlan) { p.StateLayout = "unapproved-layout" }),
		"partial-remote":           mutate(func(p *consensus.ProductionOperatorPlan) { p.Roles[0].RemoteSigner = "tcp://127.0.0.1:12345" }),
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			path, output := filepath.Join(root, "operator.json"), filepath.Join(root, "candidate")
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			var out, diagnostic bytes.Buffer
			if err := runCommand(f.generationArgs(output, path, operatorFixtureHash(raw)), &out, &diagnostic); err == nil || out.Len() != 0 {
				t.Fatalf("pinned but invalid operator plan was accepted: %v %q", err, out.String())
			}
			if _, err := os.Lstat(output); !os.IsNotExist(err) {
				t.Fatalf("invalid operator plan reserved or changed output: %v", err)
			}
			original, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(original, raw) {
				t.Fatal("invalid original plan was repaired or overwritten")
			}
		})
	}
}

func TestConsensusPackageOperatorBindsPublicTopologyIndependentOfArrayOrder(t *testing.T) {
	f := newOperatorCLIFixture(t)
	planPath, _, pin := writeOperatorCLIPlan(t, f.plan)
	raw, err := os.ReadFile(f.manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var original consensus.ProductionValidatorManifest
	if err := json.Unmarshal(raw, &original); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"reordered", "peer-drift", "node-id-drift"} {
		t.Run(kind, func(t *testing.T) {
			manifest := original
			manifest.Validators = append([]consensus.ProductionValidatorNode(nil), original.Validators...)
			switch kind {
			case "reordered":
				for left, right := 0, len(manifest.Validators)-1; left < right; left, right = left+1, right-1 {
					manifest.Validators[left], manifest.Validators[right] = manifest.Validators[right], manifest.Validators[left]
				}
			case "peer-drift":
				manifest.Validators[0].PrivateP2PHost = "10.42.1.99"
			case "node-id-drift":
				manifest.Validators[0].NodeID = strings.Repeat("e", 40)
			}
			raw, err := json.Marshal(manifest)
			if err != nil {
				t.Fatal(err)
			}
			root := t.TempDir()
			path, output := filepath.Join(root, "validators.json"), filepath.Join(root, "candidate")
			if err := os.WriteFile(path, raw, 0o600); err != nil {
				t.Fatal(err)
			}
			args := f.generationArgs(output, planPath, pin)
			args[3] = path
			var out, diagnostic bytes.Buffer
			err = runCommand(args, &out, &diagnostic)
			if kind == "reordered" {
				if err != nil {
					t.Fatalf("canonical public topology depends on array order: %v", err)
				}
				if err := consensus.VerifyProductionOperatorCandidatePackage(output, pin); err != nil {
					t.Fatal(err)
				}
			} else {
				if err == nil || out.Len() != 0 {
					t.Fatalf("unapproved original peer topology changed under the same plan: %v", err)
				}
				if _, err := os.Lstat(output); !os.IsNotExist(err) {
					t.Fatal("unapproved peer topology wrote a package")
				}
			}
		})
	}
}

func TestConsensusPackageOperatorPreservesExistingUnknownOutputAndLegacyMode(t *testing.T) {
	f := newOperatorCLIFixture(t)
	path, _, pin := writeOperatorCLIPlan(t, f.plan)
	output := filepath.Join(t.TempDir(), "original-UNKNOWN-package")
	if err := os.Mkdir(output, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(output, "UNKNOWN.json")
	original := []byte(`{"outcome":"UNKNOWN","preserve":true}`)
	if err := os.WriteFile(marker, original, 0o600); err != nil {
		t.Fatal(err)
	}
	var out, diagnostic bytes.Buffer
	if err := runCommand(f.generationArgs(output, path, pin), &out, &diagnostic); err == nil || out.Len() != 0 {
		t.Fatalf("existing operator output was reused: %v %q", err, out.String())
	}
	actual, err := os.ReadFile(marker)
	if err != nil || !bytes.Equal(actual, original) {
		t.Fatalf("operator output UNKNOWN was lost: %v", err)
	}
	entries, err := os.ReadDir(output)
	if err != nil || len(entries) != 1 || entries[0].Name() != "UNKNOWN.json" {
		t.Fatalf("operator output UNKNOWN was modified: %v", err)
	}
	legacyOutput := filepath.Join(t.TempDir(), "legacy-package")
	out.Reset()
	if err := runCommand(f.generationArgs(legacyOutput, "", ""), &out, &diagnostic); err != nil || !strings.Contains(out.String(), "mode=legacy-external-abci") || strings.Contains(out.String(), "mode=single-app-operator") {
		t.Fatalf("original generation entry lost its explicit legacy mode: %v %q", err, out.String())
	}
	out.Reset()
	if err := runCommand([]string{"-verify-package", legacyOutput}, &out, &diagnostic); err != nil || !strings.Contains(out.String(), "mode=legacy-external-abci") {
		t.Fatalf("original legacy package verification changed: %v %q", err, out.String())
	}
	out.Reset()
	if err := runCommand([]string{"-verify-package", legacyOutput, "-operator-plan-hash", pin}, &out, &diagnostic); err == nil || out.Len() != 0 {
		t.Fatalf("legacy package acquired operator approval: %v %q", err, out.String())
	}
}

func TestConsensusPackageOperatorPlanReadOnlyBoundedPins(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "operator.json")
	raw := []byte(`{"public":"operator-plan-reader-control"}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	read, err := readPinnedOperatorPlan(path, operatorFixtureHash(raw), 128)
	if err != nil || !bytes.Equal(read, raw) {
		t.Fatalf("exact pinned read failed: %v", err)
	}
	for _, pin := range []string{"", strings.Repeat("0", 64), strings.Repeat("a", 63), strings.Repeat("A", 64), strings.Repeat("b", 64)} {
		if _, err := readPinnedOperatorPlan(path, pin, 128); err == nil {
			t.Fatal("unbound or mismatched operator pin accepted")
		}
	}
	for _, bound := range []int64{0, int64(len(raw) - 1)} {
		if _, err := readPinnedOperatorPlan(path, operatorFixtureHash(raw), bound); err == nil {
			t.Fatal("operator reader exceeded its bound")
		}
	}
	link := filepath.Join(root, "alias.json")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	fifo := filepath.Join(root, "operator.fifo")
	if err := unix.Mkfifo(fifo, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{root, link, fifo, filepath.Join(root, "missing.json")} {
		if _, err := readPinnedOperatorPlan(invalid, operatorFixtureHash(raw), 128); err == nil {
			t.Fatal("operator reader accepted a non-original regular file")
		}
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, raw) || !os.SameFile(before, after) || before.Size() != after.Size() || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) {
		t.Fatalf("operator reader changed its original: %v", err)
	}
}

func TestConsensusPackageOperatorFlagsRejectPartialDuplicateAndVerificationMix(t *testing.T) {
	for _, args := range [][]string{
		{"-operator-plan", "plan.json"},
		{"-operator-plan-hash", strings.Repeat("a", 64)},
		{"-operator-plan", "", "-operator-plan-hash", strings.Repeat("a", 64)},
		{"-operator-plan", "plan.json", "-operator-plan-hash", ""},
		{"-operator-plan", "first.json", "--operator-plan=second.json", "-operator-plan-hash", strings.Repeat("a", 64)},
		{"-operator-plan", "plan.json", "-operator-plan-hash", strings.Repeat("a", 64), "-operator-plan-hash=" + strings.Repeat("b", 64)},
		{"-migration-state", "first.json", "-migration-state", "second.json"},
		{"-verify-package", "first", "-verify-package", "second"},
		{"-operator-plan", "plan.json", "-operator-plan-hash", strings.Repeat("a", 64), "-unknown", "value"},
		{"-operator-plan", "plan.json", "-operator-plan-hash", strings.Repeat("a", 64), "unexpected"},
	} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			output := filepath.Join(t.TempDir(), "must-not-exist")
			var out, diagnostics bytes.Buffer
			err := runCommand(append(append([]string(nil), args...), "-output", output), &out, &diagnostics)
			if err == nil || out.Len() != 0 {
				t.Fatalf("invalid operator flags accepted: %v %q", err, out.String())
			}
			if _, err := os.Lstat(output); !os.IsNotExist(err) {
				t.Fatalf("invalid operator flags wrote a candidate: %v", err)
			}
		})
	}
	for _, mode := range []string{"-verify-package", "-verify-migration-state", "-verify-migration-execution"} {
		var out, diagnostics bytes.Buffer
		err := runCommand([]string{mode, "original", "-operator-plan", "plan.json", "-operator-plan-hash", strings.Repeat("a", 64)}, &out, &diagnostics)
		if err == nil || !strings.Contains(err.Error(), "cannot be combined") || out.Len() != 0 {
			t.Fatalf("%s accepted an operator generation plan: %v %q", mode, err, out.String())
		}
	}
	for _, args := range [][]string{
		{"-verify-package", "original", "-operator-plan-hash", ""},
		{"-verify-migration-state", "original", "-operator-plan-hash", strings.Repeat("a", 64)},
		{"-verify-migration-execution", "original", "-operator-plan-hash", strings.Repeat("a", 64)},
		{"-verify-package", "original", "-operator-plan-hash", strings.Repeat("a", 64), "-operator-plan-hash", strings.Repeat("b", 64)},
	} {
		var out, diagnostics bytes.Buffer
		if err := runCommand(args, &out, &diagnostics); err == nil || out.Len() != 0 {
			t.Fatalf("verification accepted an incomplete or misplaced operator pin: %v %q", err, out.String())
		}
	}
}

type operatorPublicFixturePin struct {
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type operatorPublicFixtureLayout struct {
	StateLayout      string   `json:"stateLayout"`
	OperatorPlan     string   `json:"operatorPlan"`
	OperatorPlanHash string   `json:"operatorPlanHash"`
	GenerationArgs   []string `json:"generationArgs"`
	OperatorArgs     []string `json:"operatorArgs"`
}

type operatorPublicFixtureManifest struct {
	Version                string                              `json:"version"`
	SourceKind             string                              `json:"sourceKind"`
	SyntheticOnly          bool                                `json:"syntheticOnly"`
	PublicOnly             bool                                `json:"publicOnly"`
	RuntimeStarted         bool                                `json:"runtimeStarted"`
	PublicDeployment       bool                                `json:"publicDeployment"`
	PQActivation           bool                                `json:"pqActivation"`
	AuthorityGranted       bool                                `json:"authorityGranted"`
	TrustBoundary          string                              `json:"trustBoundary"`
	Migration              string                              `json:"migration"`
	ValidatorManifest      string                              `json:"validatorManifest"`
	ConsensusGenesis       string                              `json:"consensusGenesis"`
	ConsensusGenesisSHA256 string                              `json:"consensusGenesisSHA256"`
	OriginalGenesisHash    string                              `json:"originalGenesisHash"`
	MigrationStateHash     string                              `json:"migrationStateHash"`
	ValidatorManifestHash  string                              `json:"validatorManifestHash"`
	GenesisTime            string                              `json:"genesisTime"`
	Files                  map[string]operatorPublicFixturePin `json:"files"`
	Layouts                []operatorPublicFixtureLayout       `json:"layouts"`
}

// Only this closed public allowlist is exportable. The final manifest is
// written last, after every input has been exclusively created and synced.
// Any write/Sync/Close failure retains the reserved directory and partial bytes.
func exportOperatorPublicFixture(destination string, files map[string][]byte, manifest []byte) error {
	allowed := map[string]bool{"migration.json": true, "validator-manifest.json": true, "genesis.json": true, "operator-atomic-json.json": true, "operator-snapshot-journal.json": true, "operator-block-journal.json": true}
	if len(files) != len(allowed) || len(manifest) == 0 || len(manifest) > 1<<20 {
		return fmt.Errorf("invalid public fixture file set or manifest bound")
	}
	var total int
	for name, raw := range files {
		if !allowed[name] || len(raw) == 0 || len(raw) > 16<<20 {
			return fmt.Errorf("unexpected public fixture file or size")
		}
		total += len(raw)
	}
	if total > 32<<20 {
		return fmt.Errorf("public fixture exceeds aggregate bound")
	}
	if !filepath.IsAbs(destination) || filepath.Clean(destination) != destination || destination == string(filepath.Separator) {
		return fmt.Errorf("public fixture destination must be a fresh canonical absolute directory")
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(destination))
	if err != nil || parent != filepath.Dir(destination) {
		return fmt.Errorf("public fixture parent must exist without symlink traversal")
	}
	if err := os.Mkdir(destination, 0o700); err != nil {
		return fmt.Errorf("public fixture destination exists or cannot be reserved; preserve the original: %w", err)
	}
	write := func(name string, raw []byte) error {
		file, err := os.OpenFile(filepath.Join(destination, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return err
		}
		n, err := file.Write(raw)
		if err == nil && n != len(raw) {
			err = io.ErrShortWrite
		}
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err != nil {
			return err
		}
		return closeErr
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if err := write(name, files[name]); err != nil {
			return fmt.Errorf("retain incomplete public fixture: %w", err)
		}
	}
	if err := write("manifest.json", manifest); err != nil {
		return fmt.Errorf("retain incomplete public fixture manifest: %w", err)
	}
	directory, err := os.Open(destination)
	if err != nil {
		return err
	}
	err = directory.Sync()
	closeErr := directory.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func TestConsensusPackageOperatorPublicFixtureExport(t *testing.T) {
	destination := os.Getenv("YNX_CONSENSUS_OPERATOR_FIXTURE_OUT")
	if destination == "" {
		t.Log("public fixture export not requested; real generation is covered by TestConsensusPackageOperatorRealGenerationAndIndependentVerification")
		return
	}
	f := newOperatorCLIFixture(t)
	migration, err := os.ReadFile(f.migrationPath)
	if err != nil {
		t.Fatal(err)
	}
	validators, err := os.ReadFile(f.manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{"migration.json": migration, "validator-manifest.json": validators, "genesis.json": bytes.Clone(f.plan.ConsensusGenesis)}
	manifest := operatorPublicFixtureManifest{
		Version: "YNX-CONSENSUS-OPERATOR-PUBLIC-FIXTURE/v1", SourceKind: "production-generator-backed-synthetic-test-inputs",
		SyntheticOnly: true, PublicOnly: true,
		TrustBoundary: "CI selects expected pins for these synthetic fixtures; no production Root, operator approval, deployment, activation or finality is granted",
		Migration:     "migration.json", ValidatorManifest: "validator-manifest.json", ConsensusGenesis: "genesis.json",
		ConsensusGenesisSHA256: f.plan.ConsensusGenesisSHA256, OriginalGenesisHash: f.plan.OriginalGenesisHash,
		MigrationStateHash: f.plan.MigrationStateHash, ValidatorManifestHash: f.plan.ValidatorManifestSHA256, GenesisTime: f.genesisTime,
		Files: make(map[string]operatorPublicFixturePin),
	}
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		plan := f.plan
		plan.StateLayout = layout
		path, raw, pin := writeOperatorCLIPlan(t, plan)
		output := filepath.Join(t.TempDir(), "candidate")
		var out, diagnostic bytes.Buffer
		if err := runCommand(f.generationArgs(output, path, pin), &out, &diagnostic); err != nil {
			t.Fatal(err)
		}
		if err := consensus.VerifyProductionOperatorCandidatePackage(output, pin); err != nil {
			t.Fatal(err)
		}
		for _, verifyArgs := range [][]string{{"-verify-package", output}, {"-verify-package", output, "-operator-plan-hash", strings.Repeat("a", 64)}} {
			out.Reset()
			if err := runCommand(verifyArgs, &out, &diagnostic); err == nil || out.Len() != 0 {
				t.Fatalf("public fixture verification accepted absent or wrong independent pin: %v", err)
			}
		}
		name := "operator-" + layout + ".json"
		files[name] = raw
		manifest.Layouts = append(manifest.Layouts, operatorPublicFixtureLayout{
			StateLayout: layout, OperatorPlan: name, OperatorPlanHash: pin,
			GenerationArgs: []string{"-migration-state", "migration.json", "-validator-manifest", "validator-manifest.json", "-genesis-time", f.genesisTime, "-output", "candidate-" + layout},
			OperatorArgs:   []string{"-operator-plan", name, "-operator-plan-hash", pin},
		})
	}
	for name, raw := range files {
		manifest.Files[name] = operatorPublicFixturePin{Bytes: len(raw), SHA256: operatorFixtureHash(raw)}
		// No generated private material, host temporary paths, HRS or vault body
		// can be exported. Public plan custody PATHS remain part of its schema.
		for _, forbidden := range []string{f.root, `"priv_key"`, `"privateKey"`, `"seed"`, `"credential"`, `"ciphertext"`, `"mnemonic"`} {
			if bytes.Contains(raw, []byte(forbidden)) {
				t.Fatalf("public input %s contains excluded fixture material", name)
			}
		}
	}
	rawManifest, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := exportOperatorPublicFixture(destination, files, rawManifest); err != nil {
		t.Fatal(err)
	}
	t.Logf("YNX_CONSENSUS_OPERATOR_PUBLIC_FIXTURE_OK layouts=3 manifestSHA256=%s syntheticOnly=true runtimeStarted=false", operatorFixtureHash(rawManifest))
}

func TestConsensusPackageOperatorPublicFixtureExclusivePreservation(t *testing.T) {
	files := make(map[string][]byte)
	for _, name := range []string{"migration.json", "validator-manifest.json", "genesis.json", "operator-atomic-json.json", "operator-snapshot-journal.json", "operator-block-journal.json"} {
		files[name] = []byte(`{"public":"tiny-writer-control"}`)
	}
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(parent, "public")
	manifest := []byte(`{"syntheticOnly":true,"writerControlOnly":true}`)
	if err := exportOperatorPublicFixture(destination, files, manifest); err != nil {
		t.Fatal(err)
	}
	if err := exportOperatorPublicFixture(destination, files, manifest); err == nil {
		t.Fatal("public fixture overwrote an existing result")
	}
	actual, err := os.ReadFile(filepath.Join(destination, "manifest.json"))
	if err != nil || !bytes.Equal(actual, manifest) {
		t.Fatal("public fixture lost its original result")
	}
	unknown := filepath.Join(parent, "unknown")
	if err := os.Mkdir(unknown, 0o700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(unknown, "UNKNOWN")
	if err := os.WriteFile(marker, []byte("original"), 0o600); err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(parent, "alias")
	if err := os.Symlink(unknown, alias); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{unknown, alias, filepath.Join(alias, "child")} {
		if err := exportOperatorPublicFixture(path, files, manifest); err == nil {
			t.Fatal("public fixture accepted existing/aliased output")
		}
	}
	actual, err = os.ReadFile(marker)
	if err != nil || string(actual) != "original" {
		t.Fatal("public fixture modified an existing UNKNOWN")
	}
	files["private-key.json"] = []byte(`{}`)
	invalid := filepath.Join(parent, "invalid")
	if err := exportOperatorPublicFixture(invalid, files, manifest); err == nil {
		t.Fatal("public fixture exported outside the closed public allowlist")
	}
	if _, err := os.Lstat(invalid); !os.IsNotExist(err) {
		t.Fatal("invalid public fixture reserved output")
	}
}
