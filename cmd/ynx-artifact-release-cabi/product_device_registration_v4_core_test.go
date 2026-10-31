package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func productDeviceTestOriginal(t *testing.T, p ynxbatch.PublicKey) ([]byte, ynxbatch.ProductSessionDeviceV4Binding) {
	t.Helper()
	expected := ynxbatch.ProductSessionDeviceV4Binding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: "0x" + strings.Repeat("11", 20),
		PKA: bytes.Clone(p.PKA), PKB: bytes.Clone(p.PKB)}
	value := map[string]any{"version": "4", "registrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "networkId": hex.EncodeToString(expected.NetworkID),
		"canonicalOwner": expected.Owner, "productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos",
		"applicationId": "com.ynx.developer", "bundleId": "com.ynx.developer", "packageId": nil, "origin": "https://developer.ynxweb4.com",
		"callback": "ynxdeveloper://callback", "deviceId": "PUBLIC-device-v4", "generation": "1", "revision": "18446744073709551615",
		"pkA": hex.EncodeToString(p.PKA), "pkB": hex.EncodeToString(p.PKB), "registeredAt": "2026-10-31T08:00:00.000Z",
		"expiresAt": "2026-10-31T09:00:00.000Z", "revokedAt": nil}
	raw, err := json.Marshal(value)
	requireNoError(t, err)
	return raw, expected
}

func productDeviceTestEdit(t *testing.T, raw []byte, edit func(map[string]any)) []byte {
	t.Helper()
	var value map[string]any
	requireNoError(t, json.Unmarshal(raw, &value))
	edit(value)
	out, err := json.Marshal(value)
	requireNoError(t, err)
	return out
}

func TestProductDeviceRegistrationActualANDAndPurposeIsolation(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer material.Clear()
	before := materialCopy(material)
	defer before.Clear()
	original, expected := productDeviceTestOriginal(t, public)
	p, code := prepareProductDeviceRegistration(original, expected, productDeviceMemberCapacity)
	if code != resultOK {
		t.Fatal("typed registration original refused")
	}
	wire, code, cleanup := signProductDevicePrepared(p, material)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 || len(wire) > productDeviceMemberCapacity {
		t.Fatal("actual registration device PoP failed")
	}
	requireNoError(t, verifyProductDeviceActualAND(wire, p))
	m, err := ynxbatch.DecodeMember(wire)
	requireNoError(t, err)
	if m.Certificate.Purpose != productDeviceRegistrationPurpose || m.Certificate.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 ||
		!bytes.Equal(m.Message, p.message) || !bytes.Equal(m.Certificate.PKA, public.PKA) || !bytes.Equal(m.Certificate.PKB, public.PKB) {
		t.Fatal("registration output differs from fixed full-device-pair N1 E5")
	}
	fields, err := ynxbatch.DecodeFields(m.Message, 5, productDeviceMessageMaximum)
	requireNoError(t, err)
	if string(fields[0]) != "YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4" || !bytes.Equal(fields[1], ynxbatch.U32(4)) ||
		!bytes.Equal(fields[2], expected.NetworkID) || string(fields[3]) != expected.Owner || !bytes.Equal(fields[4], original) {
		t.Fatal("registration did not sign the original SDK E5 body")
	}
	for _, branch := range []string{"A", "B"} {
		bad, err := ynxbatch.DecodeMember(wire)
		requireNoError(t, err)
		if branch == "A" {
			bad.Certificate.SigmaA[0] ^= 1
		} else {
			bad.Certificate.SigmaB[0] ^= 1
		}
		raw, err := ynxbatch.EncodeMember(bad)
		requireNoError(t, err)
		// Structural inspection alone must not masquerade as mathematical proof.
		_, err = ynxbatch.InspectProductSessionDeviceRegistrationV4Member(raw, original, expected)
		requireNoError(t, err)
		if verifyProductDeviceActualAND(raw, p) == nil {
			t.Fatalf("corrupted actual %s signature accepted", branch)
		}
	}
	for _, purpose := range []string{"PRODUCT-SESSION-DEVICE-CHALLENGE", "PRODUCT-SESSION-APPROVAL", "PRODUCT-SESSION-HTTP-PROOF", "TX-BATCH", "ARTIFACT-RELEASE"} {
		bad, err := ynxbatch.DecodeMember(wire)
		requireNoError(t, err)
		bad.Certificate.Purpose = purpose
		raw, err := ynxbatch.EncodeMember(bad)
		requireNoError(t, err)
		if verifyProductDeviceActualAND(raw, p) == nil {
			t.Fatal("foreign purpose became device registration PoP")
		}
	}
	if _, _, _, err := transactionMessageBinding(p.message); err == nil {
		t.Fatal("device PoP became an account transaction approval")
	}
	// Public originals and full expected pair are owned before private entry.
	messageBefore, registrationBefore := bytes.Clone(p.message), bytes.Clone(p.registration)
	original[0] ^= 1
	expected.NetworkID[0] ^= 1
	expected.PKA[0] ^= 1
	expected.PKB[0] ^= 1
	if !bytes.Equal(p.message, messageBefore) || !bytes.Equal(p.registration, registrationBefore) || !bytes.Equal(p.expected.PKA, public.PKA) ||
		!bytes.Equal(p.expected.PKB, public.PKB) || p.expected.NetworkID[0] != 0xab {
		t.Fatal("typed registration plan retained caller buffers")
	}
	requireSameMaterial(t, material, before)
}

