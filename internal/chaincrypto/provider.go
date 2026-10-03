// Package chaincrypto is an isolated, inactive protocol candidate. Importing it
// does not change the original chain's authentication or consensus rules.
package chaincrypto

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"errors"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

const (
	MaxAuthMessage   = 1 << 20
	AccountContext   = "YNX/EXPERIMENT/TX-AUTH/V2"
	ConsensusContext = "YNX/EXPERIMENT/CONS-AUTH/V2"
)

var ErrInvalid = errors.New("invalid hybrid authentication")

type PublicKeys struct{ Classical, PostQuantum []byte }
type Signatures struct{ Classical, PostQuantum []byte }

// CryptoProvider validates both signatures over one complete canonical message.
// Account classical hashing preserves SHA-256; pure ML-DSA signs the full bytes.
type CryptoProvider interface {
	VerifyAccount(PublicKeys, []byte, Signatures) error
	VerifyConsensus(PublicKeys, []byte, Signatures) error
}

type CIRCLProvider struct{}

func verifyPQ(key, message, signature []byte, context string) bool {
	if len(key) != mldsa87.PublicKeySize || len(signature) != mldsa87.SignatureSize || len(message) == 0 || len(message) > MaxAuthMessage {
		return false
	}
	var pk mldsa87.PublicKey
	if pk.UnmarshalBinary(key) != nil {
		return false
	}
	return mldsa87.Verify(&pk, message, []byte(context), signature)
}

func (CIRCLProvider) VerifyAccount(keys PublicKeys, message []byte, signatures Signatures) error {
	if !boundedKeys(keys) || !boundedSignatures(signatures) || len(message) > MaxAuthMessage {
		return ErrInvalid
	}
	keys = snapshotKeys(keys)
	message = append([]byte(nil), message...)
	signatures = snapshotSignatures(signatures)
	// Reject lengths and encodings before expensive PQ validation.
	if len(keys.Classical) != secp256k1.PubKeyBytesLenCompressed || len(signatures.Classical) < 8 || len(signatures.Classical) > 72 || len(message) == 0 || len(message) > MaxAuthMessage {
		return ErrInvalid
	}
	pk, err := secp256k1.ParsePubKey(keys.Classical)
	if err != nil || !bytes.Equal(pk.SerializeCompressed(), keys.Classical) {
		return ErrInvalid
	}
	sig, err := ecdsa.ParseDERSignature(signatures.Classical)
	// Serialize emits canonical DER and low-S, rejecting alternative encodings.
	if err != nil || !bytes.Equal(sig.Serialize(), signatures.Classical) {
		return ErrInvalid
	}
	digest := sha256.Sum256(message)
	if !sig.Verify(digest[:], pk) || !verifyPQ(keys.PostQuantum, message, signatures.PostQuantum, AccountContext) {
		return ErrInvalid
	}
	return nil
}

func (CIRCLProvider) VerifyConsensus(keys PublicKeys, message []byte, signatures Signatures) error {
	if !boundedKeys(keys) || !boundedSignatures(signatures) || len(message) > MaxAuthMessage {
		return ErrInvalid
	}
	keys = snapshotKeys(keys)
	message = append([]byte(nil), message...)
	signatures = snapshotSignatures(signatures)
	if len(keys.Classical) != ed25519.PublicKeySize || len(signatures.Classical) != ed25519.SignatureSize || len(message) == 0 || len(message) > MaxAuthMessage {
		return ErrInvalid
	}
	if !ed25519.Verify(keys.Classical, message, signatures.Classical) || !verifyPQ(keys.PostQuantum, message, signatures.PostQuantum, ConsensusContext) {
		return ErrInvalid
	}
	return nil
}

type KeyPurpose uint8

const (
	AccountKey   KeyPurpose = 1
	ValidatorKey KeyPurpose = 2
)

// KeyManager has no export/private-key API. The platform implementation must
// retain independent account and validator namespaces and durable signer state.
type KeyManager interface {
	PublicKeys(KeyPurpose, uint64) (PublicKeys, error)
	SignAccount(uint64, []byte) (Signatures, error)
	// SignConsensus must atomically persist both signatures and anti-double-sign
	// state before returning; this interface alone is not that implementation.
	SignConsensus(uint64, ConsensusMessage, []byte) (Signatures, error)
}
