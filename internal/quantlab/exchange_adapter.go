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
	"strconv"
	"strings"
	"time"
)

const (
	ExchangeQuantAdapterVersion = "ynx-quant-execution-adapter-v2"
	maxExchangeResponseBytes    = 2 << 20
)

type exchangeQuantMandate struct {
	Subaccount          string    `json:"subaccount"`
	StrategyHash        string    `json:"strategyHash"`
	Market              string    `json:"market"`
	ProductID           string    `json:"productId"`
	BundleID            string    `json:"bundleId"`
	DeviceID            string    `json:"deviceId"`
	Scope               string    `json:"scope"`
	Methods             []string  `json:"methods"`
	Nonce               uint64    `json:"nonce"`
	MaxNotional         int64     `json:"maxNotional"`
	CapitalMicro        int64     `json:"capitalMicro"`
	MaxDailyLoss        int64     `json:"maxDailyLoss"`
	MaxSlippageBPS      int64     `json:"maxSlippageBps"`
	MaxGas              int64     `json:"maxGas"`
	MaxFrequency        int       `json:"maxOrdersPerMinute"`
	MaxLeverageBPS      int64     `json:"maxLeverageBps"`
	MaxDrawdown         int64     `json:"maxDrawdown"`
	MinLiquidity        int64     `json:"minLiquidity"`
	MaxVaR              int64     `json:"maxVar"`
	MaxES               int64     `json:"maxExpectedShortfall"`
	MaxDepegBPS         int64     `json:"maxDepegBps"`
	MaxConcentrationBPS int64     `json:"maxConcentrationBps"`
	MaxCancelRateBPS    int64     `json:"maxCancelRateBps"`
	MaxAPIFailures      int       `json:"maxConsecutiveApiFailures"`
	ExpiresAt           time.Time `json:"expiresAt"`
	NonceDomain         string    `json:"nonceDomain"`
	TestnetOnly         bool      `json:"testnetOnly"`
	WalletSignature     string    `json:"walletSignature"`
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

// HTTPExchangeAdapter is stateless. The caller supplies one fresh, one-time,
// Wallet-authenticated Quant Product Session proof for each request. It is never stored
// in Quant state, a mandate, an order, an audit record, or the adapter itself.
type HTTPExchangeAdapter struct {
	BaseURL string
	Client  *http.Client
}

func (a HTTPExchangeAdapter) CompleteWalletSession(ctx context.Context, body []byte) ([]byte, int, error) {
	base, err := url.Parse(strings.TrimSpace(a.BaseURL))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || len(body) < 2 || len(body) > 256<<10 {
		return nil, 0, ErrUnavailable
	}
	base.Path = strings.TrimRight(base.Path, "/") + "/v1/wallet/sessions/complete"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base.String(), bytes.NewReader(body))
	if err != nil {
		return nil, 0, ErrUnavailable
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, 0, ErrUnavailable
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxExchangeResponseBytes+1))
	if err != nil || len(data) > maxExchangeResponseBytes {
		return nil, 0, ErrUnavailable
	}
	return data, response.StatusCode, nil
}

func (a HTTPExchangeAdapter) VerifyMandate(ctx context.Context, mandate Mandate, productSessionProof string) error {
	var account exchangeAccountState
	if err := a.post(ctx, "/v1/quant-adapter/account", productSessionProof, map[string]any{"mandate": toExchangeMandate(mandate)}, &account); err != nil {
		return err
	}
	if account.Source.Version != ExchangeQuantAdapterVersion || account.Source.Status != "available" || strings.TrimSpace(account.Source.Source) == "" {
		return ErrUnavailable
	}
	return nil
}

