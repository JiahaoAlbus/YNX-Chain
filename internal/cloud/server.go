package cloud

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type Server struct{ service *Service }

func NewServer(service *Service) *Server { return &Server{service: service} }

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.service.Health()) })
	mux.HandleFunc("POST /api/v1/session", s.session)
	mux.HandleFunc("DELETE /api/v1/session", s.auth(s.revokeSession))
	mux.HandleFunc("GET /api/v1/objects", s.auth(s.list))
	mux.HandleFunc("POST /api/v1/objects", s.auth(s.create))
	mux.HandleFunc("GET /api/v1/objects/{id}", s.auth(s.get))
	mux.HandleFunc("PATCH /api/v1/objects/{id}", s.auth(s.updateObject))
	mux.HandleFunc("POST /api/v1/objects/{id}/duplicate", s.auth(s.duplicateObject))
	mux.HandleFunc("GET /api/v1/objects/{id}/content", s.auth(s.content))
	mux.HandleFunc("GET /api/v1/objects/{id}/export", s.auth(s.exportDocument))
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
	mux.HandleFunc("POST /api/v1/objects/{id}/comments/{thread}/resolution", s.auth(s.resolveComment))
	mux.HandleFunc("POST /api/v1/objects/{id}/presence", s.auth(s.presence))
	mux.HandleFunc("GET /api/v1/quota", s.auth(s.quota))
	mux.HandleFunc("GET /api/v1/audit", s.auth(s.audit))
	mux.HandleFunc("GET /api/v1/ai/status", s.auth(s.aiStatus))
	mux.HandleFunc("POST /api/v1/ai/jobs", s.auth(s.aiJob))
	mux.HandleFunc("GET /api/v1/ai/jobs/{job}", s.auth(s.aiGet))
	mux.HandleFunc("POST /api/v1/ai/jobs/{job}/cancel", s.auth(s.aiCancel))
	mux.HandleFunc("POST /api/v1/ai/jobs/{job}/review", s.auth(s.aiReview))
	return securityHeaders(mux)
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

func requireProduct(w http.ResponseWriter, session Session, product string) bool {
	if session.Product == product {
		return true
	}
	writeError(w, 403, "session product does not allow this action")
	return false
}

func (s *Server) authorizeObject(w http.ResponseWriter, session Session, id, genericScope, docsScope string, includeDescendants bool) (Object, bool) {
	obj, err := s.service.Get(session.Account, id)
	if err != nil {
		writeServiceError(w, err)
		return Object{}, false
	}
	containsDocs := obj.Kind == KindDoc
	if includeDescendants && obj.Kind == KindFolder {
		containsDocs, err = s.service.ContainsDocument(session.Account, id)
		if err != nil {
			writeServiceError(w, err)
			return Object{}, false
		}
	}
	if containsDocs {
		if !requireProduct(w, session, "docs") || !requireScope(w, session, docsScope) {
			return Object{}, false
		}
		return obj, true
	}
	if !requireScope(w, session, genericScope) {
		return Object{}, false
	}
	return obj, true
}

func (s *Server) session(w http.ResponseWriter, r *http.Request) {
	var a WalletAssertion
	if !decode(w, r, &a, 32<<10) {
		return
	}
	token, session, err := s.service.CreateSession(r.Context(), a)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, map[string]any{"token": token, "session": session})
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
	if !requireScope(w, a, "files.read") {
		return
	}
	objects, err := s.service.List(a.Account, ListOptions{ParentID: r.URL.Query().Get("parentId"), Query: r.URL.Query().Get("q"), View: r.URL.Query().Get("view")})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if a.Product != "docs" {
		filtered := objects[:0]
		for _, object := range objects {
			if object.Kind != KindDoc {
				filtered = append(filtered, object)
			}
		}
		objects = filtered
	}
	writeJSON(w, 200, objects)
}
func (s *Server) create(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireScope(w, a, "files.write") {
		return
	}
	var req CreateObjectRequest
	if !decode(w, r, &req, MaxUploadBytes*2) {
		return
	}
	if req.Kind == KindDoc && (!requireProduct(w, a, "docs") || !requireScope(w, a, "docs.edit")) {
		return
	}
	obj, err := s.service.Create(r.Context(), a.Account, req)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, obj)
}
func (s *Server) get(w http.ResponseWriter, r *http.Request, a Session) {
	obj, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.read", "docs.read", false)
	if !ok {
		return
	}
	writeJSON(w, 200, obj)
}
func (s *Server) updateObject(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.write", "docs.edit", true); !ok {
		return
	}
	var req UpdateObjectRequest
	if !decode(w, r, &req, 4096) {
		return
	}
	obj, err := s.service.UpdateObject(a.Account, r.PathValue("id"), req)
	writeResult(w, obj, err)
}

