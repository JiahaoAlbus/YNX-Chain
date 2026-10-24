package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func TestCometMigrationReferencePreservesOriginalInlineGenesis(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(f.doc.AppState, canonical) || f.bootstrap.migrationReference != nil {
		t.Fatal("small original genesis was rewritten as a reference")
	}
	original := *f.doc
	original.AppState = canonical
	originalBytes, err := cmtjson.MarshalIndent(&original, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	actualBytes, err := cmtjson.MarshalIndent(f.doc, "", "  ")
	if err != nil || !bytes.Equal(actualBytes, originalBytes) {
		t.Fatal("small normal SaveAs bytes changed", err)
	}
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.InitChain(context.Background(), f.initRequest(t)); err != nil {
		t.Fatal(err)
	}
	if app.committed.AppHash != f.migration.StateHash || f.bootstrap.record.OriginalGenesisHash != f.migration.OriginalGenesisHash {
		t.Fatal("inline genesis changed original native identity or application state")
	}
}

func TestCometMigrationReferenceRejectsUnboundOrNoncanonicalManifest(t *testing.T) {
	f := newValidatorRegistryFixture(t)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	ref := newCometMigrationReference(f.migration, canonical)
	raw, err := json.Marshal(ref)
	if err != nil {
		t.Fatal(err)
	}
	if _, isReference, err := validateCometMigrationAppState(raw, f.migration, canonical); err != nil || !isReference {
		t.Fatal(err)
	}
	// A pinned reference representation still requires the complete original
	// sidecar at the real constructor; its own raw Genesis pin is insufficient.
	doc := *f.doc
	doc.AppState = raw
	genesis, err := cmtjson.Marshal(&doc)
	if err != nil {
		t.Fatal(err)
	}
	pins := f.pins
	pins.CometGenesisSHA256 = productionOperatorSHA(genesis)
	bound, err := NewConsensusBootstrap(genesis, pins, f.migration)
	if err != nil || bound.migrationReference == nil {
		t.Fatal("normal bootstrap rejected an exact complete-sidecar binding", err)
	}
	if _, err := NewConsensusBootstrap(genesis, pins, chain.ConsensusMigrationState{}); err == nil {
		t.Fatal("raw Genesis pin granted missing complete source state")
	}
	for _, field := range []string{"version", "migrationCanonicalSHA256", "migrationCanonicalBytes", "migrationVersion", "migrationSourceFormat", "nativeChainId", "originalGenesisHash", "migrationStateHash", "migrationHeight", "migrationLastBlockHash"} {
		t.Run(field, func(t *testing.T) {
			var value map[string]string
			if err := json.Unmarshal(raw, &value); err != nil {
				t.Fatal(err)
			}
			old := strconv.Quote(value[field])
			changed := bytes.Replace(raw, []byte(strconv.Quote(field)+":"+old), []byte(strconv.Quote(field)+":"+strconv.Quote("changed-"+value[field])), 1)
			if bytes.Equal(raw, changed) {
				t.Fatal("mutation did not reach reference field")
			}
			if _, _, err := validateCometMigrationAppState(changed, f.migration, canonical); err == nil {
				t.Fatal("self-declared reference field accepted", field)
			}
		})
	}
	for _, bad := range [][]byte{
		append([]byte(`{"path":"/untrusted/migration",`), raw[1:]...),
		append([]byte(`{"version":"YNX-COMET-MIGRATION-REFERENCE/v1",`), raw[1:]...),
		bytes.Replace(raw, []byte(`"migrationCanonicalBytes":"`+strconv.Itoa(len(canonical))+`"`), []byte(`"migrationCanonicalBytes":`+strconv.Itoa(len(canonical))), 1),
		bytes.Replace(raw, []byte(`"nativeChainId":"6423",`), nil, 1),
		append(bytes.Clone(raw), []byte(`{}`)...),
		[]byte(`{"version":"YNX-COMET-MIGRATION-REFERENCE/v2"}`),
	} {
		if bytes.Equal(bad, raw) {
			t.Fatal("negative fixture did not change original manifest")
		}
		if _, _, err := validateCometMigrationAppState(bad, f.migration, canonical); err == nil {
			t.Fatal("unknown, duplicated, missing or noncanonical reference accepted")
		}
	}
	if _, _, err := validateCometMigrationAppState(raw, f.migration, nil); err == nil {
		t.Fatal("reference supplied its own missing complete migration")
	}
	// A real different source record is exported and rehashed by the producer;
	// a matching network alone cannot make it the pinned original sidecar.
	d := chain.NewDevnet(chain.DefaultNetworkConfig("testnet"))
	if _, err := d.Faucet("ynx_reference_changed_history", 1); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	other, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	otherRaw, err := other.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := validateCometMigrationAppState(raw, other, otherRaw); err == nil {
		t.Fatal("different complete source history accepted")
	}
	if err := bound.matchesMigration(other); err == nil {
		t.Fatal("stored reference accepted a different complete source")
	}
}

// Grow only real normal source records: distinct faucet recipients, original
// lot flows, account state, blocks and EVM history. No padded JSON field,
// synthetic checksum, hand-built transaction or truncated migration is used.
func largeReferenceMigration(t *testing.T, seed chain.ConsensusMigrationState) (chain.ConsensusMigrationState, string) {
	t.Helper()
	validators := make([]chain.Validator, 0, len(seed.Validators))
	for _, v := range seed.Validators {
		validators = append(validators, chain.Validator{Address: v.Address, Moniker: v.Moniker, VotingPower: v.VotingPower, Active: v.Active})
	}
	d := chain.NewDevnetWithValidators(seed.Network, validators)
	d.ProduceBlock()
	empty, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	emptyRaw, err := empty.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	baseBytes := len(emptyRaw)
	empty, emptyRaw = chain.ConsensusMigrationState{}, nil
	add := func(from, through int) {
		for i := from; i < through; i++ {
			if _, err := d.Faucet(fmt.Sprintf("0x%040x", i+1), 1); err != nil {
				t.Fatal(err)
			}
		}
	}
	const sample = 64
	add(0, sample)
	first := d.ProduceBlock()
	observed, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	sampleRaw, err := observed.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	bytesPerRecord := (len(sampleRaw) - baseBytes) / sample
	if bytesPerRecord <= 0 || len(first.Transactions) != sample {
		t.Fatal("normal producer sizing sample is invalid")
	}
	// A narrow margin covers varying decimal indices/time encoding. The final
	// real document must still cross the actual unchanged 64 MiB input limit.
	count := (MaxCometGenesisBytes+(2<<20))/bytesPerRecord + sample
	observed, sampleRaw = chain.ConsensusMigrationState{}, nil
	if count <= sample || count > 100000 {
		t.Fatal("normal history sizing is outside the bounded test inventory", count)
	}
	add(sample, count)
	d.ProduceBlock()
	m, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Runtime.Blocks[2].Transactions) != sample || len(m.Runtime.Blocks[3].Transactions) != count-sample {
		t.Fatal("normal producer lost source records")
	}
	return m, first.Transactions[0].Hash
}

