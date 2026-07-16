package resourceproduct

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const maxBody = 1 << 20

var resourceTypes = map[string]bool{"Bandwidth": true, "Compute": true, "AI Credits": true, "Trust Credits": true, "Pay Credits": true}

type Config struct {
	StorePath, AIURL, AIKey, AIModel string
	Sessions                         map[string]Actor
	AllowHeaderAuth                  bool
	CentralGatewayURL                string
	CentralClientID                  string
	Now                              func() time.Time
}
type Actor struct{ ID, Role string }
type Audit struct {
	ID      string    `json:"id"`
	Actor   string    `json:"actor"`
	Role    string    `json:"role"`
	Action  string    `json:"action"`
	Target  string    `json:"target"`
	Outcome string    `json:"outcome"`
	At      time.Time `json:"at"`
}
type CentralSession struct {
	ID        string    `json:"id"`
	TokenHash string    `json:"tokenHash"`
	Account   string    `json:"account"`
	DeviceID  string    `json:"deviceId"`
	Scopes    []string  `json:"scopes"`
	ExpiresAt time.Time `json:"expiresAt"`
	Status    string    `json:"status"`
}
type AuthorityAudit struct {
	ID           string    `json:"id"`
	Actor        string    `json:"actor"`
	Method       string    `json:"method"`
	Path         string    `json:"path"`
	RequestHash  string    `json:"requestHash"`
	ResponseHash string    `json:"responseHash,omitempty"`
	Status       int       `json:"status"`
	Outcome      string    `json:"outcome"`
	At           time.Time `json:"at"`
}
type PurchaseIntent struct {
	ID                string    `json:"id"`
	Owner             string    `json:"owner"`
	Kind              string    `json:"kind"`
	IdempotencyKey    string    `json:"idempotencyKey"`
	RequestHash       string    `json:"requestHash"`
	Status            string    `json:"status"`
	AuthorityPath     string    `json:"authorityPath"`
	AuthorityObjectID string    `json:"authorityObjectId,omitempty"`
	TransactionHash   string    `json:"transactionHash,omitempty"`
	FeeSettlement     string    `json:"feeSettlement"`
	Attempts          int       `json:"attempts"`
	LastError         string    `json:"lastError,omitempty"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}
type Policy struct {
	AllowedBeneficiaries []string `json:"allowedBeneficiaries"`
	MaxPerGrant          int64    `json:"maxPerGrant"`
	Revocable            bool     `json:"revocable"`
	Version              int      `json:"version"`
}
type Pool struct {
	ID           string    `json:"id"`
	Owner        string    `json:"owner"`
	ResourceType string    `json:"resourceType"`
	Limit        int64     `json:"limit"`
	Available    int64     `json:"available"`
	Source       string    `json:"source"`
	Expiry       time.Time `json:"expiry"`
	Fee          int64     `json:"fee"`
	Status       string    `json:"status"`
	Policy       Policy    `json:"policy"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Audit        []string  `json:"audit"`
}
type Record struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	Owner         string    `json:"owner"`
	Beneficiary   string    `json:"beneficiary"`
	ResourceType  string    `json:"resourceType"`
	Limit         int64     `json:"limit"`
	Source        string    `json:"source"`
	Expiry        time.Time `json:"expiry"`
	Fee           int64     `json:"fee"`
	PoolID        string    `json:"poolId,omitempty"`
	Status        string    `json:"status"`
	Settlement    string    `json:"settlement"`
	PolicyVersion int       `json:"policyVersion"`
	Dispute       *Dispute  `json:"dispute,omitempty"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
	Audit         []string  `json:"audit"`
}
type Dispute struct {
	ID         string `json:"id"`
	OpenedBy   string `json:"openedBy"`
	Reason     string `json:"reason"`
	Status     string `json:"status"`
	Reviewer   string `json:"reviewer,omitempty"`
	Resolution string `json:"resolution,omitempty"`
}
type AIRecord struct {
	ID               string    `json:"id"`
	Owner            string    `json:"owner"`
	Intent           string    `json:"intent"`
	Context          []string  `json:"context"`
	PrivacyPreview   string    `json:"privacyPreview"`
	Provider         string    `json:"provider"`
	Model            string    `json:"model"`
	OutputLanguage   string    `json:"outputLanguage"`
	EstimatedCredits int       `json:"estimatedCredits"`
	Permission       bool      `json:"permission"`
	Status           string    `json:"status"`
	Result           string    `json:"result,omitempty"`
	Error            string    `json:"error,omitempty"`
	Review           string    `json:"review,omitempty"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}
