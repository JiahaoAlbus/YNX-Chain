package calendar

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

var handlePattern = regexp.MustCompile(`^@[a-z0-9][a-z0-9_.-]{1,30}$`)
var ErrUnauthorized = errors.New("calendar authorization required")
var ErrVersionConflict = errors.New("event version conflict; refresh before retrying")

type WalletVerifier interface {
	Verify(context.Context, WalletProof) error
}
type AIGateway interface {
	Status(context.Context) (provider, model, cost string, err error)
	Generate(context.Context, string, []Event) (string, error)
}
type Service struct {
	store    *Store
	verifier WalletVerifier
	ai       AIGateway
	now      func() time.Time
	random   io.Reader
	cancelMu sync.Mutex
	cancels  map[string]context.CancelFunc
}

func NewService(store *Store, verifier WalletVerifier, ai AIGateway) (*Service, error) {
	if store == nil || verifier == nil {
		return nil, errors.New("calendar store and wallet verifier are required")
	}
	return &Service{store: store, verifier: verifier, ai: ai, now: time.Now, random: rand.Reader, cancels: map[string]context.CancelFunc{}}, nil
}

func (s *Service) NewChallenge() (Challenge, error) {
	now := s.now().UTC()
	out := Challenge{ID: s.id("challenge"), ExpiresAt: now.Add(5 * time.Minute)}
	err := s.store.update(func(st *State) error { st.Challenges[out.ID] = out; return nil })
	return out, err
}
func centralRequestKey(proof WalletProof) string {
	if proof.Central == nil || len(proof.Central.AuthorizationRequest) == 0 {
		return ""
	}
	var value any
	if json.Unmarshal(proof.Central.AuthorizationRequest, &value) != nil {
		return "invalid"
	}
	canonical, e := json.Marshal(value)
	if e != nil {
		return "invalid"
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}
func (s *Service) SignIn(ctx context.Context, p WalletProof) (string, User, error) {
	now := s.now().UTC()
	if p.Product != ProductID || len(p.Scopes) != 1 || p.Scopes[0] != RequiredScope {
		return "", User{}, errors.New("wallet proof product or scope mismatch")
	}
	if !handlePattern.MatchString(p.Handle) || len(strings.TrimSpace(p.DeviceKey)) < 16 {
		return "", User{}, errors.New("invalid handle or product device binding")
	}
	if p.ExpiresAt < now.Unix() || p.ExpiresAt > now.Add(5*time.Minute).Unix() {
		return "", User{}, errors.New("wallet proof expiry invalid")
	}
	if err := s.verifier.Verify(ctx, p); err != nil {
		return "", User{}, fmt.Errorf("verify wallet proof: %w", err)
	}
	var token string
	var user User
	err := s.store.update(func(st *State) error {
		c, ok := st.Challenges[p.Challenge]
		if !ok || c.Used || now.After(c.ExpiresAt) {
			return errors.New("wallet challenge missing, expired, or replayed")
		}
		c.Used = true
		st.Challenges[c.ID] = c
		if key := centralRequestKey(p); key != "" {
			if st.WalletRequests[key] {
				return errors.New("central Wallet authorization request replayed")
			}
			st.WalletRequests[key] = true
		}
		hash := digest(p.Account)
		for _, u := range st.Users {
			if u.Handle == p.Handle && u.AccountHash != hash {
				return errors.New("handle already bound")
			}
			if u.AccountHash == hash {
				user = u
			}
		}
		if user.ID == "" {
			user = User{ID: s.id("user"), Handle: p.Handle, AccountHash: hash, CreatedAt: now}
			st.Users[user.ID] = user
		}
		token = s.token()
		tokenHash := digest(token)
		st.Sessions[tokenHash] = Session{TokenHash: tokenHash, UserID: user.ID, DeviceKey: p.DeviceKey, ExpiresAt: now.Add(12 * time.Hour)}
		s.audit(st, user.ID, "wallet_sign_in", user.ID, map[string]any{"scope": RequiredScope})
		return nil
	})
	return token, user, err
}
func (s *Service) Recover(ctx context.Context, p WalletProof) (string, User, error) {
	now := s.now().UTC()
	if p.Product != ProductID || len(p.Scopes) != 1 || p.Scopes[0] != RecoveryScope {
		return "", User{}, errors.New("wallet recovery proof product or scope mismatch")
	}
	if !handlePattern.MatchString(p.Handle) || len(strings.TrimSpace(p.DeviceKey)) < 16 {
		return "", User{}, errors.New("invalid recovery device binding")
	}
	if p.ExpiresAt < now.Unix() || p.ExpiresAt > now.Add(5*time.Minute).Unix() {
		return "", User{}, errors.New("wallet recovery proof expiry invalid")
	}
	if err := s.verifier.Verify(ctx, p); err != nil {
		return "", User{}, fmt.Errorf("verify wallet recovery proof: %w", err)
	}
	var token string
	var user User
	err := s.store.update(func(st *State) error {
		c, ok := st.Challenges[p.Challenge]
		if !ok || c.Used || now.After(c.ExpiresAt) {
			return errors.New("wallet challenge missing, expired, or replayed")
		}
		c.Used = true
		st.Challenges[c.ID] = c
		if key := centralRequestKey(p); key != "" {
			if st.WalletRequests[key] {
				return errors.New("central Wallet authorization request replayed")
			}
			st.WalletRequests[key] = true
		}
		hash := digest(p.Account)
		for _, u := range st.Users {
			if u.Handle == p.Handle && u.AccountHash == hash {
				user = u
				break
			}
		}
		if user.ID == "" {
			return errors.New("recovery account and handle do not match an existing Calendar identity")
		}
		for h, sess := range st.Sessions {
			if sess.UserID == user.ID && sess.RevokedAt.IsZero() {
				sess.RevokedAt = now
				st.Sessions[h] = sess
			}
		}
		user.RecoveredAt = now
		st.Users[user.ID] = user
		token = s.token()
		tokenHash := digest(token)
		st.Sessions[tokenHash] = Session{TokenHash: tokenHash, UserID: user.ID, DeviceKey: p.DeviceKey, ExpiresAt: now.Add(12 * time.Hour)}
		s.audit(st, user.ID, "account_recovery", user.ID, map[string]any{"revoked_prior_sessions": true})
		return nil
	})
	return token, user, err
}
func (s *Service) Revoke(token string) error {
	return s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		sess.RevokedAt = s.now().UTC()
		st.Sessions[sess.TokenHash] = sess
		s.audit(st, sess.UserID, "session_revoke", sess.UserID, nil)
		return nil
	})
}

