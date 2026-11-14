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
	"sort"
	"strings"
	"time"
)

var bridgeStages = map[string]int{"quoted": 0, "source_accepted": 1, "source_finalized": 2, "attested": 3, "destination_confirmed": 4, "failed": 5, "refund_available": 6, "refunded": 7}

type BridgeQuoteRequest struct {
	InvoiceID          string `json:"invoiceId"`
	Account            string `json:"account"`
	SourceChain        string `json:"sourceChain"`
	SourceAsset        string `json:"sourceAsset"`
	SourceAmount       int64  `json:"sourceAmount"`
	DestinationChain   string `json:"destinationChain"`
	DestinationAsset   string `json:"destinationAsset"`
	DestinationAmount  int64  `json:"destinationAmount"`
	DestinationAccount string `json:"destinationAccount"`
}

type ProviderBridgeQuote struct {
	ID                      string    `json:"id"`
	Provider                string    `json:"provider"`
	SourceChain             string    `json:"sourceChain"`
	SourceAsset             string    `json:"sourceAsset"`
	SourceAmount            int64     `json:"sourceAmount"`
	SourceContract          string    `json:"sourceContract"`
	DestinationChain        string    `json:"destinationChain"`
	DestinationAsset        string    `json:"destinationAsset"`
	DestinationAmount       int64     `json:"destinationAmount"`
	DestinationContract     string    `json:"destinationContract"`
	BridgeFee               int64     `json:"bridgeFee"`
	NetworkFee              int64     `json:"networkFee"`
	TotalCostYNXTEquivalent int64     `json:"totalCostYnxtEquivalent"`
	FXRate                  string    `json:"fxRate"`
	RiskBPS                 int64     `json:"riskBps"`
	EstimatedSeconds        int64     `json:"estimatedSeconds"`
	Finality                string    `json:"finality"`
	ProviderHealth          string    `json:"providerHealth"`
	IssuedAt                time.Time `json:"issuedAt"`
	ExpiresAt               time.Time `json:"expiresAt"`
	Source                  string    `json:"source"`
	SourceVersion           int       `json:"sourceVersion"`
	Confidence              string    `json:"confidence"`
	Coverage                string    `json:"coverage"`
}

type ProviderBridgeStatus struct {
	QuoteID                    string    `json:"quoteId"`
	Stage                      string    `json:"stage"`
	SourceTransactionHash      string    `json:"sourceTransactionHash,omitempty"`
	SourceBlock                uint64    `json:"sourceBlock,omitempty"`
	SourceFinality             string    `json:"sourceFinality,omitempty"`
	Attestation                string    `json:"attestation,omitempty"`
	DestinationTransactionHash string    `json:"destinationTransactionHash,omitempty"`
	DestinationBlock           uint64    `json:"destinationBlock,omitempty"`
	DestinationFinality        string    `json:"destinationFinality,omitempty"`
	RefundReference            string    `json:"refundReference,omitempty"`
	Failure                    string    `json:"failure,omitempty"`
	AsOf                       time.Time `json:"asOf"`
	Source                     string    `json:"source"`
	SourceVersion              int       `json:"sourceVersion"`
}

type BridgeProvider interface {
	Quote(context.Context, BridgeQuoteRequest) (ProviderBridgeQuote, error)
	Status(context.Context, string) (ProviderBridgeStatus, error)
}

type BridgeTransition struct {
	Stage    string    `json:"stage"`
	At       time.Time `json:"at"`
	Source   string    `json:"source"`
	Evidence string    `json:"evidence,omitempty"`
}

