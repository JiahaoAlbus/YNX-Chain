package types

import (
	"github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/crypto/ynxpq"
	cmtmath "github.com/cometbft/cometbft/libs/math"
)

var (
	// MaxSignatureSize preserves the historical classical limit. YNX v0.2
	// signatures are admitted only with exact envelope framing below.
	// XXX: secp256k1 does not have Size nor MaxSize defined.
	MaxSignatureSize = cmtmath.MaxInt(ed25519.SignatureSize, 64)
)

// Signable is an interface for all signable things.
// It typically removes signatures before serializing.
// SignBytes returns the bytes to be signed
// NOTE: chainIDs are part of the SignBytes but not
// necessarily the object themselves.
// NOTE: Expected to panic if there is an error marshaling.
type Signable interface {
	SignBytes(chainID string) []byte
}

// validConsensusSignatureSize preserves all old <=64-byte admission rules and
// only adds the exact frozen YNX envelope. It is NOT signature verification or
// activation; the actual public key must verify with a trusted authorizer.
func validConsensusSignatureSize(signature []byte) bool {
	return len(signature) <= MaxSignatureSize || ynxpq.ValidateEnvelope(signature) == nil
}
