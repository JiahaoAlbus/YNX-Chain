package productsessionv2

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Keep the established generic proof/header canonicalizer unchanged. Business
// bytes follow the JS wrapper's canonicalJSON and safe-integer rules, with valid
// Unicode scalar strings (unpaired UTF-16 surrogates are explicitly rejected).
func canonicalActionBody(raw []byte) (map[string]any, error) {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var body map[string]any
	if err := d.Decode(&body); err != nil || body == nil {
		return nil, errors.New("invalid action object")
	}
	var trailing any
	if d.Decode(&trailing) != io.EOF {
		return nil, errors.New("trailing action data")
	}
	var b strings.Builder
	if err := writeActionJSON(&b, body); err != nil || !bytes.Equal([]byte(b.String()), raw) {
		return nil, errors.New("noncanonical action bytes")
	}
	return body, nil
}
func writeActionJSON(b *strings.Builder, value any) error {
	switch v := value.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if v {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		writeActionString(b, v)
	case json.Number:
		n, err := strconv.ParseFloat(string(v), 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || math.Trunc(n) != n || math.Abs(n) > 9007199254740991 {
			return errors.New("unsafe action number")
		}
		b.WriteString(strconv.FormatInt(int64(n), 10))
	case []any:
		b.WriteByte('[')
		for i, child := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := writeActionJSON(b, child); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			a, c := utf16.Encode([]rune(keys[i])), utf16.Encode([]rune(keys[j]))
			for k := 0; k < len(a) && k < len(c); k++ {
				if a[k] != c[k] {
					return a[k] < c[k]
				}
			}
			return len(a) < len(c)
		})
		b.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeActionString(b, key)
			b.WriteByte(':')
			if err := writeActionJSON(b, v[key]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return errors.New("invalid action value")
	}
	return nil
}
func writeActionString(b *strings.Builder, value string) {
	b.WriteByte('"')
	const hex = "0123456789abcdef"
	for _, r := range value {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte(hex[r>>4])
				b.WriteByte(hex[r&15])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