type replay struct{ Digest, Kind, ID string }
type snapshot struct {
	Version        int                       `json:"version"`
	Pools          map[string]Pool           `json:"pools"`
	Records        map[string]Record         `json:"records"`
	AI             map[string]AIRecord       `json:"ai"`
	Audit          []Audit                   `json:"audit"`
	Sessions       map[string]CentralSession `json:"sessions"`
	AuthorityAudit []AuthorityAudit          `json:"authorityAudit"`
	Intents        map[string]PurchaseIntent `json:"intents"`
	Replay         map[string]replay         `json:"replay"`
	Sequence       uint64                    `json:"sequence"`
}
type Service struct {
	mu       sync.Mutex
	cfg      Config
	data     snapshot
	client   *http.Client
	sessions map[string]Actor
}

func New(cfg Config) (*Service, error) {
	if strings.TrimSpace(cfg.StorePath) == "" {
		return nil, errors.New("resource product store path is required")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.AIModel == "" {
		cfg.AIModel = "unconfigured"
	}
	cfg.CentralGatewayURL = strings.TrimRight(strings.TrimSpace(cfg.CentralGatewayURL), "/")
	if cfg.CentralGatewayURL != "" {
		if !strings.HasPrefix(cfg.CentralGatewayURL, "https://") && !strings.HasPrefix(cfg.CentralGatewayURL, "http://127.0.0.1:") && !strings.HasPrefix(cfg.CentralGatewayURL, "http://localhost:") {
			return nil, errors.New("central Gateway URL must use HTTPS or loopback HTTP")
		}
		if strings.TrimSpace(cfg.CentralClientID) == "" {
			return nil, errors.New("central Gateway client ID is required")
		}
	}
	s := &Service{cfg: cfg, client: &http.Client{Timeout: 20 * time.Second}, sessions: map[string]Actor{}, data: snapshot{Version: 1, Pools: map[string]Pool{}, Records: map[string]Record{}, AI: map[string]AIRecord{}, Replay: map[string]replay{}, Sessions: map[string]CentralSession{}, Intents: map[string]PurchaseIntent{}}}
	for token, actor := range cfg.Sessions {
		if strings.TrimSpace(token) == "" || strings.TrimSpace(actor.ID) == "" || strings.TrimSpace(actor.Role) == "" {
			return nil, errors.New("Resource session registry contains an invalid token or actor")
		}
		s.sessions[token] = actor
	}
	s.cfg.Sessions = nil
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}
func (s *Service) load() error {
	b, err := os.ReadFile(s.cfg.StorePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var d snapshot
	if err := json.Unmarshal(b, &d); err != nil {
		return fmt.Errorf("decode resource store: %w", err)
	}
	if d.Version != 1 {
		return fmt.Errorf("unsupported resource store version %d", d.Version)
	}
	if d.Pools == nil {
		d.Pools = map[string]Pool{}
	}
	if d.Records == nil {
		d.Records = map[string]Record{}
	}
	if d.AI == nil {
		d.AI = map[string]AIRecord{}
	}
	if d.Replay == nil {
		d.Replay = map[string]replay{}
	}
	if d.Sessions == nil {
		d.Sessions = map[string]CentralSession{}
	}
	if d.Intents == nil {
		d.Intents = map[string]PurchaseIntent{}
	}
	s.data = d
	return nil
}
func (s *Service) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.cfg.StorePath), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.cfg.StorePath + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.cfg.StorePath)
}
func (s *Service) nextLocked(p string) string {
	s.data.Sequence++
	return fmt.Sprintf("%s-%08d", p, s.data.Sequence)
}
func role(a Actor, rs ...string) bool {
	for _, r := range rs {
		if a.Role == r {
			return true
		}
	}
	return false
}

