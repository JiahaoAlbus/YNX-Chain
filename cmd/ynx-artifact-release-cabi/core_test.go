package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		// Do not print provider inputs or errors that may later acquire fields.
		t.Fatal("unexpected operation error")
	}
}

func cloneMaterial(m ynxbatch.KeyMaterial) ynxbatch.KeyMaterial {
	return ynxbatch.KeyMaterial{PKCS8A: bytes.Clone(m.PKCS8A), PKCS8B: bytes.Clone(m.PKCS8B),
		PKA: bytes.Clone(m.PKA), PKB: bytes.Clone(m.PKB)}
}

func equalMaterial(t *testing.T, a, b ynxbatch.KeyMaterial) {
	t.Helper()
	if !bytes.Equal(a.PKCS8A, b.PKCS8A) || !bytes.Equal(a.PKCS8B, b.PKCS8B) ||
		!bytes.Equal(a.PKA, b.PKA) || !bytes.Equal(a.PKB, b.PKB) {
		t.Fatal("borrowed material changed")
	}
}

func TestArtifactReleaseCore(t *testing.T) {
	// One fresh research pair, temporary process memory only. No private fixture,
	// raw secret, account authority, key file or production identity is emitted.
	key, public, err := ynxbatch.KeyGen()
	must(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	must(t, err)
	defer material.Clear()
	before := cloneMaterial(material)
	defer before.Clear()
	expected := ynxbatch.ArtifactPublisherRegistration{NetworkID: bytes.Repeat([]byte{0xa7}, 32),
		SubjectOwner: "0x" + strings.Repeat("7", 40), Account: "synthetic-cabi-account",
		ProjectID: "artifact-cabi-research", PublisherID: "synthetic-cabi-publisher", PublisherKeyVersion: "18446744073709551615",
		PKA: public.PKA, PKB: public.PKB}
	registration, err := ynxbatch.EncodeArtifactPublisherRegistration(expected)
	must(t, err)
	manifest := []byte(`{"byteSize":1,"contentDigest":"` + strings.Repeat("a", 64) + `","projectId":"artifact-cabi-research","publishPurpose":"release","targetEnvironment":"test","version":"1"}`)
	in := publicationInputs{registration: registration, manifest: manifest, expected: expected}
	plan, code := preparePublication(in, memberCapacity)
	if code != resultOK || publicationMemberMaximum > memberCapacity {
		t.Fatal("valid public preflight failed")
	}

	t.Run("public preflight rejects before private import", func(t *testing.T) {
		for _, capacity := range []uint64{0, memberCapacity - 1, memberCapacity + 1, ^uint64(0)} {
			if _, code := preparePublication(in, capacity); code != resultCapacity {
				t.Fatal("incorrect capacity accepted")
			}
		}
		for _, tc := range []struct {
			name string
			edit func(*publicationInputs)
		}{
			{"owner", func(x *publicationInputs) { x.expected.SubjectOwner = "0x" + strings.Repeat("8", 40) }},
			{"account", func(x *publicationInputs) { x.expected.Account = "different-account" }},
			{"project", func(x *publicationInputs) { x.expected.ProjectID = "different-project" }},
			{"publisher", func(x *publicationInputs) { x.expected.PublisherID = "different-publisher" }},
			{"key version", func(x *publicationInputs) { x.expected.PublisherKeyVersion = "1" }},
			{"network", func(x *publicationInputs) { x.expected.NetworkID = bytes.Repeat([]byte{0xb8}, 32) }},
			{"public A", func(x *publicationInputs) { x.expected.PKA = make([]byte, 2592) }},
			{"public B", func(x *publicationInputs) { x.expected.PKB = make([]byte, 64) }},
			{"purpose", func(x *publicationInputs) {
				x.registration = bytes.Replace(x.registration, []byte("ARTIFACT-RELEASE"), []byte("AUTH-KEY-CALLBAD"), 1)
			}},
			{"trailing R", func(x *publicationInputs) { x.registration = append(bytes.Clone(x.registration), 0) }},
			{"manifest whitespace", func(x *publicationInputs) { x.manifest = append([]byte{' '}, x.manifest...) }},
			{"manifest project", func(x *publicationInputs) {
				x.manifest = bytes.Replace(x.manifest, []byte("artifact-cabi-research"), []byte("different-project"), 1)
			}},
		} {
			t.Run(tc.name, func(t *testing.T) {
				x := in
				tc.edit(&x)
				if _, code := preparePublication(x, memberCapacity); code != resultPublicBinding {
					t.Fatal("incorrect public binding accepted")
				}
			})
		}
		x := in
		x.registration = make([]byte, registrationMaximum+1)
		if _, code := preparePublication(x, memberCapacity); code != resultBounds {
			t.Fatal("oversized registration accepted")
		}
		x = in
		x.manifest = make([]byte, manifestMaximum+1)
		if _, code := preparePublication(x, memberCapacity); code != resultBounds {
			t.Fatal("oversized manifest accepted")
		}
	})

	t.Run("key mismatch and private seed consistency", func(t *testing.T) {
		for _, tc := range []struct {
			name string
			edit func(*ynxbatch.KeyMaterial)
		}{
			{"A DER", func(m *ynxbatch.KeyMaterial) { m.PKCS8A[0] ^= 1 }},
			{"A seed", func(m *ynxbatch.KeyMaterial) { m.PKCS8A[22] ^= 1 }},
			{"B seed with embedded original root", func(m *ynxbatch.KeyMaterial) { m.PKCS8B[22] ^= 1 }},
			{"B embedded root", func(m *ynxbatch.KeyMaterial) { m.PKCS8B[118] ^= 1 }},
			{"KEY7 public A", func(m *ynxbatch.KeyMaterial) { m.PKA[0] ^= 1 }},
			{"KEY7 public B", func(m *ynxbatch.KeyMaterial) { m.PKB[0] ^= 1 }},
		} {
			t.Run(tc.name, func(t *testing.T) {
				m := cloneMaterial(material)
				defer m.Clear()
				tc.edit(&m)
				snapshot := cloneMaterial(m)
				defer snapshot.Clear()
				out, code, cleanup := signPrepared(plan, m)
				if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
					t.Fatal("invalid material was signed or cleanup was misreported")
				}
				equalMaterial(t, m, snapshot)
			})
		}
	})

	t.Run("real fixed-purpose N1 signature and no retained key", func(t *testing.T) {
		out, code, cleanup := signPrepared(plan, material)
		if code != resultOK || cleanup != cleanupLogicalComplete || len(out) == 0 || len(out) > memberCapacity {
			t.Fatal("valid signature or logical cleanup failed")
		}
		member, err := ynxbatch.InspectArtifactPublicationMember(out, expected, manifest)
		must(t, err)
		v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: expected.NetworkID,
			Purpose: ynxbatch.ArtifactPublicationPurpose, ResolveTrustedOwner: func(q ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
				// This explicit local test resolver is not a Main/Auth grant.
				return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: expected.NetworkID,
					Owner: expected.SubjectOwner, Purpose: ynxbatch.ArtifactPublicationPurpose, PKA: expected.PKA, PKB: expected.PKB,
					PolicyRevision: "synthetic-test-only", Enabled: true}, nil
			}})
		must(t, err)
		must(t, v.VerifyOne(out, 0))
		for _, branch := range []string{"A", "B"} {
			bad, err := ynxbatch.DecodeMember(out)
			must(t, err)
			if branch == "A" {
				bad.Certificate.SigmaA[0] ^= 1
			} else {
				bad.Certificate.SigmaB[0] ^= 1
			}
			wire, err := ynxbatch.EncodeMember(bad)
			must(t, err)
			if err := v.VerifyOne(wire, 0); err == nil {
				t.Fatal("single signature branch corruption accepted")
			}
		}
		if member.Certificate.N != 1 || member.Index != 0 || len(member.PathA) != 0 || len(member.PathB) != 0 ||
			member.Certificate.Purpose != ynxbatch.ArtifactPublicationPurpose || !bytes.Equal(member.Message, plan.message) {
			t.Fatal("publication profile changed")
		}
		equalMaterial(t, material, before)
		// Removing the borrowed secret must prevent a subsequent call from
		// finding an earlier imported handle. This makes no physical-wipe claim.
		clear(material.PKCS8A)
		clear(material.PKCS8B)
		out, code, cleanup = signPrepared(plan, material)
		if code != resultKeyMaterial || cleanup != cleanupLogicalComplete || len(out) != 0 {
			t.Fatal("retained private key or missing failure cleanup")
		}
	})
}

