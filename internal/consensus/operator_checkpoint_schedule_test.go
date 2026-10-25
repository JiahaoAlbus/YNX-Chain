package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	dbm "github.com/cometbft/cometbft-db"
	cmtconsensus "github.com/cometbft/cometbft/consensus"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Use the original funded native migration, with its nonce/contract/history,
// and all four original bound members. The real Handshaker and BlockExecutor
// commit the registry; no test-supplied registry root becomes a checkpoint.
func newFourMemberInspectionHarness(t *testing.T) *engineWiringHarness {
	t.Helper()
	// The ordinary initialization fixture deliberately uses the native default
	// single validator. A four-member proposal must originate from an actual
	// four-member source, before its history, migration hash and genesis exist.
	d, err := chain.NewPersistentDevnetWithValidators(chain.DefaultNetworkConfig("testnet"), t.TempDir(), []chain.Validator{
		{Address: "ynx_validator_primary", Moniker: "ynx-primary", VotingPower: 1, Active: true},
		{Address: "ynx_validator_singapore", Moniker: "ynx-singapore", VotingPower: 1, Active: true},
		{Address: "ynx_validator_silicon_valley", Moniker: "ynx-silicon-valley", VotingPower: 1, Active: true},
		{Address: "ynx_validator_seoul", Moniker: "ynx-seoul", VotingPower: 1, Active: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	owner := mustNativeAddress(t, deterministicPrivateKey(111))
	recipient := mustNativeAddress(t, deterministicPrivateKey(112))
	if _, err := d.Faucet(owner, 1000); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	if _, err := d.Transfer(owner, recipient, 7); err != nil {
		t.Fatal(err)
	}
	contractSource, _ := boundedContractFixture(t, "SampleEVMWriteCounter")
	contract, _, err := d.DeployContractWithArgs(owner, "SampleEVMWriteCounter", contractSource, []string{"7"})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := d.ExecuteContract(owner, contract.Address, "0x7cf5dab0"+strings.Repeat("0", 63)+"5"); err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	migration, err := d.ExportConsensusMigrationState()
	if err != nil {
		t.Fatal(err)
	}
	contract, _ = d.Contract(contract.Address)
	position := accountPosition(t, migration.Accounts, owner)
	if position < 0 || migration.Accounts[position].Nonce == 0 || migration.Runtime == nil || len(migration.Runtime.Blocks) < 2 || len(contract.RuntimeStorage) == 0 {
		t.Fatal("four-member source must retain funded accounts, actual nonce, executed contract storage and history")
	}
	f := &validatorRegistryFixture{legacy: make(map[string]ed25519.PrivateKey)}
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		key := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 91)}, ed25519.SeedSize))
		public := key.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		f.legacy[string(address[:20])] = key
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	f.migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f.doc, err = BuildCometGenesis(f.migration, time.Date(2026, 10, 18, 1, 2, 3, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(f.raw)
	f.pins = ConsensusBootstrapPins{CometGenesisSHA256: hex.EncodeToString(digest[:]), OriginalGenesisHash: f.migration.OriginalGenesisHash, MigrationStateHash: f.migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, f.migration)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, key := range f.legacy {
			clear(key)
		}
	})
	if len(f.bootstrap.record.Members) != 4 {
		t.Fatal("public operator fixture needs four actual original members")
	}
	path := filepath.Join(t.TempDir(), "committed.json")
	app, err := NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	db, blocksDB := dbm.NewMemDB(), dbm.NewMemDB()
	t.Cleanup(func() { _ = db.Close(); _ = blocksDB.Close() })
	h := &engineWiringHarness{f: f, app: app, source: &engineSourceRecorder{app: app}, raw: sm.NewStore(db, sm.StoreOptions{}), blocks: blockstore.NewBlockStore(blocksDB), path: path}
	h.proxy = startEngineTestProxy(t, app)
	initial, err := sm.MakeGenesisState(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	initial.AppHash = nil
	if err := h.raw.Save(initial); err != nil {
		t.Fatal(err)
	}
	handshake := cmtconsensus.NewHandshaker(h.raw, initial, h.blocks, f.doc)
	handshake.SetConsensusAuthoritySource(h.source)
	if err := handshake.Handshake(h.proxy); err != nil {
		t.Fatal(err)
	}
	return h
}

