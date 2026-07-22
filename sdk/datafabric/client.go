package datafabric

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxSDKResponseBytes = 8 * 1024 * 1024

// RequestBinding is the exact request a canonical Wallet/App Gateway signer
// must approve. Implementations should obtain credentials from the canonical
// session boundary and must never expose Wallet or device private keys here.
type RequestBinding struct {
	Method        string
	Path          string
	ContentSHA256 string
}

type CanonicalCredentials struct {
	AppSession      string
	SessionID       string
	DeviceID        string
	Product         string
	BundleID        string
	RequestID       string
	RequestNonce    string
	RequestTime     time.Time
	DeviceSignature string
}

type CredentialProvider interface {
	Credentials(context.Context, RequestBinding) (CanonicalCredentials, error)
}

type Client struct {
	baseURL     *url.URL
	httpClient  *http.Client
	credentials CredentialProvider
}

func NewClient(rawBaseURL string, httpClient *http.Client, credentials CredentialProvider) (*Client, error) {
	baseURL, err := url.Parse(rawBaseURL)
	if err != nil || baseURL.Host == "" || (baseURL.Path != "" && baseURL.Path != "/") || baseURL.RawQuery != "" || baseURL.Fragment != "" || (baseURL.Scheme != "https" && !(baseURL.Scheme == "http" && sdkLoopback(baseURL.Hostname()))) {
		return nil, errors.New("Data Fabric base URL must be HTTPS or loopback HTTP without query or fragment")
	}
	if credentials == nil {
		return nil, errors.New("canonical credential provider is required")
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Client{baseURL: baseURL, httpClient: httpClient, credentials: credentials}, nil
}

type AppendResult struct {
	EventID string `json:"eventId"`
	Status  string `json:"status"`
	AuditID string `json:"auditId"`
}

func (c *Client) AppendEvent(ctx context.Context, event EventEnvelope) (AppendResult, error) {
	body, err := json.Marshal(event)
	if err != nil {
		return AppendResult{}, err
	}
	var result AppendResult
	if err := c.do(ctx, http.MethodPost, "/v1/events", body, &result); err != nil {
		return AppendResult{}, err
	}
	if result.EventID != event.EventID || result.AuditID != event.AuditID || result.Status != "committed-to-outbox" {
		return AppendResult{}, errors.New("Data Fabric returned an inconsistent append acknowledgement")
	}
	return result, nil
}

type EventPage struct {
	Events     []EventEnvelope `json:"events"`
	NextCursor string          `json:"nextCursor"`
	Source     string          `json:"source"`
	AsOf       time.Time       `json:"asOf"`
	Version    string          `json:"version"`
	Status     string          `json:"status"`
}

func (c *Client) Events(ctx context.Context) (EventPage, error) {
	var page EventPage
	if err := c.do(ctx, http.MethodGet, "/v1/events", nil, &page); err != nil {
		return EventPage{}, err
	}
	if page.Source != "ynx-operational-event-store" || page.Status != "authoritative" || page.AsOf.IsZero() || page.Version == "" {
		return EventPage{}, errors.New("Data Fabric returned incomplete event source metadata")
	}
	return page, nil
}

func (c *Client) do(ctx context.Context, method, path string, body []byte, output any) error {
	digest := sha256.Sum256(body)
	binding := RequestBinding{Method: method, Path: path, ContentSHA256: hex.EncodeToString(digest[:])}
	credential, err := c.credentials.Credentials(ctx, binding)
	if err != nil {
		return fmt.Errorf("canonical credentials unavailable: %w", err)
	}
	if err := validateCredentials(credential); err != nil {
		return err
	}
	endpoint := *c.baseURL
	endpoint.Path = strings.TrimRight(endpoint.Path, "/") + path
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-App-Session", credential.AppSession)
	request.Header.Set("X-YNX-Session-ID", credential.SessionID)
	request.Header.Set("X-YNX-Device-ID", credential.DeviceID)
	request.Header.Set("X-YNX-Product", credential.Product)
	request.Header.Set("X-YNX-Bundle-ID", credential.BundleID)
	request.Header.Set("X-YNX-Request-ID", credential.RequestID)
	request.Header.Set("X-YNX-Request-Nonce", credential.RequestNonce)
	request.Header.Set("X-YNX-Timestamp", credential.RequestTime.UTC().Format(time.RFC3339Nano))
	request.Header.Set("X-YNX-Device-Signature", credential.DeviceSignature)
	request.Header.Set("X-YNX-Content-SHA256", binding.ContentSHA256)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("Data Fabric request failed: %w", err)
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, maxSDKResponseBytes+1)
	encoded, err := io.ReadAll(limited)
	if err != nil {
		return err
	}
	if len(encoded) > maxSDKResponseBytes {
		return errors.New("Data Fabric response exceeded the SDK limit")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct {
			Error   string `json:"error"`
			ErrorID string `json:"errorId"`
		}
		_ = json.Unmarshal(encoded, &failure)
		return fmt.Errorf("Data Fabric rejected the request: status=%d code=%s errorId=%s", response.StatusCode, failure.Error, failure.ErrorID)
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		return fmt.Errorf("invalid Data Fabric response: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("Data Fabric response contained multiple JSON values")
	}
	return nil
}

func validateCredentials(value CanonicalCredentials) error {
	fields := []string{value.AppSession, value.SessionID, value.DeviceID, value.Product, value.BundleID, value.RequestID, value.RequestNonce, value.DeviceSignature}
	for _, field := range fields {
		if strings.TrimSpace(field) == "" || len(field) > 4096 || strings.ContainsAny(field, "\r\n\t") {
			return errors.New("canonical credentials are incomplete or unsafe")
		}
	}
	if value.RequestTime.IsZero() || value.RequestTime.Location() != time.UTC {
		return errors.New("canonical request time must be UTC")
	}
	return nil
}

func sdkLoopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
