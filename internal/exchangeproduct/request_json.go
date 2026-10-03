package exchangeproduct

import (
	"bytes"
	"encoding/json"
	"strings"
	"unicode"
)

// HTTP business input only; persisted state and shared proof parsing are not
// changed. Reject duplicate decoded names (including escapes/case aliases)
// before encoding/json can silently apply its last-field-wins struct behavior.
// Never include submitted field names or values in errors or logs.
func unambiguousBusinessJSON(raw []byte) bool {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var value func(int) bool
	value = func(depth int) bool {
		if depth > 128 {
			return false
		}
		token, err := d.Token()
		if err != nil {
			return false
		}
		delim, compound := token.(json.Delim)
		if !compound {
			return true
		}
		switch delim {
		case '{':
			seen := make(map[string]bool)
			for d.More() {
				token, err := d.Token()
				key, ok := token.(string)
				if err != nil || !ok {
					return false
				}
				key = foldedBusinessKey(key)
				if seen[key] {
					return false
				}
				seen[key] = true
				if !value(depth + 1) {
					return false
				}
			}
		case '[':
			for d.More() {
				if !value(depth + 1) {
					return false
				}
			}
		default:
			return false
		}
		closing, err := d.Token()
		return err == nil && (delim == '{' && closing == json.Delim('}') || delim == '[' && closing == json.Delim(']'))
	}
	return value(0)
}

func foldedBusinessKey(key string) string {
	var result strings.Builder
	for _, r := range key {
		canonical := r
		for next := unicode.SimpleFold(r); next != r; next = unicode.SimpleFold(next) {
			if next < canonical {
				canonical = next
			}
		}
		result.WriteRune(canonical)
	}
	return result.String()
}