func (s *Service) Account(token string) (User, error) {
	var out User
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		user, ok := st.Users[sess.UserID]
		if !ok {
			return ErrUnauthorized
		}
		out = user
		return nil
	})
	return out, err
}

func (s *Service) ExportAccount(token string) (AccountExport, error) {
	var out AccountExport
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		user := st.Users[sess.UserID]
		user.AccountHash = ""
		out = AccountExport{SchemaVersion: 1, ExportedAt: s.now().UTC(), User: user}
		for _, event := range st.Events {
			if canView(event, user.Handle, sess.UserID) {
				out.Events = append(out.Events, event)
			}
		}
		for _, change := range st.Changes {
			if change.ActorID == sess.UserID {
				out.Changes = append(out.Changes, change)
			}
		}
		for _, reminder := range st.ReminderDeliveries {
			if reminder.OwnerID == sess.UserID {
				out.Reminders = append(out.Reminders, reminder)
			}
		}
		for _, entry := range st.Audit {
			if entry.ActorID == sess.UserID {
				out.Audit = append(out.Audit, entry)
			}
		}
		sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].StartUTC.Before(out.Events[j].StartUTC) })
		sort.Slice(out.Changes, func(i, j int) bool { return out.Changes[i].CreatedAt.Before(out.Changes[j].CreatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) DeleteAccount(token, confirmation string) error {
	if confirmation != "DELETE CALENDAR ACCOUNT" {
		return errors.New("exact destructive confirmation is required")
	}
	return s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		user := st.Users[sess.UserID]
		ownedEvents := map[string]bool{}
		for id, event := range st.Events {
			if event.OwnerID == sess.UserID {
				ownedEvents[id] = true
				delete(st.Events, id)
				continue
			}
			invites := event.Invites[:0]
			for _, invite := range event.Invites {
				if invite.Handle != user.Handle {
					invites = append(invites, invite)
				}
			}
			shares := event.Shares[:0]
			for _, share := range event.Shares {
				if share.Handle != user.Handle {
					shares = append(shares, share)
				}
			}
			event.Invites, event.Shares = invites, shares
			st.Events[id] = event
		}
		for id, change := range st.Changes {
			if change.ActorID == sess.UserID || ownedEvents[change.EventID] {
				delete(st.Changes, id)
				for mutation, changeID := range st.Mutations {
					if changeID == id {
						delete(st.Mutations, mutation)
					}
				}
			}
		}
		for id, reminder := range st.ReminderDeliveries {
			if reminder.OwnerID == sess.UserID || ownedEvents[reminder.EventID] {
				delete(st.ReminderDeliveries, id)
			}
		}
		for id, job := range st.AIJobs {
			if job.OwnerID == sess.UserID {
				delete(st.AIJobs, id)
			}
		}
		for hash, session := range st.Sessions {
			if session.UserID == sess.UserID {
				delete(st.Sessions, hash)
			}
		}
		delete(st.Users, sess.UserID)
		s.audit(st, sess.UserID, "account_deleted", "", map[string]any{"former_handle_hash": digest(user.Handle)})
		return nil
	})
}

