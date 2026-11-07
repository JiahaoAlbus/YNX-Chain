package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"
)

// Product-local operands, not a V6 wire grammar, signature or Auth admission.
// Original Auth must verify its session/current/nonce before this source is used.
type TaskActionCall struct {
	OriginalOperationID string
	RequestRef          string
	RequestDigest       string // exact opaque SDK digest representation from original Auth
	BodyDigest          string // SHA256(raw request body) from that same SDK projection
	Action              string
	Method              string
	Path                string
	Body                []byte
}
type TaskActionBytesBinding = taskBytesBinding

func BindTaskActionBytes(body []byte) TaskActionBytesBinding { return bindTaskBytes(body) }

type TaskActionOutcomeView struct {
	OriginalOperationID string                 `json:"originalOperationId"`
	RequestRef          string                 `json:"requestRef"`
	OriginalRef         string                 `json:"originalRef"`
	ConversationID      string                 `json:"conversationId"`
	RequestDigest       string                 `json:"requestDigest"`
	Action              string                 `json:"action"`
	Method              string                 `json:"method"`
	Path                string                 `json:"path"`
	Principal           TaskStorePrincipal     `json:"principal"`
	RequestBody         TaskActionBytesBinding `json:"requestBody"`
	RequestBodySHA256   string                 `json:"requestBodySha256"`
	TaskID              string                 `json:"taskId"`
	HolderBefore        string                 `json:"holderBefore"`
	HolderAfter         string                 `json:"holderAfter"`
	RevisionBefore      uint64                 `json:"revisionBefore"`
	GenerationBefore    uint64                 `json:"generationBefore"`
	RevisionAfter       uint64                 `json:"revisionAfter"`
	GenerationAfter     uint64                 `json:"generationAfter"`
	State               string                 `json:"state"`
	Scope               string                 `json:"scope"`
	HTTPStatus          int                    `json:"httpStatus"`
	BodyDigest          TaskActionBytesBinding `json:"bodyDigest"`
	CommittedAt         time.Time              `json:"committedAt"`
}
type taskActionStoredPayload struct {
	View TaskActionOutcomeView `json:"view"`
	Body []byte                `json:"body"`
}

type storedTaskActionOutcome struct {
	View       TaskActionOutcomeView `json:"view"`
	BodyNonce  string                `json:"bodyNonce,omitempty"`
	BodyCipher string                `json:"bodyCipher,omitempty"`
}

// Only actual execution or original stored readback can construct this value.
// A product commit receipt never qualifies an external tool, Grant or payment.
type taskActionOutcomeIndex map[string]string

func taskOutcomeFingerprint(record storedTaskActionOutcome) string {
	raw, _ := json.Marshal(record)
	h := sha256.Sum256(raw)
	return hex.EncodeToString(h[:])
}
func (s *Store) refreshTaskOutcomeIndexLocked() {
	next := taskActionOutcomeIndex{}
	for key, record := range s.state.TaskActionOutcomes {
		v := record.View
		task, exists := s.state.Tasks[v.TaskID]
		conversation, owns := s.state.Conversations[v.ConversationID]
		committed := exists && task.Account == v.Principal.Account && task.ConversationID == v.ConversationID && v.State == "COMMITTED" && record.BodyNonce != "" && record.BodyCipher != ""
		if owns && conversation.Account == v.Principal.Account && (committed || v.State == "PENDING") && v.OriginalRef == key && key == taskActionKey(v.Principal, v.OriginalOperationID) {
			next[key] = taskOutcomeFingerprint(record)
		}
	}
	s.taskOutcomeIndex.Store(&next)
}

type TaskActionOutcomeReceipt struct {
	source           *TaskStoreSource
	ctx              context.Context
	key, fingerprint string
	released         atomic.Bool
	view             TaskActionOutcomeView
	body             []byte
	receiptOriginal  []byte
}

var ErrTaskActionOutcomeUnknown = errors.New("original task action has no verified product commit; query the original operation, do not replay")

