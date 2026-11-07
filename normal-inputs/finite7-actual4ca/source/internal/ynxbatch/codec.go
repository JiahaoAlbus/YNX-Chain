// Package ynxbatch implements the fixed YNX-BATCH/v0.1 wire protocol.
// Parsing and tree membership never establish account authority by themselves.
package ynxbatch

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	Version               = "YNX-BATCH/v0.1"
	Suite                 = "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"
	MaxN                  = 1024
	MaxMessageBytes       = 1048576
	MaxAggregateBytes     = 8388608
	MaxCertificateBytes   = 65536
	MaxProofBytes         = 1388
	MaxMessagesFrameBytes = 8392708
	MaxWholeBytes         = 16 + len(Version+"/WHOLE") + MaxCertificateBytes + MaxMessagesFrameBytes
	MaxMemberBytes        = 20 + len(Version+"/MEMBER") + MaxCertificateBytes + MaxMessageBytes + MaxProofBytes
	PublicKeyASize        = 2592
	PublicKeyBSize        = 64
	SignatureASize        = 4627
	SignatureBSize        = 49856
)

var ErrProtocol = errors.New("invalid YNX-BATCH/v0.1 protocol")

func invalid(reason string) error { return fmt.Errorf("%w: %s", ErrProtocol, reason) }
func clone(b []byte) []byte       { return bytes.Clone(b) }

type Context struct {
	ChainID  []byte
	Owner    string
	PKA, PKB []byte
	BatchID  []byte
	Purpose  string
}
type Descriptor struct {
	Context
	N            uint32
	RootA, RootB []byte
}
type Certificate struct {
	Descriptor
	SigmaA, SigmaB []byte
}
type Proof struct {
	Index        uint32
	PathA, PathB [][]byte
}
type Member struct {
	Certificate Certificate
	Message     []byte
	Proof
}
type Whole struct {
	Certificate Certificate
	Messages    [][]byte
}

func validASCII(s string, max int) bool {
	if len(s) < 1 || len(s) > max {
		return false
	}
	for i := range s {
		if s[i] < 32 || s[i] > 126 {
			return false
		}
	}
	return true
}
func validN(n uint32) bool { return n > 0 && n <= MaxN && n&(n-1) == 0 }
func depth(n uint32) int {
	d := 0
	for n > 1 {
		n >>= 1
		d++
	}
	return d
}
func u32(n uint32) []byte { var b [4]byte; binary.BigEndian.PutUint32(b[:], n); return b[:] }

// U32 encodes exactly four big-endian bytes. Larger business integers must be
// encoded explicitly by their enclosing versioned protocol, never truncated.
func U32(n uint32) []byte { return u32(n) }

// DecodeFields returns detached fields after strict framing validation. The
// enclosing protocol must also validate each field's tag, length and meaning.
func DecodeFields(wire []byte, expected, maxBytes int) ([][]byte, error) {
	if maxBytes < 4 || maxBytes > MaxWholeBytes {
		return nil, invalid("frame limit")
	}
	f, err := fields(wire, expected, maxBytes)
	if err != nil {
		return nil, err
	}
	return copyMessages(f), nil
}

