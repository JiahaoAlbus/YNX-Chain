package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

// Public synthetic records follow the existing SDK95b1 source contract, not a
// live device or an Auth issuer. Source SHA256s: pq-v4-codec.js 02387ad5e6295a69
// 23e10c7bf2b5518bb0353317cb3e850b5f077055c621430c; registration-v4.js
// 99761d0625c718d47ba5f0d4a8922a3e6a7ae23c467baca2cc8b556a19901c94;
// product-session-v2.js e3cab9c1139cbcd0100eac430b0267614c7b12b43432e06448b5bdf01c6f7db4.
func productDeviceV4TestBinding() ProductSessionDeviceV4Binding {
	return ProductSessionDeviceV4Binding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf",
		PKA: bytes.Repeat([]byte{0x31}, PublicKeyASize), PKB: bytes.Repeat([]byte{0x32}, PublicKeyBSize)}
}

func productDeviceV4TestJSON(t *testing.T, v any) []byte {
	t.Helper()
	var out bytes.Buffer
	e := json.NewEncoder(&out)
	e.SetEscapeHTML(false)
	requireNoError(t, e.Encode(v))
	return bytes.TrimSuffix(out.Bytes(), []byte{'\n'})
}

func productDeviceV4TestChange(t *testing.T, raw []byte, changes map[string]any) []byte {
	t.Helper()
	var v map[string]any
	requireNoError(t, json.Unmarshal(raw, &v))
	for k, x := range changes {
		v[k] = x
	}
	return productDeviceV4TestJSON(t, v)
}

func productDeviceV4TestFixture(t *testing.T, b ProductSessionDeviceV4Binding) (registration, challenge []byte) {
	t.Helper()
	registration = productDeviceV4TestJSON(t, map[string]any{
		"version": "4", "registrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "networkId": hex.EncodeToString(b.NetworkID), "canonicalOwner": b.Owner,
		"productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos", "applicationId": "com.ynx.developer",
		"bundleId": "com.ynx.developer", "packageId": nil, "origin": "https://developer.ynxweb4.com", "callback": "ynxdeveloper://callback",
		"deviceId": "PUBLIC-device-v4", "generation": "18446744073709551615", "revision": "1", "pkA": hex.EncodeToString(b.PKA), "pkB": hex.EncodeToString(b.PKB),
		"registeredAt": "2026-10-26T07:00:00.000Z", "expiresAt": "2026-10-26T09:00:00.000Z", "revokedAt": nil,
	})
	digest := sha256.Sum256(registration)
	challenge = productDeviceV4TestJSON(t, map[string]any{
		"version": "4", "chainId": "ynx_6423-1", "productId": "developer", "clientId": "com.ynx.developer.macos", "platform": "macos",
		"applicationId": "com.ynx.developer", "bundleId": "com.ynx.developer", "packageId": nil, "origin": "https://developer.ynxweb4.com", "callback": "ynxdeveloper://callback",
		"deviceId": "PUBLIC-device-v4", "deviceAlgorithm": Suite, "deviceRegistrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "deviceRegistrationRevision": "1",
		"deviceRegistrationDigest": hex.EncodeToString(digest[:]), "account": "ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80",
		"accountAuthorization": map[string]any{"policyVersion": "YNX-ACCOUNT-POLICY/v1", "algorithmVersion": Version, "networkId": hex.EncodeToString(b.NetworkID), "canonicalOwner": b.Owner,
			"revision": "18446744073709551615", "registeredAt": "18446744073709551614", "activeFrom": "18446744073709551615",
			"pkA": strings.Repeat("41", PublicKeyASize), "pkB": strings.Repeat("42", PublicKeyBSize)},
		"challenge": strings.Repeat("c", 43), "nonce": strings.Repeat("n", 43), "state": strings.Repeat("s", 43),
		"scopes": []string{"projects:read", "projects:write"}, "requestDigest": strings.Repeat("1", 64), "approvalDigest": strings.Repeat("2", 64),
		"issuedAt": "2026-10-26T08:00:00.000Z", "expiresAt": "2026-10-26T08:01:00.000Z", "sessionExpiresAt": "2026-10-26T08:05:00.000Z",
	})
	return registration, challenge
}

