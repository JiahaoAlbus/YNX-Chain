package ynxconsensusauth

import (
	"bytes"
	"crypto/rand"
	"errors"
	"sync"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

// CIRCLProvider uses the two exact pure-message parameter sets. The dependency
// is pinned by go.mod/go.sum; neither branch uses a caller-selected prehash.
type CIRCLProvider struct{}

const CIRCLVersion = "github.com/cloudflare/circl@v1.6.5"

func (CIRCLProvider) VerifyMLDSA87(publicKey, message, signature []byte) error {
	if len(publicKey) != MLDSA87PublicKeySize || len(signature) != MLDSA87SignatureSize {
		return errors.New("invalid consensus ML-DSA-87 key or signature length")
	}
	key := new(mldsa87.PublicKey)
	if err := key.UnmarshalBinary(publicKey); err != nil {
		return err
	}
	if !mldsa87.Verify(key, message, nil, signature) {
		return errors.New("consensus ML-DSA-87 signature rejected")
	}
	return nil
}

func (CIRCLProvider) VerifySLHDSASHA2256f(publicKey, message, signature []byte) error {
	if len(publicKey) != SLHDSASHA2256fPublicKeySize || len(signature) != SLHDSASHA2256fSignatureSize {
		return errors.New("invalid consensus SLH-DSA-SHA2-256f key or signature length")
	}
	key := &slhdsa.PublicKey{ID: slhdsa.SHA2_256f}
	if err := key.UnmarshalBinary(publicKey); err != nil {
		return err
	}
	if !slhdsa.Verify(key, slhdsa.NewMessage(message), signature, nil) {
		return errors.New("consensus SLH-DSA-SHA2-256f signature rejected")
	}
	return nil
}

// NewCIRCLVerifier installs the concrete provider. Registry and policy still
// have to come from authenticated state; possession of a key is not authority.
func NewCIRCLVerifier(policy Policy, registry Registry, historical HistoricalVerifier) (*Verifier, error) {
	return NewVerifier(policy, registry, CIRCLProvider{}, historical)
}

// CandidateKey is an opaque primitive key handle, not a Comet PrivValidator.
// It deliberately exposes no unguarded signing API. The durable signer owns
// signing order, anti-equivocation state, and returning a signature only after
// that state has been persisted. Copies share destruction and the same mutex.
type CandidateKey struct{ state *candidateKeyState }

type candidateKeyState struct {
	mu sync.Mutex
	a  *mldsa87.PrivateKey
	b  *slhdsa.PrivateKey
	pa []byte
	pb []byte
}

// GenerateCandidateKey obtains independent CSPRNG input for both keygens. Its
// public return values are detached and do not create a validator registration.
func GenerateCandidateKey() (*CandidateKey, []byte, []byte, error) {
	pa, a, err := mldsa87.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, nil, err
	}
	pb, b, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_256f)
	if err != nil {
		*a = mldsa87.PrivateKey{}
		return nil, nil, nil, err
	}
	publicA := pa.Bytes()
	publicB, err := pb.MarshalBinary()
	if err != nil {
		*a = mldsa87.PrivateKey{}
		return nil, nil, nil, err
	}
	if len(publicA) != MLDSA87PublicKeySize || len(publicB) != SLHDSASHA2256fPublicKeySize {
		*a = mldsa87.PrivateKey{}
		return nil, nil, nil, errors.New("consensus provider returned wrong parameter set")
	}
	k := &CandidateKey{state: &candidateKeyState{a: a, b: &b, pa: bytes.Clone(publicA), pb: bytes.Clone(publicB)}}
	return k, publicA, publicB, nil
}

// Destroy invalidates all copies. Go/upstream heap storage does not offer a
// physical erasure guarantee; this is not a protected-memory implementation.
func (k *CandidateKey) Destroy() {
	if k == nil || k.state == nil {
		return
	}
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a != nil {
		*s.a = mldsa87.PrivateKey{}
	}
	s.a, s.b, s.pa, s.pb = nil, nil, nil, nil
}

// signRequest is package-private so no caller can bypass the durable signer's
// reservation. Both signatures cover the entire same consensus domain message.
func (k *CandidateKey) signRequest(request Request, record KeyRecord) ([]byte, error) {
	if k == nil || k.state == nil {
		return nil, errors.New("missing consensus private key")
	}
	message, err := request.SigningBytes(record.Epoch)
	if err != nil {
		return nil, err
	}
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a == nil || s.b == nil || !bytes.Equal(s.pa, record.MLDSA87PublicKey) || !bytes.Equal(s.pb, record.SLHDSASHA2256fPublicKey) {
		return nil, errors.New("consensus private key does not match trusted registration")
	}
	sigA := make([]byte, MLDSA87SignatureSize)
	if err := mldsa87.SignTo(s.a, message, nil, true, sigA); err != nil {
		return nil, err
	}
	sigB, err := slhdsa.SignRandomized(s.b, rand.Reader, slhdsa.NewMessage(message), nil)
	if err != nil {
		return nil, err
	}
	provider := CIRCLProvider{}
	if err := errors.Join(provider.VerifyMLDSA87(s.pa, message, sigA), provider.VerifySLHDSASHA2256f(s.pb, message, sigB)); err != nil {
		return nil, err
	}
	return (Envelope{KeyEpoch: record.Epoch, MLDSA87: sigA, SLHDSASHA2256f: sigB}).MarshalBinary()
}
