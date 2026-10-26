package chain

import (
	"encoding/json"
	"fmt"
	"io"
	"time"
	"unicode/utf8"
)

// WriteDetachedCanonicalJSON performs the same complete validation and returns
// the same detached values as CanonicalJSON followed by json.Unmarshal. History
// is cloned one block at a time, without retaining its complete JSON encoding.
// The caller must keep s immutable throughout this call.
//
// Output uses the original s, just as CanonicalJSON does. Its canonical bytes
// and the decoded detached values are intentionally distinct: encoding/json can
// normalize invalid UTF-8 or custom record representations while decoding. This
// preserves the original constructor's raw-byte/bootstrap binding contract.
// Any failure returns a zero state; partial writer output grants no authority.
func (s ConsensusMigrationState) WriteDetachedCanonicalJSON(w io.Writer) (ConsensusMigrationState, error) {
	if err := s.Validate(); err != nil {
		return ConsensusMigrationState{}, err
	}
	metadata := s
	metadata.Runtime = nil
	raw, err := json.Marshal(metadata)
	if err != nil {
		return ConsensusMigrationState{}, fmt.Errorf("detach consensus migration metadata: %w", err)
	}
	var detached ConsensusMigrationState
	if err := json.Unmarshal(raw, &detached); err != nil {
		return ConsensusMigrationState{}, fmt.Errorf("decode detached consensus migration metadata: %w", err)
	}
	if s.Runtime != nil {
		runtime, err := detachDevnetSnapshot(devnetSnapshot(*s.Runtime))
		if err != nil {
			return ConsensusMigrationState{}, err
		}
		for i, header := range s.Runtime.Blocks {
			// Normal decoded UTC headers need only their existing value copy.
			// Exceptional in-memory headers must also have JSON-decoder semantics,
			// rather than retaining invalid strings, monotonic time or zone names.
			if utf8.ValidString(header.Hash) && utf8.ValidString(header.ParentHash) && utf8.ValidString(header.Validator) && header.Time.Location() == time.UTC && header.Time == header.Time.Round(0) {
				continue
			}
			header.Transactions = nil
			raw, err := json.Marshal(header)
			if err != nil {
				return ConsensusMigrationState{}, fmt.Errorf("detach consensus block header %d: %w", i, err)
			}
			var normalized Block
			if err := json.Unmarshal(raw, &normalized); err != nil {
				return ConsensusMigrationState{}, fmt.Errorf("decode detached consensus block header %d: %w", i, err)
			}
			normalized.Transactions = runtime.Blocks[i].Transactions
			runtime.Blocks[i] = normalized
		}
		value := ConsensusRuntimeState(runtime)
		detached.Runtime = &value
	}
	if err := writeCanonicalStateJSON(w, s, true); err != nil {
		return ConsensusMigrationState{}, err
	}
	return detached, nil
}