func TestProductSessionDeviceV4FixedE5AndDistinctAccountPair(t *testing.T) {
	b := productDeviceV4TestBinding()
	r, c := productDeviceV4TestFixture(t, b)
	rm, err := BuildProductSessionDeviceRegistrationV4Message(r, b)
	requireNoError(t, err)
	cm, err := BuildProductSessionDeviceChallengeV4Message(c, r, b)
	requireNoError(t, err)
	for _, tc := range []struct {
		message, body []byte
		domain        string
	}{
		{rm, r, "YNX-PRODUCT-SESSION-DEVICE-REGISTRATION/v4"},
		{cm, []byte(`{"challenge":` + string(c) + `,"registration":` + string(r) + `}`), "YNX-PRODUCT-SESSION-DEVICE-CHALLENGE/v4"},
	} {
		f, err := DecodeFields(tc.message, 5, 16384)
		requireNoError(t, err)
		if string(f[0]) != tc.domain || !bytes.Equal(f[1], []byte{0, 0, 0, 4}) || !bytes.Equal(f[2], b.NetworkID) || string(f[3]) != b.Owner || !bytes.Equal(f[4], tc.body) {
			t.Fatal("fixed SDK E5/domain/BE32/body changed")
		}
	}
	// The independent account policy pair is intentionally different. A device
	// signer may not substitute its own device pair into that account tuple.
	if bytes.Equal(rm, cm) || !bytes.Contains(c, []byte(strings.Repeat("41", PublicKeyASize))) {
		t.Fatal("separate purpose or independent account tuple was lost")
	}
}

func TestProductSessionDeviceV4CanonicalOriginalsRejectAliases(t *testing.T) {
	b := productDeviceV4TestBinding()
	r, c := productDeviceV4TestFixture(t, b)
	for _, tc := range []struct {
		name string
		raw  []byte
		call func([]byte) error
	}{
		{"registration", r, func(x []byte) error { _, err := BuildProductSessionDeviceRegistrationV4Message(x, b); return err }},
		{"challenge", c, func(x []byte) error { _, err := BuildProductSessionDeviceChallengeV4Message(x, r, b); return err }},
	} {
		for label, mutate := range map[string]func([]byte) []byte{
			"duplicate":         func(x []byte) []byte { return bytes.Replace(x, []byte(`{`), []byte(`{"version":"4",`), 1) },
			"escaped duplicate": func(x []byte) []byte { return bytes.Replace(x, []byte(`{`), []byte(`{"vers\u0069on":"4",`), 1) },
			"unknown":           func(x []byte) []byte { return bytes.Replace(x, []byte(`{`), []byte(`{"unknown":null,`), 1) },
			"missing nullable":  func(x []byte) []byte { return bytes.Replace(x, []byte(`"packageId":null,`), nil, 1) },
			"case alias": func(x []byte) []byte {
				return bytes.Replace(x, []byte(`"applicationId":`), []byte(`"ApplicationId":`), 1)
			},
			"escaped key":     func(x []byte) []byte { return bytes.Replace(x, []byte(`"version":`), []byte(`"vers\u0069on":`), 1) },
			"escaped value":   func(x []byte) []byte { return bytes.Replace(x, []byte(`"macos"`), []byte(`"mac\u006fs"`), 1) },
			"escaped slash":   func(x []byte) []byte { return bytes.Replace(x, []byte(`https://`), []byte(`https:\/\/`), 1) },
			"leading space":   func(x []byte) []byte { return append([]byte{' '}, x...) },
			"trailing LF":     func(x []byte) []byte { return append(clone(x), '\n') },
			"trailing object": func(x []byte) []byte { return append(clone(x), []byte(`{}`)...) },
			"invalid UTF8":    func(x []byte) []byte { return append(clone(x[:len(x)-1]), 0xff, '}') },
			"reordered": func(x []byte) []byte {
				i := bytes.IndexByte(x, ',')
				return []byte(`{` + string(x[i+1:len(x)-1]) + `,` + string(x[1:i]) + `}`)
			},
		} {
			t.Run(tc.name+"/"+label, func(t *testing.T) { requireError(t, tc.call(mutate(tc.raw))) })
		}
		for _, raw := range [][]byte{nil, []byte(`null`), []byte(`[]`), bytes.Repeat([]byte{'x'}, 16385)} {
			requireError(t, tc.call(raw))
		}
	}
}

