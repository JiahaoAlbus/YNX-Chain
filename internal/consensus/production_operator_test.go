package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/privval"
	"github.com/spf13/viper"
)

func TestProductionOperatorConfigNormalTOMLRoundTrip(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	r := f.plan.Roles[0]
	var node ProductionValidatorNode
	for _, n := range f.validators.Validators {
		if n.Role == r.Role {
			node = n
		}
	}
	want := productionOperatorCometConfig(node, f.validators.Validators, r)
	path := filepath.Join(t.TempDir(), "config.toml")
	if err := writeCometConfig(path, want); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	v := viper.New()
	v.SetConfigType("toml")
	if err = v.ReadConfig(bytes.NewReader(raw)); err != nil {
		t.Fatal(err)
	}
	actual := cmtconfig.DefaultConfig()
	if err = v.UnmarshalExact(actual); err != nil {
		t.Fatal(err)
	}
	actual.SetRoot(r.Home)
	if want.StateSync.RPCServers != nil || actual.StateSync.RPCServers == nil || len(actual.StateSync.RPCServers) != 0 {
		t.Fatalf("unexpected real TOML field conversion: template RPCServers=%#v decoded=%#v", want.StateSync.RPCServers, actual.StateSync.RPCServers)
	}
	// This identifies the actual old comparison failure, while retaining a
	// complete comparison of all other fields, including original custody paths.
	want.StateSync.RPCServers = []string{}
	if !reflect.DeepEqual(actual, want) {
		t.Fatalf("normal TOML changed additional public config fields: actual=%#v expected=%#v", actual, want)
	}
	t.Log("normal TOML field difference: StateSync.RPCServers nil -> []string{}; all other fields identical")
	plan, pin := productionOperatorPlanBytes(t, f.plan)
	root := filepath.Join(t.TempDir(), "candidate")
	if _, err = GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, plan, pin); err != nil {
		t.Fatalf("OPERATOR_NORMAL_TOML_ROUNDTRIP_REJECTED: %v", err)
	}
	if err = VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
		t.Fatal(err)
	}
}

func TestProductionOperatorConfigRejectsRehashedTOMLChanges(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	plan, pin := productionOperatorPlanBytes(t, f.plan)
	for _, tc := range []struct {
		name   string
		change func([]byte) []byte
	}{
		{"duplicate", func(raw []byte) []byte { return append([]byte("moniker = \"injected\"\n"), raw...) }},
		{"unknown", func(raw []byte) []byte { return append([]byte("operator_unknown = true\n"), raw...) }},
		{"state-sync-servers", func(raw []byte) []byte {
			return bytes.Replace(raw, []byte(`rpc_servers = ""`), []byte(`rpc_servers = "https://untrusted.invalid:443"`), 1)
		}},
		{"original-sign-state", func(raw []byte) []byte {
			return bytes.ReplaceAll(raw, []byte(f.plan.Roles[0].LegacyStatePath), []byte("/var/lib/other-sign-state.json"))
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "candidate")
			manifest, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, plan, pin)
			if err != nil {
				t.Fatal(err)
			}
			relative := filepath.Join("roles", f.plan.Roles[0].Role, "config", "config.toml")
			path := filepath.Join(root, relative)
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			changed := tc.change(bytes.Clone(raw))
			if bytes.Equal(raw, changed) {
				t.Fatal("test did not change real config")
			}
			if err = os.WriteFile(path, changed, 0600); err != nil {
				t.Fatal(err)
			}
			manifest.Files[relative] = productionOperatorSHA(changed)
			if err = writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			if err = VerifyProductionOperatorCandidatePackage(root, pin); err == nil {
				t.Fatal("self-rehashed TOML change accepted")
			}
			retained, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(retained, changed) {
				t.Fatal("verification modified original rejected input", err)
			}
		})
	}
}

type productionOperatorFixture struct {
	migration   chain.ConsensusMigrationState
	validators  ProductionValidatorManifest
	plan        ProductionOperatorPlan
	keys        map[string][2]string
	genesisTime time.Time
}

