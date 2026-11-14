package consensus

import (
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// PQEngineBootstrapPreparation retains one fully checked, detached original
// migration and its independently pinned bootstrap for a single caller load.
// It is not serializable authority, a peer/source assertion or a global cache.
// Committed state, schedule/runtime authorization and proof signatures remain
// checked by the normal file source and verifier on every original operation.
type PQEngineBootstrapPreparation struct {
	self  *PQEngineBootstrapPreparation
	owner *validatedMigration
}

// PreparePQEngineBootstrap uses the existing complete cold-owner boundary.
// Pin checks precede validation of the original migration. In particular the
// original migration, not its normalized detached copy, still participates in
// the embedded/reference Genesis comparisons and their first-failure order.
func PreparePQEngineBootstrap(rawGenesis []byte, pins ConsensusBootstrapPins, migration chain.ConsensusMigrationState) (*PQEngineBootstrapPreparation, error) {
	var owner *validatedMigration
	bootstrap, err := newConsensusBootstrapWithColdOwner(rawGenesis, pins, migration, nil, func(original chain.ConsensusMigrationState) (*validatedMigration, error) {
		var err error
		owner, err = newValidatedMigrationWithConsensusValidatorKeys(original)
		return owner, err
	})
	if err != nil {
		return nil, err
	}
	owner.bootstrap = bootstrap
	if err := owner.initializeMath(); err != nil {
		return nil, err
	}
	prepared := &PQEngineBootstrapPreparation{owner: owner}
	prepared.self = prepared
	return prepared, nil
}

func (p *PQEngineBootstrapPreparation) valid() error {
	if p == nil || p.self != p || p.owner == nil || p.owner.validatedSelf != p.owner || p.owner.bootstrapKeysValidated != p.owner || p.owner.bootstrap == nil {
		return errors.New("missing original engine bootstrap preparation")
	}
	return p.owner.valid()
}

// Bootstrap returns a detached immutable view for the existing independently
// pinned runtime-plan constructor. Assigning through the exported pointer must
// not change the original private preparation or any file source it creates.
func (p *PQEngineBootstrapPreparation) Bootstrap() (*ConsensusBootstrap, error) {
	if err := p.valid(); err != nil {
		return nil, err
	}
	return detachValidatedBootstrap(p.owner.bootstrap), nil
}

// FileSource never accepts caller-supplied migration bytes or a validation bit.
// Only the exact private owner prepared above replaces redundant static work;
// the normal current-file capture, full validation, H/AppHash comparisons and
// independent runtime/schedule checks remain in their existing callees.
func (p *PQEngineBootstrapPreparation) FileSource(statePath string, pq *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization) (*PQEngineFileSource, error) {
	if err := p.valid(); err != nil {
		return nil, err
	}
	source, err := newPQEngineFileSourceOwned(p.owner, statePath, pq)
	if err != nil {
		return nil, err
	}
	return bindPQEngineFileSourceRuntime(source, runtime)
}
