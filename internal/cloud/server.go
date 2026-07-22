package cloud

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	service       *Service
	mu            sync.Mutex
	startedAt     time.Time
	requests      map[string]int64
	latencyMillis map[string]int64
}

func NewServer(service *Service) *Server {
	return &Server{service: service, startedAt: service.cfg.Now(), requests: map[string]int64{}, latencyMillis: map[string]int64{}}
}

type observedWriter struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (w *observedWriter) WriteHeader(status int) {
	if status >= 400 {
		w.Header().Set("X-Error-ID", newID("error"))
	}
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *observedWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	n, err := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, err
}
func (s *Server) observe(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := newID("request")
		w.Header().Set("X-Request-ID", requestID)
		ow := &observedWriter{ResponseWriter: w}
		next.ServeHTTP(ow, r)
		if ow.status == 0 {
			ow.status = 200
		}
		duration := time.Since(started)
		key := fmt.Sprintf("%s %s %d", r.Method, r.URL.Path, ow.status)
		s.mu.Lock()
		s.requests[key]++
		s.latencyMillis[key] += duration.Milliseconds()
		s.mu.Unlock()
		record := map[string]any{"level": "info", "event": "http.request", "requestId": requestID, "method": r.Method, "path": r.URL.Path, "status": ow.status, "bytes": ow.bytes, "durationMs": duration.Milliseconds()}
		encoded, _ := json.Marshal(record)
		log.Print(string(encoded))
	})
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Liveness()) })
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Liveness()) })
	mux.HandleFunc("GET /api/v1/health", s.auth(s.detailedHealth))
	mux.HandleFunc("GET /api/v1/metrics", s.auth(s.metrics))
	mux.HandleFunc("POST /api/v1/session", s.session)
	mux.HandleFunc("POST /api/v1/session/challenge", s.sessionChallenge)
	mux.HandleFunc("DELETE /api/v1/session", s.auth(s.revokeSession))
	mux.HandleFunc("GET /api/v1/objects", s.auth(s.list))
	mux.HandleFunc("POST /api/v1/objects", s.auth(s.create))
	mux.HandleFunc("POST /api/v1/multipart", s.auth(s.initiateMultipart))
	mux.HandleFunc("GET /api/v1/multipart/{upload}", s.auth(s.getMultipart))
	mux.HandleFunc("PUT /api/v1/multipart/{upload}/parts/{part}", s.auth(s.putMultipartPart))
	mux.HandleFunc("POST /api/v1/multipart/{upload}/complete", s.auth(s.completeMultipart))
	mux.HandleFunc("DELETE /api/v1/multipart/{upload}", s.auth(s.cancelMultipart))
	mux.HandleFunc("GET /api/v1/objects/{id}", s.auth(s.get))
	mux.HandleFunc("DELETE /api/v1/objects/{id}", s.auth(s.deleteObject))
	mux.HandleFunc("GET /api/v1/objects/{id}/content", s.auth(s.content))
	mux.HandleFunc("PUT /api/v1/objects/{id}/document", s.auth(s.saveDocument))
	mux.HandleFunc("GET /api/v1/objects/{id}/versions", s.auth(s.versions))
	mux.HandleFunc("POST /api/v1/objects/{id}/versions/{version}/restore", s.auth(s.restoreVersion))
	mux.HandleFunc("POST /api/v1/objects/{id}/star", s.auth(s.star))
	mux.HandleFunc("POST /api/v1/objects/{id}/trash", s.auth(s.trash))
	mux.HandleFunc("POST /api/v1/objects/{id}/restore", s.auth(s.restore))
	mux.HandleFunc("GET /api/v1/objects/{id}/grants", s.auth(s.grants))
	mux.HandleFunc("POST /api/v1/objects/{id}/grants", s.auth(s.grant))
	mux.HandleFunc("DELETE /api/v1/objects/{id}/grants/{grant}", s.auth(s.revokeGrant))
	mux.HandleFunc("POST /api/v1/objects/{id}/links", s.auth(s.createLink))
	mux.HandleFunc("GET /api/v1/objects/{id}/links", s.auth(s.links))
	mux.HandleFunc("DELETE /api/v1/objects/{id}/links/{link}", s.auth(s.revokeLink))
	mux.HandleFunc("GET /api/v1/shares/{token}", s.resolveLink)
	mux.HandleFunc("GET /api/v1/shares/{token}/content", s.resolveLinkContent)
	mux.HandleFunc("POST /api/v1/objects/{id}/access-requests", s.auth(s.requestAccess))
	mux.HandleFunc("GET /api/v1/objects/{id}/access-requests", s.auth(s.accessRequests))
	mux.HandleFunc("POST /api/v1/access-requests/{request}/decision", s.auth(s.decideAccess))
	mux.HandleFunc("GET /api/v1/objects/{id}/comments", s.auth(s.comments))
	mux.HandleFunc("POST /api/v1/objects/{id}/comments", s.auth(s.addComment))
	mux.HandleFunc("POST /api/v1/objects/{id}/presence", s.auth(s.presence))
	mux.HandleFunc("GET /api/v1/quota", s.auth(s.quota))
	mux.HandleFunc("GET /api/v1/audit", s.auth(s.audit))
	mux.HandleFunc("GET /api/v1/export", s.auth(s.exportData))
	mux.HandleFunc("GET /api/v1/deletions", s.auth(s.deletions))
	mux.HandleFunc("POST /api/v1/deletions/{deletion}/retry", s.auth(s.retryDeletion))
	mux.HandleFunc("GET /api/v1/ai/status", s.auth(s.aiStatus))
	mux.HandleFunc("POST /api/v1/ai/jobs", s.auth(s.aiJob))
	mux.HandleFunc("GET /api/v1/ai/jobs/{job}", s.auth(s.aiGet))
	mux.HandleFunc("POST /api/v1/ai/jobs/{job}/cancel", s.auth(s.aiCancel))
	mux.HandleFunc("POST /api/v1/ai/jobs/{job}/review", s.auth(s.aiReview))
	return securityHeaders(s.observe(mux))
}

