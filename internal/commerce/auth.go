package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const (
	ShopClientID     = "ynx-shop-v1"
	ShopBundleID     = "com.ynxweb4.shop"
	ShopCallback     = "ynxshop://wallet-auth/callback"
	SellerClientID   = "ynx-seller-v1"
	SellerBundleID   = "com.ynxweb4.seller-console"
	SellerCallback   = "ynxseller://wallet-auth/callback"
	DeviceAlgorithm  = "p256-sha256"
	GatewayChainID   = "ynx_6423-1"
	gatewayMaxBody   = 1 << 20
	gatewayUserAgent = "ynx-shopd/1"
)

var (
	ShopScopes   = []string{"account:read", "shop:orders:write", "shop:profile:write"}
	SellerScopes = []string{"account:read", "shop:seller:operate"}
)

type ProductBinding struct {
	RequestingProduct, ProductClientID, BundleID, Callback, Role string
	Scopes                                                       []string
}

func ShopBinding() ProductBinding {
	return ProductBinding{"shop", ShopClientID, ShopBundleID, ShopCallback, "buyer", append([]string(nil), ShopScopes...)}
}
func SellerBinding() ProductBinding {
	return ProductBinding{"shop-seller", SellerClientID, SellerBundleID, SellerCallback, "seller", append([]string(nil), SellerScopes...)}
}

type Principal struct {
	Account, Role, ProductClientID, BundleID, SessionBinding string
	Scopes                                                   []string
	ExpiresAt                                                time.Time
}

func (p Principal) HasScope(scope string) bool {
	for _, candidate := range p.Scopes {
		if candidate == scope {
			return true
		}
	}
	return false
}

type AuthGateway interface {
	Available() bool
	Verify(context.Context, string) (Principal, error)
	Begin(context.Context, json.RawMessage) (json.RawMessage, error)
	Complete(context.Context, json.RawMessage) (json.RawMessage, error)
}

// HTTPAuthGateway is a fail-closed adapter for the accepted Wallet Auth v1
// product-session boundary. It never stores or logs the opaque bearer token.
// The central Gateway owns Wallet approval verification, one-time replay state,
// P-256 device proof verification, revocation and session expiry.
type HTTPAuthGateway struct {
	BaseURL, ServiceKey string
	Client              *http.Client
}

func (g HTTPAuthGateway) Available() bool { return strings.TrimSpace(g.BaseURL) != "" }

func (g HTTPAuthGateway) Verify(ctx context.Context, token string) (Principal, error) {
	if !g.Available() {
		return Principal{}, fmt.Errorf("%w: central Wallet Gateway is not configured", ErrUnavailable)
	}
	if len(token) < 24 || len(token) > 4096 || strings.ContainsAny(token, "\r\n") {
		return Principal{}, ErrUnauthorized
	}
	req, err := g.request(ctx, http.MethodPost, "/v1/product-sessions/introspect", nil)
	if err != nil {
		return Principal{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := g.client().Do(req)
	if err != nil {
		return Principal{}, fmt.Errorf("%w: central Wallet Gateway request failed", ErrUnavailable)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return Principal{}, ErrUnauthorized
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Principal{}, fmt.Errorf("%w: central Wallet Gateway returned %d", ErrUnavailable, resp.StatusCode)
	}
	var raw struct {
		Active          bool     `json:"active"`
		SessionBinding  string   `json:"sessionBinding"`
		ProductClientID string   `json:"productClientId"`
		BundleID        string   `json:"bundleId"`
		Account         string   `json:"account"`
		Scopes          []string `json:"scopes"`
		ExpiresAt       string   `json:"expiresAt"`
	}
	if err := decodeExact(resp.Body, &raw); err != nil {
		return Principal{}, fmt.Errorf("central Wallet Gateway response invalid: %w", err)
	}
	if !raw.Active || !consensus.IsNativeAddress(raw.Account) || len(raw.SessionBinding) != 64 {
		return Principal{}, ErrUnauthorized
	}
	expires, err := time.Parse(time.RFC3339Nano, raw.ExpiresAt)
	if err != nil || !expires.After(time.Now().UTC()) {
		return Principal{}, ErrUnauthorized
	}
	binding, ok := bindingFor(raw.ProductClientID)
	if !ok || raw.BundleID != binding.BundleID || !exactScopes(raw.Scopes, binding.Scopes) {
		return Principal{}, ErrUnauthorized
	}
	return Principal{Account: raw.Account, Role: binding.Role, ProductClientID: raw.ProductClientID, BundleID: raw.BundleID, SessionBinding: raw.SessionBinding, Scopes: append([]string(nil), raw.Scopes...), ExpiresAt: expires}, nil
}

func (g HTTPAuthGateway) Begin(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return g.forward(ctx, "/v1/product-sessions/challenges", body)
}
func (g HTTPAuthGateway) Complete(ctx context.Context, body json.RawMessage) (json.RawMessage, error) {
	return g.forward(ctx, "/v1/product-sessions", body)
}

func (g HTTPAuthGateway) forward(ctx context.Context, path string, body json.RawMessage) (json.RawMessage, error) {
	if !g.Available() {
		return nil, fmt.Errorf("%w: central Wallet Gateway is not configured", ErrUnavailable)
	}
	if len(body) == 0 || len(body) > gatewayMaxBody || !json.Valid(body) {
		return nil, errors.New("canonical Wallet Gateway JSON required")
	}
	req, err := g.request(ctx, http.MethodPost, path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.client().Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: central Wallet Gateway request failed", ErrUnavailable)
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, gatewayMaxBody+1))
	if readErr != nil || len(data) > gatewayMaxBody || !json.Valid(data) {
		return nil, fmt.Errorf("%w: central Wallet Gateway returned invalid JSON", ErrUnavailable)
	}
	if resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusGone {
		return nil, fmt.Errorf("%w: Wallet approval or device challenge replay rejected", ErrConflict)
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusBadRequest {
		return nil, fmt.Errorf("%w: central Wallet Gateway rejected the bound request", ErrUnauthorized)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%w: central Wallet Gateway returned %d", ErrUnavailable, resp.StatusCode)
	}
	return json.RawMessage(data), nil
}

func (g HTTPAuthGateway) request(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	base, err := url.Parse(strings.TrimRight(g.BaseURL, "/"))
	if err != nil || (base.Scheme != "https" && base.Hostname() != "127.0.0.1" && base.Hostname() != "localhost") {
		return nil, fmt.Errorf("%w: central Wallet Gateway URL must use HTTPS", ErrUnavailable)
	}
	req, err := http.NewRequestWithContext(ctx, method, base.String()+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", gatewayUserAgent)
	if g.ServiceKey != "" {
		req.Header.Set("X-YNX-Product-Key", g.ServiceKey)
	}
	return req, nil
}
func (g HTTPAuthGateway) client() *http.Client {
	if g.Client != nil {
		return g.Client
	}
	return &http.Client{Timeout: 8 * time.Second}
}

func bindingFor(clientID string) (ProductBinding, bool) {
	for _, binding := range []ProductBinding{ShopBinding(), SellerBinding()} {
		if binding.ProductClientID == clientID {
			return binding, true
		}
	}
	return ProductBinding{}, false
}
func exactScopes(actual, expected []string) bool {
	if len(actual) != len(expected) || !sort.StringsAreSorted(actual) {
		return false
	}
	for i := range expected {
		if actual[i] != expected[i] {
			return false
		}
	}
	return true
}
func decodeExact(reader io.Reader, out any) error {
	decoder := json.NewDecoder(io.LimitReader(reader, gatewayMaxBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("single JSON object required")
	}
	return nil
}
