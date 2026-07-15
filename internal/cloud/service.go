package cloud

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
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
	Now            func() time.Time
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
	s.state.Audit = append(s.state.Audit, AuditEvent{ID: newID("audit"), Actor: actor, Action: action, ObjectID: objectID, At: s.cfg.Now(), Details: details})
	if len(s.state.Audit) > 5000 {
		s.state.Audit = append([]AuditEvent(nil), s.state.Audit[len(s.state.Audit)-5000:]...)
	}
	return saveState(s.cfg.StatePath, &s.state)
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

func (s *Service) Create(ctx context.Context, actor string, req CreateObjectRequest) (Object, error) {
	if !validAccount(actor) || validateName(req.Name) != nil {
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
	obj := Object{ID: newID("obj"), Owner: actor, ParentID: req.ParentID, Kind: req.Kind, Name: strings.TrimSpace(req.Name), MIME: req.MIME, CreatedAt: now, UpdatedAt: now, Encryption: req.Encryption}
	if req.Kind != KindFolder {
		h := hashBytes(req.Content)
		path, err := writeBlob(s.cfg.ObjectDir, h, req.Content)
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
	if err := s.persist("object.create", actor, obj.ID, map[string]any{"kind": obj.Kind, "hash": obj.Hash, "clientEncrypted": obj.Encryption.ClientSide}); err != nil {
		return Object{}, err
	}
	return obj, nil
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
	path, err := writeBlob(s.cfg.ObjectDir, h, req.Content)
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
			b, err := readBlob(v.BlobPath, v.Hash)
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
				body, err := readBlob(version.BlobPath, version.Hash)
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
		b, err := readBlob(selected.BlobPath, selected.Hash)
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

func (s *Service) CreateSession(ctx context.Context, a WalletAssertion) (string, Session, error) {
	if a.ChainID != ChainID || (a.Product != "cloud" && a.Product != "docs") || !validAccount(a.Account) || len(a.Scopes) == 0 || len(a.Scopes) > 8 {
		return "", Session{}, ErrInvalid
	}
	expectedClient, expectedCallback := "com.ynx.cloud.web", "/cloud/auth/callback"
	allowed := map[string]bool{"files.read": true, "files.write": true, "permissions.manage": true, "audit.read": true, "ai.use": true}
	if a.Product == "docs" {
		expectedClient, expectedCallback = "com.ynx.docs.web", "/docs/auth/callback"
		allowed["docs.read"], allowed["docs.edit"], allowed["docs.comment"] = true, true, true
	}
	if a.ClientID != expectedClient || a.Callback != expectedCallback {
		return "", Session{}, ErrInvalid
	}
	seenScopes := map[string]bool{}
	for _, scope := range a.Scopes {
		if !allowed[scope] || seenScopes[scope] {
			return "", Session{}, ErrInvalid
		}
		seenScopes[scope] = true
	}
	expires, err := time.Parse(time.RFC3339, a.ExpiresAt)
	if err != nil || !expires.After(s.cfg.Now()) || expires.After(s.cfg.Now().Add(5*time.Minute)) {
		return "", Session{}, ErrInvalid
	}
	if a.Nonce == "" || len(a.Nonce) > 128 || a.DevicePublicKey == "" || a.Signature == "" {
		return "", Session{}, ErrInvalid
	}
	if err := s.cfg.WalletVerifier.Verify(ctx, a); err != nil {
		return "", Session{}, err
	}
	token := newID("session")
	session := Session{TokenHash: hashBytes([]byte(token)), Account: a.Account, Product: a.Product, Scopes: append([]string(nil), a.Scopes...), ExpiresAt: expires}
	s.mu.Lock()
	defer s.mu.Unlock()
	for nonce, expiry := range s.state.Nonces {
		if !expiry.After(s.cfg.Now()) {
			delete(s.state.Nonces, nonce)
		}
	}
	nonceKey := a.Product + ":" + a.ClientID + ":" + a.Nonce
	if _, replayed := s.state.Nonces[nonceKey]; replayed {
		return "", Session{}, errors.New("Wallet assertion nonce replay rejected")
	}
	s.state.Nonces[nonceKey] = expires
	s.state.Sessions[session.TokenHash] = session
	if err := s.persist("session.create", a.Account, "", map[string]any{"product": a.Product, "scopes": a.Scopes}); err != nil {
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
	return map[string]any{"ok": true, "service": "ynx-cloudd", "schemaVersion": s.state.SchemaVersion, "objects": len(s.state.Objects), "chainId": ChainID, "evmChainId": EVMChainID, "nativeSymbol": NativeSymbol, "durability": "local bounded persistent storage; not production durability", "maxUploadBytes": MaxUploadBytes, "quotaBytes": s.cfg.QuotaBytes}
}
