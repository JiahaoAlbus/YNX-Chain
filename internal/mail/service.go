package mail

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
)

var (
	handlePattern   = regexp.MustCompile(`^@[a-z0-9][a-z0-9_.-]{1,30}$`)
	ErrUnauthorized = errors.New("mail authorization required")
)

type WalletVerifier interface {
	Verify(context.Context, WalletProof) error
}

type AIGateway interface {
	Status(context.Context) (provider, model, cost string, err error)
	Generate(context.Context, string, []Message) (string, error)
}

type Service struct {
	store    *Store
	verifier WalletVerifier
	ai       AIGateway
	signer   ed25519.PrivateKey
	now      func() time.Time
	random   io.Reader
	cancelMu sync.Mutex
	cancels  map[string]context.CancelFunc
}

func NewService(store *Store, verifier WalletVerifier, ai AIGateway, signer ed25519.PrivateKey) (*Service, error) {
	if store == nil || verifier == nil {
		return nil, errors.New("mail store and wallet verifier are required")
	}
	if len(signer) != ed25519.PrivateKeySize {
		return nil, errors.New("mail sender identity key is required")
	}
	return &Service{store: store, verifier: verifier, ai: ai, signer: signer, now: time.Now, random: rand.Reader, cancels: map[string]context.CancelFunc{}}, nil
}

func (s *Service) SenderPublicKey() string {
	return nativewallet.EncodePublicKey(s.signer.Public().(ed25519.PublicKey))
}

func centralRequestKey(proof WalletProof) string {
	if proof.Central == nil || len(proof.Central.AuthorizationRequest) == 0 {
		return ""
	}
	var value any
	if json.Unmarshal(proof.Central.AuthorizationRequest, &value) != nil {
		return "invalid"
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "invalid"
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:])
}

func (s *Service) NewChallenge() (Challenge, error) {
	now := s.now().UTC()
	c := Challenge{ID: s.id("challenge"), ExpiresAt: now.Add(5 * time.Minute)}
	err := s.store.update(func(st *State) error { st.Challenges[c.ID] = c; return nil })
	return c, err
}

func (s *Service) SignIn(ctx context.Context, proof WalletProof) (string, User, error) {
	now := s.now().UTC()
	if proof.Product != ProductID || !hasExactScope(proof.Scopes, RequiredScope) {
		return "", User{}, errors.New("wallet proof product or scope mismatch")
	}
	if !handlePattern.MatchString(proof.Handle) || len(strings.TrimSpace(proof.DeviceKey)) < 16 {
		return "", User{}, errors.New("invalid handle or product device binding")
	}
	if proof.ExpiresAt < now.Unix() || proof.ExpiresAt > now.Add(5*time.Minute).Unix() {
		return "", User{}, errors.New("wallet proof expiry is invalid")
	}
	if err := s.verifier.Verify(ctx, proof); err != nil {
		return "", User{}, fmt.Errorf("verify wallet proof: %w", err)
	}
	var token string
	var user User
	err := s.store.update(func(st *State) error {
		c, ok := st.Challenges[proof.Challenge]
		if !ok || c.Used || now.After(c.ExpiresAt) {
			return errors.New("wallet challenge missing, expired, or replayed")
		}
		c.Used = true
		st.Challenges[c.ID] = c
		if key := centralRequestKey(proof); key != "" {
			if st.WalletRequests[key] {
				return errors.New("central Wallet authorization request replayed")
			}
			st.WalletRequests[key] = true
		}
		accountHash := digest(proof.Account)
		for _, existing := range st.Users {
			if existing.Handle == proof.Handle && existing.AccountHash != accountHash {
				return errors.New("handle is already bound")
			}
			if existing.AccountHash == accountHash {
				user = existing
			}
		}
		if user.ID == "" {
			user = User{ID: s.id("user"), Handle: proof.Handle, AccountHash: accountHash, CreatedAt: now}
			st.Users[user.ID] = user
		}
		token = s.token()
		hash := digest(token)
		st.Sessions[hash] = Session{TokenHash: hash, UserID: user.ID, DeviceKey: proof.DeviceKey, ExpiresAt: now.Add(12 * time.Hour)}
		s.audit(st, user.ID, "wallet_sign_in", user.ID, map[string]any{"product": ProductID, "scope": RequiredScope})
		return nil
	})
	return token, user, err
}