func (s *Service) PreviewCreate(token string, input EventInput) (ChangePreview, error) {
	var out ChangePreview
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		if existing := st.Mutations[sess.UserID+":"+input.ClientMutationID]; existing != "" {
			out = st.Changes[existing]
			return nil
		}
		owner := st.Users[sess.UserID]
		event, e := s.eventFromInput(owner, input)
		if e != nil {
			return e
		}
		if e = validateInvitees(st, event); e != nil {
			return e
		}
		event.ID = s.id("event")
		event.OwnerID = owner.ID
		event.OwnerHandle = owner.Handle
		event.State = "draft"
		event.Version = 1
		event.CreatedAt = s.now().UTC()
		event.UpdatedAt = event.CreatedAt
		out = ChangePreview{ID: s.id("change"), EventID: event.ID, ActorID: sess.UserID, Kind: "create", After: event, Conflicts: s.conflicts(st, event, ""), State: "preview", ClientMutationID: input.ClientMutationID, CreatedAt: s.now().UTC()}
		st.Changes[out.ID] = out
		st.Mutations[sess.UserID+":"+input.ClientMutationID] = out.ID
		s.audit(st, sess.UserID, "event_create_preview", out.ID, map[string]any{"conflicts": len(out.Conflicts)})
		return nil
	})
	return out, err
}

func (s *Service) PreviewUpdate(token, eventID string, input EventInput) (ChangePreview, error) {
	var out ChangePreview
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		if existing := st.Mutations[sess.UserID+":"+input.ClientMutationID]; existing != "" {
			out = st.Changes[existing]
			return nil
		}
		before, ok := st.Events[eventID]
		if !ok || !canEdit(st, before, sess.UserID) {
			return ErrUnauthorized
		}
		if input.BaseVersion != before.Version {
			return ErrVersionConflict
		}
		owner := st.Users[before.OwnerID]
		after, e := s.eventFromInput(owner, input)
		if e != nil {
			return e
		}
		if e = validateInvitees(st, after); e != nil {
			return e
		}
		after.ID = before.ID
		after.OwnerID = before.OwnerID
		after.OwnerHandle = before.OwnerHandle
		after.State = before.State
		after.Version = before.Version + 1
		after.CreatedAt = before.CreatedAt
		after.UpdatedAt = s.now().UTC()
		copyBefore := before
		out = ChangePreview{ID: s.id("change"), EventID: eventID, ActorID: sess.UserID, Kind: "update", Before: &copyBefore, After: after, Conflicts: s.conflicts(st, after, eventID), State: "preview", ClientMutationID: input.ClientMutationID, CreatedAt: s.now().UTC()}
		st.Changes[out.ID] = out
		st.Mutations[sess.UserID+":"+input.ClientMutationID] = out.ID
		s.audit(st, sess.UserID, "event_update_preview", out.ID, map[string]any{"conflicts": len(out.Conflicts)})
		return nil
	})
	return out, err
}

