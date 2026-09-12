package cloud

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const SocialCiphertextLimit int64 = 25 << 20
const SocialPartBytes int64 = 1 << 20
const SocialObjectAudience = "ynx-cloud-social-attachments-v1"

var socialID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
var socialHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

// Capabilities are minted and revalidated by Social after its Wallet, membership
// and device checks. Cloud never treats an end-user Social bearer as a capability.
type SocialAuthorizationRequest struct {
	Version    int    `json:"version"`
	Capability string `json:"capability"`
	Operation  string `json:"operation"`
	ObjectID   string `json:"objectId"`
	UploadID   string `json:"uploadId"`
}
type SocialObjectGrant struct {
	Version        int       `json:"version"`
	Product        string    `json:"product"`
	Audience       string    `json:"audience"`
	Subject        string    `json:"subject"`
	DeviceID       string    `json:"deviceId"`
	ConversationID string    `json:"conversationId"`
	ObjectID       string    `json:"objectId"`
	UploadID       string    `json:"uploadId"`
	Operation      string    `json:"operation"`
	ExpiresAt      time.Time `json:"expiresAt"`
}
type SocialObjectAuthorizer interface {
	Authorize(context.Context, SocialAuthorizationRequest) (SocialObjectGrant, error)
}
type RemoteSocialObjectAuthorizer struct {
	BaseURL, Token string
	Client         *http.Client
}

