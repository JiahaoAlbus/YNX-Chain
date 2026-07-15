package finance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

type Upstreams struct {
	ExplorerURL string
	PayURL      string
	PayAPIKey   string
	DisputeBase string
	client      *http.Client
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
	portfolio := Portfolio{Account: account, Network: ChainID, Symbol: "YNXT", Activity: []Activity{}, PayReceipts: []PayReceipt{}, ReadOnly: true, AsOf: time.Now().UTC(), ExplorerStatus: SourceStatus{Source: u.ExplorerURL, Coverage: "account balance plus latest 100 indexed transactions filtered to the authorized account"}, PayStatus: SourceStatus{Source: u.PayURL, Coverage: "Pay events returned by the configured authorized Pay API, filtered to the authorized account"}}
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
	if u.PayURL == "" {
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
	for _, raw := range payPayload.Events {
		var event map[string]any
		if json.Unmarshal(raw, &event) != nil || !eventOwnedBy(event, account) {
			continue
		}
		portfolio.PayReceipts = append(portfolio.PayReceipts, u.receipt(event))
	}
	portfolio.PayStatus.Available = true
	return portfolio
}

func (u *Upstreams) receipt(event map[string]any) PayReceipt {
	id := firstString(event, "id", "eventId", "invoiceId")
	receipt := PayReceipt{ID: id, Status: firstString(event, "status", "type"), Payer: firstString(event, "payer", "buyer", "signer", "from"), Merchant: firstString(event, "merchant", "seller", "to"), AmountYNXT: firstInt64(event, "amountYnxt", "amount"), TransactionHash: firstString(event, "transactionHash", "txHash", "settlementHash"), CreatedAt: firstTime(event, "createdAt", "timestamp", "settledAt"), TruthfulStatus: "pay-api-record"}
	if receipt.TransactionHash != "" {
		receipt.TruthfulStatus = "pay-api-record-with-chain-reference"
	}
	if u.DisputeBase != "" && id != "" {
		receipt.DisputeURL = u.DisputeBase + "/" + url.PathEscape(id)
	}
	return receipt
}

func (u *Upstreams) get(ctx context.Context, endpoint, payKey string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	if payKey != "" {
		req.Header.Set("X-YNX-Pay-Key", payKey)
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return fmt.Errorf("upstream unavailable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("upstream returned HTTP %d", resp.StatusCode)
	}
	dec := json.NewDecoder(resp.Body)
	if err := dec.Decode(out); err != nil {
		return fmt.Errorf("invalid upstream response: %w", err)
	}
	return nil
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

func firstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key].(string); ok {
			return value
		}
	}
	return ""
}

func firstInt64(m map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := m[key].(type) {
		case float64:
			return int64(value)
		case string:
			parsed, _ := strconv.ParseInt(value, 10, 64)
			return parsed
		}
	}
	return 0
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
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("absolute http(s) URL required")
	}
	return parsed, nil
}