func (s *Service) PreviewCancel(token, eventID, mutationID string, baseVersion int) (ChangePreview, error) {
	var out ChangePreview
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		if existing := st.Mutations[sess.UserID+":"+mutationID]; existing != "" {
			out = st.Changes[existing]
			return nil
		}
		before, ok := st.Events[eventID]
		if !ok || before.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		if before.Version != baseVersion {
			return ErrVersionConflict
		}
		after := before
		after.State = "cancelled"
		after.Version++
		after.CancelledAt = s.now().UTC()
		after.UpdatedAt = after.CancelledAt
		copyBefore := before
		out = ChangePreview{ID: s.id("change"), EventID: eventID, ActorID: sess.UserID, Kind: "cancel", Before: &copyBefore, After: after, State: "preview", ClientMutationID: mutationID, CreatedAt: s.now().UTC()}
		st.Changes[out.ID] = out
		st.Mutations[sess.UserID+":"+mutationID] = out.ID
		s.audit(st, sess.UserID, "event_cancel_preview", out.ID, nil)
		return nil
	})
	return out, err
}

func (s *Service) ApproveChange(token, changeID string, acceptConflicts bool) (Event, error) {
	var out Event
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		change, ok := st.Changes[changeID]
		if !ok || change.ActorID != sess.UserID || change.State != "preview" {
			return ErrUnauthorized
		}
		if len(change.Conflicts) > 0 && !acceptConflicts {
			return errors.New("calendar conflicts require explicit override")
		}
		if change.Before != nil {
			current, ok := st.Events[change.EventID]
			if !ok || current.Version != change.Before.Version {
				return ErrVersionConflict
			}
		}
		event := change.After
		if event.State == "draft" {
			event.State = "scheduled"
		}
		for i := range event.Invites {
			if event.Invites[i].State == "preview" {
				event.Invites[i].State = "pending"
			}
		}
		event.UpdatedAt = s.now().UTC()
		st.Events[event.ID] = event
		change.After = event
		change.State = "applied"
		change.ApprovedAt = s.now().UTC()
		st.Changes[change.ID] = change
		s.audit(st, sess.UserID, "event_change_approved", change.ID, map[string]any{"kind": change.Kind, "conflict_override": acceptConflicts})
		out = event
		return nil
	})
	return out, err
}

func (s *Service) RevertChange(token, changeID string) (Event, error) {
	var out Event
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		change, ok := st.Changes[changeID]
		if !ok || change.ActorID != sess.UserID || change.State != "applied" {
			return ErrUnauthorized
		}
		current, ok := st.Events[change.EventID]
		if !ok || current.Version != change.After.Version {
			return ErrVersionConflict
		}
		if change.Before == nil {
			delete(st.Events, change.EventID)
			out = Event{ID: change.EventID, State: "reverted"}
		} else {
			restored := *change.Before
			restored.Version = current.Version + 1
			restored.UpdatedAt = s.now().UTC()
			st.Events[restored.ID] = restored
			out = restored
		}
		change.State = "reverted"
		change.RevertedAt = s.now().UTC()
		st.Changes[change.ID] = change
		s.audit(st, sess.UserID, "event_change_reverted", change.ID, nil)
		return nil
	})
	return out, err
}

func (s *Service) RSVP(token, eventID, response string) (Event, error) {
	if response != "accepted" && response != "declined" && response != "tentative" {
		return Event{}, errors.New("invalid RSVP")
	}
	var out Event
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		user := st.Users[sess.UserID]
		event, ok := st.Events[eventID]
		if !ok {
			return errors.New("event not found")
		}
		found := false
		for i := range event.Invites {
			if event.Invites[i].Handle == user.Handle {
				event.Invites[i].State = response
				event.Invites[i].RespondedAt = s.now().UTC()
				found = true
			}
		}
		if !found {
			return ErrUnauthorized
		}
		event.Version++
		event.UpdatedAt = s.now().UTC()
		st.Events[event.ID] = event
		s.audit(st, sess.UserID, "event_rsvp_"+response, event.ID, nil)
		out = event
		return nil
	})
	return out, err
}

