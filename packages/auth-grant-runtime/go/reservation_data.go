//go:build darwin || linux

package grantruntime

import (
	"bytes"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"io"
	"reflect"
	"strconv"
	"unicode/utf8"

	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// D is private original DATA, NEVER a Source or capability constructor.
// Its JSON is Node JSON.stringify(structuredClone(originalRequest)); do not
// reinterpret Uint8Array numeric-key objects as Go []byte/base64 or new WIRE.
type originalReservationRequestDATA struct {
	Grant                 open.BoundGrantV1       `json:"grant"`
	Step                  open.GrantStepBindingV1 `json:"step"`
	OperationID           string                  `json:"operationId"`
	RawInput              json.RawMessage         `json:"rawInput"`
	HolderProof           json.RawMessage         `json:"holderProof"`
	ExpectedGrantRevision string                  `json:"expectedGrantRevision"`
}

// Check escapes before encoding/json can replace isolated UTF16 surrogates.
func validOriginalStrings(raw []byte) bool {
	for i := 0; i < len(raw); i++ {
		if raw[i] != '"' {
			continue
		}
		i++
		for ; i < len(raw) && raw[i] != '"'; i++ {
			if raw[i] != '\\' {
				continue
			}
			i++
			if i >= len(raw) {
				return false
			}
			if raw[i] != 'u' {
				continue
			}
			if i+4 >= len(raw) {
				return false
			}
			n, e := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
			if e != nil {
				return false
			}
			i += 4
			if n >= 0xDC00 && n <= 0xDFFF {
				return false
			}
			if n >= 0xD800 && n <= 0xDBFF {
				if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
					return false
				}
				low, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
				if e != nil || low < 0xDC00 || low > 0xDFFF {
					return false
				}
				i += 6
			}
		}
		if i >= len(raw) {
			return false
		}
	}
	return true
}
func strictOriginalJSON(raw []byte) (any, error) {
	if len(raw) < 1 || len(raw) > 1<<20 || !utf8.Valid(raw) || !validOriginalStrings(raw) {
		return nil, ErrProof
	}
	var compact bytes.Buffer
	if json.Compact(&compact, raw) != nil || !bytes.Equal(compact.Bytes(), raw) {
		return nil, ErrProof
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	nodes := 0
	var value func(int) (any, error)
	value = func(depth int) (any, error) {
		nodes++
		if depth > 32 || nodes > 262144 {
			return nil, ErrProof
		}
		token, e := dec.Token()
		if e != nil {
			return nil, e
		}
		switch v := token.(type) {
		case json.Delim:
			if v == '{' {
				out := map[string]any{}
				for dec.More() {
					key, e := dec.Token()
					if e != nil {
						return nil, e
					}
					s, ok := key.(string)
					if !ok {
						return nil, ErrProof
					}
					if _, present := out[s]; present {
						return nil, ErrProof
					}
					child, e := value(depth + 1)
					if e != nil {
						return nil, e
					}
					out[s] = child
				}
				end, e := dec.Token()
				if e != nil || end != json.Delim('}') {
					return nil, ErrProof
				}
				return out, nil
			}
			if v == '[' {
				out := []any{}
				for dec.More() {
					child, e := value(depth + 1)
					if e != nil {
						return nil, e
					}
					out = append(out, child)
				}
				end, e := dec.Token()
				if e != nil || end != json.Delim(']') {
					return nil, ErrProof
				}
				return out, nil
			}
			return nil, ErrProof
		case json.Number:
			s := v.String()
			n, e := strconv.ParseUint(s, 10, 64)
			if e != nil || strconv.FormatUint(n, 10) != s {
				return nil, ErrProof
			}
			return v, nil
		case string, bool, nil:
			return v, nil
		default:
			return nil, ErrProof
		}
	}
	out, e := value(0)
	if e != nil {
		return nil, e
	}
	if _, e = dec.Token(); e != io.EOF {
		return nil, ErrProof
	}
	return out, nil
}
func closedOriginalJSON(raw []byte, out any) error {
	original, e := strictOriginalJSON(raw)
	if e != nil {
		return e
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e = d.Decode(out); e != nil {
		return e
	}
	reencoded, e := json.Marshal(out)
	if e != nil {
		return e
	}
	expected, e := strictOriginalJSON(reencoded)
	if e != nil || !reflect.DeepEqual(original, expected) {
		return ErrProof
	}
	return nil
}
func numericOriginalBytes(raw []byte, cap int) ([]byte, error) {
	value, e := strictOriginalJSON(raw)
	if e != nil {
		return nil, e
	}
	m, ok := value.(map[string]any)
	if !ok || len(m) > cap {
		return nil, ErrProof
	}
	out := make([]byte, len(m))
	for i := range out {
		v, ok := m[strconv.Itoa(i)].(json.Number)
		if !ok {
			return nil, ErrProof
		}
		n, e := strconv.ParseUint(v.String(), 10, 8)
		if e != nil {
			return nil, ErrProof
		}
		out[i] = byte(n)
	}
	return out, nil
}
func decodeOriginalReservationDATA(raw []byte, b policy.TaskEffectBinding, gp, hp policy.Proof, operation string) (originalReservationRequestDATA, []byte, error) {
	var d originalReservationRequestDATA
	if e := closedOriginalJSON(raw, &d); e != nil {
		return d, nil, e
	}
	if operation == "" || len(operation) > 256 || d.OperationID != operation || d.ExpectedGrantRevision != b.GrantRevision || d.ExpectedGrantRevision != d.Grant.Rev {
		return d, nil, ErrProof
	}
	g, e := open.EncodeBoundGrant(d.Grant)
	if e != nil || !bytes.Equal(g, gp.Payload) {
		return d, nil, ErrProof
	}
	effect, e := open.EncodeGrantEffect(d.Grant, d.Step)
	if e != nil || !bytes.Equal(effect, hp.Payload) || gp.Purpose != open.BoundGrantDomain || hp.Purpose != open.GrantEffectDomain {
		return d, nil, ErrProof
	}
	if decoded, e := open.DecodeBoundGrant(g); e != nil || !reflect.DeepEqual(decoded, d.Grant) {
		return d, nil, ErrProof
	}
	if decoded, e := open.DecodeGrantEffect(effect); e != nil || !reflect.DeepEqual(decoded.Step, d.Step) {
		return d, nil, ErrProof
	}
	input, e := numericOriginalBytes(d.RawInput, 32768)
	if e != nil {
		return d, nil, e
	}
	a, z := sha3.Sum512(input), sha512.Sum512(input)
	actual := policy.Bind{Bytes: strconv.Itoa(len(input)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(z[:])}
	if actual != b.Input || actual != toBind(d.Step.Input) {
		return d, nil, ErrProof
	}
	var holder map[string]json.RawMessage
	if e = closedOriginalJSON(d.HolderProof, &holder); e != nil || len(holder) != 1 || holder["memberOriginal"] == nil {
		return d, nil, ErrProof
	}
	member, e := numericOriginalBytes(holder["memberOriginal"], 262144)
	if e != nil || !bytes.Equal(member, hp.Wire) {
		return d, nil, ErrProof
	}
	return d, input, nil
}
