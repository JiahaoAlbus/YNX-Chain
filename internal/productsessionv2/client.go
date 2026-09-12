// Package productsessionv2 consumes the existing Wallet Product Session v2
// authority. It does not issue sessions or replace the Wallet signature verifier.
package productsessionv2

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

const ProofHeader = "X-YNX-Product-Session-Proof-V2"
const introspectionPath = "/v2/product-sessions/introspect"
const maxResponseBytes = 1 << 20

// Policy is server configuration taken from the Wallet product registry. Never
// populate it (or required scopes) from request JSON or an unverified proof.
type Policy struct {
	ProductID, ClientID, ApplicationID, Platform, Origin, Callback string
	BundleID, PackageID                                            *string
	AllowedScopes                                                  []string
}

type Client struct {
	endpoint string
	policy   Policy
	http     *http.Client
	clock    func() time.Time
}

// Session is the authority's active, sender-constrained product identity. It is
// not a bearer credential, a transaction signature, or an approval of an amount.
type Session struct {
	Version         string   `json:"version"`
	SessionBinding  string   `json:"sessionBinding"`
	ChainID         string   `json:"chainId"`
	ProductID       string   `json:"productId"`
	ClientID        string   `json:"clientId"`
	Platform        string   `json:"platform"`
	ApplicationID   string   `json:"applicationId"`
	BundleID        *string  `json:"bundleId"`
	PackageID       *string  `json:"packageId"`
	Origin          string   `json:"origin"`
	Callback        string   `json:"callback"`
	Account         string   `json:"account"`
	DeviceID        string   `json:"deviceId"`
	DeviceAlgorithm string   `json:"deviceAlgorithm"`
	DeviceKey       string   `json:"deviceKey"`
	DeviceBinding   string   `json:"deviceBinding"`
	Nonce           string   `json:"nonce"`
	State           string   `json:"state"`
	Scopes          []string `json:"scopes"`
	RequestDigest   string   `json:"requestDigest"`
	ApprovalDigest  string   `json:"approvalDigest"`
	IssuedAt        string   `json:"issuedAt"`
	ExpiresAt       string   `json:"expiresAt"`
}

// Error contains a stable code and a suitable product HTTP status. It never
// contains the proof, credentials, or an arbitrary upstream response body.
type Error struct {
	Code   string
	Status int
}

func (e *Error) Error() string           { return "wallet product session: " + e.Code }
func fail(code string, status int) error { return &Error{code, status} }

