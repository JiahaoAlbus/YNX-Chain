package social

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chat"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
	"github.com/decred/dcrd/dcrec/secp256k1/v4/ecdsa"
)

var identifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$`)
var allowedScopes = map[string]bool{"social.profile": true, "social.contacts": true, "social.messaging": true, "social.feed": true, "social.ai": true}
var allowedSources = map[string]bool{"handle": true, "contacts": true, "qr": true, "invite": true, "recommendation": true}
var allowedAIKinds = map[string]bool{"reply_draft": true, "conversation_summary": true, "translation": true, "inbox_classification": true, "moderation_explanation": true}

type Service struct {
	mu    sync.Mutex
	cfg   Config
	state persistentState
	seen  map[string][]time.Time
}

func New(cfg Config) (*Service, error) {
	cfg.StatePath = strings.TrimSpace(cfg.StatePath)
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.RateLimitWindow <= 0 {
		cfg.RateLimitWindow = time.Minute
	}
	if cfg.RateLimitMax <= 0 {
		cfg.RateLimitMax = 60
	}
	if cfg.StatePath == "" || len(cfg.TokenKey) < 32 {
		return nil, errors.New("social state path and token key of at least 32 bytes are required")
	}
	state, existed, err := loadState(cfg.StatePath, cfg.TokenKey)
	if err != nil {
		return nil, err
	}
	s := &Service{cfg: cfg, state: state, seen: map[string][]time.Time{}}
	if err := s.validateAuditLocked(); err != nil {
		return nil, err
	}
	if err := s.verifyMediaFiles(); err != nil {
		return nil, err
	}
	if !existed {
		if err := saveState(cfg.StatePath, &s.state, cfg.TokenKey); err != nil {
			return nil, err
		}
	}
	return s, nil
}

func WalletAssertionPayload(a WalletAssertion) []byte {
	scopes := append([]string(nil), a.Scopes...)
	sort.Strings(scopes)
	return []byte(strings.Join([]string{"ynx-wallet-product-auth-v1", ProductID, a.Account, a.DeviceID, a.DeviceSigningPublicKey, a.DeviceEncryptionPublicKey, a.ClientID, a.Callback, strings.Join(scopes, ","), a.Nonce, a.IssuedAt.UTC().Format(time.RFC3339Nano), a.ExpiresAt.UTC().Format(time.RFC3339Nano)}, "\n"))
}

func DeviceProofPayload(a WalletAssertion) []byte {
	return []byte(strings.Join([]string{"ynx-social-device-proof-v1", a.Account, a.DeviceID, a.DeviceSigningPublicKey, a.DeviceEncryptionPublicKey, a.Nonce}, "\n"))
}

func RegistrationIdempotencyKey(kind, nonce string) string {
	digest := sha256.Sum256([]byte(nonce))
	return kind + "-" + hex.EncodeToString(digest[:12])
}

func (s *Service) Login(a WalletAssertion) (LoginResult, error) {
	now := s.cfg.Now().UTC()
	account, err := nativewallet.NormalizeNativeAddress(a.Account)
	if err != nil {
		return LoginResult{}, fmt.Errorf("%w: wallet native account", ErrInvalid)
	}
	if a.ClientID != ClientID {
		return LoginResult{}, fmt.Errorf("%w: wallet client binding", ErrInvalid)
	}
	if a.Callback != Callback {
		return LoginResult{}, fmt.Errorf("%w: wallet callback binding", ErrInvalid)
	}
	if !identifierPattern.MatchString(a.DeviceID) {
		return LoginResult{}, fmt.Errorf("%w: wallet device identifier", ErrInvalid)
	}
	if !identifierPattern.MatchString(a.Nonce) {
		return LoginResult{}, fmt.Errorf("%w: wallet nonce identifier", ErrInvalid)
	}
	if a.IssuedAt.After(now.Add(30*time.Second)) || a.IssuedAt.Before(now.Add(-5*time.Minute)) || !a.ExpiresAt.After(now) || a.ExpiresAt.After(a.IssuedAt.Add(5*time.Minute)) {
		return LoginResult{}, fmt.Errorf("%w: wallet assertion lifetime", ErrUnauthorized)
	}
	if len(a.Scopes) == 0 || len(a.Scopes) > len(allowedScopes) {
		return LoginResult{}, fmt.Errorf("%w: wallet scopes", ErrInvalid)
	}
	seenScope := map[string]bool{}
	for _, scope := range a.Scopes {
		if !allowedScopes[scope] || seenScope[scope] {
			return LoginResult{}, fmt.Errorf("%w: wallet scope %q", ErrInvalid, scope)
		}
		seenScope[scope] = true
	}
	a.Account = account
	if !verifyWalletSignature(account, a.PublicKey, a.Signature, WalletAssertionPayload(a)) {
		return LoginResult{}, fmt.Errorf("%w: wallet signature", ErrUnauthorized)
	}
	if !nativewallet.Verify(a.DeviceSigningPublicKey, DeviceProofPayload(a), a.DeviceProofSignature) {
		return LoginResult{}, fmt.Errorf("%w: product device proof", ErrUnauthorized)
	}
	if s.cfg.Square != nil {
		request := square.RegisterDeviceRequest{IdempotencyKey: RegistrationIdempotencyKey("social-square", a.Nonce), Account: account, DeviceID: a.DeviceID, SigningPublicKey: a.DeviceSigningPublicKey, ProofSignature: a.SquareRegistrationSignature}
		if _, err := s.cfg.Square.RegisterDevice(request); err != nil {
			return LoginResult{}, fmt.Errorf("%w: square device registration: %v", ErrUnauthorized, err)
		}
	}
	if s.cfg.Chat != nil {
		request := chat.RegisterDeviceRequest{IdempotencyKey: RegistrationIdempotencyKey("social-chat", a.Nonce), Account: account, DeviceID: a.DeviceID, SigningPublicKey: a.DeviceSigningPublicKey, EncryptionPublicKey: a.DeviceEncryptionPublicKey, ProofSignature: a.ChatRegistrationSignature}
		if _, err := s.cfg.Chat.RegisterDevice(request); err != nil {
			return LoginResult{}, fmt.Errorf("%w: chat device registration: %v", ErrUnauthorized, err)
		}
	}
	digest := objectDigest(a)
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.state.UsedNonces[a.Nonce]; exists {
		return LoginResult{}, fmt.Errorf("%w: wallet nonce replay", ErrConflict)
	}
	if existing, ok := s.state.Devices[a.DeviceID]; ok && (existing.Account != account || existing.SigningPublicKey != a.DeviceSigningPublicKey || existing.EncryptionPublicKey != a.DeviceEncryptionPublicKey) {
		return LoginResult{}, fmt.Errorf("%w: product device id collision", ErrConflict)
	}
	raw := randomBytes(32)
	token := base64.RawURLEncoding.EncodeToString(raw)
	id := "session_" + digest[:24]
	session := Session{ID: id, Account: account, DeviceID: a.DeviceID, Scopes: append([]string(nil), a.Scopes...), CreatedAt: now, ExpiresAt: now.Add(24 * time.Hour)}
	before := cloneState(s.state)
	s.state.Sessions[tokenDigest(token, s.cfg.TokenKey)] = session
	s.state.UsedNonces[a.Nonce] = a.ExpiresAt
	s.state.Devices[a.DeviceID] = ProductDevice{ID: a.DeviceID, Account: account, SigningPublicKey: a.DeviceSigningPublicKey, EncryptionPublicKey: a.DeviceEncryptionPublicKey, Status: "active", CreatedAt: now, UpdatedAt: now}
	s.appendAuditLocked("wallet_session_created", "session", id, account, digest, now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Session: session, Token: token}, nil
}

func (s *Service) Authenticate(token, scope string) (Session, error) {
	if !allowedScopes[scope] {
		return Session{}, ErrUnauthorized
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.state.Sessions[tokenDigest(strings.TrimSpace(strings.TrimPrefix(token, "Bearer ")), s.cfg.TokenKey)]
	if !ok || session.RevokedAt != nil || !session.ExpiresAt.After(s.cfg.Now()) || !contains(session.Scopes, scope) {
		return Session{}, ErrUnauthorized
	}
	return session, nil
}

func (s *Service) RevokeSession(actor Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key, session, ok := s.sessionByIDLocked(actor.ID)
	if !ok || session.Account != actor.Account || session.RevokedAt != nil {
		return ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	session.RevokedAt = &now
	s.state.Sessions[key] = session
	s.appendAuditLocked("session_revoked", "session", session.ID, actor.Account, objectDigest(session), now)
	return s.saveOrRollbackLocked(before)
}

func (s *Service) Allow(remoteAddress, account, action string) bool {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil {
		host = remoteAddress
	}
	key := host + "|" + account + "|" + action
	now := s.cfg.Now().UTC()
	cutoff := now.Add(-s.cfg.RateLimitWindow)
	s.mu.Lock()
	defer s.mu.Unlock()
	recent := s.seen[key][:0]
	for _, at := range s.seen[key] {
		if at.After(cutoff) {
			recent = append(recent, at)
		}
	}
	if len(recent) >= s.cfg.RateLimitMax {
		s.seen[key] = recent
		return false
	}
	s.seen[key] = append(recent, now)
	return true
}

func (s *Service) SetSettings(actor Session, in ProfileSettingsInput) (ProfileSettings, bool, error) {
	if !identifierPattern.MatchString(in.IdempotencyKey) || !contains([]string{"everyone", "contacts", "nobody"}, in.AllowRequestsFrom) || len(in.AvatarURL) > 2048 {
		return ProfileSettings{}, false, ErrInvalid
	}
	if in.AvatarURL != "" {
		u, err := url.Parse(in.AvatarURL)
		if err != nil || u.Scheme != "https" || u.Host == "" {
			return ProfileSettings{}, false, ErrInvalid
		}
	}
	profileHandle := ""
	if s.cfg.Square != nil {
		if profile, err := s.cfg.Square.Profile(actor.Account); err == nil {
			profileHandle = profile.Handle
		}
	}
	digest := objectDigest(in)
	s.mu.Lock()
	defer s.mu.Unlock()
	stateKey := idempotencyStateKey(actor.Account, in.IdempotencyKey)
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "settings" || previous.Digest != digest || previous.ObjectID != actor.Account {
			return ProfileSettings{}, false, ErrConflict
		}
		return s.state.Settings[actor.Account], true, nil
	}
	now := s.cfg.Now().UTC()
	qrPayload := ""
	if profileHandle != "" {
		qrPayload = "ynxsocial://profile/" + profileHandle
	}
	record := ProfileSettings{Account: actor.Account, DiscoverableByHandle: in.DiscoverableByHandle, ContactsMatching: in.ContactsMatching, AllowRecommendations: in.AllowRecommendations, AllowRequestsFrom: in.AllowRequestsFrom, AvatarURL: in.AvatarURL, ProfileQRPayload: qrPayload, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Settings[actor.Account] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{"settings", digest, actor.Account}
	s.appendAuditLocked("profile_privacy_updated", "settings", actor.Account, actor.Account, digest, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) CreateInvite(actor Session, ttl time.Duration) (Invite, string, error) {
	if ttl < time.Minute || ttl > 7*24*time.Hour {
		return Invite{}, "", ErrInvalid
	}
	token := base64.RawURLEncoding.EncodeToString(randomBytes(24))
	hash := sha256.Sum256([]byte(token))
	now := s.cfg.Now().UTC()
	id := "invite_" + hex.EncodeToString(hash[:12])
	record := Invite{ID: id, Owner: actor.Account, TokenHash: hex.EncodeToString(hash[:]), Link: "https://social.ynxweb4.com/invite/" + token, ExpiresAt: now.Add(ttl), CreatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneState(s.state)
	s.state.Invites[id] = record
	s.appendAuditLocked("invite_created", "invite", id, actor.Account, objectDigest(record), now)
	return record, token, s.saveOrRollbackLocked(before)
}

func (s *Service) RequestContact(actor Session, in ContactRequestInput) (ContactRequest, bool, error) {
	target, err := nativewallet.NormalizeNativeAddress(in.TargetAccount)
	if err != nil || target == actor.Account || !identifierPattern.MatchString(in.IdempotencyKey) || !allowedSources[in.Source] {
		return ContactRequest{}, false, ErrInvalid
	}
	digest := objectDigest(in)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.blockedLocked(actor.Account, target) {
		return ContactRequest{}, false, ErrUnauthorized
	}
	settings := s.state.Settings[target]
	if settings.AllowRequestsFrom == "nobody" || settings.AllowRequestsFrom == "contacts" && !s.contactLocked(actor.Account, target) {
		return ContactRequest{}, false, ErrUnauthorized
	}
	if s.contactLocked(actor.Account, target) {
		return ContactRequest{}, false, ErrConflict
	}
	stateKey := idempotencyStateKey(actor.Account, in.IdempotencyKey)
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "contact_request" || previous.Digest != digest {
			return ContactRequest{}, false, ErrConflict
		}
		return s.state.Requests[previous.ObjectID], true, nil
	}
	for _, request := range s.state.Requests {
		if request.From == actor.Account && request.To == target && request.Status == "pending" {
			return ContactRequest{}, false, ErrConflict
		}
	}
	now := s.cfg.Now().UTC()
	id := "request_" + objectDigest(struct{ A, B, K string }{actor.Account, target, in.IdempotencyKey})[:24]
	record := ContactRequest{ID: id, From: actor.Account, To: target, Source: in.Source, Status: "pending", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Requests[id] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{"contact_request", digest, id}
	s.notifyLocked(target, actor.Account, "contact_request", id, now)
	s.appendAuditLocked("contact_request_created", "contact_request", id, actor.Account, digest, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) TransitionRequest(actor Session, id, action string) (ContactRequest, error) {
	if !contains([]string{"accept", "reject", "withdraw"}, action) {
		return ContactRequest{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Requests[id]
	if !ok {
		return ContactRequest{}, ErrNotFound
	}
	if action == "withdraw" && record.From != actor.Account || action != "withdraw" && record.To != actor.Account {
		return ContactRequest{}, ErrUnauthorized
	}
	if record.Status != "pending" {
		return ContactRequest{}, ErrConflict
	}
	if s.blockedLocked(record.From, record.To) {
		return ContactRequest{}, ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	record.Status = map[string]string{"accept": "accepted", "reject": "rejected", "withdraw": "withdrawn"}[action]
	record.UpdatedAt = now
	record.ClosedAt = &now
	s.state.Requests[id] = record
	if action == "accept" {
		key := pairKey(record.From, record.To)
		s.state.Contacts[key] = Contact{Left: min(record.From, record.To), Right: max(record.From, record.To), CreatedAt: now}
		s.notifyLocked(record.From, actor.Account, "contact_accepted", id, now)
	}
	s.appendAuditLocked("contact_request_"+record.Status, "contact_request", id, actor.Account, objectDigest(record), now)
	return record, s.saveOrRollbackLocked(before)
}

func (s *Service) DeleteContact(actor Session, target string) error {
	return s.relationshipAction(actor, target, "delete_contact")
}
func (s *Service) Block(actor Session, target string) error {
	return s.relationshipAction(actor, target, "block")
}
func (s *Service) Mute(actor Session, target string, active bool) error {
	if active {
		return s.relationshipAction(actor, target, "mute")
	}
	return s.relationshipAction(actor, target, "unmute")
}

func (s *Service) relationshipAction(actor Session, target, action string) error {
	target, err := nativewallet.NormalizeNativeAddress(target)
	if err != nil || target == actor.Account {
		return ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	key := directedKey(actor.Account, target)
	switch action {
	case "delete_contact":
		if !s.contactLocked(actor.Account, target) {
			return ErrNotFound
		}
		delete(s.state.Contacts, pairKey(actor.Account, target))
	case "block":
		s.state.Blocks[key] = now
		delete(s.state.Contacts, pairKey(actor.Account, target))
		for id, r := range s.state.Requests {
			if r.Status == "pending" && ((r.From == actor.Account && r.To == target) || (r.From == target && r.To == actor.Account)) {
				r.Status = "blocked"
				r.UpdatedAt = now
				r.ClosedAt = &now
				s.state.Requests[id] = r
			}
		}
	case "mute":
		s.state.Mutes[key] = now
	case "unmute":
		delete(s.state.Mutes, key)
	default:
		return ErrInvalid
	}
	s.appendAuditLocked(action, "relationship", key, actor.Account, objectDigest(struct{ Target string }{target}), now)
	return s.saveOrRollbackLocked(before)
}

func (s *Service) Contacts(actor Session) []Contact {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Contact{}
	for _, c := range s.state.Contacts {
		if c.Left == actor.Account || c.Right == actor.Account {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out
}
func (s *Service) Requests(actor Session) []ContactRequest {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []ContactRequest{}
	for _, r := range s.state.Requests {
		if r.From == actor.Account || r.To == actor.Account {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (s *Service) BeginAI(actor Session, in AIRequest) (AIJob, bool, error) {
	if !identifierPattern.MatchString(in.IdempotencyKey) || !allowedAIKinds[in.Kind] || len(in.SelectionIDs) == 0 || len(in.SelectionIDs) > 100 || len(in.PrivacyPreview) < 10 || len(in.PrivacyPreview) > 2000 || in.EstimatedTokens < 1 || in.EstimatedTokens > 100000 {
		return AIJob{}, false, ErrInvalid
	}
	provider, ok := s.cfg.AIProviders[in.Provider]
	if !ok || !contains(provider.Models, in.Model) {
		return AIJob{}, false, ErrInvalid
	}
	if !provider.Available {
		return AIJob{}, false, fmt.Errorf("%w: provider unavailable", ErrConflict)
	}
	if err := s.validateAISelection(actor, in.SelectionIDs); err != nil {
		return AIJob{}, false, err
	}
	digest := objectDigest(in)
	s.mu.Lock()
	defer s.mu.Unlock()
	stateKey := idempotencyStateKey(actor.Account, in.IdempotencyKey)
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "ai_begin" || previous.Digest != digest {
			return AIJob{}, false, ErrConflict
		}
		return s.state.AIJobs[previous.ObjectID], true, nil
	}
	now := s.cfg.Now().UTC()
	id := "ai_" + digest[:24]
	job := AIJob{ID: id, Account: actor.Account, Kind: in.Kind, SelectionIDs: append([]string(nil), in.SelectionIDs...), ContextClasses: append([]string(nil), in.ContextClasses...), PrivacyPreview: in.PrivacyPreview, Provider: in.Provider, Model: in.Model, EstimatedTokens: in.EstimatedTokens, EstimatedCostUSD: float64(in.EstimatedTokens) / 1000 * provider.CostPer1KUSD, Status: "awaiting_permission", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.AIJobs[id] = job
	s.state.Idempotency[stateKey] = idempotencyRecord{"ai_begin", digest, id}
	s.appendAuditLocked("ai_context_previewed", "ai_job", id, actor.Account, digest, now)
	return job, false, s.saveOrRollbackLocked(before)
}

func (s *Service) validateAISelection(actor Session, ids []string) error {
	for _, id := range ids {
		if strings.HasPrefix(id, "conv_") || strings.HasPrefix(id, "group_") {
			if _, err := s.ContractConversation(actor, id); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(id, "moment_") {
			if _, err := s.Moment(actor, id); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(id, "report_") {
			if _, err := s.SocialReport(actor, id); err != nil {
				return err
			}
			continue
		}
		found := false
		if s.cfg.Chat != nil {
			for _, conversation := range s.cfg.Chat.Conversations(chat.Device{ID: actor.DeviceID, Account: actor.Account}) {
				messages, _ := s.cfg.Chat.Messages(chat.Device{ID: actor.DeviceID, Account: actor.Account}, conversation.ID)
				for _, message := range messages {
					if message.ID == id {
						found = true
						break
					}
				}
			}
		}
		for _, group := range s.GroupConversations(actor) {
			messages, _ := s.GroupMessages(actor, group.ID)
			for _, message := range messages {
				if message.ID == id {
					found = true
					break
				}
			}
		}
		if !found {
			return fmt.Errorf("%w: selected AI context does not belong to this account", ErrUnauthorized)
		}
	}
	return nil
}

func (s *Service) StreamAI(ctx context.Context, actor Session, id, contextText string, emit func(string) error) (AIJob, error) {
	contextText = strings.TrimSpace(contextText)
	if contextText == "" || len(contextText) > 6000 {
		return AIJob{}, ErrInvalid
	}
	s.mu.Lock()
	job, ok := s.state.AIJobs[id]
	s.mu.Unlock()
	if !ok {
		return AIJob{}, ErrNotFound
	}
	if job.Account != actor.Account {
		return AIJob{}, ErrUnauthorized
	}
	if job.Status != "streaming" {
		return AIJob{}, ErrConflict
	}
	if s.cfg.AI == nil {
		return s.failAIStream(actor, id, errors.New("YNX AI Gateway is unavailable"))
	}
	var output strings.Builder
	usage, err := s.cfg.AI.Stream(ctx, AIStreamRequest{JobID: id, Kind: job.Kind, Provider: job.Provider, Model: job.Model, ContextText: contextText}, func(chunk string) error {
		if output.Len()+len(chunk) > 20000 {
			return errors.New("AI output exceeds Social review limit")
		}
		output.WriteString(chunk)
		return emit(chunk)
	})
	if err != nil {
		if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			cancelled, transitionErr := s.TransitionAI(actor, id, "cancel", "")
			if transitionErr != nil {
				return AIJob{}, transitionErr
			}
			return cancelled, context.Canceled
		}
		return s.failAIStream(actor, id, err)
	}
	result := strings.TrimSpace(output.String())
	if result == "" {
		return s.failAIStream(actor, id, errors.New("AI Gateway returned no reviewable output"))
	}
	contextHash := sha256.Sum256([]byte(contextText))
	s.mu.Lock()
	defer s.mu.Unlock()
	job = s.state.AIJobs[id]
	if job.Status != "streaming" {
		return AIJob{}, ErrConflict
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	job.Status, job.Output, job.ContextHash, job.ActualTokens, job.UpdatedAt = "review", result, hex.EncodeToString(contextHash[:]), usage.Tokens, now
	job.ActualCostUSD = float64(usage.Tokens) / 1000 * s.cfg.AIProviders[job.Provider].CostPer1KUSD
	s.state.AIJobs[id] = job
	s.appendAuditLocked("ai_stream_completed_for_review", "ai_job", id, actor.Account, objectDigest(struct {
		ContextHash string
		Tokens      int
	}{job.ContextHash, job.ActualTokens}), now)
	return job, s.saveOrRollbackLocked(before)
}

func (s *Service) failAIStream(actor Session, id string, cause error) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.state.AIJobs[id]
	if !ok || job.Account != actor.Account {
		return AIJob{}, ErrUnauthorized
	}
	if job.Status == "streaming" {
		before := cloneState(s.state)
		now := s.cfg.Now().UTC()
		job.Status, job.UpdatedAt = "provider_failed", now
		s.state.AIJobs[id] = job
		s.appendAuditLocked("ai_provider_failed", "ai_job", id, actor.Account, objectDigest(cause.Error()), now)
		if err := s.saveOrRollbackLocked(before); err != nil {
			return AIJob{}, err
		}
	}
	return job, fmt.Errorf("%w: %v", ErrConflict, cause)
}

func (s *Service) TransitionAI(actor Session, id, action, output string) (AIJob, error) {
	if !contains([]string{"allow", "cancel", "complete", "apply", "reject", "retry", "appeal"}, action) {
		return AIJob{}, ErrInvalid
	}
	if len(output) > 20000 {
		return AIJob{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.state.AIJobs[id]
	if !ok {
		return AIJob{}, ErrNotFound
	}
	if job.Account != actor.Account {
		return AIJob{}, ErrUnauthorized
	}
	allowed := map[string][]string{"awaiting_permission": {"allow", "reject"}, "streaming": {"cancel", "complete"}, "cancelled": {"retry"}, "provider_failed": {"retry"}, "review": {"apply", "reject", "appeal"}, "applied": {"appeal"}, "rejected": {"retry"}}
	if !contains(allowed[job.Status], action) {
		return AIJob{}, ErrConflict
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	switch action {
	case "allow":
		job.Status = "streaming"
		job.PermissionAt = &now
	case "cancel":
		job.Status = "cancelled"
	case "complete":
		if output == "" {
			return AIJob{}, ErrInvalid
		}
		job.Status = "review"
		job.Output = output
	case "apply":
		job.Status = "applied"
	case "reject":
		job.Status = "rejected"
	case "retry":
		provider := s.cfg.AIProviders[job.Provider]
		if !provider.Available {
			return AIJob{}, fmt.Errorf("%w: provider unavailable", ErrConflict)
		}
		job.Status = "awaiting_permission"
		job.Output = ""
		job.PermissionAt = nil
	case "appeal":
		if strings.TrimSpace(output) == "" {
			return AIJob{}, ErrInvalid
		}
		job.Status = "appealed"
		job.Correction = output
	}
	job.UpdatedAt = now
	s.state.AIJobs[id] = job
	s.appendAuditLocked("ai_"+action, "ai_job", id, actor.Account, objectDigest(job), now)
	return job, s.saveOrRollbackLocked(before)
}

func (s *Service) Notifications(actor Session) ([]Notification, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Notification{}
	unread := 0
	for _, n := range s.state.Notifications {
		if n.Account == actor.Account {
			out = append(out, n)
			if n.ReadAt == nil {
				unread++
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, unread
}
func (s *Service) MarkNotificationRead(actor Session, id string) (Notification, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	n, ok := s.state.Notifications[id]
	if !ok {
		return Notification{}, ErrNotFound
	}
	if n.Account != actor.Account {
		return Notification{}, ErrUnauthorized
	}
	if n.ReadAt != nil {
		return n, nil
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	n.ReadAt = &now
	s.state.Notifications[id] = n
	s.appendAuditLocked("notification_read", "notification", id, actor.Account, objectDigest(n), now)
	return n, s.saveOrRollbackLocked(before)
}

func (s *Service) Export(actor Session) Export {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := Export{Account: actor.Account, Contacts: []Contact{}, Requests: []ContactRequest{}, Notifications: []Notification{}, AIJobs: []AIJob{}, Devices: []ProductDevice{}, Groups: []GroupConversation{}, GroupMessages: []chat.Message{}, Media: []MediaObject{}, Moments: []Moment{}, Comments: []MomentComment{}, Reactions: []MomentReaction{}, Reports: []SocialReport{}, Automation: []AutomationRule{}, Audit: []AuditEvent{}}
	if settings, ok := s.state.Settings[actor.Account]; ok {
		out.Settings = &settings
	}
	for _, c := range s.state.Contacts {
		if c.Left == actor.Account || c.Right == actor.Account {
			out.Contacts = append(out.Contacts, c)
		}
	}
	for _, r := range s.state.Requests {
		if r.From == actor.Account || r.To == actor.Account {
			out.Requests = append(out.Requests, r)
		}
	}
	for _, n := range s.state.Notifications {
		if n.Account == actor.Account {
			out.Notifications = append(out.Notifications, n)
		}
	}
	for _, j := range s.state.AIJobs {
		if j.Account == actor.Account {
			out.AIJobs = append(out.AIJobs, j)
		}
	}
	for _, d := range s.state.Devices {
		if d.Account == actor.Account {
			out.Devices = append(out.Devices, d)
		}
	}
	for _, g := range s.state.Groups {
		if contains(g.Members, actor.Account) {
			out.Groups = append(out.Groups, g)
			for _, m := range s.state.GroupMessages[g.ID] {
				if m.Sender == actor.Account {
					out.GroupMessages = append(out.GroupMessages, m)
				}
			}
		}
	}
	for _, media := range s.state.Media {
		if media.Owner == actor.Account {
			out.Media = append(out.Media, media)
		}
	}
	for _, moment := range s.state.Moments {
		if moment.Author == actor.Account {
			out.Moments = append(out.Moments, moment)
		}
	}
	for _, comments := range s.state.MomentComments {
		for _, comment := range comments {
			if comment.Author == actor.Account {
				out.Comments = append(out.Comments, comment)
			}
		}
	}
	for _, reaction := range s.state.MomentReactions {
		if reaction.Account == actor.Account {
			out.Reactions = append(out.Reactions, reaction)
		}
	}
	for _, report := range s.state.Reports {
		if report.Reporter == actor.Account {
			out.Reports = append(out.Reports, report)
		}
	}
	for _, rule := range s.state.Automation {
		if rule.Account == actor.Account {
			out.Automation = append(out.Automation, rule)
		}
	}
	for _, a := range s.state.Audit {
		if a.Account == actor.Account {
			out.Audit = append(out.Audit, a)
		}
	}
	return out
}

func (s *Service) DeleteAccount(actor Session) error {
	s.mu.Lock()
	before := cloneState(s.state)
	mediaPaths := []string{}
	delete(s.state.Settings, actor.Account)
	for k, c := range s.state.Contacts {
		if c.Left == actor.Account || c.Right == actor.Account {
			delete(s.state.Contacts, k)
		}
	}
	for k, r := range s.state.Requests {
		if r.From == actor.Account || r.To == actor.Account {
			delete(s.state.Requests, k)
		}
	}
	for k, n := range s.state.Notifications {
		if n.Account == actor.Account || n.Actor == actor.Account {
			delete(s.state.Notifications, k)
		}
	}
	for k, j := range s.state.AIJobs {
		if j.Account == actor.Account {
			delete(s.state.AIJobs, k)
		}
	}
	for k, device := range s.state.Devices {
		if device.Account == actor.Account {
			delete(s.state.Devices, k)
		}
	}
	for k, group := range s.state.Groups {
		if !contains(group.Members, actor.Account) {
			continue
		}
		members := make([]string, 0, len(group.Members)-1)
		for _, member := range group.Members {
			if member != actor.Account {
				members = append(members, member)
			}
		}
		if len(members) < 2 {
			delete(s.state.Groups, k)
			delete(s.state.GroupMessages, k)
		} else {
			group.Members = members
			group.UpdatedAt = s.cfg.Now().UTC()
			s.state.Groups[k] = group
			messages := s.state.GroupMessages[k][:0]
			for _, m := range s.state.GroupMessages[k] {
				if m.Sender != actor.Account {
					messages = append(messages, m)
				}
			}
			s.state.GroupMessages[k] = messages
		}
	}
	for k, media := range s.state.Media {
		if media.Owner == actor.Account {
			mediaPaths = append(mediaPaths, s.mediaPath(media.ID))
			delete(s.state.Media, k)
		}
	}
	ownedMoments := map[string]bool{}
	for k, moment := range s.state.Moments {
		if moment.Author == actor.Account {
			ownedMoments[k] = true
			delete(s.state.Moments, k)
			delete(s.state.MomentComments, k)
		}
	}
	for momentID, comments := range s.state.MomentComments {
		kept := comments[:0]
		for _, comment := range comments {
			if comment.Author != actor.Account {
				kept = append(kept, comment)
			}
		}
		s.state.MomentComments[momentID] = kept
	}
	for k, reaction := range s.state.MomentReactions {
		if reaction.Account == actor.Account || ownedMoments[reaction.MomentID] {
			delete(s.state.MomentReactions, k)
		}
	}
	for k, report := range s.state.Reports {
		if report.Reporter == actor.Account {
			delete(s.state.Reports, k)
		}
	}
	for k, rule := range s.state.Automation {
		if rule.Account == actor.Account {
			delete(s.state.Automation, k)
		}
	}
	for key := range s.state.Idempotency {
		if strings.HasPrefix(key, actor.Account+"|") {
			delete(s.state.Idempotency, key)
		}
	}
	for k, session := range s.state.Sessions {
		if session.Account == actor.Account {
			delete(s.state.Sessions, k)
		}
	}
	for k := range s.state.Blocks {
		if strings.Contains(k, actor.Account) {
			delete(s.state.Blocks, k)
		}
	}
	for k := range s.state.Mutes {
		if strings.Contains(k, actor.Account) {
			delete(s.state.Mutes, k)
		}
	}
	now := s.cfg.Now().UTC()
	s.appendAuditLocked("privacy_account_deleted", "account", actor.Account, actor.Account, objectDigest(actor.Account), now)
	if err := s.saveOrRollbackLocked(before); err != nil {
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()
	for _, path := range mediaPaths {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (s *Service) AttachmentPolicy() AttachmentPolicy {
	return AttachmentPolicy{AllowedMIMETypes: []string{"image/jpeg", "image/png", "image/webp", "video/mp4", "audio/mp4", "application/pdf"}, MaxBytes: 25 * 1024 * 1024}
}

func (s *Service) notifyLocked(account, actor, kind, object string, now time.Time) {
	id := "notification_" + objectDigest(struct{ A, B, K, O string }{account, actor, kind, object})[:24]
	s.state.Notifications[id] = Notification{ID: id, Account: account, Actor: actor, Kind: kind, ObjectID: object, CreatedAt: now}
}
func (s *Service) blockedLocked(a, b string) bool {
	_, ab := s.state.Blocks[directedKey(a, b)]
	_, ba := s.state.Blocks[directedKey(b, a)]
	return ab || ba
}

func idempotencyStateKey(account, key string) string { return account + "|" + key }
func (s *Service) contactLocked(a, b string) bool {
	_, ok := s.state.Contacts[pairKey(a, b)]
	return ok
}
func (s *Service) sessionByIDLocked(id string) (string, Session, bool) {
	for k, v := range s.state.Sessions {
		if v.ID == id {
			return k, v, true
		}
	}
	return "", Session{}, false
}
func (s *Service) appendAuditLocked(t, ot, oid, account, payload string, at time.Time) {
	prev := ""
	if len(s.state.Audit) > 0 {
		prev = s.state.Audit[len(s.state.Audit)-1].Hash
	}
	event := AuditEvent{Sequence: uint64(len(s.state.Audit) + 1), Type: t, ObjectType: ot, ObjectID: oid, Account: account, At: at, PayloadHash: payload, PreviousHash: prev}
	event.Hash = auditHash(event)
	s.state.Audit = append(s.state.Audit, event)
}
func (s *Service) validateAuditLocked() error {
	prev := ""
	for i, e := range s.state.Audit {
		if e.Sequence != uint64(i+1) || e.PreviousHash != prev || e.Hash != auditHash(e) {
			return errors.New("social audit integrity check failed")
		}
		prev = e.Hash
	}
	return nil
}
func (s *Service) saveOrRollbackLocked(before persistentState) error {
	if err := saveState(s.cfg.StatePath, &s.state, s.cfg.TokenKey); err != nil {
		s.state = before
		return err
	}
	return nil
}
func auditHash(e AuditEvent) string { e.Hash = ""; return objectDigest(e) }
func objectDigest(v any) string {
	data, _ := json.Marshal(v)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
func tokenDigest(token string, key []byte) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

func verifyWalletSignature(account, publicKeyText, signatureText string, payload []byte) bool {
	publicKeyBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(publicKeyText), "0x"))
	if err != nil || len(publicKeyBytes) != secp256k1.PubKeyBytesLenCompressed {
		return false
	}
	derived, err := consensus.NativeAddress(publicKeyBytes)
	derivedNative, encodeErr := accountaddress.Encode(derived)
	if err != nil || encodeErr != nil || derivedNative != account {
		return false
	}
	publicKey, err := secp256k1.ParsePubKey(publicKeyBytes)
	if err != nil {
		return false
	}
	signatureBytes, err := hex.DecodeString(strings.TrimPrefix(strings.TrimSpace(signatureText), "0x"))
	if err != nil {
		return false
	}
	signature, err := ecdsa.ParseDERSignature(signatureBytes)
	if err != nil {
		return false
	}
	sValue := signature.S()
	if sValue.IsOverHalfOrder() {
		return false
	}
	digest := sha256.Sum256(payload)
	return signature.Verify(digest[:], publicKey)
}
func randomBytes(n int) []byte {
	out := make([]byte, n)
	if _, err := rand.Read(out); err != nil {
		panic(err)
	}
	return out
}
func cloneState(in persistentState) persistentState {
	data, _ := json.Marshal(in)
	var out persistentState
	_ = json.Unmarshal(data, &out)
	return out
}
func pairKey(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return a + "|" + b
}
func directedKey(a, b string) string { return a + "|" + b }
func min(a, b string) string {
	if a < b {
		return a
	}
	return b
}
func max(a, b string) string {
	if a > b {
		return a
	}
	return b
}
func contains(values []string, want string) bool {
	for _, v := range values {
		if subtle.ConstantTimeCompare([]byte(v), []byte(want)) == 1 && len(v) == len(want) {
			return true
		}
	}
	return false
}
