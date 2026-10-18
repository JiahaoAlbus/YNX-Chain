package ynxconsensusauth

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	// Version remains the v1 key-record version; it is not the signing profile.
	Version                     uint32 = 1
	ConsensusGenesisVersion     uint32 = 2
	MLDSA87PublicKeySize               = 2592
	SLHDSASHA2256fPublicKeySize        = 64
	MLDSA87SignatureSize               = 4627
	SLHDSASHA2256fSignatureSize        = 49856
	envelopeTag                        = "YNX-CONSENSUS-SIG/v0.2\x00"
	// These identifiers belong only to this candidate consensus codec.
	algorithmMLDSA87        uint32 = 1
	algorithmSLHDSASHA2256f uint32 = 2
	EnvelopeSize                   = len(envelopeTag) + 4 + 8 + 4 + 4 + MLDSA87SignatureSize + 4 + 4 + SLHDSASHA2256fSignatureSize
)

// Envelope never contains public keys. Verification obtains the complete pair
// from the trusted historical validator registry, rather than from this wire.
type Envelope struct {
	KeyEpoch       uint64
	MLDSA87        []byte
	SLHDSASHA2256f []byte
}

func (e Envelope) MarshalBinary() ([]byte, error) {
	if e.KeyEpoch == 0 || len(e.MLDSA87) != MLDSA87SignatureSize || len(e.SLHDSASHA2256f) != SLHDSASHA2256fSignatureSize {
		return nil, errors.New("invalid consensus signature envelope")
	}
	out := make([]byte, 0, EnvelopeSize)
	out = append(out, envelopeTag...)
	out = binary.BigEndian.AppendUint32(out, ConsensusGenesisVersion)
	out = binary.BigEndian.AppendUint64(out, e.KeyEpoch)
	out = binary.BigEndian.AppendUint32(out, algorithmMLDSA87)
	out = appendField(out, e.MLDSA87)
	out = binary.BigEndian.AppendUint32(out, algorithmSLHDSASHA2256f)
	out = appendField(out, e.SLHDSASHA2256f)
	return out, nil
}

// ParseEnvelope checks the whole wire size before allocation and rejects
// truncation, trailing bytes, swapped branches, unknown versions and lengths.
func ParseEnvelope(wire []byte) (Envelope, error) {
	var e Envelope
	if len(wire) != EnvelopeSize || !bytes.HasPrefix(wire, []byte(envelopeTag)) {
		return e, errors.New("invalid consensus signature envelope size or tag")
	}
	p := len(envelopeTag)
	read32 := func() uint32 { n := binary.BigEndian.Uint32(wire[p : p+4]); p += 4; return n }
	if read32() != ConsensusGenesisVersion {
		return e, errors.New("unsupported consensus signature version")
	}
	e.KeyEpoch = binary.BigEndian.Uint64(wire[p : p+8])
	p += 8
	if e.KeyEpoch == 0 {
		return Envelope{}, errors.New("zero key epoch")
	}
	if read32() != algorithmMLDSA87 || read32() != MLDSA87SignatureSize {
		return Envelope{}, errors.New("invalid ML-DSA branch encoding")
	}
	e.MLDSA87 = bytes.Clone(wire[p : p+MLDSA87SignatureSize])
	p += MLDSA87SignatureSize
	if read32() != algorithmSLHDSASHA2256f || read32() != SLHDSASHA2256fSignatureSize {
		return Envelope{}, errors.New("invalid SLH-DSA branch encoding")
	}
	e.SLHDSASHA2256f = bytes.Clone(wire[p : p+SLHDSASHA2256fSignatureSize])
	p += SLHDSASHA2256fSignatureSize
	if p != len(wire) {
		return Envelope{}, fmt.Errorf("unexpected trailing bytes: %d", len(wire)-p)
	}
	return e, nil
}

func appendField(dst, field []byte) []byte {
	dst = binary.BigEndian.AppendUint32(dst, uint32(len(field)))
	return append(dst, field...)
}