// Uses real native source, original Ed25519 host keys, full normal InitChain,
// and (when requested) four actual legacy approval + AND-PQ possession proofs.
// No Node.Start, listener, deployment, secret export or fake verifier is used.
func newProductionOperatorFixture(t *testing.T, runtime, pq bool) productionOperatorFixture {
	t.Helper()
	f := productionOperatorFixture{migration: fourValidatorMigration(t), genesisTime: time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)}
	f.validators, f.keys = productionValidatorFixture(t, f.migration)
	var bindings []chain.ConsensusValidatorKeyBinding
	registry := &validatorRegistryFixture{legacy: make(map[string]ed25519.PrivateKey)}
	for _, n := range f.validators.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: n.ValidatorAddress, KeyType: n.ConsensusKeyType, PublicKey: n.ConsensusPubKey, ConsensusAddress: n.ConsensusAddress})
		raw, err := os.ReadFile(f.keys[n.Role][0])
		if err != nil {
			t.Fatal(err)
		}
		var key privval.FilePVKey
		if err = cmtjson.Unmarshal(raw, &key); err != nil {
			t.Fatal(err)
		}
		registry.legacy[string(key.Address)] = ed25519.PrivateKey(bytes.Clone(key.PrivKey.Bytes()))
	}
	var err error
	f.migration, err = f.migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	registry.migration = f.migration
	registry.doc, err = BuildCometGenesis(f.migration, f.genesisTime)
	if err != nil {
		t.Fatal(err)
	}
	if runtime {
		registry.doc.ConsensusParams.Version.App = 19
	}
	registry.raw, err = cmtjson.Marshal(registry.doc)
	if err != nil {
		t.Fatal(err)
	}
	registry.pins = ConsensusBootstrapPins{productionOperatorSHA(registry.raw), f.migration.OriginalGenesisHash, f.migration.StateHash}
	registry.bootstrap, err = NewConsensusBootstrap(registry.raw, registry.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	f.plan = ProductionOperatorPlan{Version: ProductionOperatorPlanVersion, ChainID: registry.doc.ChainID, ConsensusGenesis: bytes.Clone(registry.raw), ConsensusGenesisSHA256: registry.pins.CometGenesisSHA256, OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash, StateLayout: "atomic-json"}
	f.plan.ValidatorManifestSHA256, err = ProductionValidatorManifestHash(f.validators)
	if err != nil {
		t.Fatal(err)
	}
	app := newPinnedRegistryApp(t, registry, "")
	ctx := context.Background()
	if runtime {
		old := app.committed
		old.Version = 13
		var historical CommittedState
		if err = json.Unmarshal(historicalPerformanceStateJSON(t, old), &historical); err != nil {
			t.Fatal(err)
		}
		historical.bootstrap = registry.bootstrap
		app.committed, app.replayStateVersion = historical, 13
		if _, err = app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: registry.doc.InitialHeight, NextValidatorsHash: bytes.Clone(registry.bootstrap.validatorSetHash)}); err != nil {
			t.Fatal(err)
		}
		if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		boundary := app.committed
		plan := RuntimeUpgradePlan{Format: RuntimeUpgradePlanFormat, ChainID: f.plan.ChainID, NativeChainID: f.migration.Network.ChainID, CometGenesisSHA256: f.plan.ConsensusGenesisSHA256, OriginalGenesisHash: f.plan.OriginalGenesisHash, MigrationStateHash: f.plan.MigrationStateHash, OldStateVersion: 13, OldApplicationVersion: 19, CheckpointHeight: boundary.Height, CheckpointAppHash: boundary.AppHash, UpgradeHeight: boundary.Height + 1, NewStateVersion: 18, NewApplicationVersion: 20}
		f.plan.RuntimePlan, f.plan.RuntimePlanHash = runtimePlanBytes(t, plan)
		authority, err := NewRuntimeUpgradeAuthorization(f.plan.RuntimePlan, f.plan.RuntimePlanHash, registry.bootstrap, f.migration)
		if err != nil {
			t.Fatal(err)
		}
		cursor, err := newRuntimeUpgradeCursor(authority, f.migration, boundary, runtimeTrustedCheckpoint(plan, boundary))
		if err != nil {
			t.Fatal(err)
		}
		app.runtimeUpgradeAuthorization, app.runtimeUpgradeCursor = authority, cursor
		app.replayStateVersion = 0
	}
	var keys []engineTestKey
	if pq {
		h := app.committed.Height + 1
		var txs [][]byte
		for i := range registry.bootstrap.record.Members {
			key, wire := engineRegistration(t, registry, i, h)
			keys = append(keys, key)
			tx, err := EncodeValidatorRegistryTransaction(wire)
			if err != nil {
				t.Fatal(err)
			}
			txs = append(txs, tx)
		}
		result, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, NextValidatorsHash: bytes.Clone(registry.bootstrap.validatorSetHash), Txs: txs})
		if err != nil {
			t.Fatal(err)
		}
		for _, result := range result.TxResults {
			if result.Code != 0 {
				t.Fatal(result.Log)
			}
		}
		if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		schedule, err := NewPQEngineSchedule(registry.bootstrap, app.committed.ValidatorRegistry, h, h+4)
		if err != nil {
			t.Fatal(err)
		}
		f.plan.PQSchedule, err = json.Marshal(schedule)
		if err != nil {
			t.Fatal(err)
		}
		f.plan.PQScheduleHash, err = schedule.Hash()
		if err != nil {
			t.Fatal(err)
		}
	}
	for _, n := range f.validators.Validators {
		home := "/var/lib/ynx-chain/operator-" + n.Role
		r := ProductionOperatorRole{Role: n.Role, Home: home, ABCIState: home + "/data/ynx-abci-state.json", LegacyKeyPath: f.keys[n.Role][0], LegacyStatePath: filepath.Join(filepath.Dir(f.keys[n.Role][0]), "data", "priv_validator_state.json"), NodeKeyPath: f.keys[n.Role][1]}
		if pq {
			var schedule PQEngineSchedule
			if err = json.Unmarshal(f.plan.PQSchedule, &schedule); err != nil {
				t.Fatal(err)
			}
			address, _ := hex.DecodeString(n.ConsensusAddress)
			for _, key := range keys {
				if bytes.Equal(address, key.address) {
					r.HostBinding = &ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(registry.bootstrap.genesisID), ChainID: f.plan.ChainID, ActivationHeight: schedule.ActivationHeight}, ValidatorAddress: bytes.Clone(key.address), Epoch: 1, MLDSA87PublicKey: bytes.Clone(key.pka), SLHDSASHA2256fPublicKey: bytes.Clone(key.pkb), SignerStatePath: "/var/lib/ynx-pq-signer/" + n.Role + "/original-hrs.json"}
				}
			}
			r.RemoteSigner = "tcp://127.0.0.1:28659"
			r.TransportKeyPath = "/etc/ynx/transport/" + n.Role + ".json"
			r.RemoteTimeout = "5s"
			transport := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(len(f.plan.Roles) + 91)}, 32))
			r.SignerPeerPublicKey = hex.EncodeToString(transport.Public().(ed25519.PublicKey))
		}
		f.plan.Roles = append(f.plan.Roles, r)
	}
	return f
}

