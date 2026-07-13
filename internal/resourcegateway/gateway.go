package resourcegateway

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const (
	MaxBodyBytes          = 1 << 20
	MaxResponseBytes      = 2 << 20
	UpstreamAuthoritative = "authoritative"
	UpstreamBFT           = "bft"
)

type Config struct {
	ChainURL      string
	APIKey        string
	UpstreamKey   string
	AuditLog      string
	Window        time.Duration
	MaxRequests   int
	UpstreamMode  string
	SignerKey     string
	SignerKeyPath string
	SignerAddress string
	ChainID       int64
}

func (c Config) normalized() (Config, error) {
	c.ChainURL = strings.TrimRight(strings.TrimSpace(c.ChainURL), "/")
	parsed, err := url.Parse(c.ChainURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return Config{}, fmt.Errorf("YNX_RESOURCE_GATEWAY_CHAIN_URL must be an absolute http(s) URL")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return Config{}, fmt.Errorf("YNX_RESOURCE_API_KEY is required for ynx-resourced")
	}
	c.UpstreamMode = strings.ToLower(strings.TrimSpace(c.UpstreamMode))
	if c.UpstreamMode == "" {
		c.UpstreamMode = UpstreamAuthoritative
	}
	if c.UpstreamMode != UpstreamAuthoritative && c.UpstreamMode != UpstreamBFT {
		return Config{}, errors.New("Resource upstream mode must be authoritative or bft")
	}
	if c.UpstreamMode == UpstreamAuthoritative && strings.TrimSpace(c.UpstreamKey) == "" {
		return Config{}, fmt.Errorf("YNX_RESOURCE_GATEWAY_UPSTREAM_KEY is required for ynx-resourced")
	}
	if c.UpstreamMode == UpstreamBFT {
		if (strings.TrimSpace(c.SignerKey) == "") == (strings.TrimSpace(c.SignerKeyPath) == "") {
			return Config{}, errors.New("BFT Resource Gateway requires exactly one signer key source")
		}
		if !consensus.IsNativeAddress(strings.TrimSpace(c.SignerAddress)) {
			return Config{}, errors.New("BFT Resource Gateway requires canonical signer address")
		}
		if c.ChainID == 0 {
			c.ChainID = 6423
		}
		if c.ChainID != 6423 {
			return Config{}, errors.New("BFT Resource Gateway chain ID must equal 6423")
		}
	}
	if c.AuditLog == "" {
		c.AuditLog = "tmp/resource-gateway/audit.jsonl"
	}
	if c.Window <= 0 {
		c.Window = time.Minute
	}
	if c.MaxRequests <= 0 {
		c.MaxRequests = 60
	}
	return c, nil
}

type Service struct {
	cfg         Config
	httpClient  *http.Client
	mu          sync.Mutex
	seen        map[string][]time.Time
	requests    int64
	successes   int64
	denied      int64
	errors      int64
	active      int64
	auditErrors int64
	signer      *secp256k1.PrivateKey
	signerAddr  string
	mutationMu  sync.Mutex
}

func New(cfg Config) (*Service, error) {
	normalized, err := cfg.normalized()
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: normalized, httpClient: &http.Client{Timeout: 30 * time.Second}, seen: map[string][]time.Time{}}
	if normalized.UpstreamMode == UpstreamBFT {
		signer, address, err := loadBFTResourceSigner(normalized)
		if err != nil {
			return nil, err
		}
		service.signer, service.signerAddr = signer, address
		service.cfg.SignerKey = ""
	}
	return service, nil
}

