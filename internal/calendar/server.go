package calendar

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Server struct{ service *Service }

func NewHandler(service *Service) http.Handler {
	s := &Server{service: service}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "product": ProductID, "production_scheduling": false})
	})
	mux.HandleFunc("POST /v1/auth/challenges", s.challenge)
	mux.HandleFunc("POST /v1/auth/sessions", s.signIn)
	mux.HandleFunc("POST /v1/auth/recovery", s.recover)
	mux.HandleFunc("DELETE /v1/auth/session", s.revoke)
	mux.HandleFunc("GET /v1/events", s.events)
	mux.HandleFunc("GET /v1/events/{id}", s.event)
	mux.HandleFunc("POST /v1/events/preview", s.previewCreate)
	mux.HandleFunc("POST /v1/events/{id}/preview", s.previewUpdate)
	mux.HandleFunc("POST /v1/events/{id}/cancel-preview", s.previewCancel)
	mux.HandleFunc("POST /v1/changes/{id}/approve", s.approve)
	mux.HandleFunc("POST /v1/changes/{id}/revert", s.revert)
	mux.HandleFunc("POST /v1/events/{id}/rsvp", s.rsvp)
	mux.HandleFunc("POST /v1/events/{id}/share", s.share)
	mux.HandleFunc("DELETE /v1/events/{id}/share/{handle}", s.unshare)
	mux.HandleFunc("POST /v1/ai/jobs", s.beginAI)
	mux.HandleFunc("POST /v1/ai/jobs/{id}/approve", s.approveAI)
	mux.HandleFunc("POST /v1/ai/jobs/{id}/review", s.reviewAI)
	mux.HandleFunc("GET /v1/ai/jobs/{id}/stream", s.streamAI)
	mux.HandleFunc("GET /v1/audit", s.audit)
	mux.HandleFunc("GET /v1/reminders", s.reminders)
	return headers(mux)
}
func (s *Server) challenge(w http.ResponseWriter, _ *http.Request) {
	v, e := s.service.NewChallenge()
	respond(w, v, e)
}
func (s *Server) signIn(w http.ResponseWriter, r *http.Request) {
	var v WalletProof
	if !decode(w, r, &v, 32<<10) {
		return
	}
	token, user, e := s.service.SignIn(r.Context(), v)
	if e != nil {
		respond(w, nil, e)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user})
}
func (s *Server) recover(w http.ResponseWriter, r *http.Request) {
	var v WalletProof
	if !decode(w, r, &v, 32<<10) {
		return
	}
	token, user, e := s.service.Recover(r.Context(), v)
	if e != nil {
		respond(w, nil, e)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user})
}
func (s *Server) revoke(w http.ResponseWriter, r *http.Request) {
	e := s.service.Revoke(bearer(r))
	respond(w, map[string]bool{"revoked": e == nil}, e)
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	from, e := time.Parse(time.RFC3339, r.URL.Query().Get("from"))
	if e != nil {
		from = time.Now().AddDate(0, -1, 0)
	}
	to, e := time.Parse(time.RFC3339, r.URL.Query().Get("to"))
	if e != nil {
		to = time.Now().AddDate(0, 3, 0)
	}
	v, e := s.service.Events(bearer(r), from, to)
	respond(w, v, e)
}
func (s *Server) event(w http.ResponseWriter, r *http.Request) {
	out, e := s.service.Event(bearer(r), r.PathValue("id"))
	respond(w, out, e)
}
func (s *Server) previewCreate(w http.ResponseWriter, r *http.Request) {
	var v EventInput
	if !decode(w, r, &v, 32<<10) {
		return
	}
	out, e := s.service.PreviewCreate(bearer(r), v)
	respond(w, out, e)
}
func (s *Server) previewUpdate(w http.ResponseWriter, r *http.Request) {
	var v EventInput
	if !decode(w, r, &v, 32<<10) {
		return
	}
	out, e := s.service.PreviewUpdate(bearer(r), r.PathValue("id"), v)
	respond(w, out, e)
}
func (s *Server) previewCancel(w http.ResponseWriter, r *http.Request) {
	var v struct {
		ClientMutationID string `json:"client_mutation_id"`
		BaseVersion      int    `json:"base_version"`
	}
	if !decode(w, r, &v, 2048) {
		return
	}
	out, e := s.service.PreviewCancel(bearer(r), r.PathValue("id"), v.ClientMutationID, v.BaseVersion)
	respond(w, out, e)
}
func (s *Server) approve(w http.ResponseWriter, r *http.Request) {
	var v struct {
		AcceptConflicts bool `json:"accept_conflicts"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	out, e := s.service.ApproveChange(bearer(r), r.PathValue("id"), v.AcceptConflicts)
	respond(w, out, e)
}
func (s *Server) revert(w http.ResponseWriter, r *http.Request) {
	out, e := s.service.RevertChange(bearer(r), r.PathValue("id"))
	respond(w, out, e)
}
func (s *Server) rsvp(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Response string `json:"response"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	out, e := s.service.RSVP(bearer(r), r.PathValue("id"), v.Response)
	respond(w, out, e)
}
func (s *Server) share(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Handle string `json:"handle"`
		Role   string `json:"role"`
	}
	if !decode(w, r, &v, 2048) {
		return
	}
	out, e := s.service.Share(bearer(r), r.PathValue("id"), v.Handle, v.Role)
	respond(w, out, e)
}
func (s *Server) unshare(w http.ResponseWriter, r *http.Request) {
	out, e := s.service.Unshare(bearer(r), r.PathValue("id"), "@"+strings.TrimPrefix(r.PathValue("handle"), "@"))
	respond(w, out, e)
}
func (s *Server) beginAI(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Kind     string   `json:"kind"`
		EventIDs []string `json:"event_ids"`
	}
	if !decode(w, r, &v, 32<<10) {
		return
	}
	out, e := s.service.BeginAI(r.Context(), bearer(r), v.Kind, v.EventIDs)
	respond(w, out, e)
}
func (s *Server) approveAI(w http.ResponseWriter, r *http.Request) {
	out, e := s.service.ApproveAI(r.Context(), bearer(r), r.PathValue("id"))
	respond(w, out, e)
}
func (s *Server) reviewAI(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	out, e := s.service.ReviewAI(bearer(r), r.PathValue("id"), v.Decision)
	respond(w, out, e)
}
func (s *Server) streamAI(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		respond(w, nil, errors.New("streaming unavailable"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	last := ""
	ticker := time.NewTicker(150 * time.Millisecond)
	defer ticker.Stop()
	for {
		job, e := s.service.AIJob(bearer(r), r.PathValue("id"))
		if e != nil {
			fmt.Fprintf(w, "event: error\ndata: %q\n\n", e.Error())
			flusher.Flush()
			return
		}
		if job.State != last {
			body, _ := json.Marshal(job)
			fmt.Fprintf(w, "event: state\ndata: %s\n\n", body)
			flusher.Flush()
			last = job.State
		}
		if job.State != "preview" && job.State != "running" {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) audit(w http.ResponseWriter, r *http.Request) {
	out, e := s.service.Audit(bearer(r))
	respond(w, out, e)
}
func (s *Server) reminders(w http.ResponseWriter, r *http.Request) {
	out, e := s.service.Notifications(bearer(r))
	respond(w, out, e)
}
func bearer(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if !strings.HasPrefix(v, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(v, "Bearer "))
}
func decode(w http.ResponseWriter, r *http.Request, out any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request", "detail": e.Error()})
		return false
	}
	if e := d.Decode(&struct{}{}); !errors.Is(e, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request", "detail": "request must contain one JSON value"})
		return false
	}
	return true
}
func respond(w http.ResponseWriter, v any, e error) {
	if e == nil {
		writeJSON(w, http.StatusOK, v)
		return
	}
	status := http.StatusBadRequest
	if errors.Is(e, ErrUnauthorized) {
		status = http.StatusUnauthorized
	}
	if errors.Is(e, ErrVersionConflict) {
		status = http.StatusConflict
	}
	writeJSON(w, status, map[string]string{"error": http.StatusText(status), "detail": e.Error()})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func headers(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}
