package datafabricapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Credential struct {
	SessionToken     string
	SessionID        string
	DeviceID         string
	Product          string
	BundleID         string
	RequestID        string
	RequestNonce     string
	RequestTimestamp string
	RequestSignature string
	RequestMethod    string
	RequestPath      string
	ContentSHA256    string
}

type Principal struct {
	SessionID    string    `json:"sessionId"`
	AccountID    string    `json:"accountId"`
	DeviceID     string    `json:"deviceId"`
	Product      string    `json:"product"`
	BundleID     string    `json:"bundleId"`
	Scopes       []string  `json:"scopes"`
	ExpiresAt    time.Time `json:"expiresAt"`
	Active       bool      `json:"active"`
	RequestBound bool      `json:"requestBound"`
}

type Authorizer interface {
	Authorize(context.Context, Credential, string) (Principal, error)
}

type HTTPAuthorizer struct {
	Endpoint string
	Client   *http.Client
}

func (a HTTPAuthorizer) Authorize(ctx context.Context, credential Credential, requiredScope string) (Principal, error) {
	endpoint, err := url.Parse(a.Endpoint)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && isLoopback(endpoint.Hostname()))) {
		return Principal{}, errors.New("canonical introspection endpoint must use HTTPS or loopback HTTP")
	}
	body, _ := json.Marshal(map[string]string{
		"sessionToken": credential.SessionToken, "sessionId": credential.SessionID, "deviceId": credential.DeviceID,
		"product": credential.Product, "bundleId": credential.BundleID, "requestId": credential.RequestID, "requestNonce": credential.RequestNonce,
		"requestTimestamp": credential.RequestTimestamp, "requestSignature": credential.RequestSignature, "requestMethod": credential.RequestMethod,
		"requestPath": credential.RequestPath, "contentSha256": credential.ContentSHA256, "requiredScope": requiredScope,
	})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return Principal{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	if traceparent := childTraceparent(ctx); traceparent != "" {
		request.Header.Set("Traceparent", traceparent)
	}
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return Principal{}, fmt.Errorf("canonical introspection unavailable: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		return Principal{}, errors.New("canonical introspection denied the request")
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 64*1024))
	decoder.DisallowUnknownFields()
	var principal Principal
	if err := decoder.Decode(&principal); err != nil {
		return Principal{}, fmt.Errorf("invalid canonical introspection response: %w", err)
	}
	if !principal.Active || !principal.RequestBound || principal.SessionID != credential.SessionID || principal.DeviceID != credential.DeviceID || principal.Product != credential.Product || principal.BundleID != credential.BundleID || !time.Now().UTC().Before(principal.ExpiresAt) || !contains(principal.Scopes, requiredScope) {
		return Principal{}, errors.New("canonical session, product, bundle, device, request binding, expiry, or scope mismatch")
	}
	return principal, nil
}

func isLoopback(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }

func contains(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func credentialFromRequest(r *http.Request) (Credential, error) {
	if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
		return Credential{}, errors.New("Bearer credentials and browser cookies are not accepted")
	}
	requestPath, err := canonicalRequestPath(r.URL)
	if err != nil {
		return Credential{}, err
	}
	credential := Credential{
		SessionToken: r.Header.Get("X-YNX-App-Session"), SessionID: r.Header.Get("X-YNX-Session-ID"), DeviceID: r.Header.Get("X-YNX-Device-ID"),
		Product: r.Header.Get("X-YNX-Product"), BundleID: r.Header.Get("X-YNX-Bundle-ID"), RequestID: r.Header.Get("X-YNX-Request-ID"), RequestNonce: r.Header.Get("X-YNX-Request-Nonce"),
		RequestTimestamp: r.Header.Get("X-YNX-Timestamp"), RequestSignature: r.Header.Get("X-YNX-Device-Signature"), RequestMethod: r.Method, RequestPath: requestPath,
		ContentSHA256: r.Header.Get("X-YNX-Content-SHA256"),
	}
	for name, value := range map[string]string{"session": credential.SessionToken, "sessionId": credential.SessionID, "deviceId": credential.DeviceID, "product": credential.Product, "bundleId": credential.BundleID, "requestId": credential.RequestID, "nonce": credential.RequestNonce, "timestamp": credential.RequestTimestamp, "signature": credential.RequestSignature, "contentSha256": credential.ContentSHA256} {
		if strings.TrimSpace(value) == "" {
			return Credential{}, fmt.Errorf("canonical %s binding is required", name)
		}
	}
	return credential, nil
}

// canonicalRequestPath prevents the signer, Gateway and service from
// interpreting equivalent query strings differently. Go's Values.Encode
// sorts keys, applies one escaping form and preserves repeated-value order.
func canonicalRequestPath(value *url.URL) (string, error) {
	requestPath := value.EscapedPath()
	if value.RawQuery == "" {
		return requestPath, nil
	}
	query, err := url.ParseQuery(value.RawQuery)
	if err != nil {
		return "", errors.New("request query is invalid")
	}
	canonical := query.Encode()
	if value.RawQuery != canonical {
		return "", errors.New("request query is not canonical")
	}
	return requestPath + "?" + canonical, nil
}
