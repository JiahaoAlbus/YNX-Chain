package chain

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strings"
)

// WriteCanonicalJSON validates before writing and emits the same bytes as
// CanonicalJSON. History is encoded one record at a time; callers do not need a
// second, complete JSON representation of the retained chain in memory.
func (s ConsensusMigrationState) WriteCanonicalJSON(w io.Writer) error {
	if err := s.Validate(); err != nil {
		return err
	}
	return writeCanonicalStateJSON(w, s, true)
}

// writeCanonicalStateJSON preserves encoding/json's existing field order,
// escaping, omission, map ordering and indentation. Only the three closed state
// boundary structs are expanded here. Ordinary records (including custom JSON
// marshalers) continue to use encoding/json. This is a memory optimization, not
// a new state format or a change to any hash domain.
func writeCanonicalStateJSON(w io.Writer, value any, pretty bool) error {
	if w == nil {
		return fmt.Errorf("canonical state JSON writer is nil")
	}
	buffer := bufio.NewWriterSize(w, 64*1024)
	encoder := canonicalStateJSONWriter{out: buffer, pretty: pretty}
	if err := encoder.value(reflect.ValueOf(value), 0); err != nil {
		return err
	}
	return buffer.Flush()
}

type canonicalStateJSONWriter struct {
	out    *bufio.Writer
	pretty bool
}

var (
	canonicalMigrationType = reflect.TypeOf(ConsensusMigrationState{})
	canonicalRuntimeType   = reflect.TypeOf(ConsensusRuntimeState{})
	canonicalSnapshotType  = reflect.TypeOf(devnetSnapshot{})
)

func (e *canonicalStateJSONWriter) text(s string) error {
	_, err := e.out.WriteString(s)
	return err
}

func (e *canonicalStateJSONWriter) indent(depth int) error {
	if !e.pretty {
		return nil
	}
	return e.text("\n" + strings.Repeat("  ", depth))
}

func (e *canonicalStateJSONWriter) leaf(v reflect.Value, depth int) error {
	var value any
	if v.IsValid() {
		value = v.Interface()
	}
	var wire []byte
	var err error
	if e.pretty {
		wire, err = json.MarshalIndent(value, strings.Repeat("  ", depth), "  ")
	} else {
		wire, err = json.Marshal(value)
	}
	if err != nil {
		return err
	}
	_, err = e.out.Write(wire)
	return err
}

func (e *canonicalStateJSONWriter) value(v reflect.Value, depth int) error {
	if !v.IsValid() {
		return e.text("null")
	}
	// Preserve time.Time, json.RawMessage and any future record's custom
	// marshaler. In particular, do not reflect through those implementations.
	if v.CanInterface() {
		if _, ok := v.Interface().(json.Marshaler); ok {
			return e.leaf(v, depth)
		}
	}
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		if v.IsNil() {
			return e.text("null")
		}
		return e.value(v.Elem(), depth)
	case reflect.Struct:
		switch v.Type() {
		case canonicalMigrationType, canonicalRuntimeType, canonicalSnapshotType:
			return e.state(v, depth)
		default:
			return e.leaf(v, depth)
		}
	case reflect.Map:
		if v.IsNil() {
			return e.text("null")
		}
		if v.Type().Key().Kind() != reflect.String {
			return e.leaf(v, depth)
		}
		keys := v.MapKeys()
		sort.Slice(keys, func(i, j int) bool { return keys[i].String() < keys[j].String() })
		if err := e.text("{"); err != nil {
			return err
		}
		for i, key := range keys {
			if err := e.member(key.String(), i, depth); err != nil {
				return err
			}
			if err := e.value(v.MapIndex(key), depth+1); err != nil {
				return err
			}
		}
		return e.close("}", len(keys), depth)
	case reflect.Slice, reflect.Array:
		// encoding/json represents byte slices as base64, not a JSON array.
		if v.Kind() == reflect.Slice {
			if v.IsNil() {
				return e.text("null")
			}
			if v.Type().Elem().Kind() == reflect.Uint8 {
				return e.leaf(v, depth)
			}
		}
		if err := e.text("["); err != nil {
			return err
		}
		for i := 0; i < v.Len(); i++ {
			if i != 0 {
				if err := e.text(","); err != nil {
					return err
				}
			}
			if err := e.indent(depth + 1); err != nil {
				return err
			}
			if err := e.value(v.Index(i), depth+1); err != nil {
				return err
			}
		}
		return e.close("]", v.Len(), depth)
	default:
		return e.leaf(v, depth)
	}
}

func (e *canonicalStateJSONWriter) member(name string, index, depth int) error {
	if index != 0 {
		if err := e.text(","); err != nil {
			return err
		}
	}
	if err := e.indent(depth + 1); err != nil {
		return err
	}
	if err := e.leaf(reflect.ValueOf(name), depth+1); err != nil {
		return err
	}
	if e.pretty {
		return e.text(": ")
	}
	return e.text(":")
}

func (e *canonicalStateJSONWriter) close(token string, count, depth int) error {
	if count != 0 {
		if err := e.indent(depth); err != nil {
			return err
		}
	}
	return e.text(token)
}

func canonicalStateJSONEmpty(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Array, reflect.Map, reflect.Slice, reflect.String:
		return v.Len() == 0
	case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr,
		reflect.Float32, reflect.Float64, reflect.Interface, reflect.Pointer:
		return v.IsZero()
	}
	return false
}

func (e *canonicalStateJSONWriter) state(v reflect.Value, depth int) error {
	if err := e.text("{"); err != nil {
		return err
	}
	count := 0
	for i := 0; i < v.NumField(); i++ {
		field := v.Type().Field(i)
		if field.PkgPath != "" { // unexported, as in encoding/json
			continue
		}
		tag := field.Tag.Get("json")
		if tag == "-" {
			continue
		}
		// These boundary structs have direct fields only. Fail closed if a
		// schema change needs JSON promotion or new tag semantics.
		if field.Anonymous {
			return fmt.Errorf("canonical state JSON cannot promote field %s.%s", v.Type(), field.Name)
		}
		parts := strings.Split(tag, ",")
		name := parts[0]
		if name == "" {
			name = field.Name
		}
		omit := false
		for _, option := range parts[1:] {
			switch option {
			case "omitempty":
				omit = canonicalStateJSONEmpty(v.Field(i))
			case "":
			default:
				return fmt.Errorf("canonical state JSON unsupported tag %q on %s.%s", option, v.Type(), field.Name)
			}
		}
		if omit {
			continue
		}
		if err := e.member(name, count, depth); err != nil {
			return err
		}
		if err := e.value(v.Field(i), depth+1); err != nil {
			return err
		}
		count++
	}
	return e.close("}", count, depth)
}
