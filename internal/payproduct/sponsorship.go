package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var (
	hash32Pattern     = regexp.MustCompile(`^(0x)?[0-9a-f]{64}$`)
	evmAddressPattern = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
)

type SponsorPolicy struct {
	Sponsor                string
	DailyBudget            int64
	PerUserDailyBudget     int64
	PerMerchantDailyBudget int64
	MaximumQuoteLifetime   time.Duration
}

func (p SponsorPolicy) validate() error {
	if !identifierRE.MatchString(strings.TrimSpace(p.Sponsor)) || p.DailyBudget <= 0 || p.PerUserDailyBudget <= 0 || p.PerMerchantDailyBudget <= 0 {
		return errors.New("sponsor identity and positive global, user, and merchant budgets are required")
	}
	if p.MaximumQuoteLifetime <= 0 || p.MaximumQuoteLifetime > 5*time.Minute {
		return errors.New("sponsorship quote lifetime must be positive and no more than five minutes")
	}
	return nil
}

type SponsorQuoteRequest struct {
	ChainID      string `json:"chainId"`
	InvoiceID    string `json:"invoiceId"`
	Account      string `json:"account"`
	DeviceID     string `json:"deviceId"`
	SmartAccount string `json:"smartAccount"`
	MerchantID   string `json:"merchantId"`
	Payee        string `json:"payee"`
	Asset        string `json:"asset"`
	Amount       int64  `json:"amount"`
	Mode         string `json:"mode"`
	CallDataHash string `json:"callDataHash"`
	Attribution  string `json:"attribution"`
}

type ProviderSponsorQuote struct {
	ID                 string    `json:"id"`
	ChainID            string    `json:"chainId"`
	Account            string    `json:"account"`
	SmartAccount       string    `json:"smartAccount"`
	Paymaster          string    `json:"paymaster"`
	CallDataHash       string    `json:"callDataHash"`
	MaximumSponsorCost int64     `json:"maximumSponsorCost"`
	IssuedAt           time.Time `json:"issuedAt"`
	ExpiresAt          time.Time `json:"expiresAt"`
	Source             string    `json:"source"`
	SourceVersion      int       `json:"sourceVersion"`
}

type SponsorshipProvider interface {
	Quote(context.Context, SponsorQuoteRequest) (ProviderSponsorQuote, error)
	Receipt(context.Context, string) (UserOperationReceipt, error)
}

