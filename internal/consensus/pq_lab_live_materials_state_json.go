//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"unicode/utf8"
)

// Preserve the original complete R anchor byte bound. This is not the much
// smaller light-proof shape: accounts, lots and history are not validators.
const pqLabAnchorStateMaxBytes = 96 << 20

// Match encoding/json's existing maximum nesting rather than imposing the
// depth-16 proof profile on complete application records. The iterative walk
// below uses no Go recursion and no additional account/history cardinality cap.
const pqLabAnchorStateMaxDepth = 10000

// decodePQLabAnchorCommittedState decodes only syntax and the existing durable
// typed schema. It confers no authority: validateAnchor still calls the original
// validateOwned, registry replay, independent checkpoint binding, commit
// verification and held-source current checks on the returned complete state.
func decodePQLabAnchorCommittedState(raw []byte) (CommittedState, error) {
	if len(raw) == 0 || len(raw) > pqLabAnchorStateMaxBytes {
		return CommittedState{}, errors.New("bounded complete original R state required")
	}
	if err := pqLabAnchorStateUniqueJSON(raw); err != nil {
		return CommittedState{}, err
	}
	var state CommittedState
	if err := decodeStrictJSON(raw, &state); err != nil {
		return CommittedState{}, err
	}
	return state, nil
}

func pqLabAnchorStateUniqueJSON(raw []byte) error {
	if len(raw) == 0 || len(raw) > pqLabAnchorStateMaxBytes || !utf8.Valid(raw) {
		return errors.New("invalid or oversized complete state JSON")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	// Each successful JSON token consumes at least one original byte. This
	// bounds total token work by the existing file size, without a proof-only
	// 10,000-token / 100-validator / 1,024-object-member ceiling. Decoded key
	// sets are scoped to open objects and discarded as those objects close.
	remaining := len(raw)
	next := func() (json.Token, error) {
		if remaining == 0 {
			return nil, errors.New("complete state JSON byte-derived work limit")
		}
		remaining--
		return d.Token()
	}
	first, err := next()
	if err != nil {
		return err
	}
	if first != json.Delim('{') {
		return errors.New("complete state JSON object required")
	}
	type frame struct {
		close json.Delim
		keys  map[string]struct{}
	}
	stack := []frame{{close: '}', keys: make(map[string]struct{})}}
	for len(stack) > 0 {
		top := &stack[len(stack)-1]
		if !d.More() {
			end, err := next()
			if err != nil {
				return err
			}
			if end != top.close {
				return errors.New("invalid complete state JSON closing delimiter")
			}
			*top = frame{} // Do not retain a closed object's key map in the stack.
			stack = stack[:len(stack)-1]
			continue
		}
		if top.close == '}' {
			key, err := next()
			if err != nil {
				return err
			}
			name, ok := key.(string)
			if !ok {
				return errors.New("invalid complete state JSON field")
			}
			if _, duplicate := top.keys[name]; duplicate {
				return errors.New("duplicate complete state JSON field")
			}
			top.keys[name] = struct{}{}
		}
		value, err := next()
		if err != nil {
			return err
		}
		if delimiter, ok := value.(json.Delim); ok {
			if len(stack) >= pqLabAnchorStateMaxDepth {
				return errors.New("complete state JSON nesting exceeds encoding/json limit")
			}
			switch delimiter {
			case '{':
				stack = append(stack, frame{close: '}', keys: make(map[string]struct{})})
			case '[':
				stack = append(stack, frame{close: ']'})
			default:
				return errors.New("invalid complete state JSON value delimiter")
			}
		}
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("trailing complete state JSON")
	}
	return nil
}
