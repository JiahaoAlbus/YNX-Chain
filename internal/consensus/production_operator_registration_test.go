package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Insert the explicit optional field into the original canonical order. This
// also exercises the old decoder's real unknown-field refusal before the fix.
func quietRegistrationPlan(t *testing.T, p ProductionOperatorPlan, mode string) ([]byte, string) {
	t.Helper()
	raw, _ := productionOperatorPlanBytes(t, p)
	field, err := json.Marshal(mode)
	if err != nil {
		t.Fatal(err)
	}
	raw = bytes.Replace(raw, []byte(`"roles":`), append(append([]byte(`"bootstrapRegistrationMode":`), field...), []byte(`,"roles":`)...), 1)
	return raw, productionOperatorSHA(raw)
}

func TestProductionOperatorQuietRegistrationPinnedPlanAndRestoration(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	quietRegistrationPublicPaths(&f.plan)
	original, originalPin := productionOperatorPlanBytes(t, f.plan)
	decoded, err := DecodeProductionOperatorPlan(original, originalPin)
	if err != nil {
		t.Fatal(err)
	}
	roundtrip, _ := json.Marshal(decoded)
	if !bytes.Equal(roundtrip, original) {
		t.Fatal("old omitted mode changed original plan bytes/pin")
	}
	raw, pin := quietRegistrationPlan(t, f.plan, "quiet-first-registration-v1")
	root := filepath.Join(t.TempDir(), "quiet")
	if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, root, f.genesisTime, raw, pin); err != nil {
		t.Fatalf("PINNED_BOOTSTRAP_QUIET_PROFILE_REFUSED: %v", err)
	}
	if err := VerifyProductionOperatorCandidatePackage(root, pin); err != nil {
		t.Fatal(err)
	}
	normalRoot := filepath.Join(t.TempDir(), "normal")
	if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, normalRoot, f.genesisTime, original, originalPin); err != nil {
		t.Fatal(err)
	}
	for _, r := range f.plan.Roles {
		read := func(root, name string) []byte {
			t.Helper()
			v, e := os.ReadFile(filepath.Join(root, "roles", r.Role, name))
			if e != nil {
				t.Fatal(e)
			}
			return v
		}
		quietConfig, normalConfig := read(root, "config/config.toml"), read(normalRoot, "config/config.toml")
		if !bytes.Equal(quietConfig, normalConfig) {
			t.Fatal("quiet launcher changed original Home config; activation cannot restore it normally")
		}
		config, err := decodeProductionOperatorCometConfig(quietConfig, r.Home)
		if err != nil || !config.Consensus.CreateEmptyBlocks || config.Consensus.CreateEmptyBlocksInterval != 0 {
			t.Fatal("original persisted default config changed", err)
		}
		launch := read(root, "scripts/start-operator.sh")
		flag := []byte("'--consensus.create_empty_blocks=false'")
		if bytes.Count(launch, flag) != 1 || bytes.Contains(read(normalRoot, "scripts/start-operator.sh"), flag) {
			t.Fatal("explicit quiet mode or normal restoration argv missing")
		}
		if !bytes.Equal(launch, read(root, "scripts/start-operator.sh")) {
			t.Fatal("restart launcher changed")
		}
	}
	if err := VerifyProductionOperatorCandidatePackage(root, originalPin); err == nil {
		t.Fatal("quiet plan self-authorized under original default pin")
	}

	t.Run("rehashed-launcher-cannot-drop-mode", func(t *testing.T) {
		rel := filepath.Join("roles", f.plan.Roles[0].Role, "scripts/start-operator.sh")
		filename := filepath.Join(root, rel)
		before, err := os.ReadFile(filename)
		if err != nil {
			t.Fatal(err)
		}
		changed := bytes.Replace(before, []byte(" '--consensus.create_empty_blocks=false'"), nil, 1)
		if bytes.Equal(before, changed) {
			t.Fatal("test did not change the actual launcher")
		}
		if err := os.WriteFile(filename, changed, 0600); err != nil {
			t.Fatal(err)
		}
		manifestFile := filepath.Join(root, "package-manifest.json")
		original, err := os.ReadFile(manifestFile)
		if err != nil {
			t.Fatal(err)
		}
		var manifest ProductionCandidatePackageManifest
		if err = json.Unmarshal(original, &manifest); err != nil {
			t.Fatal(err)
		}
		manifest.Files[rel] = productionOperatorSHA(changed)
		if err = writeJSON(manifestFile, manifest, 0600); err != nil {
			t.Fatal(err)
		}
		if err = VerifyProductionOperatorCandidatePackage(root, pin); err == nil {
			t.Fatal("self-rehashed launcher silently removed approved quiet mode")
		}
		retained, err := os.ReadFile(filename)
		if err != nil || !bytes.Equal(retained, changed) {
			t.Fatal("verification modified rejected original launcher", err)
		}
	})
	for _, mode := range []string{"", "true", "quiet-first-registration-v2"} {
		t.Run("reject-mode-"+mode, func(t *testing.T) {
			raw, pin := quietRegistrationPlan(t, f.plan, mode)
			output := filepath.Join(t.TempDir(), "refused")
			if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, output, f.genesisTime, raw, pin); err == nil {
				t.Fatal("unsupported/noncanonical mode accepted")
			}
			if _, err := os.Lstat(output); !os.IsNotExist(err) {
				t.Fatal("invalid mode mutated output")
			}
		})
	}
	halt := f.plan
	halt.HeightHaltSessionID = productionOperatorSHA([]byte("synthetic quiet/halt incompatibility"))
	halt.Roles = append([]ProductionOperatorRole(nil), f.plan.Roles...)
	for i := range halt.Roles {
		halt.Roles[i].HeightHaltControlPath = filepath.Join(filepath.Dir(halt.Roles[i].ABCIState), "operator-height-halt-"+halt.HeightHaltSessionID+".json")
	}
	raw, pin = quietRegistrationPlan(t, halt, "quiet-first-registration-v1")
	if _, err := GenerateProductionCandidatePackageWithOperator(f.migration, f.validators, filepath.Join(t.TempDir(), "halt-refused"), f.genesisTime, raw, pin); err == nil {
		t.Fatal("quiet profile admitted unreachable future height halt")
	}
	// A normal, genuinely approved first-PQ plan MUST restore automatic empty
	// blocks; otherwise P/U/A need not be reached. Its genesis/custody stay original.
	pq := newProductionOperatorFixture(t, false, true)
	quietRegistrationPublicPaths(&pq.plan)
	pqRaw, pqPin := productionOperatorPlanBytes(t, pq.plan)
	pqRoot := filepath.Join(t.TempDir(), "pq")
	if _, err := GenerateProductionCandidatePackageWithOperator(pq.migration, pq.validators, pqRoot, pq.genesisTime, pqRaw, pqPin); err != nil {
		t.Fatal(err)
	}
	for _, r := range pq.plan.Roles {
		launch, err := os.ReadFile(filepath.Join(pqRoot, "roles", r.Role, "scripts/start-operator.sh"))
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(launch, []byte("--consensus.create_empty_blocks")) {
			t.Fatal("normal PQ plan retained quiet override")
		}
	}
	raw, pin = quietRegistrationPlan(t, pq.plan, "quiet-first-registration-v1")
	if _, err := GenerateProductionCandidatePackageWithOperator(pq.migration, pq.validators, filepath.Join(t.TempDir(), "pq-refused"), pq.genesisTime, raw, pin); err == nil {
		t.Fatal("PQ activation plan retained quiet mode")
	}
}

