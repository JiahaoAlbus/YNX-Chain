// Inspect schema re-encoding without emitting state values, identifiers or keys.
// This read-only diagnostic never authenticates, rewrites or migrates state.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/social"
)

func main() {
	path := flag.String("state", "", "Private state copy to compare; never production output")
	flag.Parse()
	if *path == "" {
		fail("a private state copy is required")
	}
	raw, err := os.ReadFile(*path)
	if err != nil {
		fail("cannot read private state copy")
	}
	field, ok := reflect.TypeOf(social.Service{}).FieldByName("state")
	if !ok {
		fail("state schema is unavailable")
	}
	value := reflect.New(field.Type)
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(value.Interface()) != nil {
		fail("strict state decode failed")
	}
	state := value.Elem()
	for i := 0; i < state.NumField(); i++ {
		item := state.Field(i)
		if item.Kind() == reflect.Map && item.IsNil() {
			item.Set(reflect.MakeMap(item.Type()))
		}
		if field.Type.Field(i).Name == "Audit" && item.IsNil() {
			item.Set(reflect.MakeSlice(item.Type(), 0, 0))
		}
	}
	state.FieldByName("IntegrityHash").SetString("")
	encoded, err := json.Marshal(value.Interface())
	if err != nil {
		fail("state re-encoding failed")
	}
	var original, candidate map[string]json.RawMessage
	if json.Unmarshal(raw, &original) != nil || json.Unmarshal(encoded, &candidate) != nil {
		fail("state comparison decode failed")
	}
	paths := map[string]bool{}
	for i := 0; i < field.Type.NumField(); i++ {
		member := field.Type.Field(i)
		name := strings.Split(member.Tag.Get("json"), ",")[0]
		if name == "integrityHash" {
			continue
		}
		var compact bytes.Buffer
		if json.Compact(&compact, original[name]) != nil {
			paths["$."+name+":missing-field"] = true
			continue
		}
		if bytes.Equal(compact.Bytes(), candidate[name]) {
			continue
		}
		var left, right any
		if json.Unmarshal(original[name], &left) != nil || json.Unmarshal(candidate[name], &right) != nil {
			fail("field comparison decode failed")
		}
		if reflect.DeepEqual(left, right) {
			paths["$."+name+":byte-encoding-only"] = true
		} else {
			compare(member.Type, left, right, "$."+name, paths)
		}
	}
	output := make([]string, 0, len(paths))
	for path := range paths {
		output = append(output, path)
	}
	sort.Strings(output)
	if json.NewEncoder(os.Stdout).Encode(map[string]any{"differentFieldPaths": output, "stateValuesEmitted": false}) != nil {
		os.Exit(1)
	}
}

func compare(kind reflect.Type, left, right any, path string, paths map[string]bool) {
	if reflect.DeepEqual(left, right) {
		return
	}
	for kind.Kind() == reflect.Pointer {
		kind = kind.Elem()
	}
	if kind == reflect.TypeOf(time.Time{}) {
		paths[path+":timestamp-encoding"] = true
		return
	}
	switch kind.Kind() {
	case reflect.Struct:
		l, lok := left.(map[string]any)
		r, rok := right.(map[string]any)
		if !lok || !rok {
			break
		}
		for i := 0; i < kind.NumField(); i++ {
			member := kind.Field(i)
			name := strings.Split(member.Tag.Get("json"), ",")[0]
			if name == "" || name == "-" {
				continue
			}
			lv, lp := l[name]
			rv, rp := r[name]
			if lp != rp {
				paths[path+"."+name+":field-presence"] = true
			} else {
				compare(member.Type, lv, rv, path+"."+name, paths)
			}
		}
		return
	case reflect.Map:
		l, lok := left.(map[string]any)
		r, rok := right.(map[string]any)
		if !lok || !rok {
			break
		}
		for key, item := range l {
			compare(kind.Elem(), item, r[key], path+".*", paths)
		}
		for key := range r {
			if _, present := l[key]; !present {
				paths[path+".*:map-entry-presence"] = true
			}
		}
		return
	case reflect.Slice, reflect.Array:
		l, lok := left.([]any)
		r, rok := right.([]any)
		if !lok || !rok || len(l) != len(r) {
			break
		}
		for i := range l {
			compare(kind.Elem(), l[i], r[i], path+"[]", paths)
		}
		return
	}
	paths[path+":value-or-null-encoding"] = true
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