func productionOperatorPlanBytes(t *testing.T, p ProductionOperatorPlan) ([]byte, string) {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	return raw, productionOperatorSHA(raw)
}

func TestProductionOperatorRealModesPreserveOriginalGenesisAndAuthority(t *testing.T) {
	for _, mode := range []struct {
		name        string
		runtime, pq bool
	}{{"bootstrap", false, false}, {"runtime", true, false}, {"remote", false, true}, {"runtime-remote", true, true}} {
		t.Run(mode.name, func(t *testing.T) {
			f := newProductionOperatorFixture(t, mode.runtime, mode.pq)
			raw, pin := productionOperatorPlanBytes(t, f.plan)
			if mode.pq {
				for _, mutate := range []func(*ProductionOperatorPlan){
					func(p *ProductionOperatorPlan) { p.Roles[0].HostBinding = nil },
					func(p *ProductionOperatorPlan) { p.Roles[0].SignerPeerPublicKey = "abcd" },
					func(p *ProductionOperatorPlan) { p.Roles[0].HostBinding.Policy.ActivationHeight++ },
					func(p *ProductionOperatorPlan) {
						p.Roles[0].HostBinding.ValidatorAddress = bytes.Clone(p.Roles[1].HostBinding.ValidatorAddress)
					},
				} {
					var wrong ProductionOperatorPlan
					if err := json.Unmarshal(raw, &wrong); err != nil {
						t.Fatal(err)
					}
					mutate(&wrong)
					bad, badPin := productionOperatorPlanBytes(t, wrong)
					if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, filepath.Join(t.TempDir(), "rejected"), f.genesisTime, bad, badPin); err == nil {
						t.Fatal("invalid original remote binding was accepted")
					}
				}
			}
			root := filepath.Join(t.TempDir(), "candidate")
			manifest, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin)
			if err != nil {
				t.Fatal(err)
			}
			if manifest.OperatorProfile != ProductionOperatorPlanVersion || manifest.OperatorPlanHash != pin {
				t.Fatal("operator identity lost")
			}
			if err = VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
				t.Fatal(err)
			}
			if err = VerifyProductionCandidatePackage(root); err == nil {
				t.Fatal("operator package verified using its own hash")
			}
			genesis, err := os.ReadFile(filepath.Join(root, "common", "genesis.json"))
			if err != nil || !bytes.Equal(genesis, f.plan.ConsensusGenesis) {
				t.Fatal("operator replaced original genesis", err)
			}
			for _, role := range f.plan.Roles {
				path := filepath.Join(root, "roles", role.Role)
				launch, err := os.ReadFile(filepath.Join(path, "scripts", "start-operator.sh"))
				if err != nil {
					t.Fatal(err)
				}
				for _, want := range []string{"/bin/ynx-comet' 'start'", role.Home, role.ABCIState, "--abci-state-layout", f.plan.ConsensusGenesisSHA256, f.plan.OriginalGenesisHash, f.plan.MigrationStateHash} {
					if !bytes.Contains(launch, []byte(want)) {
						t.Fatalf("normal launcher lost %q", want)
					}
				}
				if bytes.Contains(launch, []byte("--runtime-upgrade-plan'")) != mode.runtime || bytes.Contains(launch, []byte("--pq-remote-signer'")) != mode.pq || bytes.Contains(launch, []byte("--pq-host-key-vault")) {
					t.Fatal("wrong operator authorization mode")
				}
				units, err := os.ReadDir(filepath.Join(path, "systemd"))
				if err != nil || len(units) != 1 || units[0].Name() != "ynx-consensus-operator-candidate.service" {
					t.Fatal("operator has multiple writers", err)
				}
				if mode.pq {
					binding := f.plan.role(role.Role).HostBinding
					original, _ := json.Marshal(binding)
					emitted, err := os.ReadFile(filepath.Join(path, "config", "pq-host-binding.json"))
					if err != nil || !bytes.Equal(original, emitted) {
						t.Fatal("original custody binding was changed", err)
					}
					install, err := os.ReadFile(filepath.Join(path, "scripts", "install-candidate.sh"))
					if err != nil {
						t.Fatal(err)
					}
					if !bytes.Contains(install, []byte("-node-only")) || !bytes.Contains(launch, []byte("-node-only")) || bytes.Contains(install, []byte("-private-validator-key")) || bytes.Contains(launch, []byte("-private-validator-key")) || bytes.Contains(launch, []byte("test -s '"+role.LegacyStatePath+"'")) {
						t.Fatal("remote operator requires copying remote legacy custody")
					}
				}
			}
		})
	}
}