// Current proves that the original durable outcome remains present. It is not
// current task-holder authority: Auth must AND TaskStoreSnapshot and its own
// live session/policy/Grant fences separately, especially before activation.
func (r *TaskActionOutcomeReceipt) Current() error {
	if r == nil || r.source == nil || r.source.store == nil || r.released.Load() || r.source.retired.Load() {
		return ErrTaskActionOutcomeUnknown
	}
	if err := r.ctx.Err(); err != nil {
		return err
	}
	index := r.source.store.taskOutcomeIndex.Load()
	if index == nil || (*index)[r.key] != r.fingerprint {
		return ErrTaskActionOutcomeUnknown
	}
	return nil
}
func (r *TaskActionOutcomeReceipt) View() (TaskActionOutcomeView, error) {
	if err := r.Current(); err != nil {
		return TaskActionOutcomeView{}, err
	}
	return r.view, nil
}
func (r *TaskActionOutcomeReceipt) Body() ([]byte, error) {
	if err := r.Current(); err != nil {
		return nil, err
	}
	return bytes.Clone(r.body), nil
}
func (r *TaskActionOutcomeReceipt) Release() {
	if r != nil {
		r.released.Store(true)
	}
}
func (r *TaskActionOutcomeReceipt) Close() error { r.Release(); return nil }
func taskActionKey(p TaskStorePrincipal, op string) string {
	h := sha256.Sum256([]byte(p.Account + "\x00" + op))
	return hex.EncodeToString(h[:])
}
func boundedTaskActionOperand(v string) bool {
	return v != "" && len(v) <= 4096 && utf8.ValidString(v) && strings.IndexFunc(v, unicode.IsControl) < 0
}
func validTaskActionCall(call TaskActionCall) bool {
	if len(call.Body) == 0 || len(call.Body) > 32<<10 {
		return false
	}
	sum := sha256.Sum256(call.Body)
	return boundedTaskActionOperand(call.OriginalOperationID) && boundedTaskActionOperand(call.RequestRef) && boundedTaskActionOperand(call.RequestDigest) && call.Method == http.MethodPost && len(call.Body) > 0 && len(call.Body) <= 32<<10 && call.BodyDigest == hex.EncodeToString(sum[:])
}
func taskActionMatches(v TaskActionOutcomeView, p TaskStorePrincipal, call TaskActionCall) bool {
	return v.Principal == p && v.OriginalOperationID == call.OriginalOperationID && v.RequestRef == call.RequestRef && v.RequestDigest == call.RequestDigest && v.Action == call.Action && v.Method == call.Method && v.Path == call.Path && v.RequestBodySHA256 == call.BodyDigest && v.RequestBody == bindTaskBytes(call.Body)
}
func decodeTaskActionBody(raw []byte, value any) error {
	if !utf8.Valid(raw) || rejectDuplicateShopJSON(raw) != nil || strictToolJSON(bytes.NewReader(raw), value) != nil {
		return errToolInvalid
	}
	return nil
}

type taskActionBodyWriter struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (w *taskActionBodyWriter) Header() http.Header { return w.header }
func (w *taskActionBodyWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *taskActionBodyWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.body.Write(body)
}
func taskActionResponse(status int, body any) ([]byte, error) {
	writer := &taskActionBodyWriter{header: http.Header{}}
	writeJSON(writer, status, body) // same production response writer as the normal handler
	if writer.status != status || !json.Valid(writer.body.Bytes()) {
		return nil, ErrTaskActionOutcomeUnknown
	}
	return bytes.Clone(writer.body.Bytes()), nil
}

