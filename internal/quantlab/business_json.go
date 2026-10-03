package quantlab

import (
	"bytes"
	"encoding/json"
)

// HTTP business requests only. No persisted state, engine, proof or authority
// semantics are changed. Decoded key aliases must not override reviewed inputs.
func unambiguousQuantBusinessJSON(raw []byte) bool {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var scan func(int) bool
	scan = func(depth int) bool {
		if depth > 128 {
			return false
		}
		token, err := d.Token()
		if err != nil {
			return false
		}
		delim, container := token.(json.Delim)
		if !container {
			return true
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				token, err := d.Token()
				key, ok := token.(string)
				if err != nil || !ok {
					return false
				}
				key = canonicalJSONKey(key)
				if seen[key] {
					return false
				}
				seen[key] = true
				if !scan(depth + 1) {
					return false
				}
			}
		case '[':
			for d.More() {
				if !scan(depth + 1) {
					return false
				}
			}
		default:
			return false
		}
		end, err := d.Token()
		return err == nil && (delim == '{' && end == json.Delim('}') || delim == '[' && end == json.Delim(']'))
	}
	// The existing typed decoder still enforces exactly one JSON value and
	// unknown-field rules. Do not echo submitted keys/values into diagnostics.
	return scan(0)
}