func TestProductionOperatorNodeOnlyChecksRealOriginalNetworkIdentity(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	raw, pin := productionOperatorPlanBytes(t, f.plan)
	root := filepath.Join(t.TempDir(), "candidate")
	if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin); err != nil {
		t.Fatal(err)
	}
	role := f.plan.Roles[0]
	manifest := filepath.Join(root, "roles", role.Role, "role-manifest.json")
	if err := VerifyProductionNodeKeyFile(manifest, role.NodeKeyPath); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionNodeKeyFile(manifest, f.plan.Roles[1].NodeKeyPath); err == nil {
		t.Fatal("another real original NodeKey was accepted for this role")
	}
	link := filepath.Join(t.TempDir(), "node.json")
	if err := os.Symlink(role.NodeKeyPath, link); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionNodeKeyFile(manifest, link); err == nil {
		t.Fatal("symlink node key accepted")
	}
	if err := os.Chmod(role.NodeKeyPath, 0644); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionNodeKeyFile(manifest, role.NodeKeyPath); err == nil {
		t.Fatal("publicly readable node key accepted")
	}
	if err := os.Chmod(role.NodeKeyPath, 0600); err != nil {
		t.Fatal(err)
	}
}

func TestProductionOperatorRejectsUnpinnedMixedAndRehashedDowngrades(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	raw, pin := productionOperatorPlanBytes(t, f.plan)
	for _, bad := range []string{"", strings.Repeat("0", 64), strings.Repeat("a", 64)} {
		out := filepath.Join(t.TempDir(), "candidate")
		if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, out, f.genesisTime, raw, bad); err == nil {
			t.Fatal("accepted absent/wrong authority")
		}
		if _, err := os.Lstat(out); !os.IsNotExist(err) {
			t.Fatal("invalid plan created output")
		}
	}
	for _, change := range []func(*ProductionOperatorPlan){
		func(p *ProductionOperatorPlan) { p.Roles[0].RemoteSigner = "tcp://127.0.0.1:28659" },
		func(p *ProductionOperatorPlan) { p.StateLayout = "fallback" },
		func(p *ProductionOperatorPlan) { p.OriginalGenesisHash = strings.Repeat("a", 64) },
		func(p *ProductionOperatorPlan) { p.Roles[0].ABCIState = p.Roles[0].LegacyStatePath },
		func(p *ProductionOperatorPlan) { p.Roles[0].Home = ProductionCandidateRoot },
		func(p *ProductionOperatorPlan) { p.Roles[0].Home = "/var/lib/injected%h" },
		func(p *ProductionOperatorPlan) { p.RuntimePlanHash = strings.Repeat("a", 64) },
	} {
		p := f.plan
		p.Roles = append([]ProductionOperatorRole(nil), p.Roles...)
		change(&p)
		raw, pin := productionOperatorPlanBytes(t, p)
		if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, filepath.Join(t.TempDir(), "candidate"), f.genesisTime, raw, pin); err == nil {
			t.Fatal("self-consistent pin bypassed original identity")
		}
	}
	for _, malformed := range [][]byte{append(bytes.Clone(raw), '\n'), []byte(strings.Replace(string(raw), `"version":`, `"unknown":null,"version":`, 1)), []byte(strings.Replace(string(raw), `"version":`, `"version":"YNX-PRODUCTION-OPERATOR/v1","version":`, 1))} {
		if _, err := DecodeProductionOperatorPlan(malformed, productionOperatorSHA(malformed)); err == nil {
			t.Fatal("noncanonical plan accepted")
		}
	}
	for _, target := range []string{"scripts/start-operator.sh", "systemd/ynx-consensus-operator-candidate.service", "config/config.toml"} {
		root := filepath.Join(t.TempDir(), "candidate")
		manifest, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin)
		if err != nil {
			t.Fatal(err)
		}
		relative := filepath.Join("roles", f.plan.Roles[0].Role, target)
		path := filepath.Join(root, relative)
		original, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		changed := bytes.ReplaceAll(original, []byte(f.plan.Roles[0].ABCIState), []byte("/var/lib/other-state.json"))
		if target == "config/config.toml" {
			changed = bytes.ReplaceAll(original, []byte(f.plan.Roles[0].LegacyStatePath), []byte("/var/lib/reset-hrs.json"))
		}
		if bytes.Equal(changed, original) {
			changed = append(original, []byte("\nExecStart=/bin/false\n")...)
		}
		if err = os.WriteFile(path, changed, 0600); err != nil {
			t.Fatal(err)
		}
		manifest.Files[relative] = productionOperatorSHA(changed)
		if err = writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0600); err != nil {
			t.Fatal(err)
		}
		if err = VerifyProductionOperatorCandidatePackage(root, pin); err == nil {
			t.Fatal("rehashed operator downgrade accepted", target)
		}
	}
}
