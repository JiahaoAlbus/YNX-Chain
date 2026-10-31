// Package openprotocol implements the existing E framing with OPEN control
// bounds. It does not define domain labels or establish any authority.
package openprotocol

import (
	"encoding/binary"
	"errors"
)

const MaxControlBytes = 1048576
const MaxControlFields = 1024

var ErrInvalid = errors.New("invalid E control frame")
var ErrBounds = errors.New("E control frame bounds")

func EncodeFields(fields ...[]byte) ([]byte, error) {
	if len(fields) > MaxControlFields {
		return nil, ErrBounds
	}
	size := 4
	for _, f := range fields {
		if len(f) > MaxControlBytes || size > MaxControlBytes-4-len(f) {
			return nil, ErrBounds
		}
		size += 4 + len(f)
	}
	out := make([]byte, size)
	binary.BigEndian.PutUint32(out, uint32(len(fields)))
	at := 4
	for _, f := range fields {
		binary.BigEndian.PutUint32(out[at:], uint32(len(f)))
		at += 4
		copy(out[at:], f)
		at += len(f)
	}
	return out, nil
}

func DecodeFields(wire []byte, expectedCount int) ([][]byte, error) {
	if expectedCount < 0 || expectedCount > MaxControlFields || len(wire) > MaxControlBytes {
		return nil, ErrBounds
	}
	if len(wire) < 4+4*expectedCount || binary.BigEndian.Uint32(wire[:4]) != uint32(expectedCount) {
		return nil, ErrInvalid
	}
	// Validate before allocating any caller-selected field slice.
	type span struct{ start, end int }
	spans := make([]span, expectedCount)
	at := 4
	for i := range spans {
		if at > len(wire)-4 {
			return nil, ErrInvalid
		}
		n := uint64(binary.BigEndian.Uint32(wire[at : at+4]))
		at += 4
		if n > uint64(len(wire)-at) {
			return nil, ErrInvalid
		}
		spans[i] = span{at, at + int(n)}
		at += int(n)
	}
	if at != len(wire) {
		return nil, ErrInvalid
	}
	out := make([][]byte, len(spans))
	for i, s := range spans {
		out[i] = append([]byte{}, wire[s.start:s.end]...)
	}
	return out, nil
}
