package main

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func registeredN1Fixture(t *testing.T, messages [][]byte) registeredN1Inputs {
	t.Helper()
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	t.Cleanup(key.Destroy)
	metadata := ynxbatch.Metadata{ChainID: bytes.Repeat([]byte{0x41}, 32), Owner: "0x" + strings.Repeat("11", 20), Purpose: "SOURCE-ROOT-READ-V2"}
	batch, err := ynxbatch.BatchSign(key, metadata, messages, ynxbatch.SignOptions{Optimized: true})
	requireNoError(t, err)
	t.Cleanup(batch.Discard)
	member, err := ynxbatch.Extract(batch, 0)
	requireNoError(t, err)
	wire, err := ynxbatch.EncodeMember(member)
	requireNoError(t, err)
	return registeredN1Inputs{member: wire, message: bytes.Clone(messages[0]), network: metadata.ChainID, owner: metadata.Owner,
		purpose: metadata.Purpose, pkA: public.PKA, pkB: public.PKB, policyRevision: 7, observedHeight: 12, activeFrom: 10, enabled: 1}
}

func registeredN1Clone(in registeredN1Inputs) registeredN1Inputs {
	in.member, in.message, in.network = bytes.Clone(in.member), bytes.Clone(in.message), bytes.Clone(in.network)
	in.pkA, in.pkB = bytes.Clone(in.pkA), bytes.Clone(in.pkB)
	return in
}

func TestRegisteredN1VerifyActualANDAndExpectedBinding(t *testing.T) {
	message, err := ynxbatch.EncodeFields([]byte("SYNTHETIC-SOURCE-ROOT-READ-V2"), []byte("original-operation"))
	requireNoError(t, err)
	in := registeredN1Fixture(t, [][]byte{message})
	original := registeredN1Clone(in)
	if got := verifyRegisteredANDMemberN1(in); got != registeredN1OK {
		t.Fatalf("actual dual signature failed: %d", got)
	}
	// An independent ordinary verifier must execute both original signature
	// branches; a result from the new ABI is never reused as trust or a cache hit.
	v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: in.network, Purpose: in.purpose,
		ResolveTrustedOwner: func(r ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			if !bytes.Equal(r.ChainID, in.network) || r.Owner != in.owner || r.Purpose != in.purpose || r.Height != in.observedHeight {
				return ynxbatch.Registration{}, ynxbatch.ErrUntrusted
			}
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: in.network, Owner: in.owner,
				Purpose: in.purpose, PKA: in.pkA, PKB: in.pkB, PolicyRevision: "7", ActiveFrom: in.activeFrom, Enabled: true}, nil
		}})
	requireNoError(t, err)
	requireNoError(t, v.VerifyOne(in.member, in.observedHeight))
	if v.Stats().SignatureChecks != 2 || v.Stats().CacheHits != 0 {
		t.Fatal("independent verifier did not execute full AND mathematics")
	}
	for _, change := range []struct {
		name string
		edit func(*ynxbatch.Member)
	}{
		{"ML-DSA signature", func(m *ynxbatch.Member) { m.Certificate.SigmaA[0] ^= 1 }},
		{"SLH-DSA signature", func(m *ynxbatch.Member) { m.Certificate.SigmaB[0] ^= 1 }},
		{"A tree root", func(m *ynxbatch.Member) { m.Certificate.RootA[0] ^= 1 }},
		{"B tree root", func(m *ynxbatch.Member) { m.Certificate.RootB[0] ^= 1 }},
	} {
		t.Run(change.name, func(t *testing.T) {
			member, err := ynxbatch.DecodeMember(in.member)
			requireNoError(t, err)
			change.edit(&member)
			bad := registeredN1Clone(in)
			bad.member, err = ynxbatch.EncodeMember(member)
			requireNoError(t, err)
			if got := verifyRegisteredANDMemberN1(bad); got != registeredN1MathInvalid {
				t.Fatalf("changed branch/root accepted: %d", got)
			}
		})
	}
	for _, change := range []struct {
		name string
		edit func(*registeredN1Inputs)
	}{
		{"network", func(x *registeredN1Inputs) { x.network[0] ^= 1 }},
		{"owner", func(x *registeredN1Inputs) { x.owner = "0x" + strings.Repeat("22", 20) }},
		{"purpose", func(x *registeredN1Inputs) { x.purpose = "SOURCE-DEVICE-REVOKE-V2" }},
		{"complete public A", func(x *registeredN1Inputs) { x.pkA[0] ^= 1 }},
		{"complete public B", func(x *registeredN1Inputs) { x.pkB[0] ^= 1 }},
	} {
		t.Run(change.name, func(t *testing.T) {
			bad := registeredN1Clone(in)
			change.edit(&bad)
			if got := verifyRegisteredANDMemberN1(bad); got != registeredN1TrustDenied {
				t.Fatalf("certificate supplied its own expected binding: %d", got)
			}
		})
	}
	bad := registeredN1Clone(in)
	bad.message[len(bad.message)-1] ^= 1
	if got := verifyRegisteredANDMemberN1(bad); got != registeredN1MathInvalid {
		t.Fatal("different exact expected transcript accepted")
	}
	// Keep both certificate signatures valid but change the member AND expected
	// message together: only the real dual tree membership check can reject it.
	member, err := ynxbatch.DecodeMember(in.member)
	requireNoError(t, err)
	member.Message[len(member.Message)-1] ^= 1
	bad.message = bytes.Clone(member.Message)
	bad.member, err = ynxbatch.EncodeMember(member)
	requireNoError(t, err)
	if got := verifyRegisteredANDMemberN1(bad); got != registeredN1MathInvalid {
		t.Fatal("valid certificate allowed a different leaf message")
	}
	if !bytes.Equal(in.member, original.member) || !bytes.Equal(in.message, original.message) || !bytes.Equal(in.network, original.network) ||
		!bytes.Equal(in.pkA, original.pkA) || !bytes.Equal(in.pkB, original.pkB) {
		t.Fatal("public borrowed input mutated")
	}
}