func (s *Service) Recover(ctx context.Context, proof WalletProof) (string, User, error) {
	now := s.now().UTC()
	if proof.Product != ProductID || !hasExactScope(proof.Scopes, RecoveryScope) {
		return "", User{}, errors.New("wallet recovery proof product or scope mismatch")
	}
	if !handlePattern.MatchString(proof.Handle) || len(strings.TrimSpace(proof.DeviceKey)) < 16 {
		return "", User{}, errors.New("invalid recovery device binding")
	}
	if proof.ExpiresAt < now.Unix() || proof.ExpiresAt > now.Add(5*time.Minute).Unix() {
		return "", User{}, errors.New("wallet recovery proof expiry is invalid")
	}
	if err := s.verifier.Verify(ctx, proof); err != nil {
		return "", User{}, fmt.Errorf("verify wallet recovery proof: %w", err)
	}
	var token string
	var user User
	err := s.store.update(func(st *State) error {
		c, ok := st.Challenges[proof.Challenge]
		if !ok || c.Used || now.After(c.ExpiresAt) {
			return errors.New("wallet challenge missing, expired, or replayed")
		}
		c.Used = true
		st.Challenges[c.ID] = c
		if key := centralRequestKey(proof); key != "" {
			if st.WalletRequests[key] {
				return errors.New("central Wallet authorization request replayed")
			}
			st.WalletRequests[key] = true
		}
		accountHash := digest(proof.Account)
		for _, existing := range st.Users {
			if existing.Handle == proof.Handle && existing.AccountHash == accountHash {
				user = existing
				break
			}
		}
		if user.ID == "" {
			return errors.New("recovery account and handle do not match an existing Mail identity")
		}
		for hash, session := range st.Sessions {
			if session.UserID == user.ID && session.RevokedAt.IsZero() {
				session.RevokedAt = now
				st.Sessions[hash] = session
			}
		}
		user.RecoveredAt = now
		st.Users[user.ID] = user
		token = s.token()
		hash := digest(token)
		st.Sessions[hash] = Session{TokenHash: hash, UserID: user.ID, DeviceKey: proof.DeviceKey, ExpiresAt: now.Add(12 * time.Hour)}
		s.audit(st, user.ID, "account_recovery", user.ID, map[string]any{"revoked_prior_sessions": true})
		return nil
	})
	return token, user, err
}