func TestProductionOperatorQuietRegistrationProofTailAndCold(t *testing.T) {
	f := newProductionOperatorFixture(t, false, false)
	var doc cmttypes.GenesisDoc
	if err := cmtjson.Unmarshal(f.plan.ConsensusGenesis, &doc); err != nil {
		t.Fatal(err)
	}
	pins := ConsensusBootstrapPins{f.plan.ConsensusGenesisSHA256, f.plan.OriginalGenesisHash, f.plan.MigrationStateHash}
	b, err := NewConsensusBootstrap(f.plan.ConsensusGenesis, pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	rf := &validatorRegistryFixture{migration: f.migration, raw: f.plan.ConsensusGenesis, pins: pins, bootstrap: b, doc: &doc, legacy: make(map[string]ed25519.PrivateKey)}
	for _, paths := range f.keys {
		raw, err := os.ReadFile(paths[0])
		if err != nil {
			t.Fatal(err)
		}
		var key privval.FilePVKey
		if err = cmtjson.Unmarshal(raw, &key); err != nil {
			t.Fatal(err)
		}
		rf.legacy[string(key.Address)] = ed25519.PrivateKey(bytes.Clone(key.PrivKey.Bytes()))
	}
	statePath := filepath.Join(t.TempDir(), "original-state.json")
	app := newPinnedRegistryApp(t, rf, statePath)
	accounts := cloneAccounts(app.committed.Accounts)
	ctx := context.Background()
	finish := func(txs [][]byte) *abci.ResponseFinalizeBlock {
		t.Helper()
		h := app.committed.Height + 1
		res, err := app.FinalizeBlock(ctx, &abci.RequestFinalizeBlock{Height: h, Time: doc.GenesisTime.Add(time.Duration(h) * time.Second), NextValidatorsHash: bytes.Clone(b.validatorSetHash), Txs: txs})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = app.Commit(ctx, &abci.RequestCommit{}); err != nil {
			t.Fatal(err)
		}
		return res
	}
	// The first empty block is mandatory at genesis. Height and empty-block
	// time are persisted but excluded from AppHash; inspect the real committed
	// outputs used by Comet's unchanged needProofBlock predicate.
	initialHash := app.committed.AppHash
	finish(nil)
	if app.committed.AppHash != initialHash {
		t.Fatal("initial empty block changed AppHash")
	}
	quiet := cmtconfig.DefaultConsensusConfig()
	quiet.CreateEmptyBlocks = false
	if !quiet.WaitForTxs() {
		t.Fatal("original Comet quiet configuration ignored")
	}
	var approved []int64
	for i := 0; i < 4; i++ {
		h := app.committed.Height + 1
		approved = append(approved, h)
		tx, wire := rf.transaction(t, i, h)
		old := app.committed.AppHash
		ck, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: tx})
		if err != nil || ck.Code != 0 {
			t.Fatalf("exact stable nextH rejected: %+v %v", ck, err)
		}
		pp, err := app.PrepareProposal(ctx, &abci.RequestPrepareProposal{Height: h, NextValidatorsHash: bytes.Clone(b.validatorSetHash), Txs: [][]byte{tx}})
		if err != nil || len(pp.Txs) != 1 {
			t.Fatal("normal proposal omitted valid exact-height registration", err)
		}
		pr, err := app.ProcessProposal(ctx, &abci.RequestProcessProposal{Height: h, NextValidatorsHash: bytes.Clone(b.validatorSetHash), Txs: pp.Txs})
		if err != nil || pr.Status != abci.ResponseProcessProposal_ACCEPT {
			t.Fatal("normal proposal rejected exact-height registration", err)
		}
		result := finish(pp.Txs)
		if len(result.TxResults) != 1 || result.TxResults[0].Code != 0 || app.committed.AppHash == old {
			t.Fatal("real registration did not change committed registry")
		}
		if !bytes.Equal(app.committed.ValidatorRegistry.Events[i].Wire, wire) || app.committed.ValidatorRegistry.Events[i].Height != h {
			t.Fatal("original signed height/wire changed")
		}
		// Header(H).AppHash=state(H-1); after registry H, needProofBlock(H+1)
		// is true. Header(H+1).AppHash=state(H); one empty proof block then makes
		// state(H+1)==Header(H+1).AppHash, so H+2 waits for a transaction.
		headerAtRegistration := old
		registrationHash := app.committed.AppHash
		if headerAtRegistration == registrationHash {
			t.Fatal("registration did not require original proof block")
		}
		finish(nil)
		if app.committed.AppHash != registrationHash {
			t.Fatal("proof block did not quiesce after exactly one empty commit")
		}
		cold, err := NewPersistentApplicationWithBootstrap(f.migration, statePath, b)
		if err != nil {
			t.Fatal(err)
		}
		if cold.committed.Height != h+1 || cold.committed.AppHash != registrationHash || !reflect.DeepEqual(cold.committed.ValidatorRegistry, app.committed.ValidatorRegistry) {
			t.Fatal("cold recovery changed stable registration checkpoint")
		}
		app = cold
		late, err := app.CheckTx(ctx, &abci.RequestCheckTx{Tx: tx})
		if err != nil || late.Code == 0 {
			t.Fatal("missed/replayed original ApprovedAt accepted")
		}
	}
	if !reflect.DeepEqual(accounts, app.committed.Accounts) {
		t.Fatal("registration changed original balances or nonce")
	}
	for i := 1; i < len(approved); i++ {
		if approved[i] != approved[i-1]+2 {
			t.Fatal("next approval guessed registrationH+1 instead of actual proof-tail H+1")
		}
	}
	schedule, err := NewPQEngineSchedule(b, app.committed.ValidatorRegistry, app.committed.Height, app.committed.Height+4)
	if err != nil || schedule.RegistryEventCount != 4 {
		t.Fatal("complete original four registrations cannot form normal activation schedule", err)
	}
	t.Logf("actual no-Node Application ApprovedAt=%v; registryH=%d; P=%d U=%d A=%d; no RPC/finality claim", approved, schedule.RegistryHeight, schedule.ParamsUpdateHeight, schedule.ValidatorUpdateHeight, schedule.ActivationHeight)
}

// Package generation consumes PUBLIC original custody paths; it does not read
// those files. Keep Linux operator syntax independent of the host TMPDIR (the
// actual synthetic test keys remain solely in the original fixture directory).
func quietRegistrationPublicPaths(p *ProductionOperatorPlan) {
	for i := range p.Roles {
		r := &p.Roles[i]
		r.LegacyKeyPath = "/etc/ynx/consensus-candidate/" + r.Role + "/priv_validator_key.json"
		r.NodeKeyPath = "/etc/ynx/consensus-candidate/" + r.Role + "/node_key.json"
		r.LegacyStatePath = r.Home + "/data/priv_validator_state.json"
	}
}
