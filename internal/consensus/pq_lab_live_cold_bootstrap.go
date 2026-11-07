//go:build unix

package consensus

import "github.com/JiahaoAlbus/YNX-Chain/internal/chain"

// A normal live request owns only immutable public inputs. Construct its exact
// private owner at the original bootstrap key-validation boundary, retaining
// the public bootstrap's original pin-before-migration first-failure ordering.
func newPQLabLiveBootstrap(raw []byte, pins ConsensusBootstrapPins, migration chain.ConsensusMigrationState, metrics *PQLabMetrics) (*validatedMigration, error) {
	var owner *validatedMigration
	b, err := newConsensusBootstrapWithColdOwner(raw, pins, migration, nil, func(m chain.ConsensusMigrationState) (*validatedMigration, error) {
		end := pqLabMeasure(metrics, "lab.validatedMigrationOwnerBuild")
		var err error
		owner, err = newValidatedMigrationWithConsensusValidatorKeys(m)
		end()
		return owner, err
	})
	if err != nil {
		return nil, err
	}
	owner.bootstrap = b
	if err := owner.initializeMath(); err != nil {
		return nil, err
	}
	return owner, nil
}
