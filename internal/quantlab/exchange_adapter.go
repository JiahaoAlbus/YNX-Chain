package quantlab

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/exchangeproduct"
)

const maxExchangeResponseBytes = 2 << 20

// HTTPExchangeAdapter is the fail-closed bridge from Quant Lab to the
// authoritative Exchange Quant Execution Adapter. The session token must be a
// wallet-authenticated Exchange session with exchange:read and exchange:trade.
type HTTPExchangeAdapter struct {
	BaseURL string
	Client  *http.Client
}

func (a HTTPExchangeAdapter) VerifyMandate(m Mandate, sessionToken string) error {
	var account exchangeproduct.QuantAccountState
	if err := a.post("/v1/quant-adapter/account", sessionToken, map[string]any{"mandate": exchangeMandate(m)}, &account); err != nil {
		return err
	}
	if account.Source.Version != exchangeproduct.QuantAdapterVersion || account.Source.Status != "available" {
		return ErrUnavailable
	}
	return nil
}

func (a HTTPExchangeAdapter) SubmitTestnet(m Mandate, o TestnetOrder, sessionToken string) (string, error) {
	req := exchangeproduct.PlaceOrderRequest{
		Market:          o.Market,
		Side:            o.Side,
		Type:            "limit",
		TimeInForce:     "gtc",
		PriceMicro:      o.Price,
		AmountMicro:     o.Amount,
		IdempotencyKey:  o.IdempotencyKey,
		WalletSignature: o.WalletSignature,
	}
	var submitted exchangeproduct.Order
	if err := a.post("/v1/quant-adapter/orders", sessionToken, map[string]any{"mandate": exchangeMandate(m), "order": req}, &submitted); err != nil {
		return "", err
	}
	if submitted.ID == "" || submitted.Account != m.Account || submitted.Market != o.Market || submitted.Side != o.Side || submitted.PriceMicro != o.Price || submitted.AmountMicro != o.Amount || submitted.QuantNonceDomain != m.NonceDomain || !submitted.WalletAuthorized || submitted.AuthorizationDigest == "" {
		return "", ErrUnavailable
	}
	return hash(struct {
		Source, OrderID, AuthorizationDigest, Status string
	}{exchangeproduct.ProductID, submitted.ID, submitted.AuthorizationDigest, submitted.Status}), nil
}

func (a HTTPExchangeAdapter) post(path, sessionToken string, body, result any) error {
	base, err := url.Parse(strings.TrimSpace(a.BaseURL))
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Host == "" || base.User != nil || strings.TrimSpace(sessionToken) == "" {
		return ErrUnavailable
	}
	base.Path = strings.TrimRight(base.Path, "/") + path
	base.RawQuery = ""
	base.Fragment = ""
	payload, err := json.Marshal(body)
	if err != nil {
		return ErrInvalid
	}
	req, err := http.NewRequest(http.MethodPost, base.String(), bytes.NewReader(payload))
	if err != nil {
		return ErrUnavailable
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(sessionToken))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client := a.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return ErrUnavailable
	}
	defer resp.Body.Close()
	limited := io.LimitReader(resp.Body, maxExchangeResponseBytes+1)
	responseBody, err := io.ReadAll(limited)
	if err != nil || len(responseBody) > maxExchangeResponseBytes {
		return ErrUnavailable
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
			return ErrForbidden
		}
		if resp.StatusCode == http.StatusConflict || resp.StatusCode == http.StatusBadRequest {
			return ErrConflict
		}
		return ErrUnavailable
	}
	decoder := json.NewDecoder(bytes.NewReader(responseBody))
	if err := decoder.Decode(result); err != nil {
		return ErrUnavailable
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return fmt.Errorf("exchange response framing: %w", ErrUnavailable)
	}
	return nil
}
