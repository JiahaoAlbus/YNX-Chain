package cloud

import (
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
)

// ObjectBinding describes actual stored bytes, not a read grant or billing proof.
// Existing SHA-256 addresses stay intact; legacy entries acquire no new trust.
type ObjectBinding struct {
	Bytes   int64  `json:"bytes,string"`
	SHA3512 string `json:"sha3_512"`
	SHA512  string `json:"sha512"`
}

var errObjectCommitUnknown = errors.New("object metadata commit unknown; reconcile original state before writing")

func bindObjectBytes(body []byte) ObjectBinding {
	a, b := sha3.Sum512(body), sha512.Sum512(body)
	return ObjectBinding{Bytes: int64(len(body)), SHA3512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(b[:])}
}

func objectRevision(object Object) uint64 {
	if object.Revision != 0 {
		return object.Revision
	}
	if object.Version > 0 {
		return uint64(object.Version)
	}
	return 0
}

func syncObjectDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func snapshotObjectState(state persistentState) ([]byte, error) { return json.Marshal(state) }

func (s *Service) persistObjectState(before []byte, action, actor, id string, details map[string]any) error {
	if err := s.persist(action, actor, id, details); err != nil {
		if errors.Is(err, errObjectCommitUnknown) {
			// Rename may already be visible. Do not roll back or replay that effect.
			s.objectWriteErr = err
			return err
		}
		var original persistentState
		if decodeErr := json.Unmarshal(before, &original); decodeErr != nil {
			s.objectWriteErr = errors.Join(errObjectCommitUnknown, err, decodeErr)
			return s.objectWriteErr
		}
		s.state = original
		return err
	}
	return nil
}

type objectContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r objectContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.reader.Read(p)
	if cancel := r.ctx.Err(); cancel != nil {
		return n, cancel
	}
	return n, err
}

func readObjectInput(ctx context.Context, reader io.Reader) ([]byte, ObjectBinding, error) {
	if ctx == nil || reader == nil {
		return nil, ObjectBinding{}, ErrInvalid
	}
	var body bytes.Buffer
	a, b := sha3.New512(), sha512.New()
	n, err := io.CopyBuffer(io.MultiWriter(&body, a, b), io.LimitReader(objectContextReader{ctx, reader}, MaxUploadBytes+1), make([]byte, 32<<10))
	if err != nil {
		return nil, ObjectBinding{}, err
	}
	if n > MaxUploadBytes {
		return nil, ObjectBinding{}, errors.New("object upload exceeds quota bound")
	}
	if err = ctx.Err(); err != nil {
		return nil, ObjectBinding{}, err
	}
	return body.Bytes(), ObjectBinding{n, hex.EncodeToString(a.Sum(nil)), hex.EncodeToString(b.Sum(nil))}, nil
}

// PutObjectVersion reuses the original object identity, owner/product namespace,
// ACL and snapshot authority. Exactly one expected revision can advance it.
// No provider/Source admission is inferred from a local storage result.
func (s *Service) PutObjectVersion(ctx context.Context, actor, id string, expectedRev uint64, input io.Reader, expected *ObjectBinding) (Object, error) {
	return s.saveObjectContent(ctx, actor, id, &expectedRev, 0, input, expected, KindFile)
}

