package paygateway

import (
	"bytes"
	"context"
	"crypto/hmac"
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

const MaxBodyBytes = 1 << 20
const (
	UpstreamAuthoritative = "authoritative"
	UpstreamBFT           = "bft"
)

type Config struct {
	ChainURL          string
	MerchantID        string
	APIKey            string
	UpstreamKey       string
	WebhookSigningKey string
	AuditLog          string
	Window            time.Duration
	MaxRequests       int
	UpstreamMode      string
	SignerKey         string
	SignerKeyPath     string
	SignerAddress     string
	ChainID           int64
}

func (c Config) normalized() (Config, error) {
	c.ChainURL = strings.TrimRight(strings.TrimSpace(c.ChainURL), "/")
	c.MerchantID = strings.TrimSpace(c.MerchantID)
	if err := validServiceURL(c.ChainURL); err != nil {
		return Config{}, fmt.Errorf("invalid YNX_PAY_GATEWAY_CHAIN_URL: %w", err)
	}
	if c.MerchantID == "" {
		return Config{}, fmt.Errorf("YNX_PAY_MERCHANT_ID is required for ynx-payd")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return Config{}, fmt.Errorf("YNX_PAY_API_KEY is required for ynx-payd")
	}
	c.UpstreamMode = strings.ToLower(strings.TrimSpace(c.UpstreamMode))
	if c.UpstreamMode == "" {
		c.UpstreamMode = UpstreamAuthoritative
	}
	if c.UpstreamMode != UpstreamAuthoritative && c.UpstreamMode != UpstreamBFT {
		return Config{}, fmt.Errorf("Pay Gateway upstream mode must be %q or %q", UpstreamAuthoritative, UpstreamBFT)
	}
	if c.UpstreamMode == UpstreamAuthoritative && strings.TrimSpace(c.UpstreamKey) == "" {
		return Config{}, fmt.Errorf("YNX_PAY_GATEWAY_UPSTREAM_KEY is required for ynx-payd")
	}
	if c.UpstreamMode == UpstreamBFT {
		if (strings.TrimSpace(c.SignerKey) == "") == (strings.TrimSpace(c.SignerKeyPath) == "") {
			return Config{}, errors.New("BFT Pay Gateway requires exactly one signer key source")
		}
		if !consensus.IsNativeAddress(strings.TrimSpace(c.SignerAddress)) {
			return Config{}, errors.New("BFT Pay Gateway requires canonical signer address")
		}
		if c.ChainID == 0 {
			c.ChainID = 6423
		}
		if c.ChainID != 6423 {
			return Config{}, errors.New("BFT Pay Gateway chain ID must equal 6423")
		}
	}
	if strings.TrimSpace(c.WebhookSigningKey) == "" {
		return Config{}, fmt.Errorf("YNX_PAY_WEBHOOK_SIGNING_KEY is required for ynx-payd")
	}
	if c.AuditLog == "" {
		c.AuditLog = "tmp/pay-gateway/audit.jsonl"
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
	service := &Service{
		cfg:        normalized,
		httpClient: &http.Client{Timeout: 30 * time.Second},
		seen:       map[string][]time.Time{},
	}
	if normalized.UpstreamMode == UpstreamBFT {
		signer, address, err := loadBFTSigner(normalized)
		if err != nil {
			return nil, err
		}
		service.signer, service.signerAddr = signer, address
		service.cfg.SignerKey = ""
	}
	return service, nil
}

func loadBFTSigner(cfg Config) (*secp256k1.PrivateKey, string, error) {
	var keyBytes []byte
	if path := strings.TrimSpace(cfg.SignerKeyPath); path != "" {
		info, err := os.Stat(path)
		if err != nil {
			return nil, "", fmt.Errorf("stat BFT Pay signer key: %w", err)
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil, "", errors.New("BFT Pay signer key file must be regular and mode-restricted")
		}
		keyBytes, err = os.ReadFile(path)
		if err != nil {
			return nil, "", fmt.Errorf("read BFT Pay signer key: %w", err)
		}
	} else {
		var err error
		keyBytes, err = hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(cfg.SignerKey), "0x"))
		if err != nil {
			return nil, "", errors.New("BFT Pay signer key must be canonical hex")
		}
	}
	defer clear(keyBytes)
	if len(keyBytes) != 32 || bytes.Equal(keyBytes, make([]byte, 32)) {
		return nil, "", errors.New("BFT Pay signer key must be one non-zero 32-byte scalar")
	}
	privateKey := secp256k1.PrivKeyFromBytes(keyBytes)
	if !bytes.Equal(privateKey.Serialize(), keyBytes) {
		return nil, "", errors.New("BFT Pay signer key scalar is outside canonical range")
	}
	address, err := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	if err != nil {
		return nil, "", err
	}
	if address != strings.TrimSpace(cfg.SignerAddress) {
		return nil, "", errors.New("BFT Pay signer address does not match private key")
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
	MerchantConfigured bool           `json:"merchantConfigured"`
	UpstreamOK         bool           `json:"upstreamOk"`
	SigningConfigured  bool           `json:"signingConfigured"`
	RateLimit          string         `json:"rateLimit"`
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
	health.ChainID = status.ChainID
	health.Height = status.Height
	health.Network = status.Network
	health.NativeSymbol = status.NativeCurrencySymbol
	health.UpstreamOK = status.ChainID > 0 && status.NativeCurrencySymbol == "YNXT"
	health.OK = health.UpstreamOK && health.SigningConfigured && health.AuditErrors == 0
	return health
}

func (s *Service) snapshotHealth(build buildinfo.Info) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	truthfulStatus := "authenticated-chain-backed-pay-merchant-gateway"
	if s.cfg.UpstreamMode == UpstreamBFT {
		truthfulStatus = "signed-bft-pay-merchant-gateway"
	}
	return Health{
		Service: "ynx-payd", NativeSymbol: "YNXT", MerchantConfigured: s.cfg.MerchantID != "",
		SigningConfigured: s.cfg.WebhookSigningKey != "",
		RateLimit:         fmt.Sprintf("%d per %s per api-key/ip", s.cfg.MaxRequests, s.cfg.Window),
		AuditLog:          s.cfg.AuditLog, Requests: s.requests, Successes: s.successes,
		Denied: s.denied, Errors: s.errors, Active: s.active, AuditErrors: s.auditErrors,
		Build: buildinfo.Normalize(build), TruthfulStatus: truthfulStatus, UpstreamMode: s.cfg.UpstreamMode, SignerAddress: s.signerAddr,
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

func (s *Service) PrepareBody(path string, body []byte) ([]byte, error) {
	if len(body) == 0 {
		return nil, fmt.Errorf("JSON request body is required")
	}
	var payload map[string]any
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return nil, fmt.Errorf("invalid JSON request body: %w", err)
	}
	if payload == nil {
		return nil, fmt.Errorf("JSON request body must be an object")
	}
	if key, _ := payload["idempotencyKey"].(string); strings.TrimSpace(key) == "" {
		return nil, fmt.Errorf("idempotencyKey is required for Pay mutations")
	}
	switch path {
	case "/pay/intents":
		if merchant, _ := payload["merchant"].(string); merchant != "" && merchant != s.cfg.MerchantID {
			return nil, fmt.Errorf("merchant does not match authenticated Pay merchant")
		}
		payload["merchant"] = s.cfg.MerchantID
	case "/pay/webhook-signatures":
		if supplied, _ := payload["signingKey"].(string); strings.TrimSpace(supplied) != "" {
			return nil, fmt.Errorf("signingKey is managed by ynx-payd and must not be supplied")
		}
		if s.cfg.UpstreamMode == UpstreamAuthoritative {
			payload["signingKey"] = s.cfg.WebhookSigningKey
		} else {
			delete(payload, "signingKey")
		}
	}
	return json.Marshal(payload)
}

func (s *Service) Proxy(ctx context.Context, method, path, rawQuery string, body []byte, requestID string) (*http.Response, error) {
	if s.cfg.UpstreamMode == UpstreamBFT && method == http.MethodPost {
		if strings.HasPrefix(path, "/pay/invoices/") && strings.HasSuffix(path, "/settle") {
			return nil, errors.New("invoice settlement is not implemented for candidate BFT Pay mode")
		}
		return s.proxyBFTMutation(ctx, path, body, requestID)
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
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	if s.cfg.UpstreamMode == UpstreamAuthoritative {
		req.Header.Set("X-YNX-Pay-Gateway-Upstream-Key", s.cfg.UpstreamKey)
	}
	return s.httpClient.Do(req)
}

func (s *Service) proxyBFTMutation(ctx context.Context, path string, body []byte, requestID string) (*http.Response, error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	if s.signer == nil {
		return nil, errors.New("BFT Pay signer is unavailable")
	}
	action, payload, key, requestHash, err := s.bftPayPayload(path, body)
	if err != nil {
		return nil, err
	}
	if replay, found, err := s.bftIdempotencyReplay(ctx, action, key, requestHash); err != nil {
		return nil, err
	} else if found {
		return replay, nil
	}
	account, err := s.bftSignerAccount(ctx)
	if err != nil {
		return nil, err
	}
	if account.Nonce == math.MaxUint64 {
		return nil, errors.New("BFT Pay signer nonce exhausted")
	}
	tx, err := consensus.NewSignedApplicationAction(s.signer, s.cfg.ChainID, action, payload, account.Nonce+1)
	if err != nil {
		return nil, err
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.ChainURL+path, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return resp, nil
	}
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 2*MaxBodyBytes+1))
	_ = resp.Body.Close()
	if err != nil || len(responseBody) > 2*MaxBodyBytes {
		return nil, errors.New("BFT Pay response exceeds limit")
	}
	if err := verifyBFTPayResponse(action, tx, raw, responseBody, s.cfg.MerchantID); err != nil {
		return nil, err
	}
	resp.Body, resp.ContentLength = io.NopCloser(bytes.NewReader(responseBody)), int64(len(responseBody))
	return resp, nil
}