func (s *Service) Revoke(token string) error {
	return s.store.update(func(st *State) error {
		session, err := s.session(st, token)
		if err != nil {
			return err
		}
		session.RevokedAt = s.now().UTC()
		st.Sessions[session.TokenHash] = session
		s.audit(st, session.UserID, "session_revoke", session.UserID, nil)
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

func (s *Service) Drafts(token string) ([]Draft, error) {
	out := []Draft{}
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		for _, draft := range st.Drafts {
			if draft.OwnerID == sess.UserID {
				out = append(out, draft)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) DeleteDraft(token, draftID string) error {
	return s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		draft, ok := st.Drafts[draftID]
		if !ok || draft.OwnerID != sess.UserID {
			return errors.New("draft not found")
		}
		delete(st.Drafts, draftID)
		s.audit(st, sess.UserID, "draft_deleted", draftID, nil)
		return nil
	})
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
		visible := map[string]bool{}
		for _, box := range st.Mailboxes {
			if box.OwnerID == sess.UserID {
				visible[box.MessageID] = true
			}
		}
		for _, draft := range st.Drafts {
			if draft.OwnerID == sess.UserID {
				out.Drafts = append(out.Drafts, draft)
			}
		}
		for id, message := range st.Messages {
			if visible[id] || message.SenderID == sess.UserID {
				out.Messages = append(out.Messages, message)
			}
		}
		for _, report := range st.Reports {
			if report.ReporterID == sess.UserID {
				out.Reports = append(out.Reports, report)
			}
		}
		for _, entry := range st.Audit {
			if entry.ActorID == sess.UserID {
				out.Audit = append(out.Audit, entry)
			}
		}
		sort.Slice(out.Drafts, func(i, j int) bool { return out.Drafts[i].UpdatedAt.Before(out.Drafts[j].UpdatedAt) })
		sort.Slice(out.Messages, func(i, j int) bool { return out.Messages[i].CreatedAt.Before(out.Messages[j].CreatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) DeleteAccount(token, confirmation string) error {
	if confirmation != "DELETE MAIL ACCOUNT" {
		return errors.New("exact destructive confirmation is required")
	}
	return s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		user := st.Users[sess.UserID]
		for id, item := range st.Drafts {
			if item.OwnerID == sess.UserID {
				delete(st.Drafts, id)
			}
		}
		boxes := st.Mailboxes[:0]
		for _, item := range st.Mailboxes {
			if item.OwnerID != sess.UserID {
				boxes = append(boxes, item)
			}
		}
		st.Mailboxes = boxes
		for id, message := range st.Messages {
			for index, recipient := range message.To {
				if recipient == user.Handle {
					message.To[index] = "@deleted"
				}
			}
			for index, delivery := range message.Deliveries {
				if delivery.Recipient == user.Handle {
					message.Deliveries[index].Recipient = "@deleted"
				}
			}
			if message.SenderID == sess.UserID {
				message.SenderID = "deleted"
				message.SenderHandle = "@deleted"
				message.Subject = "[deleted]"
				message.Body = ""
				message.Attachments = nil
				message.SenderSignature = ""
			}
			st.Messages[id] = message
		}
		for id, report := range st.Reports {
			if report.ReporterID == sess.UserID {
				report.ReporterID = "deleted"
				st.Reports[id] = report
			}
		}
		for hash, session := range st.Sessions {
			if session.UserID == sess.UserID {
				delete(st.Sessions, hash)
			}
		}
		delete(st.Users, sess.UserID)
		delete(st.Blocks, sess.UserID)
		s.audit(st, sess.UserID, "account_deleted", "", map[string]any{"former_handle_hash": digest(user.Handle)})
		return nil
	})
}

func (s *Service) SaveDraft(token string, draft Draft) (Draft, error) {
	now := s.now().UTC()
	var out Draft
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		if err := validateEnvelope(draft.To, draft.Subject, draft.Body, draft.Attachments); err != nil {
			return err
		}
		if draft.ID == "" {
			draft.ID = s.id("draft")
		} else if existing, ok := st.Drafts[draft.ID]; !ok || existing.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		draft.OwnerID = sess.UserID
		draft.UpdatedAt = now
		st.Drafts[draft.ID] = draft
		out = draft
		s.audit(st, sess.UserID, "draft_save", draft.ID, nil)
		return nil
	})
	return out, err
}

func (s *Service) SendDraft(token, draftID string) (Message, error) {
	now := s.now().UTC()
	var out Message
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		draft, ok := st.Drafts[draftID]
		if !ok || draft.OwnerID != sess.UserID {
			return ErrUnauthorized
		}
		if err := s.consumeRate(st, sess.UserID, now); err != nil {
			return err
		}
		sender := st.Users[sess.UserID]
		threadID := draft.ThreadID
		if threadID == "" {
			threadID = s.id("thread")
		} else if !ownsThread(st, sess.UserID, threadID) {
			return ErrUnauthorized
		}
		message := Message{ID: s.id("message"), ThreadID: threadID, SenderID: sender.ID, SenderHandle: sender.Handle, To: append([]string{}, draft.To...), Subject: draft.Subject, Body: draft.Body, Attachments: draft.Attachments, CreatedAt: now}
		for _, recipient := range draft.To {
			delivery := Delivery{Recipient: recipient, State: DeliveryFailed, UpdatedAt: now}
			if strings.Contains(strings.TrimPrefix(recipient, "@"), "@") || strings.Contains(recipient, ":") {
				delivery.Reason = "internet_mail_delivery_not_supported"
			} else if recipientUser, found := userByHandle(st, recipient); !found {
				delivery.Reason = "unknown_ynx_recipient"
			} else if st.Blocks[recipientUser.ID][sess.UserID] {
				delivery.Reason = "recipient_blocked_sender"
			} else {
				delivery.State = DeliveryDelivered
				folder := "inbox"
				if spamScore(message) >= 3 {
					folder = "spam"
				}
				st.Mailboxes = append(st.Mailboxes, MailboxItem{MessageID: message.ID, OwnerID: recipientUser.ID, Folder: folder, CreatedAt: now})
			}
			message.Deliveries = append(message.Deliveries, delivery)
		}
		payload, _ := json.Marshal(struct {
			ID, ThreadID, Sender string
			To                   []string
			CreatedAt            time.Time
		}{message.ID, message.ThreadID, message.SenderHandle, message.To, message.CreatedAt})
		message.SenderSignature = base64.RawStdEncoding.EncodeToString(ed25519.Sign(s.signer, payload))
		st.Messages[message.ID] = message
		st.Mailboxes = append(st.Mailboxes, MailboxItem{MessageID: message.ID, OwnerID: sess.UserID, Folder: "sent", Read: true, CreatedAt: now})
		delete(st.Drafts, draftID)
		s.audit(st, sess.UserID, "mail_send_approved", message.ID, map[string]any{"delivery_states": message.Deliveries})
		out = message
		return nil
	})
	return out, err
}