func TestCometMigrationReferenceLargeCanonicalPackageBootstrapRecovery(t *testing.T) {
	// One actual >64 MiB source fixture shared through this sequential lifecycle.
	// The ordinary CI runs this without a node, listener, or external service.
	f := newProductionOperatorFixture(t, false, false)
	m, historyHash := largeReferenceMigration(t, f.migration)
	bindings := make([]chain.ConsensusValidatorKeyBinding, 0, len(f.validators.Validators))
	for _, v := range f.validators.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.ValidatorAddress, KeyType: v.ConsensusKeyType, PublicKey: v.ConsensusPubKey, ConsensusAddress: v.ConsensusAddress})
	}
	var err error
	m, err = m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	canonical, err := m.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) <= MaxCometGenesisBytes || len(canonical) > 80<<20 {
		t.Fatal("real valid history did not cross bounded Genesis input size", len(canonical))
	}
	sourceBytes := len(canonical)
	sourceDigest := sha256.Sum256(canonical)
	doc, err := BuildCometGenesis(m, f.genesisTime)
	if err != nil {
		t.Fatal(err)
	}
	// Reproduce the old normal encoder with this very same valid full source.
	// The unchanged input limit rejects those bytes before any node is started.
	inline := *doc
	inline.AppState = canonical
	oldGenesis, err := cmtjson.MarshalIndent(&inline, "", "  ")
	if err != nil || len(oldGenesis) <= MaxCometGenesisBytes {
		t.Fatal("old full-source Genesis did not reproduce the actual input bound", err)
	}
	oldPins := ConsensusBootstrapPins{productionOperatorSHA(oldGenesis), m.OriginalGenesisHash, m.StateHash}
	if _, err := NewConsensusBootstrap(oldGenesis, oldPins, m); err == nil {
		t.Fatal("oversized old inline Genesis bypassed the unchanged 64 MiB bound")
	}
	canonical, inline.AppState, oldGenesis = nil, nil, nil
	rawGenesis, err := cmtjson.MarshalIndent(doc, "", "  ")
	if err != nil || len(rawGenesis) > MaxCometGenesisBytes {
		t.Fatal("reference Genesis exceeded unchanged cap", err)
	}
	ref, err := decodeCometMigrationReference(doc.AppState)
	if err != nil || ref.MigrationCanonicalSHA256 != hex.EncodeToString(sourceDigest[:]) || ref.MigrationCanonicalBytes != strconv.Itoa(sourceBytes) {
		t.Fatal("Genesis did not bind complete canonical source", err)
	}
	pins := ConsensusBootstrapPins{productionOperatorSHA(rawGenesis), m.OriginalGenesisHash, m.StateHash}
	b, err := NewConsensusBootstrap(rawGenesis, pins, m)
	if err != nil || b.migrationReference == nil {
		t.Fatal("normal bootstrap did not validate complete sidecar", err)
	}
	if _, err := NewConsensusBootstrap(rawGenesis, pins, chain.ConsensusMigrationState{}); err == nil {
		t.Fatal("manifest alone bootstrapped a missing migration")
	}
	f.plan.ConsensusGenesis = rawGenesis
	f.plan.ConsensusGenesisSHA256 = pins.CometGenesisSHA256
	f.plan.OriginalGenesisHash = m.OriginalGenesisHash
	f.plan.MigrationStateHash = m.StateHash
	plan, pin := productionOperatorPlanBytes(t, f.plan)
	if len(plan) > MaxProductionOperatorPlanBytes {
		t.Fatal("normal operator plan exceeded original 96 MiB bound")
	}
	root := filepath.Join(t.TempDir(), "original-operator-package")
	if _, err = GenerateProductionCandidatePackageWithOperator(m, f.validators, root, f.genesisTime, plan, pin); err != nil {
		t.Fatal("normal bounded package rejected complete source", err)
	}
	// The normal package generator already invokes its full verifier. Re-read
	// the exact public source file, not a short projection or manifest body.
	sidecar, err := os.ReadFile(filepath.Join(root, "common", "bound-migration.json"))
	if err != nil || len(sidecar) != sourceBytes+1 || sidecar[len(sidecar)-1] != '\n' || sha256.Sum256(sidecar[:len(sidecar)-1]) != sourceDigest {
		t.Fatal("normal package altered/dropped original migration", err)
	}
	sidecar = nil
	path := filepath.Join(t.TempDir(), "original-state.json")
	a, err := NewPersistentApplicationWithBootstrap(m, path, b)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &validatorRegistryFixture{migration: m, doc: doc, raw: rawGenesis, pins: pins, bootstrap: b}
	req := fixture.initRequest(t)
	init, err := a.InitChain(context.Background(), req)
	if err != nil || hex.EncodeToString(init.AppHash) != m.StateHash {
		t.Fatal("reference InitChain changed original state hash", err)
	}
	// The actual pinned representation may not be replaced by even a different
	// internally well-formed manifest after constructor validation.
	bad := *req
	bad.AppStateBytes = bytes.Replace(req.AppStateBytes, []byte(ref.MigrationCanonicalSHA256), []byte(strings.Repeat("a", 64)), 1)
	if _, err = a.InitChain(context.Background(), &bad); err == nil {
		t.Fatal("InitChain accepted a reference changed after bootstrap")
	}
	if _, err = a.FinalizeBlock(context.Background(), &abci.RequestFinalizeBlock{Height: doc.InitialHeight, NextValidatorsHash: bytes.Clone(b.validatorSetHash)}); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
		t.Fatal(err)
	}
	before := migrationHistoryRead(t, a, MigrationHistoryTransactionPath+historyHash)
	height, appHash := a.committed.Height, a.committed.AppHash
	a = nil
	cold, err := NewPersistentApplicationWithBootstrap(m, path, b)
	if err != nil {
		t.Fatal("normal cold recovery rejected complete source", err)
	}
	if cold.committed.Height != height || cold.committed.AppHash != appHash || !bytes.Equal(before, migrationHistoryRead(t, cold, MigrationHistoryTransactionPath+historyHash)) {
		t.Fatal("cold source history/height/AppHash changed")
	}
	var view MigrationHistoryTransactionView
	if err = json.Unmarshal(before, &view); err != nil || !view.Found || view.Transaction == nil {
		t.Fatal("actual original transaction was not queryable", err)
	}
	original, found := sourceHistoryTransaction(m, historyHash)
	if !found || !reflect.DeepEqual(*view.Transaction, original) || view.OriginalGenesisHash != m.OriginalGenesisHash || view.SourceAnchor != m.StateHash {
		t.Fatal("history was relabeled or lost original bytes/identity")
	}
	t.Logf("COMET_MIGRATION_REFERENCE_LARGE_CANONICAL_RECOVERY_PASS scope=DATA noActivation=true canonicalBytes=%d genesisBytes=%d planBytes=%d fullSidecar=true originalHistory=true nodeStarted=false", sourceBytes, len(rawGenesis), len(plan))
}
