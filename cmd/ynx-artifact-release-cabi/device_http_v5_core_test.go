package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func deviceHTTPV5PublicInput(t *testing.T, p ynxbatch.PublicKey) deviceHTTPV5Inputs {
	t.Helper()
	raw, err := os.ReadFile("../../internal/ynxbatch/testdata/product-session-proof-v5-public.json")
	requireNoError(t, err)
	var g struct {
		UnsignedCanonicalJSON, BodyBase64url, ContentType string
		Unsigned                                          struct{ CanonicalOwner string }
	}
	requireNoError(t, json.Unmarshal(raw, &g))
	body, err := base64.RawURLEncoding.DecodeString(g.BodyBase64url)
	requireNoError(t, err)
	return deviceHTTPV5Inputs{unsigned: []byte(g.UnsignedCanonicalJSON), actualBody: body, actualContentType: g.ContentType,
		expected: ynxbatch.ProductSessionHTTPBinding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: g.Unsigned.CanonicalOwner, PKA: bytes.Clone(p.PKA), PKB: bytes.Clone(p.PKB)}}
}

func TestDeviceHTTPV5ActualANDAndIndependentOriginal(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	m, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer m.Clear()
	before := materialCopy(m)
	defer before.Clear()
	in := deviceHTTPV5PublicInput(t, public)
	plan, code := prepareDeviceHTTPV5(in, deviceHTTPV5MemberCapacity)
	if code != resultOK {
		t.Fatal(code)
	}
	wire, code, cleanup := signDeviceHTTPV5Prepared(plan, m)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 {
		t.Fatal("actual V5 fixed caller failed", code, cleanup)
	}
	actual, err := ynxbatch.BuildProductSessionHTTPV5Message(in.unsigned, in.actualBody, in.actualContentType, in.expected)
	requireNoError(t, err)
	_, err = ynxbatch.InspectProductSessionHTTPV5Member(wire, in.expected, actual)
	requireNoError(t, err)
	for _, branch := range []string{"A", "B", "purpose", "message"} {
		x, err := ynxbatch.DecodeMember(wire)
		requireNoError(t, err)
		switch branch {
		case "A":
			x.Certificate.SigmaA[0] ^= 1
		case "B":
			x.Certificate.SigmaB[0] ^= 1
		case "purpose":
			x.Certificate.Purpose = "TX-BATCH"
		case "message":
			x.Message[len(x.Message)-1] ^= 1
		}
		bad, err := ynxbatch.EncodeMember(x)
		requireNoError(t, err)
		if _, err := ynxbatch.InspectProductSessionHTTPV5Member(bad, in.expected, actual); err == nil {
			t.Fatal("invalid branch admitted", branch)
		}
	}
	if _, _, _, err := transactionMessageBinding(plan.message); err == nil {
		t.Fatal("HTTP proof admitted as ordinary TX")
	}
	requireSameMaterial(t, m, before)
	original := bytes.Clone(plan.message)
	in.unsigned[0] ^= 1
	in.actualBody[0] ^= 1
	in.expected.NetworkID[0] ^= 1
	in.expected.PKA[0] ^= 1
	in.expected.PKB[0] ^= 1
	if !bytes.Equal(plan.message, original) || !bytes.Equal(plan.expected.PKA, public.PKA) || !bytes.Equal(plan.expected.PKB, public.PKB) || plan.expected.NetworkID[0] != 0xab {
		t.Fatal("V5 plan retained caller buffer")
	}
}