type SponsorshipInput struct {
	SmartAccount   string `json:"smartAccount"`
	Mode           string `json:"mode"`
	CallDataHash   string `json:"callDataHash"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) RequestSponsorship(ctx context.Context, session WalletSession, invoiceID string, input SponsorshipInput) (SponsorshipQuote, error) {
	if s.sponsorship == nil {
		return SponsorshipQuote{}, errors.New("sponsorship provider is unavailable")
	}
	s.mutation.Lock()
	defer s.mutation.Unlock()
	if session.DeviceID == "" {
		return SponsorshipQuote{}, errors.New("device-bound Wallet session is required")
	}
	smartAccount, err := nativewallet.NormalizeNativeAddress(strings.TrimSpace(input.SmartAccount))
	if err != nil {
		return SponsorshipQuote{}, errors.New("smart account is invalid")
	}
	mode := strings.TrimSpace(input.Mode)
	if mode != "first-payment" && mode != "merchant-sponsored" {
		return SponsorshipQuote{}, errors.New("unsupported sponsorship mode")
	}
	callDataHash := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(input.CallDataHash)), "0x")
	if !hash32Pattern.MatchString(callDataHash) {
		return SponsorshipQuote{}, errors.New("sponsorship call data hash is invalid")
	}
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return SponsorshipQuote{}, err
	}
	invoice, err := s.Invoice(ctx, invoiceID)
	if err != nil {
		return SponsorshipQuote{}, err
	}
	if invoice.Status != "pending" || !s.now().Before(invoice.ExpiresAt) {
		return SponsorshipQuote{}, errors.New("only a pending unexpired invoice can be sponsored")
	}
	requestHash := hashJSON(input)
	var existing SponsorshipQuote
	var found bool
	var globalUsed, userUsed, merchantUsed int64
	var activeFirstPaymentQuote bool
	dayStart := s.now().UTC().Truncate(24 * time.Hour)
	err = s.store.View(func(data Snapshot) error {
		if idem, ok := data.Idempotency["sponsorship:"+session.Account+":"+key]; ok {
			if idem.RequestHash != requestHash || idem.ObjectID == "" {
				return errors.New("sponsorship idempotency key was reused with different input")
			}
			existing, found = data.Sponsorships[idem.ObjectID]
			return nil
		}
		if mode == "first-payment" {
			for _, candidate := range data.Invoices {
				if candidate.Settlement != nil && candidate.Settlement.Payer == session.Account {
					return errors.New("first-payment sponsorship is no longer eligible")
				}
			}
		}
		for _, q := range data.Sponsorships {
			if q.IssuedAt.Before(dayStart) || (q.Status != "issued" && q.Status != "confirmed") {
				continue
			}
			globalUsed += q.MaximumSponsorCost
			if q.Account == session.Account || q.DeviceID == session.DeviceID {
				userUsed += q.MaximumSponsorCost
				if q.Mode == "first-payment" {
					activeFirstPaymentQuote = true
				}
			}
			if q.MerchantID == invoice.MerchantID {
				merchantUsed += q.MaximumSponsorCost
			}
		}
		return nil
	})
	if err != nil || found {
		return existing, err
	}
	if mode == "first-payment" && activeFirstPaymentQuote {
		return SponsorshipQuote{}, errors.New("first-payment sponsorship was already issued for this account or device")
	}
	if globalUsed >= s.sponsorPolicy.DailyBudget || userUsed >= s.sponsorPolicy.PerUserDailyBudget || merchantUsed >= s.sponsorPolicy.PerMerchantDailyBudget {
		return SponsorshipQuote{}, errors.New("sponsorship budget exhausted")
	}
	attribution := strings.Join([]string{s.sponsorPolicy.Sponsor, mode, invoice.MerchantID, session.Account, session.DeviceID}, ":")
	provider, err := s.sponsorship.Quote(ctx, SponsorQuoteRequest{ChainID: ChainID, InvoiceID: invoice.ID, Account: session.Account, DeviceID: session.DeviceID, SmartAccount: smartAccount, MerchantID: invoice.MerchantID, Payee: invoice.PayoutAddress, Asset: invoice.Asset, Amount: invoice.Amount, Mode: mode, CallDataHash: callDataHash, Attribution: attribution})
	if err != nil {
		return SponsorshipQuote{}, fmt.Errorf("sponsorship provider unavailable: %w", err)
	}
	now := s.now().UTC()
	if !identifierRE.MatchString(provider.ID) || provider.ChainID != ChainID || provider.Account != session.Account || provider.SmartAccount != smartAccount || !evmAddressPattern.MatchString(strings.ToLower(provider.Paymaster)) || strings.TrimPrefix(strings.ToLower(provider.CallDataHash), "0x") != callDataHash || provider.MaximumSponsorCost <= 0 || provider.IssuedAt.After(now.Add(30*time.Second)) || !provider.ExpiresAt.After(now) || provider.ExpiresAt.Sub(provider.IssuedAt) > s.sponsorPolicy.MaximumQuoteLifetime || strings.TrimSpace(provider.Source) == "" || provider.SourceVersion <= 0 {
		return SponsorshipQuote{}, errors.New("sponsorship provider returned an invalid or mismatched quote")
	}
	if globalUsed+provider.MaximumSponsorCost > s.sponsorPolicy.DailyBudget || userUsed+provider.MaximumSponsorCost > s.sponsorPolicy.PerUserDailyBudget || merchantUsed+provider.MaximumSponsorCost > s.sponsorPolicy.PerMerchantDailyBudget {
		return SponsorshipQuote{}, errors.New("sponsorship budget exhausted")
	}
	quote := SponsorshipQuote{ID: provider.ID, InvoiceID: invoice.ID, MerchantID: invoice.MerchantID, Account: session.Account, DeviceID: session.DeviceID, SmartAccount: smartAccount, Mode: mode, Asset: invoice.Asset, Paymaster: strings.ToLower(provider.Paymaster), CallDataHash: callDataHash, MaximumSponsorCost: provider.MaximumSponsorCost, Sponsor: s.sponsorPolicy.Sponsor, Attribution: attribution, Status: "issued", IssuedAt: provider.IssuedAt.UTC(), ExpiresAt: provider.ExpiresAt.UTC(), Source: provider.Source, SourceAsOf: provider.IssuedAt.UTC(), SourceVersion: provider.SourceVersion}
	err = s.idempotentUpdate("sponsorship", session.Account, key, requestHash, quote.ID, func(data *Snapshot) error {
		if _, exists := data.Sponsorships[quote.ID]; exists {
			return errors.New("sponsorship provider quote replay rejected")
		}
		data.Sponsorships[quote.ID] = quote
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "sponsorship.quote", quote.ID, "issued", attribution, now)
		return nil
	})
	return quote, err
}

func (s *Service) ConfirmSponsorship(ctx context.Context, session WalletSession, quoteID, userOperationHash string) (SponsorshipQuote, error) {
	if s.sponsorship == nil {
		return SponsorshipQuote{}, errors.New("sponsorship provider is unavailable")
	}
	userOperationHash = strings.ToLower(strings.TrimSpace(userOperationHash))
	if !hash32Pattern.MatchString(userOperationHash) {
		return SponsorshipQuote{}, errors.New("UserOperation hash is invalid")
	}
	var quote SponsorshipQuote
	if err := s.store.View(func(data Snapshot) error {
		var ok bool
		quote, ok = data.Sponsorships[quoteID]
		if !ok || quote.Account != session.Account || quote.DeviceID != session.DeviceID {
			return errors.New("sponsorship quote not found for this Wallet session")
		}
		return nil
	}); err != nil {
		return SponsorshipQuote{}, err
	}
	if quote.Status == "confirmed" && quote.Receipt != nil && quote.Receipt.UserOperationHash == userOperationHash {
		return quote, nil
	}
	if quote.Status != "issued" || !s.now().Before(quote.ExpiresAt) {
		return SponsorshipQuote{}, errors.New("sponsorship quote is expired or not active")
	}
	receipt, err := s.sponsorship.Receipt(ctx, userOperationHash)
	if err != nil {
		return SponsorshipQuote{}, fmt.Errorf("sponsorship receipt unavailable: %w", err)
	}
	if strings.TrimPrefix(strings.ToLower(receipt.UserOperationHash), "0x") != strings.TrimPrefix(userOperationHash, "0x") || !hash32Pattern.MatchString(strings.ToLower(receipt.TransactionHash)) || receipt.BlockNumber == 0 || receipt.ChainID != ChainID || receipt.Sender != quote.SmartAccount || strings.ToLower(receipt.Paymaster) != quote.Paymaster || strings.TrimPrefix(strings.ToLower(receipt.CallDataHash), "0x") != quote.CallDataHash || !receipt.Success || receipt.Finality != "committed" || receipt.ActualSponsorCost < 0 || receipt.ActualSponsorCost > quote.MaximumSponsorCost || strings.TrimSpace(receipt.Source) == "" || receipt.SourceAsOf.IsZero() || receipt.SourceVersion <= 0 {
		return SponsorshipQuote{}, errors.New("authoritative UserOperation receipt is incomplete or mismatched")
	}
	receipt.UserOperationHash = "0x" + strings.TrimPrefix(strings.ToLower(receipt.UserOperationHash), "0x")
	receipt.TransactionHash = "0x" + strings.TrimPrefix(strings.ToLower(receipt.TransactionHash), "0x")
	receipt.CallDataHash = strings.TrimPrefix(strings.ToLower(receipt.CallDataHash), "0x")
	quote.Status = "confirmed"
	quote.Receipt = &receipt
	err = s.store.Update(func(data *Snapshot) error {
		current, ok := data.Sponsorships[quote.ID]
		if !ok || current.Status != "issued" {
			return errors.New("sponsorship quote state changed")
		}
		for id, candidate := range data.Sponsorships {
			if id != quote.ID && candidate.Receipt != nil && candidate.Receipt.UserOperationHash == receipt.UserOperationHash {
				return errors.New("UserOperation receipt replay rejected")
			}
		}
		data.Sponsorships[quote.ID] = quote
		appendAudit(data, quote.MerchantID, "wallet:"+session.Account, "sponsorship.receipt", quote.ID, "confirmed", receipt.UserOperationHash, s.now())
		return nil
	})
	return quote, err
}

type HTTPSponsorshipProvider struct {
	BaseURL string
	APIKey  string
	Client  *http.Client
}

func NewHTTPSponsorshipProvider(baseURL, apiKey string) (*HTTPSponsorshipProvider, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("HTTPS sponsorship provider URL and API key are required")
	}
	return &HTTPSponsorshipProvider{BaseURL: u.String(), APIKey: apiKey, Client: &http.Client{Timeout: 15 * time.Second}}, nil
}

func (p *HTTPSponsorshipProvider) Quote(ctx context.Context, request SponsorQuoteRequest) (ProviderSponsorQuote, error) {
	var out ProviderSponsorQuote
	err := p.do(ctx, http.MethodPost, "/v1/sponsorship-quotes", request, &out)
	return out, err
}

func (p *HTTPSponsorshipProvider) Receipt(ctx context.Context, hash string) (UserOperationReceipt, error) {
	var out UserOperationReceipt
	err := p.do(ctx, http.MethodGet, "/v1/user-operations/"+url.PathEscape(hash)+"/receipt", nil, &out)
	return out, err
}

func (p *HTTPSponsorshipProvider) do(ctx context.Context, method, path string, body any, out any) error {
	var raw []byte
	var err error
	if body != nil {
		raw, err = json.Marshal(body)
		if err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, p.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+p.APIKey)
	req.Header.Set("Content-Type", "application/json")
	applyCorrelationHeaders(req)
	resp, err := p.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	response, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("provider rejected request (%d)", resp.StatusCode)
	}
	return strictJSON(response, out)
}
