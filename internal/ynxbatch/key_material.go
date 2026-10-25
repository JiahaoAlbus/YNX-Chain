package ynxbatch

import (
	"bytes"
	"crypto/subtle"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

const (
	KeyMaterialFormat = "YNX-BATCH/KEY-MATERIAL/v1"
	PKCS8ASize        = 54
	PKCS8BSize        = 150

	// This is the exact seed-only ML-DSA-87 / raw SLH-DSA-SHA2-256f
	// PKCS8 profile shared with the original JS provider, not a general DER parser.
	keyMaterialHeaderA  = "\x30\x34\x02\x01\x00\x30\x0b\x06\x09\x60\x86\x48\x01\x65\x03\x04\x03\x13\x04\x22\x80\x20"
	keyMaterialHeaderB  = "\x30\x81\x93\x02\x01\x00\x30\x0b\x06\x09\x60\x86\x48\x01\x65\x03\x04\x03\x19\x04\x81\x80"
	slhMaterialSeedSize = 96
	slhMaterialSize     = 128
	keyMaterialRedacted = "YNX-BATCH key material [REDACTED]"
)

// KeyMaterial holds unencrypted, detached private-key material for protected
// backup handling. It is not a JSON or authorization interface. The SDK binds
// KeyMaterialFormat, Version, Suite, network, account and encryption externally.
// PKA and PKB are consistency expectations, not a trusted account registration.
// Never log or transport the byte fields in plaintext. Clear owned copies after
// use. Copying this struct aliases its slices; it does not copy their contents.
type KeyMaterial struct {
	PKCS8A []byte `json:"-"`
	PKCS8B []byte `json:"-"`
	PKA    []byte `json:"-"`
	PKB    []byte `json:"-"`
}

func (KeyMaterial) String() string   { return keyMaterialRedacted }
func (KeyMaterial) GoString() string { return keyMaterialRedacted }

// Clear best-effort clears all explicit buffers and releases this value's slice
// references. Aliases of these same buffers are also cleared; independently
// copied buffers are not. Go/provider allocations have no physical-erasure
// guarantee. The caller must own exclusive access, including during Import.
func (m *KeyMaterial) Clear() {
	if m == nil {
		return
	}
	clear(m.PKCS8A)
	clear(m.PKCS8B)
	clear(m.PKA)
	clear(m.PKB)
	*m = KeyMaterial{}
}

// ExportKeyMaterial returns independently owned plaintext copies. It shares
// the signer's lock with BatchSign and Destroy; nil, zero and destroyed handles
// cannot export. The caller must encrypt the result in its protected process
// before storage/transport and must clear all of its explicit plaintext copies.
func ExportKeyMaterial(k *PrivateKey) (KeyMaterial, error) {
	if k == nil || k.state == nil {
		return KeyMaterial{}, invalid("key material private key")
	}
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a == nil || s.b == nil || s.b.ID != slhdsa.SHA2_256f ||
		len(s.public.PKA) != PublicKeyASize || len(s.public.PKB) != PublicKeyBSize {
		return KeyMaterial{}, invalid("key material private key")
	}
	// CIRCL's generated/seed-imported ML-DSA key retains the original seed;
	// Seed returns a detached copy. Expanded-only keys are not this profile.
	seed := s.a.Seed()
	defer clear(seed)
	if len(seed) != mldsa87.SeedSize {
		return KeyMaterial{}, invalid("key material ML-DSA seed")
	}
	rawB, err := s.b.MarshalBinary()
	defer clear(rawB)
	if err != nil || len(rawB) != slhMaterialSize {
		return KeyMaterial{}, invalid("key material SLH key")
	}
	m := KeyMaterial{
		PKCS8A: make([]byte, PKCS8ASize), PKCS8B: make([]byte, PKCS8BSize),
		PKA: clone(s.public.PKA), PKB: clone(s.public.PKB),
	}
	copy(m.PKCS8A, keyMaterialHeaderA)
	copy(m.PKCS8A[len(keyMaterialHeaderA):], seed)
	copy(m.PKCS8B, keyMaterialHeaderB)
	copy(m.PKCS8B[len(keyMaterialHeaderB):], rawB)
	return m, nil
}

// ImportKeyMaterial accepts only the exact canonical DER profile. It recomputes
// both public keys and the entire SLH secret (including its root) before making
// a signer. Inputs are borrowed for this call and independently copied before
// derivation. The caller must not concurrently mutate or Clear the input slices;
// such mutation is a Go data race and cannot be detected by this API.
//
// A successful import proves only key consistency. The SDK must separately
// authenticate the backup and compare both keys with trusted account policy.
// Historical entropy/provenance cannot be inferred from imported bytes.
func ImportKeyMaterial(material KeyMaterial) (*PrivateKey, PublicKey, error) {
	if len(material.PKCS8A) != PKCS8ASize || len(material.PKCS8B) != PKCS8BSize ||
		len(material.PKA) != PublicKeyASize || len(material.PKB) != PublicKeyBSize {
		return nil, PublicKey{}, invalid("key material size")
	}
	// Check bounds before allocations; snapshot all four inputs before derivation.
	m := KeyMaterial{PKCS8A: clone(material.PKCS8A), PKCS8B: clone(material.PKCS8B),
		PKA: clone(material.PKA), PKB: clone(material.PKB)}
	defer m.Clear()
	if !bytes.Equal(m.PKCS8A[:len(keyMaterialHeaderA)], []byte(keyMaterialHeaderA)) ||
		!bytes.Equal(m.PKCS8B[:len(keyMaterialHeaderB)], []byte(keyMaterialHeaderB)) {
		return nil, PublicKey{}, invalid("key material DER profile")
	}
	var seed [mldsa87.SeedSize]byte
	copy(seed[:], m.PKCS8A[len(keyMaterialHeaderA):])
	defer clear(seed[:])
	pa, a := mldsa87.NewKeyFromSeed(&seed)
	var b slhdsa.PrivateKey
	complete := false
	defer func() {
		if !complete {
			*a = mldsa87.PrivateKey{}
			b = slhdsa.PrivateKey{}
		}
	}()
	pubA := pa.Bytes()
	if subtle.ConstantTimeCompare(pubA, m.PKA) != 1 {
		return nil, PublicKey{}, invalid("key material public pair")
	}
	rawB := m.PKCS8B[len(keyMaterialHeaderB):]
	// GenerateKey consumes SK.seed || SK.prf || PK.seed (96 bytes). This
	// upstream standard primitive recomputes PK.root. UnmarshalBinary merely
	// trusts embedded public bytes; Scheme.DeriveKey uses a different seed format.
	pb, derivedB, err := slhdsa.GenerateKey(bytes.NewReader(rawB[:slhMaterialSeedSize]), slhdsa.SHA2_256f)
	b = derivedB
	derivedB = slhdsa.PrivateKey{}
	if err != nil {
		return nil, PublicKey{}, invalid("key material SLH derivation")
	}
	expandedB, err := b.MarshalBinary()
	defer clear(expandedB)
	if err != nil || subtle.ConstantTimeCompare(expandedB, rawB) != 1 {
		return nil, PublicKey{}, invalid("key material SLH private/public consistency")
	}
	pubB, err := pb.MarshalBinary()
	if err != nil || subtle.ConstantTimeCompare(pubB, m.PKB) != 1 {
		return nil, PublicKey{}, invalid("key material public pair")
	}
	p := PublicKey{PKA: pubA, PKB: pubB}
	k := &PrivateKey{state: &privateKeyState{a: a, b: &b,
		public: PublicKey{PKA: clone(p.PKA), PKB: clone(p.PKB)}}}
	complete = true
	return k, p, nil
}