func (s *Service) Share(token, eventID, handle, role string) (Event, error) {
	if !handlePattern.MatchString(handle) || (role != "viewer" && role != "editor") {
		return Event{}, errors.New("invalid share handle or role")
	}
	var out Event
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		event, ok := st.Events[eventID]
		if !ok || event.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		if _, ok = userByHandle(st, handle); !ok {
			return errors.New("unknown YNX contact")
		}
		updated := false
		for i := range event.Shares {
			if event.Shares[i].Handle == handle {
				event.Shares[i].Role = role
				updated = true
			}
		}
		if !updated {
			event.Shares = append(event.Shares, Share{Handle: handle, Role: role})
		}
		event.Version++
		event.UpdatedAt = s.now().UTC()
		st.Events[event.ID] = event
		s.audit(st, sess.UserID, "event_share", event.ID, map[string]any{"contact": handle, "role": role})
		out = event
		return nil
	})
	return out, err
}

func (s *Service) Unshare(token, eventID, handle string) (Event, error) {
	var out Event
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		event, ok := st.Events[eventID]
		if !ok || event.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		next := event.Shares[:0]
		found := false
		for _, share := range event.Shares {
			if share.Handle == handle {
				found = true
				continue
			}
			next = append(next, share)
		}
		if !found {
			return errors.New("calendar share not found")
		}
		event.Shares = next
		event.Version++
		event.UpdatedAt = s.now().UTC()
		st.Events[event.ID] = event
		s.audit(st, sess.UserID, "event_unshare", event.ID, map[string]any{"contact": handle})
		out = event
		return nil
	})
	return out, err
}

func (s *Service) Events(token string, from, to time.Time) ([]Occurrence, error) {
	out := []Occurrence{}
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		user := st.Users[sess.UserID]
		for _, event := range st.Events {
			if event.State == "cancelled" || !canView(event, user.Handle, sess.UserID) {
				continue
			}
			for _, occ := range expand(event, from, to) {
				out = append(out, occ)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].StartUTC.Before(out[j].StartUTC) })
		return nil
	})
	return out, err
}

func (s *Service) Event(token, eventID string) (Event, error) {
	var out Event
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		event, ok := st.Events[eventID]
		if !ok {
			return errors.New("event not found")
		}
		user := st.Users[sess.UserID]
		if !canView(event, user.Handle, sess.UserID) {
			return ErrUnauthorized
		}
		out = event
		return nil
	})
	return out, err
}

func (s *Service) ProcessReminders(now time.Time) ([]ReminderDelivery, error) {
	now = now.UTC()
	out := []ReminderDelivery{}
	err := s.store.update(func(st *State) error {
		for _, event := range st.Events {
			if event.State != "scheduled" {
				continue
			}
			for _, occurrence := range expand(event, now.Add(-400*24*time.Hour), now.Add(8*24*time.Hour)) {
				for _, reminder := range event.Reminders {
					key := reminder.ID + ":" + occurrence.StartUTC.Format(time.RFC3339)
					if _, exists := st.ReminderDeliveries[key]; exists {
						continue
					}
					due := occurrence.StartUTC.Add(-time.Duration(reminder.MinutesBefore) * time.Minute)
					if due.After(now) || due.Before(now.Add(-24*time.Hour)) {
						continue
					}
					state := "delivered"
					if now.Sub(due) > 2*time.Minute {
						state = "delivered_late_after_restart"
					}
					delivery := ReminderDelivery{ID: s.id("reminder_delivery"), ReminderID: reminder.ID, EventID: event.ID, OwnerID: event.OwnerID, Title: event.Title, OccurrenceStart: occurrence.StartUTC, DueAt: due, State: state, DeliveredAt: now}
					st.ReminderDeliveries[key] = delivery
					s.audit(st, event.OwnerID, "reminder_"+state, event.ID, map[string]any{"occurrence_start": occurrence.StartUTC})
					out = append(out, delivery)
				}
			}
		}
		return nil
	})
	return out, err
}

func (s *Service) Notifications(token string) ([]ReminderDelivery, error) {
	out := []ReminderDelivery{}
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		for _, delivery := range st.ReminderDeliveries {
			if delivery.OwnerID == sess.UserID {
				out = append(out, delivery)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].DeliveredAt.After(out[j].DeliveredAt) })
		return nil
	})
	return out, err
}

