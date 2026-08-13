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
		for _, calendar := range st.SharedCalendars {
			if calendar.OwnerID == sess.UserID || calendarRole(calendar, user.Handle) != "" {
				out.Calendars = append(out.Calendars, calendar)
			}
		}
		for _, event := range st.Events {
			role := eventAccessRole(&st, event, user.Handle, sess.UserID)
			if role != "" {
				if role == "availability" {
					event = availabilityEvent(event)
				}
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
		for _, notification := range st.Notifications {
			if notification.UserID == sess.UserID {
				out.Notifications = append(out.Notifications, notification)
			}
		}
		for _, entry := range st.Audit {
			if entry.ActorID == sess.UserID {
				out.Audit = append(out.Audit, entry)
			}
		}
		sort.Slice(out.Events, func(i, j int) bool { return out.Events[i].StartUTC.Before(out.Events[j].StartUTC) })
		sort.Slice(out.Calendars, func(i, j int) bool { return out.Calendars[i].Name < out.Calendars[j].Name })
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
		ownedCalendars := map[string]bool{}
		for id, calendar := range st.SharedCalendars {
			if calendar.OwnerID == sess.UserID {
				ownedCalendars[id] = true
				delete(st.SharedCalendars, id)
				continue
			}
			shares := calendar.Shares[:0]
			for _, share := range calendar.Shares {
				if share.Handle != user.Handle {
					shares = append(shares, share)
				}
			}
			calendar.Shares = shares
			st.SharedCalendars[id] = calendar
		}
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
			comments := event.Comments[:0]
			for _, comment := range event.Comments {
				if comment.Author != user.Handle {
					comments = append(comments, comment)
				}
			}
			if ownedCalendars[event.CalendarID] {
				event.CalendarID = "personal"
			}
			event.Invites, event.Shares, event.Comments = invites, shares, comments
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
		for id, notification := range st.Notifications {
			if notification.UserID == sess.UserID || ownedEvents[notification.EventID] {
				delete(st.Notifications, id)
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

func (s *Service) Calendars(token string) ([]SharedCalendar, error) {
	var out []SharedCalendar
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		user := st.Users[sess.UserID]
		for _, calendar := range st.SharedCalendars {
			if calendar.OwnerID == sess.UserID || calendarRole(calendar, user.Handle) != "" {
				out = append(out, calendar)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
		return nil
	})
	return out, err
}

func (s *Service) CreateCalendar(token, name, color string) (SharedCalendar, error) {
	name, color = strings.TrimSpace(name), strings.ToLower(strings.TrimSpace(color))
	if color == "" {
		color = "blue"
	}
	if len([]rune(name)) < 1 || len([]rune(name)) > 80 || !validCalendarColor(color) {
		return SharedCalendar{}, errors.New("shared calendar name or color is invalid")
	}
	var out SharedCalendar
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		owner := st.Users[sess.UserID]
		now := s.now().UTC()
		out = SharedCalendar{ID: s.id("calendar"), OwnerID: owner.ID, OwnerHandle: owner.Handle, Name: name, Color: color, Version: 1, CreatedAt: now, UpdatedAt: now}
		st.SharedCalendars[out.ID] = out
		s.audit(st, sess.UserID, "calendar_created", out.ID, map[string]any{"name": name})
		return nil
	})
	return out, err
}

func (s *Service) ShareCalendar(token, calendarID, handle, role string) (SharedCalendar, error) {
	handle, role = strings.TrimSpace(handle), strings.ToLower(strings.TrimSpace(role))
	if !handlePattern.MatchString(handle) || (role != "editor" && role != "viewer" && role != "availability") {
		return SharedCalendar{}, errors.New("shared calendar handle or role is invalid")
	}
	var out SharedCalendar
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		calendar, ok := st.SharedCalendars[calendarID]
		if !ok || calendar.OwnerID != sess.UserID || handle == calendar.OwnerHandle {
			return ErrUnauthorized
		}
		if _, ok := userByHandle(st, handle); !ok {
			return errors.New("unknown YNX contact")
		}
		updated := false
		for index := range calendar.Shares {
			if calendar.Shares[index].Handle == handle {
				calendar.Shares[index].Role = role
				updated = true
			}
		}
		if !updated {
			calendar.Shares = append(calendar.Shares, Share{Handle: handle, Role: role})
		}
		calendar.Version++
		calendar.UpdatedAt = s.now().UTC()
		st.SharedCalendars[calendar.ID] = calendar
		actor := st.Users[sess.UserID]
		title, body := "Calendar shared with you", fmt.Sprintf("%s granted %s access to %s.", actor.Handle, role, calendar.Name)
		if role == "availability" {
			title, body = "Calendar availability shared", fmt.Sprintf("%s granted availability-only access to a calendar.", actor.Handle)
		}
		s.notifyHandle(st, handle, "calendar_permission_changed", "", actor.Handle, title, body, calendar.UpdatedAt)
		s.audit(st, sess.UserID, "calendar_permission_changed", calendar.ID, map[string]any{"contact": handle, "role": role})
		out = calendar
		return nil
	})
	return out, err
}

