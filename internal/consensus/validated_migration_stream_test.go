package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

func validatedMigrationReferenceBootstrap(t *testing.T, f *validatorRegistryFixture, canonical []byte) *ConsensusBootstrap {
	t.Helper()
	doc := *f.doc
	var err error
	doc.AppState, err = json.Marshal(newCometMigrationReference(f.migration, canonical))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := cmtjson.Marshal(&doc)
	if err != nil {
		t.Fatal(err)
	}
	pins := f.pins
	pins.CometGenesisSHA256 = productionOperatorSHA(raw)
	bootstrap, err := NewConsensusBootstrap(raw, pins, f.migration)
	if err != nil || bootstrap.migrationReference == nil {
		t.Fatal("normal independent bootstrap did not bind the complete reference", err)
	}
	return bootstrap
}

func TestValidatedMigrationStreamMatchesCanonicalAndOwnsOriginal(t *testing.T) {
	for _, mode := range []string{"without-bootstrap", "embedded", "reference"} {
		t.Run(mode, func(t *testing.T) {
			f := validatedMigrationFixture(t)
			canonical, err := f.migration.CanonicalJSON()
			if err != nil {
				t.Fatal(err)
			}
			var expected chain.ConsensusMigrationState
			if err := json.Unmarshal(canonical, &expected); err != nil {
				t.Fatal(err)
			}
			var bootstrap *ConsensusBootstrap
			switch mode {
			case "embedded":
				bootstrap = f.bootstrap
			case "reference":
				bootstrap = validatedMigrationReferenceBootstrap(t, f, canonical)
			}
			checks := validatedMigrationFullChecks.Load()
			witness, err := newValidatedMigration(f.migration, bootstrap)
			if err != nil || witness == nil {
				t.Fatal("normal stream constructor failed", err)
			}
			if validatedMigrationFullChecks.Load()-checks != 1 || witness.canonicalHash != sha256.Sum256(canonical) || witness.canonicalBytes != len(canonical) || !reflect.DeepEqual(witness.migration, expected) {
				t.Fatal("stream witness changed complete validation, original canonical hash/bytes or detached typed state")
			}
			if bootstrap == nil {
				if witness.bootstrap != nil {
					t.Fatal("hashing without a bootstrap invented validator authority")
				}
			} else if !sameOwnedBootstrap(witness.bootstrap, bootstrap) {
				t.Fatal("stream constructor retained caller-owned bootstrap references")
			}
			before, err := json.Marshal(witness.migration)
			if err != nil {
				t.Fatal(err)
			}
			if f.migration.Runtime == nil || len(f.migration.Runtime.Blocks) < 2 || len(f.migration.Runtime.Blocks[1].Transactions) < 1 {
				t.Fatal("normal fixture lacks actual source transaction history")
			}
			f.migration.Runtime.Blocks[1].Transactions[0].Memo += "external-after-stream"
			for i := range f.migration.Accounts {
				for lot := range f.migration.Accounts[i].Lots {
					f.migration.Accounts[i].Lots[lot]++
					break
				}
			}
			if bootstrap != nil {
				bootstrap.appState[0] ^= 1
				bootstrap.rawGenesis[0] ^= 1
				if bootstrap.migrationReference != nil {
					bootstrap.migrationReference.MigrationHeight = "external-after-stream"
				}
			}
			after, err := json.Marshal(witness.migration)
			if err != nil || !bytes.Equal(before, after) || witness.canonicalHash != sha256.Sum256(canonical) || witness.valid() != nil {
				t.Fatal("post-constructor external aliases changed the owned witness", err)
			}
			if witness.bootstrap != nil && witness.bootstrap.matchesCanonicalMigration(witness.migration, canonical) != nil {
				t.Fatal("caller bootstrap mutation changed the detached authority binding")
			}
		})
	}
}

func TestValidatedMigrationStreamRejectsEmbeddedByteAndLengthDrift(t *testing.T) {
	f := validatedMigrationFixture(t)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	if len(canonical) < 3 || !bytes.Equal(canonical, f.bootstrap.appState) {
		t.Fatal("normal fixture must hold the exact embedded canonical document")
	}
	for _, kind := range []string{"first", "middle", "last", "empty", "shorter", "longer"} {
		t.Run(kind, func(t *testing.T) {
			bootstrap := detachValidatedBootstrap(f.bootstrap)
			switch kind {
			case "first":
				bootstrap.appState[0] ^= 1
			case "middle":
				bootstrap.appState[len(canonical)/2] ^= 1
			case "last":
				bootstrap.appState[len(canonical)-1] ^= 1
			case "empty":
				bootstrap.appState = nil
			case "shorter":
				bootstrap.appState = bootstrap.appState[:len(canonical)-1]
			case "longer":
				bootstrap.appState = append(bootstrap.appState, ' ')
			}
			if bootstrap.matchesCanonicalMigration(f.migration, canonical) == nil {
				t.Fatal("original complete byte-slice binding accepted a changed embedded original")
			}
			if witness, err := newValidatedMigration(f.migration, bootstrap); err == nil || witness != nil {
				t.Fatal("stream binding accepted a changed embedded original", err)
			}
		})
	}
	// Exercise real chunk boundaries in the shared matcher independently of
	// the canonical encoder's buffering. No hash-only shortcut may replace it.
	binding := newCanonicalMigrationStreamBinding(f.bootstrap)
	writer := validatedMigrationCanonicalWriter{digest: sha256.New(), binding: binding}
	for offset := 0; offset < len(canonical); {
		end := offset + 17
		if end > len(canonical) {
			end = len(canonical)
		}
		if n, err := writer.Write(canonical[offset:end]); err != nil || n != end-offset {
			t.Fatal("valid embedded chunk rejected", err)
		}
		offset = end
	}
	var digest [sha256.Size]byte
	copy(digest[:], writer.digest.Sum(nil))
	if writer.count != len(canonical) || digest != sha256.Sum256(canonical) || binding.matches(f.migration, digest, writer.count) != nil {
		t.Fatal("shared matcher did not retain exact full streamed bytes and count")
	}
}

func TestValidatedMigrationStreamRejectsCompleteReferenceMetadataDrift(t *testing.T) {
	f := validatedMigrationFixture(t)
	canonical, err := f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	original := validatedMigrationReferenceBootstrap(t, f, canonical)
	for index := 0; index < reflect.TypeOf(cometMigrationReference{}).NumField(); index++ {
		fieldName := reflect.TypeOf(cometMigrationReference{}).Field(index).Name
		t.Run(fieldName, func(t *testing.T) {
			bootstrap := detachValidatedBootstrap(original)
			field := reflect.ValueOf(bootstrap.migrationReference).Elem().Field(index)
			field.SetString("changed-" + field.String())
			if bootstrap.matchesCanonicalMigration(f.migration, canonical) == nil {
				t.Fatal("original complete reference matcher accepted metadata drift")
			}
			if witness, err := newValidatedMigration(f.migration, bootstrap); err == nil || witness != nil {
				t.Fatal("stream matcher accepted a changed reference field", err)
			}
		})
	}
}
