package trustgateway

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
		return Config{}, fmt.Errorf("YNX_TRUST_GATEWAY_CHAIN_URL must be an absolute http(s) URL")
	}
	if strings.TrimSpace(c.APIKey) == "" {
		return Config{}, fmt.Errorf("YNX_TRUST_API_KEY is required for ynx-trustd")
	}
	c.UpstreamMode = strings.ToLower(strings.TrimSpace(c.UpstreamMode))
	if c.UpstreamMode == "" {
		c.UpstreamMode = UpstreamAuthoritative
	}
	if c.UpstreamMode != UpstreamAuthoritative && c.UpstreamMode != UpstreamBFT {
		return Config{}, errors.New("Trust upstream mode must be authoritative or bft")
	}
	if c.UpstreamMode == UpstreamAuthoritative && strings.TrimSpace(c.UpstreamKey) == "" {
		return Config{}, fmt.Errorf("YNX_TRUST_GATEWAY_UPSTREAM_KEY is required for ynx-trustd")
	}
	if c.UpstreamMode == UpstreamBFT {
		if (strings.TrimSpace(c.SignerKey) == "") == (strings.TrimSpace(c.SignerKeyPath) == "") {
			return Config{}, errors.New("BFT Trust Gateway requires exactly one signer key source")
		}
		if !consensus.IsNativeAddress(strings.TrimSpace(c.SignerAddress)) {
			return Config{}, errors.New("BFT Trust Gateway requires canonical signer address")
		}
		if c.ChainID == 0 {
			c.ChainID = 6423
		}
		if c.ChainID != 6423 {
			return Config{}, errors.New("BFT Trust Gateway chain ID must equal 6423")
		}
	}
	if c.AuditLog == "" {
		c.AuditLog = "tmp/trust-gateway/audit.jsonl"
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
		signer, address, err := loadBFTTrustSigner(normalized)
		if err != nil {
			return nil, err
		}
		service.signer, service.signerAddr = signer, address
		service.cfg.SignerKey = ""
	}
	return service, nil
}

func loadBFTTrustSigner(cfg Config) (*secp256k1.PrivateKey, string, error) {
	var keyBytes []byte
	if path := strings.TrimSpace(cfg.SignerKeyPath); path != "" {
		info, err := os.Stat(path)
		if err != nil {
			return nil, "", fmt.Errorf("stat BFT Trust signer key: %w", err)
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return nil, "", errors.New("BFT Trust signer key file must be regular and mode-restricted")
		}
		keyBytes, err = os.ReadFile(path)
		if err != nil {
			return nil, "", fmt.Errorf("read BFT Trust signer key: %w", err)
		}
	} else {
		var err error
		keyBytes, err = hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(cfg.SignerKey), "0x"))
		if err != nil {
			return nil, "", errors.New("BFT Trust signer key must be canonical hex")
		}
	}
	defer clear(keyBytes)
	if len(keyBytes) != 32 || bytes.Equal(keyBytes, make([]byte, 32)) {
		return nil, "", errors.New("BFT Trust signer key must be one non-zero 32-byte scalar")
	}
	privateKey := secp256k1.PrivKeyFromBytes(keyBytes)
	if !bytes.Equal(privateKey.Serialize(), keyBytes) {
		return nil, "", errors.New("BFT Trust signer key scalar is outside canonical range")
	}
	address, err := consensus.NativeAddress(privateKey.PubKey().SerializeCompressed())
	if err != nil {
		return nil, "", err
	}
	if address != strings.TrimSpace(cfg.SignerAddress) {
		return nil, "", errors.New("BFT Trust signer address does not match private key")
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
	OK               bool           `json:"ok"`
	Service          string         `json:"service"`
	ChainID          int64          `json:"chainId,omitempty"`
	Height           uint64         `json:"height,omitempty"`
	Network          string         `json:"network,omitempty"`
	NativeSymbol     string         `json:"nativeSymbol"`
	UpstreamOK       bool           `json:"upstreamOk"`
	RateLimit        string         `json:"rateLimit"`
	BodyLimitBytes   int            `json:"bodyLimitBytes"`
	ExportLimitBytes int            `json:"exportLimitBytes"`
	AuditLog         string         `json:"auditLog"`
	Requests         int64          `json:"requests"`
	Successes        int64          `json:"successes"`
	Denied           int64          `json:"denied"`
	Errors           int64          `json:"errors"`
	Active           int64          `json:"active"`
	AuditErrors      int64          `json:"auditErrors"`
	Build            buildinfo.Info `json:"build"`
	TruthfulStatus   string         `json:"truthfulStatus"`
	Error            string         `json:"error,omitempty"`
	UpstreamMode     string         `json:"upstreamMode"`
	SignerAddress    string         `json:"signerAddress,omitempty"`
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
		Service: "ynx-trustd", NativeSymbol: "YNXT", RateLimit: fmt.Sprintf("%d per %s per api-key/ip", s.cfg.MaxRequests, s.cfg.Window),
		BodyLimitBytes: MaxBodyBytes, ExportLimitBytes: MaxResponseBytes, AuditLog: s.cfg.AuditLog,
		Requests: s.requests, Successes: s.successes, Denied: s.denied, Errors: s.errors, Active: s.active, AuditErrors: s.auditErrors,
		Build: buildinfo.Normalize(build), TruthfulStatus: trustTruthfulStatus(s.cfg.UpstreamMode), UpstreamMode: s.cfg.UpstreamMode, SignerAddress: s.signerAddr,
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
		return s.proxyBFTTrustMutation(ctx, path, body, requestID)
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
		req.Header.Set("X-YNX-Trust-Gateway-Upstream-Key", s.cfg.UpstreamKey)
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
		return ProxyResponse{}, fmt.Errorf("Trust response or evidence export exceeds %d bytes", MaxResponseBytes)
	}
	return ProxyResponse{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), Body: payload}, nil
}

