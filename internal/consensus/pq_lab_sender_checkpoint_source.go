//go:build unix

package consensus

import (
	"errors"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// PQLabSenderCheckpointSource owns the original public inputs for ONE normal
// sender invocation. It never owns keys, a nonce, an approved operation or a
// current account policy. Load and every issued checkpoint's current check
// still capture the four actual committed files. Close invalidates all issued
// checkpoints and joins any active read before closing its original files.
type PQLabSenderCheckpointSource struct {
	mu                       sync.Mutex
	inputs                   *pqLabLiveMaterialsInputs
	cache                    *PQLabStaticCache
	activation               *pqLabLiveUncachedReads
	root, pin, activationPin string
	closed                   bool
	closeErr                 error
}

func NewPQLabSenderCheckpointSource() *PQLabSenderCheckpointSource {
	return &PQLabSenderCheckpointSource{cache: NewPQLabStaticCache()}
}

func (s *PQLabSenderCheckpointSource) CacheStats() PQLabStaticCacheStats {
	if s == nil {
		return (*PQLabStaticCache)(nil).Stats()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cache.Stats()
}

func (s *PQLabSenderCheckpointSource) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closeLocked()
}

func (s *PQLabSenderCheckpointSource) closeLocked() error {
	if s.closed {
		return s.closeErr
	}
	s.closed = true
	if s.inputs != nil {
		s.closeErr = s.inputs.close()
	} else {
		s.closeErr = s.cache.Close()
	}
	if s.activation != nil {
		s.closeErr = errors.Join(s.closeErr, s.activation.close())
	}
	return s.closeErr
}

// Load performs the original bootstrap/migration validation on the first
// actual command, inside checkpoint.loadTotal (never hidden in READY/warmup).
// The existing per-file full-input limits apply. Only after complete validation
// may a small input set enter the unchanged 32 MiB / 16-file cache. Larger
// inputs remain operation-owned held originals, not an enlarged cache. This
// avoids rereading the input after an optional cache-admission refusal.
func (s *PQLabSenderCheckpointSource) Load(root, pin, activationPin string, height int64, appHash string, metrics *PQLabMetrics) (*PQLabSenderCheckpoint, error) {
	defer pqLabMeasure(metrics, "checkpoint.loadTotal")()
	if s == nil {
		return nil, errors.New("missing original sender checkpoint source")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.cache == nil {
		return nil, errors.New("original sender checkpoint source closed or missing")
	}
	if s.inputs != nil && (s.root != root || s.pin != pin || s.activationPin != activationPin) {
		return nil, errors.New("original sender checkpoint source cannot change scope")
	}
	if s.inputs == nil {
		s.root, s.pin, s.activationPin = root, pin, activationPin
		s.inputs = &pqLabLiveMaterialsInputs{policy: PQLabLiveMaterialsPolicy{RootDir: root, PlanSHA256: pin}, directory: root, metrics: metrics, cache: s.cache, uncached: &pqLabLiveUncachedReads{}}
		var witness *validatedMigration
		p, _, _, err := loadPQLabObservedWithBootstrap(root, pin, metrics, s.inputs.uncached.read, func(raw []byte, pins ConsensusBootstrapPins, m chain.ConsensusMigrationState) (*ConsensusBootstrap, error) {
			var e error
			witness, e = newPQLabSenderBootstrap(raw, pins, m, metrics)
			if e != nil {
				return nil, e
			}
			return witness.bootstrap, nil
		})
		if err == nil {
			err = s.inputs.uncached.current()
		}
		if err != nil {
			return nil, errors.Join(err, s.closeLocked())
		}
		entry := &pqLabLiveStaticSnapshot{plan: p, witness: witness, uncached: s.inputs.uncached}
		s.inputs.heldStatic, s.inputs.heldStaticRoot, s.inputs.heldStaticPin = entry, root, pin
		// These descriptors and the witness were created exclusively by the
		// unchanged normal loader above. No caller-supplied digest can adopt a
		// witness. Transfer ownership only after its final full current check.
		var size int64
		for _, f := range entry.uncached.originals {
			size += int64(len(f.raw))
		}
		s.cache.mu.Lock()
		s.cache.misses++
		if size <= pqLabStaticMaxBytes && len(entry.uncached.originals) <= pqLabStaticMaxFiles {
			cached := &pqLabStaticEntry{root: root, pin: pin, plan: entry.plan, witness: entry.witness, originals: entry.uncached.originals, bytes: size, owner: s.cache, generation: s.cache.generation, cached: true}
			s.cache.entry = cached
			entry.uncached.originals = nil
			entry.uncached.closed = true
			s.inputs.uncached, s.inputs.heldStatic = nil, nil
			s.inputs.heldStaticRoot, s.inputs.heldStaticPin = "", ""
		} else {
			s.cache.bypasses++
		}
		s.cache.mu.Unlock()
	}
	s.inputs.metrics = metrics
	entry, err := s.inputs.loadStatic()
	if err != nil {
		return nil, err
	}
	if s.activation == nil {
		s.activation = &pqLabLiveUncachedReads{}
	}
	guard := func() error {
		if err := entry.current(); err != nil {
			return err
		}
		return s.activation.current()
	}
	readActivation := func(path string, maximum int64) ([]byte, error) {
		for _, original := range s.activation.originals {
			if original.path == path {
				return s.activation.read(path, maximum)
			}
		}
		count := 0
		if entry.cached != nil {
			count = len(entry.cached.originals)
		} else {
			count = len(entry.uncached.originals)
		}
		if count+len(s.activation.originals) >= pqLabStaticMaxFiles {
			return nil, errors.New("too many original sender source files")
		}
		return s.activation.read(path, maximum)
	}
	cp, err := loadPQLabSenderCheckpointOwned(entry.plan, entry.witness, activationPin, height, appHash, metrics, guard, readActivation)
	if err != nil {
		return nil, err
	}
	current := cp.current
	cp.current = func() error {
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.closed {
			return errors.New("original sender checkpoint source closed")
		}
		return current()
	}
	return cp, nil
}

// First cold construction retains the FULL original validator-key API check
// (including its full migration Validate), then the FULL detached canonical
// writer check. This is two complete validations, not a claim of only one.
// The old inline Bootstrap plus newValidatedMigration performed four. Reference
// Genesis keeps its original streaming full validator as an additional pass;
// it never materializes a potentially history-sized canonical byte slice.
// Only redundant checks of the same fully bound canonical object are removed.
func newPQLabSenderBootstrap(raw []byte, pins ConsensusBootstrapPins, m chain.ConsensusMigrationState, metrics *PQLabMetrics) (*validatedMigration, error) {
	end := pqLabMeasure(metrics, "lab.validatorKeyFullValidation")
	err := m.ValidateConsensusValidatorKeys()
	end()
	if err != nil {
		return nil, err
	}
	end = pqLabMeasure(metrics, "lab.validatedMigrationOwnerBuild")
	w, err := newValidatedMigration(m, nil)
	end()
	if err != nil {
		return nil, err
	}
	w.bootstrapKeysValidated = w
	b, err := newConsensusBootstrap(raw, pins, w.migration, w)
	if err != nil {
		return nil, err
	}
	// b is newly constructed in this private call; it has never been exposed
	// to caller mutation. Transfer it into this same invocation-owned witness.
	w.bootstrap = b
	if err = w.initializeMath(); err != nil {
		return nil, err
	}
	return w, nil
}