func (s *Service) BeginAI(ctx context.Context, token, kind string, eventIDs []string) (AIJob, error) {
	allowed := map[string]bool{"propose_times": true, "draft_agenda": true, "draft_follow_up": true, "detect_conflicts": true}
	if !allowed[kind] || len(eventIDs) == 0 || len(eventIDs) > 20 {
		return AIJob{}, errors.New("invalid AI workflow or context bounds")
	}
	if s.ai == nil {
		return AIJob{}, errors.New("AI provider is not configured")
	}
	provider, model, cost, err := s.ai.Status(ctx)
	if err != nil {
		return AIJob{}, fmt.Errorf("AI provider unavailable: %w", err)
	}
	var out AIJob
	err = s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		user := st.Users[sess.UserID]
		var titles []string
		for _, id := range eventIDs {
			event, ok := st.Events[id]
			if !ok || !canView(event, user.Handle, sess.UserID) {
				return ErrUnauthorized
			}
			titles = append(titles, event.Title)
		}
		out = AIJob{ID: s.id("ai"), OwnerID: sess.UserID, Kind: kind, EventIDs: append([]string{}, eventIDs...), ContextPreview: strings.Join(titles, "; "), Provider: provider, Model: model, CostEstimate: cost, State: "preview", CreatedAt: s.now().UTC(), UpdatedAt: s.now().UTC()}
		st.AIJobs[out.ID] = out
		s.audit(st, sess.UserID, "ai_context_preview", out.ID, map[string]any{"event_count": len(eventIDs)})
		return nil
	})
	return out, err
}
func (s *Service) ApproveAI(ctx context.Context, token, jobID string) (AIJob, error) {
	var out AIJob
	var events []Event
	var kind string
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		job, ok := st.AIJobs[jobID]
		if !ok || job.OwnerID != sess.UserID || job.State != "preview" {
			return ErrUnauthorized
		}
		job.State = "running"
		job.ApprovedAt = s.now().UTC()
		job.UpdatedAt = job.ApprovedAt
		st.AIJobs[job.ID] = job
		for _, id := range job.EventIDs {
			events = append(events, st.Events[id])
		}
		kind = job.Kind
		s.audit(st, sess.UserID, "ai_approved", job.ID, nil)
		out = job
		return nil
	})
	if err != nil {
		return out, err
	}
	jobCtx, cancel := context.WithCancel(ctx)
	s.cancelMu.Lock()
	s.cancels[jobID] = cancel
	s.cancelMu.Unlock()
	result, genErr := s.ai.Generate(jobCtx, kind, events)
	cancel()
	s.cancelMu.Lock()
	delete(s.cancels, jobID)
	s.cancelMu.Unlock()
	_ = s.store.update(func(st *State) error {
		job := st.AIJobs[jobID]
		if job.State == "cancelled" {
			out = job
			return nil
		}
		job.UpdatedAt = s.now().UTC()
		if genErr != nil {
			job.State = "failed"
			job.Error = genErr.Error()
		} else {
			job.State = "review"
			job.Result = result
		}
		st.AIJobs[job.ID] = job
		out = job
		return nil
	})
	return out, genErr
}
func (s *Service) ReviewAI(token, jobID, decision string) (AIJob, error) {
	if decision != "apply" && decision != "reject" && decision != "cancel" {
		return AIJob{}, errors.New("invalid AI decision")
	}
	var out AIJob
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		job, ok := st.AIJobs[jobID]
		if !ok || job.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		if decision == "cancel" && job.State != "running" {
			return errors.New("only running AI jobs can be cancelled")
		}
		if decision != "cancel" && job.State != "review" {
			return errors.New("AI result is not ready")
		}
		job.State = map[string]string{"apply": "applied", "reject": "rejected", "cancel": "cancelled"}[decision]
		job.ReviewedAt = s.now().UTC()
		job.UpdatedAt = job.ReviewedAt
		st.AIJobs[job.ID] = job
		s.audit(st, sess.UserID, "ai_"+decision, job.ID, map[string]any{"mutated_calendar": false})
		out = job
		return nil
	})
	if err == nil && decision == "cancel" {
		s.cancelMu.Lock()
		if cancel := s.cancels[jobID]; cancel != nil {
			cancel()
		}
		s.cancelMu.Unlock()
	}
	return out, err
}
func (s *Service) AIJob(token, jobID string) (AIJob, error) {
	var out AIJob
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		job, ok := st.AIJobs[jobID]
		if !ok || job.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		out = job
		return nil
	})
	return out, err
}
func (s *Service) Audit(token string) ([]AuditEntry, error) {
	out := []AuditEntry{}
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		for _, a := range st.Audit {
			if a.ActorID == sess.UserID {
				out = append(out, a)
			}
		}
		return nil
	})
	return out, err
}