func TestProductSessionDeviceV4Registration20Values(t *testing.T) {
	b := productDeviceV4TestBinding()
	r, _ := productDeviceV4TestFixture(t, b)
	for field, bad := range map[string]any{
		"version": 4, "registrationId": "aaaaaaaa-bbbb-3ccc-8ddd-eeeeeeeeeeee", "networkId": strings.Repeat("AB", 32), "canonicalOwner": strings.ToUpper(b.Owner),
		"productId": "Developer", "clientId": "ab", "platform": "unknown", "applicationId": "com_ynx.developer", "bundleId": "com.ynx.other", "packageId": "com.ynx.developer",
		"origin": "https://developer.ynxweb4.com/", "callback": "http://insecure.example/", "deviceId": "short", "generation": "0", "revision": "18446744073709551616",
		"pkA": strings.Repeat("31", PublicKeyASize-1), "pkB": strings.Repeat("33", PublicKeyBSize), "registeredAt": "2026-02-30T07:00:00.000Z", "expiresAt": "2026-10-26T07:00:00.000Z", "revokedAt": "2026-10-26T06:59:59.999Z",
	} {
		t.Run(field, func(t *testing.T) {
			_, err := BuildProductSessionDeviceRegistrationV4Message(productDeviceV4TestChange(t, r, map[string]any{field: bad}), b)
			requireError(t, err)
		})
	}
	for _, bad := range []any{"01", "-1", "18446744073709551616", 1, nil} {
		_, err := BuildProductSessionDeviceRegistrationV4Message(productDeviceV4TestChange(t, r, map[string]any{"generation": bad}), b)
		requireError(t, err)
	}
	// Encoder semantics are deliberately not current authorization: a structurally
	// valid revoked/expired original can be encoded, but cannot bind a challenge.
	revoked := productDeviceV4TestChange(t, r, map[string]any{"revokedAt": "2026-10-26T07:30:00.000Z"})
	_, err := BuildProductSessionDeviceRegistrationV4Message(revoked, b)
	requireNoError(t, err)
	_, c := productDeviceV4TestFixture(t, b)
	digest := sha256.Sum256(revoked)
	_, err = BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, map[string]any{"deviceRegistrationDigest": hex.EncodeToString(digest[:])}), revoked, b)
	requireError(t, err)
}

