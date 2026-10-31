//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

func newPQLabTestPlan(t *testing.T) (PQLabNetworkPlan, string) {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 8, BatchSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: filepath.Join(parent, "lab"), BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(p.RootDir, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	return p, pqLabSHA(raw)
}

func TestPQLabNetworkOriginalInputsExclusiveAndLoopback(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	loaded, m, b, err := loadPQLab(p.RootDir, pin)
	if err != nil || !reflect.DeepEqual(p, loaded) || len(b.record.Members) != 4 || p.NativeChainID == 6423 || !p.SyntheticOnly || p.PublicNetwork || p.CreateEmptyBlocks || p.RegistrationReadyRule != pqLabRegistrationReadyRule {
		t.Fatal("normal independent lab pins failed", err)
	}
	publicChain := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	publicChain.ProduceBlock()
	public, err := publicChain.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if m.OriginalGenesisHash == public.OriginalGenesisHash || m.Network.ChainID == public.Network.ChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") {
		t.Fatal("lab retained a public identity")
	}
	for _, n := range p.Nodes {
		for _, file := range []string{n.LegacyKeyFile, n.LegacyStateFile, n.NodeKeyFile, n.CandidateMaterialFile, n.RecoveryCredentialFile, filepath.Join(n.Home, "config", "config.toml")} {
			info, err := os.Lstat(file)
			if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
				t.Fatal("lab private original permissions", file, err)
			}
		}
		for _, dir := range []string{n.Home, filepath.Join(n.Home, "config"), filepath.Join(n.Home, "data"), filepath.Join(n.Home, "custody")} {
			info, err := os.Lstat(dir)
			if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
				t.Fatal("lab directory permissions", dir, err)
			}
		}
		if n.RecoveryFD != 3 || !strings.Contains(strings.Join(n.BootstrapArgs, " "), "--height-halt-control") || strings.Contains(strings.Join(n.BootstrapArgs, " "), "--pq-engine-schedule") {
			t.Fatal("bootstrap silently pre-authorized PQ")
		}
		config, err := os.ReadFile(filepath.Join(n.Home, "config", "config.toml"))
		if err != nil || !bytes.Contains(config, []byte("create_empty_blocks = false")) || !bytes.Contains(config, []byte(n.P2PAddress)) {
			t.Fatal("normal loopback configuration", err)
		}
	}
	original := inspectionInventory(t, p.RootDir)
	if _, err := GeneratePQLabNetwork(m, PQLabNetworkOptions{RootDir: p.RootDir, BaseP2P: 31656, BaseRPC: 31757}); err == nil {
		t.Fatal("existing lab overwritten")
	}
	if _, _, _, err = loadPQLab(p.RootDir, strings.Repeat("a", 64)); err == nil {
		t.Fatal("wrong external plan pin accepted")
	}
	if _, err = PreparePQLabValidatorRegistration(p.RootDir, pin, 4, p.InitialHeight); err == nil {
		t.Fatal("fifth validator accepted")
	}
	if _, err = PreparePQLabValidatorRegistration(p.RootDir, pin, 0, p.InitialHeight-1); err == nil {
		t.Fatal("registration predates original Comet genesis")
	}
	if !reflect.DeepEqual(original, inspectionInventory(t, p.RootDir)) {
		t.Fatal("preflight refusal changed original material")
	}
	// Even an independently repinned malformed path must not make this lab tool
	// read an outside credential or accept a non-loopback runtime configuration.
	changed := p
	changed.Nodes = append([]PQLabNetworkNode(nil), p.Nodes...)
	changed.Nodes[0].CandidateMaterialFile = filepath.Join(filepath.Dir(p.RootDir), "foreign-private-key")
	raw, _ := json.Marshal(changed)
	if err = os.WriteFile(filepath.Join(p.RootDir, "network-plan.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = loadPQLab(p.RootDir, pqLabSHA(raw)); err == nil {
		t.Fatal("repinned path escaped original lab node")
	}
}

