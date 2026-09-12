package cloud

import "net/http"

func (s *Server) commentThreads(w http.ResponseWriter, r *http.Request, actor Session) {
	if !requireProductScope(w, actor, "files.read", "documents.read") {
		return
	}
	comments, err := s.service.Comments(actor.Account, r.PathValue("id"))
	writeResult(w, comments, err)
}

func (s *Server) addCommentThread(w http.ResponseWriter, r *http.Request, actor Session) {
	if !requireProductScope(w, actor, "files.write", "comments.write") {
		return
	}
	var input struct {
		Version  int            `json:"version"`
		Body     string         `json:"body"`
		Mentions []string       `json:"mentions"`
		ParentID string         `json:"parentId"`
		Anchor   *CommentAnchor `json:"anchor"`
	}
	if !decode(w, r, &input, 16384) {
		return
	}
	comment, err := s.service.AddCommentThread(actor.Account, r.PathValue("id"), input.Version, input.Body, input.Mentions, input.ParentID, input.Anchor)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, comment)
}

func (s *Server) resolveCommentThread(w http.ResponseWriter, r *http.Request, actor Session) {
	if !requireProductScope(w, actor, "files.write", "documents.write") {
		return
	}
	var input struct {
		Resolved *bool `json:"resolved"`
	}
	if !decode(w, r, &input, 1024) {
		return
	}
	if input.Resolved == nil {
		writeError(w, 400, "resolved boolean required")
		return
	}
	comment, err := s.service.ResolveComment(actor.Account, r.PathValue("id"), r.PathValue("thread"), *input.Resolved)
	writeResult(w, comment, err)
}