func TestProductSessionDeviceV4Challenge26AndAccountTuple(t *testing.T) {
	b := productDeviceV4TestBinding()
	r, c := productDeviceV4TestFixture(t, b)
	for field, bad := range map[string]any{
		"version": "3", "chainId": "ynx_6424-1", "productId": "social", "clientId": "com.other.macos", "platform": "ios", "applicationId": "com.ynx.other", "bundleId": nil, "packageId": "com.ynx.developer",
		"origin": "https://other.example", "callback": "ynxdeveloper://other", "deviceId": "OTHER-device-v4", "deviceAlgorithm": "p256-sha256", "deviceRegistrationId": "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
		"deviceRegistrationRevision": "2", "deviceRegistrationDigest": strings.Repeat("0", 64), "account": b.Owner,
		"challenge": strings.Repeat("c", 31), "nonce": strings.Repeat("n", 65), "state": strings.Repeat("s", 43) + "=", "requestDigest": strings.Repeat("AB", 32), "approvalDigest": strings.Repeat("a", 63),
		"issuedAt": "2026-10-26T06:59:59.999Z", "expiresAt": "2026-10-26T08:01:00.001Z", "sessionExpiresAt": "2026-10-26T08:05:00.001Z", "scopes": []string{"projects:write", "projects:read"},
	} {
		t.Run(field, func(t *testing.T) {
			_, err := BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, map[string]any{field: bad}), r, b)
			requireError(t, err)
		})
	}
	var cv map[string]any
	requireNoError(t, json.Unmarshal(c, &cv))
	for field, bad := range map[string]any{
		"policyVersion": "YNX-ACCOUNT-POLICY/v2", "algorithmVersion": "legacy", "networkId": strings.Repeat("cd", 32), "canonicalOwner": "0x1111111111111111111111111111111111111111",
		"revision": "0", "registeredAt": "18446744073709551615", "activeFrom": "18446744073709551616", "pkA": strings.Repeat("41", PublicKeyASize-1), "pkB": strings.Repeat("AB", PublicKeyBSize),
	} {
		t.Run("account/"+field, func(t *testing.T) {
			var a map[string]any
			requireNoError(t, json.Unmarshal(productDeviceV4TestJSON(t, cv["accountAuthorization"]), &a))
			a[field] = bad
			_, err := BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, map[string]any{"accountAuthorization": a}), r, b)
			requireError(t, err)
		})
	}
	for _, changes := range []map[string]any{
		{"expiresAt": "2026-10-26T08:00:00.000Z"}, {"sessionExpiresAt": "2026-10-26T08:00:59.999Z"},
		{"scopes": []string{}}, {"scopes": []string{"projects:read", "projects:read"}}, {"scopes": []string{"Invalid"}}, {"scopes": nil},
		{"scopes": []string{"projects:a", "projects:b", "projects:c", "projects:d", "projects:e", "projects:f", "projects:g", "projects:h", "projects:i"}},
	} {
		_, err := BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, changes), r, b)
		requireError(t, err)
	}
	// Valid original bytes with a changed non-identity field still require the
	// matching complete original digest, not a hash of a selected projection.
	r2 := productDeviceV4TestChange(t, r, map[string]any{"generation": "2"})
	_, err := BuildProductSessionDeviceChallengeV4Message(c, r2, b)
	requireError(t, err)
	digest := sha256.Sum256(r2)
	_, err = BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, map[string]any{"deviceRegistrationDigest": hex.EncodeToString(digest[:])}), r2, b)
	requireNoError(t, err)
	r2 = productDeviceV4TestChange(t, r, map[string]any{"expiresAt": "2026-10-26T08:00:59.999Z"})
	digest = sha256.Sum256(r2)
	_, err = BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, map[string]any{"deviceRegistrationDigest": hex.EncodeToString(digest[:])}), r2, b)
	requireError(t, err) // Valid issued time, but neither challenge nor session may outlive the original.
}

func TestProductSessionDeviceV4URLAndPlatformContracts(t *testing.T) {
	b := productDeviceV4TestBinding()
	r, c := productDeviceV4TestFixture(t, b)
	for _, tc := range []struct {
		origin, callback, platform string
		bundle, pkg                any
		challengeOK                bool
	}{
		{"app://macos/com.ynx.developer", "ynxdeveloper://callback", "macos", "com.ynx.developer", nil, true},
		{"https://developer.ynxweb4.com", "ynxdeveloper://callback/a&b", "macos", "com.ynx.developer", nil, true},
		{"https://developer.ynxweb4.com", "ynxdeveloper://callback", "web", nil, nil, true},
		{"app://linux/com.ynx.developer", "ynxdeveloper://callback", "linux", nil, "com.ynx.developer", true},
		{"https://developer.ynxweb4.com:8443", "ynxdeveloper://callback", "macos", "com.ynx.developer", nil, false},
		{"app://other/com.ynx.developer", "ynxdeveloper://callback", "macos", "com.ynx.developer", nil, false},
		{"https://developer.ynxweb4.com", "ynxdeveloper://callback", "macos", nil, nil, false},
	} {
		changes := map[string]any{"origin": tc.origin, "callback": tc.callback, "platform": tc.platform, "bundleId": tc.bundle, "packageId": tc.pkg}
		r2 := productDeviceV4TestChange(t, r, changes)
		_, err := BuildProductSessionDeviceRegistrationV4Message(r2, b)
		requireNoError(t, err) // registration20 has its own, broader URL/platform grammar.
		digest := sha256.Sum256(r2)
		changes["deviceRegistrationDigest"] = hex.EncodeToString(digest[:])
		_, err = BuildProductSessionDeviceChallengeV4Message(productDeviceV4TestChange(t, c, changes), r2, b)
		if tc.challengeOK {
			requireNoError(t, err)
		} else {
			requireError(t, err)
		}
	}
}