type BridgeTransfer struct {
	ID                         string             `json:"id"`
	InvoiceID                  string             `json:"invoiceId"`
	Account                    string             `json:"account"`
	Provider                   string             `json:"provider"`
	SourceChain                string             `json:"sourceChain"`
	SourceAsset                string             `json:"sourceAsset"`
	SourceAmount               int64              `json:"sourceAmount"`
	SourceContract             string             `json:"sourceContract"`
	DestinationChain           string             `json:"destinationChain"`
	DestinationAsset           string             `json:"destinationAsset"`
	DestinationAmount          int64              `json:"destinationAmount"`
	DestinationContract        string             `json:"destinationContract"`
	BridgeFee                  int64              `json:"bridgeFee"`
	NetworkFee                 int64              `json:"networkFee"`
	TotalCostYNXTEquivalent    int64              `json:"totalCostYnxtEquivalent"`
	FXRate                     string             `json:"fxRate"`
	RiskBPS                    int64              `json:"riskBps"`
	EstimatedSeconds           int64              `json:"estimatedSeconds"`
	Finality                   string             `json:"finality"`
	ProviderHealth             string             `json:"providerHealth"`
	Status                     string             `json:"status"`
	IssuedAt                   time.Time          `json:"issuedAt"`
	ExpiresAt                  time.Time          `json:"expiresAt"`
	Source                     string             `json:"source"`
	SourceAsOf                 time.Time          `json:"sourceAsOf"`
	SourceVersion              int                `json:"sourceVersion"`
	Confidence                 string             `json:"confidence"`
	Coverage                   string             `json:"coverage"`
	SourceTransactionHash      string             `json:"sourceTransactionHash,omitempty"`
	SourceBlock                uint64             `json:"sourceBlock,omitempty"`
	Attestation                string             `json:"attestation,omitempty"`
	DestinationTransactionHash string             `json:"destinationTransactionHash,omitempty"`
	DestinationBlock           uint64             `json:"destinationBlock,omitempty"`
	RefundReference            string             `json:"refundReference,omitempty"`
	Failure                    string             `json:"failure,omitempty"`
	History                    []BridgeTransition `json:"history"`
}

type RouteOption struct {
	ID                 string    `json:"id"`
	Kind               string    `json:"kind"`
	Asset              string    `json:"asset"`
	Available          bool      `json:"available"`
	UnavailableReason  string    `json:"unavailableReason,omitempty"`
	TotalCostYNXT      int64     `json:"totalCostYnxt,omitempty"`
	NetworkFee         int64     `json:"networkFee,omitempty"`
	ProviderCost       int64     `json:"providerCost,omitempty"`
	SponsorCost        int64     `json:"sponsorCost,omitempty"`
	FXRate             string    `json:"fxRate,omitempty"`
	BridgeRiskBPS      int64     `json:"bridgeRiskBps,omitempty"`
	SettlementSeconds  int64     `json:"settlementSeconds,omitempty"`
	Finality           string    `json:"finality,omitempty"`
	ProviderHealth     string    `json:"providerHealth,omitempty"`
	Score              int64     `json:"score,omitempty"`
	Explanation        []string  `json:"explanation"`
	BridgeTransferID   string    `json:"bridgeTransferId,omitempty"`
	SponsorshipQuoteID string    `json:"sponsorshipQuoteId,omitempty"`
	Source             string    `json:"source"`
	SourceAsOf         time.Time `json:"sourceAsOf"`
	SourceVersion      int       `json:"sourceVersion"`
}

type PaymentRouteQuote struct {
	ID            string        `json:"id"`
	InvoiceID     string        `json:"invoiceId"`
	Account       string        `json:"account"`
	Options       []RouteOption `json:"options"`
	RecommendedID string        `json:"recommendedId,omitempty"`
	SelectedID    string        `json:"selectedId,omitempty"`
	Status        string        `json:"status"`
	IssuedAt      time.Time     `json:"issuedAt"`
	ExpiresAt     time.Time     `json:"expiresAt"`
	Source        string        `json:"source"`
	SourceVersion int           `json:"sourceVersion"`
}

type RouteQuoteInput struct {
	SourceChain          string `json:"sourceChain"`
	SourceAsset          string `json:"sourceAsset"`
	SourceAmount         int64  `json:"sourceAmount"`
	MaxTotalCostYNXT     int64  `json:"maxTotalCostYnxt,omitempty"`
	MaxSettlementSeconds int64  `json:"maxSettlementSeconds,omitempty"`
	AcceptBridgeRiskBPS  int64  `json:"acceptBridgeRiskBps,omitempty"`
	PreferSponsored      bool   `json:"preferSponsored,omitempty"`
	IdempotencyKey       string `json:"idempotencyKey"`
}

