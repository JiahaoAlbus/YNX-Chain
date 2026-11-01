//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	dbm "github.com/cometbft/cometbft-db"
	cfg "github.com/cometbft/cometbft/config"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
	"github.com/spf13/viper"
)

func TestPQLabDistributedConfigOriginalTemplateRoundTrip(t *testing.T) {
	root := pqLabWorkloadTemp(t)
	n := PQLabNetworkNode{Home: root, Index: 0, RPCAddress: "http://127.0.0.1:31757", P2PAddress: "tcp://127.0.0.1:31656"}
	expected := pqDistributedConfig(PQLabDistributedPlan{}, n)
	path := filepath.Join(root, "config.toml")
	if err := writeCometConfig(path, expected); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = pqDistributedConfigEqual(raw, expected); err != nil {
		v := viper.New()
		v.SetConfigType("toml")
		_ = v.ReadConfig(bytes.NewReader(raw))
		actual := cfg.DefaultConfig()
		_ = v.UnmarshalExact(actual)
		actual.SetRoot(root)
		var diff func(reflect.Value, reflect.Value, string)
		diff = func(a, b reflect.Value, path string) {
			if reflect.DeepEqual(a.Interface(), b.Interface()) {
				return
			}
			switch a.Kind() {
			case reflect.Pointer:
				diff(a.Elem(), b.Elem(), path)
			case reflect.Struct:
				for i := 0; i < a.NumField(); i++ {
					diff(a.Field(i), b.Field(i), path+"."+a.Type().Field(i).Name)
				}
			default:
				t.Logf("original template difference %s: expected=%#v actual=%#v", path, a.Interface(), b.Interface())
			}
		}
		diff(reflect.ValueOf(expected), reflect.ValueOf(actual), "Config")
		t.Fatal(err)
	}
}

type pqLabDistributedFixture struct {
	plan       PQLabDistributedPlan
	planRaw    []byte
	planSHA    string
	locals     []*PQLabDistributedLocal
	requestRaw []byte
	requestPin string
	corpusRoot string
	corpus     PQLabWorkloadManifest
}

// Four independent directories on this test host are NOT four physical hosts.
// Test-only signing reads synthetic keys to exercise the real BlockExecutor.
func newPQLabDistributedTestFixture(t *testing.T) *pqLabDistributedFixture {
	t.Helper()
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Transfers: 2, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	parent := pqLabWorkloadTemp(t)
	runtime := filepath.Join(parent, "public-runtime-pin-input")
	runtimeRaw := []byte("synthetic digest input only; never executed as a binary")
	if err = os.WriteFile(runtime, runtimeRaw, 0600); err != nil {
		t.Fatal(err)
	}
	hostname, err := os.Hostname()
	if err != nil {
		t.Fatal(err)
	}
	r := PQLabDistributedRequest{OperationID: pqLabSHA([]byte(parent)), SourceCommit: "ebd19f47559d5e97082e5c61fff106fb4aee6f7f", SourceTree: "bdafb9c790b825eb277be358535b51983912beed", CometBinarySHA256: pqLabSHA(runtimeRaw), LabBinarySHA256: pqLabSHA(runtimeRaw), GenesisTime: time.Now().UTC().Add(-time.Minute).Truncate(time.Second).Format(time.RFC3339)}
	for i := 0; i < 4; i++ {
		r.Hosts = append(r.Hosts, PQLabDistributedHost{Index: i, HostID: []string{"primary", "singapore", "silicon-valley", "seoul"}[i], Hostname: hostname, UID: uint32(os.Geteuid()), GID: uint32(os.Getegid()), RootDir: filepath.Join(parent, []string{"host-a", "host-b", "host-c", "host-d"}[i]), CometBinary: runtime, LabBinary: runtime, P2PPort: 31656 + i, RPCPort: 31757 + i})
	}
	r, err = NewPQLabDistributedRequest(source.Migration, r)
	if err != nil {
		t.Fatal(err)
	}
	requestRaw, _ := json.Marshal(r)
	requestPin := pqLabSHA(requestRaw)
	var identities [][]byte
	var pins []string
	for i := 0; i < 4; i++ {
		id, e := GeneratePQLabDistributedIdentity(requestRaw, requestPin, i)
		if e != nil {
			t.Fatal("host-local identity", e)
		}
		raw, _ := json.Marshal(id)
		identities = append(identities, raw)
		pins = append(pins, pqLabSHA(raw))
	}
	p, err := BuildPQLabDistributedPlan(source.Migration, requestRaw, requestPin, identities, pins)
	if err != nil {
		t.Fatal("public coordinator", err)
	}
	raw, _ := json.Marshal(p)
	pin := pqLabSHA(raw)
	f := &pqLabDistributedFixture{plan: p, planRaw: raw, planSHA: pin, requestRaw: requestRaw, requestPin: requestPin}
	for i := 0; i < 4; i++ {
		if _, err = ImportPQLabDistributedPlan(raw, pin, i); err != nil {
			t.Fatal("normal host import", err)
		}
		local, e := LoadPQLabDistributedLocal(r.Hosts[i].RootDir, pin)
		if e != nil {
			t.Fatal("normal cold public source", e)
		}
		f.locals = append(f.locals, local)
	}
	f.corpusRoot = filepath.Join(parent, "public-workload")
	f.corpus, err = source.WriteCorpus(f.corpusRoot, f.locals[0].migration)
	if err != nil {
		t.Fatal("normal original AND workload", err)
	}
	return f
}