func TestProductSessionDeviceV4BindingBoundsAndDetachment(t *testing.T) {
	b := productDeviceV4TestBinding()
	r, c := productDeviceV4TestFixture(t, b)
	message, err := BuildProductSessionDeviceChallengeV4Message(c, r, b)
	requireNoError(t, err)
	want := clone(message)
	for _, part := range []string{"network", "owner", "pkA", "pkB"} {
		x := productDeviceV4TestBinding()
		switch part {
		case "network":
			x.NetworkID[0] ^= 1
		case "owner":
			x.Owner = "0x1111111111111111111111111111111111111111"
		case "pkA":
			x.PKA[0] ^= 1
		case "pkB":
			x.PKB[0] ^= 1
		}
		_, err := BuildProductSessionDeviceRegistrationV4Message(r, x)
		requireError(t, err)
		_, err = BuildProductSessionDeviceChallengeV4Message(c, r, x)
		requireError(t, err)
	}
	for _, x := range []ProductSessionDeviceV4Binding{
		{}, {b.NetworkID[:31], b.Owner, b.PKA, b.PKB}, {b.NetworkID, strings.ToUpper(b.Owner), b.PKA, b.PKB},
		{b.NetworkID, b.Owner, b.PKA[:PublicKeyASize-1], b.PKB}, {b.NetworkID, b.Owner, b.PKA, b.PKB[:PublicKeyBSize-1]},
	} {
		_, err := BuildProductSessionDeviceRegistrationV4Message(r, x)
		requireError(t, err)
	}
	_, err = BuildProductSessionDeviceChallengeV4Message(c, bytes.Repeat([]byte{'x'}, 16385), b)
	requireError(t, err)
	b.NetworkID[0] ^= 1
	b.PKA[0] ^= 1
	b.PKB[0] ^= 1
	r[0], c[0] = '!', '!'
	if !bytes.Equal(message, want) || len(message) > 16384 || MaxProductSessionDeviceV4MemberBytes != 98304 {
		t.Fatal("caller aliases or public message/member bounds changed")
	}
}

