package ynxconsensusauth

import (
	"bytes"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"io"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

const (
	CandidateKeyMaterialFormat    = "YNX-BATCH/KEY-MATERIAL/v1"
	CandidateKeyMaterialAlgorithm = "YNX-BATCH/v0.1"
	CandidateKeyMaterialSuite     = "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512"
	CandidatePKCS8ASize           = 54
	CandidatePKCS8BSize           = 150
)

// These exact public headers implement the existing SDK KEY_MATERIAL_ABI v1.
// General PKCS8, expanded ML-DSA, alternate OIDs and trailing bytes are rejected.
var candidateDERA = [...]byte{0x30, 0x34, 0x02, 0x01, 0x00, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x13, 0x04, 0x22, 0x80, 0x20}
var candidateDERB = [...]byte{0x30, 0x81, 0x93, 0x02, 0x01, 0x00, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x03, 0x19, 0x04, 0x81, 0x80}

// CandidateKeyMaterial is plaintext and belongs only in the protected custody
// process. It is not a Wallet backup, registration, signer or authorization.
// The caller owns these buffers and must clear them after sealing/import.
type CandidateKeyMaterial struct {
	Format, AlgorithmVersion, Suite  string
	PKCS8A, PKCS8B, PublicA, PublicB []byte
}

func (m *CandidateKeyMaterial) Clear() {
	if m == nil {
		return
	}
	clear(m.PKCS8A)
	clear(m.PKCS8B)
	m.PKCS8A, m.PKCS8B = nil, nil
}

// GenerateCandidateKeyMaterial is an explicit new-key ceremony primitive. Two
// independent CSPRNG reads feed the standard algorithms. It does not create,
// replace or resume any H/R/S file and accepts no caller-provided seed.
func GenerateCandidateKeyMaterial() (*CandidateKey, CandidateKeyMaterial, error) {
	var material CandidateKeyMaterial
	var seed [mldsa87.SeedSize]byte
	defer clear(seed[:])
	if _, err := io.ReadFull(rand.Reader, seed[:]); err != nil {
		return nil, material, err
	}
	pa, a := mldsa87.NewKeyFromSeed(&seed)
	defer func() { *a = mldsa87.PrivateKey{} }()
	pubB, b, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_256f)
	if err != nil {
		return nil, material, err
	}
	defer func() { b = slhdsa.PrivateKey{} }()
	rawB, err := b.MarshalBinary()
	if err != nil {
		return nil, material, err
	}
	defer clear(rawB)
	pb, err := pubB.MarshalBinary()
	if err != nil {
		return nil, material, err
	}
	material = CandidateKeyMaterial{Format: CandidateKeyMaterialFormat, AlgorithmVersion: CandidateKeyMaterialAlgorithm, Suite: CandidateKeyMaterialSuite, PKCS8A: append(bytes.Clone(candidateDERA[:]), seed[:]...), PKCS8B: append(bytes.Clone(candidateDERB[:]), rawB...), PublicA: pa.Bytes(), PublicB: pb}
	key, err := ImportCandidateKeyMaterial(material, material.PublicA, material.PublicB)
	if err != nil {
		material.Clear()
		return nil, CandidateKeyMaterial{}, err
	}
	return key, material, nil
}

// ImportCandidateKeyMaterial strictly recomputes both algorithms from the
// existing ABI. In particular SLH's complete secret is regenerated from its
// first 96 bytes; merely trusting the embedded public root is insufficient.
// Expected public keys are independent caller expectations, not peer authority.
func ImportCandidateKeyMaterial(material CandidateKeyMaterial, expectedA, expectedB []byte) (*CandidateKey, error) {
	if material.Format != CandidateKeyMaterialFormat || material.AlgorithmVersion != CandidateKeyMaterialAlgorithm || material.Suite != CandidateKeyMaterialSuite || len(material.PKCS8A) != CandidatePKCS8ASize || len(material.PKCS8B) != CandidatePKCS8BSize || len(material.PublicA) != MLDSA87PublicKeySize || len(material.PublicB) != SLHDSASHA2256fPublicKeySize || len(expectedA) != MLDSA87PublicKeySize || len(expectedB) != SLHDSASHA2256fPublicKeySize {
		return nil, errors.New("invalid fixed consensus key material profile")
	}
	if !bytes.Equal(material.PKCS8A[:len(candidateDERA)], candidateDERA[:]) || !bytes.Equal(material.PKCS8B[:len(candidateDERB)], candidateDERB[:]) || !bytes.Equal(material.PublicA, expectedA) || !bytes.Equal(material.PublicB, expectedB) {
		return nil, errors.New("consensus key material encoding or expected public binding mismatch")
	}
	// All caller storage is detached before derivation. No plaintext is retained
	// beyond the returned opaque CandidateKey; no arbitrary signer is exposed.
	var seed [mldsa87.SeedSize]byte
	copy(seed[:], material.PKCS8A[len(candidateDERA):])
	defer clear(seed[:])
	rawB := bytes.Clone(material.PKCS8B[len(candidateDERB):])
	defer clear(rawB)
	wantA, wantB := bytes.Clone(expectedA), bytes.Clone(expectedB)
	pa, a := mldsa87.NewKeyFromSeed(&seed)
	pubB, b, err := slhdsa.GenerateKey(bytes.NewReader(rawB[:96]), slhdsa.SHA2_256f)
	accepted := false
	defer func() {
		if !accepted {
			*a = mldsa87.PrivateKey{}
			b = slhdsa.PrivateKey{}
		}
	}()
	if err != nil {
		return nil, err
	}
	derivedB, err := b.MarshalBinary()
	if err != nil {
		return nil, err
	}
	defer clear(derivedB)
	pb, err := pubB.MarshalBinary()
	if err != nil {
		return nil, err
	}
	publicA := pa.Bytes()
	if subtle.ConstantTimeCompare(rawB, derivedB) != 1 || !bytes.Equal(publicA, wantA) || !bytes.Equal(pb, wantB) {
		return nil, errors.New("private material does not mathematically match complete expected public keys")
	}
	// A fresh private module-domain challenge exercises both real signing paths.
	// Its signatures never escape this function or become consensus authority.
	challenge := make([]byte, 32)
	if _, err = io.ReadFull(rand.Reader, challenge); err != nil {
		return nil, err
	}
	message := append([]byte("YNX-CONSENSUS-KEY-IMPORT-SELFTEST/v1\x00"), challenge...)
	defer clear(message)
	defer clear(challenge)
	sigA := make([]byte, MLDSA87SignatureSize)
	defer clear(sigA)
	if err = mldsa87.SignTo(a, message, nil, true, sigA); err != nil {
		return nil, err
	}
	sigB, err := slhdsa.SignRandomized(&b, rand.Reader, slhdsa.NewMessage(message), nil)
	defer clear(sigB)
	if err != nil {
		return nil, err
	}
	if err = verifyRegistrationPair(CIRCLProvider{}, publicA, pb, message, sigA, sigB); err != nil {
		return nil, err
	}
	accepted = true
	return &CandidateKey{state: &candidateKeyState{a: a, b: &b, pa: publicA, pb: pb}}, nil
}