func TestOperatorCheckpointScheduleCandidateAllLayoutsUsesActualRegistry(t *testing.T) {
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			f := newOperatorInspectionFixtureWithHarness(t, layout, newFourMemberInspectionHarness(t), 4)
			roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
			before := inspectionInventory(t, roots...)
			f.options.ProposePQActivationHeight = f.actual.LastBlockHeight + 6
			result, err := f.inspect()
			if err != nil || result.ScheduleCandidate == nil || result.Height != f.actual.LastBlockHeight || result.RegistryEventCount != 4 || result.CommittedScheduleHash != nil || result.NextScheduleHash != nil || result.PQActivationVerified {
				t.Fatal("actual stopped registry did not produce a candidate", result, err)
			}
			candidate := result.ScheduleCandidate
			raw, err := base64.StdEncoding.Strict().DecodeString(candidate.CanonicalScheduleBase64)
			if err != nil {
				t.Fatal(err)
			}
			expected, err := NewPQEngineSchedule(f.h.f.bootstrap, f.h.app.committed.ValidatorRegistry, f.actual.LastBlockHeight, f.options.ProposePQActivationHeight)
			if err != nil {
				t.Fatal(err)
			}
			expectedRaw, err := json.Marshal(expected)
			if err != nil {
				t.Fatal(err)
			}
			expectedHash, err := expected.Hash()
			if err != nil {
				t.Fatal(err)
			}
			digest := sha256.Sum256(raw)
			if !bytes.Equal(raw, expectedRaw) || candidate.Version != "YNX-PQ-ENGINE-SCHEDULE-CANDIDATE/v1" || candidate.ScheduleHash != expectedHash || candidate.CanonicalScheduleSHA256 != hex.EncodeToString(digest[:]) || !candidate.CandidateOnly || candidate.AuthorizationGranted || expected.RegistryHeight != result.Height || expected.RegistryRoot != result.RegistryRoot || expected.RegistryEventCount != result.RegistryEventCount || expected.ParamsUpdateHeight != result.Height+1 || expected.ValidatorUpdateHeight != expected.ActivationHeight-2 {
				t.Fatal("candidate diverged from original canonical schedule or granted authority", candidate)
			}
			f.options.ProposePQActivationHeight = 0
			plain, err := f.inspect()
			if err != nil || plain.ScheduleCandidate != nil {
				t.Fatal("proposal was installed or changed default observation", plain, err)
			}
			plainRaw, err := json.Marshal(plain)
			if err != nil || bytes.Contains(plainRaw, []byte("scheduleCandidate")) {
				t.Fatal("default v1 result gained a non-omitted proposal", err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
				t.Fatal("candidate creation modified original checkpoint, keys, locks or history")
			}
		})
	}
}

func TestOperatorCheckpointScheduleRejectsIncompleteAndConflictingSources(t *testing.T) {
	for _, kind := range []string{"two-original-members", "three-registrations", "next-authorization", "negative-height", "too-early", "overflow", "last-height-overflow"} {
		t.Run(kind, func(t *testing.T) {
			var f *operatorInspectionFixture
			if kind == "two-original-members" {
				f = newOperatorInspectionFixture(t, "atomic-json")
			} else {
				count := 4
				if kind == "three-registrations" {
					count = 3
				}
				f = newOperatorInspectionFixtureWithHarness(t, "atomic-json", newFourMemberInspectionHarness(t), count)
			}
			f.options.ProposePQActivationHeight = f.actual.LastBlockHeight + 4
			switch kind {
			case "next-authorization":
				f.options.NextAuthorization = f.next
			case "negative-height":
				f.options.ProposePQActivationHeight = -1
			case "too-early":
				f.options.ProposePQActivationHeight--
			case "overflow":
				f.options.ProposePQActivationHeight = math.MaxInt64
			case "last-height-overflow":
				f.options.ProposePQActivationHeight = math.MaxInt64 - 1
			}
			backupDirectory := t.TempDir()
			f.options.BackupOutput = filepath.Join(backupDirectory, "must-not-be-created.tar.gz")
			roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory), backupDirectory}
			before := inspectionInventory(t, roots...)
			if result, err := f.inspect(); err == nil || result.ScheduleCandidate != nil {
				t.Fatal("unsafe schedule proposal accepted", kind, result, err)
			}
			if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
				t.Fatal("rejected proposal changed original material")
			}
		})
	}
}

