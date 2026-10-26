package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// Synthetic public request only. These fixtures do not acquire any original
// Auth Source/device slot, consume durable once, create a session or send HTTP.
func deviceHTTPPublicInput(t *testing.T, p ynxbatch.PublicKey) deviceHTTPInputs {
	t.Helper()
	owner := "0x" + strings.Repeat("11", 20)
	account, err := accountaddress.Encode(owner)
	requireNoError(t, err)
	unsigned := []byte(`{"account":"` + account + `","applicationId":"com.ynx.developer","bodyDigest":"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","bundleId":"com.ynx.developer","callback":"ynxdeveloper://callback","canonicalOwner":"` + owner + `","clientId":"com.ynx.developer.macos","deviceId":"PUBLIC-device-v4","deviceRegistrationDigest":"` + strings.Repeat("22", 32) + `","deviceRegistrationId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","deviceRegistrationRevision":"18446744073709551615","expiresAt":"2026-10-26T08:00:30.000Z","issuedAt":"2026-10-26T08:00:00.000Z","method":"GET","nonce":"` + strings.Repeat("a", 43) + `","origin":"https://developer.ynxweb4.com","packageId":null,"path":"/v1/developer/projects","productId":"developer","sessionBinding":"` + strings.Repeat("33", 32) + `","version":"4"}`)
	return deviceHTTPInputs{unsigned: unsigned, expected: ynxbatch.ProductSessionHTTPBinding{
		NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: owner, PKA: bytes.Clone(p.PKA), PKB: bytes.Clone(p.PKB)}}
}

func TestProductSessionHTTPCoreActualANDAndIndependentBinding(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer material.Clear()
	original := materialCopy(material)
	defer original.Clear()
	in := deviceHTTPPublicInput(t, public)
	plan, code := prepareDeviceHTTP(in, deviceHTTPMemberCapacity)
	if code != resultOK || deviceHTTPMemberMaximum > deviceHTTPMemberCapacity {
		t.Fatal("canonical fixed HTTP preflight refused")
	}
	wire, code, cleanup := signDeviceHTTPPrepared(plan, material)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 || len(wire) > deviceHTTPMemberCapacity {
		t.Fatal("actual fixed HTTP dual signature did not return a complete public Member")
	}
	if _, err := ynxbatch.InspectProductSessionHTTPMember(wire, in.expected, in.unsigned); err != nil {
		t.Fatal("actual HTTP Member failed independent typed AND inspection")
	}
	member, err := ynxbatch.DecodeMember(wire)
	requireNoError(t, err)
	if member.Certificate.Purpose != "PRODUCT-SESSION-HTTP-PROOF" || member.Certificate.N != 1 || member.Index != 0 ||
		len(member.PathA) != 0 || len(member.PathB) != 0 || !bytes.Equal(member.Message, plan.message) ||
		!bytes.Equal(member.Certificate.PKA, public.PKA) || !bytes.Equal(member.Certificate.PKB, public.PKB) {
		t.Fatal("output differs from fixed E5 device proof profile")
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
		if _, err := ynxbatch.InspectProductSessionHTTPMember(raw, in.expected, in.unsigned); err == nil {
			t.Fatal("corrupted signature branch accepted")
		}
	}
	for _, purpose := range []string{"TX-BATCH", "IDE-PROJECT-CONTROL", "ARTIFACT-RELEASE", "ACCOUNT-INITIAL"} {
		bad, err := ynxbatch.DecodeMember(wire)
		requireNoError(t, err)
		bad.Certificate.Purpose = purpose
		raw, err := ynxbatch.EncodeMember(bad)
		requireNoError(t, err)
		if _, err := ynxbatch.InspectProductSessionHTTPMember(raw, in.expected, in.unsigned); err == nil {
			t.Fatal("another fixed purpose accepted as HTTP proof")
		}
	}
	wrong := in.expected
	wrong.PKB = bytes.Clone(wrong.PKB)
	wrong.PKB[0] ^= 1
	if _, err := ynxbatch.InspectProductSessionHTTPMember(wire, wrong, in.unsigned); err == nil {
		t.Fatal("different independently selected full pair accepted")
	}
	changed := bytes.Replace(in.unsigned, []byte("/v1/developer/projects"), []byte("/v1/developer/deployments"), 1)
	if _, err := ynxbatch.InspectProductSessionHTTPMember(wire, in.expected, changed); err == nil {
		t.Fatal("different exact HTTP request accepted")
	}
	requireSameMaterial(t, material, original)
	// The ordinary entry stays purpose isolated; the HTTP E5 is not a
	// canonical native transfer/action/value execution intent.
	if _, _, _, err := transactionMessageBinding(plan.message); err == nil {
		t.Fatal("HTTP E5 was admitted as an ordinary account execution message")
	}
	// Public preflight has detached every caller-owned span before key import.
	beforeMessage, beforeUnsigned := bytes.Clone(plan.message), bytes.Clone(plan.unsigned)
	in.unsigned[0] ^= 1
	in.expected.NetworkID[0] ^= 1
	in.expected.PKA[0] ^= 1
	in.expected.PKB[0] ^= 1
	if !bytes.Equal(plan.message, beforeMessage) || !bytes.Equal(plan.unsigned, beforeUnsigned) ||
		!bytes.Equal(plan.expected.PKA, public.PKA) || !bytes.Equal(plan.expected.PKB, public.PKB) || plan.expected.NetworkID[0] != 0xab {
		t.Fatal("HTTP preflight retained caller buffers")
	}
}

