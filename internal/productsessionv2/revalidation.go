package productsessionv2

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"slices"
	"time"
)

const revalidationPath = "/v2/browser-sessions/product-revalidate"

// Revalidator performs a fresh confidential-server read of the original private
// authorization after an await. It is not an initial device authorization, an
// action signature, or a Central identity/generation validator. The consumer
// must additionally recheck its original live actor binding and current object
// permissions. Credentials stay exclusively in the product backend.
type Revalidator struct {
	client          *Client
	keyID           string
	key             ed25519.PrivateKey
	backendClientID string
	business        bool
}

func NewRevalidator(client *Client, keyID string, key ed25519.PrivateKey) (*Revalidator, error) {
	if client == nil || client.endpoint != "https://wallet-auth.ynxweb4.com" || client.policy.ProductID != "social" || client.policy.ClientID != "ynx-social-v1" || client.policy.Platform != "web" || client.policy.Origin != "https://social.ynxweb4.com" || keyID == "" || len(key) != ed25519.PrivateKeySize {
		return nil, fail("INVALID_REVALIDATION_CONFIG", 500)
	}
	return &Revalidator{client: client, keyID: keyID, key: append(ed25519.PrivateKey(nil), key...), backendClientID: client.policy.ClientID + "-sso-v1"}, nil
}

// NewBusinessRevalidator binds one confidential product backend to its original
// registered product policy. The public key must separately be installed in the
// authority for this exact backend client. This does not register a client,
// create identity consent, or authorize any action/object/route.
func NewBusinessRevalidator(client *Client, backendClientID, keyID string, key ed25519.PrivateKey) (*Revalidator, error) {
	if client == nil || client.endpoint != "https://wallet-auth.ynxweb4.com" || backendClientID != client.policy.ClientID+"-sso-v1" || !slices.Contains([]string{"finance", "exchange", "quant", "social", "ai", "developer", "calendar", "cloud", "docs", "mail", "shop", "video", "creator-studio"}, client.policy.ProductID) || keyID == "" || len(key) != ed25519.PrivateKeySize {
		return nil, fail("INVALID_REVALIDATION_CONFIG", 500)
	}
	return &Revalidator{client: client, keyID: keyID, key: append(ed25519.PrivateKey(nil), key...), backendClientID: backendClientID, business: true}, nil
}

// NewPrivateBusinessRevalidator uses a distinct operator-approved backend role
// for exactly this private product/platform. It does not add browser identity
// consent or install its public key at the authority. The server must explicitly
// register this same tuple/key/scopes independently before requests can succeed.
func NewPrivateBusinessRevalidator(client *Client, backendClientID, keyID string, key ed25519.PrivateKey) (*Revalidator, error) {
	if client == nil || client.endpoint != "https://wallet-auth.ynxweb4.com" || backendClientID != client.policy.ClientID+"-business-"+client.policy.Platform+"-v1" || !slices.Contains([]string{"finance", "exchange", "quant", "social", "ai", "developer", "calendar", "cloud", "docs", "mail", "shop", "video", "creator-studio", "music", "card", "pay-merchant"}, client.policy.ProductID) || keyID == "" || len(key) != ed25519.PrivateKeySize {
		return nil, fail("INVALID_REVALIDATION_CONFIG", 500)
	}
	return &Revalidator{client: client, keyID: keyID, key: append(ed25519.PrivateKey(nil), key...), backendClientID: backendClientID, business: true}, nil
}

