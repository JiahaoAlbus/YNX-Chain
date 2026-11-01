package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

func pendingQueryPUBLICFixture(t *testing.T) (query, reg, post []byte, b ProductPairPendingOriginalQueryBinding) {
	t.Helper()
	device := productDeviceV4TestBinding()
	reg, _ = productDeviceV4TestFixture(t, device)
	r, err := productDeviceV4Registration(reg, device)
	requireNoError(t, err)
	actor := sha256.Sum256(productDeviceV4Canonical(productPairPendingActor{r.ApplicationID, r.BundleID, r.Callback, r.CanonicalOwner, r.ClientID, r.DeviceID, r.NetworkID, r.Origin, r.PackageID, r.Platform, r.ProductID}))
	post = productDeviceV4TestJSON(t, map[string]any{"operationId": strings.Repeat("a", 64), "registrationOriginal": string(reg), "registrationMember": "PUBLIC-syntax-only-no-grant", "request": map[string]any{}, "approval": map[string]any{}})
	d := sha256.Sum256(post)
	query = productDeviceV4TestJSON(t, productPairPendingQuery{strings.Repeat("a", 64), hex.EncodeToString(d[:]), "1"})
	issued, _ := productDeviceV4Time("2026-10-26T08:00:00.000Z")
	at := uint64(issued.UnixMilli())
	b = ProductPairPendingOriginalQueryBinding{NetworkID: device.NetworkID, Owner: device.Owner, PKA: device.PKA, PKB: device.PKB, ActorDigest: hex.EncodeToString(actor[:]), Origin: "https://wallet-auth.ynxweb4.com", Nonce: strings.Repeat("n", 43), IssuedAt: "2026-10-26T08:00:00.000Z", ExpiresAt: "2026-10-26T08:00:30.000Z", AtMS: at, SourceIssuedAtMS: at - 60000, SourceExpiresAtMS: at + 60000}
	return
}

func TestPendingOriginalQueryPUBLICExactFrameAndBodyDigest(t *testing.T) {
	q, r, p, b := pendingQueryPUBLICFixture(t)
	wire, err := BuildProductPairPendingOriginalQueryMessage(q, r, p, b)
	requireNoError(t, err)
	f, err := DecodeFields(wire, 13, MaxProductPairPendingOriginalQueryMessageBytes)
	requireNoError(t, err)
	if string(f[0]) != "YNX/PRODUCT-PAIR/PENDING-ORIGINAL-QUERY/V1" || !bytes.Equal(f[1], U32(1)) || string(f[6]) != "POST" || string(f[7]) != "/v4/product-pairs/original-query" || !bytes.Equal(f[11], q) || !bytes.Equal(f[12], r) || bytes.Contains(wire, []byte("sessionBinding")) || bytes.Contains(wire, p) {
		t.Fatal("fixed frame or no-session/original-body boundary")
	}
	view, err := InspectProductPairPendingOriginalQueryMessage(wire, q, r, p, b)
	requireNoError(t, err)
	view.Binding.PKA[0] ^= 1
	view.QueryOriginal[0] ^= 1
	view.RegistrationOriginal[0] ^= 1
	if !bytes.Equal(f[11], q) || !bytes.Equal(f[12], r) {
		t.Fatal("returned public DATA aliases original")
	}
	changed := append(clone(p), ' ')
	_, err = BuildProductPairPendingOriginalQueryMessage(q, r, changed, b)
	requireError(t, err)
	// Independent selection may legitimately equal the nested product origin.
	// It is the expected signed value, not an inequality or inferred selection.
	b.Origin = "https://developer.ynxweb4.com"
	sameOrigin, err := BuildProductPairPendingOriginalQueryMessage(q, r, p, b)
	requireNoError(t, err)
	_, err = InspectProductPairPendingOriginalQueryMessage(sameOrigin, q, r, p, b)
	requireNoError(t, err)
	wrongOrigin := b
	wrongOrigin.Origin = "https://other.example"
	_, err = InspectProductPairPendingOriginalQueryMessage(sameOrigin, q, r, p, wrongOrigin)
	requireError(t, err)
	// Exact old POST digest and the independent query body digest differ.
	d := sha256.Sum256(q)
	bad := productDeviceV4TestChange(t, q, map[string]any{"originalRequestBodyDigest": hex.EncodeToString(d[:])})
	_, err = BuildProductPairPendingOriginalQueryMessage(bad, r, p, b)
	requireError(t, err)
}

