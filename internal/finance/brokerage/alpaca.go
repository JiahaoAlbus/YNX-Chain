package brokerage

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Never return provider body, authorization headers, URLs containing credentials
// or transport errors to the browser/logs. Request IDs are bounded audit metadata.
type Error struct {
	Code       string
	RequestID  string
	HTTPStatus int
}

func (e *Error) Error() string { return e.Code }

var auditID = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type Asset struct {
	ID       string `json:"id"`
	Symbol   string `json:"symbol"`
	Name     string `json:"name"`
	Class    string `json:"class"`
	Status   string `json:"providerStatus"`
	Tradable bool   `json:"tradable"`
}
type AssetResult struct {
	Provider    string  `json:"provider"`
	Environment string  `json:"environment"`
	RequestID   string  `json:"requestId"`
	Assets      []Asset `json:"assets"`
}
type Account struct {
	ID        string `json:"providerAccountId"`
	Status    string `json:"providerStatus"`
	Currency  string `json:"currency"`
	RequestID string `json:"requestId"`
}

// Account IDs must be obtained from a persistent owner-checked mapping, never a
// browser-supplied provider ID or one global ACCOUNT_ID environment variable.
type AccountResolver interface {
	ResolveBrokerAccount(context.Context, string, string, string) (string, error)
}
type BrokerageAdapter interface {
	Capabilities() map[string]string
	Assets(context.Context) (AssetResult, error)
	Account(context.Context, string, AccountResolver) (Account, error)
}
type Alpaca struct {
	cfg     Config
	client  *http.Client
	mu      sync.Mutex
	token   string
	expires time.Time
}

func NewAlpaca(cfg Config) *Alpaca {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return &Alpaca{cfg: cfg, client: &http.Client{Timeout: 10 * time.Second, Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (a *Alpaca) Capabilities() map[string]string {
	return map[string]string{
		"assets": "implemented_read_only", "accountStatus": "requires_persistent_owner_mapping",
		"quotes": "unsupported_pending_market_data_entitlement", "submit": "disabled_pending_wallet_approval_and_order_journal",
		"cancel": "unsupported_pending_order_journal", "positions": "not_implemented", "cash": "not_implemented",
		"events": "not_implemented_sse_cursor_required", "reconciliation": "not_implemented", "live": "forbidden",
	}
}
func (a *Alpaca) exchange(ctx context.Context, req *http.Request, out any) (string, error) {
	req = req.WithContext(ctx)
	req.Header.Set("Accept", "application/json")
	res, err := a.client.Do(req)
	if err != nil {
		return "", &Error{Code: "PROVIDER_UNAVAILABLE"}
	}
	defer res.Body.Close()
	id := res.Header.Get("X-Request-ID")
	if !auditID.MatchString(id) {
		id = ""
	}
	if res.StatusCode != 200 {
		code := "PROVIDER_REJECTED"
		switch res.StatusCode {
		case 401:
			code = "AUTHENTICATION_FAILED"
		case 403:
			code = "PERMISSION_DENIED"
		case 429:
			code = "RATE_LIMITED"
		}
		return id, &Error{Code: code, RequestID: id, HTTPStatus: res.StatusCode}
	}
	typ, _, err := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if err != nil || typ != "application/json" {
		return id, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	data, err := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if err != nil || len(data) > 4<<20 || json.Unmarshal(data, out) != nil {
		return id, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	return id, nil
}
func (a *Alpaca) authorize(ctx context.Context, req *http.Request) error {
	if !a.cfg.ready() {
		return &Error{Code: "BROKER_NOT_CONFIGURED"}
	}
	if a.cfg.authMode == "legacy_basic" {
		req.SetBasicAuth(a.cfg.key, a.cfg.secret)
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.token == "" || time.Now().Add(30*time.Second).After(a.expires) {
		form := url.Values{"grant_type": {"client_credentials"}, "client_id": {a.cfg.key}, "client_secret": {a.cfg.secret}}
		tokenReq, _ := http.NewRequest(http.MethodPost, TokenURL, strings.NewReader(form.Encode()))
		tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		var token struct {
			AccessToken string `json:"access_token"`
			ExpiresIn   int    `json:"expires_in"`
			TokenType   string `json:"token_type"`
		}
		started := time.Now()
		if _, err := a.exchange(ctx, tokenReq, &token); err != nil {
			return err
		}
		if token.TokenType != "Bearer" || token.ExpiresIn <= 30 || token.ExpiresIn > 3600 || len(token.AccessToken) == 0 || len(token.AccessToken) > 16384 || strings.ContainsAny(token.AccessToken, " \t\r\n\x00") {
			return &Error{Code: "TOKEN_PROTOCOL_ERROR"}
		}
		a.token = token.AccessToken
		a.expires = started.Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	return nil
}
func (a *Alpaca) get(ctx context.Context, path string, out any) (string, error) {
	req, _ := http.NewRequest(http.MethodGet, BrokerOrigin+path, nil)
	if err := a.authorize(ctx, req); err != nil {
		return "", err
	}
	return a.exchange(ctx, req, out)
}
func (a *Alpaca) Assets(ctx context.Context) (AssetResult, error) {
	var raw []struct {
		ID       string `json:"id"`
		Symbol   string `json:"symbol"`
		Name     string `json:"name"`
		Class    string `json:"class"`
		Status   string `json:"status"`
		Tradable bool   `json:"tradable"`
	}
	id, err := a.get(ctx, "/v1/assets?status=active&asset_class=us_equity", &raw)
	if err != nil {
		return AssetResult{}, err
	}
	result := AssetResult{Provider: Provider, Environment: "sandbox", RequestID: id, Assets: []Asset{}}
	if raw == nil {
		return result, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	seen := map[string]bool{}
	for _, r := range raw {
		if !uuid.MatchString(r.ID) || r.Symbol == "" || len(r.Symbol) > 32 || r.Name == "" || r.Class != "us_equity" || r.Status != "active" || seen[r.ID] {
			return AssetResult{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
		}
		seen[r.ID] = true
		result.Assets = append(result.Assets, Asset{r.ID, r.Symbol, r.Name, r.Class, r.Status, r.Tradable})
	}
	return result, nil
}
func (a *Alpaca) Account(ctx context.Context, owner string, resolver AccountResolver) (Account, error) {
	if !a.cfg.ready() {
		return Account{}, &Error{Code: "BROKER_NOT_CONFIGURED"}
	}
	if owner == "" || resolver == nil {
		return Account{}, &Error{Code: "ACCOUNT_NOT_LINKED"}
	}
	account, err := resolver.ResolveBrokerAccount(ctx, owner, Provider, "sandbox")
	if err != nil || !uuid.MatchString(account) {
		return Account{}, &Error{Code: "ACCOUNT_NOT_LINKED"}
	}
	var raw struct {
		ID       string `json:"id"`
		Status   string `json:"status"`
		Currency string `json:"currency"`
	}
	id, err := a.get(ctx, "/v1/accounts/"+account, &raw)
	if err != nil {
		return Account{}, err
	}
	if raw.ID != account || raw.Status == "" || raw.Currency != "USD" {
		return Account{}, &Error{Code: "PROVIDER_PROTOCOL_ERROR", RequestID: id}
	}
	return Account{raw.ID, raw.Status, raw.Currency, id}, nil
}
func ErrorCode(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return "BROKER_CHECK_FAILED"
}
