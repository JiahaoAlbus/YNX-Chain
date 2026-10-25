package consensus

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	abci "github.com/cometbft/cometbft/abci/types"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func sameOwnedBootstrap(owned, original *ConsensusBootstrap) bool {
	return owned != nil && original != nil && owned != original && reflect.DeepEqual(*owned, *original)
}

func TestValidatedMigrationPublicBootstrapReplacementCannotChangeIssuedAuthority(t *testing.T) {
	r := newPQReadFixture(t, "atomic-json")
	source, err := NewPQEngineFileSource(r.f.migration, r.path, r.f.bootstrap, r.auth)
	if err != nil {
		t.Fatal(err)
	}
	if !sameOwnedBootstrap(r.app.bootstrap, r.f.bootstrap) || !sameOwnedBootstrap(source.bootstrap, r.f.bootstrap) || source.bootstrap == r.app.bootstrap {
		t.Fatal("normal App/FileSource retained external mutable bootstrap identity")
	}
	local, err := r.app.CommittedPQEngineSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	hash, _ := hex.DecodeString(r.app.committed.AppHash)
	issued, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, hash)
	if err != nil {
		t.Fatal(err)
	}
	oldRoot := local.history.Root()
	oldBootstrap := detachValidatedBootstrap(local.bootstrap)
	other := validatedMigrationFixture(t)
	// This assignment is legal from an external Go package even though all
	// Bootstrap fields are private. It must not mutate any owning consumer.
	*r.f.bootstrap = *other.bootstrap
	if !reflect.DeepEqual(local.bootstrap, oldBootstrap) || local.history.Root() != oldRoot {
		t.Fatal("replacement mutated previously issued local authority")
	}
	if !reflect.DeepEqual(issued.(*PQEngineSnapshot).bootstrap, oldBootstrap) {
		t.Fatal("replacement mutated previously issued signing authority")
	}
	fresh, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, hash)
	if err != nil || !reflect.DeepEqual(fresh.(*PQEngineSnapshot).bootstrap, oldBootstrap) {
		t.Fatal("external replacement changed fresh owned source", err)
	}
	if _, err = LoadPQEngineSnapshot(r.f.migration, r.path, r.f.bootstrap, r.auth, r.app.committed.Height, hash); err == nil {
		t.Fatal("public loader accepted replacement bootstrap for original migration")
	}
	if err = r.app.committed.validateOwned(source.validatedMigration); err == nil {
		t.Fatal("different owner witness was paired with application bootstrap")
	}
	// Continue the genuine registry through rotation and revocation using its
	// original independently bound membership, then re-read with the SAME source.
	r.f.bootstrap = r.app.bootstrap
	for r.app.committed.Height < r.schedule.ActivationHeight {
		r.commit(t)
	}
	first, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, mustHash(t, r.app.committed.AppHash))
	if err != nil {
		t.Fatal(err)
	}
	binding, err := first.(*PQEngineSnapshot).history.PublicKeyBindingAt(r.f.doc.ChainID, r.keys[0].address, r.app.committed.Height)
	if err != nil {
		t.Fatal(err)
	}
	rotated, _ := engineRegistration(t, r.f, 0, r.app.committed.Height+1)
	r.commit(t, pqReadSuccessor(t, r, r.keys[0], &rotated))
	r.commit(t)
	r.commit(t)
	rotatedSnapshot, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, mustHash(t, r.app.committed.AppHash))
	if err != nil {
		t.Fatal(err)
	}
	if rotatedSnapshot.(*PQEngineSnapshot).AuthorizeConsensusKey(binding, r.app.committed.Height, 0, ynxpq.Precommit) == nil {
		t.Fatal("cached migration bypassed current rotation")
	}
	nextBinding, err := rotatedSnapshot.(*PQEngineSnapshot).history.PublicKeyBindingAt(r.f.doc.ChainID, rotated.address, r.app.committed.Height)
	if err != nil {
		t.Fatal(err)
	}
	r.commit(t, pqReadSuccessor(t, r, rotated, nil))
	r.commit(t)
	r.commit(t)
	current, err := source.ConsensusAuthorityForSigning(r.f.doc.ChainID, r.app.committed.Height, mustHash(t, r.app.committed.AppHash))
	if err != nil {
		t.Fatal(err)
	}
	if current.(*PQEngineSnapshot).AuthorizeConsensusKey(nextBinding, r.app.committed.Height, 0, ynxpq.Precommit) == nil {
		t.Fatal("cached migration bypassed current revocation")
	}
}

