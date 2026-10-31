package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

func productDeviceTestChallenge(t *testing.T, original []byte, expected ynxbatch.ProductSessionDeviceV4Binding, accountPublic ynxbatch.PublicKey) []byte {
	t.Helper()
	var registration map[string]any
	requireNoError(t, json.Unmarshal(original, &registration))
	account, err := accountaddress.Encode(expected.Owner)
	requireNoError(t, err)
	digest := sha256.Sum256(original)
	c := map[string]any{"version": "4", "chainId": "ynx_6423-1", "account": account, "deviceAlgorithm": ynxbatch.Suite,
		"deviceRegistrationId": registration["registrationId"], "deviceRegistrationRevision": registration["revision"], "deviceRegistrationDigest": hex.EncodeToString(digest[:]),
		"challenge": strings.Repeat("c", 43), "requestDigest": strings.Repeat("22", 32), "approvalDigest": strings.Repeat("33", 32),
		"nonce": strings.Repeat("a", 43), "state": strings.Repeat("b", 43), "scopes": []string{"account:read"},
		"issuedAt": "2026-10-31T08:01:00.000Z", "expiresAt": "2026-10-31T08:01:30.000Z", "sessionExpiresAt": "2026-10-31T08:05:00.000Z",
		"accountAuthorization": map[string]any{"policyVersion": "YNX-ACCOUNT-POLICY/v1", "algorithmVersion": ynxbatch.Version,
			"networkId": hex.EncodeToString(expected.NetworkID), "canonicalOwner": expected.Owner, "revision": "7", "registeredAt": "2", "activeFrom": "3",
			"pkA": hex.EncodeToString(accountPublic.PKA), "pkB": hex.EncodeToString(accountPublic.PKB)}}
	for _, k := range []string{"productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "deviceId"} {
		c[k] = registration[k]
	}
	raw, err := json.Marshal(c)
	requireNoError(t, err)
	return raw
}

func TestProductDeviceChallengeActualANDWithSeparateAccountPair(t *testing.T) {
	device, devicePublic, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer device.Destroy()
	account, accountPublic, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer account.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(device)
	requireNoError(t, err)
	defer material.Clear()
	original, expected := productDeviceTestOriginal(t, devicePublic)
	challenge := productDeviceTestChallenge(t, original, expected, accountPublic)
	p, code := prepareProductDeviceChallenge(challenge, original, expected, productDeviceMemberCapacity)
	if code != resultOK {
		t.Fatal("exact typed challenge with a distinct account pair refused")
	}
	wire, code, cleanup := signProductDevicePrepared(p, material)
	defer clear(wire)
	if code != resultOK || cleanup != cleanupLogicalComplete || len(wire) == 0 {
		t.Fatal("actual fixed challenge signing failed")
	}
	requireNoError(t, verifyProductDeviceActualAND(wire, p))
	m, err := ynxbatch.DecodeMember(wire)
	requireNoError(t, err)
	if m.Certificate.Purpose != productDeviceChallengePurpose || m.Certificate.N != 1 || m.Index != 0 || len(m.PathA) != 0 || len(m.PathB) != 0 ||
		!bytes.Equal(m.Certificate.PKA, devicePublic.PKA) || !bytes.Equal(m.Certificate.PKB, devicePublic.PKB) || bytes.Equal(m.Certificate.PKA, accountPublic.PKA) {
		t.Fatal("account approval pair was substituted for the full device pair")
	}
	f, err := ynxbatch.DecodeFields(m.Message, 5, productDeviceMessageMaximum)
	requireNoError(t, err)
	var c, r any
	requireNoError(t, json.Unmarshal(challenge, &c))
	requireNoError(t, json.Unmarshal(original, &r))
	body, err := json.Marshal(map[string]any{"challenge": c, "registration": r})
	requireNoError(t, err)
	if string(f[0]) != "YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4" || !bytes.Equal(f[1], ynxbatch.U32(4)) ||
		!bytes.Equal(f[2], expected.NetworkID) || string(f[3]) != expected.Owner || !bytes.Equal(f[4], body) {
		t.Fatal("challenge E5 did not bind the exact SDK canonical two-original body")
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
		_, err = ynxbatch.InspectProductSessionDeviceChallengeV4Member(raw, challenge, original, expected)
		requireNoError(t, err)
		if verifyProductDeviceActualAND(raw, p) == nil {
			t.Fatal("typed inspection replaced actual challenge AND verification")
		}
	}
	registrationPlan, code := prepareProductDeviceRegistration(original, expected, productDeviceMemberCapacity)
	if code != resultOK || verifyProductDeviceActualAND(wire, registrationPlan) == nil {
		t.Fatal("challenge signature became a device registration PoP")
	}
	accountMaterial, err := ynxbatch.ExportKeyMaterial(account)
	requireNoError(t, err)
	defer accountMaterial.Clear()
	if out, code, cleanup := signProductDevicePrepared(p, accountMaterial); len(out) != 0 || code != resultKeyMaterial || cleanup != cleanupLogicalComplete {
		t.Fatal("account approval private pair signed as the selected device pair")
	}
	messageBefore, challengeBefore, registrationBefore := bytes.Clone(p.message), bytes.Clone(p.challenge), bytes.Clone(p.registration)
	original[0] ^= 1
	challenge[0] ^= 1
	expected.PKA[0] ^= 1
	expected.PKB[0] ^= 1
	if !bytes.Equal(p.message, messageBefore) || !bytes.Equal(p.challenge, challengeBefore) || !bytes.Equal(p.registration, registrationBefore) ||
		!bytes.Equal(p.expected.PKA, devicePublic.PKA) || !bytes.Equal(p.expected.PKB, devicePublic.PKB) {
		t.Fatal("challenge plan retained caller-owned mutable originals")
	}
}

