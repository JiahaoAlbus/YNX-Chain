package consensus

import (
	"reflect"
	"sync"
	"unicode/utf8"
)

// A plan owns only immutable schema metadata, never a state, payload or account.
// Build child plans once instead of looking up a type for each field of every
// account/fee row. Unsupported children remain deferred until actually visited:
// omitted empty fields and empty slices retain the original JSON semantics.
type nativeCertificateValuePlan struct {
	supported bool
	isTime    bool
	kind      reflect.Kind
	fields    []nativeCertificateValueField
	element   *nativeCertificateValuePlan
}
type nativeCertificateValueField struct {
	index     int
	omitEmpty bool
	value     *nativeCertificateValuePlan
}

var canonicalNativeCommittedValuePlan = sync.OnceValue(func() *nativeCertificateValuePlan {
	return compileNativeCertificateValuePlan(reflect.TypeOf(CommittedState{}))
})

func compileNativeCertificateValuePlan(t reflect.Type) *nativeCertificateValuePlan {
	normalizer := nativeCertificateNormalizer{plans: make(map[reflect.Type]nativeCertificateTypePlan)}
	built := make(map[reflect.Type]*nativeCertificateValuePlan)
	var build func(reflect.Type) *nativeCertificateValuePlan
	build = func(t reflect.Type) *nativeCertificateValuePlan {
		if value, ok := built[t]; ok {
			return value
		}
		value := &nativeCertificateValuePlan{kind: t.Kind()}
		built[t] = value
		if t == nativeCertificateTimeType {
			value.supported, value.isTime = true, true
			return value
		}
		original := normalizer.plan(t)
		if !original.supported {
			return value
		}
		value.supported = true
		switch t.Kind() {
		case reflect.Struct:
			for _, field := range original.fields {
				value.fields = append(value.fields, nativeCertificateValueField{index: field.index, omitEmpty: field.omitEmpty, value: build(t.Field(field.index).Type)})
			}
		case reflect.Slice:
			value.element = build(t.Elem())
		case reflect.Map:
			value.supported = t == reflect.TypeOf(map[string]int64{})
		default:
			value.supported = nativeCloneScalar(t.Kind())
		}
		return value
	}
	return build(t)
}

func (p *nativeCertificateValuePlan) normalize(v reflect.Value) bool {
	if !p.supported {
		return false
	}
	if p.isTime {
		return normalizeNativeCertificateTime(v)
	}
	switch p.kind {
	case reflect.String:
		return utf8.ValidString(v.String())
	case reflect.Struct:
		for _, field := range p.fields {
			value := v.Field(field.index)
			if field.omitEmpty && nativeCertificateJSONEmpty(value) {
				value.SetZero()
				continue
			}
			if !field.value.normalize(value) {
				return false
			}
		}
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			if !p.element.normalize(v.Index(i)) {
				return false
			}
		}
	case reflect.Map:
		for iter := v.MapRange(); iter.Next(); {
			if !utf8.ValidString(iter.Key().String()) {
				return false
			}
		}
	}
	return true
}
