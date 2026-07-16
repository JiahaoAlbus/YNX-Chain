package trustproduct

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

type Config struct {
	StorePath         string
	AIURL             string
	AIKey             string
	AIModel           string
	Sessions          map[string]Actor
	AllowHeaderAuth   bool
	CentralGatewayURL string
	CentralClientID   string
	Now               func() time.Time
}

type Actor struct{ ID, Role string }

type Evidence struct {
	ID               string    `json:"id"`
	Source           string    `json:"source"`
	Digest           string    `json:"digest"`
	Summary          string    `json:"summary"`
	CollectedAt      time.Time `json:"collectedAt"`
	VisibleToSubject bool      `json:"visibleToSubject"`
}

type Label struct {
	Value     string    `json:"value"`
	Source    string    `json:"source"`
	ExpiresAt time.Time `json:"expiresAt"`
	Active    bool      `json:"active"`
}

type Notice struct {
	Recipient string    `json:"recipient"`
	Reason    string    `json:"reason"`
	SentAt    time.Time `json:"sentAt"`
}

type Appeal struct {
	ID         string     `json:"id"`
	Appellant  string     `json:"appellant"`
	Reason     string     `json:"reason"`
	Evidence   []Evidence `json:"evidence"`
	Status     string     `json:"status"`
	Reviewer   string     `json:"reviewer,omitempty"`
	Resolution string     `json:"resolution,omitempty"`
	CreatedAt  time.Time  `json:"createdAt"`
	ResolvedAt *time.Time `json:"resolvedAt,omitempty"`
}

