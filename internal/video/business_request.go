package video

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

const videoActionProofHeader = "X-YNX-Product-Session-Action-Proof-V2"

// The unique shared Auth owner installs the concrete SDK signature/session
// verifier. HTTP input cannot install this interface or a trusted grant.
type VideoBusinessAuthority interface {
	VerifyVideoBusiness(context.Context, *http.Request, string, io.Reader, int64) (VideoBusinessGrant, error)
}
type videoBusinessActor struct {
	original Authenticator
	actor    string
}

func (a videoBusinessActor) Account(*http.Request) (string, error) { return a.actor, nil }
func (a videoBusinessActor) IsModerator(actor string) bool {
	authority, ok := a.original.(interface{ IsModerator(string) bool })
	return ok && authority.IsModerator(actor)
}
func (s *Server) serveBusinessBoundary(w http.ResponseWriter, r *http.Request) {
	canonical := r.Header.Get(productSessionProofV2Header) != "" || r.Header.Get(videoActionProofHeader) != ""
	if !canonical {
		if s.service.cfg.BusinessAuthority != nil && hasVideoCredentials(r) {
			problem(w, 401, ErrUnauthorized)
			return
		}
		s.serve(w, r)
		return
	}
	authority := s.service.cfg.BusinessAuthority
	if authority == nil {
		problem(w, 503, errors.New("Video canonical business authority is not installed"))
		return
	}
	if len(r.Header.Values(productSessionProofV2Header)) != 1 || len(r.Header.Values(videoActionProofHeader)) != 1 || len(r.Header.Values("Origin")) > 1 || r.Header.Get(productSessionProofV2Header) == "" || r.Header.Get(videoActionProofHeader) == "" || r.Header.Get("Authorization") != "" || r.Header.Get("X-YNX-Product-Session-Proof") != "" || r.Header.Get("X-YNX-Gateway-Signature") != "" {
		problem(w, 401, ErrUnauthorized)
		return
	}
	claimed, scope, err := videoBusinessRequestScope(r)
	if err != nil {
		problem(w, 401, err)
		return
	}
	limit := int64(1 << 20)
	if r.URL.Path == "/v1/uploads" {
		limit = 512 << 20
	} else if strings.HasSuffix(r.URL.Path, "/thumbnail") {
		limit = (5 << 20) + (64 << 10)
	} else if strings.HasSuffix(r.URL.Path, "/captions") {
		limit = (1 << 20) + (64 << 10)
	}
	if r.ContentLength > limit {
		problem(w, 413, errors.New("Video wire body exceeds limit"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	file, err := os.CreateTemp(s.service.store.root, ".video-business-wire-*")
	if err != nil {
		problem(w, 503, err)
		return
	}
	defer func() { file.Close(); os.Remove(file.Name()) }()
	hash := sha256.New()
	var size int64
	if r.Body != nil {
		defer func() { go r.Body.Close() }()
		size, err = copyVideoBusinessBody(ctx, file, hash, r.Body, limit)
	}
	if err != nil || size > limit || r.Method == http.MethodGet && size != 0 {
		problem(w, 400, errors.New("Video wire body is invalid"))
		return
	}
	if err = ctx.Err(); err != nil {
		problem(w, 503, err)
		return
	}
	// Reject malformed/trailing JSON before reserving the original durable intent.
	if strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") && size > 0 {
		decoder := json.NewDecoder(io.NewSectionReader(file, 0, size))
		var value json.RawMessage
		if decoder.Decode(&value) != nil || decoder.Decode(&value) != io.EOF {
			problem(w, 400, errors.New("one complete JSON object required"))
			return
		}
	}
	original := r.Clone(ctx)
	original.Body = io.NopCloser(io.NewSectionReader(file, 0, size))
	type result struct {
		grant VideoBusinessGrant
		err   error
	}
	ready := make(chan result, 1)
	go func() {
		g, e := authority.VerifyVideoBusiness(ctx, original, scope, io.NewSectionReader(file, 0, size), size)
		ready <- result{g, e}
	}()
	var grant VideoBusinessGrant
	select {
	case <-ctx.Done():
		problem(w, 503, ctx.Err())
		return
	case done := <-ready:
		grant, err = done.grant, done.err
	}
	expected := hex.EncodeToString(hash.Sum(nil))
	_, parseErr := time.Parse(time.RFC3339Nano, claimed.ExpiresAt)
	if err != nil {
		problem(w, videoBusinessErrorStatus(err), err)
		return
	}
	if parseErr != nil || grant.Actor != claimed.Account || grant.ProductID != claimed.ProductID || grant.Scope != scope || grant.SessionBinding != claimed.SessionBinding || grant.BodyDigest != expected || grant.SessionExpiresAt.IsZero() || grant.ExpiresAt.After(grant.SessionExpiresAt) {
		problem(w, 401, ErrUnauthorized)
		return
	}
	if _, err = accountaddress.Decode(grant.Actor); err != nil {
		problem(w, 401, ErrUnauthorized)
		return
	}
	scoped, err := s.service.withBusinessGrant(ctx, grant, r.Method == http.MethodGet)
	if err != nil {
		problem(w, videoBusinessErrorStatus(err), err)
		return
	}
	request := r.Clone(ctx)
	request.Body = io.NopCloser(io.NewSectionReader(file, 0, size))
	request.ContentLength = size
	child := &Server{service: scoped, auth: videoBusinessActor{s.auth, grant.Actor}, videoServerControls: s.videoServerControls, maxPerMinute: s.maxPerMinute, build: s.build}
	guarded := &videoBusinessResponse{ResponseWriter: w, service: scoped}
	child.serve(guarded, request)
}

// A canceled request settles even if its reader ignores cancellation. Closing
// the task-owned file fences any late copy; no verifier or route receives it.
func copyVideoBusinessBody(ctx context.Context, file *os.File, digest hash.Hash, body io.ReadCloser, limit int64) (int64, error) {
	type copied struct {
		size int64
		err  error
	}
	ready := make(chan copied, 1)
	go func() {
		n, err := io.Copy(io.MultiWriter(file, digest), io.LimitReader(body, limit+1))
		ready <- copied{n, err}
	}()
	select {
	case <-ctx.Done():
		file.Close()
		go body.Close()
		return 0, ctx.Err()
	case out := <-ready:
		return out.size, out.err
	}
}

// The mature device proof has the original nineteen fields, without platform.
// Infer only from the exact registered full application/origin/callback and
// bundle/package tuple. The trusted SDK still verifies the original raw header;
// this metadata routing never modifies signed bytes or creates a session.
func videoClaimedProofBinding(claimed *videoSessionV2) bool {
	// The mature proof also omits chainId. This is metadata routing only;
	// the SDK verifies the fixed chain on the actual authority Session.
	if claimed.ChainID == "" {
		claimed.ChainID = "ynx_6423-1"
	}
	if claimed.Platform != "" {
		return validVideoV2Binding(*claimed)
	}
	matches := 0
	var platform string
	for _, candidate := range []string{"web", "android", "macos"} {
		copy := *claimed
		copy.Platform = candidate
		if validVideoV2Binding(copy) {
			matches++
			platform = candidate
		}
	}
	if matches != 1 {
		return false
	}
	claimed.Platform = platform
	return true
}
func videoBusinessRequestScope(r *http.Request) (videoSessionV2, string, error) {
	var claimed videoSessionV2
	proof := r.Header.Get(productSessionProofV2Header)
	if len(proof) > 16<<10 || len(r.Header.Get(videoActionProofHeader)) > 16<<10 {
		return claimed, "", ErrUnauthorized
	}
	raw, err := base64.RawURLEncoding.DecodeString(proof)
	if err != nil || json.Unmarshal(raw, &claimed) != nil || !videoClaimedProofBinding(&claimed) || r.URL.RawPath != "" || r.URL.Fragment != "" {
		return claimed, "", ErrUnauthorized
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != claimed.Origin {
		return claimed, "", ErrUnauthorized
	}
	if r.URL.RawQuery != "" {
		q := r.URL.Query()
		if r.Method != http.MethodGet || r.URL.Path != "/v1/videos" || len(q) != 1 || len(q["q"]) != 1 || len(q.Get("q")) > 200 {
			return claimed, "", ErrUnauthorized
		}
	}
	scope := videoProductScopeV2(claimed.ProductID, r.Method, r.URL.Path)
	if scope == "" || r.Method != http.MethodGet && r.Method != http.MethodPost && r.Method != http.MethodPut && r.Method != http.MethodDelete && r.Method != http.MethodPatch {
		return claimed, "", ErrUnauthorized
	}
	return claimed, scope, nil
}

type videoBusinessResponse struct {
	http.ResponseWriter
	service         *Service
	written, denied bool
	status          int
}

func (w *videoBusinessResponse) prepare(status int) bool {
	if w.denied {
		return false
	}
	lease := w.service.store.business
	if err := lease.check(); err != nil {
		w.reject(err)
		return false
	}
	if status < 400 && !lease.consumed.Load() {
		if err := w.service.store.update(func(*State) error { return nil }); err != nil {
			w.reject(err)
			return false
		}
	}
	return true
}
func (w *videoBusinessResponse) reject(err error) {
	w.denied = true
	if !w.written {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		status := videoBusinessErrorStatus(err)
		w.ResponseWriter.WriteHeader(status)
		message := "Video business authorization is no longer current"
		if status == 503 {
			message = ErrVideoAuthorityUnavailable.Error()
		}
		json.NewEncoder(w.ResponseWriter).Encode(map[string]string{"error": message})
		w.written = true
	}
}
func (w *videoBusinessResponse) WriteHeader(status int) {
	if w.written || !w.prepare(status) {
		return
	}
	w.ResponseWriter.WriteHeader(status)
	w.status = status
	w.written = true
}
func (w *videoBusinessResponse) Write(body []byte) (int, error) {
	if !w.written {
		w.WriteHeader(200)
	}
	if !w.prepare(w.status) {
		return 0, ErrUnauthorized
	}
	return w.ResponseWriter.Write(body)
}
func (w *videoBusinessResponse) Flush() {
	if !w.written {
		w.WriteHeader(200)
	}
	if !w.prepare(w.status) {
		return
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func videoBusinessErrorStatus(err error) int {
	if errors.Is(err, ErrVideoAuthorityUnavailable) || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return http.StatusServiceUnavailable
	}
	return http.StatusUnauthorized
}
