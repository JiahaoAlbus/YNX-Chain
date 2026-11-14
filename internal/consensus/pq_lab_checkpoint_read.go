//go:build unix

package consensus

import (
	"crypto/sha256"
	"errors"
)

// One checkpoint invocation owns four fingerprints, never raw files, decoded
// histories, a current permission, or a cross-invocation authorization cache.
// A fingerprint is populated ONLY after the original complete state validator
// and original source/close checks succeed. Every current check still captures
// the entire actual file through the unchanged bounded source reader.
type pqLabCheckpointRead struct {
	witness *validatedMigration
	engine  *PQEngineAuthorization
	height  int64
	appHash string
	metrics *PQLabMetrics
	files   [4]pqLabCheckpointFingerprint
}

type pqLabCheckpointFingerprint struct {
	path, layout string
	bytes        int
	hash         [sha256.Size]byte
	validated    bool
}

func (r *pqLabCheckpointRead) read(index int, path string, capture func(string) (*pqEngineStateRead, error)) (state *CommittedState, result error) {
	if r == nil || index < 0 || index >= len(r.files) || r.witness.valid() != nil {
		return state, errors.New("missing invocation-local checkpoint validation scope")
	}
	done := pqLabMeasure(r.metrics, "checkpoint.captureCurrentBytes")
	original, err := capture(path)
	done()
	if err != nil {
		pqLabMeasure(r.metrics, "checkpoint.refused.capture")()
		return state, err
	}
	// Each captured capability is retired exactly once, including hash hits.
	// A mixed/late close failure is never converted into a successful reuse.
	var publish *pqLabCheckpointFingerprint
	defer func() {
		if original.closeOriginal != nil {
			closeErr := original.closeOriginal()
			if closeErr != nil {
				pqLabMeasure(r.metrics, "checkpoint.refused.close")()
			}
			result = errors.Join(result, closeErr)
		}
		if result == nil && publish != nil {
			r.files[index] = *publish
		}
	}()
	fingerprint := pqLabCheckpointFingerprint{path: path, layout: original.layout, bytes: len(original.data), hash: sha256.Sum256(original.data), validated: true}
	prior := r.files[index]
	matched := prior.validated && prior == fingerprint
	// Every node still supplies a separately captured and closed original.
	// Within this one fixed witness/H/hash invocation, identical COMPLETE bytes
	// have identical history/registry mathematics. Reuse only a fingerprint
	// published after the original full validator AND its Close succeeded.
	if !matched {
		for _, other := range r.files {
			if other.validated && other.layout == fingerprint.layout && other.bytes == fingerprint.bytes && other.hash == fingerprint.hash {
				matched = true
				break
			}
		}
	}
	if matched {
		done := pqLabMeasure(r.metrics, "checkpoint.exactBytesValidationReuse")
		err := original.unchanged()
		done()
		if err != nil {
			pqLabMeasure(r.metrics, "checkpoint.refused.currentOriginal")()
			return state, err
		}
		if !prior.validated {
			publish = &fingerprint
		}
		// No synthetic state is returned: this branch only confirms exact
		// current original bytes. The actual detached initial state remains
		// in the checkpoint and cannot be reconstructed from this fingerprint.
		return nil, nil
	}
	done = pqLabMeasure(r.metrics, "checkpoint.fullStateValidation")
	// Keep the original decoder and EVERY history/registry/AND check. Its
	// capability close is owned by the outer defer so it cannot run twice.
	copy := *original
	copy.closeOriginal = nil
	decoded, err := readPQEngineCommittedStateOwned(path, r.witness, r.engine, nil, func(string) (*pqEngineStateRead, error) { return &copy, nil })
	done()
	if err != nil {
		// The complete validator includes its final original-current check.
		// Do not infer an IO or consensus cause from its error text.
		pqLabMeasure(r.metrics, "checkpoint.refused.fullValidationOrCurrent")()
		return nil, err
	}
	if !decoded.Initialized || decoded.Height != r.height || decoded.AppHash != r.appHash || decoded.AccountPolicy == nil {
		pqLabMeasure(r.metrics, pqLabCheckpointCoordinateRefusalClass(decoded, r.height, r.appHash))()
		// Diagnostic DATA only, after full validation AND original-current.
		// A supplied stale height alone is not a proven advance: this node
		// must already have validated the exact original checkpoint here.
		// Even a strictly later state remains refused; no refresh, fallback,
		// signing permission or operation replay is granted by this counter.
		if prior.validated && decoded.Initialized && decoded.AccountPolicy != nil && decoded.Height > r.height {
			pqLabMeasure(r.metrics, "checkpoint.refused.heightAdvanced")()
		} else {
			pqLabMeasure(r.metrics, "checkpoint.refused.coordinates")()
		}
		return nil, errors.New("actual four-node checkpoint differs from independently supplied H/AppHash")
	}
	// Do not retain replacement encodings or extend the scope. An alternate
	// valid encoding is accepted after normal validation on every such read.
	if !prior.validated {
		// Closing a supplied original may fail. Publish the fingerprint only
		// after that deferred close has reported success.
		publish = &fingerprint
	}
	return &decoded, nil
}

// The complete state validator and original-current check must precede this
// closed diagnostic projection. No height, hash, owner, path or cause is emitted;
// none of these classes permits a different checkpoint or retries an operation.
func pqLabCheckpointCoordinateRefusalClass(state CommittedState, height int64, appHash string) string {
	switch {
	case !state.Initialized:
		return "checkpoint.refused.uninitialized"
	case state.AccountPolicy == nil:
		return "checkpoint.refused.accountPolicyMissing"
	case state.Height > height:
		return "checkpoint.refused.heightHigher"
	case state.Height < height:
		return "checkpoint.refused.heightLower"
	case state.AppHash != appHash:
		return "checkpoint.refused.sameHeightAppHash"
	default:
		return ""
	}
}