// Normal server-side business entry for the original admitted Auth adapter.
// It is not an HTTP authentication/registration hook. The adapter must qualify
// its original session/nonce/current before calling, then sign these exact
// stored bytes through the sole SDK response codec.
func (s *Server) ExecuteOriginalLocalTaskAction(ctx context.Context, held *TaskStoreSnapshot, call TaskActionCall) (*TaskActionOutcomeReceipt, error) {
	if s == nil || held == nil || held.source == nil || held.source.store != s.store {
		return nil, errTaskEffectSourceUnavailable
	}
	if len(call.Body) == 0 || len(call.Body) > 32<<10 {
		return nil, errToolInvalid
	}
	call.Body = bytes.Clone(call.Body)
	if !validTaskActionCall(call) {
		return nil, errToolInvalid
	}
	receipt, err := held.source.ExecuteLocalAction(ctx, held, call)
	if call.Action == "cancel-task" || call.Action == "complete-task" {
		// ACK/context failure may follow a genuine durable cancel. Stop only
		// that exact committed generation, never a later holder's work.
		s.store.mu.Lock()
		record := s.store.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)]
		view := record.View
		task := s.store.state.Tasks[view.TaskID]
		committed := taskActionMatches(view, held.view.Principal, call) && view.State == "COMMITTED" && task.Revision == view.RevisionAfter && task.Generation == view.GenerationAfter && task.Holder == view.HolderAfter
		s.store.mu.Unlock()
		if committed {
			s.cancelTaskModelRuns(view.Principal.Account, view.TaskID)
		}
	}
	if err != nil {
		return receipt, err
	}
	view, err := receipt.View()
	if err != nil {
		return receipt, err
	}
	_ = view // actual receipt is preserved for the sole response codec
	return receipt, nil
}

