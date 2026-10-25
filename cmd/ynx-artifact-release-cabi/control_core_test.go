package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func requireNoError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal("unexpected synthetic operation failure")
	}
}

func materialCopy(m ynxbatch.KeyMaterial) ynxbatch.KeyMaterial {
	return ynxbatch.KeyMaterial{PKCS8A: bytes.Clone(m.PKCS8A), PKCS8B: bytes.Clone(m.PKCS8B), PKA: bytes.Clone(m.PKA), PKB: bytes.Clone(m.PKB)}
}

func requireSameMaterial(t *testing.T, a, b ynxbatch.KeyMaterial) {
	t.Helper()
	if !bytes.Equal(a.PKCS8A, b.PKCS8A) || !bytes.Equal(a.PKCS8B, b.PKCS8B) || !bytes.Equal(a.PKA, b.PKA) || !bytes.Equal(a.PKB, b.PKB) {
		t.Fatal("borrowed key material changed")
	}
}

func syntheticInput(t *testing.T, p ynxbatch.PublicKey) controlInputs {
	t.Helper()
	owner := "0x" + strings.Repeat("1", 40)
	account, err := accountaddress.Encode(owner)
	requireNoError(t, err)
	principal := []byte(`{"Account":"` + account + `","DeviceID":"synthetic-device","SessionRef":"synthetic-session","CurrentRef":"synthetic-current","AccountGeneration":18446744073709551615,"SessionGeneration":9007199254740993,"ExpiresMS":60000}`)
	command := []byte(`{"RequestID":"synthetic-request","Action":"project.create","ProjectID":"synthetic-project","TeamID":"","SubjectAccount":"","PublisherID":"","RuntimeOrigin":"","ExpectedRevision":0,"GrantExpiresMS":0,"Read":false,"Publish":false,"Runtime":false,"Revoke":false,"ExpiresMS":60000,"PublicOriginalSHA256":""}`)
	ph, ch := sha256.Sum256(principal), sha256.Sum256(command)
	nonce := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32))
	decision := []byte(`{"commandSHA256":"` + hex.EncodeToString(ch[:]) + `","confirmationRef":"synthetic-confirmation","decision":"approve","expiresAtMs":20000,"issuedAtMs":1000,"nonce":"` + nonce + `","principalSHA256":"` + hex.EncodeToString(ph[:]) + `","requestId":"synthetic-request","reviewId":"synthetic-review","revocationRef":"synthetic-revocation","version":"YNX-IDE-PROJECT-CONTROL-DECISION/v1"}`)
	return controlInputs{principal: principal, command: command, decision: decision, atMS: 1001, expected: ynxbatch.ProjectControlBinding{NetworkID: bytes.Repeat([]byte{0x42}, 32), Owner: owner, KeyVersion: "18446744073709551615", ExecutionHeight: "13", CallerIdentity: "synthetic-native-caller", SourceCurrentRef: "synthetic-current", PKA: bytes.Clone(p.PKA), PKB: bytes.Clone(p.PKB)}}
}

