package mail

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
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "product": ProductID, "internet_delivery": false})
	})
	mux.HandleFunc("POST /v1/auth/challenges", s.challenge)
	mux.HandleFunc("POST /v1/auth/sessions", s.signIn)
	mux.HandleFunc("POST /v1/auth/recovery", s.recover)
	mux.HandleFunc("DELETE /v1/auth/session", s.revoke)
	mux.HandleFunc("GET /v1/messages", s.inbox)
	mux.HandleFunc("GET /v1/threads/{id}", s.thread)
	mux.HandleFunc("POST /v1/drafts", s.saveDraft)
	mux.HandleFunc("POST /v1/drafts/{id}/send", s.send)
	mux.HandleFunc("POST /v1/messages/{id}/move", s.move)
	mux.HandleFunc("POST /v1/blocks", s.block)
	mux.HandleFunc("DELETE /v1/blocks/{handle}", s.unblock)
	mux.HandleFunc("POST /v1/reports", s.report)
	mux.HandleFunc("GET /v1/reports", s.cases)
	mux.HandleFunc("POST /v1/messages/{id}/retry", s.retry)
	mux.HandleFunc("POST /v1/reports/{id}/appeal", s.appeal)
	mux.HandleFunc("POST /v1/ai/jobs", s.beginAI)
	mux.HandleFunc("POST /v1/ai/jobs/{id}/approve", s.approveAI)
	mux.HandleFunc("POST /v1/ai/jobs/{id}/review", s.reviewAI)
	mux.HandleFunc("GET /v1/ai/jobs/{id}/stream", s.streamAI)
	mux.HandleFunc("GET /v1/audit", s.audit)
	return securityHeaders(mux)
}

func (s *Server) challenge(w http.ResponseWriter, _ *http.Request) {
	c, err := s.service.NewChallenge()
	respond(w, c, err)
}
func (s *Server) signIn(w http.ResponseWriter, r *http.Request) {
	var p WalletProof
	if !decode(w, r, &p, 32<<10) {
		return
	}
	token, user, err := s.service.SignIn(r.Context(), p)
	if err != nil {
		respond(w, nil, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user})
}
func (s *Server) recover(w http.ResponseWriter, r *http.Request) {
	var p WalletProof
	if !decode(w, r, &p, 32<<10) {
		return
	}
	token, user, err := s.service.Recover(r.Context(), p)
	if err != nil {
		respond(w, nil, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user})
}
func (s *Server) revoke(w http.ResponseWriter, r *http.Request) {
	err := s.service.Revoke(bearer(r))
	respond(w, map[string]bool{"revoked": err == nil}, err)
}
func (s *Server) inbox(w http.ResponseWriter, r *http.Request) {
	v, err := s.service.Inbox(bearer(r), r.URL.Query().Get("folder"), r.URL.Query().Get("q"))
	respond(w, v, err)
}
func (s *Server) thread(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.Thread(bearer(r), r.PathValue("id"))
	respond(w, out, err)
}
func (s *Server) saveDraft(w http.ResponseWriter, r *http.Request) {
	var v Draft
	if !decode(w, r, &v, MaxMessageBytes+MaxAttachmentBytes+32<<10) {
		return
	}
	out, err := s.service.SaveDraft(bearer(r), v)
	respond(w, out, err)
}
func (s *Server) send(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.SendDraft(bearer(r), r.PathValue("id"))
	respond(w, out, err)
}
func (s *Server) move(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Folder string `json:"folder"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	err := s.service.Move(bearer(r), r.PathValue("id"), v.Folder)
	respond(w, map[string]bool{"moved": err == nil}, err)
}
func (s *Server) block(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Handle string `json:"handle"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	err := s.service.Block(bearer(r), v.Handle)
	respond(w, map[string]bool{"blocked": err == nil}, err)
}
func (s *Server) unblock(w http.ResponseWriter, r *http.Request) {
	err := s.service.Unblock(bearer(r), "@"+strings.TrimPrefix(r.PathValue("handle"), "@"))
	respond(w, map[string]bool{"unblocked": err == nil}, err)
}
func (s *Server) retry(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Recipient string `json:"recipient"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	out, err := s.service.RetryDelivery(bearer(r), r.PathValue("id"), v.Recipient)
	respond(w, out, err)
}
func (s *Server) report(w http.ResponseWriter, r *http.Request) {
	var v struct{ MessageID, Reason string }
	if !decode(w, r, &v, 2048) {
		return
	}
	out, err := s.service.Report(bearer(r), v.MessageID, v.Reason)
	respond(w, out, err)
}
func (s *Server) cases(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.Cases(bearer(r))
	respond(w, out, err)
}
func (s *Server) appeal(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Text string `json:"text"`
	}
	if !decode(w, r, &v, 2048) {
		return
	}
	out, err := s.service.Appeal(bearer(r), r.PathValue("id"), v.Text)
	respond(w, out, err)
}
func (s *Server) beginAI(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Kind       string   `json:"kind"`
		ContextIDs []string `json:"context_ids"`
	}
	if !decode(w, r, &v, 32<<10) {
		return
	}
	out, err := s.service.BeginAI(r.Context(), bearer(r), v.Kind, v.ContextIDs)
	respond(w, out, err)
}
func (s *Server) approveAI(w http.ResponseWriter, r *http.Request) {
	out, err := s.service.ApproveAI(r.Context(), bearer(r), r.PathValue("id"))
	respond(w, out, err)
}
func (s *Server) reviewAI(w http.ResponseWriter, r *http.Request) {
	var v struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, &v, 1024) {
		return
	}
	out, err := s.service.ReviewAI(bearer(r), r.PathValue("id"), v.Decision)
	respond(w, out, err)
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
		job, err := s.service.AIJob(bearer(r), r.PathValue("id"))
		if err != nil {
			fmt.Fprintf(w, "event: error\ndata: %q\n\n", err.Error())
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
	out, err := s.service.Audit(bearer(r))
	respond(w, out, err)
}

func bearer(r *http.Request) string {
	value := r.Header.Get("Authorization")
	if !strings.HasPrefix(value, "Bearer ") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
}
func decode(w http.ResponseWriter, r *http.Request, out any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request", "detail": err.Error()})
		return false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request", "detail": "request must contain one JSON value"})
		return false
	}
	return true
}
func respond(w http.ResponseWriter, value any, err error) {
	if err == nil {
		writeJSON(w, http.StatusOK, value)
		return
	}
	status := http.StatusBadRequest
	if errors.Is(err, ErrUnauthorized) {
		status = http.StatusUnauthorized
	}
	writeJSON(w, status, map[string]string{"error": http.StatusText(status), "detail": err.Error()})
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}