func (s *Service) CreateRouteQuote(ctx context.Context, session WalletSession, invoiceID string, input RouteQuoteInput) (PaymentRouteQuote, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	key, err := validKey(input.IdempotencyKey)
	if err != nil {
		return PaymentRouteQuote{}, err
	}
	invoice, err := s.Invoice(ctx, invoiceID)
	if err != nil {
		return PaymentRouteQuote{}, err
	}
	if invoice.Status != "pending" || !s.now().Before(invoice.ExpiresAt) {
		return PaymentRouteQuote{}, errors.New("only a pending unexpired invoice can be routed")
	}
	requestHash := hashJSON(input)
	var existing PaymentRouteQuote
	var found bool
	err = s.store.View(func(data Snapshot) error {
		if idem, ok := data.Idempotency["route:"+session.Account+":"+key]; ok {
			existing, found = data.RouteQuotes[idem.ObjectID]
			if idem.RequestHash != requestHash {
				return errors.New("route idempotency key reused with different input")
			}
		}
		return nil
	})
	if err != nil {
		return PaymentRouteQuote{}, err
	}
	if found {
		return existing, nil
	}
	now := s.now().UTC()
	var bridgeTransfer *BridgeTransfer
	feeSource, feeAsOf, feeVersion := invoice.FeeBreakdown.Source, invoice.FeeBreakdown.AsOf, invoice.FeeBreakdown.Version
	if feeSource == "" || feeAsOf.IsZero() || feeVersion <= 0 {
		feeSource, feeAsOf, feeVersion = "ynx-pay-legacy-fee-policy", invoice.CreatedAt, 1
	}
	options := []RouteOption{{ID: "native-ynxt", Kind: "native", Asset: NativeAsset, Available: true, TotalCostYNXT: invoice.Amount + invoice.Fee, NetworkFee: invoice.Fee, SettlementSeconds: 10, Finality: "committed-block", ProviderHealth: "ynx-chain-required", Score: invoice.Amount + invoice.Fee + 10, Explanation: []string{"No bridge or FX", "Wallet pays the signed invoice on YNX Testnet", "Receipt still requires authoritative settlement matching"}, Source: feeSource, SourceAsOf: feeAsOf, SourceVersion: feeVersion}}
	var activeSponsor *SponsorshipQuote
	_ = s.store.View(func(data Snapshot) error {
		for _, q := range data.Sponsorships {
			if q.InvoiceID == invoice.ID && q.Account == session.Account && q.Status == "issued" && now.Before(q.ExpiresAt) {
				candidate := q
				activeSponsor = &candidate
				break
			}
		}
		return nil
	})
	if activeSponsor != nil {
		score := invoice.Amount + 5
		if input.PreferSponsored {
			score -= 2
		}
		options = append(options, RouteOption{ID: "sponsored-" + activeSponsor.ID, Kind: "sponsored", Asset: invoice.Asset, Available: true, TotalCostYNXT: invoice.Amount, SponsorCost: activeSponsor.MaximumSponsorCost, SettlementSeconds: 10, Finality: "committed-block-plus-user-operation-receipt", ProviderHealth: "paymaster-quote-active", Score: score, Explanation: []string{"Sponsor covers up to the disclosed gas budget", "Wallet approves the exact UserOperation call data", "Provider receipt and authoritative payment receipt are both required"}, SponsorshipQuoteID: activeSponsor.ID, Source: activeSponsor.Source, SourceAsOf: activeSponsor.SourceAsOf, SourceVersion: activeSponsor.SourceVersion})
	} else {
		options = append(options, RouteOption{ID: "sponsored-unavailable", Kind: "sponsored", Asset: invoice.Asset, Available: false, UnavailableReason: "no active account/device-bound sponsorship quote", Explanation: []string{"Request and approve a sponsorship quote before route selection"}, Source: "ynx-pay-product", SourceAsOf: now, SourceVersion: 1})
	}
	if strings.TrimSpace(input.SourceChain) != "" && (input.SourceChain != ChainID || input.SourceAsset != NativeAsset) {
		bridgeOption, transfer := s.bridgeRoute(ctx, session, invoice, input, now)
		options = append(options, bridgeOption)
		bridgeTransfer = transfer
	}
	for i := range options {
		if !options[i].Available {
			continue
		}
		if input.MaxTotalCostYNXT > 0 && options[i].TotalCostYNXT > input.MaxTotalCostYNXT {
			options[i].Available = false
			options[i].UnavailableReason = "exceeds user maximum total cost"
		}
		if input.MaxSettlementSeconds > 0 && options[i].SettlementSeconds > input.MaxSettlementSeconds {
			options[i].Available = false
			options[i].UnavailableReason = "exceeds user maximum settlement time"
		}
		if input.AcceptBridgeRiskBPS > 0 && options[i].BridgeRiskBPS > input.AcceptBridgeRiskBPS {
			options[i].Available = false
			options[i].UnavailableReason = "exceeds user bridge risk limit"
		}
	}
	sort.SliceStable(options, func(i, j int) bool {
		if options[i].Available != options[j].Available {
			return options[i].Available
		}
		return options[i].Score < options[j].Score
	})
	recommended := ""
	for _, option := range options {
		if option.Available {
			recommended = option.ID
			break
		}
	}
	if recommended == "" {
		return PaymentRouteQuote{}, errors.New("no payment route satisfies the user limits")
	}
	quote := PaymentRouteQuote{ID: "rtq_" + hashString(invoice.ID, session.Account, key)[:20], InvoiceID: invoice.ID, Account: session.Account, Options: options, RecommendedID: recommended, Status: "issued", IssuedAt: now, ExpiresAt: minTime(invoice.ExpiresAt, now.Add(5*time.Minute)), Source: "ynx-pay-route-engine", SourceVersion: 1}
	err = s.idempotentUpdate("route", session.Account, key, requestHash, quote.ID, func(data *Snapshot) error {
		if bridgeTransfer != nil {
			if previous, ok := data.BridgeTransfers[bridgeTransfer.ID]; ok && (previous.InvoiceID != bridgeTransfer.InvoiceID || previous.Account != bridgeTransfer.Account) {
				return errors.New("bridge provider quote replay rejected")
			}
			data.BridgeTransfers[bridgeTransfer.ID] = *bridgeTransfer
		}
		data.RouteQuotes[quote.ID] = quote
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "route.quote", quote.ID, "issued", recommended, now)
		return nil
	})
	return quote, err
}