func TestPendingOriginalQueryPUBLICRejectsSubstitutionAndSessionFields(t *testing.T) {
	q, r, p, b := pendingQueryPUBLICFixture(t)
	for name, raw := range map[string][]byte{
		"sessionBinding":  productDeviceV4TestChange(t, q, map[string]any{"sessionBinding": strings.Repeat("0", 64)}),
		"wrong-operation": productDeviceV4TestChange(t, q, map[string]any{"operationId": strings.Repeat("b", 64)}),
		"wrong-digest":    productDeviceV4TestChange(t, q, map[string]any{"originalRequestBodyDigest": strings.Repeat("b", 64)}),
		"wrong-version":   productDeviceV4TestChange(t, q, map[string]any{"version": "4"}),
		"numeric-version": productDeviceV4TestChange(t, q, map[string]any{"version": 1}),
		"duplicate":       append([]byte(`{"version":"1",`), q[1:]...),
		"case":            bytes.Replace(q, []byte(`"operationId"`), []byte(`"OperationId"`), 1),
		"trailing":        append(clone(q), '\n'), "missing": []byte(`{"version":"1"}`), "invalid-utf8": {0xff},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := BuildProductPairPendingOriginalQueryMessage(raw, r, p, b)
			requireError(t, err)
		})
	}
	for name, change := range map[string]func(*ProductPairPendingOriginalQueryBinding){
		"actor":           func(x *ProductPairPendingOriginalQueryBinding) { x.ActorDigest = strings.Repeat("b", 64) },
		"network":         func(x *ProductPairPendingOriginalQueryBinding) { x.NetworkID = bytes.Repeat([]byte{0xbb}, 32) },
		"owner":           func(x *ProductPairPendingOriginalQueryBinding) { x.Owner = "0x" + strings.Repeat("1", 40) },
		"pairA":           func(x *ProductPairPendingOriginalQueryBinding) { x.PKA = bytes.Repeat([]byte{0xbb}, PublicKeyASize) },
		"pairB":           func(x *ProductPairPendingOriginalQueryBinding) { x.PKB = bytes.Repeat([]byte{0xbb}, PublicKeyBSize) },
		"http-origin":     func(x *ProductPairPendingOriginalQueryBinding) { x.Origin = "http://auth.ynxweb4.com" },
		"origin-path":     func(x *ProductPairPendingOriginalQueryBinding) { x.Origin += "/" },
		"nonce":           func(x *ProductPairPendingOriginalQueryBinding) { x.Nonce = "short" },
		"long-window":     func(x *ProductPairPendingOriginalQueryBinding) { x.ExpiresAt = "2026-10-26T08:00:30.001Z" },
		"zero-window":     func(x *ProductPairPendingOriginalQueryBinding) { x.ExpiresAt = x.IssuedAt },
		"ambiguous-time":  func(x *ProductPairPendingOriginalQueryBinding) { x.IssuedAt = "2026-10-26T08:00:00Z" },
		"not-yet-issued":  func(x *ProductPairPendingOriginalQueryBinding) { x.AtMS-- },
		"at-expiry":       func(x *ProductPairPendingOriginalQueryBinding) { x.AtMS += 30000 },
		"source-start":    func(x *ProductPairPendingOriginalQueryBinding) { x.SourceIssuedAtMS = x.AtMS + 1 },
		"source-expiry":   func(x *ProductPairPendingOriginalQueryBinding) { x.SourceExpiresAtMS = x.AtMS + 29999 },
		"unsafe-clock":    func(x *ProductPairPendingOriginalQueryBinding) { x.AtMS = 1 << 53 },
		"source-inverted": func(x *ProductPairPendingOriginalQueryBinding) { x.SourceIssuedAtMS = x.SourceExpiresAtMS },
	} {
		t.Run(name, func(t *testing.T) {
			x := b
			change(&x)
			_, err := BuildProductPairPendingOriginalQueryMessage(q, r, p, x)
			requireError(t, err)
		})
	}
	wire, err := BuildProductPairPendingOriginalQueryMessage(q, r, p, b)
	requireNoError(t, err)
	for _, change := range []func(*ProductPairPendingOriginalQueryBinding){func(x *ProductPairPendingOriginalQueryBinding) { x.Origin = "https://other.example" }, func(x *ProductPairPendingOriginalQueryBinding) { x.Origin = "https://developer.ynxweb4.com" }, func(x *ProductPairPendingOriginalQueryBinding) { x.Nonce = strings.Repeat("z", 43) }, func(x *ProductPairPendingOriginalQueryBinding) { x.ExpiresAt = "2026-10-26T08:00:29.000Z" }} {
		x := b
		change(&x)
		_, err := InspectProductPairPendingOriginalQueryMessage(wire, q, r, p, x)
		requireError(t, err)
	}
	for _, index := range []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12} {
		f, err := DecodeFields(wire, 13, MaxProductPairPendingOriginalQueryMessageBytes)
		requireNoError(t, err)
		f[index][0] ^= 1
		bad, err := EncodeFields(f...)
		requireNoError(t, err)
		_, err = InspectProductPairPendingOriginalQueryMessage(bad, q, r, p, b)
		requireError(t, err)
	}
	// The real issuer compares the entire original POST to recursive
	// canonicalJSON, including sorted request/approval keys and safe integers.
	for name, value := range map[string]string{
		"valid-nested":          `{"a":[null,true,-9007199254740991],"z":{"a":"<>&","b":9007199254740991}}`,
		"valid-utf16":           `{"😀":1,"":2}`,
		"valid-lone-surrogate":  `{"a":"\ud800"}`,
		"valid-control":         `{"a":"\u0000\n<>&"}`,
		"escaped-scalar":        `{"a":"\u0061"}`,
		"surrogate-pair-escape": `{"a":"\ud83d\ude00"}`,
		"unsorted-nested":       `{"z":0,"a":1}`,
		"duplicate-nested":      `{"a":0,"a":1}`,
		"unsafe-number":         `{"a":9007199254740992}`,
		"fraction":              `{"a":1.5}`,
		"negative-zero":         `{"a":-0}`,
		"exponent":              `{"a":1e1}`,
		"nested-space":          `{"a": 1}`,
	} {
		for _, field := range []string{"approval", "request"} {
			t.Run(name+"-"+field, func(t *testing.T) {
				var body map[string]json.RawMessage
				requireNoError(t, json.Unmarshal(p, &body))
				// Inject raw bytes after canonicalizing the envelope so the
				// test does not silently normalize the negative input itself.
				body[field] = json.RawMessage(`"RAW_PLACEHOLDER"`)
				post := bytes.Replace(productDeviceV4Canonical(body), []byte(`"RAW_PLACEHOLDER"`), []byte(value), 1)
				d := sha256.Sum256(post)
				query := productDeviceV4TestChange(t, q, map[string]any{"originalRequestBodyDigest": hex.EncodeToString(d[:])})
				_, err := BuildProductPairPendingOriginalQueryMessage(query, r, post, b)
				if strings.HasPrefix(name, "valid-") {
					requireNoError(t, err)
				} else {
					requireError(t, err)
				}
			})
		}
	}
	for field, value := range map[string]any{"registeredAt": "2026-10-26T08:00:00.001Z", "expiresAt": "2026-10-26T08:00:29.999Z", "revokedAt": "2026-10-26T07:30:00.000Z"} {
		t.Run("registration-window-"+field, func(t *testing.T) {
			raw := productDeviceV4TestChange(t, r, map[string]any{field: value})
			post := productDeviceV4TestChange(t, p, map[string]any{"registrationOriginal": string(raw)})
			d := sha256.Sum256(post)
			query := productDeviceV4TestChange(t, q, map[string]any{"originalRequestBodyDigest": hex.EncodeToString(d[:])})
			_, err := BuildProductPairPendingOriginalQueryMessage(query, raw, post, b)
			requireError(t, err)
		})
	}
}
