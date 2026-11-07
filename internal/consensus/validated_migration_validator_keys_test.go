//go:build unix

package consensus

import (
	"bytes"
	"crypto/sha256"
	"reflect"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestCombinedValidatedMigrationPrivateOwnerMatchesTwoPassBoundary(t *testing.T) {
	s, err := NewPQLabWorkloadSource(PQLabWorkloadOptions{Owners: 2, Transfers: 1, BatchSize: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Destroy()
	f := pqLabBoundFixture(t, s.Migration)
	if err := f.migration.ValidateConsensusValidatorKeys(); err != nil {
		t.Fatal(err)
	}
	old, err := newValidatedMigration(f.migration, nil)
	if err != nil {
		t.Fatal(err)
	}
	w, err := newValidatedMigrationWithConsensusValidatorKeys(f.migration)
	if err != nil {
		t.Fatal(err)
	}
	if w.validatedSelf != w || w.bootstrapKeysValidated != w || w.bootstrap != nil || old.canonicalHash != w.canonicalHash || old.canonicalBytes != w.canonicalBytes || !reflect.DeepEqual(old.migration, w.migration) {
		t.Fatal("combined operation did not produce the exact private detached owner")
	}
	if _, err := newValidatedMigrationWithConsensusValidatorKeys(s.Migration); err == nil {
		t.Fatal("generic-valid unbound source became a bootstrap capability")
	}
	if _, err := w.MarshalJSON(); err == nil {
		t.Fatal("private owner became serializable")
	}
	copied := *w
	if _, err := newConsensusBootstrap(f.raw, f.pins, f.migration, &copied); err == nil {
		t.Fatal("copied private owner acquired constructor identity")
	}
	hashOnly := &validatedMigration{migration: w.migration, canonicalHash: w.canonicalHash, canonicalBytes: w.canonicalBytes}
	if _, err := newConsensusBootstrap(f.raw, f.pins, f.migration, hashOnly); err == nil {
		t.Fatal("hash-only record acquired bootstrap authority")
	}
	// The new constructor must detach from f.migration before it can be sealed.
	f.migration.Accounts[0].Nonce++
	if reflect.DeepEqual(f.migration.Accounts, w.migration.Accounts) {
		t.Fatal("original caller mutation reached private owner")
	}
	b, err := newConsensusBootstrap(f.raw, f.pins, chain.ConsensusMigrationState{}, w)
	if err != nil {
		t.Fatal("bootstrap did not consume its own exact migration", err)
	}
	canonical, err := w.migration.CanonicalJSON()
	if err != nil || sha256.Sum256(canonical) != w.canonicalHash || len(canonical) != w.canonicalBytes || !bytes.Equal(old.canonicalHash[:], w.canonicalHash[:]) || b.record.MigrationStateHash != w.migration.StateHash {
		t.Fatal("combined owner changed original canonical binding", err)
	}
}