func TestProductSessionDeviceV4MemberN1AndActualAND(t *testing.T) {
	key, public, err := KeyGen()
	requireNoError(t, err)
	defer key.Destroy()
	b := productDeviceV4TestBinding()
	b.PKA, b.PKB = clone(public.PKA), clone(public.PKB)
	r, c := productDeviceV4TestFixture(t, b)
	for _, challenge := range []bool{false, true} {
		purpose := ProductSessionDeviceRegistrationPurpose
		message, err := BuildProductSessionDeviceRegistrationV4Message(r, b)
		inspect := func(w []byte) (Member, error) { return InspectProductSessionDeviceRegistrationV4Member(w, r, b) }
		if challenge {
			purpose = ProductSessionDeviceChallengePurpose
			message, err = BuildProductSessionDeviceChallengeV4Message(c, r, b)
			inspect = func(w []byte) (Member, error) { return InspectProductSessionDeviceChallengeV4Member(w, c, r, b) }
		}
		requireNoError(t, err)
		batch, err := BatchSign(key, Metadata{ChainID: b.NetworkID, Owner: b.Owner, Purpose: purpose}, [][]byte{message}, SignOptions{Optimized: true})
		requireNoError(t, err)
		defer batch.Discard()
		m, err := Extract(batch, 0)
		requireNoError(t, err)
		wire, err := EncodeMember(m)
		requireNoError(t, err)
		inspected, err := inspect(wire)
		requireNoError(t, err)
		v, err := NewVerifier(VerifierOptions{ChainID: b.NetworkID, Purpose: purpose, CacheEntries: 0, ResolveTrustedOwner: func(q TrustRequest) (Registration, error) {
			if q.Height != 0 || q.Owner != b.Owner || q.Purpose != purpose || !bytes.Equal(q.ChainID, b.NetworkID) {
				return Registration{}, ErrUntrusted
			}
			return Registration{Enabled: true, AlgorithmVersion: Version, ChainID: b.NetworkID, Owner: b.Owner, Purpose: purpose,
				PKA: b.PKA, PKB: b.PKB, PolicyRevision: "synthetic-device-v4-math-only"}, nil
		}})
		requireNoError(t, err)
		defer v.Clear()
		requireNoError(t, v.VerifyOne(wire, 0))
		for _, branch := range []string{"A", "B"} {
			bad, err := DecodeMember(wire)
			requireNoError(t, err)
			if branch == "A" {
				bad.Certificate.SigmaA[0] ^= 1
			} else {
				bad.Certificate.SigmaB[0] ^= 1
			}
			badWire, err := EncodeMember(bad)
			requireNoError(t, err)
			_, err = inspect(badWire)
			requireNoError(t, err) // Inspection deliberately is not an AND validity claim.
			requireError(t, v.VerifyOne(badWire, 0))
		}
		for _, wrong := range []string{ProductSessionHTTPPurpose, "TX-BATCH", "PRODUCT-SESSION-APPROVAL", "ARTIFACT-RELEASE", "IDE-PROJECT-CONTROL"} {
			bad, err := DecodeMember(wire)
			requireNoError(t, err)
			bad.Certificate.Purpose = wrong
			badWire, err := EncodeMember(bad)
			requireNoError(t, err)
			_, err = inspect(badWire)
			requireError(t, err)
		}
		other := ProductSessionDeviceChallengePurpose
		if challenge {
			other = ProductSessionDeviceRegistrationPurpose
		}
		bad := inspected
		bad.Certificate.Purpose = other
		badWire, err := EncodeMember(bad)
		requireNoError(t, err)
		_, err = inspect(badWire)
		requireError(t, err)
		bad, err = DecodeMember(wire)
		requireNoError(t, err)
		bad.Message[len(bad.Message)-2] ^= 1
		badWire, err = EncodeMember(bad)
		requireNoError(t, err)
		_, err = inspect(badWire)
		requireError(t, err)
		for _, raw := range [][]byte{nil, append(clone(wire), 0), bytes.Repeat([]byte{'x'}, 98305)} {
			_, err := inspect(raw)
			requireError(t, err)
		}
		two, err := BatchSign(key, Metadata{ChainID: b.NetworkID, Owner: b.Owner, Purpose: purpose}, [][]byte{message, message}, SignOptions{Optimized: true})
		requireNoError(t, err)
		defer two.Discard()
		for _, index := range []uint32{0, 1} {
			n2, err := Extract(two, index)
			requireNoError(t, err)
			w, err := EncodeMember(n2)
			requireNoError(t, err)
			_, err = inspect(w)
			requireError(t, err)
		}
		// Decoded result is detached from the caller's wire and original bytes.
		wire[len(wire)-1] ^= 1
		if !bytes.Equal(inspected.Message, message) || !bytes.Equal(inspected.Certificate.PKA, public.PKA) {
			t.Fatal("typed inspection aliases caller wire")
		}
	}
}