type Action struct {
	Type               string    `json:"type"`
	IdempotencyKey     string    `json:"idempotencyKey"`
	PoolID             string    `json:"poolId,omitempty"`
	RecordID           string    `json:"recordId,omitempty"`
	AIID               string    `json:"aiId,omitempty"`
	Owner              string    `json:"owner,omitempty"`
	Beneficiary        string    `json:"beneficiary,omitempty"`
	ResourceType       string    `json:"resourceType,omitempty"`
	Limit              int64     `json:"limit,omitempty"`
	Source             string    `json:"source,omitempty"`
	Expiry             time.Time `json:"expiry,omitempty"`
	Fee                int64     `json:"fee,omitempty"`
	Policy             Policy    `json:"policy,omitempty"`
	Reason             string    `json:"reason,omitempty"`
	Decision           string    `json:"decision,omitempty"`
	Context            []string  `json:"context,omitempty"`
	Permission         bool      `json:"permission,omitempty"`
	Language           string    `json:"language,omitempty"`
	BeneficiaryConsent bool      `json:"beneficiaryConsent,omitempty"`
}
type Result struct {
	Pool     *Pool     `json:"pool,omitempty"`
	Record   *Record   `json:"record,omitempty"`
	AI       *AIRecord `json:"ai,omitempty"`
	Replayed bool      `json:"replayed"`
}

