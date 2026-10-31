package originalclient

import (
	"bytes"
	"encoding/json"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
)

// Same ORIGINAL Node canonicalJSON semantics for its PRIVATE service body.
// Shared OPEN does all E21/E3 decoding; this does not define an OPEN codec.
func canonicalOriginalJSON(value any) ([]byte, error) {
	raw, e := json.Marshal(value)
	if e != nil {
		return nil, e
	}
	var data any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if e = d.Decode(&data); e != nil {
		return nil, e
	}
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if e = encoder.Encode(data); e != nil {
		return nil, e
	}
	out := bytes.TrimSuffix(buf.Bytes(), []byte{'\n'})
	// JSON.stringify preserves literal U+2028/U+2029. Do not unescape a user's
	// literal backslash sequence (the preceding slash run would be even).
	fixed := make([]byte, 0, len(out))
	for i := 0; i < len(out); {
		if out[i] == '\\' {
			j := i
			for j < len(out) && out[j] == '\\' {
				j++
			}
			n := j - i
			if n%2 == 1 && j+5 <= len(out) && out[j] == 'u' && (string(out[j+1:j+5]) == "2028" || string(out[j+1:j+5]) == "2029") {
				fixed = append(fixed, out[i:j-1]...)
				if out[j+4] == '8' {
					fixed = append(fixed, 0xe2, 0x80, 0xa8)
				} else {
					fixed = append(fixed, 0xe2, 0x80, 0xa9)
				}
				i = j + 5
				continue
			}
			fixed = append(fixed, out[i:j]...)
			i = j
			continue
		}
		fixed = append(fixed, out[i])
		i++
	}
	return fixed, nil
}
func originalAuthorityBodyDATA(call TaskAuthorityCall, history bool) ([]byte, error) {
	copied, e := authorityCall(call, history)
	if e != nil {
		return nil, e
	}
	g, e := open.DecodeBoundGrant(copied.Grant.Payload)
	if e != nil {
		return nil, e
	}
	if history {
		return canonicalOriginalJSON(map[string]any{"grantRef": copied.GrantRef, "operationId": copied.OriginalOperation, "holderProof": copied.Holder})
	}
	return canonicalOriginalJSON(map[string]any{"grant": g, "step": g.Binding, "holderProof": copied.Holder, "expectedGrantRevision": g.Rev})
}