func loadBFTResourceSigner(cfg Config) (*secp256k1.PrivateKey, string, error) {
	var keyBytes []byte
	if path := strings.TrimSpace(cfg.SignerKeyPath); path != "" {
		info, err := os.Stat(path)
		if err != nil {
			return nil, "", fmt.Errorf("stat BFT Resource signer key: %w", err)
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil, "", errors.New("BFT Resource signer key file must be regular and mode-restricted")
		}
		keyBytes, err = os.ReadFile(path)
		if err != nil {
			return nil, "", fmt.Errorf("read BFT Resource signer key: %w", err)
		}
	} else {
		var err error
		keyBytes, err = hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(cfg.SignerKey), "0x"))
		if err != nil {
			return nil, "", errors.New("BFT Resource signer key must be canonical hex")
		}
	}
	defer clear(keyBytes)
	if len(keyBytes) != 32 || bytes.Equal(keyBytes, make([]byte, 32)) {
		return nil, "", errors.New("BFT Resource signer key must be one non-zero 32-byte scalar")
	}
	privateKey := secp256k1.PrivKeyFromBytes(keyBytes)
	if !bytes.Equal(privateKey.Serialize(), keyBytes) {
		return nil, "", errors.New("BFT Resource signer key scalar is outside canonical range")
	}
	address, err := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	if err != nil {
		return nil, "", err
	}
	if address != strings.TrimSpace(cfg.SignerAddress) {
		return nil, "", errors.New("BFT Resource signer address does not match private key")
	}
	return privateKey, address, nil
}

type chainStatus struct {
	ChainID              int64  `json:"chainId"`
	Height               uint64 `json:"height"`
	Network              string `json:"network"`
	NativeCurrencySymbol string `json:"nativeCurrencySymbol"`
}

type Health struct {
	OK                 bool           `json:"ok"`
	Service            string         `json:"service"`
	ChainID            int64          `json:"chainId,omitempty"`
	Height             uint64         `json:"height,omitempty"`
	Network            string         `json:"network,omitempty"`
	NativeSymbol       string         `json:"nativeSymbol"`
	UpstreamOK         bool           `json:"upstreamOk"`
	RateLimit          string         `json:"rateLimit"`
	BodyLimitBytes     int            `json:"bodyLimitBytes"`
	ResponseLimitBytes int            `json:"responseLimitBytes"`
	AuditLog           string         `json:"auditLog"`
	Requests           int64          `json:"requests"`
	Successes          int64          `json:"successes"`
	Denied             int64          `json:"denied"`
	Errors             int64          `json:"errors"`
	Active             int64          `json:"active"`
	AuditErrors        int64          `json:"auditErrors"`
	Build              buildinfo.Info `json:"build"`
	TruthfulStatus     string         `json:"truthfulStatus"`
	Error              string         `json:"error,omitempty"`
	UpstreamMode       string         `json:"upstreamMode"`
	SignerAddress      string         `json:"signerAddress,omitempty"`
}

func (s *Service) Health(ctx context.Context, build buildinfo.Info) Health {
	health := s.snapshotHealth(build)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/status", nil)
	if err != nil {
		health.Error = err.Error()
		return health
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		health.Error = err.Error()
		return health
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		health.Error = fmt.Sprintf("chain status returned %d", resp.StatusCode)
		return health
	}
	var status chainStatus
	if err := json.NewDecoder(io.LimitReader(resp.Body, MaxBodyBytes)).Decode(&status); err != nil {
		health.Error = err.Error()
		return health
	}
	health.ChainID, health.Height, health.Network, health.NativeSymbol = status.ChainID, status.Height, status.Network, status.NativeCurrencySymbol
	health.UpstreamOK = status.ChainID > 0 && status.NativeCurrencySymbol == "YNXT"
	health.OK = health.UpstreamOK && health.AuditErrors == 0
	return health
}

func (s *Service) snapshotHealth(build buildinfo.Info) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	return Health{
		Service: "ynx-resourced", NativeSymbol: "YNXT", RateLimit: fmt.Sprintf("%d per %s per api-key/ip", s.cfg.MaxRequests, s.cfg.Window),
		BodyLimitBytes: MaxBodyBytes, ResponseLimitBytes: MaxResponseBytes, AuditLog: s.cfg.AuditLog,
		Requests: s.requests, Successes: s.successes, Denied: s.denied, Errors: s.errors, Active: s.active, AuditErrors: s.auditErrors,
		Build: buildinfo.Normalize(build), TruthfulStatus: resourceTruthfulStatus(s.cfg.UpstreamMode), UpstreamMode: s.cfg.UpstreamMode, SignerAddress: s.signerAddr,
	}
}