// Two real source Faucet transactions, complete blocks/lots/accounts, and
// original full Ed25519 membership; no invented history or padded JSON.
func validatedMigrationFixture(t *testing.T) *validatorRegistryFixture {
	t.Helper()
	migration, _ := journalFixture(t)
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, v := range migration.Validators {
		private := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{byte(i + 71)}, ed25519.SeedSize))
		public := private.Public().(ed25519.PublicKey)
		address := sha256.Sum256(public)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: v.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(public), ConsensusAddress: strings.ToUpper(hex.EncodeToString(address[:20]))})
	}
	var err error
	migration, err = migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		t.Fatal(err)
	}
	f := &validatorRegistryFixture{migration: migration}
	f.doc, err = BuildCometGenesis(migration, time.Unix(1802736000, 0).UTC())
	if err != nil {
		t.Fatal(err)
	}
	f.raw, err = cmtjson.Marshal(f.doc)
	if err != nil {
		t.Fatal(err)
	}
	f.pins = ConsensusBootstrapPins{productionOperatorSHA(f.raw), migration.OriginalGenesisHash, migration.StateHash}
	f.bootstrap, err = NewConsensusBootstrap(f.raw, f.pins, migration)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func TestValidatedMigrationOwnsCompleteHistoryAndCannotBeRecoveredFromJSON(t *testing.T) {
	f := validatedMigrationFixture(t)
	app, err := NewPersistentApplicationWithBootstrap(f.migration, "", f.bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	witness := app.validatedMigration
	original, err := json.Marshal(witness.migration)
	if err != nil {
		t.Fatal(err)
	}
	if f.migration.Runtime == nil || len(f.migration.Runtime.Blocks) < 2 || len(f.migration.Runtime.Blocks[1].Transactions) != 2 {
		t.Fatal("missing actual original history")
	}
	// Retain the same claimed StateHash and all current account values while
	// changing a historical transaction in an externally held alias.
	f.migration.Runtime.Blocks[1].Transactions[0].Memo += "-changed-external-history"
	if f.migration.StateHash != witness.migration.StateHash {
		t.Fatal("negative changed the claimed anchor")
	}
	if _, err := newValidatedMigration(f.migration, f.bootstrap); err == nil {
		t.Fatal("same claimed StateHash authorized changed complete history")
	}
	if err := app.committed.Validate(f.migration); err == nil {
		t.Fatal("public validation reused a different input's witness")
	}
	for i := range f.migration.Accounts {
		if len(f.migration.Accounts[i].Lots) > 0 {
			for id, amount := range f.migration.Accounts[i].Lots {
				f.migration.Accounts[i].Lots[id] = amount + 1
				break
			}
			break
		}
	}
	f.migration.Validators[0].VotingPower++
	after, err := json.Marshal(witness.migration)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("external history/accounts/lots/membership aliases mutated owned migration", err)
	}
	if err := app.committed.validateOwned(witness); err != nil {
		t.Fatal("original owned anchor changed", err)
	}
	// Application outputs must not alias original anchor maps either.
	for i := range app.committed.Accounts {
		for id := range app.committed.Accounts[i].Lots {
			app.committed.Accounts[i].Lots[id]++
			break
		}
	}
	after, err = json.Marshal(witness.migration)
	if err != nil || !bytes.Equal(original, after) {
		t.Fatal("projected mutable state aliases original migration", err)
	}
	if _, err := json.Marshal(witness); err == nil {
		t.Fatal("private witness was serialized")
	}
	copy := *witness
	if err := json.Unmarshal([]byte(`{}`), &copy); err == nil || copy.valid() == nil {
		t.Fatal("JSON preserved/restored a copied validation witness")
	}
	if witness.valid() != nil {
		t.Fatal("clearing a copied witness changed the original")
	}
	var decoded Application
	if err := json.Unmarshal([]byte(`{"validatedMigration":{"canonicalBytes":1},"migration":{}}`), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.validatedMigration != nil {
		t.Fatal("JSON injected an application migration witness")
	}
	if _, err := newPersistentApplicationOwned(decoded.validatedMigration, "", nil, nil); err == nil {
		t.Fatal("JSON-created application acquired cached validation")
	}
	other := *f.bootstrap
	if err := witness.binds(&other); err == nil {
		t.Fatal("copied bootstrap pointer substituted the constructor-bound identity")
	}
}

// Both paths use actual fresh on-disk acquisition. Public calls receive an
// external migration and must validate it; the owned path reuses only its
// immutable anchor. All state/registry/schedule and exact H/hash checks remain.
func measureValidatedMigrationFreshRead(t *testing.T, label string, migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap, path string, committed CommittedState, witness *validatedMigration) {
	t.Helper()
	hash, err := hex.DecodeString(committed.AppHash)
	if err != nil {
		t.Fatal(err)
	}
	before := pqReadInventory(t, path)
	checks := validatedMigrationFullChecks.Load()
	start := time.Now()
	public, err := LoadPQEngineSnapshot(migration, path, bootstrap, nil, committed.Height, hash)
	publicTime, publicChecks := time.Since(start), validatedMigrationFullChecks.Load()-checks
	if err != nil || public == nil || publicChecks != 1 {
		t.Fatal("public fresh load did not fully validate exact external input", err, publicChecks)
	}
	checks = validatedMigrationFullChecks.Load()
	start = time.Now()
	owned, err := loadPQEngineSnapshotOwned(witness, path, nil, nil, committed.Height, hash, capturePQEngineState)
	ownedTime, ownedChecks := time.Since(start), validatedMigrationFullChecks.Load()-checks
	if err != nil || owned == nil || ownedChecks != 0 || owned.through != public.through || owned.history.Root() != public.history.Root() || owned.history.EventCount() != public.history.EventCount() || !reflect.DeepEqual(owned.registry, public.registry) || !reflect.DeepEqual(owned.schedule, public.schedule) {
		t.Fatal("owned fresh load changed state or rescanned original migration", err, ownedChecks)
	}
	if !reflect.DeepEqual(before, pqReadInventory(t, path)) {
		t.Fatal("fresh read changed original source/locks")
	}
	t.Logf("VALIDATED_MIGRATION_FRESH_READ scope=DATA layout=%s canonicalBytes=%d publicFullValidations=%d ownedFullValidations=%d publicNs=%d ownedNs=%d nodeStarted=false", label, witness.canonicalBytes, publicChecks, ownedChecks, publicTime.Nanoseconds(), ownedTime.Nanoseconds())
}

func TestValidatedMigrationActualThreeLayoutsFreshReadAndCommit(t *testing.T) {
	f := validatedMigrationFixture(t)
	for _, layout := range []string{"atomic-json", "snapshot-journal", "block-journal"} {
		t.Run(layout, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "original-state")
			var app *Application
			var err error
			switch layout {
			case "snapshot-journal":
				app, err = NewJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
			case "block-journal":
				app, err = NewBlockJournaledApplicationWithBootstrap(f.migration, path, f.bootstrap)
			default:
				app, err = NewPersistentApplicationWithBootstrap(f.migration, path, f.bootstrap)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err = app.InitChain(context.Background(), f.initRequest(t)); err != nil {
				t.Fatal(err)
			}
			beforeChecks := validatedMigrationFullChecks.Load()
			request := &abci.RequestFinalizeBlock{Height: f.doc.InitialHeight, Time: f.doc.GenesisTime, NextValidatorsHash: bytes.Clone(f.bootstrap.validatorSetHash), Txs: [][]byte{journalTransfer(t, 1)}}
			response, err := app.FinalizeBlock(context.Background(), request)
			if err != nil || len(response.TxResults) != 1 || response.TxResults[0].Code != 0 {
				t.Fatal("real transfer failed", err)
			}
			if _, err = app.Commit(context.Background(), &abci.RequestCommit{}); err != nil {
				t.Fatal(err)
			}
			if got := validatedMigrationFullChecks.Load() - beforeChecks; got != 0 {
				t.Fatal("Finalize/Commit rescanned original history", got)
			}
			if err := app.committed.Validate(f.migration); err != nil {
				t.Fatal("public full state validator disagrees", err)
			}
			measureValidatedMigrationFreshRead(t, layout, f.migration, f.bootstrap, path, app.committed, app.validatedMigration)
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			bad := bytes.Clone(original)
			if layout == "atomic-json" {
				bad = bytes.TrimSpace(bad)
			}
			bad = bad[:len(bad)-1]
			if err = os.WriteFile(path, bad, 0600); err != nil {
				t.Fatal(err)
			}
			hash, _ := hex.DecodeString(app.committed.AppHash)
			if _, err = loadPQEngineSnapshotOwned(app.validatedMigration, path, nil, nil, app.committed.Height, hash, capturePQEngineState); err == nil {
				t.Fatal("cached migration hid current-file corruption")
			}
			if after, err := os.ReadFile(path); err != nil || !bytes.Equal(after, bad) {
				t.Fatal("failed read repaired source", err)
			}
			if err = os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			// Exercise the real capture's final identity check, not a cached
			// state. An FD-provider failure must likewise survive wrapper reuse.
			capture := func(path string) (*pqEngineStateRead, error) {
				read, err := capturePQEngineState(path)
				if err != nil {
					return nil, err
				}
				read.checkOriginal = func() error { return errors.New("original FD/inode changed") }
				return read, nil
			}
			if _, err = loadPQEngineSnapshotOwned(app.validatedMigration, path, nil, nil, app.committed.Height, hash, capture); err == nil {
				t.Fatal("owned witness bypassed final source identity failure")
			}
			if _, err = loadPQEngineSnapshotOwned(app.validatedMigration, path, nil, nil, app.committed.Height+1, hash, capturePQEngineState); err == nil {
				t.Fatal("owned witness authorized a future engine height")
			}
			if _, err = loadPQEngineSnapshotOwned(app.validatedMigration, path, nil, nil, app.committed.Height, bytes.Repeat([]byte{9}, 32), capturePQEngineState); err == nil {
				t.Fatal("owned witness authorized a different engine AppHash")
			}
		})
	}
}
