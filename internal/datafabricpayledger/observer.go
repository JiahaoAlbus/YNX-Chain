package datafabricpayledger

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

var commitPattern = regexp.MustCompile(`^[0-9a-f]{7,64}$`)
var transactionHashPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

type HTTPChainObserverConfig struct {
	Origin        string
	SourceCommit  string
	SourceRelease string
	ChainID       int64
	HTTPClient    *http.Client
}

type HTTPChainObserver struct {
	cfg HTTPChainObserverConfig
}

func NewHTTPChainObserver(cfg HTTPChainObserverConfig) (*HTTPChainObserver, error) {
	cfg.Origin = strings.TrimRight(strings.TrimSpace(cfg.Origin), "/")
	parsed, err := url.Parse(cfg.Origin)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("chain observer origin must be an absolute origin URL")
	}
	host := parsed.Hostname()
	ip := net.ParseIP(host)
	loopback := host == "localhost" || ip != nil && ip.IsLoopback()
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && loopback) {
		return nil, errors.New("chain observer origin must use HTTPS except on loopback")
	}
	if cfg.ChainID != 6423 || !commitPattern.MatchString(cfg.SourceCommit) || strings.TrimSpace(cfg.SourceRelease) == "" {
		return nil, errors.New("chain observer requires chain ID 6423 and exact source commit/release")
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 15 * time.Second}
	}
	return &HTTPChainObserver{cfg: cfg}, nil
}

func (o *HTTPChainObserver) ObserveTransfer(ctx context.Context, authority TransferAuthority) (datafabric.SettlementObservation, error) {
	if o == nil || o.cfg.HTTPClient == nil {
		return datafabric.SettlementObservation{}, errors.New("chain observer is not initialized")
	}
	if !transactionHashPattern.MatchString(authority.TransactionHash) || authority.AmountMinor <= 0 || authority.Currency == "" || authority.From == "" || authority.To == "" || authority.EffectiveAt.IsZero() || authority.EffectiveAt.Location() != time.UTC {
		return datafabric.SettlementObservation{}, errors.New("Pay transfer observation authority is incomplete")
	}
	if err := o.verifyIdentity(ctx); err != nil {
		return datafabric.SettlementObservation{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, o.cfg.Origin+"/txs/"+url.PathEscape(authority.TransactionHash), nil)
	if err != nil {
		return datafabric.SettlementObservation{}, err
	}
	response, err := o.cfg.HTTPClient.Do(request)
	if err != nil {
		return datafabric.SettlementObservation{}, fmt.Errorf("read Pay transaction authority: %w", err)
	}
	defer response.Body.Close()
	if err := o.verifyResponseOrigin(response); err != nil {
		return datafabric.SettlementObservation{}, err
	}
	if response.StatusCode != http.StatusOK {
		return datafabric.SettlementObservation{}, fmt.Errorf("Pay transaction authority returned %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 256*1024+1))
	if err != nil || len(payload) > 256*1024 {
		return datafabric.SettlementObservation{}, errors.New("Pay transaction authority exceeds the bounded limit")
	}
	var transaction chain.Transaction
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&transaction); err != nil {
		return datafabric.SettlementObservation{}, fmt.Errorf("decode Pay transaction authority: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return datafabric.SettlementObservation{}, errors.New("Pay transaction authority contains trailing JSON")
	}
	_, fromCanonical, err := normalizeAddress(authority.From)
	if err != nil {
		return datafabric.SettlementObservation{}, errors.New("Pay transfer source address is invalid")
	}
	_, toCanonical, err := normalizeAddress(authority.To)
	if err != nil {
		return datafabric.SettlementObservation{}, errors.New("Pay transfer destination address is invalid")
	}
	if transaction.Hash != authority.TransactionHash || transaction.Type != "transfer" || transaction.From != fromCanonical || transaction.To != toCanonical || transaction.Amount != authority.AmountMinor || transaction.Fee != 1 || transaction.BlockNum == 0 || transaction.BlockHash == "" || transaction.Timestamp.IsZero() || transaction.Timestamp.Location() != time.UTC || transaction.Timestamp.After(authority.EffectiveAt) {
		return datafabric.SettlementObservation{}, errors.New("committed transaction contradicts canonical Pay authority")
	}
	evidence, err := json.Marshal(struct {
		Hash      string    `json:"hash"`
		BlockHash string    `json:"blockHash"`
		BlockNum  uint64    `json:"blockNumber"`
		From      string    `json:"from"`
		To        string    `json:"to"`
		Amount    int64     `json:"amountMinor"`
		Fee       int64     `json:"feeMinor"`
		Timestamp time.Time `json:"timestamp"`
	}{
		Hash: transaction.Hash, BlockHash: transaction.BlockHash, BlockNum: transaction.BlockNum,
		From: transaction.From, To: transaction.To, Amount: transaction.Amount, Fee: transaction.Fee,
		Timestamp: transaction.Timestamp.UTC(),
	})
	if err != nil {
		return datafabric.SettlementObservation{}, err
	}
	digest := sha256.Sum256(evidence)
	return datafabric.SettlementObservation{
		Source: "chain", ReferenceID: transaction.Hash, Asset: authority.Currency, Currency: authority.Currency,
		AmountMinor: transaction.Amount, ObservedAt: transaction.Timestamp.UTC(),
		Metadata: datafabric.SourceMetadata{
			Source: "ynx-chain-committed-transaction", AsOf: transaction.Timestamp.UTC(),
			Version: o.cfg.SourceRelease, Status: "authoritative",
		},
		EvidenceHash: hex.EncodeToString(digest[:]),
	}, nil
}

func (o *HTTPChainObserver) verifyIdentity(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, o.cfg.Origin+"/status", nil)
	if err != nil {
		return err
	}
	response, err := o.cfg.HTTPClient.Do(request)
	if err != nil {
		return fmt.Errorf("read chain observer identity: %w", err)
	}
	defer response.Body.Close()
	if err := o.verifyResponseOrigin(response); err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("chain observer identity returned %d", response.StatusCode)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 1024*1024+1))
	if err != nil || len(payload) > 1024*1024 {
		return errors.New("chain observer identity exceeds the bounded limit")
	}
	var status struct {
		ChainID              int64  `json:"chainId"`
		NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
		Build                struct {
			Commit  string `json:"commit"`
			Release string `json:"release"`
		} `json:"build"`
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	if err := decoder.Decode(&status); err != nil {
		return errors.New("chain observer identity is invalid")
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("chain observer identity contains trailing JSON")
	}
	if status.ChainID != o.cfg.ChainID || status.NativeCurrencySymbol != "YNXT" || status.Build.Commit != o.cfg.SourceCommit || status.Build.Release != o.cfg.SourceRelease {
		return errors.New("chain observer identity contradicts configured chain, commit, or release")
	}
	return nil
}

func (o *HTTPChainObserver) verifyResponseOrigin(response *http.Response) error {
	want, _ := url.Parse(o.cfg.Origin)
	if response == nil || response.Request == nil || response.Request.URL == nil || !strings.EqualFold(response.Request.URL.Scheme, want.Scheme) || !strings.EqualFold(response.Request.URL.Host, want.Host) {
		return errors.New("chain observer response escaped the configured authority origin")
	}
	return nil
}

func normalizeAddress(value string) (native, canonical string, err error) {
	canonical, err = accountaddress.Normalize(strings.TrimSpace(value))
	if err != nil {
		return "", "", err
	}
	native, err = accountaddress.Encode(canonical)
	if err != nil {
		return "", "", err
	}
	return native, canonical, nil
}