func TestProductSessionHTTPCorePreflightAndCustodyFailures(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer material.Clear()
	in := deviceHTTPPublicInput(t, public)
	for _, capacity := range []uint64{0, deviceHTTPMemberCapacity - 1, deviceHTTPMemberCapacity + 1, ^uint64(0)} {
		if _, code := prepareDeviceHTTP(in, capacity); code != resultCapacity {
			t.Fatal("nonfixed capacity accepted")
		}
	}
	for _, raw := range [][]byte{nil, make([]byte, deviceHTTPMessageMaximum+1)} {
		bad := in
		bad.unsigned = raw
		if _, code := prepareDeviceHTTP(bad, deviceHTTPMemberCapacity); code != resultBounds {
			t.Fatal("unbounded original accepted")
		}
	}
	for _, raw := range [][]byte{
		append(bytes.Clone(in.unsigned), '\n'),
		bytes.Replace(in.unsigned, []byte(`"version":"4"`), []byte(`"version":4`), 1),
		bytes.Replace(in.unsigned, []byte(`"method":"GET"`), []byte(`"method":"TRACE"`), 1),
		bytes.Replace(in.unsigned, []byte(`"version":"4"`), []byte(`"version":"4","version":"4"`), 1),
	} {
		bad := in
		bad.unsigned = raw
		if _, code := prepareDeviceHTTP(bad, deviceHTTPMemberCapacity); code != resultPublicBinding {
			t.Fatal("invalid canonical unsigned21 reached private phase")
		}
	}
	wrong := in
	wrong.expected.Owner = "0x" + strings.Repeat("22", 20)
	if _, code := prepareDeviceHTTP(wrong, deviceHTTPMemberCapacity); code != resultPublicBinding {
		t.Fatal("different canonical owner accepted")
	}
	plan, code := prepareDeviceHTTP(in, deviceHTTPMemberCapacity)
	if code != resultOK {
		t.Fatal("valid preflight failed")
	}
	for _, edit := range []func(*ynxbatch.KeyMaterial){
		func(m *ynxbatch.KeyMaterial) { m.PKCS8A[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8B[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8A[22] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKCS8B[22] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKA[0] ^= 1 },
		func(m *ynxbatch.KeyMaterial) { m.PKB[0] ^= 1 },
	} {
		bad := materialCopy(material)
		edit(&bad)
		before := materialCopy(bad)
		out, result, cleanup := signDeviceHTTPPrepared(plan, bad)
		if len(out) != 0 || result != resultKeyMaterial || cleanup != cleanupLogicalComplete {
			t.Fatal("invalid custody released output or lost cleanup state")
		}
		requireSameMaterial(t, bad, before)
		bad.Clear()
		before.Clear()
	}
	short := material
	short.PKCS8A = short.PKCS8A[:len(short.PKCS8A)-1]
	if out, result, cleanup := signDeviceHTTPPrepared(plan, short); len(out) != 0 || result != resultKeyMaterial || cleanup != cleanupNotRequired {
		t.Fatal("invalid borrowed extent entered import")
	}
}

func TestProductSessionHTTPCoreRetainsActualOriginalAndFirstFailure(t *testing.T) {
	key, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(key)
	requireNoError(t, err)
	defer material.Clear()
	before := materialCopy(material)
	defer before.Clear()
	in := deviceHTTPPublicInput(t, public)
	plan, code := prepareDeviceHTTP(in, deviceHTTPMemberCapacity)
	if code != resultOK {
		t.Fatal("valid preflight failed")
	}
	for _, tc := range []struct {
		name                    string
		postFailure, cleanFault bool
	}{
		{"postcondition", true, false},
		{"cleanup", false, true},
		{"first postcondition error survives cleanup error", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var produced []byte
			postCalls, cleanupCalls := 0, 0
			checks := &deviceHTTPChecks{
				postcondition: func(raw []byte, expected ynxbatch.ProductSessionHTTPBinding, unsigned []byte) error {
					postCalls++
					if _, err := ynxbatch.InspectProductSessionHTTPMember(raw, expected, unsigned); err != nil {
						t.Fatal("actual produced original did not pass independent full AND")
					}
					produced = bytes.Clone(raw)
					if tc.postFailure {
						return errors.New("synthetic postcondition fault after actual mathematical output")
					}
					return nil
				},
				cleanup: func(steps ...func()) bool {
					wrapped := make([]func(), len(steps))
					for i, step := range steps {
						i, step := i, step
						wrapped[i] = func() {
							cleanupCalls++
							step() // real batch Discard, key Destroy, and owned Clear
							if tc.cleanFault && i == 0 {
								panic("synthetic first cleanup fault after real Discard")
							}
						}
					}
					return runLogicalCleanup(wrapped...)
				},
			}
			wire, result, cleanup := signDeviceHTTPPreparedWithChecks(plan, material, checks)
			defer clear(wire)
			if postCalls != 1 || cleanupCalls != 3 || len(produced) == 0 || !bytes.Equal(wire, produced) || len(wire) > deviceHTTPMemberCapacity {
				t.Fatal("actual public original lost, signing retried, or cleanup ownership skipped")
			}
			wantCode := resultCleanup
			if tc.postFailure {
				wantCode = resultOutputValidation
			}
			wantCleanup := cleanupLogicalComplete
			if tc.cleanFault {
				wantCleanup = cleanupFailed
			}
			if result != wantCode || cleanup != wantCleanup || result == resultOK {
				t.Fatal("retained original promoted failure or lost first cause")
			}
			buffer := bytes.Repeat([]byte{0xa5}, deviceHTTPMemberCapacity)
			written, retainedResult := retainDeviceHTTPOutcome(buffer, wire, result, cleanup)
			if written != len(produced) || retainedResult != wantCode || !bytes.Equal(buffer[:written], produced) ||
				!bytes.Equal(buffer[written:], bytes.Repeat([]byte{0xa5}, len(buffer)-written)) {
				t.Fatal("actual bridge copy lost failed original, changed tail or upgraded failure")
			}
			requireSameMaterial(t, material, before)
		})
	}
	if out, code, cleanup := finishDeviceHTTP(nil, resultKeyMaterial, false, false); len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupFailed {
		t.Fatal("no-wire failure invented output or hid first cause")
	}
}

func TestProductSessionHTTPCoreCleanupAndNullBridge(t *testing.T) {
	if int32(YNXProductSessionHTTPProofSignV4(nil, nil, 0, nil, nil)) != int32(resultInvalidArgument) {
		t.Fatal("null C request was not rejected before any output write")
	}
	// The exact common layout validator called by the new C entry admits only
	// disjoint outputs; no real invalid pointer is ever dereferenced here.
	request := memoryRange{0x1000, 0x200}
	inputs := []memoryRange{{0x2000, 32}, {0x3000, 42}, {0x4000, 54}, {0x5000, 150}, {0x6000, 2592}, {0x7000, 64}}
	outputs := []memoryRange{{0x10000, deviceHTTPMemberCapacity}, {0x30000, 8}, {0x40000, 4}}
	if checkMemoryLayout(request, inputs, outputs) != resultOK {
		t.Fatal("disjoint public layout refused")
	}
	for _, target := range append(append([]memoryRange{request}, inputs...), outputs[1:]...) {
		bad := append([]memoryRange(nil), outputs...)
		bad[0] = target
		if checkMemoryLayout(request, inputs, bad) != resultOverlap {
			t.Fatal("output alias was admitted")
		}
	}
	bad := append([]memoryRange(nil), outputs...)
	bad[0] = memoryRange{^uintptr(0) - 1, 3}
	if checkMemoryLayout(request, inputs, bad) != resultBounds {
		t.Fatal("overflowing output extent was admitted")
	}
}
