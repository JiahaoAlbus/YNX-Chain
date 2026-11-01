package productsessionv2

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
)

// VerifyHTTPAction verifies a separate exact business proof after Authorize.
// Session must be the exact fresh verified authority result. requiredScopes are
// fixed by the product router, never supplied by the caller. The consumer MUST
// atomically consume (SessionBinding, Nonce) with its own transaction/object
// checks and revalidate the original session after relevant asynchronous work.
// GET has an empty body. Query parameters are not signed by this existing
// protocol and require independent server validation; use canonical POST JSON
// for security-sensitive arguments. This method never issues/extends a grant.
func (c *Client) VerifyHTTPAction(header string, session Session, method, path string, body []byte, requiredScopes []string, now time.Time) (ActionAuthorization, error) {
	if len(body) > 16777216 {
		return ActionAuthorization{}, fail("HTTP_BINDING_MISMATCH", 403)
	}
	digest := sha256.Sum256(body)
	return c.verifyHTTPCommitment(header, session, method, path, hex.EncodeToString(digest[:]), int64(len(body)), requiredScopes, now)
}

// VerifyHTTPActionStream hashes actual wire bytes with a fixed server route
// limit. The reader must honor ctx during Read. After COMPLETE read and digest
// verification, the product must recheck context, live actor/session and object
// permissions before atomically consuming the nonce and committing its write.
func (c *Client) VerifyHTTPActionStream(ctx context.Context, header string, session Session, method, path string, body io.Reader, maxBytes int64, requiredScopes []string, now time.Time) (ActionAuthorization, error) {
	started := time.Now()
	if ctx == nil || body == nil || maxBytes < 0 || maxBytes > 536870912 {
		return ActionAuthorization{}, fail("INVALID_ROUTE_POLICY", 500)
	}
	digest := sha256.New()
	size, err := io.Copy(digest, io.LimitReader(businessContextReader{ctx, body}, maxBytes+1))
	if err != nil || ctx.Err() != nil {
		return ActionAuthorization{}, fail("INVALID_ACTION_BODY", 403)
	}
	if size > maxBytes {
		return ActionAuthorization{}, fail("INVALID_ACTION_BODY", 413)
	}
	// Preserve the caller's authority-time basis, but never freeze proof expiry
	// at upload start: include monotonic elapsed time spent reading the body.
	return c.verifyHTTPCommitment(header, session, method, path, hex.EncodeToString(digest.Sum(nil)), size, requiredScopes, now.Add(time.Since(started)))
}

func (c *Client) verifyHTTPCommitment(header string, session Session, method, path, bodyDigest string, bodyBytes int64, requiredScopes []string, now time.Time) (ActionAuthorization, error) {
	var zero ActionAuthorization
	reject := func(code string) (ActionAuthorization, error) { return zero, fail(code, http.StatusForbidden) }
	if c == nil || !validScopes(requiredScopes) || len(requiredScopes) == 0 {
		return zero, fail("INVALID_ROUTE_POLICY", 500)
	}
	encoded, err := json.Marshal(session)
	if err != nil {
		return reject("INVALID_SESSION")
	}
	var sessionFields map[string]any
	err = json.Unmarshal(encoded, &sessionFields)
	if err != nil || !validSessionFields(sessionFields) || !c.matchesPolicy(sessionFields) || session.Platform != c.policy.Platform || session.Version != "2" || session.ChainID != "ynx_6423-1" || session.DeviceAlgorithm != "p256-sha256" || !validFiniteConsent(session) {
		return reject("CROSS_PRODUCT_SESSION")
	}
	for _, scope := range requiredScopes {
		if !slices.Contains(c.policy.AllowedScopes, scope) || !slices.Contains(session.Scopes, scope) {
			return reject("SCOPE_REQUIRED")
		}
	}
	if !regexp.MustCompile(`^(GET|POST|PUT|PATCH|DELETE)$`).MatchString(method) || !regexp.MustCompile(`^/[A-Za-z0-9._~!$&'()*+,;=:@/-]{1,255}$`).MatchString(path) || strings.Contains(path, "//") || strings.HasSuffix(path, "/") || strings.HasPrefix(path, "/v2/product-sessions/") || strings.HasPrefix(path, "/v2/browser-sessions/") || hasDotSegment(path) {
		return reject("HTTP_BINDING_MISMATCH")
	}
	if method == "GET" && bodyBytes != 0 {
		return reject("HTTP_BINDING_MISMATCH")
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
	if text(proof, "bodyDigest") != bodyDigest || !regexp.MustCompile(`^[A-Za-z0-9_-]{32,64}$`).MatchString(text(proof, "nonce")) {
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
	return ActionAuthorization{Nonce: text(proof, "nonce"), BodyDigest: bodyDigest, SessionBinding: session.SessionBinding, ExpiresAt: expires}, nil
}

func hasDotSegment(path string) bool {
	for _, segment := range strings.Split(path, "/") {
		if segment == "." || segment == ".." {
			return true
		}
	}
	return false
}

// Generic readers cannot be interrupted inside Read. Request bodies must honor
// their request context; cancellation is checked before and after each read.
type businessContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r businessContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(p)
	if cancelled := r.ctx.Err(); cancelled != nil {
		return n, cancelled
	}
	return n, err
}
