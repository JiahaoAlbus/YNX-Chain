package productsessionv2

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"regexp"
	"slices"
	"time"
)

const ActionProofHeader = "X-YNX-Product-Session-Action-Proof-V2"

// ActionAuthorization is not a mutation approval or a consumed nonce. The
// product MUST atomically consume Nonce with its original transaction and live
// audience/actor generation checks, before any side effect or private read.
// Pass only Session returned by the existing live authority Authorize call.
type ActionAuthorization struct {
	Nonce, BodyDigest, SessionBinding string
	ExpiresAt                         time.Time
}

// VerifySocialAudienceProof reuses the existing device HTTP proof protocol.
// Identity introspection remains a separate proof/header and is never rebound.
func VerifySocialAudienceProof(header string, session Session, method, path string, body []byte, now time.Time) (ActionAuthorization, error) {
	var zero ActionAuthorization
	reject := func(code string) (ActionAuthorization, error) { return zero, fail(code, http.StatusForbidden) }
	if method != "POST" || (path != "/social/v3/matrix/audience/resolve" && path != "/social/v3/matrix/audience/authorize") || len(body) > 16384 {
		return reject("HTTP_BINDING_MISMATCH")
	}
	if session.ProductID != "social" || session.ClientID != "ynx-social-v1" || session.ChainID != "ynx_6423-1" || session.DeviceAlgorithm != "p256-sha256" {
		return reject("CROSS_PRODUCT_SESSION")
	}
	for _, scope := range []string{"social.contacts", "social.feed", "social.messaging", "social.profile"} {
		if !slices.Contains(session.Scopes, scope) {
			return reject("SCOPE_REQUIRED")
		}
	}
	// Body canonicalization must agree with the sender; hash original bytes only.
	if _, err := canonicalActionBody(body); err != nil {
		return reject("INVALID_ACTION_BODY")
	}
	if len(header) == 0 || len(header) > 16384 {
		return reject("INVALID_PROOF")
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(header)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != header {
		return reject("INVALID_PROOF")
	}
	proof, err := canonicalObject(raw)
	if err != nil || !exactKeys(proof, proofFields) {
		return reject("INVALID_PROOF")
	}
	fields := map[string]string{"version": "2", "sessionBinding": session.SessionBinding, "productId": session.ProductID, "clientId": session.ClientID, "applicationId": session.ApplicationID, "origin": session.Origin, "callback": session.Callback, "account": session.Account, "deviceId": session.DeviceID, "deviceKey": session.DeviceKey, "method": method, "path": path}
	for key, value := range fields {
		if text(proof, key) != value {
			return reject("HTTP_BINDING_MISMATCH")
		}
	}
	if !nullableEqual(proof, "bundleId", session.BundleID) || !nullableEqual(proof, "packageId", session.PackageID) {
		return reject("CROSS_PRODUCT_SESSION")
	}
	digest := sha256.Sum256(body)
	if text(proof, "bodyDigest") != hex.EncodeToString(digest[:]) || !regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`).MatchString(text(proof, "nonce")) {
		return reject("HTTP_BINDING_MISMATCH")
	}
	issued, e1 := protocolTime(text(proof, "issuedAt"))
	expires, e2 := protocolTime(text(proof, "expiresAt"))
	start, e3 := protocolTime(session.IssuedAt)
	end, e4 := protocolTime(session.ExpiresAt)
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil || issued.Before(start) || issued.After(now) || !expires.After(now) || !expires.After(issued) || expires.Sub(issued) > 30*time.Second || expires.After(end) {
		return zero, fail("PROOF_EXPIRED", 401)
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(text(proof, "signature"))
	if err != nil || len(signature) < 68 || len(signature) > 72 || base64.RawURLEncoding.EncodeToString(signature) != text(proof, "signature") {
		return reject("INVALID_DEVICE_PROOF")
	}
	key, err := base64.RawURLEncoding.Strict().DecodeString(session.DeviceKey)
	if err != nil || len(key) != 33 {
		return reject("INVALID_DEVICE_PROOF")
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), key)
	if x == nil {
		return reject("INVALID_DEVICE_PROOF")
	}
	delete(proof, "signature")
	unsigned, err := canonical(proof)
	if err != nil {
		return reject("INVALID_PROOF")
	}
	signed := sha256.Sum256(append([]byte("YNX_PRODUCT_SESSION_HTTP_PROOF_V2\n"), unsigned...))
	if !ecdsa.VerifyASN1(&ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}, signed[:], signature) {
		return reject("INVALID_DEVICE_PROOF")
	}
	return ActionAuthorization{Nonce: text(proof, "nonce"), BodyDigest: hex.EncodeToString(digest[:]), SessionBinding: session.SessionBinding, ExpiresAt: expires}, nil
}