func (s *Service) VerifySender(message Message) bool {
	payload, _ := json.Marshal(struct {
		ID, ThreadID, Sender string
		To                   []string
		CreatedAt            time.Time
	}{message.ID, message.ThreadID, message.SenderHandle, message.To, message.CreatedAt})
	sig, err := base64.RawStdEncoding.DecodeString(message.SenderSignature)
	return err == nil && ed25519.Verify(s.signer.Public().(ed25519.PublicKey), payload, sig)
}

func (s *Service) Inbox(token, folder, query string) ([]Message, error) {
	if folder == "" {
		folder = "inbox"
	}
	out := []Message{}
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		q := strings.ToLower(strings.TrimSpace(query))
		for _, item := range st.Mailboxes {
			if item.OwnerID != sess.UserID || item.Folder != folder {
				continue
			}
			m := st.Messages[item.MessageID]
			if q == "" || strings.Contains(strings.ToLower(m.Subject+" "+m.Body+" "+m.SenderHandle), q) {
				out = append(out, m)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) Thread(token, threadID string) ([]Message, error) {
	out := []Message{}
	err := s.store.view(func(st State) error {
		sess, err := s.session(&st, token)
		if err != nil {
			return err
		}
		for _, message := range st.Messages {
			if message.ThreadID == threadID && ownsMessage(&st, sess.UserID, message.ID) {
				out = append(out, message)
			}
		}
		if len(out) == 0 {
			return ErrUnauthorized
		}
		sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) Move(token, messageID, folder string) error {
	if folder != "archive" && folder != "spam" && folder != "inbox" {
		return errors.New("invalid mailbox folder")
	}
	return s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		found := false
		for i := range st.Mailboxes {
			if st.Mailboxes[i].OwnerID == sess.UserID && st.Mailboxes[i].MessageID == messageID {
				st.Mailboxes[i].Folder = folder
				found = true
			}
		}
		if !found {
			return ErrUnauthorized
		}
		s.audit(st, sess.UserID, "mail_move_"+folder, messageID, nil)
		return nil
	})
}

func (s *Service) Block(token, handle string) error {
	return s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		target, ok := userByHandle(st, handle)
		if !ok || target.ID == sess.UserID {
			return errors.New("invalid block target")
		}
		if st.Blocks[sess.UserID] == nil {
			st.Blocks[sess.UserID] = map[string]bool{}
		}
		st.Blocks[sess.UserID][target.ID] = true
		s.audit(st, sess.UserID, "sender_block", target.ID, nil)
		return nil
	})
}

func (s *Service) Unblock(token, handle string) error {
	return s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		target, ok := userByHandle(st, handle)
		if !ok {
			return errors.New("unknown block target")
		}
		delete(st.Blocks[sess.UserID], target.ID)
		s.audit(st, sess.UserID, "sender_unblock", target.ID, nil)
		return nil
	})
}

