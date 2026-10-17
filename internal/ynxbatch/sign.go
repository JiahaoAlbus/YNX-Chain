package ynxbatch

import (
	"crypto/rand"
	"sync"

	"github.com/cloudflare/circl/sign/mldsa/mldsa87"
	"github.com/cloudflare/circl/sign/slhdsa"
)

type Metadata struct {
	ChainID        []byte
	Owner, Purpose string
}
type SignOptions struct{ Optimized bool }

// Batch stores a detached, privately constructed snapshot. Its zero value is
// invalid; callers cannot turn a supplied Certificate into a signed Batch.
type Batch struct {
	mu          sync.Mutex
	certificate []byte
	messages    [][]byte
	a, b        tree
}

// BatchSign authenticates complete messages under a single key pair. The caller
// must obtain permission to sign every message; this primitive is not a Wallet
// authorization engine. It generates its own fresh batch ID and returns nothing
// usable until both signatures have completed.
func BatchSign(k *PrivateKey, metadata Metadata, messages [][]byte, opts SignOptions) (*Batch, error) {
	if k == nil || k.state == nil {
		return nil, invalid("unknown private key handle")
	}
	if err := ValidateMessages(messages, uint32(len(messages))); err != nil {
		return nil, err
	}
	input := copyMessages(messages)
	s := k.state
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.a == nil || s.b == nil {
		return nil, invalid("unknown private key handle")
	}
	c := Certificate{Descriptor: Descriptor{Context: Context{ChainID: clone(metadata.ChainID), Owner: metadata.Owner, Purpose: metadata.Purpose,
		PKA: clone(s.public.PKA), PKB: clone(s.public.PKB), BatchID: make([]byte, 16)}, N: uint32(len(input))}}
	if _, err := rand.Read(c.BatchID); err != nil {
		return nil, err
	}
	h, err := newDualHasher(c.Context, c.N, opts.Optimized)
	if err != nil {
		return nil, err
	}
	ta, err := buildTree(h.a, input)
	if err != nil {
		return nil, err
	}
	tb, err := buildTree(h.b, input)
	if err != nil {
		return nil, err
	}
	c.RootA = ta.root()
	c.RootB = tb.root()
	ma, mb, err := certificateMessages(c)
	if err != nil {
		return nil, err
	}
	c.SigmaA = make([]byte, SignatureASize)
	if err = mldsa87.SignTo(s.a, ma, nil, true, c.SigmaA); err != nil {
		return nil, err
	}
	c.SigmaB, err = slhdsa.SignRandomized(s.b, rand.Reader, slhdsa.NewMessage(mb), nil)
	if err != nil {
		return nil, err
	}
	wire, err := EncodeCertificate(c)
	if err != nil {
		return nil, err
	}
	return &Batch{certificate: wire, messages: input, a: ta, b: tb}, nil
}
func (b *Batch) CertificateWire() ([]byte, error) {
	if b == nil {
		return nil, invalid("unknown batch handle")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.certificate == nil {
		return nil, invalid("unknown batch handle")
	}
	return clone(b.certificate), nil
}
func (b *Batch) WholeWire() ([]byte, error) {
	if b == nil {
		return nil, invalid("unknown batch handle")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.certificate == nil {
		return nil, invalid("unknown batch handle")
	}
	c, err := DecodeCertificate(b.certificate)
	if err != nil {
		return nil, err
	}
	return EncodeWhole(Whole{Certificate: c, Messages: b.messages})
}
func Extract(b *Batch, index uint32) (Member, error) {
	if b == nil {
		return Member{}, invalid("unknown batch handle")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.certificate == nil || uint64(index) >= uint64(len(b.messages)) {
		return Member{}, invalid("unknown batch handle or index")
	}
	c, err := DecodeCertificate(b.certificate)
	if err != nil {
		return Member{}, err
	}
	return Member{Certificate: c, Message: clone(b.messages[index]), Proof: Proof{Index: index, PathA: b.a.path(index), PathB: b.b.path(index)}}, nil
}
func (b *Batch) Discard() {
	if b == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.certificate = nil
	b.messages = nil
	b.a = nil
	b.b = nil
}