func TestProductDeviceChallengeRejectsChangedTupleAndTime(t *testing.T) {
	device, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer device.Destroy()
	account, accountPublic, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer account.Destroy()
	original, expected := productDeviceTestOriginal(t, public)
	challenge := productDeviceTestChallenge(t, original, expected, accountPublic)
	for _, capacity := range []uint64{0, productDeviceMemberCapacity - 1, productDeviceMemberCapacity + 1, ^uint64(0)} {
		if _, code := prepareProductDeviceChallenge(challenge, original, expected, capacity); code != resultCapacity {
			t.Fatal("nonfixed challenge output capacity accepted")
		}
	}
	for _, value := range []struct{ challenge, registration []byte }{{nil, original}, {challenge, nil}, {make([]byte, productDeviceOriginalMaximum+1), original}, {challenge, make([]byte, productDeviceOriginalMaximum+1)}} {
		if _, code := prepareProductDeviceChallenge(value.challenge, value.registration, expected, productDeviceMemberCapacity); code != resultBounds {
			t.Fatal("unbounded challenge or registration original accepted")
		}
	}
	for name, edit := range map[string]func(map[string]any){
		"missing nullable":        func(m map[string]any) { delete(m, "packageId") },
		"legacy device algorithm": func(m map[string]any) { m["deviceAlgorithm"] = "p256-sha256" },
		"foreign device":          func(m map[string]any) { m["deviceId"] = "PUBLIC-another-device" },
		"foreign registration":    func(m map[string]any) { m["deviceRegistrationId"] = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" },
		"changed revision":        func(m map[string]any) { m["deviceRegistrationRevision"] = "1" },
		"changed original digest": func(m map[string]any) { m["deviceRegistrationDigest"] = strings.Repeat("44", 32) },
		"wrong product tuple":     func(m map[string]any) { m["clientId"] = "com.ynx.other" },
		"wrong account network": func(m map[string]any) {
			m["accountAuthorization"].(map[string]any)["networkId"] = strings.Repeat("12", 32)
		},
		"wrong account owner": func(m map[string]any) {
			m["accountAuthorization"].(map[string]any)["canonicalOwner"] = "0x" + strings.Repeat("22", 20)
		},
		"foreign account authorization schema": func(m map[string]any) { m["accountAuthorization"].(map[string]any)["root"] = true },
		"duplicated scopes":                    func(m map[string]any) { m["scopes"] = []string{"account:read", "account:read"} },
		"unsorted scopes":                      func(m map[string]any) { m["scopes"] = []string{"wallet:read", "account:read"} },
		"zero challenge lifetime":              func(m map[string]any) { m["expiresAt"] = m["issuedAt"] },
		"challenge exceeds sixty seconds":      func(m map[string]any) { m["expiresAt"] = "2026-10-31T08:02:00.001Z" },
		"session before challenge expiry":      func(m map[string]any) { m["sessionExpiresAt"] = "2026-10-31T08:01:29.999Z" },
		"session exceeds five minutes":         func(m map[string]any) { m["sessionExpiresAt"] = "2026-10-31T08:06:00.001Z" },
		"challenge before device registration": func(m map[string]any) {
			m["issuedAt"], m["expiresAt"], m["sessionExpiresAt"] = "2026-10-31T07:59:00.000Z", "2026-10-31T07:59:30.000Z", "2026-10-31T08:00:00.000Z"
		},
	} {
		t.Run(name, func(t *testing.T) {
			bad := productDeviceTestEdit(t, challenge, edit)
			if _, code := prepareProductDeviceChallenge(bad, original, expected, productDeviceMemberCapacity); code != resultPublicBinding {
				t.Fatal("changed typed original reached private signing")
			}
		})
	}
	for _, raw := range [][]byte{append(bytes.Clone(challenge), '\n'),
		bytes.Replace(challenge, []byte(`"version":"4"`), []byte(`"version":"4","version":"4"`), 1)} {
		if _, code := prepareProductDeviceChallenge(raw, original, expected, productDeviceMemberCapacity); code != resultPublicBinding {
			t.Fatal("noncanonical challenge original accepted")
		}
	}
	// Re-hash a changed registration too: still must reject terminal revocation
	// and a real registration expiry below the session, rather than only SHA.
	for _, edit := range []func(map[string]any){
		func(m map[string]any) { m["revokedAt"] = "2026-10-31T08:00:30.000Z" },
		func(m map[string]any) { m["expiresAt"] = "2026-10-31T08:03:00.000Z" },
	} {
		badOriginal := productDeviceTestEdit(t, original, edit)
		badChallenge := productDeviceTestChallenge(t, badOriginal, expected, accountPublic)
		if _, code := prepareProductDeviceChallenge(badChallenge, badOriginal, expected, productDeviceMemberCapacity); code != resultPublicBinding {
			t.Fatal("rehashed inactive device record or session past device expiry accepted")
		}
	}
}

func TestProductDeviceChallengeRetainsOriginalAndFirstFailure(t *testing.T) {
	device, public, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer device.Destroy()
	account, accountPublic, err := ynxbatch.KeyGen()
	requireNoError(t, err)
	defer account.Destroy()
	material, err := ynxbatch.ExportKeyMaterial(device)
	requireNoError(t, err)
	defer material.Clear()
	original, expected := productDeviceTestOriginal(t, public)
	challenge := productDeviceTestChallenge(t, original, expected, accountPublic)
	p, code := prepareProductDeviceChallenge(challenge, original, expected, productDeviceMemberCapacity)
	if code != resultOK {
		t.Fatal("typed challenge refused")
	}
	productDeviceTestRetainedOutcome(t, p, material)
}

func TestProductDeviceChallengeNullBridge(t *testing.T) {
	if got := int32(YNXProductSessionDeviceChallengeSignV4(nil, nil, 0, nil, nil)); got != int32(resultInvalidArgument) {
		t.Fatal("null challenge C entry accepted")
	}
}