func TestRegisteredN1VerifyN1AndStrictWire(t *testing.T) {
	in := registeredN1Fixture(t, [][]byte{[]byte("first"), []byte("second")})
	if got := verifyRegisteredANDMemberN1(in); got != registeredN1Required {
		t.Fatalf("well-formed N2 member accepted by N1 ABI: %d", got)
	}
	in = registeredN1Fixture(t, [][]byte{[]byte("single")})
	for _, raw := range [][]byte{nil, in.member[:len(in.member)-1], append(bytes.Clone(in.member), 0), []byte("not a member")} {
		bad := registeredN1Clone(in)
		bad.member = raw
		want := registeredN1Malformed
		if len(raw) == 0 {
			want = registeredN1Argument
		}
		if got := verifyRegisteredANDMemberN1(bad); got != want {
			t.Fatalf("strict framing failure returned %d, want %d", got, want)
		}
	}
	// Rebuild E frames directly so the wire actually contains a forbidden N1
	// index or nonempty A/B path; EncodeMember would correctly refuse to make it.
	for _, branch := range []string{"index", "A path", "B path"} {
		outer, err := ynxbatch.DecodeFields(in.member, 4, ynxbatch.MaxMemberBytes)
		requireNoError(t, err)
		proof, err := ynxbatch.DecodeFields(outer[3], 3, ynxbatch.MaxProofBytes)
		requireNoError(t, err)
		switch branch {
		case "index":
			binary.BigEndian.PutUint32(proof[0], 1)
		case "A path":
			proof[1], err = ynxbatch.EncodeFields(make([]byte, 64))
		case "B path":
			proof[2], err = ynxbatch.EncodeFields(make([]byte, 64))
		}
		requireNoError(t, err)
		outer[3], err = ynxbatch.EncodeFields(proof...)
		requireNoError(t, err)
		bad := registeredN1Clone(in)
		bad.member, err = ynxbatch.EncodeFields(outer...)
		requireNoError(t, err)
		if got := verifyRegisteredANDMemberN1(bad); got != registeredN1Malformed {
			t.Fatalf("malformed N1 %s accepted: %d", branch, got)
		}
	}
}