func (s *Service) bridgeRoute(ctx context.Context, session WalletSession, invoice Invoice, input RouteQuoteInput, now time.Time) (RouteOption, *BridgeTransfer) {
	unavailable := func(reason string) (RouteOption, *BridgeTransfer) {
		return RouteOption{ID: "bridge-unavailable", Kind: "bridge", Asset: input.SourceAsset, Available: false, UnavailableReason: reason, Explanation: []string{"External quote is not funds arrival", "YNX payment begins only after destination confirmation"}, Source: "ynx-pay-product", SourceAsOf: now, SourceVersion: 1}, nil
	}
	if s.bridge == nil {
		return unavailable("bridge provider is unavailable for YNX")
	}
	if input.AcceptBridgeRiskBPS <= 0 {
		return unavailable("explicit user bridge risk limit is required")
	}
	if !identifierRE.MatchString(input.SourceChain) || !identifierRE.MatchString(input.SourceAsset) || input.SourceAmount <= 0 {
		return unavailable("source chain, asset, or amount is invalid")
	}
	provider, err := s.bridge.Quote(ctx, BridgeQuoteRequest{InvoiceID: invoice.ID, Account: session.Account, SourceChain: input.SourceChain, SourceAsset: input.SourceAsset, SourceAmount: input.SourceAmount, DestinationChain: ChainID, DestinationAsset: NativeAsset, DestinationAmount: invoice.Amount + invoice.Fee, DestinationAccount: session.Account})
	if err != nil {
		return unavailable("bridge provider quote failed")
	}
	if !identifierRE.MatchString(provider.ID) || !identifierRE.MatchString(provider.Provider) || provider.SourceChain != input.SourceChain || provider.SourceAsset != input.SourceAsset || provider.SourceAmount != input.SourceAmount || provider.DestinationChain != ChainID || provider.DestinationAsset != NativeAsset || provider.DestinationAmount < invoice.Amount+invoice.Fee || provider.BridgeFee < 0 || provider.NetworkFee < 0 || provider.TotalCostYNXTEquivalent <= 0 || strings.TrimSpace(provider.FXRate) == "" || provider.RiskBPS < 0 || provider.RiskBPS > 10000 || provider.EstimatedSeconds <= 0 || strings.TrimSpace(provider.Finality) == "" || provider.ProviderHealth != "healthy" || provider.IssuedAt.IsZero() || provider.IssuedAt.After(now.Add(30*time.Second)) || !provider.ExpiresAt.After(now) || provider.ExpiresAt.Sub(provider.IssuedAt) <= 0 || provider.ExpiresAt.Sub(provider.IssuedAt) > 5*time.Minute || provider.Source == "" || provider.SourceVersion <= 0 || provider.Confidence == "" || provider.Coverage == "" || provider.SourceContract == "" || provider.DestinationContract == "" {
		return unavailable("bridge provider returned an incomplete or mismatched quote")
	}
	transfer := &BridgeTransfer{ID: provider.ID, InvoiceID: invoice.ID, Account: session.Account, Provider: provider.Provider, SourceChain: provider.SourceChain, SourceAsset: provider.SourceAsset, SourceAmount: provider.SourceAmount, SourceContract: provider.SourceContract, DestinationChain: provider.DestinationChain, DestinationAsset: provider.DestinationAsset, DestinationAmount: provider.DestinationAmount, DestinationContract: provider.DestinationContract, BridgeFee: provider.BridgeFee, NetworkFee: provider.NetworkFee, TotalCostYNXTEquivalent: provider.TotalCostYNXTEquivalent, FXRate: provider.FXRate, RiskBPS: provider.RiskBPS, EstimatedSeconds: provider.EstimatedSeconds, Finality: provider.Finality, ProviderHealth: provider.ProviderHealth, Status: "quoted", IssuedAt: provider.IssuedAt.UTC(), ExpiresAt: provider.ExpiresAt.UTC(), Source: provider.Source, SourceAsOf: provider.IssuedAt.UTC(), SourceVersion: provider.SourceVersion, Confidence: provider.Confidence, Coverage: provider.Coverage, History: []BridgeTransition{{Stage: "quoted", At: provider.IssuedAt.UTC(), Source: provider.Source}}}
	score := provider.TotalCostYNXTEquivalent + provider.EstimatedSeconds + provider.RiskBPS
	return RouteOption{ID: "bridge-" + provider.ID, Kind: "bridge", Asset: provider.SourceAsset, Available: true, TotalCostYNXT: provider.TotalCostYNXTEquivalent, NetworkFee: provider.NetworkFee, ProviderCost: provider.BridgeFee, FXRate: provider.FXRate, BridgeRiskBPS: provider.RiskBPS, SettlementSeconds: provider.EstimatedSeconds, Finality: provider.Finality, ProviderHealth: provider.ProviderHealth, Score: score, Explanation: []string{"Provider quote is not destination arrival", "Source finality and attestation are required", "Wallet payment starts only after destination confirmation"}, BridgeTransferID: provider.ID, Source: provider.Source, SourceAsOf: provider.IssuedAt.UTC(), SourceVersion: provider.SourceVersion}, transfer
}

