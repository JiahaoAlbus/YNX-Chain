package music

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// This is a server configuration boundary, never request JSON. The shared
// adapter must Authorize the original sender-bound session AND verify the
// separate exact action signature over COMPLETE actual body bytes. It must
// bind its Revalidate closure to that same original session and live actor.
// Setting this interface does not register Music or issue identity/approval.
type MusicBusinessAuthority interface {
	VerifyMusicBusiness(context.Context, *http.Request, string, io.Reader, int64) (MusicBusinessGrant, error)
}
type MusicBusinessGrant struct {
	Actor, SessionBinding, Nonce, BodyDigest string
	ExpiresAt                                time.Time
	Revalidate                               func(context.Context) error
}
type MusicBusinessNonce struct {
	BodyDigest string    `json:"bodyDigest"`
	Actor      string    `json:"actor"`
	ExpiresAt  time.Time `json:"expiresAt"`
}
type musicBusinessLease struct {
	ctx      context.Context
	grant    MusicBusinessGrant
	consumed bool
}

var musicProofNonce = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

func (l *musicBusinessLease) check(clock func() time.Time) error {
	if l == nil || l.ctx == nil || l.ctx.Err() != nil || l.grant.Revalidate == nil || !l.grant.ExpiresAt.After(clock().UTC()) {
		return ErrUnauthorized
	}
	checkCtx, cancel := context.WithTimeout(l.ctx, 15*time.Second)
	defer cancel()
	if err := l.grant.Revalidate(checkCtx); err != nil {
		return fmt.Errorf("%w: original Music authority changed", ErrUnauthorized)
	}
	if checkCtx.Err() != nil || l.ctx.Err() != nil || !l.grant.ExpiresAt.After(clock().UTC()) {
		return ErrUnauthorized
	}
	return nil
}

// Called under the ORIGINAL shared store lock on the candidate that contains
// the real business change. Failed validation/save cannot consume a nonce.
func (l *musicBusinessLease) commit(actor string, st *persistentState, clock func() time.Time) error {
	now := clock().UTC()
	if actor != l.grant.Actor || !musicProofNonce.MatchString(l.grant.Nonce) || !digestPattern.MatchString(l.grant.SessionBinding) || !validSHA256Hex(l.grant.BodyDigest) || st.BusinessClock != nil && now.Before(*st.BusinessClock) {
		return ErrUnauthorized
	}
	if err := l.check(clock); err != nil {
		return err
	}
	now = clock().UTC()
	if !l.grant.ExpiresAt.After(now) || st.BusinessClock != nil && now.Before(*st.BusinessClock) {
		return ErrUnauthorized
	}
	key := l.grant.SessionBinding + ":" + l.grant.Nonce
	if previous, ok := st.BusinessNonces[key]; ok {
		if !l.consumed || previous.Actor != actor || previous.BodyDigest != l.grant.BodyDigest {
			return ErrUnauthorized
		}
	} else {
		if l.consumed {
			return ErrUnauthorized
		}
		if st.BusinessNonces == nil {
			st.BusinessNonces = map[string]MusicBusinessNonce{}
		}
		// Only this new protocol's EXPIRED replay markers can be collected. A
		// persisted monotonic floor rejects rollback before any marker is reused.
		for id, entry := range st.BusinessNonces {
			if !entry.ExpiresAt.After(now) {
				delete(st.BusinessNonces, id)
			}
		}
		if len(st.BusinessNonces) >= 4096 {
			return fmt.Errorf("%w: Music replay capacity reached", ErrConflict)
		}
		st.BusinessNonces[key] = MusicBusinessNonce{Actor: actor, BodyDigest: l.grant.BodyDigest, ExpiresAt: l.grant.ExpiresAt}
	}
	floor := now.UTC()
	st.BusinessClock = &floor
	return nil
}
func (s *Service) requestService(lease *musicBusinessLease) *Service {
	return &Service{cfg: s.cfg, musicStateStore: s.musicStateStore, business: lease}
}