// ExecuteLocalAction performs only the closed product-local transitions below.
// It cannot accept caller state/results, run a model, dispatch a tool, issue a
// Grant, activate a handoff or turn Auth nonce admission into business success.
// The Source lease/session must already be independently qualified by Auth.
func (source *TaskStoreSource) ExecuteLocalAction(ctx context.Context, held *TaskStoreSnapshot, call TaskActionCall) (*TaskActionOutcomeReceipt, error) {
	if held == nil || held.source != source || len(call.Body) == 0 || len(call.Body) > 32<<10 {
		return nil, errToolInvalid
	}
	call.Body = bytes.Clone(call.Body)
	if !validTaskActionCall(call) {
		return nil, errToolInvalid
	}
	if err := source.begin(ctx, held.view.Principal); err != nil {
		return nil, err
	}
	s := source.store
	s.mu.Lock()
	defer s.mu.Unlock()
	p := held.view.Principal
	key := taskActionKey(p, call.OriginalOperationID)
	if record, exists := s.state.TaskActionOutcomes[key]; exists {
		if !taskActionMatches(record.View, p, call) {
			return nil, ErrTaskConflict
		}
		return source.queryTaskActionLocked(ctx, p, call)
	}
	if err := held.Current(); err != nil {
		return nil, err
	}
	expected := held.view.Task
	expectedPath := "/api/tasks"
	switch call.Action {
	case "create-task":
		if expected.ID != "" || held.view.ConversationID == "" {
			return nil, ErrTaskConflict
		}
	case "prepare-task":
		expectedPath += "/" + expected.ID + "/prepare"
	case "cancel-task":
		expectedPath += "/" + expected.ID + "/cancel"
	case "complete-task":
		expectedPath += "/" + expected.ID + "/complete"
	case "propose-tool-step":
		expectedPath += "/" + expected.ID + "/tool-steps"
	default:
		return nil, errTaskEffectSourceUnavailable
	}
	if call.Path != expectedPath || (call.Action != "create-task" && expected.ID == "") {
		return nil, ErrTaskConflict
	}
	view := TaskActionOutcomeView{OriginalOperationID: call.OriginalOperationID, RequestRef: call.RequestRef, OriginalRef: key, ConversationID: held.view.ConversationID, RequestDigest: call.RequestDigest, Action: call.Action, Method: call.Method, Path: call.Path, Principal: p, RequestBody: bindTaskBytes(call.Body), RequestBodySHA256: call.BodyDigest, TaskID: expected.ID, HolderBefore: expected.Holder, RevisionBefore: expected.Revision, GenerationBefore: expected.Generation, State: "PENDING", Scope: "PRODUCT_LOCAL_COMMIT_ONLY"}
	// Durable original reservation comes first. It is not a resource mutation,
	// so it does not change the captured task epoch. Any existing reservation
	// refuses execution; crash/lost ACK cannot create a replacement task/action.
	oldMap := s.state.TaskActionOutcomes
	s.state.TaskActionOutcomes = cloneTaskActionOutcomes(oldMap)
	s.state.TaskActionOutcomes[key] = storedTaskActionOutcome{View: view}
	if err := s.persistStateLocked(); err != nil {
		// Keep an in-memory UNKNOWN tombstone even if the disk write was ambiguous.
		// On restart a persisted PENDING is also query-only. No business ran here.
		s.authorityEpoch.Store(&taskStoreEpoch{})
		return nil, fmt.Errorf("%w: reserve: %v", ErrTaskActionOutcomeUnknown, err)
	}
	// Work on a deep working copy. Original methods stage their ordinary saves;
	// only the final real save commits resource state and exact outcome together.
	original := s.state
	raw, err := json.Marshal(original)
	if err != nil {
		return nil, err
	}
	var working persistentState
	if err = json.Unmarshal(raw, &working); err != nil {
		return nil, err
	}
	s.state = working
	s.taskActionStaging = true
	committed := false
	defer func() {
		s.taskActionStaging = false
		if !committed {
			s.state = original
		}
	}()
	var result TaskRecord
	var response any
	status := http.StatusOK
	switch call.Action {
	case "create-task":
		var in struct {
			ConversationID string `json:"conversationId"`
		}
		if err = decodeTaskActionBody(call.Body, &in); err == nil {
			if in.ConversationID != held.view.ConversationID {
				err = ErrTaskConflict
			} else {
				result, err = s.createTaskLocked(p.Account, in.ConversationID, p.DeviceID)
				response = result
				status = http.StatusCreated
			}
		}
	case "prepare-task", "cancel-task", "complete-task":
		var in struct {
			Revision   uint64 `json:"revision"`
			Generation uint64 `json:"generation"`
			RunID      string `json:"runId,omitempty"`
		}
		if err = decodeTaskActionBody(call.Body, &in); err == nil {
			if in.Revision != expected.Revision || in.Generation != expected.Generation || (call.Action != "complete-task" && in.RunID != "") {
				err = ErrTaskConflict
			} else {
				switch call.Action {
				case "prepare-task":
					result, err = s.prepareTaskLocked(p.Account, expected.ID, in.Revision, in.Generation, p.DeviceID)
					response = map[string]any{"task": result, "authorityGranted": false, "executed": false}
				case "cancel-task":
					result, err = s.cancelTaskLocked(p.Account, expected.ID, in.Revision, in.Generation, p.DeviceID)
					response = map[string]any{"task": result, "futureDispatchClosed": true, "remoteRollback": false}
				case "complete-task":
					result, err = s.completeTaskLocked(p.Account, expected.ID, in.Revision, in.Generation, p.DeviceID, in.RunID)
					response = map[string]any{"task": result, "effectsVerified": true, "newAuthorityGranted": false}
				}
			}
		}
	case "propose-tool-step":
		var in toolStepRequest
		if err = decodeTaskActionBody(call.Body, &in); err == nil {
			if in.TaskRevision != expected.Revision || in.Generation != expected.Generation {
				err = ErrTaskConflict
			} else {
				var step ActionRecord
				var created bool
				// Original Auth must admit the propose action. The product uses the
				// registered directory and only stores NEEDS_APPROVAL, never a Grant.
				_, known := lookupTool(in.ToolID)
				if !known {
					err = errToolInvalid
				} else {
					session := ProductSession{ID: p.SessionID, Account: p.Account, DeviceID: p.DeviceID}
					step, created, err = s.reserveTaskProposalLocked(session, expected.ID, in)
					if err == nil {
						result = s.state.Tasks[expected.ID]
						response = map[string]any{"step": step, "executed": false, "approvalRequired": true}
						if created {
							status = http.StatusCreated
						}
					}
				}
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if err = held.Current(); err != nil {
		return nil, err
	}
	body, err := taskActionResponse(status, response)
	if err != nil {
		return nil, err
	}
	view.TaskID = result.ID
	view.HolderAfter = result.Holder
	view.RevisionAfter = result.Revision
	view.GenerationAfter = result.Generation
	view.State = "COMMITTED"
	view.HTTPStatus = status
	view.BodyDigest = bindTaskBytes(body)
	view.CommittedAt = s.now().UTC()
	sealedPayload, err := json.Marshal(taskActionStoredPayload{View: view, Body: body})
	if err != nil {
		return nil, err
	}
	nonce, cipher, err := s.encrypt(p.Account, result.ID, call.OriginalOperationID+":task-action-result", string(sealedPayload))
	if err != nil {
		return nil, err
	}
	s.state.TaskActionOutcomes[key] = storedTaskActionOutcome{View: view, BodyNonce: nonce, BodyCipher: cipher}
	s.taskActionStaging = false
	if err = s.saveLocked(); err != nil {
		return nil, fmt.Errorf("%w: commit: %v", ErrTaskActionOutcomeUnknown, err)
	}
	committed = true
	return source.queryTaskActionLocked(ctx, p, call)
}
func cloneTaskActionOutcomes(prior map[string]storedTaskActionOutcome) map[string]storedTaskActionOutcome {
	next := make(map[string]storedTaskActionOutcome, len(prior)+1)
	for k, v := range prior {
		next[k] = v
	}
	return next
}

// Query never calls an action, replays a handler or accepts caller outcome state.
func (source *TaskStoreSource) QueryTaskActionOutcome(ctx context.Context, p TaskStorePrincipal, call TaskActionCall) (*TaskActionOutcomeReceipt, error) {
	if err := source.begin(ctx, p); err != nil {
		return nil, err
	}
	if len(call.Body) == 0 || len(call.Body) > 32<<10 {
		return nil, errToolInvalid
	}
	call.Body = bytes.Clone(call.Body)
	if !validTaskActionCall(call) {
		return nil, errToolInvalid
	}
	source.store.mu.Lock()
	defer source.store.mu.Unlock()
	return source.queryTaskActionLocked(ctx, p, call)
}
func (source *TaskStoreSource) queryTaskActionLocked(ctx context.Context, p TaskStorePrincipal, call TaskActionCall) (*TaskActionOutcomeReceipt, error) {
	s := source.store
	record, ok := s.state.TaskActionOutcomes[taskActionKey(p, call.OriginalOperationID)]
	if !ok {
		return nil, ErrTaskActionOutcomeUnknown
	}
	if !taskActionMatches(record.View, p, call) {
		return nil, ErrTaskConflict
	}
	return source.taskActionReceiptLocked(ctx, p, taskActionKey(p, call.OriginalOperationID), record)
}

func (source *TaskStoreSource) taskActionReceiptLocked(ctx context.Context, p TaskStorePrincipal, key string, record storedTaskActionOutcome) (*TaskActionOutcomeReceipt, error) {
	s := source.store
	v := record.View
	if v.State != "COMMITTED" || v.Scope != "PRODUCT_LOCAL_COMMIT_ONLY" || v.TaskID == "" || v.HTTPStatus < 200 || v.HTTPStatus >= 300 {
		return nil, ErrTaskActionOutcomeUnknown
	}
	task, err := s.ownedTaskLocked(p.Account, v.TaskID)
	if err != nil {
		return nil, err
	}
	body, err := s.decrypt(p.Account, storedMessage{Message: Message{ID: v.OriginalOperationID + ":task-action-result", ConversationID: v.TaskID}, Nonce: record.BodyNonce, Cipher: record.BodyCipher})
	if err != nil {
		return nil, err
	}
	var payload taskActionStoredPayload
	var original struct {
		View json.RawMessage `json:"view"`
	}
	if json.Unmarshal([]byte(body), &payload) != nil || json.Unmarshal([]byte(body), &original) != nil || len(original.View) == 0 {
		return nil, ErrTaskActionOutcomeUnknown
	}
	expectedView, _ := json.Marshal(v)
	actualView, _ := json.Marshal(payload.View)
	if !bytes.Equal(expectedView, actualView) || bindTaskBytes(payload.Body) != v.BodyDigest {
		return nil, ErrTaskActionOutcomeUnknown
	}
	_ = task // actual live ACL was checked above; receipt is historical product commit
	receipt := &TaskActionOutcomeReceipt{source: source, ctx: ctx, key: key, fingerprint: taskOutcomeFingerprint(record), view: v, body: bytes.Clone(payload.Body), receiptOriginal: bytes.Clone(original.View)}
	if err := receipt.Current(); err != nil {
		return nil, err
	}
	return receipt, nil
}