func TestDeviceHTTPV5PublicAndPrivateRefusals(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	m, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer m.Clear()
	in := deviceHTTPV5PublicInput(t, public)
	for _, cap := range []uint64{0, deviceHTTPV5MemberCapacity - 1, deviceHTTPV5MemberCapacity + 1, ^uint64(0)} {
		if _, code := prepareDeviceHTTPV5(in, cap); code != resultCapacity {
			t.Fatal("nonfixed allocation admitted")
		}
	}
	for _, edit := range []func(*deviceHTTPV5Inputs){
		func(x *deviceHTTPV5Inputs) { x.actualBody = nil }, func(x *deviceHTTPV5Inputs) { x.unsigned = nil },
		func(x *deviceHTTPV5Inputs) { x.actualBody = append(bytes.Clone(x.actualBody), 0) },
		func(x *deviceHTTPV5Inputs) { x.actualContentType += "x" },
		func(x *deviceHTTPV5Inputs) {
			x.unsigned = bytes.Replace(x.unsigned, []byte(`"version":"5"`), []byte(`"version":"4"`), 1)
		},
		func(x *deviceHTTPV5Inputs) {
			x.unsigned = bytes.Replace(x.unsigned, []byte("/api/v1/ide/deployments"), []byte("/ide/deployments"), 1)
		},
		func(x *deviceHTTPV5Inputs) { x.expected.Owner = "0x2222222222222222222222222222222222222222" },
	} {
		x := in
		edit(&x)
		if _, code := prepareDeviceHTTPV5(x, deviceHTTPV5MemberCapacity); code == resultOK {
			t.Fatal("public invalid input reached private phase")
		}
	}
	plan, code := prepareDeviceHTTPV5(in, deviceHTTPV5MemberCapacity)
	if code != resultOK {
		t.Fatal(code)
	}
	for _, edit := range []func(*ynxbatch.KeyMaterial){
		func(x *ynxbatch.KeyMaterial) { x.PKCS8A[0] ^= 1 }, func(x *ynxbatch.KeyMaterial) { x.PKCS8B[0] ^= 1 },
		func(x *ynxbatch.KeyMaterial) { x.PKCS8A[22] ^= 1 }, func(x *ynxbatch.KeyMaterial) { x.PKCS8B[22] ^= 1 },
		func(x *ynxbatch.KeyMaterial) { x.PKA[0] ^= 1 }, func(x *ynxbatch.KeyMaterial) { x.PKB[0] ^= 1 },
	} {
		x := materialCopy(m)
		edit(&x)
		before := materialCopy(x)
		out, rc, clean := signDeviceHTTPV5Prepared(plan, x)
		if len(out) != 0 || rc != resultKeyMaterial || clean != cleanupLogicalComplete {
			t.Fatal("invalid full-pair custody accepted or cleanup lost", rc, clean)
		}
		requireSameMaterial(t, x, before)
		x.Clear()
		before.Clear()
	}
	x := m
	x.PKCS8B = x.PKCS8B[:149]
	if out, rc, clean := signDeviceHTTPV5Prepared(plan, x); len(out) != 0 || rc != resultKeyMaterial || clean != cleanupNotRequired {
		t.Fatal("short private span imported")
	}
}

func TestDeviceHTTPV5UnknownRetainsOriginalAndCleanup(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	m, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer m.Clear()
	in := deviceHTTPV5PublicInput(t, public)
	plan, code := prepareDeviceHTTPV5(in, deviceHTTPV5MemberCapacity)
	if code != resultOK {
		t.Fatal(code)
	}
	for _, tc := range []struct {
		name    string
		checks  deviceHTTPV5Checks
		code    resultCode
		cleanup cleanupCode
	}{
		{"postcondition", deviceHTTPV5Checks{postcondition: func([]byte, ynxbatch.ProductSessionHTTPBinding, []byte) error {
			return errors.New("fixture postcondition")
		}}, resultOutputValidation, cleanupLogicalComplete},
		{"postcondition_panic", deviceHTTPV5Checks{postcondition: func([]byte, ynxbatch.ProductSessionHTTPBinding, []byte) error { panic("fixture panic") }}, resultInternal, cleanupUnknown},
		{"cleanup", deviceHTTPV5Checks{cleanup: func(f ...func()) bool { runLogicalCleanup(f...); return false }}, resultCleanup, cleanupFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out, rc, clean := signDeviceHTTPV5PreparedWithChecks(plan, m, &tc.checks)
			if rc != tc.code || clean != tc.cleanup || len(out) == 0 {
				t.Fatal("actual public UNKNOWN original lost", rc, clean)
			}
			buffer := bytes.Repeat([]byte{0x5a}, deviceHTTPV5MemberCapacity)
			n, final := retainDeviceHTTPOutcome(buffer, out, rc, clean)
			if n != len(out) || final != rc || !bytes.Equal(buffer[:n], out) || buffer[n] != 0x5a {
				t.Fatal("actual output discarded before failure classification")
			}
			if _, err := ynxbatch.InspectProductSessionHTTPV5Member(out, in.expected, plan.message); err != nil {
				t.Fatal("retained original no longer independently verifiable", err)
			}
		})
	}
}
