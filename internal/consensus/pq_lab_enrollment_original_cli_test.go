//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	dbm "github.com/cometbft/cometbft-db"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Normal generated original plan/custody plus a real four-validator synthetic
// BlockExecutor/BlockStore, not a started node, a public chain or real funds.
func TestPQLabEnrollmentOriginalCLIConfirmAndRestart(t *testing.T) {
	root := filepath.Join(pqLabWorkloadTemp(t), "original-lab")
	source, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 1, Transfers: 4, BatchSize: 1, Online: true})
	if err != nil {
		t.Fatal(err)
	}
	defer source.Destroy()
	plan, err := GeneratePQLabNetwork(source.Migration, PQLabNetworkOptions{RootDir: root, BaseP2P: 31656, BaseRPC: 31757})
	if err != nil {
		t.Fatal(err)
	}
	planRaw, err := os.ReadFile(filepath.Join(root, "network-plan.json"))
	if err != nil {
		t.Fatal(err)
	}
	planPin := pqLabSHA(planRaw)
	_, migration, bootstrap, err := loadPQLab(root, planPin)
	if err != nil {
		t.Fatal(err)
	}
	if len(bootstrap.record.Members) != 4 {
		t.Fatal("fixture did not use four original validators")
	}
	if _, err = source.WriteCorpus(filepath.Join(root, "workload"), migration); err != nil {
		t.Fatal(err)
	}
	manifestRaw, err := os.ReadFile(filepath.Join(root, "workload", "PUBLIC-WORKLOAD.json"))
	if err != nil {
		t.Fatal(err)
	}
	workloadPin := pqLabSHA(manifestRaw)
	genesis, err := os.ReadFile(plan.GenesisFile)
	if err != nil {
		t.Fatal(err)
	}
	doc, err := cmttypes.GenesisDocFromJSON(genesis)
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{migration: migration, bootstrap: bootstrap, pins: plan.pins(), raw: genesis, doc: doc, legacy: map[string]ed25519.PrivateKey{}}
	for _, n := range plan.Nodes {
		legacy, e := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, plan.ChainID)
		if e != nil {
			t.Fatal(e)
		}
		f.legacy[string(n.ValidatorAddress)] = ed25519.PrivateKey(legacy.Key.PrivKey.(cmted.PrivKey))
	}
	app, err := NewPersistentApplicationWithBootstrap(migration, filepath.Join(root, "synthetic-engine-state.json"), bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blockDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blockDB.Close() })
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blockDB), path: app.statePath}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err = h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err = handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	if _, err = h.wrapped().Load(); err != nil {
		t.Fatal(err)
	}
	var registrations cmttypes.Txs
	for i := range f.bootstrap.record.Members {
		key, wire := engineRegistration(t, f, i, doc.InitialHeight)
		h.keys = append(h.keys, key)
		tx, e := EncodeValidatorRegistryTransaction(wire)
		if e != nil {
			t.Fatal(e)
		}
		registrations = append(registrations, tx)
	}
	h.apply(t, registrations)
	schedule, err := NewPQEngineSchedule(bootstrap, h.app.committed.ValidatorRegistry, h.app.committed.Height, h.app.committed.Height+4)
	if err != nil {
		t.Fatal(err)
	}
	scheduleRaw, err := json.Marshal(schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, scheduleHash)
	if err != nil {
		t.Fatal(err)
	}
	app, err = NewPersistentApplicationWithEngineAuthorization(migration, h.path, bootstrap, auth)
	if err != nil {
		t.Fatal(err)
	}
	h.app = app
	h.source.app = app
	h.proxy = startEngineTestProxy(t, app)
	for app.committed.Height < schedule.ActivationHeight+1 {
		h.apply(t, nil)
	}
	credentialPath := filepath.Join(root, "workload", "private-senders", "recovery.raw")
	credential, err := os.ReadFile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(credential)
	sender, err := OpenPQLabSender(filepath.Join(root, "workload"), workloadPin, 0, credential)
	if err != nil {
		t.Fatal(err)
	}
	classic := deterministicPrivateKey(226)
	defer classic.Zero()
	owner := mustNativeAddress(t, classic)
	target, pub, err := ynxbatch.KeyGen()
	if err != nil {
		t.Fatal(err)
	}
	defer target.Destroy()
	checkpoint := pqLabSenderTestCheckpoint(t, app, migration)
	request := PQLabEnrollmentRequest{Version: "YNX-PQ-LAB-ENROLLMENT-REQUEST/v1", FundingOperationID: strings.Repeat("a", 64), MigrationOperationID: strings.Repeat("b", 64), OwnerIndex: 0, FundingNonce: 2, TargetOwner: owner, FundingAmount: 3, ActivationHeight: uint64(checkpoint.state.Height + 8), PKA: pub.PKA, PKB: pub.PKB}
	signed, err := sender.SignPQLabEnrollmentOriginals(request, checkpoint, classic, target)
	if err != nil {
		t.Fatal(err)
	}
	fundDir, _ := sender.operation(request.FundingOperationID)
	migrationDir, _ := sender.operation(request.MigrationOperationID)
	read := func(path string) []byte {
		t.Helper()
		raw, e := os.ReadFile(path)
		if e != nil {
			t.Fatal(e)
		}
		return raw
	}
	fundWire, fundEnvelope := read(filepath.Join(fundDir, "transaction.wire")), read(filepath.Join(fundDir, "transaction.abci"))
	migrationWire, migrationEnvelope := read(filepath.Join(migrationDir, "transaction.wire")), read(filepath.Join(migrationDir, "transaction.abci"))
	if err = sender.Close(); err != nil {
		t.Fatal(err)
	}
	fundHeight := h.app.committed.Height + 1
	h.apply(t, cmttypes.Txs{fundEnvelope})
	h.apply(t, nil)
	migrationHeight := h.app.committed.Height + 1
	h.apply(t, cmttypes.Txs{migrationEnvelope})
	h.apply(t, nil)
	l := &pqLightProofFixture{harness: h, schedule: schedule, authorization: auth}
	statement := func(b *cmttypes.LightBlock) PQLightProofExpectation {
		return PQLightProofExpectation{ChainID: b.ChainID, HeaderHeight: b.Height, BlockHash: bytes.Clone(b.Hash()), StateHeight: b.Height - 1, StateAppHash: bytes.Clone(b.AppHash)}
	}
	makeProof := func(height int64, kind string, wire, envelope []byte) (PQTransactionProofExpectation, PQTransactionProofRequest) {
		b, s := l.block(t, height), l.block(t, height+1)
		if len(b.Commit.Signatures) != 4 || len(s.Commit.Signatures) != 4 {
			t.Fatal("fixture lacks four validator commit slots")
		}
		outer, native := sha256.Sum256(envelope), sha256.Sum256(wire)
		expected := PQTransactionProofExpectation{Block: statement(b), Successor: statement(s), TransactionType: kind, Envelope: bytes.Clone(envelope), NativeWire: bytes.Clone(wire), TransactionHash: outer[:], NativeWireHash: native[:], Index: 0}
		txProof, e := cmtjson.Marshal(h.blocks.LoadBlock(height).Data.Txs.Proof(0))
		if e != nil {
			t.Fatal(e)
		}
		result, e := h.raw.LoadFinalizeBlockResponse(height)
		if e != nil || len(result.TxResults) != 1 || result.TxResults[0].Code != 0 {
			t.Fatal("original execution", e, result)
		}
		execution, executionProof, e := EncodePQTransactionExecutionProof(result.TxResults, 0)
		if e != nil {
			t.Fatal(e)
		}
		return expected, PQTransactionProofRequest{Version: PQTransactionProofVersion, Block: l.encode(t, b), Successor: l.encode(t, s), TransactionProof: txProof, ExecutionResult: execution, ExecutionProof: executionProof}
	}
	fundingExpected, fundingProof := makeProof(fundHeight, PQTransferType, fundWire, fundEnvelope)
	migrationExpected, migrationProof := makeProof(migrationHeight, PQMigrationType, migrationWire, migrationEnvelope)
	migrationRaw, err := migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	stateRaw := read(h.path)
	trustedRaw, err := cmtjson.Marshal(l.block(t, schedule.ActivationHeight))
	if err != nil {
		t.Fatal(err)
	}
	engine, err := h.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	materials := PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: migrationRaw, Genesis: genesis, CommittedState: stateRaw, Schedule: scheduleRaw, TrustedLightBlock: trustedRaw, Pins: plan.pins(), ScheduleHash: scheduleHash, EngineHeight: engine.LastBlockHeight, EngineAppHash: bytes.Clone(engine.AppHash), TrustingPeriod: time.Hour, MaxClockDrift: time.Second, TrustNumerator: 1, TrustDenominator: 3, Expected: fundingExpected}
	migrationMaterials := materials
	migrationMaterials.Expected = migrationExpected
	publicDir := filepath.Join(root, "original-public-proofs")
	if err = os.Mkdir(publicDir, 0700); err != nil {
		t.Fatal(err)
	}
	write := func(name string, value any) (string, string) {
		t.Helper()
		raw, e := json.Marshal(value)
		if e != nil {
			t.Fatal(e)
		}
		path := filepath.Join(publicDir, name)
		if e = os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
		return path, pqLabSHA(raw)
	}
	fm, fmPin := write("funding-materials.json", materials)
	fp, _ := write("funding-proof.json", fundingProof)
	mm, mmPin := write("migration-materials.json", migrationMaterials)
	mp, _ := write("migration-proof.json", migrationProof)
	requestRaw, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	type command struct {
		Version                  string                 `json:"version"`
		Operation                string                 `json:"operation"`
		Request                  PQLabEnrollmentRequest `json:"request"`
		RequestSHA256            string                 `json:"requestSHA256"`
		FundingMaterialsFile     string                 `json:"fundingMaterialsFile"`
		FundingMaterialsSHA256   string                 `json:"fundingMaterialsSHA256"`
		FundingProofFile         string                 `json:"fundingProofFile"`
		MigrationMaterialsFile   string                 `json:"migrationMaterialsFile"`
		MigrationMaterialsSHA256 string                 `json:"migrationMaterialsSHA256"`
		MigrationProofFile       string                 `json:"migrationProofFile"`
	}
	cmd := command{Version: "YNX-PQ-LAB-ENROLLMENT-COMMAND/v1", Operation: "confirm", Request: request, RequestSHA256: pqLabSHA(requestRaw), FundingMaterialsFile: fm, FundingMaterialsSHA256: fmPin, FundingProofFile: fp, MigrationMaterialsFile: mm, MigrationMaterialsSHA256: mmPin, MigrationProofFile: mp}
	binary := filepath.Join(pqLabWorkloadTemp(t), "ynx-consensus-pq-lab")
	build := exec.Command("go", "build", "-o", binary, "../../cmd/ynx-consensus-pq-lab")
	if output, e := build.CombinedOutput(); e != nil {
		t.Fatalf("normal CLI build: %v: %s", e, output)
	}
	invoke := func(c command) []byte {
		t.Helper()
		raw, e := json.Marshal(c)
		if e != nil {
			t.Fatal(e)
		}
		fd, e := os.Open(credentialPath)
		if e != nil {
			t.Fatal(e)
		}
		defer fd.Close()
		p := exec.Command(binary, "enrollment-original", "--synthetic", "--root", root, "--plan-sha256", planPin, "--workload-sha256", workloadPin, "--owner", "0", "--credential-fd", "3")
		p.ExtraFiles = []*os.File{fd}
		p.Stdin = bytes.NewReader(raw)
		var stdout, stderr bytes.Buffer
		p.Stdout = &stdout
		p.Stderr = &stderr
		if e = p.Run(); e != nil {
			t.Fatalf("normal CLI failure: %v: %s", e, stderr.String())
		}
		return stdout.Bytes()
	}
	responseRaw := invoke(cmd)
	var response struct {
		Code                 string                      `json:"code"`
		RequestSHA256        string                      `json:"requestSHA256"`
		FundingOperationID   string                      `json:"fundingOperationId"`
		MigrationOperationID string                      `json:"migrationOperationId"`
		CurrentEligibility   string                      `json:"currentEligibility"`
		AuthorityGranted     bool                        `json:"authorityGranted"`
		Result               PQLabEnrollmentConfirmation `json:"result"`
	}
	if err = json.Unmarshal(responseRaw, &response); err != nil || response.Code != "PROOF_CONFIRMED_DATA" || response.RequestSHA256 != cmd.RequestSHA256 || response.FundingOperationID != request.FundingOperationID || response.MigrationOperationID != request.MigrationOperationID || response.CurrentEligibility != "UNKNOWN" || response.AuthorityGranted || !response.Result.Funding.Result.ExecutionSuccessful || !response.Result.Migration.Result.ExecutionSuccessful {
		t.Fatal("normal CLI did not confirm original pair", err, string(responseRaw))
	}
	fundConfirmed := read(filepath.Join(fundDir, "CONFIRMED.json"))
	migrationConfirmed := read(filepath.Join(migrationDir, "CONFIRMED.json"))
	for _, v := range []struct {
		path string
		file PQLabWorkloadFile
	}{{filepath.Join(fundDir, "CONFIRMED.json"), response.Result.FundingConfirmed}, {filepath.Join(migrationDir, "CONFIRMED.json"), response.Result.MigrationConfirmed}} {
		if got := pqLabFile("CONFIRMED.json", read(v.path)); got != v.file {
			t.Fatal("CLI confirmed digest differs from original", got, v.file)
		}
	}
	repeated := invoke(cmd)
	if !bytes.Equal(repeated, responseRaw) {
		t.Fatal("rechecking exact original confirmation changed result", string(repeated))
	}
	// A fresh subprocess reopens original custody and must recover exact signatures.
	cmd.Operation = "recover"
	cmd.FundingMaterialsFile = ""
	cmd.FundingMaterialsSHA256 = ""
	cmd.FundingProofFile = ""
	cmd.MigrationMaterialsFile = ""
	cmd.MigrationMaterialsSHA256 = ""
	cmd.MigrationProofFile = ""
	recovery := invoke(cmd)
	var recovered struct {
		Code                 string                        `json:"code"`
		RequestSHA256        string                        `json:"requestSHA256"`
		FundingOperationID   string                        `json:"fundingOperationId"`
		MigrationOperationID string                        `json:"migrationOperationId"`
		Result               PQLabEnrollmentOriginalResult `json:"result"`
		CurrentEligibility   string                        `json:"currentEligibility"`
	}
	if err = json.Unmarshal(recovery, &recovered); err != nil || recovered.Code != "ORIGINAL_RECOVERED" || recovered.RequestSHA256 != cmd.RequestSHA256 || recovered.FundingOperationID != request.FundingOperationID || recovered.MigrationOperationID != request.MigrationOperationID || recovered.CurrentEligibility != "UNKNOWN" || !reflect.DeepEqual(recovered.Result, signed) {
		t.Fatal("normal cold original recovery changed", err, string(recovery))
	}
	if !bytes.Equal(fundEnvelope, read(filepath.Join(fundDir, "transaction.abci"))) || !bytes.Equal(migrationEnvelope, read(filepath.Join(migrationDir, "transaction.abci"))) {
		t.Fatal("normal CLI replaced original signatures")
	}
	if !bytes.Equal(fundConfirmed, read(filepath.Join(fundDir, "CONFIRMED.json"))) || !bytes.Equal(migrationConfirmed, read(filepath.Join(migrationDir, "CONFIRMED.json"))) {
		t.Fatal("cold recovery changed original confirmation bytes")
	}
}
