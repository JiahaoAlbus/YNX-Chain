package securelink

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

func TestLINK01ResponseHeadersHaveWireBudget(t *testing.T) {
	wire := "HTTP/1.1 200 OK\r\nX-Large: " + strings.Repeat("a", 100<<10) + "\r\nContent-Length: 0\r\n\r\n"
	b := &wireBudget{reader: bytes.NewBufferString(wire), remaining: 64 << 10}
	req, _ := http.NewRequest("GET", "https://adapter.ynx.test/settlement", nil)
	if _, err := http.ReadResponse(bufio.NewReaderSize(b, 32<<10), req); !errors.Is(err, ErrBounds) {
		t.Fatal("oversized response headers were not bounded", err)
	}
}

func fixturePolicy() Policy {
	return Policy{Edges: []Edge{{ID: "pay-adapter", LocalSAN: "adapter.ynx.test", PeerSAN: "pay.ynx.test", Epoch: 1, Roots: []Root{{Fingerprint: strings.Repeat("a", 64), Until: time.Now().Add(time.Hour)}}, Routes: []Route{{Method: "GET", Path: "/settlement", Risk: "read"}, {Method: "POST", Path: "/settle", Risk: "asset"}}}}}
}
func fixtureState() native.State {
	return native.State{Protocol: "TLSv1.3", Group: Group, Cipher: Cipher, PeerSAN: "pay.ynx.test", LocalSAN: "adapter.ynx.test", PeerFingerprint: strings.Repeat("b", 64), RootFingerprint: strings.Repeat("a", 64), NotAfter: time.Now().Add(time.Hour), Verified: true, Mutual: true, AllChainMLDSA87: true, PeerSignature: "mldsa87"}
}

