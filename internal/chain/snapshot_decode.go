package chain

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

// decodeNormalSnapshot preserves the normal loader's permissive typed JSON
// decoding, including unknown fields. Unlike Decode(&snapshot), it never asks
// encoding/json to buffer the complete history array or root object. Complete
// integrity, history, resource and account-policy checks remain in loadSnapshot.
func decodeNormalSnapshot(input io.Reader) (devnetSnapshot, error) {
	decoder := json.NewDecoder(&snapshotJSONDepthReader{input: input})
	var snapshot devnetSnapshot
	if err := decodeNormalSnapshotValue(decoder, &snapshot); err != nil {
		return snapshot, fmt.Errorf("decode devnet snapshot: %w", err)
	}
	// Keep the original Decode/EOF contract, including malformed second values.
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return snapshot, errors.New("decode devnet snapshot: multiple JSON values")
		}
		return snapshot, fmt.Errorf("decode devnet snapshot trailing data: %w", err)
	}
	return snapshot, nil
}

func decodeNormalSnapshotValue(decoder *json.Decoder, snapshot *devnetSnapshot) error {
	opening, err := decoder.Token()
	if err != nil {
		return err
	}
	if opening == nil { // encoding/json leaves a non-pointer struct unchanged.
		return nil
	}
	if opening != json.Delim('{') {
		return errors.New("snapshot must be a JSON object or null")
	}
	value := reflect.ValueOf(snapshot).Elem()
	typ := value.Type()
	names := make([]string, typ.NumField())
	exact := make(map[string]int, typ.NumField())
	for i := range names {
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if name == "" || name == "-" {
			return errors.New("snapshot field lacks a fixed JSON name")
		}
		names[i], exact[name] = name, i
	}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		name, ok := token.(string)
		if !ok {
			return errors.New("snapshot field name must be a string")
		}
		index, known := exact[name]
		if !known {
			// Match encoding/json's exact-first, first folded-field fallback.
			for i, fieldName := range names {
				if strings.EqualFold(name, fieldName) {
					index, known = i, true
					break
				}
			}
		}
		if !known {
			// Keep the original ignore semantics, including valid numbers
			// outside float64's range. Decode into any/Token would reject those.
			var discarded snapshotJSONDiscard
			if err := decoder.Decode(&discarded); err != nil {
				return err
			}
		} else if typ.Field(index).Name == "Blocks" {
			// This helper does not enable DisallowUnknownFields. Its slice
			// reuse, duplicate-field merge and null semantics match stdlib.
			if err := decodeOfflineConsensusBlocks(decoder, &snapshot.Blocks); err != nil {
				return err
			}
		} else if err := decoder.Decode(value.Field(index).Addr().Interface()); err != nil {
			return err
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return err
	}
	if closing != json.Delim('}') {
		return errors.New("snapshot object is incomplete")
	}
	return nil
}

// Like other non-history fields, an unknown field is decoded as one value.
// encoding/json validates its complete syntax before invoking this method;
// unlike RawMessage, discarding does not retain a second copy of its bytes.
type snapshotJSONDiscard struct{}

func (*snapshotJSONDiscard) UnmarshalJSON([]byte) error { return nil }

// A split Token/Decode stream must retain encoding/json's 10000-level whole
// document nesting bound. The guard only counts delimiters outside strings;
// encoding/json remains responsible for all syntax and typed-value validation.
type snapshotJSONDepthReader struct {
	input   io.Reader
	depth   int
	quoted  bool
	escaped bool
}

func (r *snapshotJSONDepthReader) Read(p []byte) (int, error) {
	n, err := r.input.Read(p)
	for i, b := range p[:n] {
		if r.quoted {
			if r.escaped {
				r.escaped = false
			} else if b == '\\' {
				r.escaped = true
			} else if b == '"' {
				r.quoted = false
			}
			continue
		}
		switch b {
		case '"':
			r.quoted = true
		case '{', '[':
			r.depth++
			if r.depth > 10000 {
				return i, errors.New("JSON value exceeded maximum nesting depth")
			}
		case '}', ']':
			r.depth--
		}
	}
	return n, err
}
