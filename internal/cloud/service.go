package cloud

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid request")
	ErrDenied   = errors.New("permission denied")
	ErrNotFound = errors.New("object not found")
)

type Config struct {
	StatePath      string
	ObjectDir      string
	QuotaBytes     int64
	Scanner        Scanner
	WalletVerifier WalletVerifier
	AIProvider     AIProvider
	ObjectStore    ObjectStore
	TrustSink      TrustSink
	ReleaseCommit  string
	ReleaseVersion string
	Now            func() time.Time
}

type DeletionPendingError struct{ Count int }

func (e DeletionPendingError) Error() string {
	return fmt.Sprintf("logical deletion completed; %d physical blob deletion(s) pending provider recovery", e.Count)
}

type Service struct {
	mu      sync.Mutex
	cfg     Config
	state   persistentState
	cancels map[string]context.CancelFunc
}

func New(cfg Config) (*Service, error) {
	if strings.TrimSpace(cfg.StatePath) == "" {
		return nil, errors.New("cloud state path is required")
	}
	if commit := strings.TrimSpace(cfg.ReleaseCommit); commit != "" {
		decoded, err := hex.DecodeString(commit)
		if err != nil || len(decoded) != 20 || commit != strings.ToLower(commit) {
			return nil, errors.New("YNX_RELEASE_COMMIT must be an exact lowercase 40-hex Git SHA")
		}
	}
	if cfg.ObjectDir == "" {
		cfg.ObjectDir = filepath.Join(filepath.Dir(cfg.StatePath), "objects")
	}
	if cfg.QuotaBytes <= 0 {
		cfg.QuotaBytes = 64 << 20
	}
	if cfg.Scanner == nil {
		cfg.Scanner = BoundedScanner{}
	}
	if cfg.WalletVerifier == nil {
		cfg.WalletVerifier = UnavailableWalletVerifier{}
	}
	if cfg.AIProvider == nil {
		cfg.AIProvider = UnavailableAIProvider{}
	}
	if cfg.ObjectStore == nil {
		cfg.ObjectStore = LocalObjectStore{Root: cfg.ObjectDir}
	}
	if cfg.TrustSink == nil {
		cfg.TrustSink = LocalAuditTrustSink{}
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	state, err := loadState(cfg.StatePath)
	if err != nil {
		return nil, err
	}
	service := &Service{cfg: cfg, state: state, cancels: map[string]context.CancelFunc{}}
	recovered := false
	for id, job := range service.state.AIJobs {
		if job.Status == "queued" || job.Status == "running" {
			job.Status = "failed"
			job.Error = "AI job was interrupted by service restart; retry requires fresh context consent"
			service.state.AIJobs[id] = job
			recovered = true
		}
	}
	if recovered {
		if err := saveState(cfg.StatePath, &service.state); err != nil {
			return nil, err
		}
	}
	return service, nil
}

func newID(prefix string) string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b)
}

func hashBytes(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func validAccount(v string) bool { return strings.HasPrefix(v, "ynx1") && len(v) >= 20 && len(v) <= 96 }

func (s *Service) persist(action, actor, objectID string, details map[string]any) error {
	event := AuditEvent{ID: newID("audit"), Actor: actor, Action: action, ObjectID: objectID, At: s.cfg.Now(), Details: details}
	s.state.Audit = append(s.state.Audit, event)
	if len(s.state.Audit) > 5000 {
		s.state.Audit = append([]AuditEvent(nil), s.state.Audit[len(s.state.Audit)-5000:]...)
	}
	if err := saveState(s.cfg.StatePath, &s.state); err != nil {
		return err
	}
	trust := TrustEvent{Actor: actor, Action: action, ObjectID: objectID, At: event.At, Details: details}
	if object, ok := s.state.Objects[objectID]; ok {
		trust.Hash = object.Hash
	}
	go func() { _ = s.cfg.TrustSink.Record(context.Background(), trust) }()
	return nil
}

func (s *Service) role(actor string, obj Object) string {
	if actor == obj.Owner {
		return "owner"
	}
	now := s.cfg.Now()
	current := obj
	for {
		best := ""
		for _, g := range s.state.Grants {
			if g.ObjectID != current.ID || g.Principal != actor || g.RevokedAt != nil || (g.ExpiresAt != nil && !g.ExpiresAt.After(now)) {
				continue
			}
			if rank(g.Role) > rank(best) {
				best = g.Role
			}
		}
		if best != "" {
			return best
		}
		if current.ParentID == "" {
			break
		}
		parent, ok := s.state.Objects[current.ParentID]
		if !ok {
			break
		}
		current = parent
	}
	return ""
}

func rank(role string) int {
	switch role {
	case "owner":
		return 3
	case "editor":
		return 2
	case "viewer":
		return 1
	}
	return 0
}

func (s *Service) require(actor, id string, minimum int) (Object, error) {
	obj, ok := s.state.Objects[id]
	if !ok {
		return Object{}, ErrNotFound
	}
	if rank(s.role(actor, obj)) < minimum {
		return Object{}, ErrDenied
	}
	return obj, nil
}

func validateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 180 || strings.ContainsAny(name, "\x00/\\") {
		return ErrInvalid
	}
	return nil
}

func validateArtifact(a *Artifact) error {
	if a == nil {
		return nil
	}
	valid := map[string]bool{"dataset": true, "strategy": true, "model": true, "build": true, "backtest": true, "experiment": true, "checkpoint": true, "media-source": true, "document-export": true, "audit-archive": true}
	if !valid[a.Type] || strings.TrimSpace(a.Product) == "" || len(a.Product) > 64 || (a.Retention != "standard" && a.Retention != "legal-hold" && a.Retention != "ephemeral") {
		return ErrInvalid
	}
	return nil
}

