package originalclient

import (
	"bytes"
	"encoding/json"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	"io"
	"reflect"
	"strings"
)

type serviceValueDATA struct {
	State, Scope, EffectRef, OperationID, Original     string
	RecoveryOnly, ReservationRetained, PersistenceOnly bool
	ResourceResult                                     *TaskResourceResult
}
type serviceEnvelopeDATA struct {
	OK                          bool
	Code, RequestID, OriginalOp string
	Value                       serviceValueDATA
}

// Only the existing original PRIVATE service JSON is decoded. opaque Original
// is a string and is NEVER parsed or interpreted as response content.
func uniqueServiceJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	depth := 0
	var walk func() error
	walk = func() error {
		depth++
		defer func() { depth-- }()
		if depth > 32 {
			return ErrBinding
		}
		t, e := d.Token()
		if e != nil {
			return e
		}
		if delim, ok := t.(json.Delim); ok {
			switch delim {
			case '{':
				seen := map[string]bool{}
				for d.More() {
					if len(seen) > 128 {
						return ErrBinding
					}
					k, e := d.Token()
					if e != nil {
						return e
					}
					s, ok := k.(string)
					if !ok {
						return ErrBinding
					}
					s = strings.ToLower(s)
					if seen[s] {
						return ErrBinding
					}
					seen[s] = true
					if e = walk(); e != nil {
						return e
					}
				}
				end, e := d.Token()
				if e != nil || end != json.Delim('}') {
					return ErrBinding
				}
			case '[':
				for d.More() {
					if e := walk(); e != nil {
						return e
					}
				}
				end, e := d.Token()
				if e != nil || end != json.Delim(']') {
					return ErrBinding
				}
			default:
				return ErrBinding
			}
		}
		return nil
	}
	if e := walk(); e != nil {
		return e
	}
	if _, e := d.Token(); e != io.EOF {
		return ErrBinding
	}
	return nil
}
func originalServiceResultDATA(raw []byte, call TaskAuthorityCall, history bool) (TaskAuthorityResult, error) {
	var out TaskAuthorityResult
	if len(raw) < 1 || len(raw) > 1048576 || uniqueServiceJSON(raw) != nil {
		return out, ErrBinding
	}
	var r serviceEnvelopeDATA
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(&r) != nil {
		return out, ErrBinding
	}
	if !r.OK {
		if r.Code != "UNKNOWN" || r.OriginalOp == "" || r.Value.ResourceResult != nil {
			return out, ErrBinding
		}
		return TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: r.OriginalOp, RecoveryOnly: true}, nil
	}
	op := r.Value.EffectRef
	if history {
		op = r.Value.OperationID
	} else if r.Value.Scope != "egress-only" {
		return out, ErrBinding
	}
	if len(op) != 64 || history && op != call.OriginalOperation {
		return out, ErrBinding
	}
	out = TaskAuthorityResult{State: r.Value.State, OriginalOperation: op, Original: r.Value.Original, RecoveryOnly: r.Value.RecoveryOnly, Resource: cloneTaskResource(r.Value.ResourceResult)}
	switch out.State {
	case "COMMITTED":
		g, e := open.DecodeBoundGrant(call.Grant.Payload)
		if e != nil || out.Original == "" || validateTaskResource(out.Resource, op, g) != nil {
			return TaskAuthorityResult{}, ErrBinding
		}
	case "FAILED", "UNKNOWN":
		if out.Resource != nil {
			return TaskAuthorityResult{}, ErrBinding
		}
	default:
		return TaskAuthorityResult{}, ErrBinding
	}
	return out, nil
}
func correlateAuthorityResult(raw []byte, call TaskAuthorityCall, history bool, verified TaskAuthorityResult) (TaskAuthorityResult, error) {
	data, e := originalServiceResultDATA(raw, call, history)
	if e != nil {
		return TaskAuthorityResult{}, e
	}
	if !reflect.DeepEqual(data, verified) {
		return TaskAuthorityResult{}, ErrBinding
	}
	// Data equality is NOT Source verification; caller invokes this only after
	// actual Source verified same peer/caller/proof/op/ref/response bytes.
	data.Resource = cloneTaskResource(data.Resource)
	return data, nil
}