func (s *Service) bftPayPayload(path string, body []byte) (string, any, string, string, error) {
	decode := func(out any) error {
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(out); err != nil {
			return err
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			return errors.New("Pay mutation must contain one JSON value")
		}
		return nil
	}
	switch path {
	case "/pay/intents":
		var in struct {
			Merchant       string `json:"merchant"`
			Amount         int64  `json:"amount"`
			CallbackURL    string `json:"callbackUrl"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := decode(&in); err != nil {
			return "", nil, "", "", err
		}
		if in.Merchant != s.cfg.MerchantID {
			return "", nil, "", "", errors.New("Pay merchant binding mismatch")
		}
		p := consensus.PayIntentPayload{Merchant: in.Merchant, Amount: in.Amount, Currency: "YNXT", CallbackURL: in.CallbackURL, IdempotencyKey: in.IdempotencyKey}
		p.RequestHash = consensus.PayIntentRequestHash(p.Merchant, p.Amount, p.Currency, p.CallbackURL, p.IdempotencyKey)
		return consensus.ActionPayIntentCreate, p, p.IdempotencyKey, p.RequestHash, nil
	case "/pay/invoices":
		var in struct {
			IntentID       string `json:"intentId"`
			DueInHours     int64  `json:"dueInHours"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := decode(&in); err != nil {
			return "", nil, "", "", err
		}
		if in.DueInHours <= 0 {
			in.DueInHours = 24
		}
		p := consensus.PayInvoicePayload{Merchant: s.cfg.MerchantID, IntentID: in.IntentID, DueInHours: in.DueInHours, IdempotencyKey: in.IdempotencyKey}
		p.RequestHash = consensus.PayInvoiceRequestHash(p.Merchant, p.IntentID, p.DueInHours, p.IdempotencyKey)
		return consensus.ActionPayInvoiceCreate, p, p.IdempotencyKey, p.RequestHash, nil
	case "/pay/refunds":
		var in struct {
			IntentID       string `json:"intentId"`
			Amount         int64  `json:"amount"`
			Reason         string `json:"reason"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := decode(&in); err != nil {
			return "", nil, "", "", err
		}
		p := consensus.PayRefundPayload{Merchant: s.cfg.MerchantID, IntentID: in.IntentID, Amount: in.Amount, Reason: in.Reason, IdempotencyKey: in.IdempotencyKey}
		p.RequestHash = consensus.PayRefundRequestHash(p.Merchant, p.IntentID, p.Amount, p.Reason, p.IdempotencyKey)
		return consensus.ActionPayRefundCreate, p, p.IdempotencyKey, p.RequestHash, nil
	case "/pay/webhook-signatures":
		var in struct {
			IntentID       string `json:"intentId"`
			EventType      string `json:"eventType"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := decode(&in); err != nil {
			return "", nil, "", "", err
		}
		requestHash := consensus.PayWebhookRequestHash(s.cfg.MerchantID, in.IntentID, in.EventType, in.IdempotencyKey)
		signedAt := time.Now().UTC()
		eventID, payloadHash, message := consensus.PayWebhookMaterial(s.cfg.MerchantID, in.IntentID, in.EventType, in.IdempotencyKey, signedAt)
		mac := hmac.New(sha256.New, []byte(s.cfg.WebhookSigningKey))
		_, _ = mac.Write(message)
		p := consensus.PayWebhookPayload{Merchant: s.cfg.MerchantID, IntentID: in.IntentID, EventType: in.EventType, IdempotencyKey: in.IdempotencyKey, EventID: eventID, PayloadHash: payloadHash, Signature: hex.EncodeToString(mac.Sum(nil)), SignedAt: signedAt, Algorithm: "hmac-sha256", RequestHash: requestHash}
		return consensus.ActionPayWebhookRecord, p, p.IdempotencyKey, p.RequestHash, nil
	default:
		return "", nil, "", "", errors.New("unsupported BFT Pay mutation route")
	}
}

func (s *Service) bftIdempotencyReplay(ctx context.Context, action, key, requestHash string) (*http.Response, bool, error) {
	endpoint := s.cfg.ChainURL + "/pay/idempotency?" + url.Values{"merchant": {s.cfg.MerchantID}, "key": {key}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, false, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, false, fmt.Errorf("BFT Pay idempotency query returned %d", resp.StatusCode)
	}
	var record consensus.BFTPayIdempotency
	if err := json.NewDecoder(io.LimitReader(resp.Body, MaxBodyBytes)).Decode(&record); err != nil {
		return nil, false, err
	}
	if record.Merchant != s.cfg.MerchantID || record.Signer != s.signerAddr || record.IdempotencyKey != key {
		return nil, false, errors.New("BFT Pay idempotency response mismatch")
	}
	if record.Action != action || record.RequestHash != requestHash {
		return jsonResponse(http.StatusConflict, map[string]string{"error": "idempotencyKey was already used with different Pay input"}), true, nil
	}
	objectPath := ""
	switch record.ObjectType {
	case "intent":
		objectPath = "/pay/intents/" + record.ObjectID
	case "invoice":
		objectPath = "/pay/invoices/" + record.ObjectID
	case "refund":
		objectPath = "/pay/refunds/" + record.ObjectID
	case "webhook":
		objectPath = "/pay/webhook-signatures/" + record.ObjectID
	default:
		return nil, false, errors.New("BFT Pay idempotency object type mismatch")
	}
	objectReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+objectPath, nil)
	objectResp, err := s.httpClient.Do(objectReq)
	if err != nil {
		return nil, false, err
	}
	defer objectResp.Body.Close()
	if objectResp.StatusCode != http.StatusOK {
		return nil, false, errors.New("BFT Pay replay object is unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(objectResp.Body, 2*MaxBodyBytes))
	if err != nil {
		return nil, false, err
	}
	return rawJSONResponse(http.StatusCreated, raw), true, nil
}

func (s *Service) bftSignerAccount(ctx context.Context) (chain.ConsensusAccount, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/accounts/"+s.signerAddr, nil)
	if err != nil {
		return chain.ConsensusAccount{}, err
	}
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return chain.ConsensusAccount{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return chain.ConsensusAccount{}, fmt.Errorf("BFT Pay signer account query returned %d", resp.StatusCode)
	}
	var account chain.ConsensusAccount
	if err := json.NewDecoder(io.LimitReader(resp.Body, MaxBodyBytes)).Decode(&account); err != nil {
		return account, err
	}
	if account.Address != s.signerAddr {
		return account, errors.New("BFT Pay signer account mismatch")
	}
	return account, nil
}

func verifyBFTPayResponse(action string, tx consensus.SignedApplicationAction, raw, response []byte, merchant string) error {
	hash := consensus.ApplicationActionHash(raw)
	switch action {
	case consensus.ActionPayIntentCreate:
		var v consensus.BFTPayIntent
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("pay-intent", hash) || v.Signer != tx.Signer || v.Merchant != merchant || v.TxHash != hash {
			return errors.New("BFT Pay intent response mismatch")
		}
	case consensus.ActionPayInvoiceCreate:
		var v consensus.BFTPayInvoice
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("pay-invoice", hash) || v.Signer != tx.Signer || v.Merchant != merchant || v.TxHash != hash {
			return errors.New("BFT Pay invoice response mismatch")
		}
	case consensus.ActionPayRefundCreate:
		var v consensus.BFTPayRefund
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("pay-refund", hash) || v.Signer != tx.Signer || v.Merchant != merchant || v.TxHash != hash {
			return errors.New("BFT Pay refund response mismatch")
		}
	case consensus.ActionPayWebhookRecord:
		var p consensus.PayWebhookPayload
		_ = json.Unmarshal(tx.Payload, &p)
		var v consensus.BFTPayWebhook
		if json.Unmarshal(response, &v) != nil || v.EventID != p.EventID || v.Signer != tx.Signer || v.Merchant != merchant || v.TxHash != hash || v.Signature != p.Signature {
			return errors.New("BFT Pay webhook response mismatch")
		}
	}
	return nil
}

func jsonResponse(status int, value any) *http.Response {
	raw, _ := json.Marshal(value)
	return rawJSONResponse(status, append(raw, '\n'))
}
func rawJSONResponse(status int, raw []byte) *http.Response {
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(bytes.NewReader(raw)), ContentLength: int64(len(raw))}
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
	entry.At = entry.At.UTC()
	entry.RemoteIP = clientIP(entry.RemoteIP)
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
		return fmt.Sprintf("pay-%d", time.Now().UnixNano())
	}
	return "pay-" + hex.EncodeToString(buf)
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
func validServiceURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return fmt.Errorf("must be an absolute http(s) URL")
	}
	return nil
}
