package consensus

import (
	"encoding"
	"encoding/json"
	"reflect"
	"strings"
	"time"
	"unicode/utf8"
)

// Selected only by the explicit canonical native prefix decoder candidate.
// Reproduce the old JSON round-trip object for the closed native account/fee
// shape, retaining independent storage and rejecting any unsupported schema.
// Callers must retain original full validation and strict-JSON fallback.
func cloneCanonicalNativeCommittedState(state CommittedState) (CommittedState, bool) {
	private, ok := cloneNativeCommittedState(state)
	if !ok {
		return CommittedState{}, false
	}
	n := nativeCertificateNormalizer{plans: make(map[reflect.Type]nativeCertificateTypePlan)}
	if !n.normalize(reflect.ValueOf(&private).Elem()) {
		return CommittedState{}, false
	}
	return private, true
}

type nativeCertificateFieldPlan struct {
	index     int
	omitEmpty bool
}
type nativeCertificateTypePlan struct {
	supported bool
	fields    []nativeCertificateFieldPlan
}
type nativeCertificateNormalizer struct {
	plans map[reflect.Type]nativeCertificateTypePlan
}

func nativeCertificateJSONFieldName(name string) bool {
	if name == "" {
		return false
	}
	for _, c := range name {
		if c != '_' && (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') {
			return false
		}
	}
	return true
}

var nativeCertificateTimeType = reflect.TypeOf(time.Time{})
var nativeCertificateCodecs = []reflect.Type{
	reflect.TypeOf((*json.Marshaler)(nil)).Elem(),
	reflect.TypeOf((*json.Unmarshaler)(nil)).Elem(),
	reflect.TypeOf((*encoding.TextMarshaler)(nil)).Elem(),
	reflect.TypeOf((*encoding.TextUnmarshaler)(nil)).Elem(),
}

func (n *nativeCertificateNormalizer) plan(t reflect.Type) nativeCertificateTypePlan {
	if p, ok := n.plans[t]; ok {
		return p
	}
	p := nativeCertificateTypePlan{supported: true}
	for _, codec := range nativeCertificateCodecs {
		if t.Implements(codec) || reflect.PointerTo(t).Implements(codec) {
			p.supported = false
		}
	}
	if t.Kind() == reflect.Struct && p.supported {
		names := make(map[string]bool, t.NumField())
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			tag := strings.Split(f.Tag.Get("json"), ",")
			name := tag[0]
			if name == "" {
				name = f.Name
			}
			if f.PkgPath != "" || f.Anonymous || !nativeCertificateJSONFieldName(name) || names[name] {
				p.supported = false
				break
			}
			names[name] = true
			omit := false
			for _, option := range tag[1:] {
				if option == "omitempty" {
					omit = true
				} else if option != "" {
					p.supported = false
				}
			}
			p.fields = append(p.fields, nativeCertificateFieldPlan{index: i, omitEmpty: omit})
		}
	}
	if n.plans == nil {
		n.plans = make(map[reflect.Type]nativeCertificateTypePlan)
	}
	n.plans[t] = p
	return p
}

func nativeCertificateJSONEmpty(v reflect.Value) bool {
	switch v.Kind() {
	case reflect.Array, reflect.Map, reflect.Slice, reflect.String:
		return v.Len() == 0
	case reflect.Bool, reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64, reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return v.IsZero()
	}
	return false
}

func (n *nativeCertificateNormalizer) normalize(v reflect.Value) bool {
	if v.Type() == nativeCertificateTimeType {
		value := v.Interface().(time.Time)
		// UTC values have an exact allocation-free RFC3339 JSON round trip.
		// Other zones use time.Time's own codec, including offset normalization.
		if value.Location() == time.UTC && 0 <= value.Year() && value.Year() <= 9999 {
			canonical := value.Round(0).UTC()
			if canonical != value {
				v.Set(reflect.ValueOf(canonical))
			}
			return true
		}
		raw, err := value.MarshalJSON()
		if err != nil {
			return false
		}
		var canonical time.Time
		if err = canonical.UnmarshalJSON(raw); err != nil {
			return false
		}
		v.Set(reflect.ValueOf(canonical))
		return true
	}
	p := n.plan(v.Type())
	if !p.supported {
		return false
	}
	switch v.Kind() {
	case reflect.String:
		return utf8.ValidString(v.String())
	case reflect.Struct:
		for _, field := range p.fields {
			value := v.Field(field.index)
			if field.omitEmpty && nativeCertificateJSONEmpty(value) {
				value.SetZero()
				continue
			}
			if !n.normalize(value) {
				return false
			}
		}
		return true
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			if !n.normalize(v.Index(i)) {
				return false
			}
		}
		return true
	case reflect.Map:
		if v.Type() != reflect.TypeOf(map[string]int64{}) {
			return false
		}
		for iter := v.MapRange(); iter.Next(); {
			if !utf8.ValidString(iter.Key().String()) {
				return false
			}
		}
		return true
	default:
		return nativeCloneScalar(v.Kind())
	}
}
