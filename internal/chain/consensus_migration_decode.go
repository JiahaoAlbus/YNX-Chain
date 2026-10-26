package chain

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

// ReadConsensusMigrationState uses the existing strict typed schema and full
// validation, without retaining the raw document or buffering the complete
// runtime/history JSON value. It starts no runtime and changes no source data.
// Callers holding a file must still enforce their original identity and bounds.
func ReadConsensusMigrationState(input io.Reader) (ConsensusMigrationState, error) {
	decoder := json.NewDecoder(input)
	decoder.DisallowUnknownFields()
	var state ConsensusMigrationState
	opening, err := decoder.Token()
	if err != nil {
		return state, fmt.Errorf("decode migration state: %w", err)
	}
	if opening != json.Delim('{') {
		return state, errors.New("decode migration state: expected a JSON object")
	}
	value := reflect.ValueOf(&state).Elem()
	typ := value.Type()
	fields := make(map[string]int, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if field.Anonymous || field.PkgPath != "" || name == "" || name == "-" {
			return state, errors.New("migration state field lacks a direct fixed JSON name")
		}
		fields[name] = i
	}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return state, fmt.Errorf("decode migration state: %w", err)
		}
		name, ok := token.(string)
		if !ok {
			return state, errors.New("decode migration state: field name must be a string")
		}
		index, ok := fields[name]
		if !ok {
			// Match encoding/json's existing exact-first folded field lookup.
			for i := 0; i < typ.NumField(); i++ {
				candidate := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
				if strings.EqualFold(candidate, name) {
					index, ok = i, true
					break
				}
			}
		}
		if !ok {
			return state, fmt.Errorf("decode migration state: json: unknown field %q", name)
		}
		if typ.Field(index).Name == "Runtime" {
			opening, err := decoder.Token()
			if err != nil {
				return state, fmt.Errorf("decode migration runtime: %w", err)
			}
			if opening == nil {
				state.Runtime = nil
				continue
			}
			if opening != json.Delim('{') {
				return state, errors.New("decode migration runtime: expected a JSON object or null")
			}
			var snapshot devnetSnapshot
			if state.Runtime != nil {
				snapshot = devnetSnapshot(*state.Runtime)
			}
			if err := decodeOfflineConsensusSnapshotObjectInto(decoder, &snapshot); err != nil {
				return state, fmt.Errorf("decode migration runtime: %w", err)
			}
			runtime := ConsensusRuntimeState(snapshot)
			state.Runtime = &runtime
			continue
		}
		if err := decoder.Decode(value.Field(index).Addr().Interface()); err != nil {
			return state, fmt.Errorf("decode migration field %s: %w", name, err)
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return state, fmt.Errorf("decode migration state: %w", err)
	}
	if closing != json.Delim('}') {
		return state, errors.New("decode migration state: incomplete JSON object")
	}
	if _, err := decoder.Token(); err != io.EOF {
		return state, errors.New("migration state contains trailing JSON data")
	}
	if err := state.Validate(); err != nil {
		return state, fmt.Errorf("validate migration state: %w", err)
	}
	return state, nil
}