func (r *Revalidator) Revalidate(ctx context.Context, original Session, requiredScopes []string) (Session, error) {
	var zero Session
	c := r.client
	encoded, err := json.Marshal(original)
	if err != nil {
		return zero, fail("INVALID_SESSION", 403)
	}
	var fields map[string]any
	d := json.NewDecoder(bytes.NewReader(encoded))
	d.UseNumber()
	if d.Decode(&fields) != nil || !validSessionFields(fields) || !c.matchesPolicy(fields) || original.Platform != c.policy.Platform || (!r.business && original.Platform != "web") || original.Version != "2" || original.ChainID != "ynx_6423-1" || !validFiniteConsent(original) {
		return zero, fail("SESSION_BINDING_MISMATCH", 403)
	}
	if len(requiredScopes) == 0 || !validScopes(requiredScopes) {
		return zero, fail("INVALID_ROUTE_POLICY", 500)
	}
	for _, scope := range requiredScopes {
		if !slices.Contains(c.policy.AllowedScopes, scope) || !slices.Contains(original.Scopes, scope) {
			return zero, fail("SCOPE_WIDENING", 403)
		}
	}
	issued, e1 := protocolTime(original.IssuedAt)
	expires, e2 := protocolTime(original.ExpiresAt)
	if e1 != nil || e2 != nil || issued.After(c.clock()) || !expires.After(c.clock()) {
		return zero, fail("SESSION_EXPIRED", 401)
	}
	clientID := r.backendClientID
	body := map[string]any{"clientId": clientID, "session": fields, "requiredScopes": requiredScopes}
	raw, err := canonical(body)
	if err != nil {
		return zero, fail("INVALID_SESSION", 403)
	}
	sum := sha256.Sum256(raw)
	nonce := make([]byte, 32)
	if _, err = rand.Read(nonce); err != nil {
		return zero, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	proof := map[string]any{"version": 1, "issuer": c.endpoint, "audience": c.endpoint + "/v2/browser-sessions", "clientId": clientID, "keyId": r.keyID, "method": "POST", "path": revalidationPath, "bodySha256": hex.EncodeToString(sum[:]), "issuedAt": c.clock().UTC().Format("2006-01-02T15:04:05.000Z"), "nonce": base64.RawURLEncoding.EncodeToString(nonce)}
	signed, _ := canonical(proof)
	proof["signature"] = base64.RawURLEncoding.EncodeToString(ed25519.Sign(r.key, signed))
	proofRaw, _ := canonical(proof)
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint+revalidationPath, bytes.NewReader(raw))
	if err != nil {
		return zero, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cache-Control", "no-store")
	request.Header.Set("X-YNX-Backend-Proof", base64.RawURLEncoding.EncodeToString(proofRaw))
	response, err := c.http.Do(request)
	if err != nil {
		return zero, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	defer response.Body.Close()
	media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || !noStore(response.Header.Get("Cache-Control")) {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	payload, err := canonicalObject(data)
	if err != nil {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	if response.StatusCode != 200 {
		if !exactKeys(payload, []string{"error", "ok"}) || payload["ok"] != false {
			return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
		}
		failure, ok := payload["error"].(map[string]any)
		if !ok || !exactKeys(failure, []string{"code"}) {
			return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
		}
		code := text(failure, "code")
		if response.StatusCode >= 500 || slices.Contains([]string{"CLOCK_UNAVAILABLE", "NETWORK_UNAVAILABLE", "SSO_BACKEND_NOT_CONFIGURED", "CAPACITY"}, code) {
			return zero, fail("AUTHORITY_UNAVAILABLE", 503)
		}
		if !errorCodePattern.MatchString(code) {
			return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
		}
		if slices.Contains([]string{"SESSION_EXPIRED", "SESSION_REVOKED", "SESSION_NOT_FOUND"}, code) {
			return zero, fail(code, 401)
		}
		if slices.Contains([]string{"CROSS_PRODUCT_SESSION", "SCOPE_WIDENING", "SSO_CLIENT_MISMATCH", "SSO_PRODUCT_BINDING_INVALID"}, code) {
			return zero, fail(code, 403)
		}
		return zero, fail("AUTHORITY_UNAVAILABLE", 503)
	}
	if !exactKeys(payload, []string{"active", "session"}) || payload["active"] != true {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	returned, ok := payload["session"].(map[string]any)
	if !ok {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	before, _ := canonical(fields)
	after, _ := canonical(returned)
	if !bytes.Equal(before, after) {
		return zero, fail("SESSION_BINDING_MISMATCH", 403)
	}
	if !expires.After(c.clock()) {
		return zero, fail("SESSION_EXPIRED", 401)
	}
	var verified Session
	if json.Unmarshal(after, &verified) != nil {
		return zero, fail("INVALID_AUTHORITY_RESPONSE", 503)
	}
	return verified, nil
}
