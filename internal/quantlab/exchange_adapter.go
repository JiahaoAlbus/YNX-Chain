package quantlab

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
	"sort"
	"strings"
	"time"
)

const (
	ExchangeQuantAdapterVersion = "ynx-quant-execution-adapter-v1"
	maxExchangeResponseBytes    = 2 << 20
)

type exchangeQuantMandate struct {
	Subaccount      string    `json:"subaccount"`
	Market          string    `json:"market"`
	Methods         []string  `json:"methods"`
	CapitalMicro    int64     `json:"capitalMicro"`
	Leverage        int64     `json:"leverage"`
	ExpiresAt       time.Time `json:"expiresAt"`
	NonceDomain     string    `json:"nonceDomain"`
	WalletSignature string    `json:"walletSignature"`
}

type exchangeSource struct {
	Source   string    `json:"source"`
	AsOf     time.Time `json:"asOf"`
	Version  string    `json:"version"`
	Coverage string    `json:"coverage"`
	Status   string    `json:"status"`
}

type exchangeAccountState struct {
	Source exchangeSource `json:"source"`
}

type exchangeOrderRequest struct {
	Market          string `json:"market"`
	Side            string `json:"side"`
	Type            string `json:"type"`
	TimeInForce     string `json:"timeInForce"`
	PriceMicro      int64  `json:"priceMicro"`
	AmountMicro     int64  `json:"amountMicro"`
	IdempotencyKey  string `json:"idempotencyKey"`
	WalletSignature string `json:"walletSignature"`
}

type exchangeOrderResponse struct {
	ID                  string `json:"id"`
	Account             string `json:"account"`
	Market              string `json:"market"`
	Side                string `json:"side"`
	PriceMicro          int64  `json:"priceMicro"`
	AmountMicro         int64  `json:"amountMicro"`
	Status              string `json:"status"`
	QuantNonceDomain    string `json:"quantNonceDomain"`
	WalletAuthorized    bool   `json:"walletAuthorized"`
	AuthorizationDigest string `json:"authorizationDigest"`
}

// HTTPExchangeAdapter is stateless. The caller supplies one short-lived,
// Wallet-authenticated Exchange session for each request. It is never stored
// in Quant state, a mandate, an order, an audit record, or the adapter itself.
type HTTPExchangeAdapter struct {
	BaseURL string
	Client  *http.Client
}

func (a HTTPExchangeAdapter) VerifyMandate(ctx context.Context, mandate Mandate, sessionToken string) error {
	var account exchangeAccountState
	if err := a.post(ctx, "/v1/quant-adapter/account", sessionToken, map[string]any{"mandate": toExchangeMandate(mandate)}, &account); err != nil {
		return err
	}
	if account.Source.Version != ExchangeQuantAdapterVersion || account.Source.Status != "available" || strings.TrimSpace(account.Source.Source) == "" {
		return ErrUnavailable
	}
	return nil
}

func (a HTTPExchangeAdapter) SubmitTestnet(ctx context.Context, mandate Mandate, order TestnetOrder, sessionToken string) (string, error) {
	request := exchangeOrderRequest{
		Market: order.Market, Side: order.Side, Type: "limit", TimeInForce: "gtc",
		PriceMicro: order.Price, AmountMicro: order.Amount, IdempotencyKey: order.IdempotencyKey,
		WalletSignature: strings.TrimSpace(order.WalletSignature),
	}
	if request.WalletSignature == "" {
		return "", ErrForbidden
	}
	var submitted exchangeOrderResponse
	if err := a.post(ctx, "/v1/quant-adapter/orders", sessionToken, map[string]any{"mandate": toExchangeMandate(mandate), "order": request}, &submitted); err != nil {
		return "", err
	}
	if submitted.ID == "" || submitted.Account != mandate.Account || submitted.Market != order.Market || submitted.Side != order.Side ||
		submitted.PriceMicro != order.Price || submitted.AmountMicro != order.Amount || submitted.QuantNonceDomain != mandate.NonceDomain ||
		!submitted.WalletAuthorized || len(submitted.AuthorizationDigest) != sha256.Size*2 || (submitted.Status != "open" && submitted.Status != "filled" && submitted.Status != "partially_filled") {
		return "", ErrUnavailable
	}
	if _, err := hex.DecodeString(submitted.AuthorizationDigest); err != nil {
		return "", ErrUnavailable
	}
	return hash(struct {
		Source, OrderID, AuthorizationDigest, Status string
	}{"ynx-exchange", submitted.ID, submitted.AuthorizationDigest, submitted.Status}), nil
}

func (a HTTPExchangeAdapter) post(ctx context.Context, path, sessionToken string, body, result any) error {
	base, err := url.Parse(strings.TrimSpace(a.BaseURL))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || strings.TrimSpace(sessionToken) == "" {
		return ErrUnavailable
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	payload, err := json.Marshal(body)
	if err != nil {
		return ErrInvalid
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), bytes.NewReader(payload))
	if err != nil {
		return ErrUnavailable
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(sessionToken))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return ErrUnavailable
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxExchangeResponseBytes+1))
	if err != nil || len(data) > maxExchangeResponseBytes {
		return ErrUnavailable
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		switch response.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			return ErrForbidden
		case http.StatusBadRequest, http.StatusConflict:
			return ErrConflict
		default:
			return ErrUnavailable
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if err := decoder.Decode(result); err != nil {
		return ErrUnavailable
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("exchange response framing: %w", ErrUnavailable)
	}
	return nil
}

func toExchangeMandate(mandate Mandate) exchangeQuantMandate {
	return exchangeQuantMandate{
		Subaccount: mandate.Account, Market: mandate.Market,
		Methods:      []string{"read", "submit", "reconcile", "kill"},
		CapitalMicro: mandate.MaxPosition, Leverage: 1, ExpiresAt: mandate.ExpiresAt,
		NonceDomain: mandate.NonceDomain, WalletSignature: mandate.WalletSignature,
	}
}

func ExchangeMandateSigningPayload(mandate Mandate) []byte {
	m := toExchangeMandate(mandate)
	methods := append([]string(nil), m.Methods...)
	sort.Strings(methods)
	return []byte(fmt.Sprintf("%s\n%s\n%s\n%s\n%d\n%d\n%s\n%s", ExchangeQuantAdapterVersion, m.Subaccount, m.Market, strings.Join(methods, ","), m.CapitalMicro, m.Leverage, m.ExpiresAt.UTC().Format(time.RFC3339), m.NonceDomain))
}

func ExchangeOrderSigningPayload(account string, order TestnetOrder) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-order-v1\n%s\n%s\n%s\nlimit\n%d\n%d\n%s", strings.TrimSpace(account), order.Market, order.Side, order.Price, order.Amount, order.IdempotencyKey))
}

var _ MandateVerifier = HTTPExchangeAdapter{}
var _ TestnetBroker = HTTPExchangeAdapter{}