func (a RemoteSocialObjectAuthorizer) Authorize(ctx context.Context, request SocialAuthorizationRequest) (SocialObjectGrant, error) {
	if err := validRemote(a.BaseURL, a.Token); err != nil {
		return SocialObjectGrant{}, err
	}
	body, err := json.Marshal(request)
	if err != nil {
		return SocialObjectGrant{}, err
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(a.BaseURL, "/")+"/internal/cloud-objects/authorize", bytes.NewReader(body))
	if err != nil {
		return SocialObjectGrant{}, err
	}
	r.Header.Set("Authorization", "Bearer "+a.Token)
	r.Header.Set("Content-Type", "application/json")
	client := http.Client{Timeout: 5 * time.Second}
	if a.Client != nil {
		client = *a.Client
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(r)
	if err != nil {
		return SocialObjectGrant{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 {
		return SocialObjectGrant{}, ErrDenied
	}
	if response.StatusCode != 200 {
		return SocialObjectGrant{}, errors.New("Social authorization unavailable")
	}
	var grant SocialObjectGrant
	decoder := json.NewDecoder(io.LimitReader(response.Body, 16<<10))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&grant); err != nil {
		return grant, err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return grant, errors.New("invalid Social authorization response")
	}
	return grant, nil
}

type SocialAttachmentConfig struct {
	Root                 string
	Authorizer           SocialObjectAuthorizer
	Now                  func() time.Time
	UploadTTL, Retention time.Duration
	MaxStoredBytes       int64
}
type SocialAttachmentStore struct {
	mu  sync.Mutex
	cfg SocialAttachmentConfig
}
type SocialUploadRequest struct {
	ObjectID             string `json:"objectId"`
	UploadID             string `json:"uploadId"`
	ConversationID       string `json:"conversationId"`
	TotalCiphertextBytes int64  `json:"totalCiphertextBytes"`
	SHA256               string `json:"sha256"`
}
type socialPart struct {
	Number int    `json:"partNumber"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type socialUpload struct {
	SocialUploadRequest
	Subject         string             `json:"subject"`
	Status          string             `json:"status"`
	Parts           map[int]socialPart `json:"acceptedParts"`
	CreatedAt       time.Time          `json:"createdAt"`
	UploadExpiresAt time.Time          `json:"uploadExpiresAt"`
	ExpiresAt       time.Time          `json:"expiresAt"`
	PartBytes       int64              `json:"partBytes"`
}

func NewSocialAttachmentStore(cfg SocialAttachmentConfig) (*SocialAttachmentStore, error) {
	if strings.TrimSpace(cfg.Root) == "" {
		return nil, errors.New("Social ciphertext root is required")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.UploadTTL <= 0 {
		cfg.UploadTTL = 24 * time.Hour
	}
	if cfg.Retention <= 0 {
		cfg.Retention = 7 * 24 * time.Hour
	}
	if cfg.MaxStoredBytes <= 0 {
		cfg.MaxStoredBytes = 1 << 30
	}
	for _, dir := range []string{cfg.Root, filepath.Join(cfg.Root, "uploads"), filepath.Join(cfg.Root, "objects")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
		info, err := os.Lstat(dir)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
			return nil, errors.New("Social ciphertext directories must be private real directories")
		}
	}
	return &SocialAttachmentStore{cfg: cfg}, nil
}
func socialAtomic(file string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(file), ".pending-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(name, file); err != nil {
		return err
	}
	return socialSync(filepath.Dir(file))
}
func socialSync(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func socialSave(dir string, m socialUpload) error {
	b, err := json.Marshal(m)
	if err != nil {
		return err
	}
	return socialAtomic(filepath.Join(dir, "manifest.json"), b)
}
func socialLoad(dir string) (socialUpload, error) {
	var m socialUpload
	b, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return m, err
	}
	err = json.Unmarshal(b, &m)
	if err == nil && (!socialID.MatchString(m.ObjectID) || !socialID.MatchString(m.UploadID) || m.Parts == nil) {
		err = errors.New("invalid Social object manifest")
	}
	return m, err
}
func socialDigest(data []byte) string { h := sha256.Sum256(data); return hex.EncodeToString(h[:]) }
func socialPublicUpload(m socialUpload) any {
	return struct {
		SocialUploadRequest
		Status          string             `json:"status"`
		Parts           map[int]socialPart `json:"acceptedParts"`
		UploadExpiresAt time.Time          `json:"uploadExpiresAt"`
		ExpiresAt       time.Time          `json:"expiresAt"`
		PartBytes       int64              `json:"partBytes"`
	}{m.SocialUploadRequest, m.Status, m.Parts, m.UploadExpiresAt, m.ExpiresAt, m.PartBytes}
}
func socialReply(w http.ResponseWriter, code int, value any) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, code, value)
}
func socialFailure(w http.ResponseWriter, code int, message string) {
	socialReply(w, code, map[string]string{"error": message})
}

func (s *SocialAttachmentStore) grant(w http.ResponseWriter, r *http.Request, op, object, upload string) (SocialObjectGrant, bool) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") || !strings.HasPrefix(raw, "ynx-social-object-v1.") || len(raw) > 8192 {
		socialFailure(w, 401, "Social object capability required")
		return SocialObjectGrant{}, false
	}
	if s.cfg.Authorizer == nil {
		socialFailure(w, 503, "Social authorization unavailable")
		return SocialObjectGrant{}, false
	}
	g, err := s.cfg.Authorizer.Authorize(r.Context(), SocialAuthorizationRequest{1, raw, op, object, upload})
	if err != nil {
		if errors.Is(err, ErrDenied) {
			socialFailure(w, 403, "Social object access denied")
		} else {
			socialFailure(w, 503, "Social authorization unavailable")
		}
		return g, false
	}
	now := s.cfg.Now()
	if g.Version != 1 || g.Product != "social" || g.Audience != SocialObjectAudience || g.Operation != op || g.Subject == "" || g.DeviceID == "" || g.ConversationID == "" || !socialID.MatchString(g.ObjectID) || ((op != "object.read" || g.UploadID != "") && !socialID.MatchString(g.UploadID)) || !g.ExpiresAt.After(now) || g.ExpiresAt.Sub(now) > 90*time.Second || (object != "" && g.ObjectID != object) || (upload != "" && g.UploadID != upload) {
		socialFailure(w, 403, "Social object capability binding mismatch")
		return g, false
	}
	return g, true
}
func (s *SocialAttachmentStore) Handler() http.Handler {
	mux := http.NewServeMux()
	prefix := "/api/v1/social-attachments"
	mux.HandleFunc("POST "+prefix+"/uploads", s.createUpload)
	mux.HandleFunc("GET "+prefix+"/uploads/{upload}", s.uploadStatus)
	mux.HandleFunc("PUT "+prefix+"/uploads/{upload}/parts/{part}", s.putPart)
	mux.HandleFunc("POST "+prefix+"/uploads/{upload}/complete", s.completeUpload)
	mux.HandleFunc("DELETE "+prefix+"/uploads/{upload}", s.cancelUpload)
	mux.HandleFunc("GET "+prefix+"/objects/{object}", s.readObject)
	mux.HandleFunc("DELETE "+prefix+"/objects/{object}", s.deleteObject)
	// Bound memory and ongoing transfers independently from the main Cloud API.
	limit := make(chan struct{}, 8)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case limit <- struct{}{}:
			defer func() { <-limit }()
			mux.ServeHTTP(w, r)
		default:
			socialFailure(w, 429, "Social object concurrency limit")
		}
	})
}
func (s *SocialAttachmentStore) createUpload(w http.ResponseWriter, r *http.Request) {
	var input SocialUploadRequest
	if !decode(w, r, &input, 4096) {
		return
	}
	if !socialID.MatchString(input.ObjectID) || !socialID.MatchString(input.UploadID) || input.ConversationID == "" || len(input.ConversationID) > 256 || input.TotalCiphertextBytes < 1 || input.TotalCiphertextBytes > SocialCiphertextLimit || !socialHash.MatchString(input.SHA256) {
		socialFailure(w, 400, "invalid ciphertext upload")
		return
	}
	g, ok := s.grant(w, r, "upload.create", input.ObjectID, input.UploadID)
	if !ok {
		return
	}
	if g.ConversationID != input.ConversationID {
		socialFailure(w, 403, "conversation mismatch")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := filepath.Join(s.cfg.Root, "uploads", input.UploadID)
	if old, err := socialLoad(dir); err == nil {
		if old.SocialUploadRequest != input || old.Subject != g.Subject {
			socialFailure(w, 409, "upload binding conflict")
			return
		}
		socialReply(w, 200, socialPublicUpload(old))
		return
	} else if !errors.Is(err, os.ErrNotExist) {
		socialFailure(w, 500, "upload state unavailable")
		return
	}
	// Reserve declared bytes, including incomplete uploads; restart cannot reset quota.
	entries, err := os.ReadDir(filepath.Join(s.cfg.Root, "uploads"))
	if err != nil {
		socialFailure(w, 500, "upload inventory unavailable")
		return
	}
	var reserved int64
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		m, err := socialLoad(filepath.Join(s.cfg.Root, "uploads", e.Name()))
		if err != nil {
			socialFailure(w, 500, "upload inventory invalid")
			return
		}
		if m.Status != "cancelled" && m.Status != "deleted" {
			reserved += m.TotalCiphertextBytes
		}
	}
	if input.TotalCiphertextBytes > s.cfg.MaxStoredBytes-reserved {
		socialFailure(w, 413, "Social ciphertext storage quota")
		return
	}
	if _, err = os.Stat(filepath.Join(s.cfg.Root, "objects", input.ObjectID)); !errors.Is(err, os.ErrNotExist) {
		socialFailure(w, 409, "object already reserved")
		return
	}
	temp, err := os.MkdirTemp(filepath.Join(s.cfg.Root, "uploads"), ".upload-")
	if err != nil {
		socialFailure(w, 500, "upload creation failed")
		return
	}
	defer os.RemoveAll(temp)
	now := s.cfg.Now()
	m := socialUpload{SocialUploadRequest: input, Subject: g.Subject, Status: "uploading", Parts: map[int]socialPart{}, CreatedAt: now, UploadExpiresAt: now.Add(s.cfg.UploadTTL), ExpiresAt: now.Add(s.cfg.Retention), PartBytes: SocialPartBytes}
	if socialSave(temp, m) != nil || os.Rename(temp, dir) != nil || socialSync(filepath.Dir(dir)) != nil {
		socialFailure(w, 500, "upload persistence failed")
		return
	}
	socialReply(w, 201, socialPublicUpload(m))
}
func (s *SocialAttachmentStore) loadUpload(w http.ResponseWriter, r *http.Request, op string) (socialUpload, string, bool) {
	u := r.PathValue("upload")
	if !socialID.MatchString(u) {
		socialFailure(w, 400, "invalid upload identifier")
		return socialUpload{}, "", false
	}
	g, ok := s.grant(w, r, op, "", u)
	if !ok {
		return socialUpload{}, "", false
	}
	dir := filepath.Join(s.cfg.Root, "uploads", u)
	m, err := socialLoad(dir)
	if errors.Is(err, os.ErrNotExist) {
		socialFailure(w, 404, "upload not found")
		return m, dir, false
	}
	if err != nil {
		socialFailure(w, 500, "upload state unavailable")
		return m, dir, false
	}
	if m.UploadID != u || m.UploadID != g.UploadID || m.ObjectID != g.ObjectID || m.ConversationID != g.ConversationID || m.Subject != g.Subject {
		socialFailure(w, 403, "upload capability mismatch")
		return m, dir, false
	}
	return m, dir, true
}
func (s *SocialAttachmentStore) uploadStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, _, ok := s.loadUpload(w, r, "upload.status")
	if ok {
		socialReply(w, 200, socialPublicUpload(m))
	}
}
func (s *SocialAttachmentStore) putPart(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, dir, ok := s.loadUpload(w, r, "upload.part")
	if !ok {
		return
	}
	if m.Status != "uploading" || !m.UploadExpiresAt.After(s.cfg.Now()) {
		socialFailure(w, 409, "upload is not writable")
		return
	}
	n, err := strconv.Atoi(r.PathValue("part"))
	count := (m.TotalCiphertextBytes + SocialPartBytes - 1) / SocialPartBytes
	if err != nil || n < 1 || int64(n) > count {
		socialFailure(w, 400, "invalid part number")
		return
	}
	expected := SocialPartBytes
	if int64(n) == count {
		expected = m.TotalCiphertextBytes - int64(n-1)*SocialPartBytes
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, expected+1))
	hash := r.Header.Get("X-Ciphertext-SHA256")
	if err != nil || int64(len(body)) != expected || !socialHash.MatchString(hash) || socialDigest(body) != hash {
		socialFailure(w, 400, "ciphertext part size or hash mismatch")
		return
	}
	part := socialPart{n, expected, hash}
	if old, ok := m.Parts[n]; ok && old != part {
		socialFailure(w, 409, "part content conflict")
		return
	}
	if err = socialAtomic(filepath.Join(dir, fmt.Sprintf("part-%03d", n)), body); err != nil {
		socialFailure(w, 500, "ciphertext part persistence failed")
		return
	}
	m.Parts[n] = part
	if err = socialSave(dir, m); err != nil {
		socialFailure(w, 500, "part manifest persistence failed")
		return
	}
	socialReply(w, 200, part)
}
func (s *SocialAttachmentStore) completeUpload(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, dir, ok := s.loadUpload(w, r, "upload.complete")
	if !ok {
		return
	}
	if m.Status == "cancelled" || m.Status == "deleted" || !m.ExpiresAt.After(s.cfg.Now()) {
		socialFailure(w, 409, "upload no longer available")
		return
	}
	destination := filepath.Join(s.cfg.Root, "objects", m.ObjectID)
	if old, err := socialLoad(destination); err == nil {
		if old.SocialUploadRequest != m.SocialUploadRequest || old.Subject != m.Subject {
			socialFailure(w, 409, "object binding conflict")
			return
		}
		m.Status = "complete"
		if socialSave(dir, m) != nil {
			socialFailure(w, 500, "completion persistence failed")
			return
		}
		socialReply(w, 200, socialPublicUpload(m))
		return
	}
	if !m.UploadExpiresAt.After(s.cfg.Now()) {
		socialFailure(w, 409, "upload expired")
		return
	}
	count := (m.TotalCiphertextBytes + SocialPartBytes - 1) / SocialPartBytes
	if int64(len(m.Parts)) != count {
		socialFailure(w, 409, "ciphertext parts incomplete")
		return
	}
	temp, err := os.MkdirTemp(filepath.Join(s.cfg.Root, "objects"), ".complete-")
	if err != nil {
		socialFailure(w, 500, "object creation failed")
		return
	}
	defer os.RemoveAll(temp)
	f, err := os.OpenFile(filepath.Join(temp, "ciphertext"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		socialFailure(w, 500, "object creation failed")
		return
	}
	defer f.Close()
	full := sha256.New()
	var total int64
	for n := 1; n <= int(count); n++ {
		part, readErr := os.ReadFile(filepath.Join(dir, fmt.Sprintf("part-%03d", n)))
		record, exists := m.Parts[n]
		if readErr != nil || !exists || int64(len(part)) != record.Bytes || socialDigest(part) != record.SHA256 {
			socialFailure(w, 409, "ciphertext part integrity failure")
			return
		}
		written, writeErr := io.MultiWriter(f, full).Write(part)
		if writeErr != nil {
			socialFailure(w, 500, "object write failed")
			return
		}
		total += int64(written)
	}
	if total != m.TotalCiphertextBytes || hex.EncodeToString(full.Sum(nil)) != m.SHA256 {
		socialFailure(w, 409, "complete ciphertext hash mismatch")
		return
	}
	if f.Sync() != nil || f.Close() != nil {
		socialFailure(w, 500, "object sync failed")
		return
	}
	m.Status = "complete"
	if socialSave(temp, m) != nil || os.Rename(temp, destination) != nil || socialSync(filepath.Dir(destination)) != nil || socialSave(dir, m) != nil {
		socialFailure(w, 500, "completion persistence failed; retry the same upload")
		return
	}
	for n := range m.Parts {
		_ = os.Remove(filepath.Join(dir, fmt.Sprintf("part-%03d", n)))
	}
	socialReply(w, 201, socialPublicUpload(m))
}
func (s *SocialAttachmentStore) cancelUpload(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, dir, ok := s.loadUpload(w, r, "upload.cancel")
	if !ok {
		return
	}
	if m.Status == "complete" {
		socialFailure(w, 409, "completed object requires explicit deletion")
		return
	}
	m.Status = "cancelled"
	if socialSave(dir, m) != nil {
		socialFailure(w, 500, "cancellation persistence failed")
		return
	}
	for n := range m.Parts {
		if err := os.Remove(filepath.Join(dir, fmt.Sprintf("part-%03d", n))); err != nil && !errors.Is(err, os.ErrNotExist) {
			socialFailure(w, 500, "ciphertext cleanup pending")
			return
		}
	}
	socialReply(w, 200, map[string]any{"status": "cancelled", "existingCopiesRevoked": false})
}
func (s *SocialAttachmentStore) object(w http.ResponseWriter, r *http.Request, op string) (socialUpload, string, bool) {
	id := r.PathValue("object")
	if !socialID.MatchString(id) {
		socialFailure(w, 400, "invalid object identifier")
		return socialUpload{}, "", false
	}
	g, ok := s.grant(w, r, op, id, "")
	if !ok {
		return socialUpload{}, "", false
	}
	dir := filepath.Join(s.cfg.Root, "objects", id)
	m, err := socialLoad(dir)
	if errors.Is(err, os.ErrNotExist) {
		socialFailure(w, 404, "ciphertext object not found")
		return m, dir, false
	}
	if err != nil {
		socialFailure(w, 500, "object state unavailable")
		return m, dir, false
	}
	if m.ObjectID != id || m.ObjectID != g.ObjectID || m.ConversationID != g.ConversationID || (g.UploadID != "" && m.UploadID != g.UploadID) {
		socialFailure(w, 403, "object capability mismatch")
		return m, dir, false
	}
	if op == "object.read" && !m.ExpiresAt.After(s.cfg.Now()) {
		socialFailure(w, 410, "ciphertext retention expired")
		return m, dir, false
	}
	return m, dir, true
}
func (s *SocialAttachmentStore) readObject(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	m, dir, ok := s.object(w, r, "object.read")
	if !ok {
		s.mu.Unlock()
		return
	}
	f, err := os.Open(filepath.Join(dir, "ciphertext"))
	s.mu.Unlock()
	if err != nil {
		socialFailure(w, 500, "ciphertext unavailable")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", "attachment; filename=ciphertext")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Ciphertext-SHA256", m.SHA256)
	http.ServeContent(w, r, "ciphertext", m.CreatedAt, f)
}
func (s *SocialAttachmentStore) deleteObject(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, dir, ok := s.object(w, r, "object.delete")
	if !ok {
		return
	}
	if err := os.RemoveAll(dir); err != nil {
		socialFailure(w, 500, "ciphertext deletion pending")
		return
	}
	if socialSync(filepath.Dir(dir)) != nil {
		socialFailure(w, 500, "deletion persistence pending")
		return
	}
	u := filepath.Join(s.cfg.Root, "uploads", m.UploadID)
	if upload, err := socialLoad(u); err == nil {
		upload.Status = "deleted"
		if socialSave(u, upload) != nil {
			socialFailure(w, 500, "deletion receipt pending")
			return
		}
	}
	socialReply(w, 200, map[string]any{"status": "deleted", "objectId": m.ObjectID, "existingCopiesRevoked": false})
}

// Sweep expires unfinished uploads and retained objects; caller runs it periodically.
// No credentials are persisted, and retained files are never restored as sessions.
func (s *SocialAttachmentStore) Sweep() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now()
	for _, category := range []string{"objects", "uploads"} {
		root := filepath.Join(s.cfg.Root, category)
		entries, err := os.ReadDir(root)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if entry.IsDir() && (strings.HasPrefix(entry.Name(), ".complete-") || strings.HasPrefix(entry.Name(), ".upload-")) {
				if err = os.RemoveAll(filepath.Join(root, entry.Name())); err != nil {
					return err
				}
				continue
			}
			if !entry.IsDir() || !socialID.MatchString(entry.Name()) {
				continue
			}
			dir := filepath.Join(root, entry.Name())
			m, err := socialLoad(dir)
			if err != nil {
				return err
			}
			expired := !m.ExpiresAt.After(now)
			if category == "uploads" && m.Status != "complete" {
				expired = expired || !m.UploadExpiresAt.After(now)
			}
			if expired {
				if err = os.RemoveAll(dir); err != nil {
					return err
				}
			}
		}
		if err = socialSync(root); err != nil {
			return err
		}
	}
	return nil
}
