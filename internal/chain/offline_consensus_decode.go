package chain

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
)

// decodeOfflineConsensusSnapshot retains the existing typed snapshot schema,
// but never asks encoding/json to buffer the complete root or blocks array.
// Each non-history field is decoded as one typed value; history is decoded one
// block at a time. The caller still performs complete snapshot validation.
func decodeOfflineConsensusSnapshot(input io.Reader) (devnetSnapshot, error) {
	decoder := json.NewDecoder(input)
	opening, err := decoder.Token()
	if err != nil {
		return devnetSnapshot{}, err
	}
	if opening != json.Delim('{') {
		return devnetSnapshot{}, errors.New("offline checkpoint must be a JSON object")
	}
	snapshot, err := decodeOfflineConsensusSnapshotObject(decoder)
	if err != nil {
		return snapshot, err
	}
	// Read through trailing whitespace without buffering a second document.
	if _, err := decoder.Token(); err != io.EOF {
		return snapshot, errors.New("offline checkpoint must contain exactly one JSON document")
	}
	return snapshot, nil
}

// The caller has consumed '{'. This form consumes through the matching '}',
// without EOF, so a migration reader can reuse it for its nested runtime field.
func decodeOfflineConsensusSnapshotObject(decoder *json.Decoder) (devnetSnapshot, error) {
	var snapshot devnetSnapshot
	err := decodeOfflineConsensusSnapshotObjectInto(decoder, &snapshot)
	return snapshot, err
}

// Into preserves the original struct/map merge semantics for a repeated runtime
// object while still decoding each blocks array one entry at a time.
func decodeOfflineConsensusSnapshotObjectInto(decoder *json.Decoder, snapshot *devnetSnapshot) error {
	decoder.DisallowUnknownFields()
	value := reflect.ValueOf(snapshot).Elem()
	typ := value.Type()
	fields := make(map[string]int, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		name := strings.Split(typ.Field(i).Tag.Get("json"), ",")[0]
		if name == "" || name == "-" {
			return errors.New("offline snapshot field lacks a fixed JSON name")
		}
		fields[name] = i
	}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		name, ok := token.(string)
		if !ok {
			return errors.New("offline checkpoint field name must be a string")
		}
		index, ok := fields[name]
		if !ok {
			// Preserve encoding/json's exact-first, case-insensitive fallback.
			for fieldName, fieldIndex := range fields {
				if strings.EqualFold(name, fieldName) {
					index, ok = fieldIndex, true
					break
				}
			}
		}
		if !ok {
			return fmt.Errorf("json: unknown field %q", name)
		}
		if typ.Field(index).Name == "Blocks" {
			if err := decodeOfflineConsensusBlocks(decoder, &snapshot.Blocks); err != nil {
				return err
			}
		} else if err := decoder.Decode(value.Field(index).Addr().Interface()); err != nil {
			return fmt.Errorf("offline checkpoint field %s: %w", name, err)
		}
	}
	closing, err := decoder.Token()
	if err != nil {
		return err
	}
	if closing != json.Delim('}') {
		return errors.New("offline checkpoint object is incomplete")
	}
	return nil
}

func decodeOfflineConsensusBlocks(decoder *json.Decoder, blocks *[]Block) error {
	opening, err := decoder.Token()
	if err != nil {
		return err
	}
	if opening == nil {
		*blocks = nil
		return nil
	}
	if opening != json.Delim('[') {
		return errors.New("offline checkpoint blocks must be an array or null")
	}
	index := 0
	for decoder.More() {
		// Match encoding/json's slice reuse/merge semantics, including a
		// repeated blocks field, while decoding only one element per call.
		if index >= len(*blocks) {
			if index < cap(*blocks) {
				*blocks = (*blocks)[:index+1]
			} else {
				*blocks = append(*blocks, Block{})
			}
		}
		if err := decoder.Decode(&(*blocks)[index]); err != nil {
			return fmt.Errorf("offline checkpoint block %d: %w", index, err)
		}
		index++
	}
	closing, err := decoder.Token()
	if err != nil {
		return err
	}
	if closing != json.Delim(']') {
		return errors.New("offline checkpoint blocks array is incomplete")
	}
	if index == 0 {
		*blocks = []Block{}
	} else {
		*blocks = (*blocks)[:index]
	}
	return nil
}