type Case struct {
	ID              string     `json:"id"`
	Owner           string     `json:"owner"`
	Subject         string     `json:"subject"`
	RequestScope    string     `json:"requestScope"`
	Purpose         string     `json:"purpose"`
	RequestedAction string     `json:"requestedAction"`
	Evidence        []Evidence `json:"evidence"`
	Status          string     `json:"status"`
	ValidityReason  string     `json:"validityReason"`
	Classification  string     `json:"classification,omitempty"`
	Reviewer        string     `json:"reviewer,omitempty"`
	Label           *Label     `json:"label,omitempty"`
	Notice          *Notice    `json:"notice,omitempty"`
	Appeals         []Appeal   `json:"appeals"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type AIRecord struct {
	ID               string    `json:"id"`
	Owner            string    `json:"owner"`
	CaseID           string    `json:"caseId"`
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

type snapshot struct {
	Version        int                       `json:"version"`
	Cases          map[string]Case           `json:"cases"`
	AI             map[string]AIRecord       `json:"ai"`
	Audit          []Audit                   `json:"audit"`
	Sessions       map[string]CentralSession `json:"sessions"`
	AuthorityAudit []AuthorityAudit          `json:"authorityAudit"`
	Replay         map[string]replay         `json:"replay"`
	Sequence       uint64                    `json:"sequence"`
}
type replay struct{ Digest, Kind, ID string }

type Service struct {
	mu       sync.Mutex
	cfg      Config
	data     snapshot
	client   *http.Client
	sessions map[string]Actor
}

func New(cfg Config) (*Service, error) {
	if strings.TrimSpace(cfg.StorePath) == "" {
		return nil, errors.New("trust product store path is required")
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
	s := &Service{cfg: cfg, client: &http.Client{Timeout: 20 * time.Second}, sessions: map[string]Actor{}, data: snapshot{Version: 1, Cases: map[string]Case{}, AI: map[string]AIRecord{}, Replay: map[string]replay{}, Sessions: map[string]CentralSession{}}}
	for token, actor := range cfg.Sessions {
		if strings.TrimSpace(token) == "" || !validActor(actor) {
			return nil, errors.New("Trust session registry contains an invalid token or actor")
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
		return fmt.Errorf("read trust store: %w", err)
	}
	var d snapshot
	if err := json.Unmarshal(b, &d); err != nil {
		return fmt.Errorf("decode trust store: %w", err)
	}
	if d.Version != 1 {
		return fmt.Errorf("unsupported trust store version %d", d.Version)
	}
	if d.Cases == nil {
		d.Cases = map[string]Case{}
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

func (s *Service) nextLocked(prefix string) string {
	s.data.Sequence++
	return fmt.Sprintf("%s-%08d", prefix, s.data.Sequence)
}

func validActor(a Actor) bool {
	return strings.TrimSpace(a.ID) != "" && strings.TrimSpace(a.Role) != ""
}
func role(a Actor, roles ...string) bool {
	for _, r := range roles {
		if a.Role == r {
			return true
		}
	}
	return false
}

type Action struct {
	Type            string     `json:"type"`
	IdempotencyKey  string     `json:"idempotencyKey"`
	CaseID          string     `json:"caseId,omitempty"`
	AppealID        string     `json:"appealId,omitempty"`
	Subject         string     `json:"subject,omitempty"`
	RequestScope    string     `json:"requestScope,omitempty"`
	Purpose         string     `json:"purpose,omitempty"`
	RequestedAction string     `json:"requestedAction,omitempty"`
	Evidence        []Evidence `json:"evidence,omitempty"`
	Decision        string     `json:"decision,omitempty"`
	Reason          string     `json:"reason,omitempty"`
	Classification  string     `json:"classification,omitempty"`
	LabelValue      string     `json:"labelValue,omitempty"`
	LabelSource     string     `json:"labelSource,omitempty"`
	ExpiresAt       time.Time  `json:"expiresAt,omitempty"`
	Context         []string   `json:"context,omitempty"`
	Permission      bool       `json:"permission,omitempty"`
	Language        string     `json:"language,omitempty"`
	AIID            string     `json:"aiId,omitempty"`
}

type Result struct {
	Case     *Case     `json:"case,omitempty"`
	AI       *AIRecord `json:"ai,omitempty"`
	Replayed bool      `json:"replayed"`
}

func (s *Service) Do(a Actor, in Action) (Result, error) {
	if !validActor(a) {
		return Result{}, apiError{401, "actor and role are required"}
	}
	if strings.TrimSpace(in.IdempotencyKey) == "" {
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
	res, err := s.doLocked(a, in)
	if err != nil {
		return Result{}, err
	}
	kind, id := "", ""
	if res.Case != nil {
		kind, id = "case", res.Case.ID
	}
	if res.AI != nil {
		kind, id = "ai", res.AI.ID
	}
	s.data.Replay[in.IdempotencyKey] = replay{Digest: digest, Kind: kind, ID: id}
	if err := s.saveLocked(); err != nil {
		return Result{}, err
	}
	return res, nil
}

func (s *Service) replayLocked(r replay) Result {
	if r.Kind == "case" {
		x := s.data.Cases[r.ID]
		return Result{Case: &x, Replayed: true}
	}
	if r.Kind == "ai" {
		x := s.data.AI[r.ID]
		return Result{AI: &x, Replayed: true}
	}
	return Result{Replayed: true}
}

func (s *Service) resultForLocked(in Action, replay bool) Result {
	if in.AIID != "" {
		x := s.data.AI[in.AIID]
		return Result{AI: &x, Replayed: replay}
	}
	if in.CaseID != "" {
		x := s.data.Cases[in.CaseID]
		return Result{Case: &x, Replayed: replay}
	}
	return Result{Replayed: replay}
}

func (s *Service) auditLocked(a Actor, action, target, outcome string) {
	s.data.Audit = append(s.data.Audit, Audit{ID: s.nextLocked("audit"), Actor: a.ID, Role: a.Role, Action: action, Target: target, Outcome: outcome, At: s.cfg.Now().UTC()})
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

func normalizeEvidence(e []Evidence, now time.Time, next func(string) string) ([]Evidence, error) {
	if len(e) == 0 {
		return nil, apiError{422, "at least one evidence record is required"}
	}
	if len(e) > 32 {
		return nil, apiError{422, "evidence record limit exceeded"}
	}
	out := make([]Evidence, 0, len(e))
	for _, x := range e {
		if strings.TrimSpace(x.Source) == "" || strings.TrimSpace(x.Digest) == "" || strings.TrimSpace(x.Summary) == "" {
			return nil, apiError{422, "evidence source, digest and summary are required"}
		}
		if len(x.Source) > 512 || len(x.Digest) > 256 || len(x.Summary) > 4096 {
			return nil, apiError{422, "evidence field limit exceeded"}
		}
		if !x.VisibleToSubject {
			return nil, apiError{422, "evidence used by this workflow must be visible to the subject"}
		}
		x.ID = next("evidence")
		if x.CollectedAt.IsZero() {
			x.CollectedAt = now
		}
		out = append(out, x)
	}
	return out, nil
}

func forbiddenAction(v string) bool {
	v = strings.ToLower(v)
	for _, x := range []string{"freeze", "seize", "confiscate", "blacklist", "transfer ynxt", "冻结", "没收", "转移"} {
		if strings.Contains(v, x) {
			return true
		}
	}
	return false
}
func overbroad(v string) bool {
	v = strings.ToLower(strings.TrimSpace(v))
	return v == "*" || strings.Contains(v, "all account") || strings.Contains(v, "entire network") || strings.Contains(v, "所有用户")
}

func (s *Service) doLocked(a Actor, in Action) (Result, error) {
	now := s.cfg.Now().UTC()
	switch in.Type {
	case "submit_case":
		if !role(a, "user", "reporter", "evidence_officer") {
			return Result{}, apiError{403, "role cannot submit evidence request"}
		}
		if in.Subject == "" || in.Purpose == "" || in.RequestScope == "" || in.RequestedAction == "" {
			return Result{}, apiError{422, "subject, purpose, requestScope and requestedAction are required"}
		}
		if len(in.Subject) > 256 || len(in.Purpose) > 2048 || len(in.RequestScope) > 2048 || len(in.RequestedAction) > 2048 {
			return Result{}, apiError{422, "request field limit exceeded"}
		}
		ev, err := normalizeEvidence(in.Evidence, now, s.nextLocked)
		if err != nil {
			return Result{}, err
		}
		id := s.nextLocked("case")
		status, reason := "submitted", "Evidence received; independent review is required."
		if forbiddenAction(in.RequestedAction) {
			status = "rejected_illegal"
			reason = "Native YNXT freeze, seizure, blacklist or transfer requests are illegal in Trust Center."
		} else if overbroad(in.RequestScope) {
			status = "rejected_overbroad"
			reason = "The request exceeds a specific subject and bounded purpose."
		}
		c := Case{ID: id, Owner: a.ID, Subject: in.Subject, RequestScope: in.RequestScope, Purpose: in.Purpose, RequestedAction: in.RequestedAction, Evidence: ev, Status: status, ValidityReason: reason, Appeals: []Appeal{}, CreatedAt: now, UpdatedAt: now}
		c.Notice = &Notice{Recipient: in.Subject, Reason: reason, SentAt: now}
		s.data.Cases[id] = c
		s.auditLocked(a, in.Type, id, status)
		return Result{Case: &c}, nil
	case "review":
		if !role(a, "reviewer") {
			return Result{}, apiError{403, "reviewer role required"}
		}
		c, ok := s.data.Cases[in.CaseID]
		if !ok {
			return Result{}, apiError{404, "case not found"}
		}
		if c.Owner == a.ID {
			return Result{}, apiError{403, "case owner cannot review own request"}
		}
		if len(c.Evidence) == 0 {
			return Result{}, apiError{422, "evidence is required before any conclusion"}
		}
		if strings.TrimSpace(in.Reason) == "" {
			return Result{}, apiError{422, "review reason is required"}
		}
		allowed := map[string]bool{"valid": true, "rejected_illegal": true, "rejected_overbroad": true, "needs_evidence": true}
		if !allowed[in.Decision] {
			return Result{}, apiError{422, "invalid review decision"}
		}
		if in.Decision == "valid" && strings.TrimSpace(in.Classification) == "" {
			return Result{}, apiError{422, "classification required for valid decision"}
		}
		if in.Decision == "valid" && forbiddenAction(c.RequestedAction) {
			return Result{}, apiError{422, "an illegal native YNXT control request cannot be reviewed as valid"}
		}
		if in.Decision == "valid" && overbroad(c.RequestScope) {
			return Result{}, apiError{422, "an overbroad request cannot be reviewed as valid"}
		}
		c.Status = in.Decision
		c.ValidityReason = in.Reason
		c.Classification = in.Classification
		c.Reviewer = a.ID
		c.UpdatedAt = now
		c.Notice = &Notice{Recipient: c.Subject, Reason: in.Reason, SentAt: now}
		s.data.Cases[c.ID] = c
		s.auditLocked(a, in.Type, c.ID, in.Decision)
		return Result{Case: &c}, nil
	case "set_label":
		if !role(a, "reviewer") {
			return Result{}, apiError{403, "reviewer role required"}
		}
		c, ok := s.data.Cases[in.CaseID]
		if !ok {
			return Result{}, apiError{404, "case not found"}
		}
		if c.Reviewer != a.ID || c.Status != "valid" {
			return Result{}, apiError{403, "only the deciding reviewer may label a valid case"}
		}
		if in.LabelValue == "" || in.LabelSource == "" || in.ExpiresAt.Before(now) || in.ExpiresAt.After(now.Add(90*24*time.Hour)) {
			return Result{}, apiError{422, "label value, visible source and expiry within 90 days are required"}
		}
		c.Label = &Label{Value: in.LabelValue, Source: in.LabelSource, ExpiresAt: in.ExpiresAt.UTC(), Active: true}
		c.UpdatedAt = now
		s.data.Cases[c.ID] = c
		s.auditLocked(a, in.Type, c.ID, "label_recorded")
		return Result{Case: &c}, nil
	case "appeal":
		c, ok := s.data.Cases[in.CaseID]
		if !ok {
			return Result{}, apiError{404, "case not found"}
		}
		if a.ID != c.Subject && !role(a, "advocate") {
			return Result{}, apiError{403, "only subject or advocate may appeal"}
		}
		if strings.TrimSpace(in.Reason) == "" {
			return Result{}, apiError{422, "appeal reason required"}
		}
		ev := []Evidence{}
		if len(in.Evidence) > 0 {
			var err error
			ev, err = normalizeEvidence(in.Evidence, now, s.nextLocked)
			if err != nil {
				return Result{}, err
			}
		}
		ap := Appeal{ID: s.nextLocked("appeal"), Appellant: a.ID, Reason: in.Reason, Evidence: ev, Status: "open", CreatedAt: now}
		c.Appeals = append(c.Appeals, ap)
		c.UpdatedAt = now
		s.data.Cases[c.ID] = c
		s.auditLocked(a, in.Type, c.ID, "open")
		return Result{Case: &c}, nil
	case "resolve_appeal":
		if !role(a, "appeal_reviewer") {
			return Result{}, apiError{403, "appeal_reviewer role required"}
		}
		c, ok := s.data.Cases[in.CaseID]
		if !ok {
			return Result{}, apiError{404, "case not found"}
		}
		if c.Reviewer == a.ID {
			return Result{}, apiError{403, "initial reviewer cannot resolve the appeal"}
		}
		idx := -1
		for i := range c.Appeals {
			if c.Appeals[i].ID == in.AppealID {
				idx = i
			}
		}
		if idx < 0 {
			return Result{}, apiError{404, "appeal not found"}
		}
		if c.Appeals[idx].Status != "open" {
			return Result{}, apiError{409, "appeal already resolved"}
		}
		if in.Decision != "upheld" && in.Decision != "false_positive" {
			return Result{}, apiError{422, "decision must be upheld or false_positive"}
		}
		if in.Reason == "" {
			return Result{}, apiError{422, "resolution reason required"}
		}
		c.Appeals[idx].Status = in.Decision
		c.Appeals[idx].Reviewer = a.ID
		c.Appeals[idx].Resolution = in.Reason
		c.Appeals[idx].ResolvedAt = &now
		if in.Decision == "false_positive" {
			c.Status = "corrected"
			c.Classification = ""
			if c.Label != nil {
				c.Label.Active = false
			}
			c.ValidityReason = "False-positive corrected after independent appeal review: " + in.Reason
		}
		c.Notice = &Notice{Recipient: c.Subject, Reason: in.Reason, SentAt: now}
		c.UpdatedAt = now
		s.data.Cases[c.ID] = c
		s.auditLocked(a, in.Type, c.ID, in.Decision)
		return Result{Case: &c}, nil
	case "expire_labels":
		if !role(a, "auditor", "system") {
			return Result{}, apiError{403, "auditor or system role required"}
		}
		for id, c := range s.data.Cases {
			if c.Label != nil && c.Label.Active && !c.Label.ExpiresAt.After(now) {
				c.Label.Active = false
				c.UpdatedAt = now
				s.data.Cases[id] = c
			}
		}
		s.auditLocked(a, in.Type, "labels", "completed")
		return Result{}, nil
	case "ai_prepare":
		if !role(a, "user", "reviewer", "appeal_reviewer") {
			return Result{}, apiError{403, "role cannot request Trust explanation"}
		}
		c, ok := s.data.Cases[in.CaseID]
		if !ok {
			return Result{}, apiError{404, "case not found"}
		}
		if a.ID != c.Subject && a.ID != c.Owner && !role(a, "reviewer", "appeal_reviewer") {
			return Result{}, apiError{403, "case access denied"}
		}
		allowed := map[string]bool{"evidence_summary": true, "classification": true, "appeal": true}
		for _, x := range in.Context {
			if !allowed[x] {
				return Result{}, apiError{422, "AI context exceeds Trust least-privilege classes"}
			}
		}
		if len(in.Context) == 0 {
			return Result{}, apiError{422, "selected context required"}
		}
		id := s.nextLocked("ai")
		provider := "unavailable"
		if s.cfg.AIURL != "" && s.cfg.AIKey != "" {
			provider = "YNX AI Gateway"
		}
		language := normalizeLanguage(in.Language)
		if language == "" {
			return Result{}, apiError{422, "supported AI output language is required"}
		}
		x := AIRecord{ID: id, Owner: a.ID, CaseID: c.ID, Intent: in.Purpose, Context: in.Context, PrivacyPreview: "Only selected Trust record fields; evidence payloads remain excluded unless evidence_summary is selected.", Provider: provider, Model: s.cfg.AIModel, OutputLanguage: language, EstimatedCredits: 2 + len(in.Context), Permission: false, Status: "prepared", CreatedAt: now, UpdatedAt: now}
		s.data.AI[id] = x
		s.auditLocked(a, in.Type, id, "prepared")
		return Result{AI: &x}, nil
	case "ai_run":
		x, ok := s.data.AI[in.AIID]
		if !ok {
			return Result{}, apiError{404, "AI record not found"}
		}
		if x.Owner != a.ID {
			return Result{}, apiError{403, "AI record owner required"}
		}
		if !in.Permission {
			return Result{}, apiError{422, "explicit AI permission required"}
		}
		if s.cfg.AIURL == "" || s.cfg.AIKey == "" {
			x.Status = "failed"
			x.Error = "YNX AI Gateway is unavailable or not configured"
			x.UpdatedAt = now
			s.data.AI[x.ID] = x
			s.auditLocked(a, in.Type, x.ID, "provider_unavailable")
			return Result{AI: &x}, nil
		}
		x.Permission = true
		x.Status = "running"
		x.UpdatedAt = now
		s.data.AI[x.ID] = x
		if err := s.saveLocked(); err != nil {
			return Result{}, err
		}
		s.mu.Unlock()
		answer, err := s.askAI(x)
		s.mu.Lock()
		x = s.data.AI[x.ID]
		if err != nil {
			x.Status = "failed"
			x.Error = err.Error()
		} else {
			x.Status = "completed"
			x.Result = answer
		}
		x.UpdatedAt = s.cfg.Now().UTC()
		s.data.AI[x.ID] = x
		s.auditLocked(a, in.Type, x.ID, x.Status)
		return Result{AI: &x}, nil
	case "ai_cancel":
		x, ok := s.data.AI[in.AIID]
		if !ok {
			return Result{}, apiError{404, "AI record not found"}
		}
		if x.Owner != a.ID {
			return Result{}, apiError{403, "AI record owner required"}
		}
		if x.Status == "applied" {
			return Result{}, apiError{409, "reviewed explanation cannot be cancelled"}
		}
		x.Status = "cancelled"
		x.UpdatedAt = now
		s.data.AI[x.ID] = x
		s.auditLocked(a, in.Type, x.ID, "cancelled")
		return Result{AI: &x}, nil
	case "ai_review":
		x, ok := s.data.AI[in.AIID]
		if !ok {
			return Result{}, apiError{404, "AI record not found"}
		}
		if x.Owner != a.ID {
			return Result{}, apiError{403, "AI record owner required"}
		}
		if x.Status != "completed" {
			return Result{}, apiError{409, "only completed explanation can be reviewed"}
		}
		if in.Decision != "apply" && in.Decision != "reject" {
			return Result{}, apiError{422, "review must apply or reject"}
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
		return Result{AI: &x}, nil
	default:
		return Result{}, apiError{400, "unknown action type"}
	}
}

func (s *Service) askAI(x AIRecord) (string, error) {
	prompt := fmt.Sprintf("Explain Trust case %s for intent %s using only context classes %s. Respond in %s. Do not decide guilt, change labels, punish, freeze or transfer assets.", x.CaseID, x.Intent, strings.Join(x.Context, ","), x.OutputLanguage)
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
	if !validActor(a) {
		return nil, apiError{401, "actor and role are required"}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	cases := []Case{}
	for _, c := range s.data.Cases {
		if c.Label != nil && c.Label.Active && !c.Label.ExpiresAt.After(now) {
			c.Label.Active = false
		}
		if role(a, "reviewer", "appeal_reviewer", "auditor") || a.ID == c.Owner || a.ID == c.Subject {
			cases = append(cases, c)
		}
	}
	sort.Slice(cases, func(i, j int) bool { return cases[i].CreatedAt.After(cases[j].CreatedAt) })
	ais := []AIRecord{}
	for _, x := range s.data.AI {
		if x.Owner == a.ID || role(a, "auditor") {
			ais = append(ais, x)
		}
	}
	audit := []Audit{}
	if role(a, "auditor") {
		audit = append(audit, s.data.Audit...)
	}
	return map[string]any{"cases": cases, "ai": ais, "audit": audit, "policy": map[string]any{"nativeYNXT": "cannot be frozen, seized, blacklisted or transferred by Trust Center", "appealAlwaysAvailable": true, "evidenceRequired": true, "labelSourceVisible": true}}, nil
}

func (s *Service) Transparency() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	counts := map[string]int{}
	appeals, corrected := 0, 0
	for _, c := range s.data.Cases {
		counts[c.Status]++
		appeals += len(c.Appeals)
		if c.Status == "corrected" {
			corrected++
		}
	}
	return map[string]any{"generatedAt": s.cfg.Now().UTC(), "caseCounts": counts, "appeals": appeals, "falsePositiveCorrections": corrected, "method": "Counts are derived from persisted product records; no identities or evidence payloads are published."}
}

type apiError struct {
	Status  int
	Message string
}

func (e apiError) Error() string { return e.Message }