func (s *Service) eventFromInput(owner User, input EventInput) (Event, error) {
	if strings.TrimSpace(input.ClientMutationID) == "" || len(input.ClientMutationID) > 100 {
		return Event{}, errors.New("client mutation ID is required and bounded")
	}
	if len(strings.TrimSpace(input.Title)) < 1 || len(input.Title) > 200 || len(input.Description) > 4000 {
		return Event{}, errors.New("event text bounds exceeded")
	}
	loc, err := time.LoadLocation(input.TimeZone)
	if err != nil {
		return Event{}, errors.New("unknown IANA time zone")
	}
	start, err := time.ParseInLocation("2006-01-02T15:04", input.LocalStart, loc)
	if err != nil {
		return Event{}, errors.New("invalid local start")
	}
	end, err := time.ParseInLocation("2006-01-02T15:04", input.LocalEnd, loc)
	if err != nil || !end.After(start) || end.Sub(start) > 7*24*time.Hour {
		return Event{}, errors.New("invalid event duration")
	}
	if err = validateRecurrence(input.Recurrence); err != nil {
		return Event{}, err
	}
	if len(input.Invitees) > 50 {
		return Event{}, errors.New("invitee bound exceeded")
	}
	seen := map[string]bool{}
	var invites []Invite
	for _, h := range input.Invitees {
		if !handlePattern.MatchString(h) || h == owner.Handle || seen[h] {
			return Event{}, errors.New("invalid or duplicate invitee handle")
		}
		seen[h] = true
		invites = append(invites, Invite{Handle: h, State: "preview"})
	}
	for i := range input.Reminders {
		if input.Reminders[i].MinutesBefore < 0 || input.Reminders[i].MinutesBefore > 10080 || input.Reminders[i].Channel != "local" {
			return Event{}, errors.New("invalid reminder boundary")
		}
		input.Reminders[i].ID = s.id("reminder")
		input.Reminders[i].State = "scheduled"
	}
	if err = validateMeetingLink(input.MeetingLink); err != nil {
		return Event{}, err
	}
	return Event{Title: strings.TrimSpace(input.Title), Description: strings.TrimSpace(input.Description), StartUTC: start.UTC(), EndUTC: end.UTC(), TimeZone: input.TimeZone, Recurrence: input.Recurrence, Invites: invites, Reminders: input.Reminders, MeetingLink: input.MeetingLink}, nil
}
func validateInvitees(st *State, event Event) error {
	for _, invite := range event.Invites {
		if _, ok := userByHandle(st, invite.Handle); !ok {
			return fmt.Errorf("unknown YNX invitee %s", invite.Handle)
		}
	}
	return nil
}
func validateRecurrence(r Recurrence) error {
	if r.Frequency == "" {
		return nil
	}
	if r.Frequency != "daily" && r.Frequency != "weekly" && r.Frequency != "monthly" {
		return errors.New("recurrence frequency must be daily, weekly, or monthly")
	}
	if r.Interval < 1 || r.Interval > 30 {
		return errors.New("recurrence interval out of bounds")
	}
	if r.Count < 1 || r.Count > 366 {
		return errors.New("recurrence count out of bounds")
	}
	return nil
}
func validateMeetingLink(raw string) error {
	if raw == "" {
		return nil
	}
	if len(raw) > 512 {
		return errors.New("meeting link too long")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil {
		return errors.New("meeting link must be bounded HTTPS without embedded credentials")
	}
	if strings.Contains(strings.ToLower(u.Host), "wallet") || strings.HasPrefix(strings.ToLower(u.Path), "/sign") {
		return errors.New("meeting links cannot request wallet or signing authority")
	}
	return nil
}
func expand(e Event, from, to time.Time) []Occurrence {
	loc, err := time.LoadLocation(e.TimeZone)
	if err != nil {
		return nil
	}
	start := e.StartUTC.In(loc)
	end := e.EndUTC.In(loc)
	count := 1
	if e.Recurrence.Frequency != "" {
		count = e.Recurrence.Count
	}
	out := []Occurrence{}
	for i := 0; i < count; i++ {
		var sTime time.Time
		switch e.Recurrence.Frequency {
		case "daily":
			sTime = start.AddDate(0, 0, i*e.Recurrence.Interval)
		case "weekly":
			sTime = start.AddDate(0, 0, 7*i*e.Recurrence.Interval)
		case "monthly":
			sTime = start.AddDate(0, i*e.Recurrence.Interval, 0)
		default:
			sTime = start
		}
		duration := end.Sub(start)
		finish := sTime.Add(duration)
		if !e.Recurrence.Until.IsZero() && sTime.After(e.Recurrence.Until) {
			break
		}
		if finish.After(from) && sTime.Before(to) {
			out = append(out, Occurrence{EventID: e.ID, Title: e.Title, StartUTC: sTime.UTC(), EndUTC: finish.UTC(), LocalStart: sTime.Format(time.RFC3339), LocalEnd: finish.Format(time.RFC3339), TimeZone: e.TimeZone})
		}
	}
	return out
}
func (s *Service) conflicts(st *State, candidate Event, exclude string) []Conflict {
	windowFrom := candidate.StartUTC.AddDate(-1, 0, 0)
	windowTo := candidate.StartUTC.AddDate(2, 0, 0)
	candidateOcc := expand(candidate, windowFrom, windowTo)
	var out []Conflict
	for _, e := range st.Events {
		if e.ID == exclude || e.OwnerID != candidate.OwnerID || e.State == "cancelled" {
			continue
		}
		for _, a := range candidateOcc {
			for _, b := range expand(e, windowFrom, windowTo) {
				if a.StartUTC.Before(b.EndUTC) && b.StartUTC.Before(a.EndUTC) {
					out = append(out, Conflict{EventID: e.ID, Title: e.Title, StartUTC: b.StartUTC, EndUTC: b.EndUTC})
					break
				}
			}
		}
	}
	return out
}
func canView(e Event, handle, userID string) bool {
	if e.OwnerID == userID {
		return true
	}
	for _, i := range e.Invites {
		if i.Handle == handle {
			return true
		}
	}
	for _, sh := range e.Shares {
		if sh.Handle == handle {
			return true
		}
	}
	return false
}
func canEdit(st *State, e Event, userID string) bool {
	if e.OwnerID == userID {
		return true
	}
	u := st.Users[userID]
	for _, sh := range e.Shares {
		if sh.Handle == u.Handle && sh.Role == "editor" {
			return true
		}
	}
	return false
}
func userByHandle(st *State, h string) (User, bool) {
	for _, u := range st.Users {
		if u.Handle == h {
			return u, true
		}
	}
	return User{}, false
}
func (s *Service) session(st *State, token string) (Session, error) {
	sess, ok := st.Sessions[digest(token)]
	if !ok || !sess.RevokedAt.IsZero() || s.now().After(sess.ExpiresAt) {
		return Session{}, ErrUnauthorized
	}
	return sess, nil
}
func (s *Service) audit(st *State, actor, action, target string, meta map[string]any) {
	st.Audit = append(st.Audit, AuditEntry{ID: s.id("audit"), ActorID: actor, Action: action, TargetID: target, Metadata: meta, CreatedAt: s.now().UTC()})
}
func (s *Service) id(prefix string) string { return prefix + "_" + s.token()[:22] }
func (s *Service) token() string {
	b := make([]byte, 24)
	_, _ = io.ReadFull(s.random, b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(v string) string { sum := sha256.Sum256([]byte(v)); return hex.EncodeToString(sum[:]) }