func (s *Service) proxyBFTTrustMutation(ctx context.Context, path string, body []byte, requestID string) (ProxyResponse, error) {
	s.mutationMu.Lock()
	defer s.mutationMu.Unlock()
	if s.signer == nil {
		return ProxyResponse{}, errors.New("BFT Trust signer is unavailable")
	}
	action, payload, err := s.bftTrustPayload(path, body)
	if err != nil {
		return ProxyResponse{}, err
	}
	account, err := s.bftTrustSignerAccount(ctx)
	if err != nil {
		return ProxyResponse{}, err
	}
	if account.Nonce == math.MaxUint64 {
		return ProxyResponse{}, errors.New("BFT Trust signer nonce exhausted")
	}
	tx, err := consensus.NewSignedApplicationAction(s.signer, s.cfg.ChainID, action, payload, account.Nonce+1)
	if err != nil {
		return ProxyResponse{}, err
	}
	raw, err := consensus.EncodeSignedApplicationAction(tx)
	if err != nil {
		return ProxyResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.ChainURL+path, bytes.NewReader(raw))
	if err != nil {
		return ProxyResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Request-ID", requestID)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ProxyResponse{}, err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, MaxResponseBytes+1))
	if err != nil || len(responseBody) > MaxResponseBytes {
		return ProxyResponse{}, errors.New("BFT Trust response exceeds limit")
	}
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		if err := verifyBFTTrustResponse(action, tx, raw, responseBody); err != nil {
			return ProxyResponse{}, err
		}
	}
	return ProxyResponse{Status: resp.StatusCode, ContentType: resp.Header.Get("Content-Type"), Body: responseBody}, nil
}