func TestArtifactReleaseCleanupGate(t *testing.T) {
	steps := 0
	clean := runLogicalCleanup(func() { steps++; panic("synthetic cleanup failure") }, func() { steps++ })
	if clean || steps != 2 {
		t.Fatal("cleanup failure skipped remaining cleanup or reported success")
	}
	for _, tc := range []struct {
		panicked, clean bool
		wantCode        resultCode
		wantCleanup     cleanupCode
	}{
		{false, false, resultCleanup, cleanupFailed},
		{true, true, resultInternal, cleanupUnknown},
		{true, false, resultCleanup, cleanupFailed},
	} {
		candidate := []byte("synthetic public signature output")
		out, code, cleanup := finishPublication(candidate, resultOK, tc.panicked, tc.clean)
		if len(out) != 0 || code != tc.wantCode || cleanup != tc.wantCleanup ||
			!bytes.Equal(candidate, make([]byte, len(candidate))) {
			t.Fatal("uncertain or failed cleanup released output")
		}
	}
}

func TestArtifactReleaseMemoryLayout(t *testing.T) {
	request := memoryRange{0x1000, 0x200}
	inputs := []memoryRange{{0x2000, 54}, {0x3000, 150}, {0x4000, 2592}, {0x5000, 64}}
	outputs := []memoryRange{{0x10000, memberCapacity}, {0x30000, 8}, {0x40000, 4}}
	if checkMemoryLayout(request, inputs, outputs) != resultOK {
		t.Fatal("disjoint layout refused")
	}
	for _, target := range append(append([]memoryRange{request}, inputs...), outputs[1:]...) {
		out := append([]memoryRange(nil), outputs...)
		out[0] = target
		if checkMemoryLayout(request, inputs, out) != resultOverlap {
			t.Fatal("writable overlap accepted")
		}
	}
	for i := 1; i < len(outputs); i++ {
		out := append([]memoryRange(nil), outputs...)
		out[i] = memoryRange{inputs[0].start + 1, 4}
		if checkMemoryLayout(request, inputs, out) != resultOverlap {
			t.Fatal("scalar output can overwrite private input")
		}
	}
	for _, invalid := range []memoryRange{{0, 1}, {1, 0}, {^uintptr(0) - 1, 3}, {^uintptr(0), 1}} {
		in := append([]memoryRange(nil), inputs...)
		in[0] = invalid
		if checkMemoryLayout(request, in, outputs) != resultBounds {
			t.Fatal("null or overflowing extent accepted")
		}
	}
	// Adjacent half-open ranges and input/input aliases are legal borrows.
	in := append(inputs, inputs[0])
	out := []memoryRange{{0x10000, 10}, {0x1000a, 8}, {0x10012, 4}}
	if checkMemoryLayout(request, in, out) != resultOK {
		t.Fatal("adjacent output or input alias rejected")
	}
}
