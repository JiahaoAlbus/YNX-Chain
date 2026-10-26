package consensus

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"hash"
	"io"
	"sync/atomic"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
)

// This separate use of the existing bounded certificate API does not alter the
// normal account batch cache's 16-entry budget. In particular, 17 independent
// initial certificates must not cyclically evict the entire previous scan.
// At most 32*(MaxCertificateBytes+4096) key bytes are retained per witness.
const initialRegistrationCertificateEntries = 32
const initialRegistrationCertificateScope = "YNX-INITIAL-REGISTRATION-CERTIFICATE-CACHE/v1"

// validatedMigration owns a detached, fully validated original migration.
// It is never persisted, exported, reconstructed from a hash, or paired with
// caller-supplied migration data. Its users must treat migration as immutable.
// Dynamic committed state, authorization and filesystem observations are NOT
// cached. The disposable initial-certificate cache below remembers only exact
// successful dual-signature mathematics, with all live history checks retained.
type validatedMigration struct {
	migration           chain.ConsensusMigrationState
	bootstrap           *ConsensusBootstrap
	canonicalHash       [32]byte
	canonicalBytes      int
	initialCertificates *ynxbatch.CertificateCache
	initialScope        []byte
	historyCertificates *chain.PQCertificateCache
	registryMath        *ynxconsensusauth.RegistrationMathCache
}

// Counts actual complete validations at this ownership boundary, not dynamic
// state/registry checks or independent bootstrap input validation. This bounded
// diagnostic supports comparisons of the public and owned fresh-load paths.
var validatedMigrationFullChecks atomic.Uint64

func newValidatedMigration(migration chain.ConsensusMigrationState, bootstrap *ConsensusBootstrap) (*validatedMigration, error) {
	validatedMigrationFullChecks.Add(1)
	// This normal chain boundary fully validates once, detaches all references,
	// and writes the exact original canonical bytes without a history-sized raw
	// slice. The witness hashes/counts only the bytes actually written.
	binding := newCanonicalMigrationStreamBinding(bootstrap)
	stream := validatedMigrationCanonicalWriter{digest: sha256.New(), binding: binding}
	detached, err := migration.WriteDetachedCanonicalJSON(&stream)
	if err != nil {
		return nil, err
	}
	var canonicalHash [sha256.Size]byte
	copy(canonicalHash[:], stream.digest.Sum(nil))
	if err := binding.matches(detached, canonicalHash, stream.count); err != nil {
		return nil, err
	}
	witness := &validatedMigration{migration: detached, bootstrap: detachValidatedBootstrap(bootstrap), canonicalHash: canonicalHash, canonicalBytes: stream.count}
	witness.historyCertificates = chain.NewPQHistoryCertificateCache()
	if witness.bootstrap != nil {
		cache, err := ynxconsensusauth.NewRegistrationMathCache(witness.bootstrap.genesisID)
		if err != nil {
			return nil, err
		}
		witness.registryMath = cache
	}
	if witness.bootstrap != nil && witness.bootstrap.record.PQInitialAccounts != nil {
		cache, err := ynxbatch.NewCertificateCache(initialRegistrationCertificateEntries)
		if err != nil {
			return nil, err
		}
		// This is a private mathematical cache namespace, not new authority or
		// a protocol/hash input. The normal constructor has already bound the
		// complete original Genesis and migration before creating this witness.
		scope := sha256.Sum256([]byte(initialRegistrationCertificateScope + "\x00" + witness.bootstrap.record.CometGenesisSHA256))
		witness.initialCertificates, witness.initialScope = cache, append([]byte(nil), scope[:]...)
	}
	return witness, nil
}

// Only the normal complete validation/detachment above can create a witness.
// This writer retains a digest and count, never the complete encoded history.
type validatedMigrationCanonicalWriter struct {
	digest  hash.Hash
	binding *canonicalMigrationStreamBinding
	count   int
}

func (w *validatedMigrationCanonicalWriter) Write(p []byte) (int, error) {
	if len(p) > int(^uint(0)>>1)-w.count {
		return 0, errors.New("canonical migration byte count overflow")
	}
	if err := w.binding.compare(p); err != nil {
		return 0, err
	}
	n, err := w.digest.Write(p)
	w.count += n
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	return n, err
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