func (s *Service) SelectRoute(session WalletSession, quoteID, optionID string) (PaymentRouteQuote, error) {
	s.mutation.Lock()
	defer s.mutation.Unlock()
	var quote PaymentRouteQuote
	err := s.store.Update(func(data *Snapshot) error {
		var ok bool
		quote, ok = data.RouteQuotes[quoteID]
		if !ok || quote.Account != session.Account || quote.Status != "issued" || !s.now().Before(quote.ExpiresAt) {
			return errors.New("active route quote not found for this Wallet session")
		}
		valid := false
		for _, option := range quote.Options {
			if option.ID == optionID && option.Available {
				valid = true
				break
			}
		}
		if !valid {
			return errors.New("selected route is unavailable or not in the quote")
		}
		quote.SelectedID, quote.Status = optionID, "selected"
		data.RouteQuotes[quote.ID] = quote
		invoice := data.Invoices[quote.InvoiceID]
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "route.select", quote.ID, "selected", optionID+"; Wallet approval and execution remain required", s.now())
		return nil
	})
	return quote, err
}

func (s *Service) RefreshBridge(ctx context.Context, session WalletSession, id string) (BridgeTransfer, error) {
	if s.bridge == nil {
		return BridgeTransfer{}, errors.New("bridge provider is unavailable")
	}
	var transfer BridgeTransfer
	if err := s.store.View(func(data Snapshot) error {
		var ok bool
		transfer, ok = data.BridgeTransfers[id]
		if !ok || transfer.Account != session.Account {
			return errors.New("bridge transfer not found")
		}
		return nil
	}); err != nil {
		return BridgeTransfer{}, err
	}
	status, err := s.bridge.Status(ctx, id)
	if err != nil {
		return BridgeTransfer{}, fmt.Errorf("bridge status unavailable: %w", err)
	}
	if status.Stage == transfer.Status && status.AsOf.Equal(transfer.SourceAsOf) {
		return transfer, nil
	}
	currentRank, currentOK := bridgeStages[transfer.Status]
	nextRank, nextOK := bridgeStages[status.Stage]
	normal := status.Stage != "failed" && status.Stage != "refund_available" && status.Stage != "refunded"
	if !currentOK || !nextOK || status.QuoteID != transfer.ID || !status.AsOf.After(transfer.SourceAsOf) || status.Source != transfer.Source || status.SourceVersion < transfer.SourceVersion || (normal && (nextRank < currentRank || nextRank > currentRank+1)) {
		return BridgeTransfer{}, errors.New("bridge provider returned an invalid or regressive state")
	}
	if normal && nextRank >= bridgeStages["source_accepted"] && !validTx(status.SourceTransactionHash) {
		return BridgeTransfer{}, errors.New("bridge source acceptance evidence is missing")
	}
	if normal && nextRank >= bridgeStages["source_finalized"] && (status.SourceBlock == 0 || status.SourceFinality != "finalized") {
		return BridgeTransfer{}, errors.New("bridge source finality evidence is missing")
	}
	if normal && nextRank >= bridgeStages["attested"] && len(strings.TrimSpace(status.Attestation)) < 16 {
		return BridgeTransfer{}, errors.New("bridge attestation evidence is missing")
	}
	if status.Stage == "destination_confirmed" && (!validTx(status.DestinationTransactionHash) || status.DestinationBlock == 0 || status.DestinationFinality != "committed") {
		return BridgeTransfer{}, errors.New("bridge destination confirmation evidence is missing")
	}
	if (status.Stage == "refund_available" || status.Stage == "refunded") && strings.TrimSpace(status.RefundReference) == "" {
		return BridgeTransfer{}, errors.New("bridge refund evidence is missing")
	}
	if status.Stage == "failed" && strings.TrimSpace(status.Failure) == "" {
		return BridgeTransfer{}, errors.New("bridge failure reason is missing")
	}
	transfer.Status, transfer.SourceAsOf, transfer.SourceVersion = status.Stage, status.AsOf.UTC(), status.SourceVersion
	transfer.SourceTransactionHash, transfer.SourceBlock, transfer.Attestation = status.SourceTransactionHash, status.SourceBlock, status.Attestation
	transfer.DestinationTransactionHash, transfer.DestinationBlock, transfer.RefundReference, transfer.Failure = status.DestinationTransactionHash, status.DestinationBlock, status.RefundReference, status.Failure
	evidence := status.SourceTransactionHash
	if status.Stage == "destination_confirmed" {
		evidence = status.DestinationTransactionHash
	}
	if status.Stage == "refunded" {
		evidence = status.RefundReference
	}
	transfer.History = append(transfer.History, BridgeTransition{Stage: status.Stage, At: status.AsOf.UTC(), Source: status.Source, Evidence: evidence})
	err = s.store.Update(func(data *Snapshot) error {
		current := data.BridgeTransfers[id]
		if current.Status != transfer.History[len(transfer.History)-2].Stage {
			return errors.New("bridge state changed concurrently")
		}
		data.BridgeTransfers[id] = transfer
		invoice := data.Invoices[transfer.InvoiceID]
		appendAudit(data, invoice.MerchantID, "wallet:"+session.Account, "bridge."+status.Stage, id, "recorded", evidence, s.now())
		return nil
	})
	return transfer, err
}

