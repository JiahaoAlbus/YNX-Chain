// Package executionstate audits immutable snapshot bytes offline. It does not
// migrate state, run an execution engine, or attest the origin of an input file.
package executionstate

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"time"
)

//go:embed catalog.json
var catalogBytes []byte

type field struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Optional bool   `json:"optional,omitempty"`
}
type shape struct {
	Kind   string  `json:"kind"`
	Elem   string  `json:"elem,omitempty"`
	Fields []field `json:"fields,omitempty"`
}
type catalog struct {
	Commit   string           `json:"commit"`
	Version  int              `json:"version"`
	Root     string           `json:"root"`
	HashRoot string           `json:"hashRoot,omitempty"`
	Domain   string           `json:"domain"`
	Types    map[string]shape `json:"types"`
}

func catalogs() map[string]catalog {
	var v map[string]catalog
	if json.Unmarshal(catalogBytes, &v) != nil {
		panic("invalid embedded schema catalog")
	}
	return v
}

var integerPattern = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)

// decode rejects duplicate keys before encoding/json could overwrite them. Paths
// contain schema names or wildcards only; errors never echo untrusted values.
func decode(data []byte) (map[string]any, error) {
	d := json.NewDecoder(bytes.NewReader(data))
	d.UseNumber()
	var value func(int) (any, error)
	value = func(depth int) (any, error) {
		if depth > 128 {
			return nil, errors.New("JSON_DEPTH_LIMIT")
		}
		t, e := d.Token()
		if e != nil {
			return nil, errors.New("INVALID_JSON")
		}
		switch t {
		case json.Delim('{'):
			m := map[string]any{}
			for d.More() {
				k, e := d.Token()
				if e != nil {
					return nil, errors.New("INVALID_JSON")
				}
				key, ok := k.(string)
				if !ok {
					return nil, errors.New("INVALID_JSON")
				}
				if _, exists := m[key]; exists {
					return nil, errors.New("DUPLICATE_JSON_KEY")
				}
				v, e := value(depth + 1)
				if e != nil {
					return nil, e
				}
				m[key] = v
			}
			end, e := d.Token()
			if e != nil || end != json.Delim('}') {
				return nil, errors.New("INVALID_JSON")
			}
			return m, nil
		case json.Delim('['):
			a := []any{}
			for d.More() {
				v, e := value(depth + 1)
				if e != nil {
					return nil, e
				}
				a = append(a, v)
			}
			end, e := d.Token()
			if e != nil || end != json.Delim(']') {
				return nil, errors.New("INVALID_JSON")
			}
			return a, nil
		default:
			switch t.(type) {
			case nil, bool, string, json.Number:
				return t, nil
			}
			return nil, errors.New("INVALID_JSON")
		}
	}
	v, e := value(0)
	if e != nil {
		return nil, e
	}
	if _, e = d.Token(); e != io.EOF {
		return nil, errors.New("TRAILING_JSON")
	}
	m, ok := v.(map[string]any)
	if !ok {
		return nil, errors.New("ROOT_NOT_OBJECT")
	}
	return m, nil
}