func TestProjectControlCore(t *testing.T) {
	// Ephemeral research key only. No real account, file, grant or issuer.
	key, p, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	m, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer m.Clear()
	before := materialCopy(m)
	defer before.Clear()
	in := syntheticInput(t, p)
	plan, code := prepareControl(in, controlMemberCapacity)
	if code != resultOK || controlMemberMaximum > controlMemberCapacity {
		t.Fatal("valid fixed CONTROL preflight refused")
	}
	t.Run("expired original decision is refused before private import", func(t *testing.T) {
		bad := in
		bad.atMS = 20000
		if _, code := prepareControl(bad, controlMemberCapacity); code != resultPublicBinding {
			t.Fatal("expired approval was accepted")
		}
		bad = in
		bad.expected.SourceCurrentRef = "different-current"
		if _, code := prepareControl(bad, controlMemberCapacity); code != resultPublicBinding {
			t.Fatal("changed Source context accepted")
		}
		bad = in
		bad.command = append(bytes.Clone(in.command), ' ')
		if _, code := prepareControl(bad, controlMemberCapacity); code != resultPublicBinding {
			t.Fatal("nonoriginal command accepted")
		}
		bad = in
		bad.decision = bytes.Replace(in.decision, []byte(`"approve"`), []byte(`"cancel"`), 1)
		if _, code := prepareControl(bad, controlMemberCapacity); code != resultPublicBinding {
			t.Fatal("cancel reached signing profile")
		}
		for _, cap := range []uint64{0, controlMemberCapacity - 1, controlMemberCapacity + 1, ^uint64(0)} {
			if _, code := prepareControl(in, cap); code != resultCapacity {
				t.Fatal("capacity accepted")
			}
		}
		bad = in
		bad.principal = make([]byte, principalMaximum+1)
		if _, code := prepareControl(bad, controlMemberCapacity); code != resultBounds {
			t.Fatal("oversized principal accepted")
		}
	})
	t.Run("partial invalid custody releases nothing and preserves borrow", func(t *testing.T) {
		for _, edit := range []func(*ynxbatch.KeyMaterial){
			func(x *ynxbatch.KeyMaterial) { x.PKCS8A[0] ^= 1 },
			func(x *ynxbatch.KeyMaterial) { x.PKCS8A[22] ^= 1 },
			func(x *ynxbatch.KeyMaterial) { x.PKCS8B[22] ^= 1 },
			func(x *ynxbatch.KeyMaterial) { x.PKCS8B[118] ^= 1 },
			func(x *ynxbatch.KeyMaterial) { x.PKA[0] ^= 1 },
			func(x *ynxbatch.KeyMaterial) { x.PKB[0] ^= 1 },
		} {
			bad := materialCopy(m)
			edit(&bad)
			snapshot := materialCopy(bad)
			out, code, cleanup := signControlPrepared(plan, bad)
			if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
				t.Fatal("invalid key released signature or lost cleanup state")
			}
			requireSameMaterial(t, bad, snapshot)
			bad.Clear()
			snapshot.Clear()
		}
	})
	t.Run("actual AND output and purpose binding", func(t *testing.T) {
		wire, code, cleanup := signControlPrepared(plan, m)
		defer clear(wire)
		if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 {
			t.Fatal("fixed CONTROL sign failed")
		}
		v, err := ynxbatch.NewVerifier(ynxbatch.VerifierOptions{ChainID: in.expected.NetworkID, Purpose: ynxbatch.ProjectControlPurpose, Optimized: true, ResolveTrustedOwner: func(r ynxbatch.TrustRequest) (ynxbatch.Registration, error) {
			if r.Purpose != ynxbatch.ProjectControlPurpose || r.Owner != in.expected.Owner || r.Height != 13 || !bytes.Equal(r.ChainID, in.expected.NetworkID) {
				return ynxbatch.Registration{}, errors.New("synthetic binding mismatch")
			}
			return ynxbatch.Registration{AlgorithmVersion: ynxbatch.Version, ChainID: in.expected.NetworkID, Owner: in.expected.Owner, Purpose: ynxbatch.ProjectControlPurpose, PKA: p.PKA, PKB: p.PKB, PolicyRevision: "PUBLIC-SYNTHETIC-CONTROL-ONLY", Enabled: true}, nil
		}})
		requireNoError(t, err)
		requireNoError(t, v.VerifyOne(wire, 13))
		for _, branch := range []string{"A", "B"} {
			member, err := ynxbatch.DecodeMember(wire)
			requireNoError(t, err)
			if branch == "A" {
				member.Certificate.SigmaA[0] ^= 1
			} else {
				member.Certificate.SigmaB[0] ^= 1
			}
			bad, err := ynxbatch.EncodeMember(member)
			requireNoError(t, err)
			if v.VerifyOne(bad, 13) == nil {
				t.Fatal("one bad signature accepted")
			}
		}
		member, err := ynxbatch.DecodeMember(wire)
		requireNoError(t, err)
		member.Certificate.Purpose = "ARTIFACT-RELEASE"
		bad, err := ynxbatch.EncodeMember(member)
		requireNoError(t, err)
		if _, err := ynxbatch.InspectProjectControlMember(bad, in.expected, in.principal, in.command, in.decision, in.atMS); err == nil {
			t.Fatal("artifact purpose accepted as CONTROL")
		}
		requireSameMaterial(t, m, before)
	})
	// The public preflight owns its original bytes and full expected pair.
	old := bytes.Clone(plan.message)
	in.principal[0] ^= 1
	in.expected.PKA[0] ^= 1
	if !bytes.Equal(plan.message, old) || plan.principal[0] != '{' || !bytes.Equal(plan.expected.PKA, p.PKA) {
		t.Fatal("plan retained caller buffers")
	}
}

func TestProjectControlCleanupAndLayout(t *testing.T) {
	cleaned := 0
	if runLogicalCleanup(func() { cleaned++ }, func() { cleaned++; panic("synthetic cleanup") }, func() { cleaned++ }) || cleaned != 3 {
		t.Fatal("partial cleanup skipped a later owner")
	}
	for _, tc := range []struct {
		panic, clean bool
		want         resultCode
		state        cleanupCode
	}{{false, false, resultCleanup, cleanupFailed}, {true, true, resultInternal, cleanupUnknown}} {
		candidate := []byte{1, 2, 3}
		out, code, state := finishControl(candidate, resultOK, tc.panic, tc.clean)
		if len(out) != 0 || code != tc.want || state != tc.state || !bytes.Equal(candidate, []byte{0, 0, 0}) {
			t.Fatal("uncertain cleanup released output")
		}
	}
	request := memoryRange{0x1000, 0x200}
	inputs := []memoryRange{{0x2000, 54}, {0x3000, 150}, {0x4000, 2592}, {0x5000, 64}}
	outputs := []memoryRange{{0x10000, controlMemberCapacity}, {0x30000, 8}, {0x40000, 4}}
	if checkMemoryLayout(request, inputs, outputs) != resultOK {
		t.Fatal("valid layout refused")
	}
	for _, target := range append(append([]memoryRange{request}, inputs...), outputs[1:]...) {
		out := append([]memoryRange(nil), outputs...)
		out[0] = target
		if checkMemoryLayout(request, inputs, out) != resultOverlap {
			t.Fatal("output aliases input")
		}
	}
	out := append([]memoryRange(nil), outputs...)
	out[1] = memoryRange{inputs[0].start + 1, 8}
	if checkMemoryLayout(request, inputs, out) != resultOverlap {
		t.Fatal("scalar can corrupt private input")
	}
	out[0] = memoryRange{^uintptr(0) - 1, 3}
	if checkMemoryLayout(request, inputs, out) != resultBounds {
		t.Fatal("wrapped range accepted")
	}
}