func (s *Service) Do(a Actor, in Action) (Result, error) {
	if strings.TrimSpace(a.ID) == "" || strings.TrimSpace(a.Role) == "" {
		return Result{}, apiError{401, "actor and role are required"}
	}
	if in.IdempotencyKey == "" {
		return Result{}, apiError{400, "idempotencyKey is required"}
	}
	b, _ := json.Marshal(in)
	sum := sha256.Sum256(append([]byte(a.ID+"|"+a.Role+"|"), b...))
	digest := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.data.Replay[in.IdempotencyKey]; ok {
		if old.Digest != digest {
			return Result{}, apiError{409, "idempotency key reused with different input"}
		}
		return s.replayLocked(old), nil
	}
	res, kind, id, err := s.doLocked(a, in)
	if err != nil {
		return Result{}, err
	}
	s.data.Replay[in.IdempotencyKey] = replay{Digest: digest, Kind: kind, ID: id}
	if err := s.saveLocked(); err != nil {
		return Result{}, err
	}
	return res, nil
}
func (s *Service) replayLocked(r replay) Result {
	switch r.Kind {
	case "pool":
		x := s.data.Pools[r.ID]
		return Result{Pool: &x, Replayed: true}
	case "record":
		x := s.data.Records[r.ID]
		return Result{Record: &x, Replayed: true}
	case "ai":
		x := s.data.AI[r.ID]
		return Result{AI: &x, Replayed: true}
	}
	return Result{Replayed: true}
}
func (s *Service) auditLocked(a Actor, action, target, outcome string) string {
	id := s.nextLocked("audit")
	s.data.Audit = append(s.data.Audit, Audit{ID: id, Actor: a.ID, Role: a.Role, Action: action, Target: target, Outcome: outcome, At: s.cfg.Now().UTC()})
	return id
}
func (s *Service) storeCentralSession(token string, v CentralSession) error {
	sum := sha256.Sum256([]byte(token))
	v.TokenHash = hex.EncodeToString(sum[:])
	v.Status = "active"
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Sessions[v.ID] = v
	return s.saveLocked()
}
func (s *Service) authenticateCentral(token, device string) (Actor, error) {
	token = strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	if token == "" || device == "" {
		return Actor{}, apiError{401, "central Wallet session and device are required"}
	}
	sum := sha256.Sum256([]byte(token))
	want := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	for _, v := range s.data.Sessions {
		if len(v.TokenHash) == len(want) && subtle.ConstantTimeCompare([]byte(v.TokenHash), []byte(want)) == 1 {
			if v.Status != "active" || v.DeviceID != device || !now.Before(v.ExpiresAt) {
				break
			}
			return Actor{ID: v.Account, Role: "user"}, nil
		}
	}
	return Actor{}, apiError{401, "central Wallet session is invalid, expired or revoked"}
}
func (s *Service) revokeCentral(token, device string) error {
	a, err := s.authenticateCentral(token, device)
	if err != nil {
		return err
	}
	clean := strings.TrimSpace(strings.TrimPrefix(token, "Bearer "))
	sum := sha256.Sum256([]byte(clean))
	want := hex.EncodeToString(sum[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, v := range s.data.Sessions {
		if len(v.TokenHash) == len(want) && subtle.ConstantTimeCompare([]byte(v.TokenHash), []byte(want)) == 1 && v.Account == a.ID {
			v.Status = "revoked"
			s.data.Sessions[id] = v
			return s.saveLocked()
		}
	}
	return apiError{404, "central session not found"}
}
func validResource(in Action, now time.Time) error {
	if !resourceTypes[in.ResourceType] {
		return apiError{422, "resourceType must be Bandwidth, Compute, AI Credits, Trust Credits or Pay Credits"}
	}
	if in.Limit <= 0 {
		return apiError{422, "limit must be positive"}
	}
	if in.Source == "" {
		return apiError{422, "source is required"}
	}
	if !in.Expiry.After(now) {
		return apiError{422, "future expiry is required"}
	}
	if in.Fee < 0 {
		return apiError{422, "fee cannot be negative"}
	}
	return nil
}
func contains(xs []string, x string) bool {
	if len(xs) == 0 {
		return true
	}
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func (s *Service) doLocked(a Actor, in Action) (Result, string, string, error) {
	now := s.cfg.Now().UTC()
	switch in.Type {
	case "stake":
		if !role(a, "user") {
			return Result{}, "", "", apiError{403, "user role required"}
		}
		if in.Owner != "" && in.Owner != a.ID {
			return Result{}, "", "", apiError{403, "staking owner must be actor"}
		}
		if err := validResource(in, now); err != nil {
			return Result{}, "", "", err
		}
		id := s.nextLocked("resource")
		r := Record{ID: id, Kind: "staking", Owner: a.ID, Beneficiary: a.ID, ResourceType: in.ResourceType, Limit: in.Limit, Source: in.Source, Expiry: in.Expiry.UTC(), Fee: in.Fee, Status: "active", Settlement: "capacity only; YNXT staking evidence is external and no asset is moved by this product", PolicyVersion: 1, CreatedAt: now, UpdatedAt: now}
		r.Audit = []string{s.auditLocked(a, in.Type, id, "active")}
		s.data.Records[id] = r
		return Result{Record: &r}, "record", id, nil
	case "create_pool":
		if !role(a, "user", "pool_operator") {
			return Result{}, "", "", apiError{403, "pool owner role required"}
		}
		if in.Owner != "" && in.Owner != a.ID {
			return Result{}, "", "", apiError{403, "pool owner must be actor"}
		}
		if err := validResource(in, now); err != nil {
			return Result{}, "", "", err
		}
		if in.Policy.MaxPerGrant <= 0 || in.Policy.MaxPerGrant > in.Limit {
			return Result{}, "", "", apiError{422, "bounded maxPerGrant is required"}
		}
		in.Policy.Version = 1
		id := s.nextLocked("pool")
		p := Pool{ID: id, Owner: a.ID, ResourceType: in.ResourceType, Limit: in.Limit, Available: in.Limit, Source: in.Source, Expiry: in.Expiry.UTC(), Fee: in.Fee, Status: "active", Policy: in.Policy, CreatedAt: now, UpdatedAt: now}
		p.Audit = []string{s.auditLocked(a, in.Type, id, "active")}
		s.data.Pools[id] = p
		return Result{Pool: &p}, "pool", id, nil
	case "update_policy":
		p, ok := s.data.Pools[in.PoolID]
		if !ok {
			return Result{}, "", "", apiError{404, "pool not found"}
		}
		if p.Owner != a.ID {
			return Result{}, "", "", apiError{403, "pool owner required"}
		}
		if p.Status != "active" {
			return Result{}, "", "", apiError{409, "pool is not active"}
		}
		if in.Policy.MaxPerGrant <= 0 || in.Policy.MaxPerGrant > p.Limit {
			return Result{}, "", "", apiError{422, "invalid maxPerGrant"}
		}
		in.Policy.Version = p.Policy.Version + 1
		p.Policy = in.Policy
		p.UpdatedAt = now
		p.Audit = append(p.Audit, s.auditLocked(a, in.Type, p.ID, "updated"))
		s.data.Pools[p.ID] = p
		return Result{Pool: &p}, "pool", p.ID, nil
	case "delegate", "rent", "sponsor":
		p, ok := s.data.Pools[in.PoolID]
		if !ok {
			return Result{}, "", "", apiError{404, "pool not found"}
		}
		if p.Status != "active" || !p.Expiry.After(now) {
			return Result{}, "", "", apiError{409, "pool unavailable or expired"}
		}
		if in.Beneficiary == "" || in.Limit <= 0 || in.Limit > p.Available || in.Limit > p.Policy.MaxPerGrant {
			return Result{}, "", "", apiError{422, "beneficiary and bounded available limit are required"}
		}
		if !contains(p.Policy.AllowedBeneficiaries, in.Beneficiary) {
			return Result{}, "", "", apiError{403, "beneficiary is outside pool policy"}
		}
		if in.Expiry.IsZero() || in.Expiry.After(p.Expiry) || !in.Expiry.After(now) {
			return Result{}, "", "", apiError{422, "grant expiry must be future and within pool expiry"}
		}
		if in.Type == "delegate" && p.Owner != a.ID {
			return Result{}, "", "", apiError{403, "pool owner required for delegation"}
		}
		if in.Type == "sponsor" {
			if p.Owner != a.ID {
				return Result{}, "", "", apiError{403, "pool owner required for sponsorship"}
			}
			if !in.BeneficiaryConsent {
				return Result{}, "", "", apiError{422, "beneficiary consent is required for sponsorship"}
			}
		}
		if in.Type == "rent" && in.Beneficiary != a.ID {
			return Result{}, "", "", apiError{403, "renter must be beneficiary"}
		}
		kind := map[string]string{"delegate": "delegation", "rent": "rental", "sponsor": "sponsorship"}[in.Type]
		id := s.nextLocked("resource")
		fee := p.Fee * in.Limit
		r := Record{ID: id, Kind: kind, Owner: p.Owner, Beneficiary: in.Beneficiary, ResourceType: p.ResourceType, Limit: in.Limit, Source: p.Source, Expiry: in.Expiry.UTC(), Fee: fee, PoolID: p.ID, Status: "active", Settlement: "fee quoted; external settlement not asserted", PolicyVersion: p.Policy.Version, CreatedAt: now, UpdatedAt: now}
		p.Available -= in.Limit
		p.UpdatedAt = now
		aid := s.auditLocked(a, in.Type, id, "active")
		r.Audit = []string{aid}
		p.Audit = append(p.Audit, aid)
		s.data.Records[id] = r
		s.data.Pools[p.ID] = p
		return Result{Record: &r}, "record", id, nil
	case "revoke":
		r, ok := s.data.Records[in.RecordID]
		if !ok {
			return Result{}, "", "", apiError{404, "resource record not found"}
		}
		if r.Owner != a.ID {
			return Result{}, "", "", apiError{403, "resource owner required"}
		}
		if r.Status != "active" {
			return Result{}, "", "", apiError{409, "resource record is not active"}
		}
		if r.PoolID != "" {
			p := s.data.Pools[r.PoolID]
			if !p.Policy.Revocable {
				return Result{}, "", "", apiError{403, "pool policy is not revocable"}
			}
			p.Available += r.Limit
			p.UpdatedAt = now
			s.data.Pools[p.ID] = p
		}
		r.Status = "revoked"
		r.UpdatedAt = now
		r.Audit = append(r.Audit, s.auditLocked(a, in.Type, r.ID, "revoked_capacity_only"))
		s.data.Records[r.ID] = r
		return Result{Record: &r}, "record", r.ID, nil
	case "revoke_pool":
		p, ok := s.data.Pools[in.PoolID]
		if !ok {
			return Result{}, "", "", apiError{404, "pool not found"}
		}
		if p.Owner != a.ID {
			return Result{}, "", "", apiError{403, "pool owner required"}
		}
		p.Status = "revoked"
		p.UpdatedAt = now
		p.Audit = append(p.Audit, s.auditLocked(a, in.Type, p.ID, "unused_capacity_revoked"))
		s.data.Pools[p.ID] = p
		return Result{Pool: &p}, "pool", p.ID, nil
	case "expire_resources":
		if !role(a, "auditor", "system") {
			return Result{}, "", "", apiError{403, "auditor or system role required"}
		}
		for id, p := range s.data.Pools {
			if p.Status == "active" && !p.Expiry.After(now) {
				p.Status = "expired"
				p.UpdatedAt = now
				p.Audit = append(p.Audit, s.auditLocked(a, in.Type, id, "expired"))
				s.data.Pools[id] = p
			}
		}
		for id, r := range s.data.Records {
			if r.Status == "active" && !r.Expiry.After(now) {
				r.Status = "expired"
				r.UpdatedAt = now
				r.Audit = append(r.Audit, s.auditLocked(a, in.Type, id, "expired"))
				s.data.Records[id] = r
			}
		}
		return Result{}, "", "", nil
	case "dispute":
		r, ok := s.data.Records[in.RecordID]
		if !ok {
			return Result{}, "", "", apiError{404, "resource record not found"}
		}
		if a.ID != r.Owner && a.ID != r.Beneficiary {
			return Result{}, "", "", apiError{403, "only owner or beneficiary may dispute"}
		}
		if in.Reason == "" {
			return Result{}, "", "", apiError{422, "dispute reason required"}
		}
		if r.Dispute != nil && r.Dispute.Status == "open" {
			return Result{}, "", "", apiError{409, "open dispute already exists"}
		}
		r.Dispute = &Dispute{ID: s.nextLocked("dispute"), OpenedBy: a.ID, Reason: in.Reason, Status: "open"}
		r.Status = "disputed"
		r.UpdatedAt = now
		r.Audit = append(r.Audit, s.auditLocked(a, in.Type, r.ID, "open"))
		s.data.Records[r.ID] = r
		return Result{Record: &r}, "record", r.ID, nil
	case "resolve_dispute":
		if !role(a, "dispute_reviewer") {
			return Result{}, "", "", apiError{403, "dispute_reviewer role required"}
		}
		r, ok := s.data.Records[in.RecordID]
		if !ok || r.Dispute == nil {
			return Result{}, "", "", apiError{404, "dispute not found"}
		}
		if a.ID == r.Owner || a.ID == r.Beneficiary {
			return Result{}, "", "", apiError{403, "owner or beneficiary cannot review dispute"}
		}
		if in.Decision != "upheld" && in.Decision != "rejected" {
			return Result{}, "", "", apiError{422, "decision must be upheld or rejected"}
		}
		r.Dispute.Status = in.Decision
		r.Dispute.Reviewer = a.ID
		r.Dispute.Resolution = in.Reason
		if in.Decision == "upheld" {
			r.Status = "revoked"
			if r.PoolID != "" {
				p := s.data.Pools[r.PoolID]
				p.Available += r.Limit
				if p.Available > p.Limit {
					p.Available = p.Limit
				}
				p.UpdatedAt = now
				s.data.Pools[p.ID] = p
			}
		} else {
			if r.Expiry.After(now) {
				r.Status = "active"
			} else {
				r.Status = "expired"
			}
		}
		r.UpdatedAt = now
		r.Audit = append(r.Audit, s.auditLocked(a, in.Type, r.ID, in.Decision))
		s.data.Records[r.ID] = r
		return Result{Record: &r}, "record", r.ID, nil
	case "ai_prepare":
		if !role(a, "user", "pool_operator") {
			return Result{}, "", "", apiError{403, "role cannot request Resource explanation"}
		}
		allowed := map[string]bool{"balances": true, "usage": true, "prices": true, "rental_options": true, "owned_history": true}
		for _, x := range in.Context {
			if !allowed[x] {
				return Result{}, "", "", apiError{422, "AI context exceeds Resource least privilege"}
			}
		}
		if len(in.Context) == 0 {
			return Result{}, "", "", apiError{422, "selected context required"}
		}
		provider := "unavailable"
		if s.cfg.AIURL != "" && s.cfg.AIKey != "" {
			provider = "YNX AI Gateway"
		}
		id := s.nextLocked("ai")
		language := normalizeLanguage(in.Language)
		if language == "" {
			return Result{}, "", "", apiError{422, "supported AI output language is required"}
		}
		x := AIRecord{ID: id, Owner: a.ID, Intent: in.Reason, Context: in.Context, PrivacyPreview: "Only selected capacity, price and owned history fields; wallet secrets and asset balances are excluded.", Provider: provider, Model: s.cfg.AIModel, OutputLanguage: language, EstimatedCredits: 2 + len(in.Context), Status: "prepared", CreatedAt: now, UpdatedAt: now}
		s.data.AI[id] = x
		s.auditLocked(a, in.Type, id, "prepared")
		return Result{AI: &x}, "ai", id, nil
	case "ai_run":
		x, ok := s.data.AI[in.AIID]
		if !ok {
			return Result{}, "", "", apiError{404, "AI record not found"}
		}
		if x.Owner != a.ID {
			return Result{}, "", "", apiError{403, "AI record owner required"}
		}
		if !in.Permission {
			return Result{}, "", "", apiError{422, "explicit AI permission required"}
		}
		if s.cfg.AIURL == "" || s.cfg.AIKey == "" {
			x.Status = "failed"
			x.Error = "YNX AI Gateway is unavailable or not configured"
			x.UpdatedAt = now
			s.data.AI[x.ID] = x
			s.auditLocked(a, in.Type, x.ID, "provider_unavailable")
			return Result{AI: &x}, "ai", x.ID, nil
		}
		x.Permission = true
		x.Status = "running"
		x.UpdatedAt = now
		s.data.AI[x.ID] = x
		if err := s.saveLocked(); err != nil {
			return Result{}, "", "", err
		}
		s.mu.Unlock()
		ans, err := s.askAI(x)
		s.mu.Lock()
		x = s.data.AI[x.ID]
		if err != nil {
			x.Status = "failed"
			x.Error = err.Error()
		} else {
			x.Status = "completed"
			x.Result = ans
		}
		x.UpdatedAt = s.cfg.Now().UTC()
		s.data.AI[x.ID] = x
		s.auditLocked(a, in.Type, x.ID, x.Status)
		return Result{AI: &x}, "ai", x.ID, nil
	case "ai_cancel":
		x, ok := s.data.AI[in.AIID]
		if !ok {
			return Result{}, "", "", apiError{404, "AI record not found"}
		}
		if x.Owner != a.ID {
			return Result{}, "", "", apiError{403, "AI record owner required"}
		}
		x.Status = "cancelled"
		x.UpdatedAt = now
		s.data.AI[x.ID] = x
		s.auditLocked(a, in.Type, x.ID, "cancelled")
		return Result{AI: &x}, "ai", x.ID, nil
	case "ai_review":
		x, ok := s.data.AI[in.AIID]
		if !ok {
			return Result{}, "", "", apiError{404, "AI record not found"}
		}
		if x.Owner != a.ID || x.Status != "completed" {
			return Result{}, "", "", apiError{409, "completed owner explanation required"}
		}
		if in.Decision != "apply" && in.Decision != "reject" {
			return Result{}, "", "", apiError{422, "review must apply or reject"}
		}
		x.Review = in.Decision
		if in.Decision == "apply" {
			x.Status = "applied"
		} else {
			x.Status = "rejected"
		}
		x.UpdatedAt = now
		s.data.AI[x.ID] = x
		s.auditLocked(a, in.Type, x.ID, x.Status)
		return Result{AI: &x}, "ai", x.ID, nil
	default:
		return Result{}, "", "", apiError{400, "unknown action type"}
	}
}

func (s *Service) askAI(x AIRecord) (string, error) {
	prompt := fmt.Sprintf("Explain resource usage, cost and rental options for %s using only %s. Respond in %s. Never rent, stake, transfer or sponsor automatically.", x.Intent, strings.Join(x.Context, ","), x.OutputLanguage)
	body, _ := json.Marshal(map[string]any{"session": x.ID, "prompt": prompt, "context": x.Context, "outputLanguage": x.OutputLanguage})
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(s.cfg.AIURL, "/")+"/ai/stream", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.AIKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return "", err
	}
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("AI Gateway returned %d", resp.StatusCode)
	}
	var out bytes.Buffer
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "data: ") {
			var v map[string]any
			if json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &v) == nil {
				if t, ok := v["text"].(string); ok {
					out.WriteString(t)
				}
				if t, ok := v["delta"].(string); ok {
					out.WriteString(t)
				}
			}
		}
	}
	if out.Len() == 0 {
		return "", errors.New("AI Gateway returned no explanation")
	}
	return out.String(), nil
}

