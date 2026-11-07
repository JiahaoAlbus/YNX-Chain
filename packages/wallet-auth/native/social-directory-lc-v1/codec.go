// Package socialdirectorylc defines physical control DATA only, never authority.
package socialdirectorylc

import (
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"
)

const (
	RequestMaxBytes  = 393216
	ResponseMaxBytes = 524288
	MaxFrameBytes    = 81
)

var ErrFrame = errors.New("SOCIAL_LC_FRAME")
var ErrBinding = errors.New("SOCIAL_LC_FOREIGN_ORIGINAL")

type Binding struct {
	RequestOriginalSHA256      [32]byte
	RootResponseOriginalSHA256 [32]byte
}
type ErrorKind uint8

const (
	None ErrorKind = iota
	Code
	Retained
)

type ClosedAck struct {
	Closed       bool
	ErrorPresent bool
	ErrorKind    ErrorKind
	ErrorCode    int32
}

// Caller supplies independently authenticated Qualified9 request hash. Hashing
// arbitrary raw bytes alone is NOT qualification or a registered channel.
func BindOriginalBytes(request, response []byte, qualifiedRequestSHA [32]byte) (Binding, error) {
	if len(request) < 1 || len(request) > RequestMaxBytes || len(response) < 1 || len(response) > ResponseMaxBytes {
		return Binding{}, ErrFrame
	}
	b := Binding{sha256.Sum256(request), sha256.Sum256(response)}
	if b.RequestOriginalSHA256 != qualifiedRequestSHA {
		return Binding{}, ErrBinding
	}
	return b, nil
}
func validAck(a ClosedAck) bool {
	return a.ErrorKind <= Retained && (!a.ErrorPresent && a.ErrorKind == None && a.ErrorCode == 0 || a.ErrorPresent && (a.ErrorKind == Code || a.ErrorKind == Retained && a.ErrorCode == 0))
}
func encode(tag byte, b Binding, a ClosedAck) ([]byte, error) {
	n := 74
	if tag == 'A' {
		n = 81
		if !validAck(a) {
			return nil, ErrFrame
		}
	} else if tag != 'W' {
		return nil, ErrFrame
	}
	o := make([]byte, n)
	o[0] = tag
	binary.BigEndian.PutUint32(o[1:5], uint32(n-5))
	o[9] = 1
	copy(o[10:42], b.RequestOriginalSHA256[:])
	copy(o[42:74], b.RootResponseOriginalSHA256[:])
	if tag == 'A' {
		if a.Closed {
			o[74] = 1
		}
		if a.ErrorPresent {
			o[75] = 1
		}
		o[76] = byte(a.ErrorKind)
		binary.BigEndian.PutUint32(o[77:81], uint32(a.ErrorCode))
	}
	return o, nil
}
func EncodeReadRelease(b Binding) ([]byte, error)            { return encode('W', b, ClosedAck{}) }
func EncodeClosedAck(b Binding, a ClosedAck) ([]byte, error) { return encode('A', b, a) }
func decode(raw []byte, tag byte, expected Binding) (ClosedAck, error) {
	n := 74
	if tag == 'A' {
		n = 81
	}
	if len(raw) != n || raw[0] != tag || binary.BigEndian.Uint32(raw[1:5]) != uint32(n-5) || binary.BigEndian.Uint32(raw[5:9]) != 0 || raw[9] != 1 {
		return ClosedAck{}, ErrFrame
	}
	var b Binding
	copy(b.RequestOriginalSHA256[:], raw[10:42])
	copy(b.RootResponseOriginalSHA256[:], raw[42:74])
	if b != expected {
		return ClosedAck{}, ErrBinding
	}
	a := ClosedAck{}
	if tag == 'A' {
		if raw[74] > 1 || raw[75] > 1 {
			return a, ErrFrame
		}
		a = ClosedAck{raw[74] == 1, raw[75] == 1, ErrorKind(raw[76]), int32(binary.BigEndian.Uint32(raw[77:81]))}
		if !validAck(a) {
			return ClosedAck{}, ErrFrame
		}
	}
	return a, nil
}
func DecodeReadRelease(raw []byte, b Binding) error            { _, e := decode(raw, 'W', b); return e }
func DecodeClosedAck(raw []byte, b Binding) (ClosedAck, error) { return decode(raw, 'A', b) }

// Retain actual Go first error locally. Retained/0 is distinct from Code/0.
func ErrorFromLocal(err error, code *int32) (bool, ErrorKind, int32) {
	if err == nil {
		return false, None, 0
	}
	if code != nil {
		return true, Code, *code
	}
	return true, Retained, 0
}

// ReadControlFrame returns any partial original before its error. EOF is not A.
func ReadControlFrame(r io.Reader) ([]byte, error) {
	h := make([]byte, 1)
	n, e := io.ReadFull(r, h)
	if e != nil {
		return h[:n], e
	}
	size := 0
	if h[0] == 'W' {
		size = 74
	} else if h[0] == 'A' {
		size = 81
	} else {
		return h, ErrFrame
	}
	b := make([]byte, size)
	b[0] = h[0]
	n, e = io.ReadFull(r, b[1:])
	return b[:n+1], e
}
func WriteControlFrame(w io.Writer, raw []byte) error {
	if len(raw) != 74 && len(raw) != 81 {
		return ErrFrame
	}
	n, e := w.Write(raw)
	if e != nil {
		return e
	}
	if n != len(raw) {
		return io.ErrShortWrite
	}
	return nil
}
