package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

// References select original Browser snapshots, never arbitrary URLs or bytes.
type TaskPageReference struct {
	SelectionID string `json:"selectionId"`
	Version     string `json:"version"` // Original Browser SHA-512, not a Grant.
}
type TaskPageSnapshot struct {
	Reference  TaskPageReference `json:"reference"`
	TaskID     string            `json:"taskId"`
	TabID      string            `json:"tabId"`
	ProfileID  string            `json:"profileId"`
	Generation uint64            `json:"generation"`
	Origin     string            `json:"origin"`
	Fields     []string          `json:"fields"`
	Bytes      int               `json:"bytes"`
	SHA3_512   string            `json:"sha3_512"`
	State      string            `json:"state"` // AVAILABLE, STALE or UNAVAILABLE; never replacement bytes.
	Content    []byte            `json:"content,omitempty"`
}
type OriginalTaskPagesRequest struct {
	Session          ProductSession
	Task             TaskRecord
	References       []TaskPageReference
	QueryOriginal    bool
	AuthorizationRef string
}

// The original composition owns resource authorization, Browser task/profile
// binding and same-document checks. This consumer is not a verifier or issuer.
// Read only the selected local snapshots, return detached copies, release all
// owned borrows, and fail if authority is absent. No URL fetching is permitted.
// The existing CheckTaskModelDisclosure separately admits every outgoing byte.
type OriginalTaskPagesAuthority interface {
	ReadOriginalTaskPages(context.Context, OriginalTaskPagesRequest) ([]TaskPageSnapshot, error)
}

func validateTaskPageReferences(refs []TaskPageReference) error {
	if len(refs) > 16 {
		return errToolInvalid
	}
	seen := map[string]bool{}
	for _, r := range refs {
		h, err := hex.DecodeString(r.Version)
		if r.SelectionID == "" || len(r.SelectionID) > 128 || len(h) != 64 || err != nil || strings.ToLower(r.Version) != r.Version || seen[r.SelectionID] {
			return errToolInvalid
		}
		seen[r.SelectionID] = true
	}
	return nil
}
func taskPageReferenceBinding(refs []TaskPageReference) taskBytesBinding {
	raw, _ := json.Marshal(refs)
	return bindTaskBytes(raw)
}
func (s *Server) readTaskPages(ctx context.Context, session ProductSession, task TaskRecord, refs []TaskPageReference, auth string) ([]TaskPageSnapshot, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	if missingTaskRuntimeOperand(s.taskPages) {
		return nil, errTaskEffectSourceUnavailable
	}
	owned := append([]TaskPageReference(nil), refs...)
	pages, err := s.taskPages.ReadOriginalTaskPages(ctx, OriginalTaskPagesRequest{Session: cloneTaskModelSession(session), Task: task, References: owned, AuthorizationRef: auth, QueryOriginal: auth == ""})
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(pages)
	if err != nil || len(raw) > 256<<10 || len(pages) != len(refs) {
		return nil, errToolInvalid
	}
	// Detach slices from the producer before any validation or persistence.
	if err = json.Unmarshal(raw, &pages); err != nil {
		return nil, err
	}
	for i, p := range pages {
		if p.TaskID != task.ID || p.Reference != refs[i] || p.TabID == "" || p.ProfileID == "" || p.Generation == 0 {
			return nil, errToolConflict
		}
		origin, e := url.Parse(p.Origin)
		if e != nil || origin.Scheme != "https" && origin.Scheme != "http" || origin.Host == "" || origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || origin.Path != "" {
			return nil, errToolInvalid
		}
		seen := map[string]bool{}
		for _, f := range p.Fields {
			if f != "url" && f != "title" && f != "text" || seen[f] {
				return nil, errToolInvalid
			}
			seen[f] = true
		}
		if len(p.Fields) == 0 {
			return nil, errToolInvalid
		}
		switch p.State {
		case "AVAILABLE":
			if p.TaskID != task.ID {
				return nil, errToolConflict
			}
			if _, err := taskPageContent(p); err != nil {
				return nil, err
			}
			sum := sha512.Sum512(p.Content)
			sha3sum := sha3.Sum512(p.Content)
			if len(p.Content) != p.Bytes || hex.EncodeToString(sha3sum[:]) != p.SHA3_512 || hex.EncodeToString(sum[:]) != p.Reference.Version {
				return nil, errToolConflict
			}
		case "STALE", "UNAVAILABLE":
			if len(p.Content) != 0 {
				return nil, errToolInvalid
			}
		default:
			return nil, errToolInvalid
		}
	}
	return pages, nil
}
func (s *Store) taskRunPagesLocked(run taskModelRun) ([]TaskPageSnapshot, error) {
	if run.PagesCipher == "" {
		if run.PagesNonce != "" {
			return nil, errToolConflict
		}
		return nil, nil
	}
	raw, err := s.decrypt(run.Account, storedMessage{Message: Message{ID: run.ID + ":pages", ConversationID: run.TaskID}, Nonce: run.PagesNonce, Cipher: run.PagesCipher})
	if err != nil {
		return nil, err
	}
	var pages []TaskPageSnapshot
	err = json.Unmarshal([]byte(raw), &pages)
	if err == nil {
		refs := make([]TaskPageReference, len(pages))
		for i := range pages {
			refs[i] = pages[i].Reference
		}
		if validateTaskPageReferences(refs) != nil || taskPageReferenceBinding(refs) != run.PagesBinding {
			return nil, errToolConflict
		}
	}
	return pages, err
}
func (s *Server) checkTaskRunPages(ctx context.Context, session ProductSession, run taskModelRun, auth string) error {
	s.store.mu.Lock()
	pages, err := s.store.taskRunPagesLocked(run)
	task, taskErr := s.store.ownedTaskLocked(run.Account, run.TaskID)
	s.store.mu.Unlock()
	if err != nil {
		return err
	}
	if taskErr != nil {
		return taskErr
	}
	if len(pages) == 0 {
		return nil
	}
	if task.Revision != run.TaskRevision || task.Generation != run.Generation || task.Holder != run.Holder {
		return errToolConflict
	}
	refs := make([]TaskPageReference, len(pages))
	for i := range pages {
		refs[i] = pages[i].Reference
	}
	fresh, err := s.readTaskPages(ctx, session, task, refs, auth)
	if err != nil {
		return err
	}
	a, _ := json.Marshal(pages)
	b, _ := json.Marshal(fresh)
	if !bytes.Equal(a, b) {
		return errToolConflict
	}
	return nil
}