func (s *Service) Authorized(value string) bool {
	value = strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	return value != "" && equalHash(value, s.cfg.APIKey)
}

func (s *Service) Allow(remoteAddr, accessKey string, now time.Time) bool {
	key := clientIP(remoteAddr) + "|" + hashText(accessKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := now.Add(-s.cfg.Window)
	kept := s.seen[key][:0]
	for _, at := range s.seen[key] {
		if at.After(cutoff) {
			kept = append(kept, at)
		}
	}
	if len(kept) >= s.cfg.MaxRequests {
		s.seen[key] = kept
		return false
	}
	s.seen[key] = append(kept, now)
	return true
}

type ProxyResponse struct {
	Status      int
	ContentType string
	Body        []byte
}

func (s *Service) Proxy(ctx context.Context, method, path, rawQuery string, body []byte, requestID string) (ProxyResponse, error) {
	if s.cfg.UpstreamMode == UpstreamBFT && method == http.MethodPost {
		if strings.HasPrefix(path, "/resource-market/pools") || path == "/resource-market/sponsorships" {
			payload, _ := json.Marshal(map[string]string{"error": "resource sponsor pools are implemented only on the authoritative runtime; BFT promotion remains unclaimed", "requestId": requestID})
			return ProxyResponse{Status: http.StatusNotImplemented, ContentType: "application/json", Body: payload}, nil
		}
		return s.proxyBFTResourceMutation(ctx, path, body, requestID)
	}
	if s.cfg.UpstreamMode == UpstreamBFT && method == http.MethodGet {
		if strings.HasPrefix(path, "/resource-market/delegations/") || strings.HasPrefix(path, "/resource-market/income/") {
			return s.proxyBFTResourceRead(ctx, path, rawQuery, requestID)
		}
	}
	target := s.cfg.ChainURL + path
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return ProxyResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	if s.cfg.UpstreamMode == UpstreamAuthoritative {
		req.Header.Set("X-YNX-Resource-Gateway-Upstream-Key", s.cfg.UpstreamKey)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ProxyResponse{}, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
	if err != nil {
		return ProxyResponse{}, err
	}
	if len(payload) > MaxResponseBytes {
		return ProxyResponse{}, fmt.Errorf("Resource Market response exceeds %d bytes", MaxResponseBytes)
	}
	return ProxyResponse{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), Body: payload}, nil
}

func (s *Service) proxyBFTResourceRead(ctx context.Context, path, rawQuery, requestID string) (ProxyResponse, error) {
	resp, body, err := s.doBFTRequest(ctx, http.MethodGet, path, rawQuery, nil, requestID)
	if err != nil {
		return ProxyResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ProxyResponse{Status: resp.StatusCode, ContentType: "application/json", Body: body}, nil
	}
	var values []json.RawMessage
	if json.Unmarshal(body, &values) != nil {
		return ProxyResponse{}, errors.New("BFT Resource list response is invalid")
	}
	key := "delegations"
	if strings.HasPrefix(path, "/resource-market/income/") {
		key = "income"
	}
	wrapper, _ := json.Marshal(map[string]any{key: values})
	return ProxyResponse{Status: resp.StatusCode, ContentType: "application/json", Body: wrapper}, nil
}

type resourceDelegationRequest struct {
	Provider       string `json:"provider,omitempty"`
	Beneficiary    string `json:"beneficiary"`
	Amount         int64  `json:"amount"`
	IdempotencyKey string `json:"idempotencyKey"`
}
type resourceRentalRequest struct {
	Address        string `json:"address,omitempty"`
	Provider       string `json:"provider"`
	Bandwidth      int64  `json:"bandwidth"`
	Compute        int64  `json:"compute"`
	AICredits      int64  `json:"aiCredits"`
	TrustCredits   int64  `json:"trustCredits"`
	IdempotencyKey string `json:"idempotencyKey"`
}

func (s *Service) proxyBFTResourceMutation(ctx context.Context, path string, body []byte, requestID string) (ProxyResponse, error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	if s.signer == nil {
		return ProxyResponse{}, errors.New("BFT Resource signer is unavailable")
	}
	action, payload, replay, err := s.bftResourcePayload(ctx, path, body)
	if err != nil {
		return ProxyResponse{}, err
	}
	if replay != nil {
		return *replay, nil
	}
	account, err := s.bftResourceSignerAccount(ctx)
	if err != nil {
		return ProxyResponse{}, err
	}
	if account.Nonce == math.MaxUint64 {
		return ProxyResponse{}, errors.New("BFT Resource signer nonce exhausted")
	}
	tx, err := consensus.NewSignedApplicationAction(s.signer, s.cfg.ChainID, action, payload, account.Nonce+1)
	if err != nil {
		return ProxyResponse{}, err
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		return ProxyResponse{}, err
	}
	resp, responseBody, err := s.doBFTRequest(ctx, http.MethodPost, path, "", raw, requestID)
	if err != nil {
		return ProxyResponse{}, err
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		responseBody, err = s.verifyAndWrapBFTResourceResponse(ctx, action, tx, raw, responseBody, requestID)
		if err != nil {
			return ProxyResponse{}, err
		}
	}
	return ProxyResponse{Status: resp.StatusCode, ContentType: "application/json", Body: responseBody}, nil
}

func (s *Service) bftResourcePayload(ctx context.Context, path string, body []byte) (string, any, *ProxyResponse, error) {
	decode := func(out any) error {
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(out); err != nil {
			return err
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			return errors.New("Resource mutation must contain one JSON value")
		}
		return nil
	}
	switch path {
	case "/resource-market/delegations":
		var in resourceDelegationRequest
		if err := decode(&in); err != nil {
			return "", nil, nil, err
		}
		if in.Provider != "" && in.Provider != s.signerAddr {
			return "", nil, nil, errors.New("Resource delegation provider must match configured signer")
		}
		if strings.TrimSpace(in.IdempotencyKey) == "" {
			return "", nil, nil, errors.New("BFT Resource delegation requires idempotencyKey")
		}
		if replay, found, err := s.bftResourceDelegationReplay(ctx, in); err != nil || found {
			return "", nil, replay, err
		}
		policy, err := s.resourcePolicy(ctx)
		if err != nil {
			return "", nil, nil, err
		}
		payload := consensus.ResourceDelegationPayload{Provider: s.signerAddr, Beneficiary: in.Beneficiary, AmountYNXT: in.Amount, PolicyHash: policy.PolicyHash, IdempotencyKey: in.IdempotencyKey}
		payload.RequestHash = consensus.ResourceDelegationRequestHash(payload.Provider, payload.Beneficiary, payload.AmountYNXT, payload.PolicyHash, payload.IdempotencyKey)
		return consensus.ActionResourceDelegate, payload, nil, nil
	case "/resource-market/rent":
		var in resourceRentalRequest
		if err := decode(&in); err != nil {
			return "", nil, nil, err
		}
		if in.Address != "" && in.Address != s.signerAddr {
			return "", nil, nil, errors.New("Resource rental address must match configured signer")
		}
		if strings.TrimSpace(in.IdempotencyKey) == "" {
			return "", nil, nil, errors.New("BFT Resource rental requires idempotencyKey")
		}
		if replay, found, err := s.bftResourceBusinessReplay(ctx, in); err != nil || found {
			return "", nil, replay, err
		}
		quote, err := s.resourceQuote(ctx, in)
		if err != nil {
			return "", nil, nil, err
		}
		payload := consensus.ResourceRentalPayload{Address: s.signerAddr, Provider: in.Provider, Bandwidth: in.Bandwidth, Compute: in.Compute, AICredits: in.AICredits, TrustCredits: in.TrustCredits, QuoteID: quote.ID, QuoteExpiresAt: quote.ExpiresAt, PolicyHash: quote.PolicyHash, MaxPriceYNXT: quote.PriceYNXT, IdempotencyKey: in.IdempotencyKey}
		payload.RequestHash = consensus.ResourceRentalRequestHash(payload.Address, payload.Provider, payload.Bandwidth, payload.Compute, payload.AICredits, payload.TrustCredits, payload.QuoteID, payload.QuoteExpiresAt, payload.PolicyHash, payload.MaxPriceYNXT, payload.IdempotencyKey)
		return consensus.ActionResourceRent, payload, nil, nil
	default:
		return "", nil, nil, errors.New("Resource mutation route is not BFT-backed")
	}
}

func (s *Service) bftResourceSignerAccount(ctx context.Context) (chain.ConsensusAccount, error) {
	var account chain.ConsensusAccount
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/accounts/"+s.signerAddr, "", nil, "")
	if err != nil {
		return account, err
	}
	if status.StatusCode != http.StatusOK {
		return account, fmt.Errorf("BFT Resource signer account query returned %d", status.StatusCode)
	}
	if json.Unmarshal(body, &account) != nil || account.Address != s.signerAddr {
		return account, errors.New("BFT Resource signer account mismatch")
	}
	return account, nil
}

func (s *Service) resourcePolicy(ctx context.Context) (chain.ResourceMarketPolicy, error) {
	var policy chain.ResourceMarketPolicy
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/resource-market/policy", "", nil, "")
	if err != nil {
		return policy, err
	}
	if status.StatusCode != http.StatusOK {
		return policy, fmt.Errorf("BFT Resource policy query returned %d", status.StatusCode)
	}
	if json.Unmarshal(body, &policy) != nil || policy.Validate() != nil || policy.PolicyHash == "" {
		return policy, errors.New("BFT Resource policy response is invalid")
	}
	return policy, nil
}

func (s *Service) resourceQuote(ctx context.Context, in resourceRentalRequest) (chain.ResourceQuote, error) {
	query := url.Values{"address": {s.signerAddr}, "bandwidth": {fmt.Sprint(in.Bandwidth)}, "compute": {fmt.Sprint(in.Compute)}, "aiCredits": {fmt.Sprint(in.AICredits)}, "trustCredits": {fmt.Sprint(in.TrustCredits)}}
	var quote chain.ResourceQuote
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/resource-market/quote", query.Encode(), nil, "")
	if err != nil {
		return quote, err
	}
	if status.StatusCode != http.StatusOK {
		return quote, fmt.Errorf("BFT Resource quote query returned %d: %s", status.StatusCode, boundedErrorBody(body))
	}
	if json.Unmarshal(body, &quote) != nil || quote.Address != s.signerAddr || quote.PolicyHash == "" || quote.PriceYNXT <= 0 || quote.ExpiresAt.IsZero() {
		return quote, errors.New("BFT Resource quote response is invalid")
	}
	return quote, nil
}

func (s *Service) bftResourceDelegationReplay(ctx context.Context, in resourceDelegationRequest) (*ProxyResponse, bool, error) {
	record, found, err := s.resourceIdempotency(ctx, in.IdempotencyKey)
	if err != nil || !found {
		return nil, false, err
	}
	if record.Action != consensus.ActionResourceDelegate || record.ObjectType != "delegation" {
		return resourceConflict("Resource idempotency key is already committed for different input"), true, nil
	}
	response, delegation, err := s.resourceDelegationReplayResponse(ctx, record)
	if err != nil {
		return nil, true, err
	}
	if delegation.Provider != s.signerAddr || delegation.Beneficiary != in.Beneficiary || delegation.AmountYNXT != in.Amount {
		return resourceConflict("Resource idempotency key is already committed for different input"), true, nil
	}
	return response, true, nil
}

func (s *Service) bftResourceBusinessReplay(ctx context.Context, in resourceRentalRequest) (*ProxyResponse, bool, error) {
	record, found, err := s.resourceIdempotency(ctx, in.IdempotencyKey)
	if err != nil || !found {
		return nil, false, err
	}
	if record.Action != consensus.ActionResourceRent || record.ObjectType != "rental" {
		return resourceConflict("Resource idempotency key is already committed for different input"), true, nil
	}
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/resource-market/rentals/"+record.ObjectID, "", nil, "")
	if err != nil {
		return nil, true, err
	}
	var rental consensus.BFTResourceRental
	if status.StatusCode != http.StatusOK || json.Unmarshal(body, &rental) != nil {
		return nil, true, errors.New("committed Resource rental replay evidence unavailable")
	}
	if rental.Address != s.signerAddr || rental.Provider != in.Provider || rental.Bandwidth != in.Bandwidth || rental.Compute != in.Compute || rental.AICredits != in.AICredits || rental.TrustCredits != in.TrustCredits {
		return resourceConflict("Resource idempotency key is already committed for different input"), true, nil
	}
	wrapped, err := s.wrapResourceRental(ctx, rental)
	if err != nil {
		return nil, true, err
	}
	return &ProxyResponse{Status: http.StatusOK, ContentType: "application/json", Body: wrapped}, true, nil
}

func (s *Service) resourceIdempotency(ctx context.Context, key string) (consensus.BFTResourceIdempotency, bool, error) {
	var record consensus.BFTResourceIdempotency
	query := url.Values{"signer": {s.signerAddr}, "key": {key}}
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/resource-market/idempotency", query.Encode(), nil, "")
	if err != nil {
		return record, false, err
	}
	if status.StatusCode == http.StatusNotFound {
		return record, false, nil
	}
	if status.StatusCode != http.StatusOK {
		return record, false, fmt.Errorf("BFT Resource idempotency query returned %d", status.StatusCode)
	}
	if json.Unmarshal(body, &record) != nil || record.Signer != s.signerAddr || record.IdempotencyKey != key {
		return record, false, errors.New("BFT Resource idempotency response mismatch")
	}
	return record, true, nil
}

func (s *Service) resourceDelegationReplayResponse(ctx context.Context, record consensus.BFTResourceIdempotency) (*ProxyResponse, consensus.BFTResourceDelegation, error) {
	if record.ObjectType != "delegation" {
		return nil, consensus.BFTResourceDelegation{}, errors.New("unsupported Resource replay object")
	}
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/resource-market/delegations/"+s.signerAddr, "", nil, "")
	if err != nil {
		return nil, consensus.BFTResourceDelegation{}, err
	}
	var values []consensus.BFTResourceDelegation
	if status.StatusCode != http.StatusOK || json.Unmarshal(body, &values) != nil {
		return nil, consensus.BFTResourceDelegation{}, errors.New("committed Resource delegation replay evidence unavailable")
	}
	for _, value := range values {
		if value.ID == record.ObjectID {
			wrapped, err := s.wrapResourceDelegation(ctx, value)
			if err != nil {
				return nil, consensus.BFTResourceDelegation{}, err
			}
			return &ProxyResponse{Status: http.StatusOK, ContentType: "application/json", Body: wrapped}, value, nil
		}
	}
	return nil, consensus.BFTResourceDelegation{}, errors.New("committed Resource delegation replay object not found")
}

func (s *Service) verifyAndWrapBFTResourceResponse(ctx context.Context, action string, tx consensus.SignedApplicationAction, raw, response []byte, requestID string) ([]byte, error) {
	txHash := consensus.ApplicationActionHash(raw)
	if action == consensus.ActionResourceDelegate {
		var value consensus.BFTResourceDelegation
		if json.Unmarshal(response, &value) != nil || value.ID != consensus.ApplicationActionRecordID("resource-delegation", txHash) || value.Signer != tx.Signer || value.Provider != tx.Signer || value.TxHash != txHash {
			return nil, errors.New("BFT Resource delegation response mismatch")
		}
		return s.wrapResourceDelegation(ctx, value)
	}
	var value consensus.BFTResourceRental
	if json.Unmarshal(response, &value) != nil || value.ID != consensus.ApplicationActionRecordID("resource-rental", txHash) || value.Signer != tx.Signer || value.Address != tx.Signer || value.TxHash != txHash || value.ProviderIncomeYNXT+value.ProtocolFeeYNXT != value.PriceYNXT {
		return nil, errors.New("BFT Resource rental response mismatch")
	}
	return s.wrapResourceRental(ctx, value)
}

func (s *Service) wrapResourceDelegation(ctx context.Context, value consensus.BFTResourceDelegation) ([]byte, error) {
	resources, err := s.resourceBalance(ctx, value.Beneficiary)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"delegation": value, "resources": resources})
}