func TestProductDeviceRegistrationPreflightAndBorrowedPair(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer material.Clear()
	original, expected := productDeviceTestOriginal(t, public)
	for _, capacity := range []uint64{0, productDeviceMemberCapacity - 1, productDeviceMemberCapacity + 1, ^uint64(0)} {
		if _, code := prepareProductDeviceRegistration(original, expected, capacity); code != resultCapacity {
			t.Fatal("nonfixed registration capacity accepted")
		}
	}
	for _, raw := range [][]byte{nil, make([]byte, productDeviceOriginalMaximum+1)} {
		if _, code := prepareProductDeviceRegistration(raw, expected, productDeviceMemberCapacity); code != resultBounds {
			t.Fatal("unbounded registration original accepted")
		}
	}
	for _, raw := range [][]byte{
		append(bytes.Clone(original), '\n'),
		bytes.Replace(original, []byte(`"version":"4"`), []byte(`"version":4`), 1),
		bytes.Replace(original, []byte(`"revokedAt":null`), []byte(`"revokedAt":null,"revokedAt":null`), 1),
		productDeviceTestEdit(t, original, func(m map[string]any) { delete(m, "bundleId") }),
		productDeviceTestEdit(t, original, func(m map[string]any) { m["management"] = true }),
		productDeviceTestEdit(t, original, func(m map[string]any) { m["expiresAt"] = m["registeredAt"] }),
	} {
		if _, code := prepareProductDeviceRegistration(raw, expected, productDeviceMemberCapacity); code != resultPublicBinding {
			t.Fatal("invalid registration20 reached private entry")
		}
	}
	for _, edit := range []func(*ynxbatch.ProductSessionDeviceV4Binding){
		func(e *ynxbatch.ProductSessionDeviceV4Binding) { e.NetworkID[0] ^= 1 },
		func(e *ynxbatch.ProductSessionDeviceV4Binding) { e.Owner = "0x" + strings.Repeat("22", 20) },
		func(e *ynxbatch.ProductSessionDeviceV4Binding) { e.PKA[0] ^= 1 },
		func(e *ynxbatch.ProductSessionDeviceV4Binding) { e.PKB[0] ^= 1 },
	} {
		wrong := copyProductDeviceBinding(expected)
		edit(&wrong)
		if _, code := prepareProductDeviceRegistration(original, wrong, productDeviceMemberCapacity); code != resultPublicBinding {
			t.Fatal("registration supplied its own expected full pair or context")
		}
	}
	p, code := prepareProductDeviceRegistration(original, expected, productDeviceMemberCapacity)
	if code != resultOK {
		t.Fatal("valid registration preflight refused")
	}
	for _, edit := range []func(*ynxbatch.KeyMaterial){
		func(m *ynxbatch.KeyMaterial) { m.PKCS8A[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8B[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKA[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKB[0] ^= 1 },
	} {
		bad := materialCopy(material)
		edit(&bad)
		before := materialCopy(bad)
		out, code, cleanup := signProductDevicePrepared(p, bad)
		if len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
			t.Fatal("wrong borrowed device pair produced a PoP or lost cleanup")
		}
		requireSameMaterial(t, bad, before)
		bad.Clear()
		before.Clear()
	}
	short := material
	short.PKCS8A = short.PKCS8A[:ynxbatch.PKCS8ASize-1]
	if out, code, cleanup := signProductDevicePrepared(p, short); len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupNotRequired {
		t.Fatal("short private borrow entered key import or cleanup custody")
	}
	p.message[0] ^= 1
	if out, code, cleanup := signProductDevicePrepared(p, material); len(out) != 0 || code != resultPublicBinding || cleanup != cleanupNotRequired {
		t.Fatal("changed prepared E5 entered private signing")
	}
}

// Both typed entries use the same once-within-invocation cleanup kernel. This
// fixture injects only late public postcondition/cleanup faults after one real
// signature. It does not fabricate an Auth token or assert cross-call once.
func productDeviceTestRetainedOutcome(t *testing.T, p productDevicePlan, material ynxbatch.KeyMaterial) {
	t.Helper()
	original := materialCopy(material)
	defer original.Clear()
	for _, tc := range []struct {
		name                               string
		postFailure, cleanupFault, panicAt bool
	}{
		{"postcondition", true, false, false},
		{"cleanup", false, true, false},
		{"first failure survives cleanup", true, true, false},
		{"postcondition panic retains original", false, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			postCalls, cleanupCalls := 0, 0
			var produced []byte
			checks := &productDeviceChecks{
				postcondition: func(raw []byte, plan productDevicePlan) error {
					postCalls++
					requireNoError(t, verifyProductDeviceActualAND(raw, plan))
					produced = bytes.Clone(raw)
					if tc.panicAt {
						panic("synthetic late public postcondition panic")
					}
					if tc.postFailure {
						return errors.New("synthetic late public postcondition error")
					}
					return nil
				},
				cleanup: func(steps ...func()) bool {
					wrapped := make([]func(), len(steps))
					for i, step := range steps {
						i, step := i, step
						wrapped[i] = func() {
							cleanupCalls++
							step()
							if tc.cleanupFault && i == 0 {
								panic("synthetic cleanup fault after actual Discard")
							}
						}
					}
					return runLogicalCleanup(wrapped...)
				},
			}
			out, code, cleanup := signProductDevicePreparedWithChecks(p, material, checks)
			defer clear(out)
			if postCalls != 1 || cleanupCalls != 3 || len(produced) == 0 || !bytes.Equal(out, produced) {
				t.Fatal("actual original discarded, signing retried or cleanup ownership skipped")
			}
			wantCode, wantCleanup := resultOutputValidation, cleanupLogicalComplete
			if tc.panicAt {
				wantCode, wantCleanup = resultInternal, cleanupUnknown
			} else if tc.cleanupFault {
				wantCleanup = cleanupFailed
				if !tc.postFailure {
					wantCode = resultCleanup
				}
			}
			if code != wantCode || cleanup != wantCleanup {
				t.Fatal("late failure lost first cause or independent cleanup state")
			}
			buffer := bytes.Repeat([]byte{0xa5}, productDeviceMemberCapacity)
			written, retained := retainDeviceHTTPOutcome(buffer, out, code, cleanup)
			if written != len(produced) || retained != wantCode || !bytes.Equal(buffer[:written], produced) ||
				!bytes.Equal(buffer[written:], bytes.Repeat([]byte{0xa5}, len(buffer)-written)) {
				t.Fatal("bridge retention lost failed original or overwrote unused capacity")
			}
			requireSameMaterial(t, material, original)
		})
	}
}

func TestProductDeviceRegistrationRetainsOriginalAndFirstFailure(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer material.Clear()
	original, expected := productDeviceTestOriginal(t, public)
	p, code := prepareProductDeviceRegistration(original, expected, productDeviceMemberCapacity)
	if code != resultOK {
		t.Fatal("typed registration refused")
	}
	productDeviceTestRetainedOutcome(t, p, material)
}

func TestProductDeviceRegistrationNullBridgeAndMemoryBounds(t *testing.T) {
	if got := int32(YNXProductSessionDeviceRegistrationSignV4(nil, nil, 0, nil, nil)); got != int32(resultInvalidArgument) {
		t.Fatal("null registration C entry accepted")
	}
	// Arithmetic only; no synthetic numeric address is ever dereferenced. The
	// C boundary uses this exact original range checker before private borrowing.
	request := memoryRange{0x1000, 160}
	inputs := []memoryRange{{0x2000, 16000}, {0x7000, 32}, {0x8000, 42}, {0x9000, 2592}, {0xa000, 64}, {0xb000, 54}, {0xc000, 150}}
	outputs := []memoryRange{{0x10000, productDeviceMemberCapacity}, {0x30000, 8}, {0x40000, 4}}
	if checkMemoryLayout(request, inputs, outputs) != resultOK {
		t.Fatal("valid fixed typed output layout refused")
	}
	for _, alias := range append(append([]memoryRange{request}, inputs...), outputs[1:]...) {
		bad := append([]memoryRange(nil), outputs...)
		bad[0] = alias
		if checkMemoryLayout(request, inputs, bad) != resultOverlap {
			t.Fatal("output alias into a borrowed/request/scalar range accepted")
		}
	}
	bad := append([]memoryRange(nil), outputs...)
	bad[0] = memoryRange{^uintptr(0) - 1, 8}
	if checkMemoryLayout(request, inputs, bad) != resultBounds {
		t.Fatal("overflowing output range accepted")
	}
}