// Keep the original digest-bound byte encoding in encrypted storage. Only the
// model projection decodes the JSON selected fields; JSON escaping/whitespace
// must never silently change the source bytes used by the Browser version.
func renderTaskPagesForModel(pages []TaskPageSnapshot) ([]byte, error) {
	type modelPage struct {
		TaskPageSnapshot
		SelectedFields map[string]string `json:"selectedFields,omitempty"`
	}
	out := make([]modelPage, len(pages))
	for i, p := range pages {
		out[i].TaskPageSnapshot = p
		out[i].Content = nil
		if p.State == "AVAILABLE" {
			fields, err := taskPageContent(p)
			if err != nil {
				return nil, err
			}
			out[i].SelectedFields = fields
		}
	}
	return json.Marshal(out)
}

// Consume the ORIGINAL P05 selected-page payload; never reserialize its
// metadata into a new version or bind a local preparation ID to another task.
func taskPageContent(p TaskPageSnapshot) (map[string]string, error) {
	var payload struct {
		Schema     string            `json:"schema"`
		TabID      string            `json:"tabID"`
		ProfileID  string            `json:"profileID"`
		Generation string            `json:"generation"`
		Origin     string            `json:"origin"`
		TaskID     string            `json:"taskID"`
		Fields     []string          `json:"fields"`
		Content    map[string]string `json:"content"`
	}
	if rejectDuplicateShopJSON(p.Content) != nil || strictToolJSON(bytes.NewReader(p.Content), &payload) != nil || payload.Schema != "YNX_BROWSER_SELECTED_PAGE_V1" || payload.TabID != p.TabID || payload.ProfileID != p.ProfileID || payload.Generation != strconv.FormatUint(p.Generation, 10) || payload.Origin != p.Origin || payload.TaskID != p.TaskID || !slices.Equal(payload.Fields, p.Fields) || len(payload.Content) != len(p.Fields) {
		return nil, errToolConflict
	}
	for _, field := range p.Fields {
		if _, ok := payload.Content[field]; !ok {
			return nil, errToolInvalid
		}
	}
	return payload.Content, nil
}
