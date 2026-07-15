package aiproduct

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type storedMessage struct {
	Message
	Content string `json:"-"`
	Nonce   string `json:"nonce"`
	Cipher  string `json:"cipher"`
}

type persistentState struct {
	Version       int                         `json:"version"`
	Conversations map[string]Conversation     `json:"conversations"`
	Messages      map[string][]storedMessage  `json:"messages"`
	Policies      map[string]DataPolicy       `json:"policies"`
	Permissions   map[string]PermissionRecord `json:"permissions"`
	Actions       map[string]ActionRecord     `json:"actions"`
	Appeals       map[string]Appeal           `json:"appeals"`
	Audits        []AuditRecord               `json:"audits"`
	AuditSequence uint64                      `json:"auditSequence"`
	Challenges    map[string]WalletChallenge  `json:"walletChallenges"`
	Sessions      map[string]ProductSession   `json:"sessions"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	aead  cipher.AEAD
	now   func() time.Time
	state persistentState
}

func NewStore(path string, key []byte) (*Store, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) == string(filepath.Separator) {
		return nil, errors.New("AI product state path must be an absolute file path")
	}
	if len(key) != 32 {
		return nil, errors.New("AI product content key must be exactly 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	s := &Store{path: path, aead: aead, now: time.Now}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func emptyState() persistentState {
	return persistentState{Version: 1, Conversations: map[string]Conversation{}, Messages: map[string][]storedMessage{}, Policies: map[string]DataPolicy{}, Permissions: map[string]PermissionRecord{}, Actions: map[string]ActionRecord{}, Appeals: map[string]Appeal{}, Audits: []AuditRecord{}, Challenges: map[string]WalletChallenge{}, Sessions: map[string]ProductSession{}}
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.state = emptyState()
		return s.saveLocked()
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &s.state); err != nil {
		return fmt.Errorf("decode AI product state: %w", err)
	}
	if s.state.Version != 1 || s.state.Conversations == nil || s.state.Messages == nil || s.state.Policies == nil || s.state.Permissions == nil || s.state.Actions == nil || s.state.Appeals == nil || s.state.Challenges == nil || s.state.Sessions == nil {
		return errors.New("AI product state schema is invalid")
	}
	return nil
}

func (s *Store) saveLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(s.state, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.path), ".ai-state-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, s.path)
}

func randomID(prefix string) string {
	b := make([]byte, 16)
	_, _ = io.ReadFull(rand.Reader, b)
	return prefix + "_" + base64.RawURLEncoding.EncodeToString(b)
}

func (s *Store) encrypt(account, conversationID, messageID, content string) (string, string, error) {
	nonce := make([]byte, s.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", "", err
	}
	aad := []byte(account + "\x00" + conversationID + "\x00" + messageID)
	ciphertext := s.aead.Seal(nil, nonce, []byte(content), aad)
	return base64.RawStdEncoding.EncodeToString(nonce), base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func (s *Store) decrypt(account string, m storedMessage) (string, error) {
	nonce, err := base64.RawStdEncoding.DecodeString(m.Nonce)
	if err != nil {
		return "", err
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(m.Cipher)
	if err != nil {
		return "", err
	}
	aad := []byte(account + "\x00" + m.ConversationID + "\x00" + m.ID)
	plain, err := s.aead.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return "", errors.New("encrypted conversation content failed authentication")
	}
	return string(plain), nil
}

func (s *Store) CreateConversation(account, title string) (Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	title = boundedText(title, 120)
	if title == "" {
		title = "New conversation"
	}
	p := s.policyLocked(account)
	c := Conversation{ID: randomID("conv"), Account: account, Title: title, CreatedAt: now, UpdatedAt: now, RetentionDays: p.RetentionDays}
	s.state.Conversations[c.ID] = c
	s.auditLocked(account, "conversation_created", c.ID, "metadata created")
	return c, s.saveLocked()
}

func (s *Store) ListConversations(account string, archived bool) []Conversation {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.purgeLocked()
	out := []Conversation{}
	for _, c := range s.state.Conversations {
		if c.Account == account && c.Archived == archived {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

func (s *Store) Conversation(account, id string) (Conversation, []Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.state.Conversations[id]
	if !ok || c.Account != account {
		return Conversation{}, nil, os.ErrNotExist
	}
	messages := make([]Message, 0, len(s.state.Messages[id]))
	for _, stored := range s.state.Messages[id] {
		plain, err := s.decrypt(account, stored)
		if err != nil {
			return Conversation{}, nil, err
		}
		m := stored.Message
		m.Content = plain
		messages = append(messages, m)
	}
	return c, messages, nil
}

func (s *Store) RenameConversation(account, id, title string) (Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.state.Conversations[id]
	if !ok || c.Account != account {
		return Conversation{}, os.ErrNotExist
	}
	title = boundedText(title, 120)
	if title == "" {
		return Conversation{}, errors.New("title is required")
	}
	c.Title, c.UpdatedAt = title, s.now().UTC()
	s.state.Conversations[id] = c
	s.auditLocked(account, "conversation_renamed", id, "title updated")
	return c, s.saveLocked()
}

func (s *Store) ArchiveConversation(account, id string, archived bool) (Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.state.Conversations[id]
	if !ok || c.Account != account {
		return Conversation{}, os.ErrNotExist
	}
	c.Archived, c.UpdatedAt = archived, s.now().UTC()
	s.state.Conversations[id] = c
	s.auditLocked(account, "conversation_archive_changed", id, fmt.Sprintf("archived=%t", archived))
	return c, s.saveLocked()
}

func (s *Store) DeleteConversation(account, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.state.Conversations[id]
	if !ok || c.Account != account {
		return os.ErrNotExist
	}
	delete(s.state.Messages, id)
	delete(s.state.Conversations, id)
	s.auditLocked(account, "conversation_deleted", id, "encrypted content and metadata removed")
	return s.saveLocked()
}

func (s *Store) AddMessage(account, conversationID string, m Message) (Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.state.Conversations[conversationID]
	if !ok || c.Account != account {
		return Message{}, os.ErrNotExist
	}
	if m.ID == "" {
		m.ID = randomID("msg")
	}
	m.ConversationID = conversationID
	if m.CreatedAt.IsZero() {
		m.CreatedAt = s.now().UTC()
	}
	p := s.policyLocked(account)
	content := m.Content
	if !p.SaveEncryptedBody {
		content = "[content not retained by data policy]"
	}
	nonce, cipherText, err := s.encrypt(account, conversationID, m.ID, content)
	if err != nil {
		return Message{}, err
	}
	m.Content = ""
	s.state.Messages[conversationID] = append(s.state.Messages[conversationID], storedMessage{Message: m, Nonce: nonce, Cipher: cipherText})
	c.MessageCount++
	c.UpdatedAt = m.CreatedAt
	if content != "[content not retained by data policy]" {
		c.LastPreview = "Latest message encrypted"
	} else {
		c.LastPreview = "Content not retained"
	}
	s.state.Conversations[conversationID] = c
	s.auditLocked(account, "message_stored", m.ID, "bounded encrypted content policy applied")
	m.Content = content
	return m, s.saveLocked()
}

func (s *Store) Policy(account string) DataPolicy {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.policyLocked(account)
}

func (s *Store) policyLocked(account string) DataPolicy {
	if p, ok := s.state.Policies[account]; ok {
		return p
	}
	return DataPolicy{RetentionDays: 30, SaveEncryptedBody: true, AllowedContextTypes: []string{"conversation"}, UpdatedAt: s.now().UTC()}
}

func (s *Store) SetPolicy(account string, p DataPolicy) (DataPolicy, error) {
	if p.RetentionDays < 1 || p.RetentionDays > 90 {
		return DataPolicy{}, errors.New("retentionDays must be between 1 and 90")
	}
	allowed := map[string]bool{"conversation": true, "selected_chain_records": true, "selected_files": true, "selected_trust_records": true}
	seen := map[string]bool{}
	clean := []string{}
	for _, value := range p.AllowedContextTypes {
		value = strings.TrimSpace(value)
		if !allowed[value] {
			return DataPolicy{}, errors.New("unsupported context type")
		}
		if !seen[value] {
			seen[value] = true
			clean = append(clean, value)
		}
	}
	p.AllowedContextTypes, p.UpdatedAt = clean, s.now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Policies[account] = p
	for id, c := range s.state.Conversations {
		if c.Account == account {
			c.RetentionDays = p.RetentionDays
			s.state.Conversations[id] = c
		}
	}
	s.auditLocked(account, "data_policy_updated", account, fmt.Sprintf("retention=%d encryptedBody=%t", p.RetentionDays, p.SaveEncryptedBody))
	s.purgeLocked()
	return p, s.saveLocked()
}

func (s *Store) SavePermission(record PermissionRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Permissions[record.ID] = record
	s.auditLocked(record.Account, "permission_recorded", record.ID, record.Status)
	return s.saveLocked()
}
func (s *Store) Permissions(account string) []PermissionRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []PermissionRecord{}
	for _, r := range s.state.Permissions {
		if r.Account == account {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}
func (s *Store) SaveAction(record ActionRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Actions[record.ID] = record
	s.auditLocked(record.Account, "action_recorded", record.ID, record.Status)
	return s.saveLocked()
}
func (s *Store) Action(account, id string) (ActionRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.state.Actions[id]
	return r, ok && r.Account == account
}
func (s *Store) Actions(account string) []ActionRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []ActionRecord{}
	for _, r := range s.state.Actions {
		if r.Account == account {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}
func (s *Store) SaveAppeal(record Appeal) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.Appeals[record.ID] = record
	s.auditLocked(record.Account, "appeal_created", record.ID, "submitted for Trust review")
	return s.saveLocked()
}
func (s *Store) Appeals(account string) []Appeal {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Appeal{}
	for _, r := range s.state.Appeals {
		if r.Account == account {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}
func (s *Store) Audits(account string) []AuditRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []AuditRecord{}
	for _, r := range s.state.Audits {
		if r.Account == account {
			out = append(out, r)
		}
	}
	return out
}

func (s *Store) Usage(account string) Usage {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := Usage{MoneyKnown: true}
	for id, c := range s.state.Conversations {
		if c.Account != account {
			continue
		}
		for _, m := range s.state.Messages[id] {
			if m.Role != "assistant" {
				continue
			}
			u.Generations++
			u.InputTokensEstimate += m.Cost.InputTokensEstimate
			u.OutputTokensEstimate += m.Cost.OutputTokensEstimate
			u.ResourceUnits += m.Cost.ResourceUnits
			u.MoneyUSD += m.Cost.MoneyUSD
			u.MoneyKnown = u.MoneyKnown && m.Cost.MoneyKnown
		}
	}
	if u.Generations == 0 {
		u.MoneyKnown = false
	}
	return u
}

func (s *Store) DeleteAccount(account string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, c := range s.state.Conversations {
		if c.Account == account {
			delete(s.state.Conversations, id)
			delete(s.state.Messages, id)
		}
	}
	for id, r := range s.state.Permissions {
		if r.Account == account {
			delete(s.state.Permissions, id)
		}
	}
	for id, r := range s.state.Actions {
		if r.Account == account {
			delete(s.state.Actions, id)
		}
	}
	for id, r := range s.state.Appeals {
		if r.Account == account {
			delete(s.state.Appeals, id)
		}
	}
	delete(s.state.Policies, account)
	now := s.now().UTC()
	for id, session := range s.state.Sessions {
		if session.Account == account {
			session.Status = "revoked"
			session.RevokedAt = now
			s.state.Sessions[id] = session
		}
	}
	for id, challenge := range s.state.Challenges {
		if challenge.Account == account {
			delete(s.state.Challenges, id)
		}
	}
	s.auditLocked(account, "account_data_deleted", account, "conversation data, controls, permissions and appeals removed")
	return s.saveLocked()
}

func (s *Store) auditLocked(account, eventType, objectID, detail string) {
	previous := ""
	if len(s.state.Audits) > 0 {
		previous = s.state.Audits[len(s.state.Audits)-1].Hash
	}
	s.state.AuditSequence++
	event := AuditRecord{Sequence: s.state.AuditSequence, Account: account, Type: eventType, ObjectID: objectID, Detail: boundedText(detail, 240), At: s.now().UTC(), PreviousHash: previous}
	copy := event
	copy.Hash = ""
	raw, _ := json.Marshal(copy)
	sum := sha256.Sum256(raw)
	event.Hash = hex.EncodeToString(sum[:])
	s.state.Audits = append(s.state.Audits, event)
	if len(s.state.Audits) > 10000 {
		s.state.Audits = append([]AuditRecord(nil), s.state.Audits[len(s.state.Audits)-10000:]...)
	}
}

func (s *Store) purgeLocked() {
	now := s.now().UTC()
	for id, c := range s.state.Conversations {
		cutoff := now.Add(-time.Duration(c.RetentionDays) * 24 * time.Hour)
		if c.UpdatedAt.Before(cutoff) {
			delete(s.state.Conversations, id)
			delete(s.state.Messages, id)
			s.auditLocked(c.Account, "retention_purge", id, "retention boundary reached")
		}
	}
}

func boundedText(value string, max int) string {
	value = strings.TrimSpace(value)
	r := []rune(value)
	if len(r) > max {
		return string(r[:max])
	}
	return value
}
