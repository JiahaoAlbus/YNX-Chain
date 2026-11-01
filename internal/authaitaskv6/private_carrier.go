package aitaskactionsource

import (
	"bytes"
	"encoding/json"
	"io"
	"unicode/utf8"
)

// Strict finite private carrier parsing; not another SDK V6 wire codec.
func originalPrivateObject(raw []byte, keys ...string) (map[string]json.RawMessage, error) {
	if !utf8.Valid(raw) {
		return nil, errTaskRuntimeResource
	}
	allowed := map[string]bool{}
	for _, k := range keys {
		allowed[k] = true
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, e := d.Token()
	if e != nil || token != json.Delim('{') {
		return nil, errTaskRuntimeResource
	}
	out := map[string]json.RawMessage{}
	for d.More() {
		token, e = d.Token()
		if e != nil {
			return nil, errTaskRuntimeResource
		}
		k, ok := token.(string)
		if !ok || !allowed[k] || out[k] != nil {
			return nil, errTaskRuntimeResource
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, errTaskRuntimeResource
		}
		out[k] = value
	}
	token, e = d.Token()
	if e != nil || token != json.Delim('}') || len(out) != len(keys) || d.Decode(new(any)) != io.EOF {
		return nil, errTaskRuntimeResource
	}
	return out, nil
}
func originalNullableString(v string) any {
	if v == "" {
		return nil
	}
	return v
}