func (s *Server) businessAPI(w http.ResponseWriter, r *http.Request, scope string, next apiHandler) {
	authority := s.service.cfg.BusinessAuthority
	if authority == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Music V2 business authority is not installed"})
		return
	}
	if r.Header.Get("X-YNX-Product-Session-Proof-V2") == "" || r.Header.Get("X-YNX-Music-Business-Proof-V2") == "" || r.Header.Get("X-YNX-App-Session") != "" || r.Header.Get("X-YNX-Product-Device-Key") != "" {
		writeErr(w, ErrUnauthorized)
		return
	}
	// Streaming AI still needs its durable stream/result recovery protocol.
	// Pay and Trust use the admitted dispatch/receipt journal.
	if strings.HasPrefix(r.URL.Path, "/api/ai/proposals/") && strings.HasSuffix(r.URL.Path, "/stream") {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Music V2 external-effect recovery is not installed"})
		return
	}
	// Query strings are outside the shared action signature. Admit only the
	// original catalog's bounded search; no query may select another actor.
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) > 0 && (r.URL.Path != "/api/catalog" || len(query) != 1 || len(query["q"]) != 1 || len(query.Get("q")) > 200) {
		writeErr(w, ErrInvalid)
		return
	}
	maximum := int64(1 << 20)
	if r.URL.Path == "/api/creator/tracks" {
		maximum = s.service.cfg.MaxUploadBytes + s.service.cfg.MaxUploadBytes/4 + 1<<20
	}
	file, err := os.CreateTemp(s.service.cfg.MediaDir, ".music-v2-wire-*")
	if err != nil {
		writeErr(w, err)
		return
	}
	defer func() {
		file.Close()
		os.Remove(file.Name())
		if r.MultipartForm != nil {
			r.MultipartForm.RemoveAll()
		}
	}()
	// The shared verifier is given a bounded, context-aware COMPLETE stream. A
	// file stages those very same bytes for original parsers after verification.
	body := r.Body
	if body == nil {
		body = http.NoBody
	}
	reader := &musicBoundedBody{ctx: r.Context(), body: body, remaining: maximum + 1}
	digest := sha256.New()
	grant, err := authority.VerifyMusicBusiness(r.Context(), r, scope, io.TeeReader(reader, io.MultiWriter(file, digest)), maximum)
	if err != nil || reader.remaining <= 0 {
		writeErr(w, ErrUnauthorized)
		return
	}
	// Reject an adapter returning before EOF; incomplete signing is never usable.
	var tail [1]byte
	if n, e := reader.Read(tail[:]); n != 0 || e != io.EOF {
		writeErr(w, ErrUnauthorized)
		return
	}
	actor, err := normalizeActor(grant.Actor)
	if err != nil || actor != grant.Actor || !digestPattern.MatchString(grant.SessionBinding) || (!validSHA256Hex(grant.BodyDigest) || grant.BodyDigest != hex.EncodeToString(digest.Sum(nil))) || !musicProofNonce.MatchString(grant.Nonce) {
		writeErr(w, ErrUnauthorized)
		return
	}
	lease := &musicBusinessLease{ctx: r.Context(), grant: grant}
	if err = lease.check(s.service.cfg.Now); err != nil {
		writeErr(w, err)
		return
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		writeErr(w, err)
		return
	}
	r.Body = io.NopCloser(file)
	scoped := &Server{service: s.service.requestService(lease), build: s.build, web: s.web}
	// Private reads consume their action nonce in the original store before
	// releasing data. Mutations consume it WITH their first actual business write.
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		err = scoped.service.mutate(actor, "business_read_authorized", grant.SessionBinding, map[string]string{"path": r.URL.Path}, func(*persistentState) error { return nil })
		if err != nil {
			writeErr(w, err)
			return
		}
	}
	next(scoped, &scopedResponse{ResponseWriter: w, lease: lease, now: s.service.cfg.Now, consume: func() error {
		scoped.service.mu.RLock()
		consumed := lease.consumed
		scoped.service.mu.RUnlock()
		if consumed {
			return nil
		}
		return scoped.service.mutate(actor, "business_result_authorized", grant.SessionBinding, map[string]string{"path": r.URL.Path}, func(*persistentState) error { return nil })
	}}, r, actor)
}

type musicBoundedBody struct {
	ctx       context.Context
	body      io.Reader
	remaining int64
}

func (r *musicBoundedBody) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	if r.remaining <= 0 {
		return 0, fmt.Errorf("Music body exceeds route cap")
	}
	if int64(len(p)) > r.remaining {
		p = p[:r.remaining]
	}
	n, err := r.body.Read(p)
	r.remaining -= int64(n)
	return n, err
}

type scopedResponse struct {
	http.ResponseWriter
	lease   *musicBusinessLease
	now     func() time.Time
	denied  bool
	started bool
	consume func() error
}

func (w *scopedResponse) WriteHeader(code int) {
	if w.started {
		return
	}
	if w.lease.check(w.now) != nil || w.consume != nil && w.consume() != nil {
		w.denied = true
		code = http.StatusUnauthorized
	}
	w.started = true
	w.ResponseWriter.WriteHeader(code)
}
func (w *scopedResponse) Write(p []byte) (int, error) {
	if w.denied || w.lease.check(w.now) != nil {
		w.denied = true
		if !w.started {
			w.started = true
			w.ResponseWriter.WriteHeader(http.StatusUnauthorized)
		}
		return 0, ErrUnauthorized
	}
	if !w.started {
		w.WriteHeader(http.StatusOK)
	}
	if w.denied {
		return 0, ErrUnauthorized
	}
	return w.ResponseWriter.Write(p)
}
func (w *scopedResponse) Flush() {
	if w.denied {
		return
	}
	if w.lease.check(w.now) != nil {
		w.denied = true
		return
	}
	if !w.started {
		w.WriteHeader(http.StatusOK)
	}
	if w.denied {
		return
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