func TestRegisteredN1VerifyCurrentPolicyAndBounds(t *testing.T) {
	in := registeredN1Fixture(t, [][]byte{[]byte("policy input")})
	for _, change := range []struct {
		name string
		edit func(*registeredN1Inputs)
		want registeredN1VerifyCode
	}{
		{"disabled", func(x *registeredN1Inputs) { x.enabled = 0 }, registeredN1TrustDenied},
		{"bad enabled flag", func(x *registeredN1Inputs) { x.enabled = 2 }, registeredN1Argument},
		{"bad revoke flag", func(x *registeredN1Inputs) { x.hasRevokedAt = 2 }, registeredN1Argument},
		{"hidden revoke", func(x *registeredN1Inputs) { x.revokedAt = 20 }, registeredN1Argument},
		{"zero revision", func(x *registeredN1Inputs) { x.policyRevision = 0 }, registeredN1TrustDenied},
		{"zero observed height", func(x *registeredN1Inputs) { x.observedHeight = 0 }, registeredN1TrustDenied},
		{"not active", func(x *registeredN1Inputs) { x.activeFrom = x.observedHeight + 1 }, registeredN1TrustDenied},
		{"revoked boundary", func(x *registeredN1Inputs) { x.hasRevokedAt, x.revokedAt = 1, x.observedHeight }, registeredN1TrustDenied},
		{"revoked earlier", func(x *registeredN1Inputs) { x.hasRevokedAt, x.revokedAt = 1, x.observedHeight-1 }, registeredN1TrustDenied},
		{"invalid revoke interval", func(x *registeredN1Inputs) { x.hasRevokedAt, x.revokedAt = 1, x.activeFrom-1 }, registeredN1TrustDenied},
		{"member cap", func(x *registeredN1Inputs) { x.member = make([]byte, registeredN1MemberMaximum+1) }, registeredN1Argument},
		{"message cap", func(x *registeredN1Inputs) { x.message = make([]byte, registeredN1MessageMaximum+1) }, registeredN1Argument},
		{"short network", func(x *registeredN1Inputs) { x.network = x.network[:31] }, registeredN1Argument},
		{"short public A", func(x *registeredN1Inputs) { x.pkA = x.pkA[:2591] }, registeredN1Argument},
		{"short public B", func(x *registeredN1Inputs) { x.pkB = x.pkB[:63] }, registeredN1Argument},
		{"empty owner", func(x *registeredN1Inputs) { x.owner = "" }, registeredN1Argument},
		{"large owner", func(x *registeredN1Inputs) { x.owner = strings.Repeat("a", 129) }, registeredN1Argument},
		{"owner NUL", func(x *registeredN1Inputs) { x.owner = "owner\x00other" }, registeredN1Argument},
		{"owner non ASCII", func(x *registeredN1Inputs) { x.owner = "所有者" }, registeredN1Argument},
		{"empty purpose", func(x *registeredN1Inputs) { x.purpose = "" }, registeredN1Argument},
		{"large purpose", func(x *registeredN1Inputs) { x.purpose = strings.Repeat("p", 65) }, registeredN1Argument},
		{"purpose LF", func(x *registeredN1Inputs) { x.purpose += "\n" }, registeredN1Argument},
	} {
		t.Run(change.name, func(t *testing.T) {
			bad := registeredN1Clone(in)
			change.edit(&bad)
			if got := verifyRegisteredANDMemberN1(bad); got != change.want {
				t.Fatalf("current expected binding returned %d, want %d", got, change.want)
			}
		})
	}
	// Boundary before a future revocation remains live; each later invocation
	// rechecks the new observed height rather than borrowing an earlier success.
	in.hasRevokedAt, in.revokedAt = 1, in.observedHeight+1
	if got := verifyRegisteredANDMemberN1(in); got != registeredN1OK {
		t.Fatalf("future revocation denied current public mathematics: %d", got)
	}
	in.observedHeight++
	if got := verifyRegisteredANDMemberN1(in); got != registeredN1TrustDenied {
		t.Fatal("previous successful call bypassed current revocation")
	}
}

func TestRegisteredN1VerifyEmptyMessageAndNullBridge(t *testing.T) {
	in := registeredN1Fixture(t, [][]byte{nil})
	if got := verifyRegisteredANDMemberN1(in); got != registeredN1OK {
		t.Fatalf("valid empty opaque N1 message rejected: %d", got)
	}
	if got := int32(YNXRegisteredANDMemberVerifyN1V1(nil, nil)); got != int32(registeredN1Argument) {
		t.Fatal("null ABI pointers accepted")
	}
}