func (s *Service) Create(ctx context.Context, actor string, req CreateObjectRequest) (Object, error) {
	if !validAccount(actor) || validateName(req.Name) != nil || validateArtifact(req.Artifact) != nil {
		return Object{}, ErrInvalid
	}
	if req.Kind != KindFolder && req.Kind != KindFile && req.Kind != KindDoc {
		return Object{}, ErrInvalid
	}
	if req.Kind == KindFolder && len(req.Content) != 0 {
		return Object{}, ErrInvalid
	}
	if len(req.Content) > MaxUploadBytes {
		return Object{}, ErrInvalid
	}
	if req.Encryption.ClientSide {
		if req.Encryption.Algorithm != "AES-256-GCM" || req.Encryption.RecoveryPolicy == "" {
			return Object{}, ErrInvalid
		}
	} else if req.Encryption.Algorithm != "" || req.Encryption.KeyHint != "" {
		return Object{}, ErrInvalid
	}
	if req.Kind != KindFolder {
		if req.MIME == "" {
			req.MIME = "application/octet-stream"
		}
		if err := s.cfg.Scanner.Scan(ctx, req.Name, req.MIME, req.Content); err != nil {
			return Object{}, err
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if req.ParentID != "" {
		parent, err := s.require(actor, req.ParentID, 2)
		if err != nil || parent.Kind != KindFolder || parent.TrashedAt != nil {
			return Object{}, ErrDenied
		}
	}
	now := s.cfg.Now()
	obj := Object{ID: newID("obj"), Owner: actor, ParentID: req.ParentID, Kind: req.Kind, Name: strings.TrimSpace(req.Name), MIME: req.MIME, CreatedAt: now, UpdatedAt: now, Encryption: req.Encryption, Artifact: req.Artifact}
	if req.Kind != KindFolder {
		h := hashBytes(req.Content)
		path, err := s.cfg.ObjectStore.Put(ctx, h, req.Content)
		if err != nil {
			return Object{}, err
		}
		obj.Hash = h
		obj.Size = int64(len(req.Content))
		obj.Version = 1
		obj.ScanStatus = "accepted"
		if s.usedLocked(actor)+s.additionalLocked(actor, h, obj.Size) > s.cfg.QuotaBytes {
			return Object{}, errors.New("storage quota exceeded")
		}
		s.state.Versions[obj.ID] = []Version{{ObjectID: obj.ID, Number: 1, Hash: h, Size: obj.Size, MIME: obj.MIME, BlobPath: path, Author: actor, CreatedAt: now}}
	}
	s.state.Objects[obj.ID] = obj
	if err := s.persist("object.create", actor, obj.ID, map[string]any{"kind": obj.Kind, "hash": obj.Hash, "clientEncrypted": obj.Encryption.ClientSide, "artifact": obj.Artifact}); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) InitiateMultipart(actor string, req CreateObjectRequest, expectedSize int64, expectedHash string) (MultipartUpload, error) {
	if !validAccount(actor) || validateName(req.Name) != nil || req.Kind != KindFile || expectedSize < 1 || expectedSize > MaxMultipartBytes || len(expectedHash) != 64 || validateArtifact(req.Artifact) != nil {
		return MultipartUpload{}, ErrInvalid
	}
	if _, err := hex.DecodeString(expectedHash); err != nil || expectedHash != strings.ToLower(expectedHash) {
		return MultipartUpload{}, ErrInvalid
	}
	if req.Encryption.ClientSide {
		if req.Encryption.Algorithm != "AES-256-GCM" || req.Encryption.RecoveryPolicy == "" {
			return MultipartUpload{}, ErrInvalid
		}
	} else if req.Encryption.Algorithm != "" || req.Encryption.KeyHint != "" {
		return MultipartUpload{}, ErrInvalid
	}
	if req.MIME == "" {
		req.MIME = "application/octet-stream"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if req.ParentID != "" {
		p, err := s.require(actor, req.ParentID, 2)
		if err != nil || p.Kind != KindFolder || p.TrashedAt != nil {
			return MultipartUpload{}, ErrDenied
		}
	}
	now := s.cfg.Now()
	u := MultipartUpload{ID: newID("upload"), Owner: actor, ParentID: req.ParentID, Name: strings.TrimSpace(req.Name), MIME: req.MIME, Encryption: req.Encryption, Artifact: req.Artifact, ExpectedSize: expectedSize, ExpectedHash: expectedHash, Status: "active", Parts: map[int]MultipartPart{}, CreatedAt: now, UpdatedAt: now}
	s.state.MultipartUploads[u.ID] = u
	if err := s.persist("multipart.initiate", actor, "", map[string]any{"uploadId": u.ID, "expectedSize": expectedSize, "expectedHash": expectedHash}); err != nil {
		delete(s.state.MultipartUploads, u.ID)
		return MultipartUpload{}, err
	}
	return u, nil
}

func (s *Service) PutMultipartPart(ctx context.Context, actor, id string, number int, body []byte, claimedHash string) (MultipartPart, error) {
	if number < 1 || number > MaxMultipartParts || len(body) < 1 || len(body) > MaxUploadBytes || hashBytes(body) != claimedHash {
		return MultipartPart{}, ErrInvalid
	}
	s.mu.Lock()
	u, ok := s.state.MultipartUploads[id]
	s.mu.Unlock()
	if !ok {
		return MultipartPart{}, ErrNotFound
	}
	if u.Owner != actor {
		return MultipartPart{}, ErrDenied
	}
	if u.Status != "active" {
		return MultipartPart{}, ErrInvalid
	}
	ref, err := s.cfg.ObjectStore.Put(ctx, claimedHash, body)
	if err != nil {
		return MultipartPart{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	u = s.state.MultipartUploads[id]
	if u.Status != "active" {
		return MultipartPart{}, ErrInvalid
	}
	p := MultipartPart{Number: number, Size: int64(len(body)), Hash: claimedHash, Ref: ref}
	u.Parts[number] = p
	u.UpdatedAt = s.cfg.Now()
	s.state.MultipartUploads[id] = u
	if err := s.persist("multipart.part", actor, "", map[string]any{"uploadId": id, "part": number, "size": len(body), "hash": claimedHash}); err != nil {
		return MultipartPart{}, err
	}
	return p, nil
}

func (s *Service) GetMultipart(actor, id string) (MultipartUpload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.state.MultipartUploads[id]
	if !ok {
		return MultipartUpload{}, ErrNotFound
	}
	if u.Owner != actor {
		return MultipartUpload{}, ErrDenied
	}
	return u, nil
}

func (s *Service) CancelMultipart(actor, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.state.MultipartUploads[id]
	if !ok {
		return ErrNotFound
	}
	if u.Owner != actor {
		return ErrDenied
	}
	delete(s.state.MultipartUploads, id)
	return s.persist("multipart.cancel", actor, "", map[string]any{"uploadId": id, "parts": len(u.Parts)})
}

func (s *Service) CompleteMultipart(ctx context.Context, actor, id string, ordered []int) (Object, error) {
	s.mu.Lock()
	u, ok := s.state.MultipartUploads[id]
	if !ok {
		s.mu.Unlock()
		return Object{}, ErrNotFound
	}
	if u.Owner != actor {
		s.mu.Unlock()
		return Object{}, ErrDenied
	}
	if u.Status != "active" || len(ordered) == 0 || len(ordered) != len(u.Parts) {
		s.mu.Unlock()
		return Object{}, ErrInvalid
	}
	u.Status = "completing"
	s.state.MultipartUploads[id] = u
	s.mu.Unlock()
	failed := func() {
		s.mu.Lock()
		v, ok := s.state.MultipartUploads[id]
		if ok {
			v.Status = "active"
			s.state.MultipartUploads[id] = v
			_ = saveState(s.cfg.StatePath, &s.state)
		}
		s.mu.Unlock()
	}
	var all bytes.Buffer
	last := 0
	for _, n := range ordered {
		if n <= last {
			failed()
			return Object{}, ErrInvalid
		}
		p, ok := u.Parts[n]
		if !ok {
			failed()
			return Object{}, ErrInvalid
		}
		b, err := s.cfg.ObjectStore.Get(ctx, p.Ref, p.Hash)
		if err != nil {
			failed()
			return Object{}, err
		}
		all.Write(b)
		last = n
	}
	body := all.Bytes()
	if int64(len(body)) != u.ExpectedSize || hashBytes(body) != u.ExpectedHash {
		failed()
		return Object{}, errors.New("multipart final integrity mismatch")
	}
	obj, err := s.Create(ctx, actor, CreateObjectRequest{ParentID: u.ParentID, Kind: KindFile, Name: u.Name, MIME: u.MIME, Content: body, Encryption: u.Encryption, Artifact: u.Artifact})
	if err != nil {
		failed()
		return Object{}, err
	}
	s.mu.Lock()
	delete(s.state.MultipartUploads, id)
	err = s.persist("multipart.complete", actor, obj.ID, map[string]any{"uploadId": id, "parts": len(ordered), "hash": obj.Hash})
	s.mu.Unlock()
	if err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) InitiateDirectUpload(ctx context.Context, actor string, req CreateObjectRequest, expectedSize int64, expectedHash string) (DirectUpload, DirectUploadPlan, error) {
	provider, ok := s.cfg.ObjectStore.(DirectUploadStore)
	if !ok {
		return DirectUpload{}, DirectUploadPlan{}, errors.New("presigned direct upload unavailable for configured object store")
	}
	if !validAccount(actor) || validateName(req.Name) != nil || req.Kind != KindFile || expectedSize < 1 || expectedSize > MaxDirectUploadBytes || len(expectedHash) != 64 || validateArtifact(req.Artifact) != nil {
		return DirectUpload{}, DirectUploadPlan{}, ErrInvalid
	}
	if _, err := hex.DecodeString(expectedHash); err != nil || expectedHash != strings.ToLower(expectedHash) {
		return DirectUpload{}, DirectUploadPlan{}, ErrInvalid
	}
	if req.MIME == "" {
		req.MIME = "application/octet-stream"
	}
	if req.Encryption.ClientSide {
		if req.Encryption.Algorithm != "AES-256-GCM" || req.Encryption.RecoveryPolicy == "" {
			return DirectUpload{}, DirectUploadPlan{}, ErrInvalid
		}
	} else if req.Encryption.Algorithm != "" || req.Encryption.KeyHint != "" {
		return DirectUpload{}, DirectUploadPlan{}, ErrInvalid
	}
	s.mu.Lock()
	if req.ParentID != "" {
		p, err := s.require(actor, req.ParentID, 2)
		if err != nil || p.Kind != KindFolder || p.TrashedAt != nil {
			s.mu.Unlock()
			return DirectUpload{}, DirectUploadPlan{}, ErrDenied
		}
	}
	s.mu.Unlock()
	plan, err := provider.Presign(ctx, DirectUploadRequest{Hash: expectedHash, Size: expectedSize, MIME: req.MIME})
	if err != nil {
		return DirectUpload{}, DirectUploadPlan{}, err
	}
	now := s.cfg.Now()
	u := DirectUpload{ID: newID("direct"), Owner: actor, ParentID: req.ParentID, Name: strings.TrimSpace(req.Name), MIME: req.MIME, Encryption: req.Encryption, Artifact: req.Artifact, ExpectedSize: expectedSize, ExpectedHash: expectedHash, ProviderRef: plan.Ref, Status: "awaiting-upload", CreatedAt: now, UpdatedAt: now, ExpiresAt: plan.ExpiresAt}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.DirectUploads[u.ID] = u
	if err := s.persist("direct.initiate", actor, "", map[string]any{"directUploadId": u.ID, "size": expectedSize, "hash": expectedHash, "expiresAt": plan.ExpiresAt}); err != nil {
		delete(s.state.DirectUploads, u.ID)
		return DirectUpload{}, DirectUploadPlan{}, err
	}
	public := u
	public.ProviderRef = ""
	publicPlan := plan
	publicPlan.Ref = ""
	return public, publicPlan, nil
}

func (s *Service) GetDirectUpload(actor, id string) (DirectUpload, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u, ok := s.state.DirectUploads[id]
	if !ok {
		return DirectUpload{}, ErrNotFound
	}
	if u.Owner != actor {
		return DirectUpload{}, ErrDenied
	}
	u.ProviderRef = ""
	return u, nil
}

func (s *Service) CompleteDirectUpload(ctx context.Context, actor, id string) (Object, error) {
	provider, ok := s.cfg.ObjectStore.(DirectUploadStore)
	if !ok {
		return Object{}, errors.New("presigned direct upload unavailable for configured object store")
	}
	s.mu.Lock()
	u, ok := s.state.DirectUploads[id]
	if !ok {
		s.mu.Unlock()
		return Object{}, ErrNotFound
	}
	if u.Owner != actor {
		s.mu.Unlock()
		return Object{}, ErrDenied
	}
	if u.Status != "awaiting-upload" || !u.ExpiresAt.After(s.cfg.Now()) {
		s.mu.Unlock()
		return Object{}, ErrInvalid
	}
	u.Status = "verifying"
	u.UpdatedAt = s.cfg.Now()
	s.state.DirectUploads[id] = u
	s.mu.Unlock()
	verified, err := provider.VerifyDirect(ctx, u.ProviderRef, u.ExpectedHash, u.ExpectedSize)
	if err != nil {
		s.mu.Lock()
		u.Status = "awaiting-upload"
		u.UpdatedAt = s.cfg.Now()
		s.state.DirectUploads[id] = u
		_ = saveState(s.cfg.StatePath, &s.state)
		s.mu.Unlock()
		return Object{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	reset := func() {
		u.Status = "awaiting-upload"
		u.UpdatedAt = s.cfg.Now()
		s.state.DirectUploads[id] = u
		_ = saveState(s.cfg.StatePath, &s.state)
	}
	if u.ParentID != "" {
		p, err := s.require(actor, u.ParentID, 2)
		if err != nil || p.Kind != KindFolder || p.TrashedAt != nil {
			reset()
			return Object{}, ErrDenied
		}
	}
	if s.usedLocked(actor)+s.additionalLocked(actor, u.ExpectedHash, u.ExpectedSize) > s.cfg.QuotaBytes {
		reset()
		return Object{}, errors.New("storage quota exceeded")
	}
	before, err := json.Marshal(s.state)
	if err != nil {
		reset()
		return Object{}, err
	}
	now := s.cfg.Now()
	obj := Object{ID: newID("obj"), Owner: actor, ParentID: u.ParentID, Kind: KindFile, Name: u.Name, MIME: u.MIME, Size: u.ExpectedSize, Hash: u.ExpectedHash, Version: 1, CreatedAt: now, UpdatedAt: now, Encryption: u.Encryption, Artifact: u.Artifact, ScanStatus: verified.ScanStatus}
	s.state.Objects[obj.ID] = obj
	s.state.Versions[obj.ID] = []Version{{ObjectID: obj.ID, Number: 1, Hash: obj.Hash, Size: obj.Size, MIME: obj.MIME, BlobPath: u.ProviderRef, Author: actor, CreatedAt: now}}
	u.Status = "completed"
	u.UpdatedAt = now
	s.state.DirectUploads[id] = u
	if err := s.persist("direct.complete", actor, obj.ID, map[string]any{"directUploadId": id, "hash": obj.Hash, "size": obj.Size, "scanStatus": obj.ScanStatus}); err != nil {
		var restored persistentState
		if json.Unmarshal(before, &restored) == nil {
			s.state = restored
		}
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) CancelDirectUpload(ctx context.Context, actor, id string) (DirectUpload, error) {
	s.mu.Lock()
	u, ok := s.state.DirectUploads[id]
	if !ok {
		s.mu.Unlock()
		return DirectUpload{}, ErrNotFound
	}
	if u.Owner != actor {
		s.mu.Unlock()
		return DirectUpload{}, ErrDenied
	}
	if u.Status == "completed" {
		s.mu.Unlock()
		return DirectUpload{}, ErrInvalid
	}
	s.mu.Unlock()
	err := s.cfg.ObjectStore.Delete(ctx, u.ProviderRef, u.ExpectedHash)
	s.mu.Lock()
	defer s.mu.Unlock()
	u.UpdatedAt = s.cfg.Now()
	if err != nil {
		u.Status = "cancel-pending-provider-delete"
	} else {
		u.Status = "canceled"
	}
	s.state.DirectUploads[id] = u
	if persistErr := s.persist("direct.cancel", actor, "", map[string]any{"directUploadId": id, "status": u.Status}); persistErr != nil {
		return DirectUpload{}, persistErr
	}
	if err != nil {
		u.ProviderRef = ""
		return u, errors.New("direct upload canceled; provider object deletion pending")
	}
	u.ProviderRef = ""
	return u, nil
}

func (s *Service) SaveDocument(ctx context.Context, actor, id string, req SaveDocumentRequest) (Object, error) {
	if len(req.Content) > MaxUploadBytes {
		return Object{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	if obj.Kind != KindDoc || obj.TrashedAt != nil || obj.Encryption.ClientSide {
		return Object{}, ErrInvalid
	}
	if req.BaseVersion != obj.Version {
		return Object{}, ConflictError{Current: obj}
	}
	if err := s.cfg.Scanner.Scan(ctx, obj.Name, "text/plain", req.Content); err != nil {
		return Object{}, err
	}
	h := hashBytes(req.Content)
	path, err := s.cfg.ObjectStore.Put(ctx, h, req.Content)
	if err != nil {
		return Object{}, err
	}
	if s.usedLocked(actor)+s.additionalLocked(actor, h, int64(len(req.Content))) > s.cfg.QuotaBytes {
		return Object{}, errors.New("storage quota exceeded")
	}
	now := s.cfg.Now()
	obj.Version++
	obj.Hash = h
	obj.Size = int64(len(req.Content))
	obj.MIME = "text/plain"
	obj.UpdatedAt = now
	obj.ScanStatus = "accepted"
	s.state.Objects[id] = obj
	s.state.Versions[id] = append(s.state.Versions[id], Version{ObjectID: id, Number: obj.Version, Hash: h, Size: obj.Size, MIME: obj.MIME, BlobPath: path, Author: actor, CreatedAt: now})
	if err := s.persist("document.save", actor, id, map[string]any{"version": obj.Version, "hash": h}); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) List(actor string, opt ListOptions) ([]Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	q := strings.ToLower(strings.TrimSpace(opt.Query))
	out := []Object{}
	for _, obj := range s.state.Objects {
		if rank(s.role(actor, obj)) == 0 {
			continue
		}
		switch opt.View {
		case "trash":
			if obj.TrashedAt == nil {
				continue
			}
		case "starred":
			if obj.TrashedAt != nil || !obj.Starred {
				continue
			}
		case "recent":
			if obj.TrashedAt != nil {
				continue
			}
		default:
			if obj.TrashedAt != nil || obj.ParentID != opt.ParentID {
				continue
			}
		}
		if q != "" && !strings.Contains(strings.ToLower(obj.Name), q) {
			continue
		}
		out = append(out, obj)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *Service) Get(actor, id string) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.require(actor, id, 1)
}

func (s *Service) Content(actor, id string, version int) (Object, []byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 1)
	if err != nil {
		return Object{}, nil, err
	}
	if obj.Kind == KindFolder {
		return Object{}, nil, ErrInvalid
	}
	versions := s.state.Versions[id]
	if version == 0 {
		version = obj.Version
	}
	for _, v := range versions {
		if v.Number == version {
			b, err := s.cfg.ObjectStore.Get(context.Background(), v.BlobPath, v.Hash)
			return obj, b, err
		}
	}
	return Object{}, nil, ErrNotFound
}

func (s *Service) Versions(actor, id string) ([]Version, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 1); err != nil {
		return nil, err
	}
	v := append([]Version(nil), s.state.Versions[id]...)
	sort.Slice(v, func(i, j int) bool { return v[i].Number > v[j].Number })
	return v, nil
}

func (s *Service) RestoreVersion(actor, id string, number int) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	var source *Version
	for i := range s.state.Versions[id] {
		if s.state.Versions[id][i].Number == number {
			v := s.state.Versions[id][i]
			source = &v
			break
		}
	}
	if source == nil {
		return Object{}, ErrNotFound
	}
	obj.Version++
	obj.Hash = source.Hash
	obj.Size = source.Size
	obj.MIME = source.MIME
	obj.UpdatedAt = s.cfg.Now()
	s.state.Objects[id] = obj
	s.state.Versions[id] = append(s.state.Versions[id], Version{ObjectID: id, Number: obj.Version, Hash: source.Hash, Size: source.Size, MIME: source.MIME, BlobPath: source.BlobPath, Author: actor, CreatedAt: obj.UpdatedAt})
	if err := s.persist("version.restore", actor, id, map[string]any{"sourceVersion": number, "version": obj.Version}); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) SetStar(actor, id string, value bool) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	obj.Starred = value
	obj.UpdatedAt = s.cfg.Now()
	s.state.Objects[id] = obj
	if err := s.persist("object.star", actor, id, map[string]any{"starred": value}); err != nil {
		return Object{}, err
	}
	return obj, nil
}
func (s *Service) SetTrash(actor, id string, trash bool) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	now := s.cfg.Now()
	if trash {
		obj.TrashedAt = &now
	} else {
		obj.TrashedAt = nil
	}
	obj.UpdatedAt = now
	s.state.Objects[id] = obj
	action := "object.restore"
	if trash {
		action = "object.trash"
	}
	if err := s.persist(action, actor, id, nil); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) DeleteObject(actor, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 3)
	if err != nil {
		return err
	}
	if obj.Owner != actor || obj.TrashedAt == nil {
		return ErrDenied
	}
	if obj.Artifact != nil && obj.Artifact.Retention == "legal-hold" {
		return errors.New("legal hold prevents deletion")
	}
	for _, child := range s.state.Objects {
		if child.ParentID == id {
			return errors.New("folder must be empty before permanent deletion")
		}
	}
	before, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	for key, grant := range s.state.Grants {
		if grant.ObjectID == id {
			delete(s.state.Grants, key)
		}
	}
	for key, link := range s.state.Links {
		if link.ObjectID == id {
			delete(s.state.Links, key)
		}
	}
	for key, request := range s.state.AccessRequests {
		if request.ObjectID == id {
			delete(s.state.AccessRequests, key)
		}
	}
	for key, presence := range s.state.Presence {
		if presence.ObjectID == id {
			delete(s.state.Presence, key)
		}
	}
	removedVersions := append([]Version(nil), s.state.Versions[id]...)
	delete(s.state.Comments, id)
	delete(s.state.Versions, id)
	delete(s.state.Objects, id)
	if err := s.persist("object.delete", actor, id, map[string]any{"kind": obj.Kind, "name": obj.Name, "lastHash": obj.Hash, "logicalDeletion": true, "physicalDeletion": "attempted only after final content reference"}); err != nil {
		var restored persistentState
		if json.Unmarshal(before, &restored) == nil {
			s.state = restored
		}
		return err
	}
	remaining := map[string]bool{}
	for _, versions := range s.state.Versions {
		for _, v := range versions {
			remaining[v.Hash] = true
		}
	}
	unique := map[string]Version{}
	for _, v := range removedVersions {
		if !remaining[v.Hash] {
			unique[v.Hash+"\x00"+v.BlobPath] = v
		}
	}
	pending := 0
	for _, v := range unique {
		now := s.cfg.Now()
		d := BlobDeletion{ID: newID("deletion"), Owner: actor, Hash: v.Hash, Ref: v.BlobPath, Status: "completed", Attempts: 1, RequestedAt: now, UpdatedAt: now}
		if err := s.cfg.ObjectStore.Delete(context.Background(), v.BlobPath, v.Hash); err != nil {
			d.Status = "pending"
			d.LastError = "provider deletion failed; operator retry required"
			pending++
		}
		s.state.BlobDeletions[d.ID] = d
	}
	if len(unique) > 0 {
		if err := s.persist("blob.delete", actor, id, map[string]any{"eligible": len(unique), "pending": pending}); err != nil {
			return err
		}
	}
	if pending > 0 {
		return DeletionPendingError{Count: pending}
	}
	return nil
}

func (s *Service) BlobDeletions(actor string) ([]BlobDeletion, error) {
	if !validAccount(actor) {
		return nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []BlobDeletion{}
	for _, d := range s.state.BlobDeletions {
		if d.Owner == actor {
			copy := d
			copy.Ref = ""
			copy.LastError = strings.TrimSpace(copy.LastError)
			out = append(out, copy)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

func (s *Service) RetryBlobDeletion(ctx context.Context, actor, id string) (BlobDeletion, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.state.BlobDeletions[id]
	if !ok {
		return BlobDeletion{}, ErrNotFound
	}
	if d.Owner != actor {
		return BlobDeletion{}, ErrDenied
	}
	if d.Status == "completed" {
		d.Ref = ""
		return d, nil
	}
	d.Attempts++
	d.UpdatedAt = s.cfg.Now()
	if err := s.cfg.ObjectStore.Delete(ctx, d.Ref, d.Hash); err != nil {
		d.Status = "pending"
		d.LastError = "provider deletion failed; retry remains available"
	} else {
		d.Status = "completed"
		d.LastError = ""
	}
	s.state.BlobDeletions[id] = d
	if err := s.persist("blob.delete.retry", actor, "", map[string]any{"deletionId": id, "status": d.Status, "attempts": d.Attempts}); err != nil {
		return BlobDeletion{}, err
	}
	d.Ref = ""
	return d, nil
}

func (s *Service) ExportOwnedData(ctx context.Context, actor string) ([]byte, ExportManifest, error) {
	if !validAccount(actor) {
		return nil, ExportManifest{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	manifest := ExportManifest{SchemaVersion: 1, Authority: "YNX Cloud owner metadata and verified object bytes", Source: "ynx-cloudd", AsOf: s.cfg.Now(), Owner: actor, Objects: []Object{}, Versions: []Version{}, Grants: []Grant{}, Audit: []AuditEvent{}, Files: []ExportFile{}}
	owned := map[string]bool{}
	for _, obj := range s.state.Objects {
		if obj.Owner == actor {
			manifest.Objects = append(manifest.Objects, obj)
			owned[obj.ID] = true
		}
	}
	sort.Slice(manifest.Objects, func(i, j int) bool { return manifest.Objects[i].ID < manifest.Objects[j].ID })
	for _, g := range s.state.Grants {
		if owned[g.ObjectID] {
			manifest.Grants = append(manifest.Grants, g)
		}
	}
	for _, e := range s.state.Audit {
		if e.Actor == actor || owned[e.ObjectID] {
			manifest.Audit = append(manifest.Audit, e)
		}
	}
	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, obj := range manifest.Objects {
		versions := append([]Version(nil), s.state.Versions[obj.ID]...)
		sort.Slice(versions, func(i, j int) bool { return versions[i].Number < versions[j].Number })
		for _, v := range versions {
			body, err := s.cfg.ObjectStore.Get(ctx, v.BlobPath, v.Hash)
			if err != nil {
				_ = zw.Close()
				return nil, ExportManifest{}, fmt.Errorf("export object %s version %d: %w", obj.ID, v.Number, err)
			}
			if int64(len(body)) != v.Size || hashBytes(body) != v.Hash {
				_ = zw.Close()
				return nil, ExportManifest{}, errors.New("export source integrity mismatch")
			}
			name := fmt.Sprintf("objects/%s/versions/%06d.bin", obj.ID, v.Number)
			w, err := zw.Create(name)
			if err != nil {
				return nil, ExportManifest{}, err
			}
			if _, err = w.Write(body); err != nil {
				return nil, ExportManifest{}, err
			}
			manifest.Versions = append(manifest.Versions, v)
			manifest.Files = append(manifest.Files, ExportFile{ObjectID: obj.ID, Version: v.Number, Path: name, Hash: v.Hash, Bytes: v.Size})
		}
	}
	metadata, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, ExportManifest{}, err
	}
	w, err := zw.Create("manifest.json")
	if err != nil {
		return nil, ExportManifest{}, err
	}
	if _, err = w.Write(metadata); err != nil {
		return nil, ExportManifest{}, err
	}
	if err = zw.Close(); err != nil {
		return nil, ExportManifest{}, err
	}
	if err := s.persist("data.export", actor, "", map[string]any{"objects": len(manifest.Objects), "versions": len(manifest.Versions), "bytes": out.Len()}); err != nil {
		return nil, ExportManifest{}, err
	}
	return out.Bytes(), manifest, nil
}

func (s *Service) Grant(actor, id, principal, role string, expires *time.Time) (Grant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 3)
	if err != nil {
		return Grant{}, err
	}
	if !validAccount(principal) || (role != "viewer" && role != "editor") || principal == obj.Owner || (expires != nil && !expires.After(s.cfg.Now())) {
		return Grant{}, ErrInvalid
	}
	g := Grant{ID: newID("grant"), ObjectID: id, Principal: principal, Role: role, CreatedBy: actor, CreatedAt: s.cfg.Now(), ExpiresAt: expires}
	s.state.Grants[g.ID] = g
	if err := s.persist("permission.grant", actor, id, map[string]any{"principal": principal, "role": role, "expiresAt": expires}); err != nil {
		return Grant{}, err
	}
	return g, nil
}
func (s *Service) RevokeGrant(actor, id, grantID string) (Grant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 3); err != nil {
		return Grant{}, err
	}
	g, ok := s.state.Grants[grantID]
	if !ok || g.ObjectID != id {
		return Grant{}, ErrNotFound
	}
	now := s.cfg.Now()
	g.RevokedAt = &now
	s.state.Grants[grantID] = g
	if err := s.persist("permission.revoke", actor, id, map[string]any{"grantId": grantID}); err != nil {
		return Grant{}, err
	}
	return g, nil
}
func (s *Service) Grants(actor, id string) ([]Grant, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 3); err != nil {
		return nil, err
	}
	out := []Grant{}
	for _, g := range s.state.Grants {
		if g.ObjectID == id {
			out = append(out, g)
		}
	}
	return out, nil
}

func (s *Service) CreateLink(actor, id, role string, expires time.Time) (ShareLink, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 3); err != nil {
		return ShareLink{}, "", err
	}
	if role != "viewer" || !expires.After(s.cfg.Now()) || expires.After(s.cfg.Now().Add(30*24*time.Hour)) {
		return ShareLink{}, "", ErrInvalid
	}
	token := newID("share")
	l := ShareLink{ID: newID("link"), ObjectID: id, TokenHash: hashBytes([]byte(token)), Role: role, ExpiresAt: expires, CreatedBy: actor, CreatedAt: s.cfg.Now()}
	s.state.Links[l.ID] = l
	if err := s.persist("link.create", actor, id, map[string]any{"linkId": l.ID, "expiresAt": expires}); err != nil {
		return ShareLink{}, "", err
	}
	return l, token, nil
}
func (s *Service) RevokeLink(actor, id, linkID string) (ShareLink, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 3); err != nil {
		return ShareLink{}, err
	}
	l, ok := s.state.Links[linkID]
	if !ok || l.ObjectID != id {
		return ShareLink{}, ErrNotFound
	}
	now := s.cfg.Now()
	l.RevokedAt = &now
	s.state.Links[linkID] = l
	if err := s.persist("link.revoke", actor, id, map[string]any{"linkId": linkID}); err != nil {
		return ShareLink{}, err
	}
	return l, nil
}

func (s *Service) Links(actor, id string) ([]ShareLink, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 3); err != nil {
		return nil, err
	}
	out := []ShareLink{}
	for _, link := range s.state.Links {
		if link.ObjectID == id {
			out = append(out, link)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}
func (s *Service) ResolveLink(token string) (Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashBytes([]byte(token))
	for _, l := range s.state.Links {
		if l.TokenHash == h && l.RevokedAt == nil && l.ExpiresAt.After(s.cfg.Now()) {
			o, ok := s.state.Objects[l.ObjectID]
			if ok && o.TrashedAt == nil {
				return o, nil
			}
		}
	}
	return Object{}, ErrDenied
}

func (s *Service) ResolveLinkContent(token string) (Object, []byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashBytes([]byte(token))
	for _, link := range s.state.Links {
		if link.TokenHash != h || link.RevokedAt != nil || !link.ExpiresAt.After(s.cfg.Now()) {
			continue
		}
		object, ok := s.state.Objects[link.ObjectID]
		if !ok || object.TrashedAt != nil || object.Kind == KindFolder {
			return Object{}, nil, ErrNotFound
		}
		for _, version := range s.state.Versions[object.ID] {
			if version.Number == object.Version {
				body, err := s.cfg.ObjectStore.Get(context.Background(), version.BlobPath, version.Hash)
				return object, body, err
			}
		}
	}
	return Object{}, nil, ErrDenied
}

func (s *Service) RequestAccess(actor, id, role, message string) (AccessRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !validAccount(actor) || (role != "viewer" && role != "editor") || len(message) > 500 {
		return AccessRequest{}, ErrInvalid
	}
	if _, ok := s.state.Objects[id]; !ok {
		return AccessRequest{}, ErrNotFound
	}
	r := AccessRequest{ID: newID("access"), ObjectID: id, Requester: actor, RequestedRole: role, Message: message, Status: "pending", CreatedAt: s.cfg.Now()}
	s.state.AccessRequests[r.ID] = r
	if err := s.persist("access.request", actor, id, map[string]any{"role": role}); err != nil {
		return AccessRequest{}, err
	}
	return r, nil
}
func (s *Service) DecideAccess(actor, requestID, decision string) (AccessRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.state.AccessRequests[requestID]
	if !ok {
		return AccessRequest{}, ErrNotFound
	}
	if _, err := s.require(actor, r.ObjectID, 3); err != nil {
		return AccessRequest{}, err
	}
	if r.Status != "pending" || (decision != "approved" && decision != "denied") {
		return AccessRequest{}, ErrInvalid
	}
	now := s.cfg.Now()
	r.Status = decision
	r.DecidedAt = &now
	r.DecidedBy = actor
	s.state.AccessRequests[r.ID] = r
	if decision == "approved" {
		g := Grant{ID: newID("grant"), ObjectID: r.ObjectID, Principal: r.Requester, Role: r.RequestedRole, CreatedBy: actor, CreatedAt: now}
		s.state.Grants[g.ID] = g
	}
	if err := s.persist("access."+decision, actor, r.ObjectID, map[string]any{"requestId": r.ID}); err != nil {
		return AccessRequest{}, err
	}
	return r, nil
}

func (s *Service) AccessRequests(actor, id string) ([]AccessRequest, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 3); err != nil {
		return nil, err
	}
	out := []AccessRequest{}
	for _, request := range s.state.AccessRequests {
		if request.ObjectID == id {
			out = append(out, request)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *Service) AddComment(actor, id string, version int, body string, mentions []string) (Comment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 1)
	if err != nil {
		return Comment{}, err
	}
	if obj.Kind != KindDoc || version < 1 || version > obj.Version || strings.TrimSpace(body) == "" || len(body) > 2000 || len(mentions) > 20 {
		return Comment{}, ErrInvalid
	}
	for _, m := range mentions {
		if !validAccount(m) {
			return Comment{}, ErrInvalid
		}
	}
	c := Comment{ID: newID("comment"), ObjectID: id, Version: version, Author: actor, Body: strings.TrimSpace(body), Mentions: append([]string(nil), mentions...), CreatedAt: s.cfg.Now()}
	s.state.Comments[id] = append(s.state.Comments[id], c)
	if err := s.persist("comment.create", actor, id, map[string]any{"version": version, "mentions": len(mentions)}); err != nil {
		return Comment{}, err
	}
	return c, nil
}
func (s *Service) Comments(actor, id string) ([]Comment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 1); err != nil {
		return nil, err
	}
	return append([]Comment(nil), s.state.Comments[id]...), nil
}
func (s *Service) Presence(actor, id, label string) ([]Presence, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.require(actor, id, 1); err != nil {
		return nil, err
	}
	now := s.cfg.Now()
	for k, p := range s.state.Presence {
		if !p.ExpiresAt.After(now) {
			delete(s.state.Presence, k)
		}
	}
	key := id + ":" + actor
	s.state.Presence[key] = Presence{ObjectID: id, Actor: actor, Label: strings.TrimSpace(label), ExpiresAt: now.Add(45 * time.Second)}
	out := []Presence{}
	for _, p := range s.state.Presence {
		if p.ObjectID == id {
			out = append(out, p)
		}
	}
	if len(out) > 25 {
		out = out[:25]
	}
	return out, nil
}

func (s *Service) Audit(actor string) ([]AuditEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []AuditEvent{}
	for i := len(s.state.Audit) - 1; i >= 0 && len(out) < 200; i-- {
		e := s.state.Audit[i]
		if e.Actor == actor {
			out = append(out, e)
			continue
		}
		if e.ObjectID != "" {
			if o, ok := s.state.Objects[e.ObjectID]; ok && rank(s.role(actor, o)) >= 3 {
				out = append(out, e)
			}
		}
	}
	return out, nil
}
func (s *Service) usedLocked(actor string) int64 {
	var total int64
	seen := map[string]bool{}
	for _, o := range s.state.Objects {
		if o.Owner != actor || o.Kind == KindFolder {
			continue
		}
		for _, version := range s.state.Versions[o.ID] {
			if !seen[version.Hash] {
				seen[version.Hash] = true
				total += version.Size
			}
		}
	}
	return total
}

func (s *Service) additionalLocked(actor, hash string, size int64) int64 {
	for _, object := range s.state.Objects {
		if object.Owner != actor {
			continue
		}
		for _, version := range s.state.Versions[object.ID] {
			if version.Hash == hash {
				return 0
			}
		}
	}
	return size
}
func (s *Service) Quota(actor string) (used, limit int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.usedLocked(actor), s.cfg.QuotaBytes
}

func (s *Service) AIStatus(ctx context.Context) map[string]any {
	provider, model, ok := s.cfg.AIProvider.Status(ctx)
	return map[string]any{"provider": provider, "model": model, "available": ok, "boundary": "selected file versions only; encrypted content excluded"}
}
func (s *Service) CreateAIJob(ctx context.Context, actor, mode, instruction string, ids []string, versions []int, consent bool) (AIJob, error) {
	if !consent || len(ids) == 0 || len(ids) > 12 || len(ids) != len(versions) || len(instruction) > 4000 {
		return AIJob{}, ErrInvalid
	}
	allowed := map[string]bool{"summarize": true, "answer": true, "draft": true, "revise": true, "organize": true}
	if !allowed[mode] {
		return AIJob{}, ErrInvalid
	}
	s.mu.Lock()
	contexts := []AIContext{}
	citations := []string{}
	for i, id := range ids {
		obj, err := s.require(actor, id, 1)
		if err != nil {
			s.mu.Unlock()
			return AIJob{}, err
		}
		if obj.Encryption.ClientSide {
			s.mu.Unlock()
			return AIJob{}, errors.New("client-encrypted content cannot be sent to AI")
		}
		v := versions[i]
		if v == 0 {
			v = obj.Version
		}
		var selected *Version
		for n := range s.state.Versions[id] {
			if s.state.Versions[id][n].Number == v {
				x := s.state.Versions[id][n]
				selected = &x
				break
			}
		}
		if selected == nil {
			s.mu.Unlock()
			return AIJob{}, ErrNotFound
		}
		b, err := s.cfg.ObjectStore.Get(ctx, selected.BlobPath, selected.Hash)
		if err != nil {
			s.mu.Unlock()
			return AIJob{}, err
		}
		contexts = append(contexts, AIContext{ObjectID: id, Version: v, Name: obj.Name, Content: string(b)})
		citations = append(citations, fmt.Sprintf("%s@v%d", id, v))
	}
	provider, model, available := s.cfg.AIProvider.Status(ctx)
	job := AIJob{ID: newID("ai"), Actor: actor, Mode: mode, ObjectIDs: append([]string(nil), ids...), Versions: append([]int(nil), versions...), Instruction: instruction, Provider: provider, Model: model, Estimate: len(instruction) / 4, ConsentAt: s.cfg.Now(), Status: "queued", Citations: citations}
	for _, c := range contexts {
		job.Estimate += len(c.Content) / 4
	}
	s.state.AIJobs[job.ID] = job
	_ = s.persist("ai.consent", actor, "", map[string]any{"jobId": job.ID, "mode": mode, "contexts": citations, "estimatedUnits": job.Estimate})
	jobCtx, cancel := context.WithCancel(context.Background())
	s.cancels[job.ID] = cancel
	s.mu.Unlock()
	go s.runAIJob(jobCtx, job, instruction, contexts, available)
	return job, nil
}

func (s *Service) runAIJob(ctx context.Context, job AIJob, instruction string, contexts []AIContext, available bool) {
	s.mu.Lock()
	if existing := s.state.AIJobs[job.ID]; existing.Status == "canceled" {
		s.mu.Unlock()
		return
	}
	job.Status = "running"
	s.state.AIJobs[job.ID] = job
	_ = s.persist("ai.started", job.Actor, "", map[string]any{"jobId": job.ID})
	s.mu.Unlock()
	if !available {
		job.Status = "failed"
		job.Error = "YNX AI Gateway provider is unavailable"
	} else {
		result, err := s.cfg.AIProvider.Complete(ctx, instruction, contexts)
		if errors.Is(err, context.Canceled) || ctx.Err() != nil {
			job.Status = "canceled"
			job.Error = "canceled by user"
		} else if err != nil {
			job.Status = "failed"
			job.Error = err.Error()
		} else {
			job.Status = "review"
			job.Result = result
		}
	}
	s.mu.Lock()
	delete(s.cancels, job.ID)
	if current := s.state.AIJobs[job.ID]; current.Status == "canceled" {
		job.Status = "canceled"
		job.Error = "canceled by user"
	}
	s.state.AIJobs[job.ID] = job
	_ = s.persist("ai.result", job.Actor, "", map[string]any{"jobId": job.ID, "status": job.Status})
	s.mu.Unlock()
}

func (s *Service) GetAIJob(actor, id string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.state.AIJobs[id]
	if !ok {
		return AIJob{}, ErrNotFound
	}
	if job.Actor != actor {
		return AIJob{}, ErrDenied
	}
	return job, nil
}

func (s *Service) CancelAIJob(actor, id string) (AIJob, error) {
	s.mu.Lock()
	job, ok := s.state.AIJobs[id]
	if !ok {
		s.mu.Unlock()
		return AIJob{}, ErrNotFound
	}
	if job.Actor != actor || (job.Status != "queued" && job.Status != "running") {
		s.mu.Unlock()
		return AIJob{}, ErrDenied
	}
	job.Status = "canceled"
	job.Error = "canceled by user"
	s.state.AIJobs[id] = job
	cancel := s.cancels[id]
	_ = s.persist("ai.canceled", actor, "", map[string]any{"jobId": id})
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return job, nil
}
func (s *Service) ReviewAI(actor, id, decision string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	j, ok := s.state.AIJobs[id]
	if !ok {
		return AIJob{}, ErrNotFound
	}
	if j.Actor != actor || j.Status != "review" || (decision != "applied" && decision != "rejected") {
		return AIJob{}, ErrDenied
	}
	now := s.cfg.Now()
	j.Status = decision
	if decision == "applied" {
		j.AppliedAt = &now
	} else {
		j.RejectedAt = &now
	}
	s.state.AIJobs[id] = j
	if err := s.persist("ai."+decision, actor, "", map[string]any{"jobId": id}); err != nil {
		return AIJob{}, err
	}
	return j, nil
}

func walletProductBinding(request WalletAuthorizationRequest) (string, error) {
	type binding struct {
		product, client, bundle, callback string
		scopes                            []string
	}
	bindings := []binding{
		{"cloud", "ynx-cloud-mobile-v1", "com.ynxweb4.cloud", "ynxcloud://wallet-auth/callback", []string{"ai.use", "audit.read", "files.read", "files.write", "permissions.manage"}},
		{"docs", "ynx-docs-mobile-v1", "com.ynxweb4.docs", "ynxdocs://wallet-auth/callback", []string{"ai.use", "audit.read", "comments.write", "documents.read", "documents.write", "sharing.manage"}},
		{"cloud", "ynx-cloud-web-v1", "web.ynx.cloud", "https://cloud.staging.ynx.network/auth/callback", []string{"ai.use", "audit.read", "files.read", "files.write", "permissions.manage"}},
		{"docs", "ynx-docs-web-v1", "web.ynx.docs", "https://docs.staging.ynx.network/auth/callback", []string{"ai.use", "audit.read", "comments.write", "documents.read", "documents.write", "sharing.manage"}},
	}
	for _, b := range bindings {
		if request.RequestingProduct != b.product || request.ProductClientID != b.client || request.BundleID != b.bundle || request.Callback != b.callback || len(request.Scopes) == 0 || len(request.Scopes) > len(b.scopes) {
			continue
		}
		allowed, previous := map[string]bool{}, ""
		for _, scope := range b.scopes {
			allowed[scope] = true
		}
		valid := true
		for _, scope := range request.Scopes {
			if !allowed[scope] || scope <= previous {
				valid = false
				break
			}
			previous = scope
		}
		if valid {
			return b.product, nil
		}
	}
	return "", ErrInvalid
}

func authorizationDigest(request WalletAuthorizationRequest) (string, error) {
	b, err := json.Marshal(request)
	if err != nil {
		return "", err
	}
	var value map[string]any
	if err := json.Unmarshal(b, &value); err != nil {
		return "", err
	}
	canonical, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return hashBytes(canonical), nil
}

func validateWalletPair(request WalletAuthorizationRequest, approval WalletApproval, now time.Time) (string, time.Time, error) {
	product, err := walletProductBinding(request)
	if err != nil || request.Version != "1" || request.ChainID != ChainID || request.ProductDeviceAlgorithm != "p256-sha256" || len(request.Nonce) < 32 || len(request.Nonce) > 64 || len(request.ProductDeviceKey) != 44 || len(request.Purpose) < 8 || len(request.Purpose) > 280 {
		return "", time.Time{}, ErrInvalid
	}
	issued, err1 := time.Parse(time.RFC3339Nano, request.IssuedAt)
	expires, err2 := time.Parse(time.RFC3339Nano, request.ExpiresAt)
	if err1 != nil || err2 != nil || issued.After(now.Add(30*time.Second)) || !expires.After(now) || expires.Sub(issued) > 5*time.Minute || !expires.After(issued) {
		return "", time.Time{}, ErrInvalid
	}
	digest, err := authorizationDigest(request)
	if err != nil {
		return "", time.Time{}, ErrInvalid
	}
	approvalIssued, approvalErr := time.Parse(time.RFC3339Nano, approval.IssuedAt)
	if approvalErr != nil || approval.Version != "1" || approval.RequestDigest != digest || approval.Nonce != request.Nonce || approval.ChainID != request.ChainID || approval.RequestingProduct != request.RequestingProduct || approval.ProductClientID != request.ProductClientID || approval.BundleID != request.BundleID || approval.ProductDeviceAlgorithm != request.ProductDeviceAlgorithm || approval.ProductDeviceKey != request.ProductDeviceKey || approval.Callback != request.Callback || approval.Purpose != request.Purpose || approval.ExpiresAt != request.ExpiresAt || strings.Join(approval.GrantedScopes, "\n") != strings.Join(request.Scopes, "\n") || !validAccount(approval.Account) || len(approval.AccountPublicKey) != 66 || len(approval.WalletSignature) != 128 || approvalIssued.Before(issued) || approvalIssued.After(now.Add(30*time.Second)) {
		return "", time.Time{}, ErrInvalid
	}
	return product, expires, nil
}

func (s *Service) CreateWalletChallenge(request WalletAuthorizationRequest, approval WalletApproval) (GatewayChallenge, error) {
	now := s.cfg.Now().UTC().Truncate(time.Millisecond)
	product, approvalExpiry, err := validateWalletPair(request, approval, now)
	if err != nil {
		return GatewayChallenge{}, err
	}
	expires := now.Add(3 * time.Minute)
	if approvalExpiry.Before(expires) {
		expires = approvalExpiry
	}
	challenge := GatewayChallenge{Version: "1", Challenge: newID("gateway"), RequestDigest: approval.RequestDigest, ProductClientID: approval.ProductClientID, BundleID: approval.BundleID, ProductDeviceAlgorithm: approval.ProductDeviceAlgorithm, ProductDeviceKey: approval.ProductDeviceKey, Account: approval.Account, Scopes: append([]string(nil), approval.GrantedScopes...), IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: expires.Format("2006-01-02T15:04:05.000Z")}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, pending := range s.state.WalletChallenges {
		if !pending.CreatedAt.Add(5 * time.Minute).After(now) {
			delete(s.state.WalletChallenges, id)
		}
	}
	s.state.WalletChallenges[challenge.Challenge] = PendingWalletChallenge{Challenge: challenge, Product: product, Callback: request.Callback, Nonce: request.Nonce, CreatedAt: now}
	if err := s.persist("session.challenge", approval.Account, "", map[string]any{"product": product, "requestDigest": approval.RequestDigest}); err != nil {
		return GatewayChallenge{}, err
	}
	return challenge, nil
}

func (s *Service) CreateSession(ctx context.Context, envelope WalletSessionEnvelope) (string, Session, error) {
	now := s.cfg.Now().UTC()
	product, expires, err := validateWalletPair(envelope.AuthorizationRequest, envelope.WalletApproval, now)
	if err != nil {
		return "", Session{}, err
	}
	challenge := envelope.GatewayCompletion.Challenge
	s.mu.Lock()
	pending, ok := s.state.WalletChallenges[challenge.Challenge]
	s.mu.Unlock()
	if !ok || pending.Product != product || pending.Callback != envelope.AuthorizationRequest.Callback || pending.Nonce != envelope.AuthorizationRequest.Nonce || !reflect.DeepEqual(pending.Challenge, challenge) {
		return "", Session{}, errors.New("canonical Wallet challenge mismatch or replay")
	}
	challengeExpiry, err := time.Parse(time.RFC3339Nano, challenge.ExpiresAt)
	if err != nil || !challengeExpiry.After(now) || len(envelope.GatewayCompletion.DeviceSignature) < 90 {
		return "", Session{}, ErrInvalid
	}
	claims, err := s.cfg.WalletVerifier.Verify(ctx, envelope)
	if err != nil {
		return "", Session{}, err
	}
	issuedAt, err := time.Parse(time.RFC3339Nano, claims.IssuedAt)
	if err != nil || claims.ExpiresAt != envelope.WalletApproval.ExpiresAt {
		return "", Session{}, ErrInvalid
	}
	token := newID("session")
	session := Session{TokenHash: hashBytes([]byte(token)), SessionBinding: claims.SessionBinding, RequestDigest: claims.RequestDigest, Account: claims.Account, Product: product, ClientID: claims.ProductClientID, BundleID: claims.BundleID, Callback: envelope.AuthorizationRequest.Callback, DeviceKey: envelope.AuthorizationRequest.ProductDeviceKey, Scopes: append([]string(nil), claims.Scopes...), IssuedAt: issuedAt, ExpiresAt: expires}
	s.mu.Lock()
	defer s.mu.Unlock()
	for nonce, expiry := range s.state.Nonces {
		if !expiry.After(s.cfg.Now()) {
			delete(s.state.Nonces, nonce)
		}
	}
	nonceKey := product + ":" + envelope.AuthorizationRequest.ProductClientID + ":" + envelope.AuthorizationRequest.Nonce
	if _, replayed := s.state.Nonces[nonceKey]; replayed {
		return "", Session{}, errors.New("Wallet assertion nonce replay rejected")
	}
	if _, exists := s.state.WalletChallenges[challenge.Challenge]; !exists {
		return "", Session{}, errors.New("canonical Wallet challenge replay rejected")
	}
	delete(s.state.WalletChallenges, challenge.Challenge)
	s.state.Nonces[nonceKey] = expires
	s.state.Sessions[session.TokenHash] = session
	if err := s.persist("session.create", claims.Account, "", map[string]any{"product": product, "clientId": claims.ProductClientID, "requestDigest": claims.RequestDigest, "sessionBinding": claims.SessionBinding, "scopes": claims.Scopes}); err != nil {
		return "", Session{}, err
	}
	return token, session, nil
}
func (s *Service) Authenticate(token string) (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.state.Sessions[hashBytes([]byte(token))]
	if !ok || !session.ExpiresAt.After(s.cfg.Now()) {
		return Session{}, ErrDenied
	}
	return session, nil
}
func (s *Service) RevokeSession(token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := hashBytes([]byte(token))
	session, ok := s.state.Sessions[h]
	if !ok {
		return ErrNotFound
	}
	delete(s.state.Sessions, h)
	return s.persist("session.revoke", session.Account, "", map[string]any{"product": session.Product})
}

func (s *Service) Health() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	version := strings.TrimSpace(s.cfg.ReleaseVersion)
	if version == "" {
		version = "1.0.0"
	}
	_, direct := s.cfg.ObjectStore.(DirectUploadStore)
	return map[string]any{"ok": true, "service": "ynx-cloudd", "version": version, "commit": strings.TrimSpace(s.cfg.ReleaseCommit), "schemaVersion": s.state.SchemaVersion, "objects": len(s.state.Objects), "activeMultipartUploads": len(s.state.MultipartUploads), "directUploads": len(s.state.DirectUploads), "presignedDirectUploadAvailable": direct, "chainId": ChainID, "evmChainId": EVMChainID, "nativeSymbol": NativeSymbol, "durability": s.cfg.ObjectStore.Boundary(), "trustBoundary": s.cfg.TrustSink.Boundary(), "maxUploadBytes": MaxUploadBytes, "maxMultipartBytes": MaxMultipartBytes, "maxMultipartParts": MaxMultipartParts, "maxDirectUploadBytes": MaxDirectUploadBytes, "multipartBoundary": "resumable bounded assembly; not provider-native streaming multipart", "quotaBytes": s.cfg.QuotaBytes}
}

func (s *Service) Liveness() map[string]any {
	version := strings.TrimSpace(s.cfg.ReleaseVersion)
	if version == "" {
		version = "1.0.0"
	}
	return map[string]any{"ok": true, "service": "ynx-cloudd", "version": version, "commit": strings.TrimSpace(s.cfg.ReleaseCommit), "source": "YNX Cloud process liveness", "asOf": s.cfg.Now()}
}