func (s *Service) UnshareCalendar(token, calendarID, handle string) (SharedCalendar, error) {
	var out SharedCalendar
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		calendar, ok := st.SharedCalendars[calendarID]
		if !ok || calendar.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		shares, found := calendar.Shares[:0], false
		for _, share := range calendar.Shares {
			if share.Handle == handle {
				found = true
				continue
			}
			shares = append(shares, share)
		}
		if !found {
			return errors.New("calendar permission not found")
		}
		calendar.Shares = shares
		calendar.Version++
		calendar.UpdatedAt = s.now().UTC()
		st.SharedCalendars[calendar.ID] = calendar
		actor := st.Users[sess.UserID]
		s.notifyHandle(st, handle, "calendar_permission_revoked", "", actor.Handle, "Calendar access removed", fmt.Sprintf("%s removed your access to %s.", actor.Handle, calendar.Name), calendar.UpdatedAt)
		s.audit(st, sess.UserID, "calendar_permission_revoked", calendar.ID, map[string]any{"contact": handle})
		out = calendar
		return nil
	})
	return out, err
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
		if e = validateCalendarWrite(st, input.CalendarID, sess.UserID); e != nil {
			return e
		}
		event, e := s.eventFromInput(owner, input)
		if e != nil {
			return e
		}
		if e = validateInvitees(st, event); e != nil {
			return e
		}
		event.ID = s.id("event")
		event.SeriesID = event.ID
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
	return s.previewUpdate(token, eventID, input, "")
}

func (s *Service) previewUpdate(token, eventID string, input EventInput, scope string) (ChangePreview, error) {
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
		if e = validateCalendarWrite(st, input.CalendarID, sess.UserID); e != nil {
			return e
		}
		after, e := s.eventFromInput(owner, input)
		if e != nil {
			return e
		}
		if e = validateInvitees(st, after); e != nil {
			return e
		}
		after.ID = before.ID
		after.SeriesID = seriesID(before)
		after.ParentEventID = before.ParentEventID
		after.SplitFromRecurrenceID = before.SplitFromRecurrenceID
		after.OwnerID = before.OwnerID
		after.OwnerHandle = before.OwnerHandle
		after.State = before.State
		after.Version = before.Version + 1
		after.CreatedAt = before.CreatedAt
		after.UpdatedAt = s.now().UTC()
		copyBefore := before
		out = ChangePreview{ID: s.id("change"), EventID: eventID, ActorID: sess.UserID, Kind: "update", Scope: scope, Before: &copyBefore, After: after, Conflicts: s.conflicts(st, after, eventID), State: "preview", ClientMutationID: input.ClientMutationID, CreatedAt: s.now().UTC()}
		st.Changes[out.ID] = out
		st.Mutations[sess.UserID+":"+input.ClientMutationID] = out.ID
		s.audit(st, sess.UserID, "event_update_preview", out.ID, map[string]any{"conflicts": len(out.Conflicts)})
		return nil
	})
	return out, err
}