func (s *Server) detailedHealth(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	writeJSON(w, 200, s.service.Health())
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, 200, map[string]any{"schemaVersion": 1, "source": "ynx-cloudd in-process counters", "asOf": s.service.cfg.Now(), "startedAt": s.startedAt, "requests": s.requests, "totalLatencyMillis": s.latencyMillis, "coverage": "current process only; reset on restart"})
}

type authed func(http.ResponseWriter, *http.Request, Session)

func (s *Server) auth(next authed) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
		if raw == "" {
			writeError(w, 401, "Sign in with YNX Wallet session required")
			return
		}
		session, err := s.service.Authenticate(raw)
		if err != nil {
			writeError(w, 401, "session expired or revoked")
			return
		}
		next(w, r, session)
	}
}

func requireScope(w http.ResponseWriter, s Session, scope string) bool {
	for _, v := range s.Scopes {
		if v == scope {
			return true
		}
	}
	writeError(w, 403, "session scope does not allow this action")
	return false
}

func requireProductScope(w http.ResponseWriter, s Session, cloudScope, docsScope string) bool {
	if s.Product == "docs" {
		return requireScope(w, s, docsScope)
	}
	return requireScope(w, s, cloudScope)
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	var envelope WalletSessionEnvelope
	if !decode(w, r, &envelope, 64<<10) {
		return
	}
	token, session, err := s.service.CreateSession(r.Context(), envelope)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"token": token, "session": session})
}

func (s *Server) sessionChallenge(w http.ResponseWriter, r *http.Request) {
	var request struct {
		AuthorizationRequest WalletAuthorizationRequest `json:"authorizationRequest"`
		WalletApproval       WalletApproval             `json:"walletApproval"`
	}
	if !decode(w, r, &request, 48<<10) {
		return
	}
	challenge, err := s.service.CreateWalletChallenge(request.AuthorizationRequest, request.WalletApproval)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, challenge)
}
func (s *Server) revokeSession(w http.ResponseWriter, r *http.Request, _ Session) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if err := s.service.RevokeSession(token); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(204)
}