func strict(c catalog, typ string, v any, path string) error {
	if s, ok := c.Types[typ]; ok {
		switch s.Kind {
		case "alias":
			return strict(c, s.Elem, v, path)
		case "pointer":
			if v == nil {
				return nil
			}
			return strict(c, s.Elem, v, path)
		case "slice":
			if v == nil {
				return nil
			}
			if s.Elem == "uint8" {
				if _, ok := v.(string); !ok {
					return fmt.Errorf("INVALID_BYTES at %s", path)
				}
				return nil
			}
			a, ok := v.([]any)
			if !ok {
				return fmt.Errorf("EXPECTED_ARRAY at %s", path)
			}
			for _, x := range a {
				if e := strict(c, s.Elem, x, path+"[]"); e != nil {
					return e
				}
			}
			return nil
		case "map":
			if v == nil {
				return nil
			}
			m, ok := v.(map[string]any)
			if !ok {
				return fmt.Errorf("EXPECTED_MAP at %s", path)
			}
			for _, k := range sortedKeys(m) {
				if e := strict(c, s.Elem, m[k], path+".*"); e != nil {
					return e
				}
			}
			return nil
		case "struct":
			m, ok := v.(map[string]any)
			if !ok {
				return fmt.Errorf("EXPECTED_OBJECT at %s", path)
			}
			known := map[string]bool{}
			for _, f := range s.Fields {
				known[f.Name] = true
				x, exists := m[f.Name]
				if !exists {
					if !f.Optional {
						return fmt.Errorf("MISSING_FIELD at %s.%s", path, f.Name)
					}
					continue
				}
				if e := strict(c, f.Type, x, path+"."+f.Name); e != nil {
					return e
				}
			}
			for k := range m {
				if !known[k] {
					return fmt.Errorf("UNKNOWN_FIELD at %s.<unknown>", path)
				}
			}
			return nil
		default:
			return errors.New("UNSUPPORTED_SCHEMA_KIND")
		}
	}
	switch typ {
	case "any", "json.RawMessage":
		return nil // opaque bytes are inventoried and block semantic acceptance
	case "string":
		if _, ok := v.(string); !ok {
			return fmt.Errorf("EXPECTED_STRING at %s", path)
		}
	case "bool":
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("EXPECTED_BOOL at %s", path)
		}
	case "time.Time":
		s, ok := v.(string)
		if !ok {
			return fmt.Errorf("EXPECTED_TIME at %s", path)
		}
		if _, e := time.Parse(time.RFC3339Nano, s); e != nil {
			return fmt.Errorf("INVALID_TIME at %s", path)
		}
	case "float64", "float32":
		n, ok := v.(json.Number)
		if !ok {
			return fmt.Errorf("EXPECTED_NUMBER at %s", path)
		}
		if _, e := n.Float64(); e != nil {
			return fmt.Errorf("INVALID_NUMBER at %s", path)
		}
	default:
		n, ok := v.(json.Number)
		if !ok || !integerPattern.MatchString(string(n)) {
			return fmt.Errorf("EXPECTED_EXACT_INTEGER at %s", path)
		}
		z, ok := new(big.Int).SetString(string(n), 10)
		if !ok {
			return fmt.Errorf("INVALID_INTEGER at %s", path)
		}
		bits := 64
		signed := !strings.HasPrefix(typ, "uint")
		switch typ {
		case "int", "int64", "uint", "uint64":
		case "int8", "uint8":
			bits = 8
		case "int16", "uint16":
			bits = 16
		case "int32", "uint32":
			bits = 32
		default:
			return errors.New("UNRESOLVED_SCHEMA_TYPE")
		}
		min := new(big.Int)
		max := new(big.Int).Lsh(big.NewInt(1), uint(bits))
		if signed {
			max.Rsh(max, 1)
			min.Neg(new(big.Int).Set(max))
		}
		max.Sub(max, big.NewInt(1))
		if z.Cmp(min) < 0 || z.Cmp(max) > 0 {
			return fmt.Errorf("INTEGER_OUT_OF_RANGE at %s", path)
		}
	}
	return nil
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// typedJSON reproduces the frozen source's encoding/json field order, time.Time
// encoding and omitempty behavior. It never reuses the result as migrated state.
func typedJSON(c catalog, name string, v any) ([]byte, error) {
	cache := map[string]reflect.Type{}
	var build func(string) reflect.Type
	build = func(n string) reflect.Type {
		if t := cache[n]; t != nil {
			return t
		}
		var t reflect.Type
		if s, ok := c.Types[n]; ok {
			switch s.Kind {
			case "alias":
				t = build(s.Elem)
			case "pointer":
				t = reflect.PointerTo(build(s.Elem))
			case "slice":
				t = reflect.SliceOf(build(s.Elem))
			case "map":
				t = reflect.MapOf(reflect.TypeOf(""), build(s.Elem))
			case "struct":
				f := make([]reflect.StructField, 0, len(s.Fields))
				for i, x := range s.Fields {
					tag := x.Name
					if x.Optional {
						tag += ",omitempty"
					}
					f = append(f, reflect.StructField{Name: fmt.Sprintf("F%d", i), Type: build(x.Type), Tag: reflect.StructTag(`json:"` + tag + `"`)})
				}
				t = reflect.StructOf(f)
			}
		} else {
			switch n {
			case "time.Time":
				t = reflect.TypeOf(time.Time{})
			case "json.RawMessage":
				t = reflect.TypeOf(json.RawMessage{})
			case "any":
				t = reflect.TypeOf((*any)(nil)).Elem()
			case "string":
				t = reflect.TypeOf("")
			case "bool":
				t = reflect.TypeOf(false)
			case "int":
				t = reflect.TypeOf(int(0))
			case "int8":
				t = reflect.TypeOf(int8(0))
			case "int16":
				t = reflect.TypeOf(int16(0))
			case "int32":
				t = reflect.TypeOf(int32(0))
			case "int64":
				t = reflect.TypeOf(int64(0))
			case "uint":
				t = reflect.TypeOf(uint(0))
			case "uint8":
				t = reflect.TypeOf(uint8(0))
			case "uint16":
				t = reflect.TypeOf(uint16(0))
			case "uint32":
				t = reflect.TypeOf(uint32(0))
			case "uint64":
				t = reflect.TypeOf(uint64(0))
			case "float64":
				t = reflect.TypeOf(float64(0))
			case "float32":
				t = reflect.TypeOf(float32(0))
			}
		}
		if t == nil {
			panic("unresolved frozen schema")
		}
		cache[n] = t
		return t
	}
	raw, e := json.Marshal(v)
	if e != nil {
		return nil, errors.New("TYPED_ENCODING_FAILED")
	}
	ptr := reflect.New(build(name))
	if json.Unmarshal(raw, ptr.Interface()) != nil {
		return nil, errors.New("TYPED_DECODING_FAILED")
	}
	return json.Marshal(ptr.Interface())
}
