package ynxbatch

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

func approvalV4PublicFixture(t *testing.T) ([]byte, ProductSessionApprovalV4Binding, map[string]any, map[string]any) {
	t.Helper()
	e := ProductSessionApprovalV4Binding{NetworkID: bytes.Repeat([]byte{0xab}, 32), Owner: "0x" + strings.Repeat("11", 20), PKA: bytes.Repeat([]byte{0x31}, 2592), PKB: bytes.Repeat([]byte{0x32}, 64), KeyRevision: "18446744073709551615"}
	account, err := accountaddress.Encode(e.Owner)
	if err != nil {
		t.Fatal("fixture account")
	}
	r := map[string]any{"version": "4", "chainId": "ynx_6423-1", "productId": "wallet", "clientId": "com.ynx.wallet.android", "platform": "android", "applicationId": "com.ynx.wallet", "bundleId": nil, "packageId": "com.ynx.wallet", "origin": "app://android/com.ynx.wallet", "callback": "ynxwallet://callback", "deviceId": "PUBLIC-device-v4", "deviceAlgorithm": Suite, "deviceRegistrationId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "deviceRegistrationRevision": "1", "deviceRegistrationDigest": strings.Repeat("a", 64), "nonce": strings.Repeat("A", 32), "state": strings.Repeat("B", 32), "scopes": []string{"profile.read"}, "purpose": "PUBLIC review", "issuedAt": "2026-11-13T08:00:00.000Z", "expiresAt": "2026-11-13T08:05:00.000Z"}
	a := map[string]any{}
	for k, v := range r {
		if k != "purpose" {
			a[k] = v
		}
	}
	a["account"], a["result"] = account, "approved"
	a["issuedAt"] = "2026-11-13T08:00:01.000Z"
	a["accountAuthorization"] = map[string]any{"policyVersion": "YNX-ACCOUNT-POLICY/v1", "algorithmVersion": Version, "networkId": hex.EncodeToString(e.NetworkID), "canonicalOwner": e.Owner, "revision": e.KeyRevision, "registeredAt": "18446744073709551613", "activeFrom": "18446744073709551614", "pkA": hex.EncodeToString(e.PKA), "pkB": hex.EncodeToString(e.PKB)}
	return approvalV4FixtureFrame(t, productDeviceV4Canonical(r), a, e, true), e, r, a
}
func approvalV4FixtureFrame(t *testing.T, request []byte, a map[string]any, e ProductSessionApprovalV4Binding, digest bool) []byte {
	t.Helper()
	if digest {
		d := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_REQUEST_V4\n"), request...))
		a["requestDigest"] = hex.EncodeToString(d[:])
	}
	body := append([]byte(`{"approval":`), productDeviceV4Canonical(a)...)
	body = append(body, `,"request":`...)
	body = append(body, request...)
	body = append(body, '}')
	out, err := EncodeFields([]byte(ProductSessionApprovalV4MessageVersion), U32(4), e.NetworkID, []byte(e.Owner), body)
	if err != nil {
		t.Fatal("fixture E5")
	}
	return out
}
func TestProductSessionApprovalV4ExactTypedE5(t *testing.T) {
	raw, e, _, a := approvalV4PublicFixture(t)
	got, err := ValidateProductSessionApprovalV4Message(raw, e)
	if err != nil || !bytes.Equal(got, raw) {
		t.Fatal("sole fixed E5 rejected")
	}
	got[0] ^= 1
	if bytes.Equal(got, raw) {
		t.Fatal("original was not detached")
	}
	f, _ := DecodeFields(raw, 5, 16384)
	body, _ := approvalV4Object(f[4], []string{"approval", "request"})
	for _, text := range []string{"PUBLIC😀review", "PUBLIC\u2028review", "PUBLIC\u0085review", `PUBLIC\ud800review`, `PUBLIC\\u2028review`} {
		t.Run(text, func(t *testing.T) {
			req := bytes.Replace(body["request"], []byte("PUBLIC review"), []byte(text), 1)
			wire := approvalV4FixtureFrame(t, req, a, e, true)
			out, err := ValidateProductSessionApprovalV4Message(wire, e)
			if err != nil || !bytes.Equal(out, wire) {
				t.Fatal("SDK canonical UTF16/UTF8 purpose changed")
			}
		})
	}
}
func TestProductSessionApprovalV4Refusals(t *testing.T) {
	for _, kind := range []string{"network", "owner", "pairA", "pairB", "revision", "revision-zero", "domain", "version", "trailing", "field-count", "duplicate", "missing-null", "extra", "suite", "scopes", "nullable", "registry-shape", "digest", "account", "request-bind", "approval-result", "policy", "registered-order", "request-window", "approval-window", "future-request", "purpose-edge", "purpose-long"} {
		t.Run(kind, func(t *testing.T) {
			raw, e, r, a := approvalV4PublicFixture(t)
			auth := a["accountAuthorization"].(map[string]any)
			rebuild := false
			digest := true
			switch kind {
			case "network":
				e.NetworkID[0] ^= 1
			case "owner":
				e.Owner = "0x" + strings.Repeat("22", 20)
			case "pairA":
				e.PKA[0] ^= 1
			case "pairB":
				e.PKB[0] ^= 1
			case "revision":
				e.KeyRevision = "1"
			case "revision-zero":
				e.KeyRevision = "0"
			case "domain", "version", "field-count":
				f, _ := DecodeFields(raw, 5, 16384)
				if kind == "domain" {
					f[0] = []byte("YNX-PRODUCT-SESSION-HTTP-PROOF/v4")
				} else if kind == "version" {
					f[1] = U32(3)
				} else {
					f = append(f, []byte("x"))
				}
				raw, _ = EncodeFields(f...)
			case "trailing":
				raw = append(raw, 0)
			case "duplicate":
				f, _ := DecodeFields(raw, 5, 16384)
				f[4] = bytes.Replace(f[4], []byte(`"version":"4"`), []byte(`"version":"4","version":"4"`), 1)
				raw, _ = EncodeFields(f...)
			default:
				rebuild = true
				switch kind {
				case "missing-null":
					delete(r, "bundleId")
				case "extra":
					r["approved"] = true
				case "suite":
					r["deviceAlgorithm"] = "p256-sha256"
					a["deviceAlgorithm"] = r["deviceAlgorithm"]
				case "scopes":
					r["scopes"] = []string{"z.read", "a.read"}
					a["scopes"] = r["scopes"]
				case "nullable":
					r["bundleId"] = "com.ynx.wallet"
					a["bundleId"] = r["bundleId"]
				case "registry-shape":
					r["origin"] = "https://wallet.ynxweb4.com:444"
					a["origin"] = r["origin"]
				case "digest":
					a["requestDigest"] = strings.Repeat("0", 64)
					digest = false
				case "account":
					a["account"] = "ynx1" + strings.Repeat("q", 38)
				case "request-bind":
					a["deviceRegistrationRevision"] = "2"
				case "approval-result":
					a["result"] = "denied"
				case "policy":
					auth["algorithmVersion"] = "classic"
				case "registered-order":
					auth["registeredAt"] = auth["activeFrom"]
				case "request-window":
					r["expiresAt"] = "2026-11-13T08:05:00.001Z"
				case "approval-window":
					a["expiresAt"] = "2026-11-13T08:05:00.001Z"
				case "future-request":
					r["issuedAt"] = "2026-11-13T08:00:31.001Z"
				case "purpose-edge":
					r["purpose"] = "\ufeffPUBLIC"
				case "purpose-long":
					r["purpose"] = strings.Repeat("😀", 91)
				}
			}
			if rebuild {
				raw = approvalV4FixtureFrame(t, productDeviceV4Canonical(r), a, e, digest)
			}
			if _, err := ValidateProductSessionApprovalV4Message(raw, e); err == nil {
				t.Fatal("typed refusal accepted")
			}
		})
	}
	// Keep imports independent from test map implementation assumptions.
	var data map[string]any
	raw, _, _, _ := approvalV4PublicFixture(t)
	f, _ := DecodeFields(raw, 5, 16384)
	if json.Unmarshal(f[4], &data) != nil {
		t.Fatal("public fixture JSON")
	}
}