func (s *Server) list(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	objects, err := s.service.List(a.Account, ListOptions{ParentID: r.URL.Query().Get("parentId"), Query: r.URL.Query().Get("q"), View: r.URL.Query().Get("view")})
	writeResult(w, objects, err)
}
func (s *Server) create(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	var req CreateObjectRequest
	if !decode(w, r, &req, MaxUploadBytes*2) {
		return
	}
	obj, err := s.service.Create(r.Context(), a.Account, req)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, obj)
}
func (s *Server) initiateMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	var req struct {
		ParentID     string     `json:"parentId"`
		Name         string     `json:"name"`
		MIME         string     `json:"mime"`
		Encryption   Encryption `json:"encryption"`
		Artifact     *Artifact  `json:"artifact"`
		ExpectedSize int64      `json:"expectedSize"`
		ExpectedHash string     `json:"expectedHash"`
	}
	if !decode(w, r, &req, 32<<10) {
		return
	}
	u, err := s.service.InitiateMultipart(a.Account, CreateObjectRequest{ParentID: req.ParentID, Kind: KindFile, Name: req.Name, MIME: req.MIME, Encryption: req.Encryption, Artifact: req.Artifact}, req.ExpectedSize, req.ExpectedHash)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, u)
}
func (s *Server) getMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	v, err := s.service.GetMultipart(a.Account, r.PathValue("upload"))
	writeResult(w, v, err)
}
func (s *Server) putMultipartPart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	n, err := strconv.Atoi(r.PathValue("part"))
	if err != nil {
		writeError(w, 400, "invalid part number")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxUploadBytes)
	b, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, 413, "multipart part exceeds bound")
		return
	}
	p, err := s.service.PutMultipartPart(r.Context(), a.Account, r.PathValue("upload"), n, b, strings.ToLower(strings.TrimSpace(r.Header.Get("X-Content-SHA256"))))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, p)
}
func (s *Server) completeMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	var req struct {
		Parts []int `json:"parts"`
	}
	if !decode(w, r, &req, 16<<10) {
		return
	}
	v, err := s.service.CompleteMultipart(r.Context(), a.Account, r.PathValue("upload"), req.Parts)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) cancelMultipart(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "cloud" || !requireScope(w, a, "files.write") {
		return
	}
	if err := s.service.CancelMultipart(a.Account, r.PathValue("upload")); err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) get(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	obj, err := s.service.Get(a.Account, r.PathValue("id"))
	writeResult(w, obj, err)
}
func (s *Server) deleteObject(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	var confirmation struct {
		Confirm string `json:"confirm"`
	}
	if !decode(w, r, &confirmation, 1024) {
		return
	}
	if confirmation.Confirm != "DELETE" {
		writeError(w, http.StatusBadRequest, "permanent deletion requires exact DELETE confirmation")
		return
	}
	if err := s.service.DeleteObject(a.Account, r.PathValue("id")); err != nil {
		var pending DeletionPendingError
		if errors.As(err, &pending) {
			writeJSON(w, http.StatusAccepted, map[string]any{"status": "logical-deletion-complete", "physicalDeletion": "pending", "pendingBlobs": pending.Count})
			return
		}
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func (s *Server) content(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	version, _ := strconv.Atoi(r.URL.Query().Get("version"))
	obj, b, err := s.service.Content(a.Account, r.PathValue("id"), version)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", obj.MIME)
	w.Header().Set("X-Content-SHA256", hashBytes(b))
	w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(obj.Name, "\"", "")+`"`)
	http.ServeContent(w, r, obj.Name, obj.UpdatedAt, bytes.NewReader(b))
}
func (s *Server) saveDocument(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "docs" || !requireScope(w, a, "documents.write") {
		return
	}
	var req SaveDocumentRequest
	if !decode(w, r, &req, MaxUploadBytes*2) {
		return
	}
	obj, err := s.service.SaveDocument(r.Context(), a.Account, r.PathValue("id"), req)
	writeResult(w, obj, err)
}
func (s *Server) versions(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	v, err := s.service.Versions(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) restoreVersion(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	n, err := strconv.Atoi(r.PathValue("version"))
	if err != nil {
		writeError(w, 400, "invalid version")
		return
	}
	obj, e := s.service.RestoreVersion(a.Account, r.PathValue("id"), n)
	writeResult(w, obj, e)
}
func (s *Server) star(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	var req struct {
		Starred bool `json:"starred"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	obj, err := s.service.SetStar(a.Account, r.PathValue("id"), req.Starred)
	writeResult(w, obj, err)
}
func (s *Server) trash(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	obj, err := s.service.SetTrash(a.Account, r.PathValue("id"), true)
	writeResult(w, obj, err)
}
func (s *Server) restore(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	obj, err := s.service.SetTrash(a.Account, r.PathValue("id"), false)
	writeResult(w, obj, err)
}

func (s *Server) grants(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	g, err := s.service.Grants(a.Account, r.PathValue("id"))
	writeResult(w, g, err)
}
func (s *Server) grant(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	var req struct {
		Principal string     `json:"principal"`
		Role      string     `json:"role"`
		ExpiresAt *time.Time `json:"expiresAt"`
	}
	if !decode(w, r, &req, 4096) {
		return
	}
	g, err := s.service.Grant(a.Account, r.PathValue("id"), req.Principal, req.Role, req.ExpiresAt)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, g)
}
func (s *Server) revokeGrant(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	g, err := s.service.RevokeGrant(a.Account, r.PathValue("id"), r.PathValue("grant"))
	writeResult(w, g, err)
}
func (s *Server) createLink(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	var req struct {
		Role      string    `json:"role"`
		ExpiresAt time.Time `json:"expiresAt"`
	}
	if !decode(w, r, &req, 4096) {
		return
	}
	l, token, err := s.service.CreateLink(a.Account, r.PathValue("id"), req.Role, req.ExpiresAt)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"link": l, "token": token})
}
func (s *Server) links(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	v, err := s.service.Links(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) revokeLink(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	l, err := s.service.RevokeLink(a.Account, r.PathValue("id"), r.PathValue("link"))
	writeResult(w, l, err)
}
func (s *Server) resolveLink(w http.ResponseWriter, r *http.Request) {
	obj, err := s.service.ResolveLink(r.PathValue("token"))
	writeResult(w, obj, err)
}
func (s *Server) resolveLinkContent(w http.ResponseWriter, r *http.Request) {
	obj, b, err := s.service.ResolveLinkContent(r.PathValue("token"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", obj.MIME)
	w.Header().Set("X-Content-SHA256", hashBytes(b))
	http.ServeContent(w, r, obj.Name, obj.UpdatedAt, bytes.NewReader(b))
}
func (s *Server) requestAccess(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	var req struct {
		Role    string `json:"role"`
		Message string `json:"message"`
	}
	if !decode(w, r, &req, 4096) {
		return
	}
	v, err := s.service.RequestAccess(a.Account, r.PathValue("id"), req.Role, req.Message)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) accessRequests(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	v, err := s.service.AccessRequests(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) decideAccess(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "permissions.manage", "sharing.manage") {
		return
	}
	var req struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	v, err := s.service.DecideAccess(a.Account, r.PathValue("request"), req.Decision)
	writeResult(w, v, err)
}

func (s *Server) comments(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	v, err := s.service.Comments(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) addComment(w http.ResponseWriter, r *http.Request, a Session) {
	if a.Product != "docs" || !requireScope(w, a, "comments.write") {
		return
	}
	var req struct {
		Version  int      `json:"version"`
		Body     string   `json:"body"`
		Mentions []string `json:"mentions"`
	}
	if !decode(w, r, &req, 32<<10) {
		return
	}
	v, err := s.service.AddComment(a.Account, r.PathValue("id"), req.Version, req.Body, req.Mentions)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) presence(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	var req struct {
		Label string `json:"label"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	v, err := s.service.Presence(a.Account, r.PathValue("id"), req.Label)
	writeResult(w, v, err)
}
func (s *Server) quota(w http.ResponseWriter, r *http.Request, a Session) {
	used, limit := s.service.Quota(a.Account)
	writeJSON(w, 200, map[string]any{"usedBytes": used, "limitBytes": limit, "claim": "bounded local product quota; not unlimited storage"})
}
func (s *Server) audit(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "audit.read") {
		return
	}
	v, err := s.service.Audit(a.Account)
	writeResult(w, v, err)
}
func (s *Server) exportData(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.read", "documents.read") {
		return
	}
	body, manifest, err := s.service.ExportOwnedData(r.Context(), a.Account)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="ynx-cloud-export.zip"`)
	w.Header().Set("X-Content-SHA256", hashBytes(body))
	w.Header().Set("X-YNX-Export-As-Of", manifest.AsOf.Format(time.RFC3339Nano))
	w.WriteHeader(200)
	_, _ = w.Write(body)
}
func (s *Server) deletions(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	v, err := s.service.BlobDeletions(a.Account)
	writeResult(w, v, err)
}
func (s *Server) retryDeletion(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProductScope(w, a, "files.write", "documents.write") {
		return
	}
	v, err := s.service.RetryBlobDeletion(r.Context(), a.Account, r.PathValue("deletion"))
	writeResult(w, v, err)
}
func (s *Server) aiStatus(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	writeJSON(w, 200, s.service.AIStatus(r.Context()))
}
func (s *Server) aiJob(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	var req struct {
		Mode        string   `json:"mode"`
		Instruction string   `json:"instruction"`
		ObjectIDs   []string `json:"objectIds"`
		Versions    []int    `json:"versions"`
		Consent     bool     `json:"consent"`
	}
	if !decode(w, r, &req, 64<<10) {
		return
	}
	v, err := s.service.CreateAIJob(r.Context(), a.Account, req.Mode, req.Instruction, req.ObjectIDs, req.Versions, req.Consent)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) aiGet(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	v, err := s.service.GetAIJob(a.Account, r.PathValue("job"))
	writeResult(w, v, err)
}
func (s *Server) aiCancel(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	v, err := s.service.CancelAIJob(a.Account, r.PathValue("job"))
	writeResult(w, v, err)
}
func (s *Server) aiReview(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "ai.use") {
		return
	}
	var req struct {
		Decision string `json:"decision"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	v, err := s.service.ReviewAI(a.Account, r.PathValue("job"), req.Decision)
	writeResult(w, v, err)
}

func decode(w http.ResponseWriter, r *http.Request, out any, max int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, max)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		writeError(w, 400, "invalid JSON request: "+err.Error())
		return false
	}
	if err := d.Decode(&struct{}{}); err != io.EOF {
		writeError(w, 400, "request must contain one JSON value")
		return false
	}
	return true
}
func writeResult(w http.ResponseWriter, v any, err error) {
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func writeServiceError(w http.ResponseWriter, err error) {
	status := 400
	var conflict ConflictError
	switch {
	case errors.As(err, &conflict):
		writeJSON(w, 409, map[string]any{"error": err.Error(), "current": conflict.Current})
		return
	case errors.Is(err, ErrDenied):
		status = 403
	case errors.Is(err, ErrNotFound):
		status = 404
	case strings.Contains(err.Error(), "quota"):
		status = 413
	case strings.Contains(err.Error(), "unavailable"):
		status = 503
	}
	writeError(w, status, err.Error())
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

// SecureHandler applies the same browser security boundary to product-local static files.
func SecureHandler(next http.Handler) http.Handler { return securityHeaders(next) }