func TestOperatorCheckpointScheduleRejectsRevokedMemberAndNonactualHeight(t *testing.T) {
	f := newOperatorInspectionFixtureWithHarness(t, "atomic-json", newFourMemberInspectionHarness(t), 4)
	// These guards use the healthy registry, so a revoked member cannot hide a
	// missing checkpoint/initialization check in the proposal boundary.
	for _, kind := range []string{"wrong-actual-height", "not-initialized", "overflowing-actual-height"} {
		t.Run(kind, func(t *testing.T) {
			state := f.h.app.committed
			actual, activation := state.Height, state.Height+4
			switch kind {
			case "wrong-actual-height":
				actual++
				activation++
			case "not-initialized":
				state.Initialized = false
			case "overflowing-actual-height":
				state.Height, actual, activation = math.MaxInt64-3, math.MaxInt64-3, math.MaxInt64-2
			}
			before := mustJSON(t, state)
			if result, err := proposeOperatorCheckpointSchedule(f.h.f.bootstrap, state, actual, activation); err == nil || result != nil {
				t.Fatal("nonactual checkpoint accepted", kind, result, err)
			}
			if !bytes.Equal(before, mustJSON(t, state)) {
				t.Fatal("structural rejection changed original state")
			}
		})
	}
	// Move to the original registered epoch's effective height, then commit a
	// real dual-authorized revocation through the real BlockExecutor.
	database, err := dbm.NewGoLevelDB("state", f.options.CometDataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	f.h.raw = sm.NewStore(database, sm.StoreOptions{})
	f.actual = f.h.apply(t, nil)
	f.actual = f.h.apply(t, nil)
	approved := f.actual.LastBlockHeight + 1
	revoked := appendEngineRevocation(t, f.h.f, f.h.app.committed.ValidatorRegistry, f.h.keys[0], approved, approved+2)
	tx, err := EncodeValidatorRegistryTransaction(revoked.Events[len(revoked.Events)-1].Wire)
	if err != nil {
		t.Fatal(err)
	}
	f.actual = f.h.apply(t, cmttypes.Txs{tx})
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(revoked, f.h.app.committed.ValidatorRegistry) {
		t.Fatal("revocation was not actually committed by the application")
	}
	f.options.ProposePQActivationHeight = f.actual.LastBlockHeight + 4
	roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
	before := inspectionInventory(t, roots...)
	if result, err := f.inspect(); err == nil || result.ScheduleCandidate != nil {
		t.Fatal("revoked original member received a public activation candidate", result, err)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
		t.Fatal("revoked proposal changed original source")
	}
}

func TestOperatorCheckpointScheduleRejectsActuallyCommittedSchedule(t *testing.T) {
	f := newOperatorInspectionFixtureWithHarness(t, "atomic-json", newFourMemberInspectionHarness(t), 4)
	database, err := dbm.NewGoLevelDB("state", f.options.CometDataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	f.h.raw = sm.NewStore(database, sm.StoreOptions{})
	_ = f.h.proxy.Stop()
	app, err := NewPersistentApplicationWithEngineAuthorization(f.h.f.migration, f.h.path, f.h.f.bootstrap, f.next)
	if err != nil {
		t.Fatal(err)
	}
	f.h.app, f.h.source.app = app, app
	f.h.proxy = startEngineTestProxy(t, app)
	f.actual = f.h.apply(t, nil)
	if app.committed.PQEngineSchedule == nil || app.committed.Height != f.next.schedule.AuthorizedAt {
		t.Fatal("normal authorized P block did not commit the existing schedule")
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	// This fixture has no running signer. Supply its existing original PQ lock
	// explicitly; an unused legacy writer lock must never prove exclusion.
	if err := os.WriteFile(f.options.SigningStatePath+".lock", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	f.options.Authorization, f.options.SigningLockKind = f.next, "pq-signer"
	plain, err := f.inspect()
	if err != nil || plain.CommittedScheduleHash == nil || *plain.CommittedScheduleHash != f.next.hash {
		t.Fatal("actually committed scheduled fixture was not independently verified", plain, err)
	}
	roots := []string{filepath.Dir(f.h.path), filepath.Dir(f.options.SigningStatePath), filepath.Dir(f.options.CometDataDirectory)}
	before := inspectionInventory(t, roots...)
	f.options.ProposePQActivationHeight = f.actual.LastBlockHeight + 4
	if result, err := f.inspect(); err == nil || result.ScheduleCandidate != nil {
		t.Fatal("existing committed schedule was replaced by a new candidate", result, err)
	}
	if !reflect.DeepEqual(before, inspectionInventory(t, roots...)) {
		t.Fatal("existing-schedule rejection changed original source")
	}
}