var supportedLanguages = map[string]bool{"en": true, "zh-Hans": true, "zh-Hant": true, "ja": true, "ko": true, "es": true, "fr": true, "de": true, "pt": true, "ru": true, "ar": true, "id": true}

func normalizeLanguage(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		v = "en"
	}
	if supportedLanguages[v] {
		return v
	}
	return ""
}
func (s *Service) View(a Actor) (map[string]any, error) {
	if a.ID == "" || a.Role == "" {
		return nil, apiError{401, "actor and role are required"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	pools := []Pool{}
	records := []Record{}
	ai := []AIRecord{}
	balances := map[string]int64{}
	income := int64(0)
	now := s.cfg.Now().UTC()
	for _, p := range s.data.Pools {
		if p.Owner == a.ID || role(a, "auditor", "dispute_reviewer") || contains(p.Policy.AllowedBeneficiaries, a.ID) {
			pools = append(pools, p)
		}
	}
	for _, r := range s.data.Records {
		if r.Owner == a.ID || r.Beneficiary == a.ID || role(a, "auditor", "dispute_reviewer") {
			if r.Status == "active" && r.Expiry.After(now) && r.Beneficiary == a.ID {
				balances[r.ResourceType] += r.Limit
			}
			if r.Owner == a.ID && r.Kind != "staking" {
				income += r.Fee
			}
			records = append(records, r)
		}
	}
	for _, x := range s.data.AI {
		if x.Owner == a.ID || role(a, "auditor") {
			ai = append(ai, x)
		}
	}
	sort.Slice(records, func(i, j int) bool { return records[i].CreatedAt.After(records[j].CreatedAt) })
	audit := []Audit{}
	if role(a, "auditor") {
		audit = append(audit, s.data.Audit...)
	}
	return map[string]any{"balances": balances, "pools": pools, "records": records, "ai": ai, "incomeQuoted": income, "audit": audit, "policy": map[string]any{"assetMovement": false, "sponsorship": "moves bounded resource capacity only", "feeTruth": "quoted until authoritative external settlement evidence exists"}}, nil
}

type apiError struct {
	Status  int
	Message string
}

func (e apiError) Error() string { return e.Message }
