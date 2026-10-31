package consensus

import (
	"bytes"
	"encoding/hex"
	"errors"
)

// This is an optimization ceiling, not an admission or protocol limit. Larger
// Whole envelopes and every other transport continue through the original JSON
// decoder in DecodePQTransaction.
const pqDecoderFastMaxWire = 64 << 10

// Bit 0 rejects non-lowercase hex; bit 1 means encoding/json must interpret the
// string/structure. In particular a late ordinary invalid hex byte is different
// from a quote, escape, control byte or UTF-8 sequence. Only the former can
// reproduce the reference decoder's parsed struct and wire error directly.
var pqDecoderHexClass = func() (classes [256]byte) {
	for b := range classes {
		if !(b >= '0' && b <= '9' || b >= 'a' && b <= 'f') {
			classes[b] = 1
		}
		if b < 0x20 || b >= 0x7f || b == '"' || b == '\\' {
			classes[b] |= 2
		}
	}
	return
}()

// tryDecodePQCanonicalWhole recognizes only the exact ordinary Whole JSON
// shape. No key, signature, policy, height, nonce or business decision is made
// here. EncodePQTransaction remains the canonical encoding oracle. The original
// parser handles all ambiguous JSON, preserving its errors and partially filled
// struct. At most 128 KiB of hex is scanned before that fallback, regardless of
// the much larger protocol admission limit.
func tryDecodePQCanonicalWhole(payload []byte) (PQTransaction, []byte, error, bool) {
	const prefix = `{"version":1,"type":"` + PQWholeType + `","wireHex":"`
	const suffix = `"}`
	if len(payload) <= len(prefix)+len(suffix) ||
		len(payload) > MaxPQWholeTransactionBytes ||
		len(payload) > len(prefix)+2*pqDecoderFastMaxWire+len(suffix) ||
		!bytes.HasPrefix(payload, []byte(prefix)) || !bytes.HasSuffix(payload, []byte(suffix)) {
		return PQTransaction{}, nil, nil, false
	}
	x := payload[len(prefix) : len(payload)-len(suffix)]
	var class byte
	for _, b := range x {
		class |= pqDecoderHexClass[b]
	}
	if class&2 != 0 {
		return PQTransaction{}, nil, nil, false
	}
	if class != 0 || len(x)&1 != 0 {
		// Scan the complete string before rejecting: a later structural byte
		// would make the original decoder return a JSON error instead. Do not
		// allocate a speculative wire for malformed plain ASCII hex.
		return PQTransaction{Version: 1, Type: PQWholeType, WireHex: string(x)}, nil,
			errors.New("noncanonical ABCI PQ wire"), true
	}
	wire := make([]byte, len(x)/2)
	if _, err := hex.Decode(wire, x); err != nil {
		return PQTransaction{}, nil, nil, false
	}
	canonical, err := EncodePQTransaction(PQWholeType, wire)
	if err != nil || !bytes.Equal(canonical, payload) {
		return PQTransaction{}, nil, nil, false
	}
	// Both outputs are owned copies, never views into caller-owned transport.
	return PQTransaction{Version: 1, Type: PQWholeType, WireHex: string(x)}, wire, nil, true
}