func persistPQLabDistributedTestCheckpoint(t *testing.T, f *pqLabDistributedFixture, txs cmttypes.Txs) {
	t.Helper()
	doc, err := cmttypes.GenesisDocFromJSON(f.plan.GenesisRaw)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &validatorRegistryFixture{migration: f.locals[0].migration, bootstrap: f.locals[0].bootstrap, pins: f.plan.Pins, raw: f.plan.GenesisRaw, doc: doc, legacy: map[string]ed25519.PrivateKey{}}
	for _, local := range f.locals {
		pv, e := LoadPQOriginalLegacyValidator(local.node.LegacyKeyFile, local.node.LegacyStateFile, f.plan.ChainID)
		if e != nil {
			t.Fatal(e)
		}
		key := pv.Key.PrivKey.(cmted.PrivKey)
		fixture.legacy[string(local.node.ValidatorAddress)] = ed25519.PrivateKey(key)
		defer clear(key)
	}
	for _, local := range f.locals {
		n := local.node
		app, e := NewPersistentApplicationWithBootstrap(local.migration, n.StatePath, local.bootstrap)
		if e != nil {
			t.Fatal(e)
		}
		database, e := dbm.NewGoLevelDB("state", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		blocks, e := dbm.NewGoLevelDB("blockstore", filepath.Join(n.Home, "data"))
		if e != nil {
			t.Fatal(e)
		}
		h := &engineWiringHarness{f: fixture, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(database, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocks), path: n.StatePath}
		h.proxy = startEngineTestProxy(t, app)
		state, e := h.raw.Load()
		if e != nil {
			t.Fatal(e)
		}
		if state.IsEmpty() {
			state, e = sm.MakeGenesisState(doc)
			if e != nil {
				t.Fatal(e)
			}
			state.AppHash = nil
			if e = h.raw.Save(state); e != nil {
				t.Fatal(e)
			}
		}
		handshake := cmtconsensus.NewHandshaker(h.raw, state, h.blocks, doc)
		handshake.SetConsensusAuthoritySource(h.source)
		if e = handshake.Handshake(h.proxy); e != nil {
			t.Fatal(e)
		}
		actual := h.apply(t, txs)
		if actual.LastBlockHeight < f.plan.InitialHeight {
			t.Fatal("original engine did not commit")
		}
		if len(txs) > 0 && (app.committed.ValidatorRegistry == nil || len(app.committed.ValidatorRegistry.Events) != 4) {
			t.Fatal("full original registry did not commit")
		}
		if e = h.proxy.Stop(); e != nil {
			t.Fatal(e)
		}
		if e = database.Close(); e != nil {
			t.Fatal(e)
		}
		if e = blocks.Close(); e != nil {
			t.Fatal(e)
		}
		for _, path := range []string{n.StatePath, n.LegacyStateFile} {
			lease, e := AcquireApplicationStateWriterLease(path)
			if e != nil {
				t.Fatal(e)
			}
			if e = lease.Close(); e != nil {
				t.Fatal(e)
			}
		}
	}
}

func TestPQLabDistributedPublicPlanHostLocalIsolation(t *testing.T) {
	f := newPQLabDistributedTestFixture(t)
	for _, local := range f.locals {
		n := local.node
		if local.plan.Request.NativeChainID != 642399 || local.migration.Network.IsPublicNet || local.activation != nil || n.RecoveryFD != 3 {
			t.Fatal("incorrect synthetic/local activation boundary")
		}
		private := []string{n.LegacyKeyFile, n.LegacyStateFile, n.NodeKeyFile, n.CandidateMaterialFile, n.RecoveryCredentialFile}
		before := inspectionInventory(t, private...)
		for _, path := range private {
			info, e := os.Lstat(path)
			if e != nil || info.Mode().Perm() != 0600 {
				t.Fatal("private original mode", e)
			}
		}
		for _, path := range []string{n.CandidateMaterialFile, n.RecoveryCredentialFile, n.LegacyKeyFile, n.NodeKeyFile} {
			raw, e := os.ReadFile(path)
			if e != nil {
				t.Fatal(e)
			}
			if bytes.Contains(f.planRaw, raw) {
				t.Fatal("private original entered public plan")
			}
			clear(raw)
		}
		if bytes.Contains(f.planRaw, []byte("PKCS8")) || bytes.Contains(f.planRaw, []byte("priv_key")) {
			t.Fatal("private material field exported")
		}
		if _, e := GeneratePQLabDistributedIdentity(f.requestRaw, f.requestPin, n.Index); e == nil {
			t.Fatal("reentry regenerated original keys")
		}
		if _, e := ImportPQLabDistributedPlan(f.planRaw, f.planSHA, n.Index); e == nil {
			t.Fatal("reentry rewrote original import")
		}
		if !reflect.DeepEqual(before, inspectionInventory(t, private...)) {
			t.Fatal("refusal rewrote private original")
		}
	}
	// With all peer directories made inaccessible by rename, this host still
	// loads its fully validated original public plan without opening peer paths.
	for i := 1; i < 4; i++ {
		root := f.locals[i].root
		if err := os.Rename(root, root+"-offline"); err != nil {
			t.Fatal(err)
		}
		defer os.Rename(root+"-offline", root)
	}
	if _, err := LoadPQLabDistributedLocal(f.locals[0].root, f.planSHA); err != nil {
		t.Fatal("local source opened a peer private tree", err)
	}
	if _, err := LoadPQLabDistributedLocal(f.locals[0].root, strings.Repeat("0", 64)); err == nil {
		t.Fatal("wrong independent plan pin accepted")
	}
}

func TestPQLabDistributedIdentityAndSourceRefusalsPreserveOriginals(t *testing.T) {
	f := newPQLabDistributedTestFixture(t)
	before := inspectionInventory(t, f.locals[0].root)
	for _, mutate := range []func(*PQLabDistributedRequest){func(r *PQLabDistributedRequest) { r.Hosts[0].Hostname = "unrelated-host" }, func(r *PQLabDistributedRequest) { r.Hosts[0].UID++ }, func(r *PQLabDistributedRequest) { r.Hosts[0].GID++ }, func(r *PQLabDistributedRequest) { r.CometBinarySHA256 = strings.Repeat("0", 64) }, func(r *PQLabDistributedRequest) { r.NativeChainID = 6423 }} {
		var r PQLabDistributedRequest
		if err := json.Unmarshal(f.requestRaw, &r); err != nil {
			t.Fatal(err)
		}
		mutate(&r)
		raw, _ := json.Marshal(r)
		if _, err := GeneratePQLabDistributedIdentity(raw, pqLabSHA(raw), 0); err == nil {
			t.Fatal("foreign host/source/public-network input accepted")
		}
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, f.locals[0].root)) {
		t.Fatal("preflight refusal changed original host")
	}
	var changed PQLabDistributedPlan
	if err := json.Unmarshal(f.planRaw, &changed); err != nil {
		t.Fatal(err)
	}
	changed.Identities[0].Host.Index = 1
	raw, _ := json.Marshal(changed)
	if _, _, _, err := DecodePQLabDistributedPlan(raw, pqLabSHA(raw)); err == nil {
		t.Fatal("repinned cross-host identity accepted")
	}
	duplicate := append([]byte(`{"version":"wrong",`), f.planRaw[1:]...)
	if _, _, _, err := DecodePQLabDistributedPlan(duplicate, pqLabSHA(duplicate)); err == nil {
		t.Fatal("duplicate public JSON accepted")
	}
	local := f.locals[0]
	configPath := filepath.Join(local.node.Home, "config", "config.toml")
	config, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	changedConfig := bytes.Replace(config, []byte(local.node.P2PAddress), []byte("tcp://0.0.0.0:31656"), 1)
	if bytes.Equal(config, changedConfig) {
		t.Fatal("config mutation did not hit")
	}
	if err = os.WriteFile(configPath, changedConfig, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = LoadPQLabDistributedLocal(local.root, f.planSHA); err == nil {
		t.Fatal("wildcard source drift accepted")
	}
}

func TestPQLabDistributedNormalRegistryCustodyAndColdResume(t *testing.T) {
	f := newPQLabDistributedTestFixture(t)
	persistPQLabDistributedTestCheckpoint(t, f, nil)
	var txs cmttypes.Txs
	for _, local := range f.locals {
		state, err := readPQEngineCommittedState(local.node.StatePath, local.migration, local.bootstrap, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		reg, err := PreparePQLabDistributedRegistration(local.root, f.planSHA, state.Height, state.AppHash)
		if err != nil || reg.BroadcastExecuted || !reg.SyntheticOnly {
			t.Fatal("real local approval/dual PoP", err)
		}
		txs = append(txs, reg.Transaction)
		before := inspectionInventory(t, local.root)
		if _, err = PreparePQLabDistributedRegistration(local.root, f.planSHA, state.Height, state.AppHash); err == nil {
			t.Fatal("unknown registry attempt re-signed")
		}
		if !reflect.DeepEqual(before, inspectionInventory(t, local.root)) {
			t.Fatal("registry replay mutated original")
		}
	}
	persistPQLabDistributedTestCheckpoint(t, f, txs)
	var schedule []byte
	var pin string
	for _, local := range f.locals {
		cp, err := InspectOperatorCheckpoint(local.migration, local.genesisRaw, f.plan.Pins, OperatorCheckpointOptions{StatePath: local.node.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(local.node.Home, "data"), SigningStatePath: local.node.LegacyStateFile, ProposePQActivationHeight: f.plan.InitialHeight + 5})
		if err != nil || cp.ScheduleCandidate == nil {
			t.Fatal("actual local R schedule", err)
		}
		raw, err := base64.StdEncoding.DecodeString(cp.ScheduleCandidate.CanonicalScheduleBase64)
		if err != nil {
			t.Fatal(err)
		}
		if schedule == nil {
			schedule = raw
			var s PQEngineSchedule
			if err = json.Unmarshal(raw, &s); err != nil {
				t.Fatal(err)
			}
			pin, err = s.Hash()
			if err != nil {
				t.Fatal(err)
			}
		} else if !bytes.Equal(schedule, raw) {
			t.Fatal("four actual original checkpoints produced different schedule")
		}
	}
	for _, local := range f.locals {
		before := inspectionInventory(t, local.node.LegacyKeyFile, local.node.NodeKeyFile, local.node.CandidateMaterialFile, local.node.RecoveryCredentialFile)
		a, err := ActivatePQLabDistributedLocal(local.root, f.planSHA, schedule, pin)
		if err != nil {
			t.Fatal("normal host-local custody", err)
		}
		if a.RecoveryFD != 3 || a.NodeStarted || a.PhysicalHostAgreement || !strings.Contains(strings.Join(a.Args, " "), "--pq-recovery-fd 3") {
			t.Fatal("FD3/truth boundary changed")
		}
		if !reflect.DeepEqual(before, inspectionInventory(t, local.node.LegacyKeyFile, local.node.NodeKeyFile, local.node.CandidateMaterialFile, local.node.RecoveryCredentialFile)) {
			t.Fatal("activation migrated/replaced private originals")
		}
		cold, err := LoadPQLabDistributedLocal(local.root, f.planSHA)
		if err != nil || cold.activation == nil {
			t.Fatal("cold local public source", err)
		}
		inputs, err := LoadPQOperatorInputs(PQOperatorFiles{Migration: filepath.Join(local.root, "bound-migration.json"), Genesis: filepath.Join(local.root, "genesis.json"), State: local.node.StatePath, Schedule: filepath.Join(local.root, "activation", "schedule.json"), ScheduleHash: pin, Binding: local.node.HostBindingFile, Pins: f.plan.Pins})
		if err != nil {
			t.Fatal(err)
		}
		app, err := NewPersistentApplicationWithEngineAuthorization(inputs.Migration, local.node.StatePath, inputs.Bootstrap, inputs.Authorization)
		if err != nil {
			t.Fatal(err)
		}
		registry, err := NewPQCommittedSignerRegistry(app, inputs.Bootstrap)
		if err != nil {
			t.Fatal(err)
		}
		credential, err := os.ReadFile(local.node.RecoveryCredentialFile)
		if err != nil {
			t.Fatal(err)
		}
		hrs, err := os.ReadFile(local.node.SignerStateFile)
		if err != nil {
			t.Fatal(err)
		}
		host, err := ynxconsensusauth.ResumeHostSigner(local.node.VaultFile, credential, inputs.Binding, registry)
		clear(credential)
		if err != nil {
			t.Fatal("normal original encrypted signer", err)
		}
		if err = host.Close(); err != nil {
			t.Fatal(err)
		}
		after, err := os.ReadFile(local.node.SignerStateFile)
		if err != nil || !bytes.Equal(hrs, after) {
			t.Fatal("cold resume reset original HRS", err)
		}
		full := inspectionInventory(t, local.root)
		if _, err = ActivatePQLabDistributedLocal(local.root, f.planSHA, schedule, pin); err == nil {
			t.Fatal("existing epoch re-created")
		}
		if !reflect.DeepEqual(full, inspectionInventory(t, local.root)) {
			t.Fatal("activation retry changed originals")
		}
	}
}

func TestPQLabDistributedPartialImportNeverOverwritesUnknown(t *testing.T) {
	f := newPQLabDistributedTestFixture(t)
	local := f.locals[0]
	// A failed later activation attempt remains explicit and blocks ordinary
	// loading, rather than silently selecting bootstrap or resetting custody.
	stage := filepath.Join(local.root, "activation")
	if err := os.Mkdir(stage, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stage, "intent.json"), []byte("original unknown"), 0600); err != nil {
		t.Fatal(err)
	}
	before := inspectionInventory(t, local.root)
	if _, err := LoadPQLabDistributedLocal(local.root, f.planSHA); err == nil {
		t.Fatal("partial custody was treated as no activation")
	}
	if _, err := ActivatePQLabDistributedLocal(local.root, f.planSHA, []byte(`{}`), strings.Repeat("0", 64)); err == nil {
		t.Fatal("partial custody was re-created")
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, local.root)) {
		t.Fatal("UNKNOWN attempt was deleted/replaced")
	}
}
