package finance

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Upstreams struct {
	ExplorerURL       string
	PayURL            string
	PayAPIKey         string
	DisputeBase       string
	client            *http.Client
	readSourceActions map[string]string
	readIntegrations  map[string]readSourceIntegration
}

func NewUpstreams(explorerURL, payURL, payAPIKey, disputeBase string) (*Upstreams, error) {
	if _, err := requireHTTPURL(explorerURL); err != nil {
		return nil, fmt.Errorf("explorer URL: %w", err)
	}
	if strings.TrimSpace(payURL) != "" {
		if _, err := requireHTTPURL(payURL); err != nil {
			return nil, fmt.Errorf("Pay URL: %w", err)
		}
		if strings.TrimSpace(payAPIKey) == "" {
			return nil, errors.New("Pay API key is required when Pay URL is configured")
		}
	}
	return &Upstreams{ExplorerURL: strings.TrimRight(explorerURL, "/"), PayURL: strings.TrimRight(payURL, "/"), PayAPIKey: payAPIKey, DisputeBase: strings.TrimRight(disputeBase, "/"), client: &http.Client{Timeout: 8 * time.Second}}, nil
}

func (u *Upstreams) Portfolio(ctx context.Context, account string, classifications map[string]Classification) Portfolio {
	observedAt := time.Now().UTC()
	portfolio := Portfolio{
		Account:     account,
		Network:     ChainID,
		Symbol:      "YNXT",
		Activity:    []Activity{},
		PayReceipts: []PayReceipt{},
		ReadOnly:    true,
		AsOf:        observedAt,
		ExplorerStatus: SourceStatus{
			Source:     u.ExplorerURL,
			Coverage:   "account balance plus latest 100 indexed transactions filtered to the authorized account",
			SyncStatus: "unavailable",
		},
		PayStatus: SourceStatus{
			Source:     u.PayURL,
			Version:    "finance-pay-events-v1",
			Coverage:   "Pay events returned by the configured authorized Pay API, filtered to the authorized account",
			SyncStatus: "unavailable",
		},
		ReadSources: u.ReadSourcesForAccount(ctx, account, observedAt),
	}
	var health struct {
		OK             bool      `json:"ok"`
		RPCHeight      uint64    `json:"rpcHeight"`
		IndexedHeight  uint64    `json:"indexedHeight"`
		SyncLagBlocks  uint64    `json:"syncLagBlocks"`
		NativeSymbol   string    `json:"nativeSymbol"`
		TruthfulStatus string    `json:"truthfulStatus"`
		LastCheckedAt  time.Time `json:"lastCheckedAt"`
		Build          struct {
			Commit  string `json:"commit"`
			Release string `json:"release"`
		} `json:"build"`
	}
	if err := u.get(ctx, u.ExplorerURL+"/health", "", &health); err != nil {
		portfolio.ExplorerStatus.Error = "Explorer health unavailable: " + err.Error()
	} else if !health.OK || health.NativeSymbol != "YNXT" {
		portfolio.ExplorerStatus.Error = "Explorer health failed network or native-asset validation"
	} else {
		asOf := health.LastCheckedAt
		if asOf.IsZero() {
			asOf = observedAt
			portfolio.ExplorerStatus.AsOfKind = "finance-response-observed-at"
		} else {
			portfolio.ExplorerStatus.AsOfKind = "explorer-last-checked-at"
		}
		portfolio.ExplorerStatus.AsOf = &asOf
		portfolio.ExplorerStatus.Version = firstNonEmpty(health.Build.Release, health.Build.Commit, "explorer-health-v1")
		portfolio.ExplorerStatus.SyncStatus = firstNonEmpty(health.TruthfulStatus, "health-validated")
		portfolio.ExplorerStatus.RPCHeight = health.RPCHeight
		portfolio.ExplorerStatus.IndexedHeight = health.IndexedHeight
		portfolio.ExplorerStatus.SyncLagBlocks = health.SyncLagBlocks

		var accountDetail struct {
			Account chain.Account `json:"account"`
		}
		if err := u.get(ctx, u.ExplorerURL+"/api/accounts/"+url.PathEscape(account), "", &accountDetail); err != nil {
			portfolio.ExplorerStatus.Error = err.Error()
		} else if accountDetail.Account.Address == "" {
			portfolio.ExplorerStatus.Error = "Explorer returned no account evidence"
		} else if !sameAccount(accountDetail.Account.Address, account) {
			portfolio.ExplorerStatus.Error = "Explorer returned evidence for a different account"
		} else {
			portfolio.BalanceYNXT = accountDetail.Account.Balance
			portfolio.StakedYNXT = accountDetail.Account.Staked
			var txPayload struct {
				Transactions []chain.Transaction `json:"transactions"`
			}
			if err := u.get(ctx, u.ExplorerURL+"/api/txs?limit=100", "", &txPayload); err != nil {
				portfolio.ExplorerStatus.SyncStatus = "partial-account-only"
				portfolio.ExplorerStatus.Error = "account loaded but activity unavailable: " + err.Error()
			} else {
				for _, tx := range txPayload.Transactions {
					if tx.From != account && tx.To != account {
						continue
					}
					direction := "incoming"
					if tx.From == account {
						direction = "outgoing"
					}
					activity := Activity{ID: tx.Hash, Type: tx.Type, Direction: direction, From: tx.From, To: tx.To, Amount: tx.Amount, Fee: tx.Fee, Timestamp: tx.Timestamp, Block: tx.BlockNum, Source: "ynx-explorerd:indexed-transaction"}
					if c, ok := classifications[tx.Hash]; ok {
						activity.Category = c.CategoryID
					}
					portfolio.Activity = append(portfolio.Activity, activity)
				}
				portfolio.ExplorerStatus.Available = true
			}
		}
	}
	if u.PayURL == "" {
		portfolio.PayStatus.SyncStatus = "not-configured"
		portfolio.PayStatus.Error = "Pay receipt source is not configured"
		return portfolio
	}
	var payPayload struct {
		Events []json.RawMessage `json:"events"`
	}
	if err := u.get(ctx, u.PayURL+"/pay/events?limit=200", u.PayAPIKey, &payPayload); err != nil {
		portfolio.PayStatus.Error = err.Error()
		return portfolio
	}
	invalidOwnedAmount := false
	for _, raw := range payPayload.Events {
		var event map[string]any
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.UseNumber()
		if decoder.Decode(&event) != nil || !eventOwnedBy(event, account) {
			continue
		}
		receipt, err := u.receipt(event)
		if err != nil {
			invalidOwnedAmount = true
			continue
		}
		portfolio.PayReceipts = append(portfolio.PayReceipts, receipt)
	}
	payAsOf := observedAt
	portfolio.PayStatus.AsOf = &payAsOf
	portfolio.PayStatus.AsOfKind = "finance-response-observed-at"
	portfolio.PayStatus.SyncStatus = "authorized-response"
	portfolio.PayStatus.Available = true
	if invalidOwnedAmount {
		portfolio.PayStatus.Available = false
		portfolio.PayStatus.SyncStatus = "partial-invalid-records"
		portfolio.PayStatus.Error = "Pay returned an owned record without an exact integer amount"
	}
	return portfolio
}