func (s *Service) PreviewRecurrenceChange(token, eventID string, input RecurrenceMutationInput) (ChangePreview, error) {
	input.Scope = strings.ToLower(strings.TrimSpace(input.Scope))
	input.Action = strings.ToLower(strings.TrimSpace(input.Action))
	input.RecurrenceID = strings.TrimSpace(input.RecurrenceID)
	input.ClientMutationID = strings.TrimSpace(input.ClientMutationID)
	if input.ClientMutationID == "" || len(input.ClientMutationID) > 100 {
		return ChangePreview{}, errors.New("client mutation ID is required and bounded")
	}
	if input.Scope == "entire_series" {
		if input.Action != "update" || input.Series == nil || input.RecurrenceID != "" || strings.TrimSpace(input.Series.Recurrence.Frequency) == "" {
			return ChangePreview{}, errors.New("entire-series recurrence changes require a recurring update series and no recurrence ID")
		}
		current, err := s.Event(token, eventID)
		if err != nil {
			return ChangePreview{}, err
		}
		if current.Recurrence.Frequency == "" {
			return ChangePreview{}, errors.New("entire-series recurrence changes require a recurring event")
		}
		seriesInput := *input.Series
		seriesInput.ClientMutationID = input.ClientMutationID
		seriesInput.BaseVersion = input.BaseVersion
		return s.previewUpdate(token, eventID, seriesInput, "entire_series")
	}
	if input.Scope != "occurrence" && input.Scope != "this_and_following" {
		return ChangePreview{}, errors.New("recurrence scope must be occurrence, this_and_following, or entire_series")
	}
	if input.RecurrenceID == "" {
		return ChangePreview{}, errors.New("recurrence ID is required")
	}

	var out ChangePreview
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		mutationKey := sess.UserID + ":" + input.ClientMutationID
		if existing := st.Mutations[mutationKey]; existing != "" {
			out = st.Changes[existing]
			return nil
		}
		before, ok := st.Events[eventID]
		if !ok || before.State == "cancelled" {
			return ErrUnauthorized
		}
		if input.BaseVersion != before.Version {
			return ErrVersionConflict
		}
		if before.Recurrence.Frequency == "" {
			return errors.New("recurrence mutation requires a recurring event")
		}
		occurrenceStart, occurrenceIndex, err := findRecurrenceStart(before, input.RecurrenceID)
		if err != nil {
			return err
		}
		owner := st.Users[before.OwnerID]
		now := s.now().UTC()
		copyBefore := before

		switch input.Scope {
		case "occurrence":
			if input.Series != nil {
				return errors.New("occurrence recurrence changes cannot include a series")
			}
			if input.Action != "cancel" && input.Action != "modify" {
				return errors.New("occurrence action must be cancel or modify")
			}
			if input.Action == "cancel" {
				if before.OwnerID != sess.UserID {
					return ErrUnauthorized
				}
			} else if !canEdit(st, before, sess.UserID) {
				return ErrUnauthorized
			}
			exception := RecurrenceException{RecurrenceID: input.RecurrenceID, State: map[string]string{"cancel": "cancelled", "modify": "modified"}[input.Action]}
			if input.Action == "modify" {
				exception.LocalStart = strings.TrimSpace(input.LocalStart)
				exception.LocalEnd = strings.TrimSpace(input.LocalEnd)
				exception.Title = strings.TrimSpace(input.Title)
			}
			after := before
			after.SeriesID = seriesID(before)
			after.Recurrence = upsertRecurrenceException(after.Recurrence, exception)
			loc, _ := time.LoadLocation(after.TimeZone)
			after.Recurrence, err = normalizeRecurrence(after.Recurrence, after.StartUTC.In(loc), loc)
			if err != nil {
				return err
			}
			after.Version++
			after.UpdatedAt = now
			var conflicts []Conflict
			if input.Action == "modify" {
				replacementStart, _ := time.ParseInLocation(recurrenceLocalLayout, exception.LocalStart, loc)
				replacementEnd, _ := time.ParseInLocation(recurrenceLocalLayout, exception.LocalEnd, loc)
				replacement := Event{ID: before.ID, SeriesID: seriesID(before), OwnerID: before.OwnerID, OwnerHandle: before.OwnerHandle, Title: after.Title, StartUTC: replacementStart.UTC(), EndUTC: replacementEnd.UTC(), TimeZone: before.TimeZone, BufferBeforeMinutes: before.BufferBeforeMinutes, BufferAfterMinutes: before.BufferAfterMinutes, State: before.State}
				if exception.Title != "" {
					replacement.Title = exception.Title
				}
				conflicts = s.conflicts(st, replacement, eventID)
			}
			out = ChangePreview{ID: s.id("change"), EventID: eventID, ActorID: sess.UserID, Kind: "recurrence", Scope: "occurrence", RecurrenceID: input.RecurrenceID, Before: &copyBefore, After: after, Conflicts: conflicts, State: "preview", ClientMutationID: input.ClientMutationID, CreatedAt: now}
		case "this_and_following":
			if input.Action != "update" || input.Series == nil {
				return errors.New("this-and-following recurrence changes require an update series")
			}
			if !canEdit(st, before, sess.UserID) {
				return ErrUnauthorized
			}
			if occurrenceIndex == 0 {
				return errors.New("the first occurrence must use entire_series scope")
			}
			seriesInput := *input.Series
			seriesInput.ClientMutationID = input.ClientMutationID
			seriesInput.BaseVersion = 0
			future, err := s.eventFromInput(owner, seriesInput)
			if err != nil {
				return err
			}
			if future.Recurrence.Frequency == "" {
				return errors.New("this-and-following update must remain a recurring series")
			}
			if err = validateInvitees(st, future); err != nil {
				return err
			}
			starts := recurrenceStarts(before)
			previousStart := starts[occurrenceIndex-1]
			previousEnd := previousStart.Add(before.EndUTC.Sub(before.StartUTC))
			if future.StartUTC.Before(previousEnd.UTC()) {
				return errors.New("future series must not overlap the preceding occurrence")
			}

			truncated := before
			truncated.SeriesID = seriesID(before)
			truncated.Recurrence.Exceptions = recurrenceExceptionsBefore(before.Recurrence.Exceptions, input.RecurrenceID)
			if before.Recurrence.Count > 0 {
				truncated.Recurrence.Count = occurrenceIndex
				truncated.Recurrence.Until = time.Time{}
			} else {
				truncated.Recurrence.Until = previousStart.UTC()
			}
			loc, _ := time.LoadLocation(truncated.TimeZone)
			truncated.Recurrence, err = normalizeRecurrence(truncated.Recurrence, truncated.StartUTC.In(loc), loc)
			if err != nil {
				return err
			}
			truncated.Version++
			truncated.UpdatedAt = now

			future.ID = s.id("event")
			future.SeriesID = seriesID(before)
			future.ParentEventID = before.ID
			future.SplitFromRecurrenceID = input.RecurrenceID
			future.OwnerID = before.OwnerID
			future.OwnerHandle = before.OwnerHandle
			future.Shares = append([]Share(nil), before.Shares...)
			future.State = before.State
			future.Version = 1
			future.CreatedAt = now
			future.UpdatedAt = now

			out = ChangePreview{ID: s.id("change"), EventID: eventID, ActorID: sess.UserID, Kind: "recurrence", Scope: "this_and_following", RecurrenceID: input.RecurrenceID, Before: &copyBefore, After: truncated, RelatedAfter: []Event{future}, Conflicts: s.conflicts(st, future, eventID), State: "preview", ClientMutationID: input.ClientMutationID, CreatedAt: now}
		}

		st.Changes[out.ID] = out
		st.Mutations[mutationKey] = out.ID
		s.audit(st, sess.UserID, "event_recurrence_preview", out.ID, map[string]any{"scope": input.Scope, "action": input.Action, "recurrence_id": input.RecurrenceID, "occurrence_start": occurrenceStart.UTC(), "conflicts": len(out.Conflicts), "related_events": len(out.RelatedAfter)})
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

func appliedEvent(event Event, now time.Time) Event {
	if event.State == "draft" {
		event.State = "scheduled"
	}
	for i := range event.Invites {
		if event.Invites[i].State == "preview" {
			event.Invites[i].State = "pending"
		}
	}
	event.UpdatedAt = now
	return event
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
		relatedBefore := map[string]Event{}
		for _, before := range change.RelatedBefore {
			current, ok := st.Events[before.ID]
			if !ok || current.Version != before.Version {
				return ErrVersionConflict
			}
			relatedBefore[before.ID] = before
		}
		for _, after := range change.RelatedAfter {
			current, exists := st.Events[after.ID]
			before, replaces := relatedBefore[after.ID]
			if replaces {
				if !exists || current.Version != before.Version {
					return ErrVersionConflict
				}
			} else if exists {
				return ErrVersionConflict
			}
		}

		now := s.now().UTC()
		event := appliedEvent(change.After, now)
		st.Events[event.ID] = event
		change.After = event
		for i := range change.RelatedAfter {
			related := appliedEvent(change.RelatedAfter[i], now)
			st.Events[related.ID] = related
			change.RelatedAfter[i] = related
		}
		change.State = "applied"
		change.ApprovedAt = now
		st.Changes[change.ID] = change
		actor := st.Users[sess.UserID]
		kindTitle := map[string]string{"create": "New calendar invitation", "update": "Calendar event updated", "cancel": "Calendar event cancelled", "recurrence": "Recurring event updated"}[change.Kind]
		if kindTitle == "" {
			kindTitle = "Calendar event changed"
		}
		recipients := map[string]bool{}
		for _, invite := range event.Invites {
			recipients[invite.Handle] = true
		}
		if event.OwnerID != sess.UserID {
			recipients[event.OwnerHandle] = true
		}
		for handle := range recipients {
			if handle != actor.Handle {
				s.notifyHandle(st, handle, "event_"+change.Kind, event.ID, actor.Handle, kindTitle, event.Title, now)
			}
		}
		s.audit(st, sess.UserID, "event_change_approved", change.ID, map[string]any{"kind": change.Kind, "scope": change.Scope, "conflict_override": acceptConflicts, "related_events": len(change.RelatedAfter)})
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
		relatedCurrent := map[string]Event{}
		for _, after := range change.RelatedAfter {
			currentRelated, ok := st.Events[after.ID]
			if !ok || currentRelated.Version != after.Version {
				return ErrVersionConflict
			}
			relatedCurrent[after.ID] = currentRelated
		}
		relatedBefore := map[string]Event{}
		for _, before := range change.RelatedBefore {
			relatedBefore[before.ID] = before
		}

		now := s.now().UTC()
		if change.Before == nil {
			delete(st.Events, change.EventID)
			out = Event{ID: change.EventID, State: "reverted"}
		} else {
			restored := *change.Before
			restored.Version = current.Version + 1
			restored.UpdatedAt = now
			st.Events[restored.ID] = restored
			out = restored
		}
		for _, after := range change.RelatedAfter {
			if before, ok := relatedBefore[after.ID]; ok {
				restored := before
				restored.Version = relatedCurrent[after.ID].Version + 1
				restored.UpdatedAt = now
				st.Events[restored.ID] = restored
			} else {
				delete(st.Events, after.ID)
			}
		}
		change.State = "reverted"
		change.RevertedAt = now
		st.Changes[change.ID] = change
		s.audit(st, sess.UserID, "event_change_reverted", change.ID, map[string]any{"scope": change.Scope, "related_events": len(change.RelatedAfter)})
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
		owner := st.Users[event.OwnerID]
		s.notifyHandle(st, owner.Handle, "event_rsvp", event.ID, user.Handle, "Invitation response", fmt.Sprintf("%s responded %s to %s.", user.Handle, response, event.Title), event.UpdatedAt)
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
		actor := st.Users[sess.UserID]
		s.notifyHandle(st, handle, "event_share", event.ID, actor.Handle, "Event shared with you", event.Title, event.UpdatedAt)
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
		actor := st.Users[sess.UserID]
		s.notifyHandle(st, handle, "event_unshare", event.ID, actor.Handle, "Event access removed", event.Title, event.UpdatedAt)
		s.audit(st, sess.UserID, "event_unshare", event.ID, map[string]any{"contact": handle})
		out = event
		return nil
	})
	return out, err
}

