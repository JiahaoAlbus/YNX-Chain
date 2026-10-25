package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// validatedMigration owns a detached, fully validated original migration.
// It is never persisted, exported, reconstructed from a hash, or paired with
// caller-supplied migration data. Its users must treat migration as immutable.
// Dynamic committed state, signatures and filesystem observations are NOT cached.
type validatedMigration struct {
	migration      chain.ConsensusMigrationState
	bootstrap      *ConsensusBootstrap
	canonicalHash  [32]byte
	canonicalBytes int
}

// Counts actual complete validations at this ownership boundary, not dynamic
// state/registry checks or independent bootstrap input validation. This bounded
// diagnostic supports comparisons of the public and owned fresh-load paths.
var validatedMigrationFullChecks atomic.Uint64

func newValidatedMigration(migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap) (*validatedMigration, error) {
	validatedMigrationFullChecks.Add(1)
	// CanonicalJSON performs the complete migration validation, including its
	// complete original history and StateHash, before encoding any witness.
	raw, err := migration.CanonicalJSON()
	if err != nil {
		return nil, err
	}
	var detached chain.ConsensusMigrationState
	if err := json.Unmarshal(raw, &detached); err != nil {
		return nil, err
	}
	if bootstrap != nil {
		if err := bootstrap.matchesCanonicalMigration(detached, raw); err != nil {
			return nil, err
		}
	}
	return &validatedMigration{migration: detached, bootstrap: detachValidatedBootstrap(bootstrap), canonicalHash: sha256.Sum256(raw), canonicalBytes: len(raw)}, nil
}

// Copy the complete already independently validated object, then detach every
// reference-bearing field. This does not reconstruct authority from its public
// record: the normal constructor and full original migration binding above
// remain mandatory. In particular, external '*bootstrap = *other' cannot change
// an existing owner or any snapshot that owner has previously issued.
func detachValidatedBootstrap(original *ConsensusBootstrap) *ConsensusBootstrap {
	if original == nil {
		return nil
	}
	owned := *original
	owned.record = cloneValidatorBootstrapRecord(original.record)
	owned.rawGenesis = bytes.Clone(original.rawGenesis)
	owned.appState = bytes.Clone(original.appState)
	owned.genesisID = bytes.Clone(original.genesisID)
	owned.validatorSetHash = bytes.Clone(original.validatorSetHash)
	if original.migrationReference != nil {
		reference := *original.migrationReference
		owned.migrationReference = &reference
	}
	owned.members = make(map[string]ValidatorBootstrapMember, len(original.members))
	for key, member := range original.members {
		member.Address, member.Ed25519 = bytes.Clone(member.Address), bytes.Clone(member.Ed25519)
		owned.members[key] = member
	}
	return &owned
}

func (m *validatedMigration) valid() error {
	if m == nil || m.canonicalBytes == 0 || m.canonicalHash == ([32]byte{}) {
		return errors.New("missing privately validated migration")
	}
	return nil
}

func (m *validatedMigration) binds(bootstrap *ConsensusBootstrap) error {
	if err := m.valid(); err != nil {
		return err
	}
	// ConsensusBootstrap is itself immutable and was independently bound to
	// the complete canonical input above. A recovered record cannot replace it.
	if m.bootstrap != bootstrap {
		return errors.New("validated migration bootstrap identity changed")
	}
	return nil
}

func (*validatedMigration) MarshalJSON() ([]byte, error) {
	return nil, errors.New("validated migration witness is not serializable")
}

func (m *validatedMigration) UnmarshalJSON([]byte) error {
	*m = validatedMigration{}
	return errors.New("validated migration witness cannot be restored from JSON")
}