func (u *Upstreams) receipt(event map[string]any) (PayReceipt, error) {
	amount, err := firstInt64(event, "amountYnxt", "amount")
	if err != nil {
		return PayReceipt{}, err
	}
	id := firstString(event, "id", "eventId", "invoiceId")
	receipt := PayReceipt{ID: id, Status: firstString(event, "status", "type"), Payer: firstString(event, "payer", "buyer", "signer", "from"), Merchant: firstString(event, "merchant", "seller", "to"), AmountYNXT: amount, TransactionHash: firstString(event, "transactionHash", "txHash", "settlementHash"), CreatedAt: firstTime(event, "createdAt", "timestamp", "settledAt"), TruthfulStatus: "pay-api-record"}
	if receipt.TransactionHash != "" {
		receipt.TruthfulStatus = "pay-api-record-with-chain-reference"
	}
	if u.DisputeBase != "" && id != "" {
		receipt.DisputeURL = u.DisputeBase + "/" + url.PathEscape(id)
	}
	return receipt, nil
}

func (u *Upstreams) get(ctx context.Context, endpoint, payKey string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	if payKey != "" {
		req.Header.Set("X-YNX-Pay-Key", payKey)
	}
	resp, err := financeReadClient(u.client).Do(req)
	if err != nil {
		return fmt.Errorf("upstream unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxReadSourceEnvelopeBytes+1))
	if err != nil || len(body) > maxReadSourceEnvelopeBytes {
		return errors.New("upstream response exceeds or fails the Finance evidence limit")
	}
	if trimmed := bytes.TrimSpace(body); len(trimmed) == 0 || trimmed[0] != '{' {
		return errors.New("upstream evidence must be a JSON object")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	if err := dec.Decode(out); err != nil {
		return fmt.Errorf("invalid upstream response: %w", err)
	}
	if err := dec.Decode(&struct{}{}); err != io.EOF {
		return errors.New("upstream response must contain one JSON document")
	}
	return nil
}

// Keep authenticated evidence at its configured origin/path. Clone rather
// than mutating an injected client shared with other product consumers.
func financeReadClient(supplied *http.Client) *http.Client {
	client := http.Client{Timeout: 8 * time.Second}
	if supplied != nil {
		client = *supplied
	}
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	return &client
}

func eventOwnedBy(event map[string]any, account string) bool {
	for _, key := range []string{"account", "signer", "payer", "buyer", "merchant", "seller", "from", "to"} {
		if value, ok := event[key].(string); ok && (value == account || sameAccount(value, account)) {
			return true
		}
	}
	return false
}

func sameAccount(left, right string) bool {
	l, err := accountaddress.Normalize(left)
	if err != nil {
		return false
	}
	r, err := accountaddress.Normalize(right)
	return err == nil && l == r
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok {
			return value
		}
	}
	return ""
}

func firstInt64(m map[string]any, keys ...string) (int64, error) {
	for _, key := range keys {
		value, present := m[key]
		if !present {
			continue
		}
		switch value := value.(type) {
		case json.Number:
			return value.Int64()
		case string:
			return strconv.ParseInt(value, 10, 64)
		default:
			return 0, errors.New("exact integer amount required")
		}
	}
	return 0, errors.New("integer amount missing")
}

func firstTime(m map[string]any, keys ...string) time.Time {
	for _, key := range keys {
		if value, ok := m[key].(string); ok {
			parsed, _ := time.Parse(time.RFC3339, value)
			if !parsed.IsZero() {
				return parsed
			}
		}
	}
	return time.Time{}
}

func requireHTTPURL(value string) (*url.URL, error) {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.ForceQuery || parsed.RawQuery != "" || strings.Contains(value, "#") {
		return nil, errors.New("absolute http(s) base URL without credentials, query or fragment required")
	}
	return parsed, nil
}