func (s *Service) saveObjectContent(ctx context.Context, actor, id string, expectedRev *uint64, expectedVersion int, input io.Reader, expected *ObjectBinding, kind ObjectKind) (Object, error) {
	if ctx == nil {
		return Object{}, ErrInvalid
	}
	s.mu.Lock()
	initial, err := s.require(actor, id, 2)
	if err == nil && (initial.Kind != kind || initial.TrashedAt != nil || (kind == KindDoc && initial.Encryption.ClientSide)) {
		err = ErrInvalid
	}
	if err == nil && ((expectedRev != nil && (*expectedRev == 0 || objectRevision(initial) != *expectedRev)) || (expectedRev == nil && expectedVersion != initial.Version)) {
		err = ConflictError{Current: initial}
	}
	if err == nil && s.objectWriteErr != nil {
		err = s.objectWriteErr
	}
	s.mu.Unlock()
	if err != nil {
		return Object{}, err
	}
	body, binding, err := readObjectInput(ctx, input)
	if err != nil {
		return Object{}, err
	}
	if expected != nil && *expected != binding {
		return Object{}, errors.New("object dual digest or length mismatch")
	}
	mime := initial.MIME
	if kind == KindDoc {
		mime = "text/plain"
	}
	if err = s.cfg.Scanner.Scan(ctx, initial.Name, mime, body); err != nil {
		return Object{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	if obj.TrashedAt != nil || obj.Kind != kind {
		return Object{}, ErrInvalid
	}
	if objectRevision(obj) != objectRevision(initial) || obj.Version != initial.Version {
		return Object{}, ConflictError{Current: obj}
	}
	if s.objectWriteErr != nil {
		return Object{}, s.objectWriteErr
	}
	if err = ctx.Err(); err != nil {
		return Object{}, err
	}
	if objectRevision(obj) == ^uint64(0) || obj.Version == int(^uint(0)>>1) {
		return Object{}, ErrInvalid
	}
	hash := hashBytes(body)
	if s.usedLocked(obj.Owner)+s.additionalLocked(obj.Owner, obj.Product, hash, int64(len(body))) > s.cfg.QuotaBytes {
		return Object{}, errors.New("storage quota exceeded")
	}
	before, err := snapshotObjectState(s.state)
	if err != nil {
		return Object{}, err
	}
	// Editors write the original OWNER namespace, never their own dedup/quota.
	ref, err := s.putObjectBlob(ctx, obj.Owner, obj.Product, hash, body)
	if err != nil {
		return Object{}, err
	}
	if err = ctx.Err(); err != nil {
		return Object{}, err
	}
	s.settleStorageLocked(obj.Owner, obj.Product)
	obj.Revision = objectRevision(obj) + 1
	obj.Version++
	obj.Hash, obj.Size, obj.MIME, obj.UpdatedAt = hash, binding.Bytes, mime, s.cfg.Now()
	obj.Binding, obj.ScanStatus = &binding, "accepted"
	obj.StorageClass, obj.StorageClassVersion, obj.StorageReadMode, obj.StorageClassUpdatedAt = StorageClassHot, 1, StorageReadImmediate, nil
	s.state.Objects[id] = obj
	s.state.Versions[id] = append(s.state.Versions[id], Version{ObjectID: id, Number: obj.Version, Hash: hash, Binding: &binding, Size: obj.Size, MIME: mime, BlobPath: ref, Author: actor, CreatedAt: obj.UpdatedAt, StorageClass: StorageClassHot, StorageClassVersion: 1, StorageReadMode: StorageReadImmediate})
	s.meterLocked(obj.Owner, obj.Product, obj.Size, 0, obj.Size, 0, 0)
	if err = s.persistObjectState(before, "object.version.put", actor, id, map[string]any{"version": obj.Version, "revision": strconv.FormatUint(obj.Revision, 10), "binding": binding}); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func (s *Service) GetObjectVersion(ctx context.Context, actor, id string, number int) (Object, []byte, error) {
	if ctx == nil || number < 0 {
		return Object{}, nil, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 1)
	if err != nil {
		return Object{}, nil, err
	}
	if obj.Kind == KindFolder {
		return Object{}, nil, ErrInvalid
	}
	if number == 0 {
		number = obj.Version
	}
	for _, version := range s.state.Versions[id] {
		if version.Number == number {
			return s.readObjectVersionLocked(ctx, obj, version)
		}
	}
	return Object{}, nil, ErrNotFound
}

func (s *Service) readObjectVersionLocked(ctx context.Context, obj Object, version Version) (Object, []byte, error) {
	if err := ctx.Err(); err != nil {
		return Object{}, nil, err
	}
	if normalizedVersionReadMode(version) == StorageReadRestoreRequired {
		return Object{}, nil, ErrArchiveRestoreRequired
	}
	body, err := s.cfg.ObjectStore.Get(ctx, version.BlobPath, version.Hash)
	if err != nil {
		return Object{}, nil, err
	}
	if err = ctx.Err(); err != nil {
		return Object{}, nil, err
	}
	binding := bindObjectBytes(body)
	if binding.Bytes != version.Size || hashBytes(body) != version.Hash || (version.Binding != nil && *version.Binding != binding) {
		return Object{}, nil, errors.New("object version integrity mismatch")
	}
	if err := ctx.Err(); err != nil {
		return Object{}, nil, err
	}
	obj.Version, obj.Size, obj.Hash, obj.MIME, obj.UpdatedAt = version.Number, version.Size, version.Hash, version.MIME, version.CreatedAt
	obj.Binding = &binding
	syncObjectStorageSummary(&obj, version)
	return obj, body, nil
}

func (s *Service) RestoreObjectVersion(ctx context.Context, actor, id string, historical int, expectedRev uint64) (Object, error) {
	return s.restoreObjectVersion(ctx, actor, id, historical, &expectedRev)
}

func (s *Service) restoreObjectVersion(ctx context.Context, actor, id string, historical int, expectedRev *uint64) (Object, error) {
	if ctx == nil || historical < 1 {
		return Object{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 2)
	if err != nil {
		return Object{}, err
	}
	if s.objectWriteErr != nil {
		return Object{}, s.objectWriteErr
	}
	if obj.Kind == KindFolder || obj.TrashedAt != nil {
		return Object{}, ErrInvalid
	}
	if expectedRev != nil && (*expectedRev == 0 || objectRevision(obj) != *expectedRev) {
		return Object{}, ConflictError{Current: obj}
	}
	if objectRevision(obj) == ^uint64(0) || obj.Version == int(^uint(0)>>1) {
		return Object{}, ErrInvalid
	}
	for _, source := range s.state.Versions[id] {
		if source.Number != historical {
			continue
		}
		verified, _, err := s.readObjectVersionLocked(ctx, obj, source)
		if err != nil {
			return Object{}, err
		}
		before, err := snapshotObjectState(s.state)
		if err != nil {
			return Object{}, err
		}
		if err := ctx.Err(); err != nil {
			return Object{}, err
		}
		obj.Revision = objectRevision(obj) + 1
		obj.Version++
		obj.Hash, obj.Size, obj.MIME, obj.Binding, obj.UpdatedAt = source.Hash, source.Size, source.MIME, verified.Binding, s.cfg.Now()
		syncObjectStorageSummary(&obj, source)
		s.state.Objects[id] = obj
		source.Number, source.Author, source.CreatedAt, source.Binding, source.RestoredFrom = obj.Version, actor, obj.UpdatedAt, verified.Binding, historical
		s.state.Versions[id] = append(s.state.Versions[id], source)
		if err = s.persistObjectState(before, "version.restore", actor, id, map[string]any{"sourceVersion": historical, "version": obj.Version}); err != nil {
			return Object{}, err
		}
		return obj, nil
	}
	return Object{}, ErrNotFound
}

// SetShareAccess changes the existing authoritative ACL. role() reads it on
// every access; no old session or bearer link can synthesize a principal grant.
func (s *Service) SetShareAccess(ctx context.Context, actor, id, target string, allow bool, expectedRev uint64) (Object, error) {
	if ctx == nil || !validAccount(target) {
		return Object{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	obj, err := s.require(actor, id, 3)
	if err != nil {
		return Object{}, err
	}
	if obj.Owner == target {
		return Object{}, ErrInvalid
	}
	if objectRevision(obj) != expectedRev || expectedRev == 0 {
		return Object{}, ConflictError{Current: obj}
	}
	if s.objectWriteErr != nil {
		return Object{}, s.objectWriteErr
	}
	if err = ctx.Err(); err != nil {
		return Object{}, err
	}
	if expectedRev == ^uint64(0) {
		return Object{}, ErrInvalid
	}
	before, err := snapshotObjectState(s.state)
	if err != nil {
		return Object{}, err
	}
	now := s.cfg.Now()
	for key, grant := range s.state.Grants {
		if grant.ObjectID == id && grant.Principal == target && grant.RevokedAt == nil {
			grant.RevokedAt = &now
			s.state.Grants[key] = grant
		}
	}
	role := "denied"
	if allow {
		role = "viewer"
	}
	grant := Grant{ID: newID("grant"), ObjectID: id, Principal: target, Role: role, CreatedBy: actor, CreatedAt: now}
	s.state.Grants[grant.ID] = grant
	obj.Revision = expectedRev + 1
	s.state.Objects[id] = obj
	if err = s.persistObjectState(before, "permission.set", actor, id, map[string]any{"principal": target, "allow": allow}); err != nil {
		return Object{}, err
	}
	return obj, nil
}

func setObjectBindingHeaders(w http.ResponseWriter, obj Object) {
	if obj.Binding != nil {
		w.Header().Set("X-Content-SHA3-512", obj.Binding.SHA3512)
		w.Header().Set("X-Content-SHA512", obj.Binding.SHA512)
		w.Header().Set("X-Object-Bytes", strconv.FormatInt(obj.Binding.Bytes, 10))
	}
	w.Header().Set("X-Object-Version", strconv.Itoa(obj.Version))
	w.Header().Set("X-Object-Revision", strconv.FormatUint(objectRevision(obj), 10))
}

func objectExpectedRevision(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	raw := r.Header.Get("X-Expected-Revision")
	if raw == "" {
		writeError(w, http.StatusPreconditionRequired, "X-Expected-Revision is required")
		return 0, false
	}
	value, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || value == 0 || strconv.FormatUint(value, 10) != raw {
		writeError(w, 400, "invalid expected revision")
		return 0, false
	}
	return value, true
}

func (s *Server) putObjectVersion(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	revision, ok := objectExpectedRevision(w, r)
	if !ok {
		return
	}
	var expected *ObjectBinding
	left, right := r.Header.Get("X-Content-SHA3-512"), r.Header.Get("X-Content-SHA512")
	if left != "" || right != "" {
		if len(left) != 128 || len(right) != 128 || r.ContentLength < 0 {
			writeError(w, 400, "both digests and content length required")
			return
		}
		expected = &ObjectBinding{r.ContentLength, left, right}
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)
	obj, err := s.service.PutObjectVersion(r.Context(), a.Account, r.PathValue("id"), revision, r.Body, expected)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	setObjectBindingHeaders(w, obj)
	writeJSON(w, http.StatusCreated, obj)
}

func (s *Server) setShareAccess(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "permissions.manage") {
		return
	}
	revision, ok := objectExpectedRevision(w, r)
	if !ok {
		return
	}
	var input struct {
		Allow *bool `json:"allow"`
	}
	if !decode(w, r, &input, 1024) {
		return
	}
	if input.Allow == nil {
		writeError(w, 400, "allow is required")
		return
	}
	obj, err := s.service.SetShareAccess(r.Context(), a.Account, r.PathValue("id"), r.PathValue("target"), *input.Allow, revision)
	writeResult(w, obj, err)
}
