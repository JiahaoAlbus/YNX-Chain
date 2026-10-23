package consensus

import (
	"errors"
	"path/filepath"
	"regexp"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// PQCheckpointAccess is independent operator configuration. The Linux abstract
// socket grants only a read-only descriptor for the engine's ONE original App
// path. It grants no signing authority and never exposes a key or HRS file.
// Neither UID is obtained from a request or from the checkpoint body.
type PQCheckpointAccess struct {
	Address   string
	EngineUID uint32
	SignerUID uint32
	Timeout   time.Duration
}

func (a PQCheckpointAccess) Validate() error {
	if !regexp.MustCompile(`^@ynx-pq-checkpoint-[a-z0-9-]{8,64}$`).MatchString(a.Address) || a.EngineUID == 0 || a.SignerUID == 0 || a.EngineUID == a.SignerUID || a.Timeout <= 0 || a.Timeout > time.Minute {
		return errors.New("checkpoint access requires a fixed abstract endpoint, two distinct non-root UID pins and timeout in (0,1m]")
	}
	return nil
}

func checkpointAccessPath(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return errors.New("checkpoint access requires the original canonical absolute App path")
	}
	return nil
}

// This constructor preserves all original three-layout decoding, runtime,
// registry, schedule, exact H/AppHash and permanent signing high-water checks.
// Only acquisition changes; every signing request still captures fresh bytes.
func NewPQEngineCheckpointAccessSource(migration chain.ConsensusMigrationState, statePath string, bootstrap *ConsensusBootstrap, authorization *PQEngineAuthorization, runtime *RuntimeUpgradeAuthorization, access PQCheckpointAccess) (*PQEngineFileSource, error) {
	if err := access.Validate(); err != nil {
		return nil, err
	}
	if err := checkpointAccessPath(statePath); err != nil {
		return nil, err
	}
	if err := checkpointAccessClientIdentity(access); err != nil {
		return nil, err
	}
	source, err := NewPQEngineFileSourceWithRuntimeUpgrade(migration, statePath, bootstrap, authorization, runtime)
	if err != nil {
		return nil, err
	}
	source.capture = func(path string) (*pqEngineStateRead, error) { return capturePQCheckpointAccess(path, access) }
	return source, nil
}