func (s *Server) duplicateObject(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.write", "docs.edit", true); !ok {
		return
	}
	var req DuplicateObjectRequest
	if !decode(w, r, &req, 4096) {
		return
	}
	obj, err := s.service.DuplicateObject(a.Account, r.PathValue("id"), req)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, obj)
}

func (s *Server) content(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.read", "docs.read", false); !ok {
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
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func (s *Server) exportDocument(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.read") {
		return
	}
	version, _ := strconv.Atoi(r.URL.Query().Get("version"))
	export, err := s.service.ExportDocument(a.Account, r.PathValue("id"), r.URL.Query().Get("format"), version)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	filename := strings.ReplaceAll(export.Filename, "\"", "")
	w.Header().Set("Content-Type", export.MIME)
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("X-Content-SHA256", export.SHA256)
	w.Header().Set("X-YNX-Source-SHA256", export.SourceHash)
	w.Header().Set("X-YNX-Document-Version", strconv.Itoa(export.Version))
	w.WriteHeader(200)
	_, _ = w.Write(export.Body)
}

func (s *Server) saveDocument(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.edit") {
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
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.read", "docs.read", false); !ok {
		return
	}
	v, err := s.service.Versions(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) restoreVersion(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.write", "docs.edit", false); !ok {
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
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.write", "docs.edit", false); !ok {
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
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.write", "docs.edit", true); !ok {
		return
	}
	obj, err := s.service.SetTrash(a.Account, r.PathValue("id"), true)
	writeResult(w, obj, err)
}
func (s *Server) restore(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "files.write", "docs.edit", true); !ok {
		return
	}
	obj, err := s.service.SetTrash(a.Account, r.PathValue("id"), false)
	writeResult(w, obj, err)
}

func (s *Server) grants(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
		return
	}
	g, err := s.service.Grants(a.Account, r.PathValue("id"))
	writeResult(w, g, err)
}
func (s *Server) grant(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
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
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
		return
	}
	g, err := s.service.RevokeGrant(a.Account, r.PathValue("id"), r.PathValue("grant"))
	writeResult(w, g, err)
}
func (s *Server) createLink(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
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
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
		return
	}
	v, err := s.service.Links(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) revokeLink(w http.ResponseWriter, r *http.Request, a Session) {
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
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
	w.WriteHeader(200)
	_, _ = w.Write(b)
}
func (s *Server) requestAccess(w http.ResponseWriter, r *http.Request, a Session) {
	kind, err := s.service.ObjectKind(r.PathValue("id"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if kind == KindDoc {
		if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.read") {
			return
		}
	} else if !requireScope(w, a, "files.read") {
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
	if _, ok := s.authorizeObject(w, a, r.PathValue("id"), "permissions.manage", "permissions.manage", true); !ok {
		return
	}
	v, err := s.service.AccessRequests(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) decideAccess(w http.ResponseWriter, r *http.Request, a Session) {
	objectID, err := s.service.AccessRequestObjectID(r.PathValue("request"))
	if err != nil {
		writeServiceError(w, err)
		return
	}
	if _, ok := s.authorizeObject(w, a, objectID, "permissions.manage", "permissions.manage", true); !ok {
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
	if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.read") {
		return
	}
	v, err := s.service.Comments(a.Account, r.PathValue("id"))
	writeResult(w, v, err)
}
func (s *Server) addComment(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.comment") {
		return
	}
	var req struct {
		Version  int            `json:"version"`
		Body     string         `json:"body"`
		Mentions []string       `json:"mentions"`
		ParentID string         `json:"parentId"`
		Anchor   *CommentAnchor `json:"anchor"`
	}
	if !decode(w, r, &req, 32<<10) {
		return
	}
	v, err := s.service.AddCommentThread(a.Account, r.PathValue("id"), req.Version, req.Body, req.Mentions, req.ParentID, req.Anchor)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, 201, v)
}
func (s *Server) resolveComment(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.comment") {
		return
	}
	var req struct {
		Resolved bool `json:"resolved"`
	}
	if !decode(w, r, &req, 1024) {
		return
	}
	comment, err := s.service.ResolveComment(a.Account, r.PathValue("id"), r.PathValue("thread"), req.Resolved)
	writeResult(w, comment, err)
}

func (s *Server) presence(w http.ResponseWriter, r *http.Request, a Session) {
	if !requireProduct(w, a, "docs") || !requireScope(w, a, "docs.read") {
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
	v, err := s.service.AuditForProduct(a.Account, a.Product)
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
	hasDocs, hasOther := false, false
	for _, objectID := range req.ObjectIDs {
		object, err := s.service.Get(a.Account, objectID)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		if object.Kind == KindDoc {
			hasDocs = true
		} else {
			hasOther = true
		}
	}
	if hasDocs && (!requireProduct(w, a, "docs") || !requireScope(w, a, "docs.read")) {
		return
	}
	if a.Product == "docs" && hasOther {
		writeError(w, 403, "Docs AI context is limited to selected document versions")
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
