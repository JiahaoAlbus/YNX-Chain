package ynxbatch

import (
	"crypto/rand"
	"errors"
	"sync"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

// The module version is pinned by the repository go.mod/go.sum. Both calls use
// the FIPS pure API with empty context and the complete domain-separated message.
const ProviderVersion = "github.com/cloudflare/circl@v1.6.5"

var ErrInvalidSignature = errors.New("YNX dual signature verification failed")

type PublicKey struct{ PKA, PKB []byte }

// PrivateKey is an opaque local signer. Its zero value cannot sign. No account
// registration, Wallet authority or permission is inferred from key possession.
type PrivateKey struct{ state *privateKeyState }
type privateKeyState struct {
	mu     sync.Mutex
	a      *mldsa87.PrivateKey
	b      *slhdsa.PrivateKey
	public PublicKey
}

// KeyGen requests independent fresh randomness for the two standard keygens.
func KeyGen() (*PrivateKey, PublicKey, error) {
	pa, a, err := mldsa87.GenerateKey(rand.Reader)
	if err != nil {
		return nil, PublicKey{}, err
	}
	pb, b, err := slhdsa.GenerateKey(rand.Reader, slhdsa.SHA2_256f)
	if err != nil {
		return nil, PublicKey{}, err
	}
	pubB, err := pb.MarshalBinary()
	if err != nil {
		return nil, PublicKey{}, err
	}
	p := PublicKey{PKA: pa.Bytes(), PKB: pubB}
	if len(p.PKA) != PublicKeyASize || len(p.PKB) != PublicKeyBSize {
		return nil, PublicKey{}, invalid("provider key size")
	}
	k := &PrivateKey{state: &privateKeyState{a: a, b: &b, public: PublicKey{PKA: clone(p.PKA), PKB: clone(p.PKB)}}}
	return k, p, nil
}

// Destroy disables this signer. Go and upstream provider allocations do not
// promise physical erasure; consumers needing that guarantee require a protected
// signer process/device and must not claim this is a secure-memory primitive.
func (k *PrivateKey) Destroy() {
	if k == nil || k.state == nil {
		return
	}
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a != nil {
		*s.a = mldsa87.PrivateKey{}
	}
	s.a = nil
	s.b = nil
	s.public = PublicKey{}
}

type publicPair struct {
	a *mldsa87.PublicKey
	b *slhdsa.PublicKey
}

func importPublic(c Context) (*publicPair, error) {
	if len(c.PKA) != PublicKeyASize || len(c.PKB) != PublicKeyBSize {
		return nil, invalid("provider key size")
	}
	a := new(mldsa87.PublicKey)
	if err := a.UnmarshalBinary(c.PKA); err != nil {
		return nil, err
	}
	b := &slhdsa.PublicKey{ID: slhdsa.SHA2_256f}
	if err := b.UnmarshalBinary(c.PKB); err != nil {
		return nil, err
	}
	return &publicPair{a: a, b: b}, nil
}
func certificateMessages(c Certificate) ([]byte, []byte, error) {
	d, err := EncodeDescriptor(c.Descriptor)
	if err != nil {
		return nil, nil, err
	}
	a, err := EncodeFields([]byte(Version+"/CERT/A"), d)
	if err != nil {
		return nil, nil, err
	}
	b, err := EncodeFields([]byte(Version+"/CERT/B"), d)
	return a, b, err
}
func verifySignatures(c Certificate, p *publicPair) error {
	a, b, err := certificateMessages(c)
	if err != nil {
		return err
	}
	// Evaluate both branches. A failure can never be rescued by the other branch.
	okA := mldsa87.Verify(p.a, a, nil, c.SigmaA)
	okB := slhdsa.Verify(p.b, slhdsa.NewMessage(b), c.SigmaB, nil)
	if !okA || !okB {
		return ErrInvalidSignature
	}
	return nil
}
