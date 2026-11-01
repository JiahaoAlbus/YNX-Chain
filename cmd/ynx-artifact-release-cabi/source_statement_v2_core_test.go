package main

import (
	"bytes"
	"encoding/hex"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
	"strings"
	"testing"
)

func TestAuthSourceStatementV2CABIPUBLICANDAndBinding(t *testing.T) {
	key, pub, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	in := sourceStatementV2Inputs{body: []byte(`{"original":"synthetic-public-DATA","version":2}`), frame: "SYNTHETIC-INDEPENDENT-RELEASE-FRAME", role: ynxbatch.AuthSourceEnrollmentV2, issuedHeight: 11,
		registration: registeredN1Inputs{network: bytes.Repeat([]byte{0x39}, 32), owner: "0x" + strings.Repeat("12", 20), pkA: pub.PKA, pkB: pub.PKB, policyRevision: 7, observedHeight: 12, activeFrom: 10, enabled: 1}}
	for _, role := range []ynxbatch.AuthSourceStatementV2Role{ynxbatch.AuthSourceEnrollmentV2, ynxbatch.AuthSourceProfileV2, ynxbatch.AuthSourceCurrentV2} {
		in.role = role
		if role == ynxbatch.AuthSourceCurrentV2 {
			in.issuedHeight = 12
		}
		// Independently spell the old E8 instead of signing the new builder output.
		roleName := map[ynxbatch.AuthSourceStatementV2Role]string{1: "enrollment", 2: "profile", 3: "current"}[role]
		height := "11"
		if role == 3 {
			height = "12"
		}
		message, e := ynxbatch.EncodeFields([]byte("YNX/AUTH/SOURCE-ORIGINAL/V2"), []byte(roleName), []byte(in.frame), []byte(hex.EncodeToString(in.registration.network)), []byte(in.registration.owner), []byte("7"), []byte(height), in.body)
		requireNoError(t, e)
		purpose, e := ynxbatch.AuthSourceStatementV2Purpose(role)
		requireNoError(t, e)
		batch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: in.registration.network, Owner: in.registration.owner, Purpose: purpose}, [][]byte{message}, ynxbatch.SignOptions{Optimized: true})
		requireNoError(t, e)
		member, e := ynxbatch.Extract(batch, 0)
		requireNoError(t, e)
		batch.Discard()
		in.registration.member, e = ynxbatch.EncodeMember(member)
		requireNoError(t, e)
		if got := verifySourceStatementV2(in); got != registeredN1OK {
			t.Fatalf("role %d actual AND result %d", role, got)
		}
		if failed := sourceStatementV2ForeignControls(in); failed != 0 {
			t.Fatalf("real C boundary control %d failed", failed)
		}
		// Run expensive corrupt signature negatives once; all other substitutions
		// are rejected by exact per-call binding before signature work.
		if role != ynxbatch.AuthSourceEnrollmentV2 {
			continue
		}
		for _, branch := range []string{"A", "B", "rootA", "rootB"} {
			m, e := ynxbatch.DecodeMember(in.registration.member)
			requireNoError(t, e)
			switch branch {
			case "A":
				m.Certificate.SigmaA[0] ^= 1
			case "B":
				m.Certificate.SigmaB[0] ^= 1
			case "rootA":
				m.Certificate.RootA[0] ^= 1
			case "rootB":
				m.Certificate.RootB[0] ^= 1
			}
			bad := in
			bad.registration.member, e = ynxbatch.EncodeMember(m)
			requireNoError(t, e)
			if got := verifySourceStatementV2(bad); got != registeredN1MathInvalid {
				t.Fatalf("corrupt %s accepted: %d", branch, got)
			}
		}
		for _, mutate := range []func(*sourceStatementV2Inputs){
			func(x *sourceStatementV2Inputs) { x.frame += "WRONG" }, func(x *sourceStatementV2Inputs) { x.body = []byte(`{"original":"wrong"}`) },
			func(x *sourceStatementV2Inputs) { x.role = ynxbatch.AuthSourceCurrentV2 }, func(x *sourceStatementV2Inputs) { x.issuedHeight = 13 }, func(x *sourceStatementV2Inputs) { x.issuedHeight = 9 },
			func(x *sourceStatementV2Inputs) { x.registration.policyRevision++ }, func(x *sourceStatementV2Inputs) { x.registration.enabled = 0 },
			func(x *sourceStatementV2Inputs) { x.registration.hasRevokedAt = 1; x.registration.revokedAt = 12 }, func(x *sourceStatementV2Inputs) {
				x.registration.pkA = bytes.Clone(x.registration.pkA)
				x.registration.pkA[0] ^= 1
			},
			func(x *sourceStatementV2Inputs) {
				x.registration.pkB = bytes.Clone(x.registration.pkB)
				x.registration.pkB[0] ^= 1
			}, func(x *sourceStatementV2Inputs) {
				x.registration.network = bytes.Clone(x.registration.network)
				x.registration.network[0] ^= 1
			},
			func(x *sourceStatementV2Inputs) { x.registration.owner = "0x" + strings.Repeat("21", 20) },
		} {
			bad := in
			mutate(&bad)
			if verifySourceStatementV2(bad) == registeredN1OK {
				t.Fatal("changed independent expected DATA accepted")
			}
		}
	}
	// The original Source body cap is 65536, not the older generic message cap.
	// Reuse this same synthetic key; no extra account or private fixture is made.
	in.body = []byte(`"` + strings.Repeat("x", ynxbatch.AuthSourceStatementV2BodyMaximum-2) + `"`)
	in.role, in.issuedHeight = ynxbatch.AuthSourceCurrentV2, 12
	large, e := ynxbatch.BuildAuthSourceStatementV2(in.body, ynxbatch.AuthSourceStatementV2Binding{Role: in.role, Frame: in.frame, NetworkID: in.registration.network, Owner: in.registration.owner, KeyVersion: 7, IssuedHeight: 12})
	requireNoError(t, e)
	if len(large) <= registeredN1MessageMaximum {
		t.Fatal("boundary did not cross generic cap")
	}
	largeBatch, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: in.registration.network, Owner: in.registration.owner, Purpose: "AUTH-SOURCE-CURRENT"}, [][]byte{large}, ynxbatch.SignOptions{Optimized: true})
	requireNoError(t, e)
	largeMember, e := ynxbatch.Extract(largeBatch, 0)
	requireNoError(t, e)
	largeBatch.Discard()
	in.registration.member, e = ynxbatch.EncodeMember(largeMember)
	requireNoError(t, e)
	if verifySourceStatementV2(in) != registeredN1OK || sourceStatementV2ForeignControls(in) != 0 {
		t.Fatal("full original body failed real C/AND verification")
	}
	// A valid N2 certificate may not be borrowed as a Source N1 statement.
	n2, e := ynxbatch.BatchSign(key, ynxbatch.Metadata{ChainID: in.registration.network, Owner: in.registration.owner, Purpose: "AUTH-SOURCE-CURRENT"}, [][]byte{large, large}, ynxbatch.SignOptions{Optimized: true})
	requireNoError(t, e)
	n2m, e := ynxbatch.Extract(n2, 0)
	requireNoError(t, e)
	n2.Discard()
	in.registration.member, e = ynxbatch.EncodeMember(n2m)
	requireNoError(t, e)
	if verifySourceStatementV2(in) != registeredN1Required {
		t.Fatal("well formed N2 admitted as Source N1")
	}
	if int32(YNXAuthSourceStatementVerifyV2(nil, nil)) != int32(registeredN1Argument) {
		t.Fatal("null pointers accepted")
	}
}

func TestAuthSourceStatementV2CABIPUBLICOriginalBoundsRemain(t *testing.T) {
	in := registeredN1Inputs{member: []byte{1}, message: make([]byte, registeredN1MessageMaximum+1), network: make([]byte, 32), owner: "owner", purpose: "purpose", pkA: make([]byte, ynxbatch.PublicKeyASize), pkB: make([]byte, ynxbatch.PublicKeyBSize), policyRevision: 1, observedHeight: 1, enabled: 1}
	if verifyRegisteredANDMemberN1(in) != registeredN1Argument {
		t.Fatal("old ABI message cap changed")
	}
	in.message = nil
	in.member = make([]byte, registeredN1MemberMaximum+1)
	if verifyRegisteredANDMemberN1(in) != registeredN1Argument {
		t.Fatal("old ABI member cap changed")
	}
}
