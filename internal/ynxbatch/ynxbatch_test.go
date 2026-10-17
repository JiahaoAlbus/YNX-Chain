package ynxbatch

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

type interopFixture struct {
	Context, Descriptor, Certificate, Whole, Member string
	Messages, Proofs                                []string
	TreeA, TreeB                                    [][]string
}

func fixture(t testing.TB) interopFixture {
	t.Helper()
	b, e := os.ReadFile("testdata/js-interop.json")
	if e != nil {
		t.Fatal(e)
	}
	var f interopFixture
	if e = json.Unmarshal(b, &f); e != nil {
		t.Fatal(e)
	}
	return f
}
func b64(t testing.TB, s string) []byte {
	t.Helper()
	b, e := base64.StdEncoding.DecodeString(s)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func hx(t testing.TB, s string) []byte {
	t.Helper()
	b, e := hex.DecodeString(s)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func requireNoError(t testing.TB, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func requireError(t testing.TB, e error) {
	t.Helper()
	if e == nil {
		t.Fatal("unexpected acceptance")
	}
}
func same(t testing.TB, got, want []byte) {
	t.Helper()
	if !bytes.Equal(got, want) {
		t.Fatalf("different bytes: got length %d, want %d", len(got), len(want))
	}
}
func registration(c Certificate) Registration {
	return Registration{AlgorithmVersion: Version, ChainID: clone(c.ChainID), Owner: c.Owner, Purpose: c.Purpose,
		PKA: clone(c.PKA), PKB: clone(c.PKB), PolicyRevision: "research-only-1", Enabled: true, ActiveFrom: 3}
}
func verifier(t testing.TB, r *Registration, entries int, optimized bool) *Verifier {
	t.Helper()
	v, e := NewVerifier(VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, ResolveTrustedOwner: func(q TrustRequest) (Registration, error) { return *r, nil }, CacheEntries: entries, Optimized: optimized})
	requireNoError(t, e)
	return v
}

func TestJSInteropAllBytesTreesPaths(t *testing.T) {
	f := fixture(t)
	cw := b64(t, f.Certificate)
	c, e := DecodeCertificate(cw)
	requireNoError(t, e)
	context, e := EncodeContext(c.Context)
	requireNoError(t, e)
	same(t, context, b64(t, f.Context))
	d, e := EncodeDescriptor(c.Descriptor)
	requireNoError(t, e)
	same(t, d, b64(t, f.Descriptor))
	out, e := EncodeCertificate(c)
	requireNoError(t, e)
	same(t, out, cw)
	w, e := DecodeWhole(b64(t, f.Whole))
	requireNoError(t, e)
	out, e = EncodeWhole(w)
	requireNoError(t, e)
	same(t, out, b64(t, f.Whole))
	m, e := DecodeMember(b64(t, f.Member))
	requireNoError(t, e)
	out, e = EncodeMember(m)
	requireNoError(t, e)
	same(t, out, b64(t, f.Member))
	for i, msg := range w.Messages {
		same(t, msg, b64(t, f.Messages[i]))
	}
	for _, optimized := range []bool{false, true} {
		h, e := newDualHasher(c.Context, c.N, optimized)
		requireNoError(t, e)
		for _, spec := range []struct {
			h    *branchHasher
			want [][]string
			root []byte
		}{{h.a, f.TreeA, c.RootA}, {h.b, f.TreeB, c.RootB}} {
			tree, e := buildTree(spec.h, w.Messages)
			requireNoError(t, e)
			same(t, tree.root(), spec.root)
			for i, level := range tree {
				for j, node := range level {
					same(t, node[:], hx(t, spec.want[i][j]))
				}
			}
		}
		r := registration(c)
		v := verifier(t, &r, 2, optimized)
		handle, e := v.AuthenticateCertificate(cw, 7)
		requireNoError(t, e)
		for i, p := range f.Proofs {
			proof, e := DecodeProof(b64(t, p), c.N)
			requireNoError(t, e)
			out, e := EncodeProof(proof, c.N)
			requireNoError(t, e)
			same(t, out, b64(t, p))
			requireNoError(t, v.VerifyMember(handle, w.Messages[i], proof, 7))
		}
		requireNoError(t, v.VerifyWhole(b64(t, f.Whole), 7))
		requireNoError(t, v.VerifyOne(b64(t, f.Member), 7))
		stats := v.Stats()
		if stats.SignatureChecks != 2 || stats.CachedCertificates != 1 || stats.CacheHits != 2 {
			t.Fatalf("unexpected cache: %+v", stats)
		}
	}
}

func TestANDMutationsAndTrustRefresh(t *testing.T) {
	f := fixture(t)
	original := b64(t, f.Certificate)
	c, e := DecodeCertificate(original)
	requireNoError(t, e)
	m, e := DecodeMember(b64(t, f.Member))
	requireNoError(t, e)
	r := registration(c)
	v := verifier(t, &r, 1, true)
	h, e := v.AuthenticateCertificate(original, 7)
	requireNoError(t, e)
	for _, mutation := range []func(*Certificate){func(c *Certificate) { c.SigmaA[10] ^= 1 }, func(c *Certificate) { c.SigmaB[10] ^= 1 },
		func(c *Certificate) { c.RootA[0] ^= 1 }, func(c *Certificate) { c.RootB[0] ^= 1 }, func(c *Certificate) { c.BatchID[0] ^= 1 }} {
		bad, e := DecodeCertificate(original)
		requireNoError(t, e)
		mutation(&bad)
		wire, e := EncodeCertificate(bad)
		requireNoError(t, e)
		_, e = v.AuthenticateCertificate(wire, 7)
		requireError(t, e)
		if v.Stats().CachedCertificates != 1 {
			t.Fatal("failed authentication polluted cache")
		}
	}
	for _, change := range []func(*Member){func(m *Member) { m.Message[0] ^= 1 }, func(m *Member) { m.Index ^= 1 }, func(m *Member) { m.PathA[0][0] ^= 1 }, func(m *Member) { m.PathB[0][0] ^= 1 }} {
		bad, e := DecodeMember(b64(t, f.Member))
		requireNoError(t, e)
		change(&bad)
		requireError(t, v.VerifyMember(h, bad.Message, bad.Proof, 7))
	}
	for _, change := range []func(*Registration){func(r *Registration) { r.Enabled = false }, func(r *Registration) { r.PolicyRevision = "new-policy" },
		func(r *Registration) { r.PKA[0] ^= 1 }, func(r *Registration) { r.PKB[0] ^= 1 }, func(r *Registration) { r.ChainID[0] ^= 1 },
		func(r *Registration) { r.Owner += " " }, func(r *Registration) { r.Purpose = "OTHER" }, func(r *Registration) { at := uint64(7); r.RevokedAt = &at },
		func(r *Registration) { r.ActiveFrom = 8 }, func(r *Registration) { r.AlgorithmVersion = "unknown" }} {
		r = registration(c)
		change(&r)
		requireError(t, v.VerifyMember(h, m.Message, m.Proof, 7))
	}
	r = registration(c)
	requireNoError(t, v.VerifyMember(h, m.Message, m.Proof, 7))
	requireError(t, v.VerifyMember(h, m.Message, m.Proof, 2))
	requireError(t, v.VerifyMember(&AuthenticatedHandle{}, m.Message, m.Proof, 7))
	requireError(t, v.VerifyMember(nil, m.Message, m.Proof, 7))
	other := verifier(t, &r, 1, true)
	requireError(t, other.VerifyMember(h, m.Message, m.Proof, 7))
	v.Clear()
	requireError(t, v.VerifyMember(h, m.Message, m.Proof, 7))
	if v.Stats().CachedCertificates != 0 {
		t.Fatal("cache survived clear")
	}
	// Poisoning detached decoded bytes cannot alter cached authenticated state.
	h, e = v.AuthenticateCertificate(original, 7)
	requireNoError(t, e)
	c.RootA[0] ^= 1
	m.Certificate.RootB[0] ^= 1
	requireNoError(t, v.VerifyMember(h, m.Message, m.Proof, 7))
}

func TestTrustChangesDuringAuthentication(t *testing.T) {
	f := fixture(t)
	c, e := DecodeCertificate(b64(t, f.Certificate))
	requireNoError(t, e)
	r := registration(c)
	calls := 0
	v, e := NewVerifier(VerifierOptions{ChainID: r.ChainID, Purpose: r.Purpose, CacheEntries: 2, ResolveTrustedOwner: func(TrustRequest) (Registration, error) {
		calls++
		if calls > 1 {
			r.PolicyRevision = "changed"
		}
		return r, nil
	}})
	requireNoError(t, e)
	_, e = v.AuthenticateCertificate(b64(t, f.Certificate), 7)
	requireError(t, e)
	if v.Stats().CachedCertificates != 0 {
		t.Fatal("stale authentication cached")
	}
}

func TestWholeReorderMissingAndIndependentMemberLimit(t *testing.T) {
	f := fixture(t)
	w, e := DecodeWhole(b64(t, f.Whole))
	requireNoError(t, e)
	r := registration(w.Certificate)
	v := verifier(t, &r, 0, false)
	cw := b64(t, f.Certificate)
	messages := copyMessages(w.Messages)
	messages[0], messages[1] = messages[1], messages[0]
	requireError(t, v.VerifyWholeBatch(cw, messages, 7))
	requireError(t, v.VerifyWholeBatch(cw, w.Messages[:7], 7))
	requireNoError(t, v.VerifyWholeBatch(cw, w.Messages, 7))
	if v.Stats().CachedCertificates != 0 {
		t.Fatal("disabled cache retained certificate")
	}
	// The v0.1 independent member proof cannot prove other messages' aggregate
	// size. It intentionally checks only this member; execution policy is external.
	requireNoError(t, v.VerifyOne(b64(t, f.Member), 7))
}

func TestStrictParsingAndResourceBounds(t *testing.T) {
	f := fixture(t)
	original := b64(t, f.Certificate)
	for _, wire := range [][]byte{nil, original[:3], original[:len(original)-1], append(clone(original), 0), append([]byte{255, 255, 255, 255}, original[4:]...)} {
		_, e := DecodeCertificate(wire)
		requireError(t, e)
	}
	for _, n := range []uint32{0, 3, 7, 1023, 1025, ^uint32(0)} {
		c, e := DecodeCertificate(original)
		requireNoError(t, e)
		c.N = n
		_, e = EncodeCertificate(c)
		requireError(t, e)
		_, e = DecodeProof(nil, n)
		requireError(t, e)
	}
	c, e := DecodeCertificate(original)
	requireNoError(t, e)
	c.Owner = "unicode-\u4e2d"
	_, e = EncodeContext(c.Context)
	requireError(t, e)
	c, e = DecodeCertificate(original)
	requireNoError(t, e)
	c.Purpose = "\x1f"
	_, e = EncodeContext(c.Context)
	requireError(t, e)
	_, e = DecodeCertificate(make([]byte, MaxCertificateBytes+1))
	requireError(t, e)
	requireError(t, ValidateMessages([][]byte{make([]byte, MaxMessageBytes+1)}, 1))
	large := make([][]byte, 16)
	for i := 0; i < 9; i++ {
		large[i] = make([]byte, MaxMessageBytes)
	}
	requireError(t, ValidateMessages(large, 16))
	_, e = DecodeFields([]byte{0, 0, 0, 0}, 0, -1)
	requireError(t, e)
	_, e = DecodeFields([]byte{0, 0, 0, 0}, 0, MaxWholeBytes+1)
	requireError(t, e)
	p, e := DecodeProof(b64(t, f.Proofs[0]), 8)
	requireNoError(t, e)
	p.PathB = p.PathB[:2]
	_, e = EncodeProof(p, 8)
	requireError(t, e)
	p, e = DecodeProof(b64(t, f.Proofs[0]), 8)
	requireNoError(t, e)
	p.PathA[0] = p.PathA[0][:63]
	_, e = EncodeProof(p, 8)
	requireError(t, e)
}

func TestTreeNBoundariesAndPrefixDifferential(t *testing.T) {
	f := fixture(t)
	c, e := DecodeCertificate(b64(t, f.Certificate))
	requireNoError(t, e)
	for _, n := range []uint32{1, 2, 1024} {
		messages := make([][]byte, n)
		h, e := newDualHasher(c.Context, n, true)
		requireNoError(t, e)
		plain, e := newDualHasher(c.Context, n, false)
		requireNoError(t, e)
		a, e := buildTree(h.a, messages)
		requireNoError(t, e)
		b, e := buildTree(h.b, messages)
		requireNoError(t, e)
		pa, e := buildTree(plain.a, messages)
		requireNoError(t, e)
		pb, e := buildTree(plain.b, messages)
		requireNoError(t, e)
		for l := range a {
			for j := range a[l] {
				same(t, a[l][j][:], pa[l][j][:])
				same(t, b[l][j][:], pb[l][j][:])
			}
		}
		for _, index := range []uint32{0, n - 1} {
			p := Proof{Index: index, PathA: a.path(index), PathB: b.path(index)}
			wire, e := EncodeProof(p, n)
			requireNoError(t, e)
			p, e = DecodeProof(wire, n)
			requireNoError(t, e)
			ra, e := pathRoot(h.a, index, nil, p.PathA)
			requireNoError(t, e)
			rb, e := pathRoot(h.b, index, nil, p.PathB)
			requireNoError(t, e)
			same(t, ra[:], a.root())
			same(t, rb[:], b.root())
			if len(wire) != 28+136*depth(n) {
				t.Fatal("proof byte size")
			}
		}
	}
}

func TestRealSigner(t *testing.T) {
	k, p, e := KeyGen()
	requireNoError(t, e)
	defer k.Destroy()
	metadata := Metadata{ChainID: bytes.Repeat([]byte{0x72}, 32), Owner: "ynx-go-generated-research-only", Purpose: "TX-BATCH"}
	messages := [][]byte{[]byte("complete transaction message zero"), {0, 1, 2, 0, 255}}
	b, e := BatchSign(k, metadata, messages, SignOptions{Optimized: true})
	requireNoError(t, e)
	defer b.Discard()
	cw, e := b.CertificateWire()
	requireNoError(t, e)
	c, e := DecodeCertificate(cw)
	requireNoError(t, e)
	same(t, c.PKA, p.PKA)
	same(t, c.PKB, p.PKB)
	r := registration(c)
	v := verifier(t, &r, 1, true)
	whole, e := b.WholeWire()
	requireNoError(t, e)
	requireNoError(t, v.VerifyWhole(whole, 7))
	member, e := Extract(b, 1)
	requireNoError(t, e)
	mw, e := EncodeMember(member)
	requireNoError(t, e)
	requireNoError(t, v.VerifyOne(mw, 7))
	if out := os.Getenv("YNX_BATCH_INTEROP_OUT"); out != "" {
		public := map[string]string{"note": "Fresh research-only Go signature; public material only", "certificate": base64.StdEncoding.EncodeToString(cw), "whole": base64.StdEncoding.EncodeToString(whole), "member": base64.StdEncoding.EncodeToString(mw)}
		encoded, e := json.MarshalIndent(public, "", "  ")
		requireNoError(t, e)
		requireNoError(t, os.WriteFile(out, append(encoded, '\n'), 0600))
	}
	// Signing snapshots are independent of caller and extract buffers.
	messages[0][0] ^= 1
	member.Message[0] ^= 1
	metadata.ChainID[0] ^= 1
	p.PKA[0] ^= 1
	again, e := b.WholeWire()
	requireNoError(t, e)
	same(t, again, whole)
	// Boundary batches also pass real dual signatures, not just tree fixtures.
	batchIDs := map[string]bool{string(c.BatchID): true}
	for _, n := range []int{1, 1024} {
		boundary, e := BatchSign(k, Metadata{ChainID: r.ChainID, Owner: r.Owner, Purpose: r.Purpose}, make([][]byte, n), SignOptions{Optimized: true})
		requireNoError(t, e)
		bw, e := boundary.WholeWire()
		requireNoError(t, e)
		requireNoError(t, v.VerifyWhole(bw, 7))
		bm, e := Extract(boundary, uint32(n-1))
		requireNoError(t, e)
		bmw, e := EncodeMember(bm)
		requireNoError(t, e)
		requireNoError(t, v.VerifyOne(bmw, 7))
		if batchIDs[string(bm.Certificate.BatchID)] {
			t.Fatal("batch identifier reused")
		}
		batchIDs[string(bm.Certificate.BatchID)] = true
		boundary.Discard()
	}
	copiedHandle := *k
	k.Destroy()
	_, e = BatchSign(k, metadata, messages, SignOptions{})
	requireError(t, e)
	_, e = BatchSign(&copiedHandle, metadata, messages, SignOptions{})
	requireError(t, e)
	b.Discard()
	_, e = Extract(b, 0)
	requireError(t, e)
	_, e = (&Batch{}).WholeWire()
	requireError(t, e)
}

func FuzzWireDecode(f *testing.F) {
	data := fixture(f)
	f.Add(b64(f, data.Whole))
	f.Add(b64(f, data.Member))
	f.Add(b64(f, data.Certificate))
	f.Add([]byte{0, 0, 0, 0})
	f.Fuzz(func(t *testing.T, wire []byte) {
		if len(wire) > MaxWholeBytes {
			return
		}
		if c, e := DecodeCertificate(wire); e == nil {
			out, e := EncodeCertificate(c)
			requireNoError(t, e)
			same(t, out, wire)
		}
		if w, e := DecodeWhole(wire); e == nil {
			out, e := EncodeWhole(w)
			requireNoError(t, e)
			same(t, out, wire)
		}
		if m, e := DecodeMember(wire); e == nil {
			out, e := EncodeMember(m)
			requireNoError(t, e)
			same(t, out, wire)
		}
	})
}