func (s *Service) bftTrustPayload(path string, body []byte) (string, any, error) {
	decode := func(out any) error {
		decoder := json.NewDecoder(bytes.NewReader(body))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(out); err != nil {
			return err
		}
		if decoder.Decode(&struct{}{}) != io.EOF {
			return errors.New("Trust mutation must contain one JSON value")
		}
		return nil
	}
	switch {
	case path == "/governance/requests":
		var in chain.GovernanceRequestInput
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionGovernanceCreate, consensus.GovernanceRequestPayload{Requester: s.signerAddr, Subject: in.Subject, Action: in.Action, AssetType: in.AssetType, Scope: in.Scope, Description: in.Description, Evidence: in.Evidence}, nil
	case strings.HasPrefix(path, "/governance/requests/") && strings.HasSuffix(path, "/review"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/governance/requests/"), "/review")
		var in struct{}
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionGovernanceReview, consensus.GovernanceDecisionPayload{RequestID: id, Reviewer: s.signerAddr}, nil
	case strings.HasPrefix(path, "/governance/requests/") && strings.HasSuffix(path, "/reject"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/governance/requests/"), "/reject")
		var in struct {
			Reason string `json:"reason"`
		}
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionGovernanceReject, consensus.GovernanceDecisionPayload{RequestID: id, Reviewer: s.signerAddr, Reason: in.Reason}, nil
	case path == "/trust/appeals":
		var in chain.TrustAppealInput
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionTrustAppealCreate, consensus.TrustAppealPayload{RequestID: in.RequestID, LabelID: in.LabelID, Subject: in.Subject, Appellant: s.signerAddr, Claimant: s.signerAddr, Reason: in.Reason, Evidence: in.Evidence}, nil
	case path == "/trust/labels":
		var in chain.RiskLabelInput
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionTrustLabelCreate, consensus.TrustLabelPayload{Issuer: s.signerAddr, Subject: in.Subject, SubjectType: in.SubjectType, Address: in.Address, Label: in.Label, LabelType: in.LabelType, Severity: in.Severity, RiskWeightBps: in.RiskWeightBps, ConfidenceBps: in.ConfidenceBps, Source: in.Source, EvidenceHash: in.EvidenceHash, ExpiryHours: in.ExpiryHours, ReviewRequired: in.ReviewRequired, AppealAvailable: true, DisputeStatus: in.DisputeStatus, LegalStatusUnderYNXChainLaw: in.LegalStatusUnderYNXChainLaw, RejectedExternalRequestReference: in.RejectedExternalRequestReference, AssetEffect: in.AssetEffect}, nil
	case path == "/trust/evidence":
		var in struct {
			Subject string `json:"subject"`
		}
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionTrustEvidenceCreate, consensus.TrustEvidencePayload{Requester: s.signerAddr, Subject: in.Subject}, nil
	case path == "/trust/tracking-reviews":
		var in chain.TrackingPolicyReviewInput
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionTrustTrackingCreate, consensus.TrustTrackingPayload{Requester: s.signerAddr, Subject: in.Subject, Purpose: in.Purpose, QueryType: in.QueryType, Scope: in.Scope, Description: in.Description, Evidence: in.Evidence, Institutional: in.Institutional, Sensitive: in.Sensitive, MinimumNecessary: in.MinimumNecessary, ConfidenceBps: in.ConfidenceBps, ExpiryHours: in.ExpiryHours}, nil
	case strings.HasPrefix(path, "/trust/appeals/") && strings.HasSuffix(path, "/resolve"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/trust/appeals/"), "/resolve")
		var in chain.TrustAppealDecisionInput
		if err := decode(&in); err != nil {
			return "", nil, err
		}
		return consensus.ActionTrustAppealResolve, consensus.TrustAppealDecisionPayload{AppealID: id, Reviewer: s.signerAddr, Decision: in.Decision, ResolutionReason: in.ResolutionReason}, nil
	default:
		return "", nil, errors.New("Trust mutation route is not BFT-backed")
	}
}

func (s *Service) bftTrustSignerAccount(ctx context.Context) (chain.ConsensusAccount, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.ChainURL+"/accounts/"+s.signerAddr, nil)
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return chain.ConsensusAccount{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return chain.ConsensusAccount{}, fmt.Errorf("BFT Trust signer account query returned %d", resp.StatusCode)
	}
	var account chain.ConsensusAccount
	if err := json.NewDecoder(io.LimitReader(resp.Body, MaxBodyBytes)).Decode(&account); err != nil {
		return account, err
	}
	if account.Address != s.signerAddr {
		return account, errors.New("BFT Trust signer account mismatch")
	}
	return account, nil
}

func verifyBFTTrustResponse(action string, tx consensus.SignedApplicationAction, raw, response []byte) error {
	txHash := consensus.ApplicationActionHash(raw)
	switch action {
	case consensus.ActionGovernanceCreate:
		var v consensus.BFTGovernanceRequest
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("governance-request", txHash) || v.Signer != tx.Signer || v.TxHash != txHash {
			return errors.New("BFT governance response mismatch")
		}
	case consensus.ActionGovernanceReview, consensus.ActionGovernanceReject:
		var v consensus.BFTGovernanceRequest
		if json.Unmarshal(response, &v) != nil || v.Reviewer != tx.Signer || v.TxHash != txHash {
			return errors.New("BFT governance decision response mismatch")
		}
	case consensus.ActionTrustAppealCreate:
		var v consensus.BFTTrustAppeal
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("trust-appeal", txHash) || v.Signer != tx.Signer || v.TxHash != txHash {
			return errors.New("BFT Trust appeal response mismatch")
		}
	case consensus.ActionTrustAppealResolve:
		var v consensus.BFTTrustAppeal
		if json.Unmarshal(response, &v) != nil || v.ReviewerSigner != tx.Signer || v.TxHash != txHash {
			return errors.New("BFT Trust resolution response mismatch")
		}
	case consensus.ActionTrustLabelCreate:
		var v consensus.BFTTrustLabel
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("trust-label", txHash) || v.Signer != tx.Signer || v.Issuer != tx.Signer || v.TxHash != txHash || v.AssetEffect != "none_advisory_only" || !v.AppealAvailable {
			return errors.New("BFT Trust label response mismatch")
		}
	case consensus.ActionTrustEvidenceCreate:
		var v consensus.BFTTrustEvidence
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("trust-evidence", txHash) || v.Signer != tx.Signer || v.Requester != tx.Signer || v.TxHash != txHash || v.JSONHash == "" {
			return errors.New("BFT Trust evidence response mismatch")
		}
	case consensus.ActionTrustTrackingCreate:
		var v consensus.BFTTrackingReview
		if json.Unmarshal(response, &v) != nil || v.ID != consensus.ApplicationActionRecordID("tracking-review", txHash) || v.Signer != tx.Signer || v.Requester != tx.Signer || v.TxHash != txHash || v.AppealPath != "/trust/appeals" {
			return errors.New("BFT Trust tracking response mismatch")
		}
	default:
		return errors.New("unsupported BFT Trust response")
	}
	return nil
}

func trustTruthfulStatus(mode string) string {
	if mode == UpstreamBFT {
		return "signed-bft-full-trust-surface-local-implementation-awaiting-remote-proof"
	}
	return "authenticated-chain-backed-trust-and-chain-law-gateway"
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
		return fmt.Sprintf("trust-%d", time.Now().UnixNano())
	}
	return "trust-" + hex.EncodeToString(buf)
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