// AddComment is independent from event edits so viewers can collaborate
// without receiving schedule-edit authority.
func (s *Service) AddComment(token, eventID, body string) (Event, error) {
	body = strings.TrimSpace(body)
	if body == "" || len([]rune(body)) > 1000 {
		return Event{}, errors.New("comment must contain 1 to 1000 characters")
	}
	var out Event
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		user := st.Users[sess.UserID]
		event, ok := st.Events[eventID]
		if !ok || event.State == "cancelled" || !canView(st, event, user.Handle, sess.UserID) || eventAccessRole(st, event, user.Handle, sess.UserID) == "availability" {
			return ErrUnauthorized
		}
		comment := Comment{ID: s.id("comment"), Author: user.Handle, Body: body, CreatedAt: s.now().UTC()}
		event.Comments = append(event.Comments, comment)
		event.Version++
		event.UpdatedAt = comment.CreatedAt
		st.Events[event.ID] = event
		recipients := map[string]bool{event.OwnerHandle: true}
		for _, invite := range event.Invites {
			recipients[invite.Handle] = true
		}
		for _, share := range event.Shares {
			recipients[share.Handle] = true
		}
		if calendar, ok := st.SharedCalendars[event.CalendarID]; ok {
			for _, share := range calendar.Shares {
				if share.Role != "availability" {
					recipients[share.Handle] = true
				}
			}
		}
		for handle := range recipients {
			if handle != user.Handle {
				s.notifyHandle(st, handle, "event_comment", event.ID, user.Handle, "New participant comment", event.Title, comment.CreatedAt)
			}
		}
		s.audit(st, sess.UserID, "event_comment_added", event.ID, map[string]any{"comment_id": comment.ID})
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
			role := eventAccessRole(&st, event, user.Handle, sess.UserID)
			if event.State == "cancelled" || role == "" {
				continue
			}
			if role == "availability" {
				event = availabilityEvent(event)
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
		if !canView(&st, event, user.Handle, sess.UserID) {
			return ErrUnauthorized
		}
		if eventAccessRole(&st, event, user.Handle, sess.UserID) == "availability" {
			event = availabilityEvent(event)
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

func (s *Service) ActivityNotifications(token string) ([]ActivityNotification, error) {
	out := []ActivityNotification{}
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		for _, notification := range st.Notifications {
			if notification.UserID == sess.UserID {
				out = append(out, notification)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) MarkNotificationsRead(token string) (int, error) {
	count := 0
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		now := s.now().UTC()
		for id, notification := range st.Notifications {
			if notification.UserID == sess.UserID && notification.State == "unread" {
				notification.State = "read"
				notification.ReadAt = now
				st.Notifications[id] = notification
				count++
			}
		}
		s.audit(st, sess.UserID, "notifications_marked_read", sess.UserID, map[string]any{"count": count})
		return nil
	})
	return count, err
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
			if !ok || !canView(st, event, user.Handle, sess.UserID) || eventAccessRole(st, event, user.Handle, sess.UserID) == "availability" {
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
	if len(strings.TrimSpace(input.Title)) < 1 || len(input.Title) > 200 || len(input.Description) > 4000 || len(input.Location) > 300 {
		return Event{}, errors.New("event text bounds exceeded")
	}
	input.CalendarID = strings.TrimSpace(input.CalendarID)
	if input.CalendarID == "" {
		input.CalendarID = "personal"
	}
	if input.CalendarID != "personal" && input.CalendarID != "team" && input.CalendarID != "shared" && (!strings.HasPrefix(input.CalendarID, "calendar_") || len(input.CalendarID) > 100) {
		return Event{}, errors.New("invalid calendar classification")
	}
	input.Privacy = strings.TrimSpace(input.Privacy)
	if input.Privacy == "" {
		input.Privacy = "private"
	}
	if input.Privacy != "private" && input.Privacy != "participants" && input.Privacy != "availability" {
		return Event{}, errors.New("invalid event privacy")
	}
	input.Color = strings.ToLower(strings.TrimSpace(input.Color))
	if input.Color == "" {
		input.Color = "blue"
	}
	if !validCalendarColor(input.Color) {
		return Event{}, errors.New("invalid calendar color")
	}
	if len(input.AttachmentLinks) > 10 {
		return Event{}, errors.New("attachment link bound exceeded")
	}
	for i, link := range input.AttachmentLinks {
		input.AttachmentLinks[i] = strings.TrimSpace(link)
		if err := validateAttachmentLink(input.AttachmentLinks[i]); err != nil {
			return Event{}, err
		}
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
	input.Recurrence, err = normalizeRecurrence(input.Recurrence, start, loc)
	if err != nil {
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
	if input.BufferBeforeMinutes < 0 || input.BufferBeforeMinutes > 240 || input.BufferAfterMinutes < 0 || input.BufferAfterMinutes > 240 {
		return Event{}, errors.New("event buffers must be between 0 and 240 minutes")
	}
	return Event{Title: strings.TrimSpace(input.Title), Description: strings.TrimSpace(input.Description), Location: strings.TrimSpace(input.Location), AllDay: input.AllDay, CalendarID: input.CalendarID, Color: input.Color, Privacy: input.Privacy, AttachmentLinks: input.AttachmentLinks, StartUTC: start.UTC(), EndUTC: end.UTC(), TimeZone: input.TimeZone, Recurrence: input.Recurrence, Invites: invites, Reminders: input.Reminders, MeetingLink: input.MeetingLink, BufferBeforeMinutes: input.BufferBeforeMinutes, BufferAfterMinutes: input.BufferAfterMinutes}, nil
}
func validateInvitees(st *State, event Event) error {
	for _, invite := range event.Invites {
		if _, ok := userByHandle(st, invite.Handle); !ok {
			return fmt.Errorf("unknown YNX invitee %s", invite.Handle)
		}
	}
	return nil
}

const recurrenceLocalLayout = "2006-01-02T15:04"

var recurrenceWeekdays = map[string]time.Weekday{
	"SU": time.Sunday,
	"MO": time.Monday,
	"TU": time.Tuesday,
	"WE": time.Wednesday,
	"TH": time.Thursday,
	"FR": time.Friday,
	"SA": time.Saturday,
}

func normalizeRecurrence(r Recurrence, start time.Time, loc *time.Location) (Recurrence, error) {
	r.Frequency = strings.ToLower(strings.TrimSpace(r.Frequency))
	if r.Frequency == "" {
		if r.Interval != 0 || r.Count != 0 || !r.Until.IsZero() || len(r.ByDay) != 0 || len(r.ByMonthDay) != 0 || len(r.Exceptions) != 0 {
			return Recurrence{}, errors.New("recurrence options require a frequency")
		}
		return Recurrence{}, nil
	}
	if r.SchemaVersion == 0 {
		r.SchemaVersion = 1
	}
	if r.SchemaVersion != 1 {
		return Recurrence{}, errors.New("unsupported recurrence schema version")
	}
	if r.Frequency != "daily" && r.Frequency != "weekly" && r.Frequency != "monthly" && r.Frequency != "yearly" {
		return Recurrence{}, errors.New("recurrence frequency must be daily, weekly, monthly, or yearly")
	}
	if r.Interval < 1 || r.Interval > 30 {
		return Recurrence{}, errors.New("recurrence interval out of bounds")
	}
	if r.Count < 0 || r.Count > 366 {
		return Recurrence{}, errors.New("recurrence count out of bounds")
	}
	if r.Count == 0 && r.Until.IsZero() {
		return Recurrence{}, errors.New("recurrence requires count or until")
	}
	if !r.Until.IsZero() {
		until := r.Until.In(loc)
		if until.Before(start) || until.After(start.AddDate(10, 0, 0)) {
			return Recurrence{}, errors.New("recurrence until is outside the supported ten-year window")
		}
	}
	if len(r.ByDay) > 7 {
		return Recurrence{}, errors.New("recurrence by-day bound exceeded")
	}
	seenDays := map[string]bool{}
	for i, raw := range r.ByDay {
		day := strings.ToUpper(strings.TrimSpace(raw))
		if _, ok := recurrenceWeekdays[day]; !ok || seenDays[day] {
			return Recurrence{}, errors.New("recurrence by-day contains an invalid or duplicate weekday")
		}
		seenDays[day] = true
		r.ByDay[i] = day
	}
	if len(r.ByDay) > 0 && r.Frequency != "weekly" {
		return Recurrence{}, errors.New("recurrence by-day is supported only for weekly rules")
	}
	if r.Frequency == "weekly" && len(r.ByDay) == 0 {
		r.ByDay = []string{weekdayCode(start.Weekday())}
	}
	sort.Slice(r.ByDay, func(i, j int) bool {
		return weekdayOffset(recurrenceWeekdays[r.ByDay[i]]) < weekdayOffset(recurrenceWeekdays[r.ByDay[j]])
	})
	if len(r.ByMonthDay) > 31 {
		return Recurrence{}, errors.New("recurrence by-month-day bound exceeded")
	}
	seenMonthDays := map[int]bool{}
	for _, day := range r.ByMonthDay {
		if day < 1 || day > 31 || seenMonthDays[day] {
			return Recurrence{}, errors.New("recurrence by-month-day contains an invalid or duplicate day")
		}
		seenMonthDays[day] = true
	}
	if len(r.ByMonthDay) > 0 && r.Frequency != "monthly" {
		return Recurrence{}, errors.New("recurrence by-month-day is supported only for monthly rules")
	}
	if r.Frequency == "monthly" && len(r.ByMonthDay) == 0 {
		r.ByMonthDay = []int{start.Day()}
	}
	sort.Ints(r.ByMonthDay)
	seenExceptions := map[string]bool{}
	for i := range r.Exceptions {
		ex := &r.Exceptions[i]
		ex.RecurrenceID = strings.TrimSpace(ex.RecurrenceID)
		ex.State = strings.ToLower(strings.TrimSpace(ex.State))
		original, err := time.ParseInLocation(recurrenceLocalLayout, ex.RecurrenceID, loc)
		if err != nil || original.Before(start) || seenExceptions[ex.RecurrenceID] {
			return Recurrence{}, errors.New("recurrence exception ID is invalid, duplicate, or before the series start")
		}
		seenExceptions[ex.RecurrenceID] = true
		if ex.State != "cancelled" && ex.State != "modified" {
			return Recurrence{}, errors.New("recurrence exception state must be cancelled or modified")
		}
		if ex.State == "cancelled" {
			if ex.LocalStart != "" || ex.LocalEnd != "" || ex.Title != "" {
				return Recurrence{}, errors.New("cancelled recurrence exceptions cannot carry replacement data")
			}
			continue
		}
		replacementStart, err := time.ParseInLocation(recurrenceLocalLayout, ex.LocalStart, loc)
		if err != nil {
			return Recurrence{}, errors.New("modified recurrence exception has invalid local start")
		}
		replacementEnd, err := time.ParseInLocation(recurrenceLocalLayout, ex.LocalEnd, loc)
		if err != nil || !replacementEnd.After(replacementStart) || replacementEnd.Sub(replacementStart) > 7*24*time.Hour {
			return Recurrence{}, errors.New("modified recurrence exception has invalid duration")
		}
		if len(ex.Title) > 200 {
			return Recurrence{}, errors.New("modified recurrence exception title is too long")
		}
	}
	return r, nil
}

func weekdayCode(day time.Weekday) string {
	for code, candidate := range recurrenceWeekdays {
		if candidate == day {
			return code
		}
	}
	return "MO"
}

func weekdayOffset(day time.Weekday) int {
	return (int(day) + 6) % 7
}

func seriesID(event Event) string {
	if strings.TrimSpace(event.SeriesID) != "" {
		return event.SeriesID
	}
	return event.ID
}

func recurrenceStarts(event Event) []time.Time {
	loc, err := time.LoadLocation(event.TimeZone)
	if err != nil {
		return nil
	}
	start := event.StartUTC.In(loc)
	if event.Recurrence.Frequency == "" {
		return []time.Time{start}
	}
	limit := event.Recurrence.Count
	if limit == 0 {
		limit = 5000
	}
	out := make([]time.Time, 0, min(limit, 64))
	accept := func(candidate time.Time) bool {
		if candidate.Before(start) {
			return true
		}
		if !event.Recurrence.Until.IsZero() && candidate.After(event.Recurrence.Until.In(loc)) {
			return false
		}
		if len(out) >= limit {
			return false
		}
		out = append(out, candidate)
		return len(out) < limit
	}
	switch event.Recurrence.Frequency {
	case "daily":
		for i := 0; i < limit; i++ {
			if !accept(start.AddDate(0, 0, i*event.Recurrence.Interval)) {
				break
			}
		}
	case "weekly":
		byDay := event.Recurrence.ByDay
		if len(byDay) == 0 {
			byDay = []string{weekdayCode(start.Weekday())}
		}
		weekStart := start.AddDate(0, 0, -weekdayOffset(start.Weekday()))
		for week := 0; len(out) < limit && week < 5000; week++ {
			base := weekStart.AddDate(0, 0, week*7*event.Recurrence.Interval)
			for _, code := range byDay {
				candidate := wallTime(base.AddDate(0, 0, weekdayOffset(recurrenceWeekdays[code])), start)
				if !accept(candidate) {
					return out
				}
			}
		}
	case "monthly":
		byMonthDay := event.Recurrence.ByMonthDay
		if len(byMonthDay) == 0 {
			byMonthDay = []int{start.Day()}
		}
		for month := 0; len(out) < limit && month < 1200; month++ {
			base := time.Date(start.Year(), start.Month()+time.Month(month*event.Recurrence.Interval), 1, start.Hour(), start.Minute(), start.Second(), start.Nanosecond(), loc)
			for _, day := range byMonthDay {
				candidate, ok := validLocalDate(base.Year(), base.Month(), day, start)
				if !ok {
					continue
				}
				if !accept(candidate) {
					return out
				}
			}
		}
	case "yearly":
		for year := 0; len(out) < limit && year < 100; year++ {
			candidate, ok := validLocalDate(start.Year()+year*event.Recurrence.Interval, start.Month(), start.Day(), start)
			if !ok {
				continue
			}
			if !accept(candidate) {
				break
			}
		}
	}
	return out
}

func findRecurrenceStart(event Event, recurrenceID string) (time.Time, int, error) {
	recurrenceID = strings.TrimSpace(recurrenceID)
	loc, err := time.LoadLocation(event.TimeZone)
	if err != nil {
		return time.Time{}, -1, errors.New("unknown IANA time zone")
	}
	if _, err = time.ParseInLocation(recurrenceLocalLayout, recurrenceID, loc); err != nil {
		return time.Time{}, -1, errors.New("invalid recurrence ID")
	}
	for index, candidate := range recurrenceStarts(event) {
		if candidate.Format(recurrenceLocalLayout) == recurrenceID {
			return candidate, index, nil
		}
	}
	return time.Time{}, -1, errors.New("recurrence ID does not identify an occurrence in the current series")
}

func upsertRecurrenceException(recurrence Recurrence, exception RecurrenceException) Recurrence {
	next := make([]RecurrenceException, 0, len(recurrence.Exceptions)+1)
	for _, existing := range recurrence.Exceptions {
		if existing.RecurrenceID != exception.RecurrenceID {
			next = append(next, existing)
		}
	}
	next = append(next, exception)
	sort.Slice(next, func(i, j int) bool { return next[i].RecurrenceID < next[j].RecurrenceID })
	recurrence.Exceptions = next
	return recurrence
}

func recurrenceExceptionsBefore(exceptions []RecurrenceException, recurrenceID string) []RecurrenceException {
	out := make([]RecurrenceException, 0, len(exceptions))
	for _, exception := range exceptions {
		if exception.RecurrenceID < recurrenceID {
			out = append(out, exception)
		}
	}
	return out
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

func validateAttachmentLink(raw string) error {
	if raw == "" || len(raw) > 1024 {
		return errors.New("attachment link must be a bounded HTTPS URL")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return errors.New("attachment link must be bounded HTTPS without credentials or fragments")
	}
	if strings.Contains(strings.ToLower(u.Host), "wallet") || strings.HasPrefix(strings.ToLower(u.Path), "/sign") {
		return errors.New("attachment links cannot request wallet or signing authority")
	}
	return nil
}
func expand(e Event, from, to time.Time) []Occurrence {
	loc, err := time.LoadLocation(e.TimeZone)
	if err != nil {
		return nil
	}
	start := e.StartUTC.In(loc)
	duration := e.EndUTC.In(loc).Sub(start)
	exceptions := map[string]RecurrenceException{}
	for _, exception := range e.Recurrence.Exceptions {
		exceptions[exception.RecurrenceID] = exception
	}
	out := []Occurrence{}
	for _, candidate := range recurrenceStarts(e) {
		exception, ok := exceptions[candidate.Format(recurrenceLocalLayout)]
		if ok && exception.State == "cancelled" {
			continue
		}
		if ok {
			out = appendOccurrence(out, e, candidate, duration, from, to, &exception, loc)
		} else {
			out = appendOccurrence(out, e, candidate, duration, from, to, nil, loc)
		}
	}
	return out
}

func wallTime(date, template time.Time) time.Time {
	return time.Date(date.Year(), date.Month(), date.Day(), template.Hour(), template.Minute(), template.Second(), template.Nanosecond(), template.Location())
}

func validLocalDate(year int, month time.Month, day int, template time.Time) (time.Time, bool) {
	candidate := time.Date(year, month, day, template.Hour(), template.Minute(), template.Second(), template.Nanosecond(), template.Location())
	return candidate, candidate.Year() == year && candidate.Month() == month && candidate.Day() == day
}

func appendOccurrence(out []Occurrence, e Event, original time.Time, duration time.Duration, from, to time.Time, ex *RecurrenceException, loc *time.Location) []Occurrence {
	start := original
	finish := original.Add(duration)
	title := e.Title
	if ex != nil && ex.State == "modified" {
		modifiedStart, startErr := time.ParseInLocation(recurrenceLocalLayout, ex.LocalStart, loc)
		modifiedEnd, endErr := time.ParseInLocation(recurrenceLocalLayout, ex.LocalEnd, loc)
		if startErr != nil || endErr != nil || !modifiedEnd.After(modifiedStart) {
			return out
		}
		start = modifiedStart
		finish = modifiedEnd
		if strings.TrimSpace(ex.Title) != "" {
			title = strings.TrimSpace(ex.Title)
		}
	}
	if finish.After(from) && start.Before(to) {
		out = append(out, Occurrence{EventID: e.ID, Title: title, Location: e.Location, AllDay: e.AllDay, CalendarID: e.CalendarID, Color: e.Color, Privacy: e.Privacy, OwnerHandle: e.OwnerHandle, StartUTC: start.UTC(), EndUTC: finish.UTC(), LocalStart: start.Format(time.RFC3339), LocalEnd: finish.Format(time.RFC3339), TimeZone: e.TimeZone})
	}
	return out
}
func (s *Service) conflicts(st *State, candidate Event, exclude string) []Conflict {
	windowFrom := candidate.StartUTC.AddDate(-1, 0, 0)
	windowTo := candidate.StartUTC.AddDate(2, 0, 0)
	candidateOcc := expand(candidate, windowFrom, windowTo)
	var out []Conflict
	participantOwners := map[string]string{}
	for _, invite := range candidate.Invites {
		if user, ok := userByHandle(st, invite.Handle); ok {
			participantOwners[user.ID] = user.Handle
		}
	}
	for _, e := range st.Events {
		if e.ID == exclude || e.State == "cancelled" {
			continue
		}
		participantHandle := ""
		if e.OwnerID != candidate.OwnerID {
			participantHandle = participantOwners[e.OwnerID]
			if participantHandle == "" || !availabilityAuthorized(st, e, candidate.OwnerHandle) {
				continue
			}
		}
		for _, a := range candidateOcc {
			for _, b := range expand(e, windowFrom, windowTo) {
				candidateStart := a.StartUTC.Add(-time.Duration(candidate.BufferBeforeMinutes) * time.Minute)
				candidateEnd := a.EndUTC.Add(time.Duration(candidate.BufferAfterMinutes) * time.Minute)
				existingStart := b.StartUTC.Add(-time.Duration(e.BufferBeforeMinutes) * time.Minute)
				existingEnd := b.EndUTC.Add(time.Duration(e.BufferAfterMinutes) * time.Minute)
				if candidateStart.Before(existingEnd) && existingStart.Before(candidateEnd) {
					kind := "buffer"
					if a.StartUTC.Before(b.EndUTC) && b.StartUTC.Before(a.EndUTC) {
						kind = "overlap"
					}
					conflict := Conflict{EventID: e.ID, Title: e.Title, Kind: kind, StartUTC: b.StartUTC, EndUTC: b.EndUTC}
					if participantHandle != "" {
						conflict.EventID = ""
						conflict.Title = "Busy"
						conflict.ParticipantHandle = participantHandle
					}
					out = append(out, conflict)
					break
				}
			}
		}
	}
	return out
}

func availabilityAuthorized(st *State, event Event, requesterHandle string) bool {
	for _, share := range event.Shares {
		if share.Handle == requesterHandle {
			return true
		}
	}
	calendar, ok := st.SharedCalendars[event.CalendarID]
	return ok && calendar.OwnerID == event.OwnerID && calendarRole(calendar, requesterHandle) != ""
}
func validCalendarColor(color string) bool {
	return map[string]bool{"blue": true, "slate": true, "green": true, "amber": true, "red": true, "violet": true}[color]
}
func calendarRole(calendar SharedCalendar, handle string) string {
	for _, share := range calendar.Shares {
		if share.Handle == handle {
			return share.Role
		}
	}
	return ""
}
func validateCalendarWrite(st *State, calendarID, userID string) error {
	calendarID = strings.TrimSpace(calendarID)
	if calendarID == "" || calendarID == "personal" || calendarID == "team" || calendarID == "shared" {
		return nil
	}
	calendar, ok := st.SharedCalendars[calendarID]
	if !ok {
		return errors.New("shared calendar not found")
	}
	if calendar.OwnerID == userID || calendarRole(calendar, st.Users[userID].Handle) == "editor" {
		return nil
	}
	return ErrUnauthorized
}
func canView(st *State, e Event, handle, userID string) bool {
	return eventAccessRole(st, e, handle, userID) != ""
}
func eventAccessRole(st *State, e Event, handle, userID string) string {
	if e.OwnerID == userID {
		return "owner"
	}
	if calendar, ok := st.SharedCalendars[e.CalendarID]; ok {
		if calendar.OwnerID == userID {
			return "owner"
		}
		if role := calendarRole(calendar, handle); role != "" {
			return role
		}
	}
	for _, i := range e.Invites {
		if i.Handle == handle {
			return "attendee"
		}
	}
	for _, sh := range e.Shares {
		if sh.Handle == handle {
			return sh.Role
		}
	}
	return ""
}
func availabilityEvent(event Event) Event {
	event.Title = "Busy"
	event.Description = ""
	event.Location = ""
	event.OwnerHandle = ""
	event.Invites = nil
	event.Shares = nil
	event.Comments = nil
	event.AttachmentLinks = nil
	event.MeetingLink = ""
	event.Reminders = nil
	event.Privacy = "availability"
	return event
}
func canEdit(st *State, e Event, userID string) bool {
	if e.OwnerID == userID {
		return true
	}
	u := st.Users[userID]
	if calendar, ok := st.SharedCalendars[e.CalendarID]; ok && (calendar.OwnerID == userID || calendarRole(calendar, u.Handle) == "editor") {
		return true
	}
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

func (s *Service) notifyHandle(st *State, handle, kind, eventID, actorHandle, title, body string, now time.Time) {
	user, ok := userByHandle(st, handle)
	if !ok || user.Handle == actorHandle {
		return
	}
	notification := ActivityNotification{
		ID:          s.id("notification"),
		UserID:      user.ID,
		Kind:        kind,
		EventID:     eventID,
		ActorHandle: actorHandle,
		Title:       title,
		Body:        body,
		State:       "unread",
		CreatedAt:   now,
	}
	st.Notifications[notification.ID] = notification
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