func (s *Service) RetryDelivery(token, messageID, recipient string) (Message, error) {
	var out Message
	now := s.now().UTC()
	err := s.store.update(func(st *State) error {
		sess, e := s.session(st, token)
		if e != nil {
			return e
		}
		message, ok := st.Messages[messageID]
		if !ok || message.SenderID != sess.UserID {
			return ErrUnauthorized
		}
		if e = s.consumeRate(st, sess.UserID, now); e != nil {
			return e
		}
		index := -1
		for i, d := range message.Deliveries {
			if d.Recipient == recipient && d.State == DeliveryFailed {
				index = i
				break
			}
		}
		if index < 0 {
			return errors.New("failed delivery not found")
		}
		delivery := message.Deliveries[index]
		if strings.Contains(strings.TrimPrefix(recipient, "@"), "@") || strings.Contains(recipient, ":") {
			delivery.Reason = "internet_mail_delivery_not_supported"
		} else if target, found := userByHandle(st, recipient); !found {
			delivery.Reason = "unknown_ynx_recipient"
		} else if st.Blocks[target.ID][sess.UserID] {
			delivery.Reason = "recipient_blocked_sender"
		} else {
			delivery.State = DeliveryDelivered
			delivery.Reason = ""
			st.Mailboxes = append(st.Mailboxes, MailboxItem{MessageID: message.ID, OwnerID: target.ID, Folder: "inbox", CreatedAt: now})
		}
		delivery.UpdatedAt = now
		message.Deliveries[index] = delivery
		st.Messages[message.ID] = message
		s.audit(st, sess.UserID, "delivery_retry", message.ID, map[string]any{"recipient": recipient, "state": delivery.State, "reason": delivery.Reason})
		out = message
		return nil
	})
	return out, err
}

func (s *Service) Report(token, messageID, reason string) (AbuseReport, error) {
	var out AbuseReport
	now := s.now().UTC()
	reason = strings.TrimSpace(reason)
	if len(reason) < 8 || len(reason) > 500 {
		return out, errors.New("report reason must be 8-500 characters")
	}
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		if !ownsMessage(st, sess.UserID, messageID) {
			return ErrUnauthorized
		}
		out = AbuseReport{ID: s.id("report"), ReporterID: sess.UserID, MessageID: messageID, Reason: reason, State: "submitted", CreatedAt: now, UpdatedAt: now}
		st.Reports[out.ID] = out
		s.audit(st, sess.UserID, "trust_report", out.ID, nil)
		return nil
	})
	return out, err
}

func (s *Service) Appeal(token, reportID, text string) (AbuseReport, error) {
	var out AbuseReport
	text = strings.TrimSpace(text)
	if len(text) < 8 || len(text) > 1000 {
		return out, errors.New("appeal must be 8-1000 characters")
	}
	err := s.store.update(func(st *State) error {
		sess, err := s.session(st, token)
		if err != nil {
			return err
		}
		r, ok := st.Reports[reportID]
		if !ok {
			return errors.New("report not found")
		}
		m := st.Messages[r.MessageID]
		if r.ReporterID != sess.UserID && m.SenderID != sess.UserID {
			return ErrUnauthorized
		}
		r.Appeal = text
		r.State = "appealed"
		r.UpdatedAt = s.now().UTC()
		st.Reports[r.ID] = r
		s.audit(st, sess.UserID, "trust_appeal", r.ID, nil)
		out = r
		return nil
	})
	return out, err
}
func (s *Service) Cases(token string) ([]AbuseReport, error) {
	out := []AbuseReport{}
	err := s.store.view(func(st State) error {
		sess, e := s.session(&st, token)
		if e != nil {
			return e
		}
		for _, r := range st.Reports {
			message := st.Messages[r.MessageID]
			if r.ReporterID == sess.UserID || message.SenderID == sess.UserID {
				out = append(out, r)
			}
		}
		sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
		return nil
	})
	return out, err
}

func (s *Service) BeginAI(ctx context.Context, token, kind string, contextIDs []string) (AIJob, error) {
	allowed := map[string]bool{"summarize": true, "draft_reply": true, "translate": true, "organize": true}
	if !allowed[kind] || len(contextIDs) == 0 || len(contextIDs) > 20 {
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
		var subjects []string
		for _, id := range contextIDs {
			if !ownsMessage(st, sess.UserID, id) {
				return ErrUnauthorized
			}
			subjects = append(subjects, st.Messages[id].Subject)
		}
		out = AIJob{ID: s.id("ai"), OwnerID: sess.UserID, Kind: kind, ContextIDs: append([]string{}, contextIDs...), ContextPreview: strings.Join(subjects, "; "), Provider: provider, Model: model, CostEstimate: cost, State: "preview", CreatedAt: s.now().UTC(), UpdatedAt: s.now().UTC()}
		st.AIJobs[out.ID] = out
		s.audit(st, sess.UserID, "ai_context_preview", out.ID, map[string]any{"context_count": len(contextIDs)})
		return nil
	})
	return out, err
}

