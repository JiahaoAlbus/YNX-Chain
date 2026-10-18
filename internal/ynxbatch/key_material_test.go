package ynxbatch

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"
)

func copyKeyMaterialForTest(m KeyMaterial) KeyMaterial {
	return KeyMaterial{PKCS8A: clone(m.PKCS8A), PKCS8B: clone(m.PKCS8B),
		PKA: clone(m.PKA), PKB: clone(m.PKB)}
}

func sameKeyMaterialForTest(t testing.TB, a, b KeyMaterial) {
	t.Helper()
	// Never include private contents in assertion output.
	same(t, a.PKCS8A, b.PKCS8A)
	same(t, a.PKCS8B, b.PKCS8B)
	same(t, a.PKA, b.PKA)
	same(t, a.PKB, b.PKB)
}

func rejectKeyMaterialForTest(t testing.TB, m KeyMaterial) {
	t.Helper()
	k, p, err := ImportKeyMaterial(m)
	if k != nil {
		k.Destroy()
	}
	if err == nil || k != nil || len(p.PKA) != 0 || len(p.PKB) != 0 {
		t.Fatal("invalid material returned a key, public pair or successful result")
	}
}

func TestKeyMaterial(t *testing.T) {
	// One fresh, temporary research pair for every positive and negative case.
	// No private bytes are logged, serialized to fixtures, or written to disk.
	original, public, err := KeyGen()
	requireNoError(t, err)
	defer original.Destroy()
	material, err := ExportKeyMaterial(original)
	requireNoError(t, err)
	defer material.Clear()
	if KeyMaterialFormat != "YNX-BATCH/KEY-MATERIAL/v1" || Version != "YNX-BATCH/v0.1" ||
		Suite != "ML-DSA-87+SHA3-512/AND/SLH-DSA-SHA2-256f+SHA-512" {
		t.Fatal("material profile identifiers changed")
	}
	if len(material.PKCS8A) != 54 || len(material.PKCS8B) != 150 ||
		len(material.PKA) != 2592 || len(material.PKB) != 64 {
		t.Fatal("material profile sizes changed")
	}
	headerA := hx(t, "3034020100300b060960864801650304031304228020")
	headerB := hx(t, "308193020100300b0609608648016503040319048180")
	same(t, material.PKCS8A[:len(headerA)], headerA)
	same(t, material.PKCS8B[:len(headerB)], headerB)
	same(t, material.PKA, public.PKA)
	same(t, material.PKB, public.PKB)

	t.Run("redacted formatting and no JSON interface", func(t *testing.T) {
		for _, value := range []any{material, &material} {
			for _, format := range []string{"%v", "%+v", "%#v", "%s"} {
				if fmt.Sprintf(format, value) != "YNX-BATCH key material [REDACTED]" {
					t.Fatal("key material formatting was not redacted")
				}
			}
			encoded, err := json.Marshal(value)
			requireNoError(t, err)
			if string(encoded) != "{}" {
				clear(encoded)
				t.Fatal("key material exposed fields through JSON")
			}
		}
	})

	t.Run("strict lengths and DER", func(t *testing.T) {
		for _, tc := range []struct {
			name   string
			change func(*KeyMaterial)
		}{
			{"missing A", func(m *KeyMaterial) { m.PKCS8A = nil }},
			{"missing B", func(m *KeyMaterial) { m.PKCS8B = nil }},
			{"short A", func(m *KeyMaterial) { m.PKCS8A = m.PKCS8A[:53] }},
			{"short B", func(m *KeyMaterial) { m.PKCS8B = m.PKCS8B[:149] }},
			{"trailing A", func(m *KeyMaterial) { m.PKCS8A = append(m.PKCS8A, 0) }},
			{"trailing B", func(m *KeyMaterial) { m.PKCS8B = append(m.PKCS8B, 0) }},
			{"expanded ML-DSA forbidden", func(m *KeyMaterial) { m.PKCS8A = make([]byte, 4896) }},
			{"raw SLH forbidden", func(m *KeyMaterial) { m.PKCS8B = m.PKCS8B[len(headerB):] }},
			{"short public A", func(m *KeyMaterial) { m.PKA = m.PKA[:2591] }},
			{"short public B", func(m *KeyMaterial) { m.PKB = m.PKB[:63] }},
			{"long public A", func(m *KeyMaterial) { m.PKA = append(m.PKA, 0) }},
			{"long public B", func(m *KeyMaterial) { m.PKB = append(m.PKB, 0) }},
			{"BER indefinite A", func(m *KeyMaterial) { m.PKCS8A[1] = 0x80 }},
			{"BER indefinite B", func(m *KeyMaterial) { m.PKCS8B[1] = 0x80 }},
			{"swapped algorithms", func(m *KeyMaterial) { m.PKCS8A, m.PKCS8B = m.PKCS8B, m.PKCS8A }},
		} {
			t.Run(tc.name, func(t *testing.T) {
				m := copyKeyMaterialForTest(material)
				// Keep the original allocations for cleanup even if a case reslices
				// or replaces a field. Clear both the old and new explicit buffers.
				owned := m
				defer owned.Clear()
				defer func() { m.Clear() }()
				tc.change(&m)
				rejectKeyMaterialForTest(t, m)
			})
		}
		// Every tag/length/OID/version/profile byte is exact, not just the OID.
		for branch, header := range [][]byte{headerA, headerB} {
			for i := range header {
				func() {
					m := copyKeyMaterialForTest(material)
					defer m.Clear()
					if branch == 0 {
						m.PKCS8A[i] ^= 1
					} else {
						m.PKCS8B[i] ^= 1
					}
					rejectKeyMaterialForTest(t, m)
				}()
			}
		}
	})

	t.Run("private public and SLH root consistency", func(t *testing.T) {
		for _, tc := range []struct {
			name   string
			change func(*KeyMaterial)
		}{
			{"ML seed with original public", func(m *KeyMaterial) { m.PKCS8A[len(headerA)] ^= 1 }},
			{"SLH private seed with original embedded root", func(m *KeyMaterial) { m.PKCS8B[len(headerB)] ^= 1 }},
			{"SLH public seed with original root", func(m *KeyMaterial) { m.PKCS8B[len(headerB)+64] ^= 1 }},
			{"SLH embedded root", func(m *KeyMaterial) { m.PKCS8B[len(headerB)+96] ^= 1 }},
			{"wrong expected public A", func(m *KeyMaterial) { m.PKA[0] ^= 1 }},
			{"wrong expected public B", func(m *KeyMaterial) { m.PKB[0] ^= 1 }},
		} {
			t.Run(tc.name, func(t *testing.T) {
				m := copyKeyMaterialForTest(material)
				defer m.Clear()
				tc.change(&m)
				rejectKeyMaterialForTest(t, m)
			})
		}
	})

	t.Run("SLH PRF is not an authenticated backup binding", func(t *testing.T) {
		// SK.prf is independent of the public root. Changing only it yields
		// consistent material with the same public pair; backup AEAD must detect
		// unauthorized backup changes. The math layer must not invent a rejection.
		m := copyKeyMaterialForTest(material)
		defer m.Clear()
		m.PKCS8B[len(headerB)+32] ^= 1
		k, p, err := ImportKeyMaterial(m)
		requireNoError(t, err)
		defer k.Destroy()
		same(t, p.PKA, material.PKA)
		same(t, p.PKB, material.PKB)
		out, err := ExportKeyMaterial(k)
		requireNoError(t, err)
		defer out.Clear()
		sameKeyMaterialForTest(t, out, m)
	})

	t.Run("detached recovery signing and shared destruction", func(t *testing.T) {
		borrowed := copyKeyMaterialForTest(material)
		defer borrowed.Clear()
		before := copyKeyMaterialForTest(borrowed)
		defer before.Clear()
		k, p, err := ImportKeyMaterial(borrowed)
		requireNoError(t, err)
		defer k.Destroy()
		sameKeyMaterialForTest(t, borrowed, before) // Import does not consume input.
		same(t, p.PKA, material.PKA)
		same(t, p.PKB, material.PKB)
		borrowed.Clear()
		p.PKA[0] ^= 1
		p.PKB[0] ^= 1
		out, err := ExportKeyMaterial(k)
		requireNoError(t, err)
		defer out.Clear()
		sameKeyMaterialForTest(t, out, material)
		aliases := out
		out.Clear()
		for _, buf := range [][]byte{aliases.PKCS8A, aliases.PKCS8B, aliases.PKA, aliases.PKB} {
			if !bytes.Equal(buf, make([]byte, len(buf))) {
				t.Fatal("Clear did not clear an explicit buffer")
			}
		}
		if out.PKCS8A != nil || out.PKCS8B != nil || out.PKA != nil || out.PKB != nil {
			t.Fatal("Clear retained slice references")
		}
		out, err = ExportKeyMaterial(k)
		requireNoError(t, err)
		sameKeyMaterialForTest(t, out, material)
		// Restoring does not borrow the original handle's lifetime either.
		original.Destroy()
		metadata := Metadata{ChainID: bytes.Repeat([]byte{0x69}, 32),
			Owner: "key-material-fresh-research-only", Purpose: "TX-BATCH"}
		messages := [][]byte{[]byte("complete synthetic recovery test message")}
		batch, err := BatchSign(k, metadata, messages, SignOptions{Optimized: true})
		requireNoError(t, err)
		defer batch.Discard()
		wire, err := batch.CertificateWire()
		requireNoError(t, err)
		certificate, err := DecodeCertificate(wire)
		requireNoError(t, err)
		same(t, certificate.PKA, material.PKA)
		same(t, certificate.PKB, material.PKB)
		r := registration(certificate) // Explicit research resolver, no account claim.
		v := verifier(t, &r, 1, true)
		whole, err := batch.WholeWire()
		requireNoError(t, err)
		requireNoError(t, v.VerifyWhole(whole, 7))
		member, err := Extract(batch, 0)
		requireNoError(t, err)
		memberWire, err := EncodeMember(member)
		requireNoError(t, err)
		requireNoError(t, v.VerifyOne(memberWire, 7))
		alias := *k
		alias.Destroy()
		for _, retired := range []*PrivateKey{original, k, &alias} {
			out, err := ExportKeyMaterial(retired)
			out.Clear()
			requireError(t, err)
			_, err = BatchSign(retired, metadata, messages, SignOptions{})
			requireError(t, err)
		}
	})
}

func TestKeyMaterialEmptyHandles(t *testing.T) {
	for _, k := range []*PrivateKey{nil, {}} {
		m, err := ExportKeyMaterial(k)
		m.Clear()
		requireError(t, err)
	}
	rejectKeyMaterialForTest(t, KeyMaterial{})
	var nilMaterial *KeyMaterial
	nilMaterial.Clear()
}