func TestPQLabNetworkActiveEngineDBRefusesCustodyCreation(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	persistPQLabTestCheckpoint(t, p, pin, nil)
	var txs cmttypes.Txs
	for i := 0; i < 4; i++ {
		reg, err := PreparePQLabValidatorRegistration(p.RootDir, pin, i, p.InitialHeight+1)
		if err != nil {
			t.Fatal(err)
		}
		txs = append(txs, reg.Transaction)
	}
	persistPQLabTestCheckpoint(t, p, pin, txs)
	// Hold the real LevelDB writer handle. No Node.Start is involved; the
	// production inspector must observe the same operating-system lock conflict.
	database, err := dbm.NewGoLevelDB("state", filepath.Join(p.Nodes[0].Home, "data"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	stateBefore, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ActivatePQLabNetwork(p.RootDir, pin); err == nil || !strings.Contains(err.Error(), "stopped Comet state database") {
		t.Fatal("active original engine DB became an activation checkpoint", err)
	}
	for _, n := range p.Nodes {
		if _, err = os.Lstat(n.SignerStateFile); !os.IsNotExist(err) {
			t.Fatal("active source caused new HRS creation")
		}
	}
	after, err := os.ReadFile(p.Nodes[0].StatePath)
	if err != nil || !bytes.Equal(stateBefore, after) {
		t.Fatal("active source refusal changed state", err)
	}
	if _, err = os.Stat(filepath.Join(p.RootDir, "activation", "intent.json")); err != nil {
		t.Fatal("active-source UNKNOWN attempt was removed", err)
	}
}

// The same normal Handshaker/BlockExecutor persist real signed blocks into
// four separate stores. This is an OFFLINE source test, not a network/quorum
// claim; no Node is constructed or started and no TCP port is opened here.
func persistPQLabTestCheckpoint(t *testing.T, p PQLabNetworkPlan, pin string, txs cmttypes.Txs) {
	t.Helper()
	_, m, b, err := loadPQLab(p.RootDir, pin)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(p.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(raw)
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{migration: m, bootstrap: b, pins: p.pins(), raw: raw, doc: doc, legacy: map[string]ed25519.PrivateKey{}}
	for _, n := range p.Nodes {
		pv, err := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, p.ChainID)
		if err != nil {
			t.Fatal(err)
		}
		key := pv.Key.PrivKey.(cmted.PrivKey)
		f.legacy[string(n.ValidatorAddress)] = ed25519.PrivateKey(key)
		defer clear(key)
	}
	for _, n := range p.Nodes {
		app, err := NewPersistentApplicationWithBootstrap(m, n.StatePath, b)
		if err != nil {
			t.Fatal(err)
		}
		database, err := dbm.NewGoLevelDB("state", filepath.Join(n.Home, "data"))
		if err != nil {
			t.Fatal(err)
		}
		blocks, err := dbm.NewGoLevelDB("blockstore", filepath.Join(n.Home, "data"))
		if err != nil {
			t.Fatal(err)
		}
		h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(database, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: n.StatePath}
		h.proxy = startEngineTestProxy(t, app)
		state, err := h.raw.Load()
		if err != nil {
			t.Fatal(err)
		}
		if state.IsEmpty() {
			state, err = sm.MakeGenesisState(doc)
			if err != nil {
				t.Fatal(err)
			}
			state.AppHash = nil
			if err = h.raw.Save(state); err != nil {
				t.Fatal(err)
			}
		}
		handshake := cmtconsensus.NewHandshaker(h.raw, state, h.blocks, doc)
		handshake.SetConsensusAuthoritySource(h.source)
		if err = handshake.Handshake(h.proxy); err != nil {
			t.Fatal(err)
		}
		actual := h.apply(t, txs)
		if actual.LastBlockHeight < p.InitialHeight {
			t.Fatal("real executor did not commit")
		}
		if len(txs) > 0 && (app.committed.ValidatorRegistry == nil || len(app.committed.ValidatorRegistry.Events) != 4) {
			t.Fatal("real registry execution did not establish original checkpoint")
		}
		if err = h.proxy.Stop(); err != nil {
			t.Fatal(err)
		}
		if err = database.Close(); err != nil {
			t.Fatal(err)
		}
		if err = blocks.Close(); err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{n.StatePath, n.LegacyStateFile} {
			lease, err := AcquireApplicationStateWriterLease(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = lease.Close(); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestPQLabNetworkRealRegistryStoppedSourcesAndColdCustody(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	persistPQLabTestCheckpoint(t, p, pin, nil)
	var txs cmttypes.Txs
	for i := 0; i < 4; i++ {
		reg, err := PreparePQLabValidatorRegistration(p.RootDir, pin, i, p.InitialHeight+1)
		if err != nil || reg.BroadcastExecuted || !reg.SyntheticOnly || reg.TransactionHash != pqLabSHA(reg.Transaction) {
			t.Fatal("original dual-PoP registration", err)
		}
		txs = append(txs, reg.Transaction)
		before := inspectionInventory(t, p.Nodes[i].Home)
		if _, err = PreparePQLabValidatorRegistration(p.RootDir, pin, i, p.InitialHeight+1); err == nil {
			t.Fatal("unknown registration was re-signed")
		}
		if !reflect.DeepEqual(before, inspectionInventory(t, p.Nodes[i].Home)) {
			t.Fatal("registration retry changed original intent or keys")
		}
	}
	persistPQLabTestCheckpoint(t, p, pin, txs)
	before := inspectionInventory(t, p.Nodes[0].StatePath, filepath.Join(p.Nodes[0].Home, "data", "state.db"))
	activation, err := ActivatePQLabNetwork(p.RootDir, pin)
	if err != nil {
		t.Fatal("actual stopped four-store activation preparation", err)
	}
	if activation.RegistryHeight != p.InitialHeight+1 || activation.ParamsHeight != p.InitialHeight+2 || activation.ValidatorHeight != p.InitialHeight+3 || activation.ActivationHeight != p.InitialHeight+5 || activation.NodeStarted || activation.PQQuorumVerified || len(activation.Nodes) != 4 {
		t.Fatal("schedule or evidence level changed", activation)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, p.Nodes[0].StatePath, filepath.Join(p.Nodes[0].Home, "data", "state.db"))) {
		t.Fatal("preparation mutated original app or engine")
	}
	for i, n := range p.Nodes {
		in, err := LoadPQOperatorInputs(PQOperatorFiles{Migration: p.MigrationFile, Genesis: p.GenesisFile, State: n.StatePath, Schedule: activation.ScheduleFile, ScheduleHash: activation.ScheduleHash, Binding: n.HostBindingFile, Pins: p.pins()})
		if err != nil {
			t.Fatal("normal pinned startup inputs", err)
		}
		app, err := NewPersistentApplicationWithEngineAuthorization(in.Migration, n.StatePath, in.Bootstrap, in.Authorization)
		if err != nil {
			t.Fatal(err)
		}
		registry, err := NewPQCommittedSignerRegistry(app, in.Bootstrap)
		if err != nil {
			t.Fatal(err)
		}
		credential, err := os.ReadFile(n.RecoveryCredentialFile)
		if err != nil {
			t.Fatal(err)
		}
		original, err := os.ReadFile(n.SignerStateFile)
		if err != nil {
			t.Fatal(err)
		}
		host, err := ynxconsensusauth.ResumeHostSigner(n.VaultFile, credential, in.Binding, registry)
		clear(credential)
		if err != nil {
			t.Fatal("normal encrypted original HRS recovery", err)
		}
		if _, err = host.Signer(); err != nil {
			t.Fatal(err)
		}
		if err = host.Close(); err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadFile(n.SignerStateFile)
		if err != nil || !bytes.Equal(original, after) {
			t.Fatal("resume changed original HRS", err)
		}
		args := activation.Nodes[i].Args
		if activation.Nodes[i].RecoveryFD != 3 || !strings.Contains(strings.Join(args, " "), "--pq-recovery-fd 3") || strings.Contains(strings.Join(args, " "), "height-halt-control") {
			t.Fatal("normal PQ arguments retained spent halt session or leaked credential")
		}
	}
	complete := inspectionInventory(t, p.RootDir)
	if _, err = ActivatePQLabNetwork(p.RootDir, pin); err == nil {
		t.Fatal("activation replay could reset original PQ HRS")
	}
	if !reflect.DeepEqual(complete, inspectionInventory(t, p.RootDir)) {
		t.Fatal("reentry changed original custody or checkpoint")
	}
}

func TestPQLabNetworkMissingCheckpointPreservesFailedAttempt(t *testing.T) {
	p, pin := newPQLabTestPlan(t)
	keys := inspectionInventory(t, p.Nodes[0].LegacyKeyFile, p.Nodes[0].CandidateMaterialFile, p.Nodes[0].RecoveryCredentialFile)
	if _, err := ActivatePQLabNetwork(p.RootDir, pin); err == nil {
		t.Fatal("no real engine checkpoint became PQ authority")
	}
	if _, err := os.Stat(filepath.Join(p.RootDir, "activation", "intent.json")); err != nil {
		t.Fatal("failed activation intent removed", err)
	}
	if _, err := ActivatePQLabNetwork(p.RootDir, pin); err == nil {
		t.Fatal("partial activation retried")
	}
	if !reflect.DeepEqual(keys, inspectionInventory(t, p.Nodes[0].LegacyKeyFile, p.Nodes[0].CandidateMaterialFile, p.Nodes[0].RecoveryCredentialFile)) {
		t.Fatal("missing source altered new lab keys")
	}
	if _, err := os.Stat(p.Nodes[0].SignerStateFile); !os.IsNotExist(err) {
		t.Fatal("missing checkpoint manufactured HRS")
	}
	// A full public migration is rejected before root reservation, not rewritten
	// into a lab genesis by swapping a numeric ID or trusting a claimed flag.
	public := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	public.ProduceBlock()
	m, err := public.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(filepath.Dir(p.RootDir), "public-rejected")
	if _, err = GeneratePQLabNetwork(m, PQLabNetworkOptions{RootDir: other, BaseP2P: 31656, BaseRPC: 31757}); err == nil {
		t.Fatal("public source accepted")
	}
	if _, err = os.Stat(other); !os.IsNotExist(err) {
		t.Fatal("public refusal reserved a lab")
	}
}