func validTx(value string) bool {
	return len(value) == 66 && strings.HasPrefix(strings.ToLower(value), "0x") && hash32Pattern.MatchString(strings.ToLower(value))
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

type HTTPBridgeProvider struct {
	BaseURL, APIKey string
	Client          *http.Client
}

func NewHTTPBridgeProvider(baseURL, apiKey string) (*HTTPBridgeProvider, error) {
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("HTTPS bridge provider URL and API key are required")
	}
	return &HTTPBridgeProvider{BaseURL: u.String(), APIKey: apiKey, Client: &http.Client{Timeout: 15 * time.Second}}, nil
}
func (p *HTTPBridgeProvider) Quote(ctx context.Context, in BridgeQuoteRequest) (ProviderBridgeQuote, error) {
	var out ProviderBridgeQuote
	err := p.do(ctx, http.MethodPost, "/v1/quotes", in, &out)
	return out, err
}
func (p *HTTPBridgeProvider) Status(ctx context.Context, id string) (ProviderBridgeStatus, error) {
	var out ProviderBridgeStatus
	err := p.do(ctx, http.MethodGet, "/v1/transfers/"+url.PathEscape(id), nil, &out)
	return out, err
}
func (p *HTTPBridgeProvider) do(ctx context.Context, method, path string, body any, out any) error {
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
		return fmt.Errorf("bridge provider rejected request (%d)", resp.StatusCode)
	}
	return strictJSON(response, out)
}