// Synthetic state here tests the private policy predicate only; production
// callers must pass a live native.Conn. Tagged tests cover that real boundary.
func TestLINK01ExactServiceMethodAndNegotiationPolicy(t *testing.T) {
	g, err := NewGate(fixturePolicy())
	if err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(*native.State){
		"same_ca_wrong_san":    func(s *native.State) { s.PeerSAN = "unrelated.ynx.test" },
		"wrong_local_audience": func(s *native.State) { s.LocalSAN = "ai.ynx.test" },
		"classical_group":      func(s *native.State) { s.Group = "secp384r1" },
		"wrong_cipher":         func(s *native.State) { s.Cipher = "TLS_AES_128_GCM_SHA256" },
		"unverified":           func(s *native.State) { s.Verified = false },
		"one_way_tls":          func(s *native.State) { s.Mutual = false },
		"classic_chain":        func(s *native.State) { s.AllChainMLDSA87 = false },
		"classic_signature":    func(s *native.State) { s.PeerSignature = "ecdsa_secp384r1_sha384" },
		"resumed":              func(s *native.State) { s.Resumed = true },
		"wrong_root":           func(s *native.State) { s.RootFingerprint = strings.Repeat("c", 64) },
		"expired":              func(s *native.State) { s.NotAfter = time.Now().Add(-time.Second) },
	} {
		t.Run(name, func(t *testing.T) {
			s := fixtureState()
			mutate(&s)
			if _, e := g.authenticateLocked(s, "pay-adapter", "GET", "/settlement", time.Now()); e == nil {
				t.Fatal("accepted invalid peer")
			}
		})
	}
	if _, err = g.authenticateLocked(fixtureState(), "pay-adapter", "GET", "/settlement", time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err = g.authenticateLocked(fixtureState(), "pay-adapter", "DELETE", "/settlement", time.Now()); !errors.Is(err, ErrDenied) {
		t.Fatal("wrong operation accepted", err)
	}
	if _, err = g.AuthenticateServicePeer(context.Background(), nil, "pay-adapter", "GET", "/settlement"); !errors.Is(err, ErrDenied) {
		t.Fatal("nil transport accepted")
	}
	if _, err = g.RevokeService("pay.ynx.test", 1); err != nil {
		t.Fatal(err)
	}
	if _, err = g.authenticateLocked(fixtureState(), "pay-adapter", "GET", "/settlement", time.Now()); !errors.Is(err, ErrRevoked) {
		t.Fatal("revoked warm peer accepted", err)
	}
}
func TestLINK01PolicyRejectsWildcardReadWriteAndRollback(t *testing.T) {
	for _, change := range []func(*Policy){func(p *Policy) { p.Edges[0].PeerSAN = "*.ynx.test" }, func(p *Policy) { p.Edges[0].Routes[0].Method = "POST" }, func(p *Policy) { p.Edges[0].Roots[0].Until = time.Time{} }} {
		p := fixturePolicy()
		change(&p)
		if _, err := NewGate(p); err == nil {
			t.Fatal("invalid policy accepted")
		}
	}
	g, _ := NewGate(fixturePolicy())
	if err := g.ReplacePolicy(fixturePolicy()); err == nil {
		t.Fatal("epoch rollback accepted")
	}
	p := fixturePolicy()
	p.Edges[0].Epoch = 2
	if err := g.ReplacePolicy(p); err != nil {
		t.Fatal(err)
	}
}
func bindingFor(b []byte) Binding {
	a := sha3.Sum512(b)
	c := sha512.Sum512(b)
	return Binding{Bytes: fmt.Sprint(len(b)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(c[:])}
}
func TestLINK05ExactWitnessAndBounds(t *testing.T) {
	wire := []byte("original signed witness bytes")
	b := bindingFor(wire)
	out, err := ReconstituteWitness(b, [][]byte{wire[:9], wire[9:]}, 1024)
	if err != nil || string(out) != string(wire) {
		t.Fatal("original bytes changed", err)
	}
	if _, err = ReconstituteWitness(b, [][]byte{wire[:9]}, 1024); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing part treated as present", err)
	}
	bad := append([]byte(nil), wire...)
	bad[0] ^= 1
	if _, err = ReconstituteWitness(b, [][]byte{bad}, 1024); !errors.Is(err, ErrDenied) {
		t.Fatal("bad bytes accepted", err)
	}
	if _, err = ReconstituteWitness(b, [][]byte{wire, wire}, 1024); !errors.Is(err, ErrBounds) {
		t.Fatal("extra chunk accepted", err)
	}
	if _, err = ReconstituteWitness(b, [][]byte{wire}, 1); !errors.Is(err, ErrBounds) {
		t.Fatal("over budget accepted", err)
	}
	b.Bytes = "01"
	if _, err = ReconstituteWitness(b, nil, 1024); err == nil {
		t.Fatal("noncanonical length accepted")
	}
}

// This fixture tests cache isolation and call counts, not cryptographic success.
// The original dual-signature verifier must be injected by the owning module.
type countingVerifier struct {
	calls   atomic.Int32
	start   chan struct{}
	release chan struct{}
	once    sync.Once
}

func (v *countingVerifier) VerifyBoth(ctx context.Context, w PublicWire, p Pair, r Ref) (bool, error) {
	v.calls.Add(1)
	if v.start != nil {
		v.once.Do(func() { close(v.start) })
		select {
		case <-v.release:
		case <-ctx.Done():
			return false, ctx.Err()
		}
	}
	return string(w.SignatureA) == "valid-A" && string(w.SignatureB) == "valid-B", nil
}
func TestLINK06CompleteKeyAndBothSignatures(t *testing.T) {
	v := &countingVerifier{}
	cache, _ := NewStaticCache(v, 2, 1)
	w := PublicWire{Payload: []byte("batch-id-same"), SignatureA: []byte("valid-A"), SignatureB: []byte("valid-B"), Context: "context-1"}
	p := Pair{Suite: "YNX-BATCH/v0.1", PublicA: []byte("account-A"), PublicB: []byte("account-B")}
	ref := Ref{Realm: "r", Tenant: "t", Kind: "policy", ID: "p", Rev: "1"}
	for i := 0; i < 2; i++ {
		ok, err := cache.VerifyStaticOnce(context.Background(), w, p, ref)
		if err != nil || !ok {
			t.Fatal(err)
		}
	}
	if v.calls.Load() != 1 {
		t.Fatal("hot hit reverified")
	}
	w.SignatureB = []byte("tampered-B")
	ok, err := cache.VerifyStaticOnce(context.Background(), w, p, ref)
	if err != nil || ok {
		t.Fatal("same batch ID bypassed signature B", err)
	}
	w.SignatureB = nil
	if _, err = cache.VerifyStaticOnce(context.Background(), w, p, ref); !errors.Is(err, ErrDenied) {
		t.Fatal("missing branch accepted", err)
	}
	w.SignatureB = []byte("valid-B")
	p.PublicA = []byte("other-account")
	_, _ = cache.VerifyStaticOnce(context.Background(), w, p, ref)
	if v.calls.Load() != 3 {
		t.Fatal("account key reused another account's cache")
	}
	ref.Rev = "2"
	_, _ = cache.VerifyStaticOnce(context.Background(), w, p, ref)
	if v.calls.Load() != 4 {
		t.Fatal("policy revision omitted from key")
	}
}
func TestLINK06SingleFlightAndBoundedMisses(t *testing.T) {
	v := &countingVerifier{start: make(chan struct{}), release: make(chan struct{})}
	cache, _ := NewStaticCache(v, 2, 1)
	w := PublicWire{Payload: []byte("p"), SignatureA: []byte("valid-A"), SignatureB: []byte("valid-B"), Context: "ctx"}
	p := Pair{Suite: "YNX-BATCH/v0.1", PublicA: []byte("a"), PublicB: []byte("b")}
	ref := Ref{Realm: "r", Kind: "policy", ID: "p", Rev: "1"}
	done := make(chan error, 2)
	go func() {
		ok, e := cache.VerifyStaticOnce(context.Background(), w, p, ref)
		if !ok && e == nil {
			e = ErrDenied
		}
		done <- e
	}()
	<-v.start
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := cache.VerifyStaticOnce(ctx, w, p, ref); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	go func() {
		ok, e := cache.VerifyStaticOnce(context.Background(), w, p, ref)
		if !ok && e == nil {
			e = ErrDenied
		}
		done <- e
	}()
	close(v.release)
	for i := 0; i < 2; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	if v.calls.Load() != 1 {
		t.Fatal("duplicate verification", v.calls.Load())
	}
}