func (s *Service) wrapResourceRental(ctx context.Context, value consensus.BFTResourceRental) ([]byte, error) {
	resources, err := s.resourceBalance(ctx, value.Address)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"rental": value, "resources": resources})
}

func (s *Service) resourceBalance(ctx context.Context, address string) (chain.ResourceBalance, error) {
	var balance chain.ResourceBalance
	status, body, err := s.doBFTRequest(ctx, http.MethodGet, "/resources/"+address, "", nil, "")
	if err != nil {
		return balance, err
	}
	if status.StatusCode != http.StatusOK || json.Unmarshal(body, &balance) != nil || balance.Address != address {
		return balance, errors.New("BFT Resource balance response mismatch")
	}
	return balance, nil
}

func (s *Service) doBFTRequest(ctx context.Context, method, path, rawQuery string, body []byte, requestID string) (*http.Response, []byte, error) {
	target := s.cfg.ChainURL + path
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, reader)
	if err != nil {
		return nil, nil, err
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if requestID != "" {
		req.Header.Set("X-Request-ID", requestID)
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
	if err != nil || len(payload) > MaxResponseBytes {
		return nil, nil, errors.New("BFT Resource response exceeds limit")
	}
	return resp, payload, nil
}

func resourceConflict(message string) *ProxyResponse {
	body, _ := json.Marshal(map[string]string{"error": message})
	return &ProxyResponse{Status: http.StatusConflict, ContentType: "application/json", Body: body}
}

func boundedErrorBody(body []byte) string {
	if len(body) > 256 {
		body = body[:256]
	}
	return strings.TrimSpace(string(body))
}

func resourceTruthfulStatus(mode string) string {
	if mode == UpstreamBFT {
		return "signed-bft-resource-market-state-transition-gateway"
	}
	return "authenticated-chain-backed-resource-market-gateway"
}

type AuditEntry struct {
	RequestID string    `json:"requestId"`
	At        time.Time `json:"at"`
	RemoteIP  string    `json:"remoteIp"`
	Method    string    `json:"method"`
	Path      string    `json:"path"`
	BodyHash  string    `json:"bodyHash,omitempty"`
	Status    int       `json:"status"`
	Outcome   string    `json:"outcome"`
	AuditHash string    `json:"auditHash"`
}

func (s *Service) Audit(entry AuditEntry) error {
	entry.At, entry.RemoteIP = entry.At.UTC(), clientIP(entry.RemoteIP)
	entry.AuditHash = hashText(fmt.Sprintf("%s|%s|%s|%s|%s|%d|%s", entry.RequestID, entry.At.Format(time.RFC3339Nano), entry.Method, entry.Path, entry.BodyHash, entry.Status, entry.Outcome))
	payload, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.cfg.AuditLog), 0o700); err != nil {
		s.auditErrors++
		return err
	}
	f, err := os.OpenFile(s.cfg.AuditLog, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		s.auditErrors++
		return err
	}
	defer f.Close()
	if _, err := f.Write(append(payload, '\n')); err != nil {
		s.auditErrors++
		return err
	}
	return nil
}

func (s *Service) StartRequest()  { s.mu.Lock(); s.requests++; s.active++; s.mu.Unlock() }
func (s *Service) RejectRequest() { s.mu.Lock(); s.requests++; s.denied++; s.mu.Unlock() }
func (s *Service) FinishRequest(status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.active--
	if status >= 200 && status < 400 {
		s.successes++
	} else if status >= 500 {
		s.errors++
	} else {
		s.denied++
	}
}

func NewRequestID() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("resource-%d", time.Now().UnixNano())
	}
	return "resource-" + hex.EncodeToString(buf)
}
func BodyHash(body []byte) string { return hashText(string(body)) }
func hashText(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func equalHash(a, b string) bool {
	aHash, bHash := sha256.Sum256([]byte(a)), sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(aHash[:], bHash[:]) == 1
}
func clientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}
