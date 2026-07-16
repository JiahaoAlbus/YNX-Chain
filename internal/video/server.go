package video

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Authenticator interface {
	Account(*http.Request) (string, error)
}
type StaticTokenAuth struct {
	Tokens     map[string]string
	Moderators map[string]bool
}

func (a StaticTokenAuth) IsModerator(account string) bool { return a.Moderators[account] }

func (a StaticTokenAuth) Account(r *http.Request) (string, error) {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return "", ErrUnauthorized
	}
	v := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if v == "" || strings.ContainsAny(v, " \t\r\n,") {
		return "", ErrUnauthorized
	}
	account, ok := a.Tokens[v]
	if !ok {
		return "", ErrUnauthorized
	}
	return account, nil
}

type rateEntry struct {
	window time.Time
	count  int
}
type Server struct {
	service      *Service
	auth         Authenticator
	mu           sync.Mutex
	rates        map[string]rateEntry
	maxPerMinute int
}

func NewServer(s *Service, a Authenticator) *Server {
	return &Server{service: s, auth: a, rates: map[string]rateEntry{}, maxPerMinute: 120}
}
func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.serve) }
func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "no-store")
	origin := r.Header.Get("Origin")
	if origin == "http://127.0.0.1:4173" || origin == "http://127.0.0.1:4174" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.URL.Path == "/health" {
		failures := []string{}
		for name, dependency := range map[string]any{"scanner": s.service.cfg.Scanner, "processor": s.service.cfg.Processor} {
			if checker, ok := dependency.(DependencyChecker); ok {
				if err := checker.Check(); err != nil {
					failures = append(failures, name+": "+err.Error())
				}
			}
		}
		status := http.StatusOK
		if len(failures) > 0 {
			status = http.StatusServiceUnavailable
		}
		write(w, status, map[string]any{"ok": len(failures) == 0, "service": "ynx-video", "dependencies": failures, "truth": "no synthetic metrics"})
		return
	}
	if strings.HasPrefix(r.URL.Path, "/media/") {
		actor := ""
		if r.Header.Get("Authorization") != "" {
			actor, _ = s.auth.Account(r)
		}
		path, err := s.service.MediaPath(actor, strings.TrimPrefix(r.URL.Path, "/media/"))
		if err != nil {
			respond(w, nil, err)
			return
		}
		w.Header().Del("Content-Type")
		w.Header().Set("Cache-Control", "public, max-age=300")
		http.ServeFile(w, r, path)
		return
	}
	actor, err := s.auth.Account(r)
	if err != nil {
		problem(w, 401, err)
		return
	}
	if !s.allow(actor) {
		problem(w, 429, errors.New("rate limit exceeded"))
		return
	}
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/"), "/")
	parts := strings.Split(path, "/")
	switch {
	case r.Method == "POST" && path == "channels":
		var in struct{ Handle, Name string }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.EnsureChannel(actor, in.Handle, in.Name)
		respond(w, out, err)
	case r.Method == "POST" && path == "uploads":
		s.upload(w, r, actor)
	case r.Method == "GET" && path == "videos":
		out, err := s.service.Search(actor, r.URL.Query().Get("q"))
		respond(w, out, err)
	case len(parts) == 2 && parts[0] == "videos" && r.Method == "GET":
		out, err := s.service.Video(actor, parts[1])
		respond(w, out, err)
	case len(parts) == 2 && parts[0] == "channels" && r.Method == "GET":
		out, err := s.service.Channel(actor, parts[1])
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "metadata" && r.Method == "POST":
		var in struct {
			Title       string `json:"title"`
			Description string `json:"description"`
		}
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.UpdateMetadata(actor, parts[1], in.Title, in.Description))
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "retry-processing" && r.Method == "POST":
		out, err := s.service.RetryProcessing(r.Context(), actor, parts[1])
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "publish" && r.Method == "POST":
		var in struct{ Visibility Visibility }
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.Publish(actor, parts[1], in.Visibility))
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "watch" && r.Method == "POST":
		var in struct {
			Seconds   int64
			Completed bool
		}
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.RecordWatch(actor, parts[1], in.Seconds, in.Completed))
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "comments" && r.Method == "POST":
		var in struct{ Body string }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.AddComment(actor, parts[1], in.Body)
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "reports" && r.Method == "POST":
		var in struct{ Reason, Details string }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.Report(actor, parts[1], in.Reason, in.Details)
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "reports" && parts[2] == "appeals" && r.Method == "POST":
		var in struct{ Reason string }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.Appeal(actor, parts[1], in.Reason)
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "appeals" && parts[2] == "review" && r.Method == "POST":
		if !s.isModerator(actor) {
			problem(w, 403, ErrForbidden)
			return
		}
		var in struct {
			Accepted    bool   `json:"accepted"`
			Explanation string `json:"explanation"`
		}
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.ReviewAppeal(actor, parts[1], in.Accepted, in.Explanation))
	case len(parts) == 3 && parts[0] == "channels" && parts[2] == "subscription" && r.Method == "POST":
		respond(w, map[string]bool{"ok": true}, s.service.Subscribe(actor, parts[1]))
	case r.Method == "POST" && path == "playlists":
		var in struct{ Name string }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.CreatePlaylist(actor, in.Name)
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "playlists" && parts[2] == "videos" && r.Method == "POST":
		var in struct {
			VideoID string `json:"video_id"`
		}
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.AddToPlaylist(actor, parts[1], in.VideoID))
	case r.Method == "GET" && path == "studio/analytics":
		out, err := s.service.Analytics(actor)
		respond(w, out, err)
	case r.Method == "GET" && path == "studio":
		out, err := s.service.Studio(actor)
		respond(w, out, err)
	case r.Method == "GET" && path == "history":
		out, err := s.service.History(actor)
		respond(w, out, err)
	case r.Method == "GET" && path == "subscriptions":
		out, err := s.service.Subscriptions(actor)
		respond(w, out, err)
	case r.Method == "GET" && path == "playlists":
		out, err := s.service.Playlists(actor)
		respond(w, out, err)
	case r.Method == "DELETE" && path == "privacy/account-data":
		out, err := s.service.DeleteViewerData(actor)
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "comments" && r.Method == "GET":
		out, err := s.service.Comments(actor, parts[1])
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "captions" && r.Method == "POST":
		s.captions(w, r, actor, parts[1])
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "thumbnail" && r.Method == "POST":
		s.thumbnail(w, r, actor, parts[1])
	case len(parts) == 3 && parts[0] == "reports" && parts[2] == "moderate" && r.Method == "POST":
		if !s.isModerator(actor) {
			problem(w, 403, ErrForbidden)
			return
		}
		var in struct{ Decision, Explanation string }
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.ModerateReport(actor, parts[1], in.Decision, in.Explanation))
	case len(parts) == 3 && parts[0] == "videos" && parts[2] == "monetization" && r.Method == "POST":
		out, err := s.service.RequestMonetization(actor, parts[1])
		respond(w, out, err)
	case len(parts) == 4 && parts[0] == "videos" && parts[2] == "monetization" && parts[3] == "review" && r.Method == "POST":
		if !s.isModerator(actor) {
			problem(w, 403, ErrForbidden)
			return
		}
		var in struct {
			Approved bool
			Reason   string
		}
		if decode(r, &in, w) {
			return
		}
		respond(w, map[string]bool{"ok": true}, s.service.ReviewMonetization(actor, parts[1], in.Approved, in.Reason))
	case r.Method == "POST" && path == "studio/payout-intents":
		var in struct {
			AmountYNXT int64 `json:"amount_ynxt"`
		}
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.CreatePayoutIntent(r.Context(), actor, in.AmountYNXT)
		respond(w, out, err)
	case r.Method == "POST" && path == "studio/revenue":
		if !s.isModerator(actor) {
			problem(w, 403, ErrForbidden)
			return
		}
		var in struct {
			VideoID       string   `json:"video_id"`
			ReceiptID     string   `json:"receipt_id"`
			AmountYNXT    int64    `json:"amount_ynxt"`
			UsageEventIDs []string `json:"usage_event_ids"`
		}
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.RecordRevenue(r.Context(), actor, in.VideoID, in.ReceiptID, in.AmountYNXT, in.UsageEventIDs)
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "revenue" && parts[2] == "disputes" && r.Method == "POST":
		var in struct{ Reason string }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.DisputeRevenue(actor, parts[1], in.Reason)
		respond(w, out, err)
	case r.Method == "POST" && path == "ai/jobs":
		var in struct {
			VideoID        string   `json:"video_id"`
			Kind           string   `json:"kind"`
			ContextClasses []string `json:"context_classes"`
			OutputLanguage string   `json:"output_language"`
		}
		if decode(r, &in, w) {
			return
		}
		if in.OutputLanguage == "" {
			in.OutputLanguage = "en"
		}
		out, err := s.service.PrepareAIInLanguage(actor, in.VideoID, in.Kind, in.ContextClasses, in.OutputLanguage)
		respond(w, out, err)
	case r.Method == "GET" && path == "ai/status":
		write(w, 200, map[string]any{"configured": s.service.cfg.AI != nil, "mode": "server-side permissioned gateway", "automatic_actions": false})
	case len(parts) == 3 && parts[0] == "ai" && parts[1] == "jobs" && r.Method == "GET":
		out, err := s.service.GetAI(actor, parts[2])
		respond(w, out, err)
	case len(parts) == 3 && parts[0] == "ai" && parts[1] == "jobs" && r.Method == "DELETE":
		respond(w, map[string]bool{"ok": true}, s.service.DeleteAI(actor, parts[2]))
	case len(parts) == 4 && parts[0] == "ai" && parts[1] == "jobs" && parts[3] == "run" && r.Method == "POST":
		out, err := s.service.RunAI(r.Context(), actor, parts[2])
		respond(w, out, err)
	case len(parts) == 4 && parts[0] == "ai" && parts[1] == "jobs" && parts[3] == "stream" && r.Method == "POST":
		s.streamAI(w, r, actor, parts[2])
	case len(parts) == 4 && parts[0] == "ai" && parts[1] == "jobs" && parts[3] == "review" && r.Method == "POST":
		var in struct{ Apply bool }
		if decode(r, &in, w) {
			return
		}
		out, err := s.service.ReviewAI(actor, parts[2], in.Apply)
		respond(w, out, err)
	case len(parts) == 4 && parts[0] == "ai" && parts[1] == "jobs" && parts[3] == "cancel" && r.Method == "POST":
		out, err := s.service.CancelAI(actor, parts[2])
		respond(w, out, err)
	default:
		problem(w, 404, ErrNotFound)
	}
}
func (s *Server) streamAI(w http.ResponseWriter, r *http.Request, actor, jobID string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		problem(w, 500, errors.New("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	encoder := json.NewEncoder(w)
	_ = encoder.Encode(map[string]any{"state": "starting"})
	flusher.Flush()
	type result struct {
		job *AIJob
		err error
	}
	done := make(chan result, 1)
	go func() { job, err := s.service.RunAI(r.Context(), actor, jobID); done <- result{job: job, err: err} }()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	last := ""
	for {
		select {
		case <-r.Context().Done():
			return
		case out := <-done:
			if out.err != nil {
				_ = encoder.Encode(map[string]any{"state": "failed", "error": out.err.Error()})
			} else {
				_ = encoder.Encode(map[string]any{"state": out.job.State, "job": out.job})
			}
			flusher.Flush()
			return
		case <-ticker.C:
			job, err := s.service.GetAI(actor, jobID)
			if err != nil {
				continue
			}
			if strings.HasPrefix(job.Partial, last) && len(job.Partial) > len(last) {
				delta := job.Partial[len(last):]
				last = job.Partial
				_ = encoder.Encode(map[string]any{"state": job.State, "delta": delta})
				flusher.Flush()
			}
		}
	}
}
func (s *Server) isModerator(actor string) bool {
	v, ok := s.auth.(interface{ IsModerator(string) bool })
	return ok && v.IsModerator(actor)
}
func (s *Server) captions(w http.ResponseWriter, r *http.Request, actor, videoID string) {
	r.Body = http.MaxBytesReader(w, r.Body, (1<<20)+(1<<16))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		problem(w, 400, err)
		return
	}
	f, _, err := r.FormFile("captions")
	if err != nil {
		problem(w, 400, err)
		return
	}
	defer f.Close()
	size, err := strconv.ParseInt(r.FormValue("size"), 10, 64)
	if err != nil {
		problem(w, 400, err)
		return
	}
	out, err := s.service.AddCaptions(actor, videoID, r.FormValue("language"), r.FormValue("label"), r.FormValue("ai_proposed") == "true", f, size)
	respond(w, out, err)
}
func (s *Server) thumbnail(w http.ResponseWriter, r *http.Request, actor, videoID string) {
	r.Body = http.MaxBytesReader(w, r.Body, (5<<20)+(1<<16))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		problem(w, 400, err)
		return
	}
	f, h, err := r.FormFile("thumbnail")
	if err != nil {
		problem(w, 400, err)
		return
	}
	defer f.Close()
	size, err := strconv.ParseInt(r.FormValue("size"), 10, 64)
	if err != nil {
		problem(w, 400, err)
		return
	}
	respond(w, map[string]bool{"ok": true}, s.service.SetThumbnail(actor, videoID, h.Header.Get("Content-Type"), f, size))
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request, actor string) {
	r.Body = http.MaxBytesReader(w, r.Body, s.service.cfg.MaxObjectBytes+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		problem(w, 400, err)
		return
	}
	file, h, err := r.FormFile("media")
	if err != nil {
		problem(w, 400, err)
		return
	}
	defer file.Close()
	size, err := strconv.ParseInt(r.FormValue("size"), 10, 64)
	if err != nil {
		problem(w, 400, errors.New("valid size is required"))
		return
	}
	owned := r.FormValue("owned_content_declaration") == "true"
	out, err := s.service.Upload(r.Context(), actor, r.FormValue("channel_id"), UploadInput{Title: r.FormValue("title"), Description: r.FormValue("description"), Filename: h.Filename, ContentType: h.Header.Get("Content-Type"), Size: size, OwnedDeclaration: owned, Reader: file})
	respond(w, out, err)
}
func (s *Server) allow(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC().Truncate(time.Minute)
	e := s.rates[key]
	if e.window != now {
		e = rateEntry{window: now}
	}
	e.count++
	s.rates[key] = e
	return e.count <= s.maxPerMinute
}
func decode(r *http.Request, v any, w http.ResponseWriter) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		problem(w, 400, err)
		return true
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		problem(w, 400, errors.New("one JSON object required"))
		return true
	}
	return false
}
func respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		status := 400
		if errors.Is(err, ErrUnauthorized) {
			status = 401
		} else if errors.Is(err, ErrForbidden) {
			status = 403
		} else if errors.Is(err, ErrNotFound) {
			status = 404
		} else if errors.Is(err, ErrQuota) {
			status = 413
		}
		problem(w, status, err)
		return
	}
	write(w, 200, v)
}
func problem(w http.ResponseWriter, status int, err error) {
	write(w, status, map[string]string{"error": err.Error()})
}
func write(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

var _ = fmt.Sprint