// EncodeFields is the unique E(x1,...,xk) grammar. It does not grant authority.
func EncodeFields(fields ...[]byte) ([]byte, error) {
	if len(fields) > MaxN {
		return nil, invalid("field count")
	}
	size := 4
	for _, f := range fields {
		if len(f) > MaxWholeBytes || size > MaxWholeBytes-4-len(f) {
			return nil, invalid("frame too large")
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

// fields validates lengths before copying data or allocating caller-sized slices.
// The returned views are private to the decoding functions below.
func fields(wire []byte, count, max int, caps ...int) ([][]byte, error) {
	if count < 0 || count > MaxN || len(wire) > max || len(wire) < 4+4*count || binary.BigEndian.Uint32(wire[:4]) != uint32(count) {
		return nil, invalid("field count or frame size")
	}
	result := make([][]byte, count)
	at := 4
	for i := range result {
		if at > len(wire)-4 {
			return nil, invalid("missing field length")
		}
		n := uint64(binary.BigEndian.Uint32(wire[at : at+4]))
		at += 4
		cap := max
		if i < len(caps) {
			cap = caps[i]
		}
		if n > uint64(cap) || n > uint64(len(wire)-at) {
			return nil, invalid("field size")
		}
		result[i] = wire[at : at+int(n)]
		at += int(n)
	}
	if at != len(wire) {
		return nil, invalid("trailing bytes")
	}
	return result, nil
}

func validateContext(c Context) error {
	if len(c.ChainID) != 32 || !validASCII(c.Owner, 128) || len(c.PKA) != PublicKeyASize || len(c.PKB) != PublicKeyBSize || len(c.BatchID) != 16 || !validASCII(c.Purpose, 64) {
		return invalid("context size or ASCII")
	}
	return nil
}
func EncodeContext(c Context) ([]byte, error) {
	if err := validateContext(c); err != nil {
		return nil, err
	}
	return EncodeFields([]byte(Version+"/CONTEXT"), []byte(Suite), c.ChainID, []byte(c.Owner), c.PKA, c.PKB, c.BatchID, []byte(c.Purpose))
}
func DecodeContext(wire []byte) (c Context, err error) {
	f, err := fields(wire, 8, MaxCertificateBytes, 64, 64, 32, 128, PublicKeyASize, PublicKeyBSize, 16, 64)
	if err != nil {
		return c, err
	}
	if string(f[0]) != Version+"/CONTEXT" || string(f[1]) != Suite {
		return c, invalid("context tag or suite")
	}
	c = Context{ChainID: clone(f[2]), Owner: string(f[3]), PKA: clone(f[4]), PKB: clone(f[5]), BatchID: clone(f[6]), Purpose: string(f[7])}
	return c, validateContext(c)
}
func EncodeDescriptor(d Descriptor) ([]byte, error) {
	c, err := EncodeContext(d.Context)
	if err != nil {
		return nil, err
	}
	if !validN(d.N) || len(d.RootA) != 64 || len(d.RootB) != 64 {
		return nil, invalid("descriptor size or N")
	}
	return EncodeFields([]byte(Version+"/DESCRIPTOR"), c, u32(d.N), d.RootA, d.RootB)
}
func DecodeDescriptor(wire []byte) (d Descriptor, err error) {
	f, err := fields(wire, 5, MaxCertificateBytes, 64, MaxCertificateBytes, 4, 64, 64)
	if err != nil {
		return d, err
	}
	if string(f[0]) != Version+"/DESCRIPTOR" || len(f[2]) != 4 || len(f[3]) != 64 || len(f[4]) != 64 {
		return d, invalid("descriptor tag or size")
	}
	d.Context, err = DecodeContext(f[1])
	if err != nil {
		return d, err
	}
	d.N = binary.BigEndian.Uint32(f[2])
	if !validN(d.N) {
		return d, invalid("N")
	}
	d.RootA = clone(f[3])
	d.RootB = clone(f[4])
	return d, nil
}
func EncodeCertificate(c Certificate) ([]byte, error) {
	d, err := EncodeDescriptor(c.Descriptor)
	if err != nil {
		return nil, err
	}
	if len(c.SigmaA) != SignatureASize || len(c.SigmaB) != SignatureBSize {
		return nil, invalid("signature size")
	}
	w, err := EncodeFields(d, c.SigmaA, c.SigmaB)
	if err != nil {
		return nil, err
	}
	if len(w) > MaxCertificateBytes {
		return nil, invalid("certificate too large")
	}
	return w, nil
}
func DecodeCertificate(wire []byte) (c Certificate, err error) {
	f, err := fields(wire, 3, MaxCertificateBytes, MaxCertificateBytes, SignatureASize, SignatureBSize)
	if err != nil {
		return c, err
	}
	if len(f[1]) != SignatureASize || len(f[2]) != SignatureBSize {
		return c, invalid("signature size")
	}
	c.Descriptor, err = DecodeDescriptor(f[0])
	if err != nil {
		return c, err
	}
	c.SigmaA = clone(f[1])
	c.SigmaB = clone(f[2])
	return c, nil
}
func ValidateMessages(messages [][]byte, n uint32) error {
	if !validN(n) || uint64(len(messages)) != uint64(n) {
		return invalid("message count")
	}
	total := 0
	for _, m := range messages {
		if len(m) > MaxMessageBytes || len(m) > MaxAggregateBytes-total {
			return invalid("message or aggregate limit")
		}
		total += len(m)
	}
	return nil
}
func validateProof(p Proof, n uint32) error {
	if !validN(n) || p.Index >= n {
		return invalid("proof index or N")
	}
	d := depth(n)
	for _, path := range [][][]byte{p.PathA, p.PathB} {
		if len(path) != d {
			return invalid("path depth")
		}
		for _, node := range path {
			if len(node) != 64 {
				return invalid("path node size")
			}
		}
	}
	return nil
}
func EncodeProof(p Proof, n uint32) ([]byte, error) {
	if err := validateProof(p, n); err != nil {
		return nil, err
	}
	a, err := EncodeFields(p.PathA...)
	if err != nil {
		return nil, err
	}
	b, err := EncodeFields(p.PathB...)
	if err != nil {
		return nil, err
	}
	return EncodeFields(u32(p.Index), a, b)
}
func DecodeProof(wire []byte, n uint32) (p Proof, err error) {
	if !validN(n) {
		return p, invalid("N")
	}
	d := depth(n)
	f, err := fields(wire, 3, MaxProofBytes, 4, 4+68*d, 4+68*d)
	if err != nil {
		return p, err
	}
	if len(f[0]) != 4 {
		return p, invalid("proof index size")
	}
	p.Index = binary.BigEndian.Uint32(f[0])
	paths := []*[][]byte{&p.PathA, &p.PathB}
	for i, out := range paths {
		v, e := fields(f[i+1], d, 4+68*d)
		if e != nil {
			return p, e
		}
		*out = make([][]byte, d)
		for j, node := range v {
			if len(node) != 64 {
				return p, invalid("path node size")
			}
			(*out)[j] = clone(node)
		}
	}
	return p, validateProof(p, n)
}
func EncodeWhole(w Whole) ([]byte, error) {
	if err := ValidateMessages(w.Messages, w.Certificate.N); err != nil {
		return nil, err
	}
	c, err := EncodeCertificate(w.Certificate)
	if err != nil {
		return nil, err
	}
	m, err := EncodeFields(w.Messages...)
	if err != nil {
		return nil, err
	}
	return EncodeFields([]byte(Version+"/WHOLE"), c, m)
}
func DecodeWhole(wire []byte) (w Whole, err error) {
	f, err := fields(wire, 3, MaxWholeBytes, 64, MaxCertificateBytes, MaxMessagesFrameBytes)
	if err != nil {
		return w, err
	}
	if string(f[0]) != Version+"/WHOLE" {
		return w, invalid("whole tag")
	}
	w.Certificate, err = DecodeCertificate(f[1])
	if err != nil {
		return w, err
	}
	m, err := fields(f[2], int(w.Certificate.N), MaxMessagesFrameBytes)
	if err != nil {
		return w, err
	}
	if err = ValidateMessages(m, w.Certificate.N); err != nil {
		return w, err
	}
	w.Messages = copyMessages(m)
	return w, nil
}
func EncodeMember(m Member) ([]byte, error) {
	if len(m.Message) > MaxMessageBytes {
		return nil, invalid("message size")
	}
	c, err := EncodeCertificate(m.Certificate)
	if err != nil {
		return nil, err
	}
	p, err := EncodeProof(m.Proof, m.Certificate.N)
	if err != nil {
		return nil, err
	}
	return EncodeFields([]byte(Version+"/MEMBER"), c, m.Message, p)
}
func DecodeMember(wire []byte) (m Member, err error) {
	f, err := fields(wire, 4, MaxMemberBytes, 64, MaxCertificateBytes, MaxMessageBytes, MaxProofBytes)
	if err != nil {
		return m, err
	}
	if string(f[0]) != Version+"/MEMBER" {
		return m, invalid("member tag")
	}
	m.Certificate, err = DecodeCertificate(f[1])
	if err != nil {
		return m, err
	}
	m.Proof, err = DecodeProof(f[3], m.Certificate.N)
	if err != nil {
		return m, err
	}
	m.Message = clone(f[2])
	return m, nil
}
func copyMessages(messages [][]byte) [][]byte {
	out := make([][]byte, len(messages))
	for i, m := range messages {
		out[i] = clone(m)
	}
	return out
}
