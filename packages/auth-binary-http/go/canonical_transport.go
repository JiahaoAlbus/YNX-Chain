package binaryhttpsource

// Outer canonicalJSON transport only, NOT the V5 E6 proof or BodyBind codec.
import (
	"bytes"
	"encoding/json"
	"sort"
	"strconv"
	"unicode/utf8"
)

func canonicalV5Transport(v any) ([]byte, error) {
	raw, e := json.Marshal(v)
	if e != nil {
		return nil, e
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var x any
	if d.Decode(&x) != nil {
		return nil, errRequest
	}
	var out bytes.Buffer
	var put func(any) error
	quote := func(s string) error {
		if !utf8.ValidString(s) {
			return errRequest
		}
		out.WriteByte('"')
		for _, r := range s {
			switch r {
			case '"':
				out.WriteString(`\"`)
			case '\\':
				out.WriteString(`\\`)
			case '\b':
				out.WriteString(`\b`)
			case '\f':
				out.WriteString(`\f`)
			case '\n':
				out.WriteString(`\n`)
			case '\r':
				out.WriteString(`\r`)
			case '\t':
				out.WriteString(`\t`)
			default:
				if r < 32 {
					h := strconv.FormatInt(int64(r), 16)
					out.WriteString(`\u`)
					for n := len(h); n < 4; n++ {
						out.WriteByte('0')
					}
					out.WriteString(h)
				} else {
					out.WriteRune(r)
				}
			}
		}
		out.WriteByte('"')
		return nil
	}
	put = func(v any) error {
		switch y := v.(type) {
		case nil:
			out.WriteString("null")
		case bool:
			out.WriteString(strconv.FormatBool(y))
		case json.Number:
			out.WriteString(string(y))
		case string:
			return quote(y)
		case []any:
			out.WriteByte('[')
			for i, z := range y {
				if i > 0 {
					out.WriteByte(',')
				}
				if e := put(z); e != nil {
					return e
				}
			}
			out.WriteByte(']')
		case map[string]any:
			keys := make([]string, 0, len(y))
			for k := range y {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			out.WriteByte('{')
			for i, k := range keys {
				if i > 0 {
					out.WriteByte(',')
				}
				if e := quote(k); e != nil {
					return e
				}
				out.WriteByte(':')
				if e := put(y[k]); e != nil {
					return e
				}
			}
			out.WriteByte('}')
		default:
			return errRequest
		}
		return nil
	}
	if e = put(x); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}