func NewClient(endpoint string, policy Policy, transport http.RoundTripper) (*Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Port() != "" || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Opaque != "" || endpoint != "https://"+u.Host {
		return nil, errors.New("Wallet authority must be a fixed canonical HTTPS origin")
	}
	if policy.ProductID == "" || policy.ClientID == "" || policy.ApplicationID == "" || policy.Origin == "" || policy.Callback == "" || !slices.Contains([]string{"web", "android", "ios", "linux", "macos", "windows"}, policy.Platform) {
		return nil, errors.New("complete registered product policy required")
	}
	if policy.Platform == "web" && (policy.BundleID != nil || policy.PackageID != nil || !strings.HasPrefix(policy.Origin, "https://")) {
		return nil, errors.New("web policy must use its registered HTTPS origin without native identifiers")
	}
	if len(policy.AllowedScopes) == 0 || !validScopes(policy.AllowedScopes) {
		return nil, errors.New("sorted unique registered scopes required")
	}
	policy.AllowedScopes = slices.Clone(policy.AllowedScopes)
	if policy.BundleID != nil {
		v := *policy.BundleID
		policy.BundleID = &v
	}
	if policy.PackageID != nil {
		v := *policy.PackageID
		policy.PackageID = &v
	}
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &Client{endpoint: endpoint, policy: policy, clock: time.Now, http: &http.Client{
		Transport: transport, Timeout: 10 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}, nil
}

// Authorize consumes one fresh createIntrospectionProof result. Scopes must be
// chosen by the server route. Every retry needs a fresh proof; this method never
// retries or caches authority decisions. Products still enforce object ownership
// and require separate exact-action signatures for payments and similar actions.
func (c *Client) Authorize(ctx context.Context, request *http.Request, requiredScopes []string) (Session, error) {
	var zero Session
	if request == nil || len(requiredScopes) == 0 || !validScopes(requiredScopes) {
		return zero, fail("INVALID_ROUTE_POLICY", 500)
	}
	for _, scope := range requiredScopes {
		if !slices.Contains(c.policy.AllowedScopes, scope) {
			return zero, fail("INVALID_ROUTE_POLICY", 500)
		}
	}
	if origin := request.Header.Get("Origin"); origin != "" && origin != c.policy.Origin {
		return zero, fail("ORIGIN_MISMATCH", 403)
	}
	values := request.Header.Values(ProofHeader)
	if len(values) != 1 || len(values[0]) == 0 || len(values[0]) > 16384 {
		return zero, fail("PROOF_REQUIRED", 401)
	}
	header := values[0]
	raw, err := base64.RawURLEncoding.Strict().DecodeString(header)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != header {
		return zero, fail("INVALID_PROOF", 401)
	}
	proof, err := canonicalObject(raw)
	if err != nil || !exactKeys(proof, proofFields) {
		return zero, fail("INVALID_PROOF", 401)
	}
	body, _ := canonical(map[string]any{"requiredScopes": slices.Clone(requiredScopes)})
	digest := sha256.Sum256(body)
	if text(proof, "version") != "2" || text(proof, "method") != "POST" || text(proof, "path") != introspectionPath || text(proof, "bodyDigest") != hex.EncodeToString(digest[:]) {
		return zero, fail("INTROSPECTION_BINDING_MISMATCH", 403)
	}
	if !c.matchesPolicy(proof) {
		return zero, fail("CROSS_PRODUCT_SESSION", 403)
	}
	now := c.clock().UTC()
	issued, issueErr := protocolTime(text(proof, "issuedAt"))
	expires, expiryErr := protocolTime(text(proof, "expiresAt"))
	if issueErr != nil || expiryErr != nil || issued.After(now) || !expires.After(now) || !expires.After(issued) || expires.Sub(issued) > time.Minute {
		return zero, fail("PROOF_EXPIRED", 401)
	}
	if !hexDigest.MatchString(text(proof, "sessionBinding")) || !accountPattern.MatchString(text(proof, "account")) || text(proof, "deviceId") == "" || text(proof, "deviceKey") == "" || text(proof, "signature") == "" {
		return zero, fail("INVALID_PROOF", 401)
	}
	random := make([]byte, 18)
	if _, err = rand.Read(random); err != nil {
		return zero, fail("RANDOM_UNAVAILABLE", 503)
	}
	requestID := "req_product_" + base64.RawURLEncoding.EncodeToString(random)
	upstream, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+introspectionPath, bytes.NewReader(body))
	if err != nil {
		return zero, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	upstream.Header.Set("Content-Type", "application/json")
	upstream.Header.Set("Accept", "application/json")
	upstream.Header.Set("X-Request-Id", requestID)
	upstream.Header.Set(ProofHeader, header)
	response, err := c.http.Do(upstream)
	if err != nil {
		return zero, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		return zero, fail("AUTHORITY_REDIRECT", 503)
	}
	media, _, mediaErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if mediaErr != nil || media != "application/json" || response.Header.Get("X-Request-Id") != requestID || !noStore(response.Header.Get("Cache-Control")) || response.ContentLength > maxResponseBytes {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	payloadBytes, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(payloadBytes) > maxResponseBytes {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	payload, err := canonicalObject(payloadBytes)
	if err != nil || text(payload, "requestId") != requestID || payload["schemaVersion"] != json.Number("2") {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	if response.StatusCode != http.StatusOK {
		if !exactKeys(payload, []string{"error", "ok", "requestId", "schemaVersion"}) || payload["ok"] != false {
			return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
		}
		upstreamError, ok := payload["error"].(map[string]any)
		if !ok || !exactKeys(upstreamError, []string{"code", "message"}) {
			return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
		}
		code := text(upstreamError, "code")
		if response.StatusCode >= 500 || slices.Contains([]string{"NETWORK_UNAVAILABLE", "CLOCK_UNAVAILABLE", "CAPACITY", "INTERNAL"}, code) {
			return zero, fail("AUTHORITY_UNAVAILABLE", 503)
		}
		if !errorCodePattern.MatchString(code) {
			return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
		}
		return zero, fail(code, 401)
	}
	if !exactKeys(payload, []string{"ok", "requestId", "result", "schemaVersion"}) || payload["ok"] != true {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	result, ok := payload["result"].(map[string]any)
	if !ok || !exactKeys(result, []string{"active", "session"}) || result["active"] != true {
		return zero, fail("SESSION_INACTIVE", 401)
	}
	fields, ok := result["session"].(map[string]any)
	if !ok || !exactKeys(fields, sessionFields) || !c.matchesPolicy(fields) || text(fields, "version") != "2" || text(fields, "chainId") != "ynx_6423-1" || text(fields, "platform") != c.policy.Platform {
		return zero, fail("SESSION_BINDING_MISMATCH", 403)
	}
	for _, key := range []string{"sessionBinding", "account", "deviceId", "deviceKey"} {
		if text(fields, key) != text(proof, key) {
			return zero, fail("SESSION_BINDING_MISMATCH", 403)
		}
	}
	encoded, _ := canonical(fields)
	var session Session
	if err = json.Unmarshal(encoded, &session); err != nil {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	sessionIssued, err1 := protocolTime(session.IssuedAt)
	sessionExpires, err2 := protocolTime(session.ExpiresAt)
	if err1 != nil || err2 != nil || sessionIssued.After(c.clock()) || !sessionExpires.After(c.clock()) || issued.Before(sessionIssued) || expires.After(sessionExpires) || session.DeviceAlgorithm != "p256-sha256" {
		return zero, fail("SESSION_EXPIRED", 401)
	}
	if !validScopes(session.Scopes) {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	for _, scope := range requiredScopes {
		if !slices.Contains(session.Scopes, scope) {
			return zero, fail("SCOPE_WIDENING", 403)
		}
	}
	return session, nil
}

func (c *Client) matchesPolicy(v map[string]any) bool {
	p := c.policy
	return text(v, "productId") == p.ProductID && text(v, "clientId") == p.ClientID && text(v, "applicationId") == p.ApplicationID && text(v, "origin") == p.Origin && text(v, "callback") == p.Callback && nullableEqual(v, "bundleId", p.BundleID) && nullableEqual(v, "packageId", p.PackageID)
}
func nullableEqual(v map[string]any, k string, p *string) bool {
	if p == nil {
		value, ok := v[k]
		return ok && value == nil
	}
	return text(v, k) == *p
}
func text(v map[string]any, k string) string { s, _ := v[k].(string); return s }
func exactKeys(v map[string]any, keys []string) bool {
	if len(v) != len(keys) {
		return false
	}
	for _, k := range keys {
		if _, ok := v[k]; !ok {
			return false
		}
	}
	return true
}
func canonical(v any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}
func canonicalObject(raw []byte) (map[string]any, error) {
	var value map[string]any
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	if err := d.Decode(&value); err != nil || value == nil {
		return nil, errors.New("invalid JSON object")
	}
	encoded, err := canonical(value)
	if err != nil || !bytes.Equal(encoded, raw) {
		return nil, errors.New("noncanonical JSON")
	}
	return value, nil
}
func protocolTime(value string) (time.Time, error) {
	t, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	if err != nil || t.UTC().Format("2006-01-02T15:04:05.000Z") != value {
		return time.Time{}, fmt.Errorf("invalid protocol timestamp")
	}
	return t, nil
}
func validScopes(scopes []string) bool {
	for i, s := range scopes {
		if !scopePattern.MatchString(s) || (i > 0 && scopes[i-1] >= s) {
			return false
		}
	}
	return true
}
func noStore(value string) bool {
	for _, part := range strings.Split(value, ",") {
		if strings.EqualFold(strings.TrimSpace(part), "no-store") {
			return true
		}
	}
	return false
}

var scopePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$`)
var hexDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var accountPattern = regexp.MustCompile(`^ynx1[023456789acdefghjklmnpqrstuvwxyz]{38}$`)
var errorCodePattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{1,79}$`)
var proofFields = []string{"version", "sessionBinding", "productId", "clientId", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceKey", "method", "path", "bodyDigest", "nonce", "issuedAt", "expiresAt", "signature"}
var sessionFields = []string{"version", "sessionBinding", "chainId", "productId", "clientId", "platform", "applicationId", "bundleId", "packageId", "origin", "callback", "account", "deviceId", "deviceAlgorithm", "deviceKey", "deviceBinding", "nonce", "state", "scopes", "requestDigest", "approvalDigest", "issuedAt", "expiresAt"}