func (s *Service) ApproveAI(ctx context.Context, token, jobID string) (AIJob, error) {
	var out AIJob
	var messages []Message
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
		for _, id := range job.ContextIDs {
			messages = append(messages, st.Messages[id])
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
	result, genErr := s.ai.Generate(jobCtx, kind, messages)
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
		return AIJob{}, errors.New("invalid AI review decision")
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
			return errors.New("AI result is not ready for review")
		}
		job.State = map[string]string{"apply": "applied", "reject": "rejected", "cancel": "cancelled"}[decision]
		job.ReviewedAt = s.now().UTC()
		job.UpdatedAt = job.ReviewedAt
		st.AIJobs[job.ID] = job
		s.audit(st, sess.UserID, "ai_"+decision, job.ID, nil)
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

func (s *Service) session(st *State, token string) (Session, error) {
	session, ok := st.Sessions[digest(token)]
	if !ok || !session.RevokedAt.IsZero() || s.now().After(session.ExpiresAt) {
		return Session{}, ErrUnauthorized
	}
	return session, nil
}
func (s *Service) consumeRate(st *State, userID string, now time.Time) error {
	cutoff := now.Add(-time.Minute)
	recent := st.Rate[userID][:0]
	for _, t := range st.Rate[userID] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	if len(recent) >= 5 {
		return errors.New("mail send rate limit exceeded; retry later")
	}
	st.Rate[userID] = append(recent, now)
	return nil
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
func digest(v string) string                          { sum := sha256.Sum256([]byte(v)); return hex.EncodeToString(sum[:]) }
func hasExactScope(scopes []string, want string) bool { return len(scopes) == 1 && scopes[0] == want }
func userByHandle(st *State, h string) (User, bool) {
	for _, u := range st.Users {
		if u.Handle == h {
			return u, true
		}
	}
	return User{}, false
}
func ownsMessage(st *State, userID, messageID string) bool {
	for _, item := range st.Mailboxes {
		if item.OwnerID == userID && item.MessageID == messageID {
			return true
		}
	}
	return false
}
func ownsThread(st *State, userID, threadID string) bool {
	for _, message := range st.Messages {
		if message.ThreadID == threadID && ownsMessage(st, userID, message.ID) {
			return true
		}
	}
	return false
}
func validateEnvelope(to []string, subject, body string, attachments []Attachment) error {
	if len(to) == 0 || len(to) > 20 {
		return errors.New("recipient count must be 1-20")
	}
	if len(subject) > 200 || len(body) == 0 || len(body) > MaxMessageBytes {
		return errors.New("message subject or body bounds exceeded")
	}
	total := 0
	for _, a := range attachments {
		if a.Size < 0 || a.Size > MaxAttachmentBytes || a.Name == "" || a.SHA256 == "" {
			return errors.New("attachment bounds or integrity metadata invalid")
		}
		lowerName := strings.ToLower(a.Name)
		if strings.Contains(lowerName, "..") || strings.HasSuffix(lowerName, ".exe") || strings.HasSuffix(lowerName, ".dmg") || strings.HasSuffix(lowerName, ".pkg") || a.MediaType == "text/html" {
			return errors.New("attachment type is not allowed")
		}
		content, err := base64.StdEncoding.DecodeString(a.ContentBase64)
		if err != nil || len(content) != a.Size || digestBytes(content) != strings.ToLower(a.SHA256) {
			return errors.New("attachment size or SHA-256 integrity check failed")
		}
		total += a.Size
	}
	if total > MaxAttachmentBytes {
		return errors.New("combined attachment bound exceeded")
	}
	return nil
}
func digestBytes(value []byte) string { sum := sha256.Sum256(value); return hex.EncodeToString(sum[:]) }
func spamScore(m Message) int {
	score := 0
	lower := strings.ToLower(m.Subject + " " + m.Body)
	for _, v := range []string{"free money", "guaranteed return", "urgent transfer", "seed phrase"} {
		if strings.Contains(lower, v) {
			score++
		}
	}
	if len(m.To) > 10 {
		score++
	}
	return score
}