func (a HTTPExchangeAdapter) SubmitTestnet(ctx context.Context, mandate Mandate, order TestnetOrder, productSessionProof string) (string, error) {
	request := exchangeOrderRequest{
		Market: order.Market, Side: order.Side, Type: "limit", TimeInForce: "gtc",
		PriceMicro: order.Price, AmountMicro: order.Amount, IdempotencyKey: order.IdempotencyKey,
		WalletSignature: strings.TrimSpace(order.WalletSignature),
	}
	if request.WalletSignature == "" {
		return "", ErrForbidden
	}
	var submitted exchangeOrderResponse
	if err := a.post(ctx, "/v1/quant-adapter/orders", productSessionProof, map[string]any{"mandate": toExchangeMandate(mandate), "order": request}, &submitted); err != nil {
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

func (a HTTPExchangeAdapter) post(ctx context.Context, path, productSessionProof string, body, result any) error {
	base, err := url.Parse(strings.TrimSpace(a.BaseURL))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || strings.TrimSpace(productSessionProof) == "" {
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
	request.Header.Set("X-YNX-Product-Session-Proof", strings.TrimSpace(productSessionProof))
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
		Subaccount: mandate.Account, StrategyHash: mandate.StrategyHash, Market: mandate.Market,
		ProductID: mandate.ProductID, BundleID: mandate.BundleID, DeviceID: mandate.DeviceID, Scope: mandate.Scope,
		Methods: []string{"read", "submit", "reconcile", "kill"}, Nonce: mandate.Nonce,
		MaxNotional: mandate.MaxNotional, CapitalMicro: mandate.MaxPosition, MaxDailyLoss: mandate.MaxDailyLoss,
		MaxSlippageBPS: mandate.MaxSlippageBPS, MaxGas: mandate.MaxGas, MaxFrequency: mandate.MaxOrdersPerMinute,
		MaxLeverageBPS: mandate.MaxLeverageBPS, MaxDrawdown: mandate.MaxDrawdown, MinLiquidity: mandate.MinLiquidity,
		MaxVaR: mandate.MaxVaR, MaxES: mandate.MaxExpectedShortfall, MaxDepegBPS: mandate.MaxDepegBPS,
		MaxConcentrationBPS: mandate.MaxConcentrationBPS, MaxCancelRateBPS: mandate.MaxCancelRateBPS,
		MaxAPIFailures: mandate.MaxConsecutiveAPIFailures, ExpiresAt: mandate.ExpiresAt,
		NonceDomain: mandate.NonceDomain, TestnetOnly: mandate.TestnetOnly, WalletSignature: mandate.WalletSignature,
	}
}

func ExchangeMandateSigningPayload(mandate Mandate) []byte {
	m := toExchangeMandate(mandate)
	methods := append([]string(nil), m.Methods...)
	sort.Strings(methods)
	return []byte(strings.Join([]string{
		ExchangeQuantAdapterVersion, m.Subaccount, m.StrategyHash, m.Market, m.ProductID, m.BundleID, m.DeviceID, m.Scope,
		strings.Join(methods, ","), strconv.FormatUint(m.Nonce, 10), strconv.FormatInt(m.MaxNotional, 10),
		strconv.FormatInt(m.CapitalMicro, 10), strconv.FormatInt(m.MaxDailyLoss, 10), strconv.FormatInt(m.MaxSlippageBPS, 10),
		strconv.FormatInt(m.MaxGas, 10), strconv.Itoa(m.MaxFrequency), strconv.FormatInt(m.MaxLeverageBPS, 10),
		strconv.FormatInt(m.MaxDrawdown, 10), strconv.FormatInt(m.MinLiquidity, 10), strconv.FormatInt(m.MaxVaR, 10),
		strconv.FormatInt(m.MaxES, 10), strconv.FormatInt(m.MaxDepegBPS, 10), strconv.FormatInt(m.MaxConcentrationBPS, 10),
		strconv.FormatInt(m.MaxCancelRateBPS, 10), strconv.Itoa(m.MaxAPIFailures), m.ExpiresAt.UTC().Format(time.RFC3339),
		m.NonceDomain, strconv.FormatBool(m.TestnetOnly),
	}, "\n"))
}

func ExchangeOrderSigningPayload(account string, order TestnetOrder) []byte {
	return []byte(fmt.Sprintf("ynx-exchange-order-v1\n%s\n%s\n%s\nlimit\n%d\n%d\n%s", strings.TrimSpace(account), order.Market, order.Side, order.Price, order.Amount, order.IdempotencyKey))
}

var _ MandateVerifier = HTTPExchangeAdapter{}
var _ TestnetBroker = HTTPExchangeAdapter{}
var _ WalletSessionCompleter = HTTPExchangeAdapter{}
