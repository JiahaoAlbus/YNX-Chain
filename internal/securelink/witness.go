package securelink

import (
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
)

type Binding struct{ Bytes, SHA3_512, SHA512 string }

// ReconstituteWitness (LINK-05) restores original bytes only. A successful
// integrity check is never a signature, authorization or consensus decision;
// the caller still passes these exact bytes to the original verifier.
func ReconstituteWitness(expected Binding, chunks [][]byte, limit uint64) ([]byte, error) {
	length, err := canonicalU(expected.Bytes)
	if err != nil {
		return nil, err
	}
	if limit == 0 || limit > 16<<20 || length > limit || len(chunks) > 4096 {
		return nil, ErrBounds
	}
	if !digest(expected.SHA3_512, 128) || !digest(expected.SHA512, 128) {
		return nil, ErrDenied
	}
	var total uint64
	for _, chunk := range chunks {
		if uint64(len(chunk)) > length-total {
			return nil, ErrBounds
		}
		total += uint64(len(chunk))
	}
	if total != length {
		return nil, ErrUnavailable
	}
	out := make([]byte, 0, int(length))
	for _, chunk := range chunks {
		out = append(out, chunk...)
	}
	a := sha3.Sum512(out)
	b := sha512.Sum512(out)
	if hex.EncodeToString(a[:]) != expected.SHA3_512 || hex.EncodeToString(b[:]) != expected.SHA512 {
		clear(out)
		return nil, ErrDenied
	}
	return out, nil
}
