package executionstate

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"unicode/utf8"
)

// streamLexer enforces the encoded token limit while reading bytes, before any
// JSON string unmarshal or numeric conversion can allocate an unbounded token.
type streamLexer struct {
	r      *bufio.Reader
	max    int
	buf    []byte
	tokens int64
}
type streamToken struct {
	kind  byte
	value any
}

var jsonNumberSyntax = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`)

func (l *streamLexer) appendByte(b byte) error {
	if len(l.buf) >= l.max {
		return errors.New("STREAM_TOKEN_BUDGET_EXCEEDED")
	}
	if len(l.buf) == cap(l.buf) {
		capacity := cap(l.buf) * 2
		if capacity < 64 {
			capacity = 64
		}
		if capacity > l.max {
			capacity = l.max
		}
		next := make([]byte, len(l.buf), capacity)
		copy(next, l.buf)
		l.buf = next
	}
	l.buf = append(l.buf, b)
	return nil
}
func (l *streamLexer) next() (streamToken, error) {
	l.tokens++
	var b byte
	for {
		v, e := l.r.ReadByte()
		if e != nil {
			return streamToken{}, e
		}
		if v != ' ' && v != '\n' && v != '\r' && v != '\t' {
			b = v
			break
		}
	}
	if b == '{' || b == '}' || b == '[' || b == ']' || b == ':' || b == ',' {
		return streamToken{kind: b}, nil
	}
	l.buf = l.buf[:0]
	if e := l.appendByte(b); e != nil {
		return streamToken{}, e
	}
	if b == '"' {
		escaped := false
		for {
			v, e := l.r.ReadByte()
			if e != nil {
				return streamToken{}, errors.New("INVALID_JSON")
			}
			if e = l.appendByte(v); e != nil {
				return streamToken{}, e
			}
			if v == '"' && !escaped {
				break
			}
			if v == '\\' && !escaped {
				escaped = true
			} else {
				escaped = false
			}
		}
		if !utf8.Valid(l.buf) || !validJSONSurrogates(l.buf) {
			return streamToken{}, errors.New("INVALID_JSON_UNICODE")
		}
		var s string
		if json.Unmarshal(l.buf, &s) != nil {
			return streamToken{}, errors.New("INVALID_JSON")
		}
		return streamToken{kind: 's', value: s}, nil
	}
	if b == '-' || (b >= '0' && b <= '9') {
		for {
			v, e := l.r.ReadByte()
			if e == io.EOF {
				break
			}
			if e != nil {
				return streamToken{}, errors.New("INPUT_READ_FAILED")
			}
			if !(v == '-' || v == '+' || v == '.' || v == 'e' || v == 'E' || (v >= '0' && v <= '9')) {
				if l.r.UnreadByte() != nil {
					return streamToken{}, errors.New("INVALID_JSON")
				}
				break
			}
			if e = l.appendByte(v); e != nil {
				return streamToken{}, e
			}
		}
		if !jsonNumberSyntax.Match(l.buf) {
			return streamToken{}, errors.New("INVALID_JSON")
		}
		return streamToken{kind: 'n', value: json.Number(string(l.buf))}, nil
	}
	for _, word := range []string{"true", "false", "null"} {
		if b != word[0] {
			continue
		}
		for i := 1; i < len(word); i++ {
			v, e := l.r.ReadByte()
			if e != nil || v != word[i] {
				return streamToken{}, errors.New("INVALID_JSON")
			}
		}
		if word == "null" {
			return streamToken{kind: '0'}, nil
		}
		return streamToken{kind: 'b', value: word == "true"}, nil
	}
	return streamToken{}, errors.New("INVALID_JSON")
}

// encoding/json replaces unpaired surrogate escapes. Reject them instead of
// permitting different input strings to silently collapse to the same value.
func validJSONSurrogates(raw []byte) bool {
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw)-1 {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw)-1 {
			return false
		}
		v, e := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if e != nil {
			return false
		}
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(raw)-1 || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			w, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || w < 0xdc00 || w > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}
