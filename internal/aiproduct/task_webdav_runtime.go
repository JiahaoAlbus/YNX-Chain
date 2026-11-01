package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"
)

const taskWebDAVToolID = "external.webdav.put"
const taskWebDAVModelName = "ynx_webdav_deliver_v1"

// These are local product operands, never a second Grant codec/verifier.
// The original registered Source must borrow its genuine authorization loan.
// A session, model argument, DAV password or PUBLIC fixture is not this Source.
type TaskWebDAVAuthorizationRequest struct {
	Session                                                              ProductSession
	Task                                                                 TaskRecord
	OperationID, ResourceID, DestinationID, DestinationBinding, RemoteID string
	ContentSHA256                                                        string
	ContentBytes                                                         int
	AuthorizationRef                                                     string
	QueryOriginal                                                        bool
	OriginalRevision, OriginalGeneration                                 uint64
	OriginalHolder                                                       string
}
type OriginalTaskWebDAVLoan interface {
	Current(context.Context) error
	Close() error
}
type OriginalTaskWebDAVAuthority interface {
	AcquireOriginalWebDAVTask(context.Context, TaskWebDAVAuthorizationRequest) (OriginalTaskWebDAVLoan, error)
}

type PreparedTaskWebDAVRuntime struct {
	authority    OriginalTaskWebDAVAuthority
	destinations map[string]TaskWebDAVConfig
}

// In-process original composition only: no HTTP/ENV/provider setter exists.
// Normal registration remains unavailable until the original Source supplies
// external WRITE/egress authorization. The read-only Auth fence is not reused
// as permission to PUT, and DAV is never described as a resource-side fence.
func PrepareOriginalTaskWebDAVRuntime(authority OriginalTaskWebDAVAuthority, destinations []TaskWebDAVConfig) (*PreparedTaskWebDAVRuntime, error) {
	if missingTaskRuntimeOperand(authority) || len(destinations) == 0 || len(destinations) > 32 {
		return nil, ErrTaskWebDAVUnavailable
	}
	p := &PreparedTaskWebDAVRuntime{authority: authority, destinations: map[string]TaskWebDAVConfig{}}
	for _, d := range destinations {
		if _, exists := p.destinations[d.ProfileID]; exists || d.ProfileID == "" {
			return nil, ErrTaskWebDAVConfig
		}
		p.destinations[d.ProfileID] = d
	}
	return p, nil
}

type TaskWebDAVInput struct {
	OperationID   string `json:"operationId"`
	ResourceID    string `json:"resourceId"`
	DestinationID string `json:"destinationId"`
	TaskRevision  uint64 `json:"taskRevision"`
	Generation    uint64 `json:"generation"`
}

// State CONTENT_PRESENT is an observation, never authorship or task completion.
// Historical receipts are returned verbatim; they do not assert current remote
// presence. A missing object after an uncertain PUT never enables a new PUT.
type TaskWebDAVReceipt struct {
	OperationID       string    `json:"operationId"`
	ResourceID        string    `json:"resourceId"`
	DestinationID     string    `json:"destinationId"`
	RemoteID          string    `json:"remoteId"`
	State             string    `json:"state"`
	ContentState      string    `json:"contentState"`
	SHA256            string    `json:"sha256"`
	Bytes             int64     `json:"bytes"`
	ETag              string    `json:"etag,omitempty"`
	WriteAcknowledged bool      `json:"writeAcknowledged"`
	AuthorshipProven  bool      `json:"authorshipProven"`
	Scope             string    `json:"scope"`
	ObservedAt        time.Time `json:"observedAt"`
	FirstCause        string    `json:"firstCause,omitempty"`
}
type storedTaskWebDAVDelivery struct {
	Account, TaskID, Holder, SessionID string
	Revision, Generation               uint64
	Input                              TaskWebDAVInput
	DestinationBinding                 string
	ContentNonce, ContentCipher        string
	ReceiptNonce, ReceiptCipher        string
	Receipt                            TaskWebDAVReceipt
}

func (s *Store) verifyWebDAVRecord(record storedTaskWebDAVDelivery) error {
	plain, err := s.decrypt(record.Account, storedMessage{Message: Message{ID: "webdav-record:" + record.Input.OperationID, ConversationID: record.TaskID}, Nonce: record.ReceiptNonce, Cipher: record.ReceiptCipher})
	if err != nil {
		return err
	}
	record.ReceiptNonce, record.ReceiptCipher = "", ""
	raw, err := json.Marshal(record)
	if err != nil || !bytes.Equal(raw, []byte(plain)) {
		return errors.New("original WebDAV record authentication failed")
	}
	return nil
}

func taskWebDAVDigest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }
func taskWebDAVKey(account, task, op string) string {
	b, _ := json.Marshal([]string{account, task, op})
	return taskWebDAVDigest(b)
}
func taskWebDAVDestinationBinding(c TaskWebDAVConfig) string {
	// Local destination DATA only; credentials are neither persisted nor sent
	// to the model. Changing origin/user/root/object invalidates old recovery.
	b, _ := json.Marshal([]string{c.ProfileID, c.Origin, c.User, c.Root, c.Object})
	return taskWebDAVDigest(b)
}
func (s *Store) saveWebDAVLocked(key string, record storedTaskWebDAVDelivery) error {
	record.ReceiptNonce, record.ReceiptCipher = "", ""
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	record.ReceiptNonce, record.ReceiptCipher, err = s.encrypt(record.Account, record.TaskID, "webdav-record:"+record.Input.OperationID, string(raw))
	if err != nil {
		return err
	}
	old, exists := s.state.WebDAVDeliveries[key]
	wasNil := s.state.WebDAVDeliveries == nil
	if wasNil {
		s.state.WebDAVDeliveries = map[string]storedTaskWebDAVDelivery{}
	}
	s.state.WebDAVDeliveries[key] = record
	audits, sequence := s.state.Audits, s.state.AuditSequence
	s.auditLocked(record.Account, "webdav_original_checkpoint", record.Input.OperationID, record.Receipt.State)
	if err := s.saveLocked(); err != nil {
		s.state.Audits, s.state.AuditSequence = audits, sequence
		if wasNil {
			s.state.WebDAVDeliveries = nil
		} else if exists {
			s.state.WebDAVDeliveries[key] = old
		} else {
			delete(s.state.WebDAVDeliveries, key)
		}
		return err
	}
	return nil
}

func (s *Server) executeTaskWebDAV(ctx context.Context, session ProductSession, taskID string, input TaskWebDAVInput, ref string, query bool) (receipt TaskWebDAVReceipt, resultErr error) {
	if ctx == nil || s == nil || s.store == nil || s.webDAV == nil || missingTaskRuntimeOperand(s.webDAV.authority) {
		return receipt, ErrTaskWebDAVUnavailable
	}
	if !toolOperationID.MatchString(input.OperationID) || len(ref) == 0 || len(ref) > 256 {
		return receipt, errToolInvalid
	}
	if err := ctx.Err(); err != nil {
		return receipt, err
	}
	key := taskWebDAVKey(session.Account, taskID, input.OperationID)
	s.store.mu.Lock()
	task, err := s.store.ownedTaskLocked(session.Account, taskID)
	original, exists := s.store.state.WebDAVDeliveries[key]
	s.store.mu.Unlock()
	if err != nil {
		return receipt, err
	}
	if exists {
		if err := s.store.verifyWebDAVRecord(original); err != nil {
			return receipt, err
		}
		if original.Holder != session.DeviceID {
			return receipt, errToolNotFound
		}
		if !query && input != original.Input {
			return receipt, errToolConflict
		}
		input = original.Input
		// A persisted observation is historical data, not new network authority.
		if original.Receipt.State == "CONTENT_PRESENT" {
			return original.Receipt, nil
		}
	} else if query {
		return receipt, errToolNotFound
	}
	if !toolOperationID.MatchString(input.ResourceID) || !taskWebDAVText(input.DestinationID, 256) {
		return receipt, errToolInvalid
	}
	if !exists && (task.Holder != session.DeviceID || task.Revision != input.TaskRevision || task.Generation != input.Generation || !task.CancelledAt.IsZero() || (task.Status != "READY" && task.Status != "WORKING")) {
		return receipt, errToolConflict
	}
	if err := s.store.assertWebDAVAgentConfiguration(task); !exists && err != nil {
		return receipt, err
	}
	config, ok := s.webDAV.destinations[input.DestinationID]
	if !ok {
		return receipt, ErrTaskWebDAVDestination
	}
	destinationBinding := taskWebDAVDestinationBinding(config)
	var content []byte
	if exists {
		if original.DestinationBinding != destinationBinding || original.Receipt.RemoteID != config.Object {
			return receipt, errToolConflict
		}
		text, e := s.store.decrypt(session.Account, storedMessage{Message: Message{ID: "webdav:" + input.OperationID, ConversationID: taskID}, Nonce: original.ContentNonce, Cipher: original.ContentCipher})
		if e != nil {
			return receipt, e
		}
		content = []byte(text)
	} else {
		resources, e := s.store.AttachmentContexts(session.Account, task.ConversationID, []string{input.ResourceID})
		if e != nil || len(resources) != 1 {
			return receipt, errToolNotFound
		}
		content = []byte(resources[0].Text)
	}
	digest := taskWebDAVDigest(content)
	if exists && (original.Receipt.SHA256 != digest || original.Receipt.Bytes != int64(len(content))) {
		return receipt, errToolConflict
	}
	request := TaskWebDAVAuthorizationRequest{Session: session, Task: task, OperationID: input.OperationID, ResourceID: input.ResourceID, DestinationID: input.DestinationID, DestinationBinding: destinationBinding, RemoteID: config.Object, ContentSHA256: digest, ContentBytes: len(content), AuthorizationRef: ref, QueryOriginal: exists || query}
	request.OriginalRevision, request.OriginalGeneration, request.OriginalHolder = input.TaskRevision, input.Generation, session.DeviceID
	loan, err := s.webDAV.authority.AcquireOriginalWebDAVTask(ctx, request)
	if loan != nil {
		defer func() { resultErr = errors.Join(resultErr, loan.Close()) }()
	}
	if err != nil {
		return receipt, err
	}
	if missingTaskRuntimeOperand(loan) {
		return receipt, ErrTaskWebDAVUnavailable
	}
	current := func(c context.Context) error {
		if e := c.Err(); e != nil {
			return e
		}
		if e := loan.Current(c); e != nil {
			return e
		}
		s.store.mu.Lock()
		defer s.store.mu.Unlock()
		live, e := s.store.ownedTaskLocked(session.Account, taskID)
		if e != nil {
			return e
		}
		if exists || query {
			// Separately authorized original GET remains recoverable after task
			// cancellation/handoff. It cannot execute or follow the new holder.
			stored, ok := s.store.state.WebDAVDeliveries[key]
			if !ok || stored.Holder != session.DeviceID || stored.Input != input || stored.DestinationBinding != destinationBinding {
				return errToolConflict
			}
			return s.store.verifyWebDAVRecord(stored)
		}
		if live.Holder != task.Holder || live.Revision != task.Revision || live.Generation != task.Generation || !live.CancelledAt.IsZero() || (live.Status != "READY" && live.Status != "WORKING") {
			return errToolConflict
		}
		return s.store.assertTaskAgentConfigurationLocked(live, taskWebDAVToolID)
	}
	transport, err := PrepareTaskWebDAVTransport(ctx, config, current)
	if err != nil {
		return receipt, err
	}
	defer transport.transport.CloseIdleConnections()
	if err := current(ctx); err != nil {
		return receipt, err
	}
	s.store.mu.Lock()
	// Reserve ONCE before any request. Concurrent callers and reopened Stores
	// see the same immutable object and may only GET, never repeat the PUT.
	stored, nowExists := s.store.state.WebDAVDeliveries[key]
	if nowExists {
		if s.store.verifyWebDAVRecord(stored) != nil || stored.Input != input || stored.DestinationBinding != destinationBinding || stored.Receipt.SHA256 != digest || stored.Receipt.Bytes != int64(len(content)) {
			s.store.mu.Unlock()
			return receipt, errToolConflict
		}
		original = stored
		exists = true
	} else {
		nonce, cipher, e := s.store.encrypt(session.Account, taskID, "webdav:"+input.OperationID, string(content))
		if e != nil {
			s.store.mu.Unlock()
			return receipt, e
		}
		original = storedTaskWebDAVDelivery{Account: session.Account, TaskID: taskID, Holder: task.Holder, SessionID: session.ID, Revision: task.Revision, Generation: task.Generation, Input: input, DestinationBinding: destinationBinding, ContentNonce: nonce, ContentCipher: cipher, Receipt: TaskWebDAVReceipt{OperationID: input.OperationID, ResourceID: input.ResourceID, DestinationID: input.DestinationID, RemoteID: config.Object, State: "UNKNOWN", ContentState: "UNKNOWN", SHA256: digest, Bytes: int64(len(content)), Scope: "external-content-observation-only"}}
		if e := s.store.saveWebDAVLocked(key, original); e != nil {
			s.store.mu.Unlock()
			return receipt, e
		}
	}
	s.store.mu.Unlock()
	var observed TaskWebDAVResult
	if exists || query {
		observed, err = transport.QueryContent(ctx, content)
	} else {
		observed, err = transport.PutIfAbsentAndVerify(ctx, content)
	}
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	stored, ok = s.store.state.WebDAVDeliveries[key]
	if !ok {
		return receipt, errToolNotFound
	}
	if err := s.store.verifyWebDAVRecord(stored); err != nil {
		return receipt, err
	}
	if stored.Receipt.State == "CONTENT_PRESENT" {
		return stored.Receipt, err
	}
	receipt = stored.Receipt
	receipt.ContentState = observed.State
	receipt.WriteAcknowledged = receipt.WriteAcknowledged || observed.WriteAcknowledged
	if observed.ETag != "" {
		receipt.ETag = observed.ETag
	}
	if err == nil && observed.State == "CONTENT_PRESENT" && observed.RemoteID == receipt.RemoteID && observed.SHA256 == digest && observed.Bytes == int64(len(content)) && bytes.Equal(observed.Content, content) {
		receipt.State = "CONTENT_PRESENT"
		receipt.ObservedAt = s.store.now().UTC()
	} else if receipt.FirstCause == "" {
		receipt.FirstCause = "ORIGINAL_DAV_OUTCOME_UNRESOLVED"
	}
	stored.Receipt = receipt
	if saveErr := s.store.saveWebDAVLocked(key, stored); saveErr != nil {
		return original.Receipt, errors.Join(err, saveErr)
	}
	if receipt.State != "CONTENT_PRESENT" && err == nil {
		err = ErrTaskWebDAVUnknown
	}
	return receipt, err
}

func (s *Store) assertWebDAVAgentConfiguration(task TaskRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.assertTaskAgentConfigurationLocked(task, taskWebDAVToolID)
}
func (s *Store) TaskWebDAVResult(session ProductSession, taskID, operation string) (TaskWebDAVReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(session.Account, taskID)
	if err != nil {
		return TaskWebDAVReceipt{}, err
	}
	r, ok := s.state.WebDAVDeliveries[taskWebDAVKey(session.Account, taskID, operation)]
	if !ok || r.Holder != session.DeviceID || task.Account != session.Account {
		return TaskWebDAVReceipt{}, errToolNotFound
	}
	if err := s.verifyWebDAVRecord(r); err != nil {
		return TaskWebDAVReceipt{}, err
	}
	return r.Receipt, nil
}
func readTaskWebDAVJSON(w http.ResponseWriter, r *http.Request, out any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 32<<10))
	if err != nil || rejectDuplicateShopJSON(raw) != nil || strictToolJSON(bytes.NewReader(raw), out) != nil {
		writeError(w, http.StatusBadRequest, "exact bounded WebDAV request required")
		return false
	}
	return true
}
func (s *Server) handleTaskWebDAVDeliver(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		TaskWebDAVInput
		AuthorizationRef string `json:"authorizationRef"`
	}
	if !readTaskWebDAVJSON(w, r, &in) {
		return
	}
	receipt, err := s.executeTaskWebDAV(r.Context(), session, r.PathValue("id"), in.TaskWebDAVInput, in.AuthorizationRef, false)
	s.writeTaskWebDAV(w, receipt, err)
}
func (s *Server) handleTaskWebDAVQuery(w http.ResponseWriter, r *http.Request, session ProductSession) {
	var in struct {
		AuthorizationRef string `json:"authorizationRef"`
	}
	if !readTaskWebDAVJSON(w, r, &in) {
		return
	}
	receipt, err := s.executeTaskWebDAV(r.Context(), session, r.PathValue("id"), TaskWebDAVInput{OperationID: r.PathValue("operationId")}, in.AuthorizationRef, true)
	s.writeTaskWebDAV(w, receipt, err)
}
func (s *Server) writeTaskWebDAV(w http.ResponseWriter, receipt TaskWebDAVReceipt, err error) {
	w.Header().Set("Cache-Control", "no-store")
	status := http.StatusOK
	if err != nil {
		status = http.StatusConflict
		if errors.Is(err, ErrTaskWebDAVUnavailable) {
			status = http.StatusServiceUnavailable
		}
	}
	writeJSON(w, status, map[string]any{"receipt": receipt, "unresolved": err != nil})
}
func (s *Server) handleTaskWebDAVResult(w http.ResponseWriter, r *http.Request, session ProductSession) {
	receipt, err := s.store.TaskWebDAVResult(session, r.PathValue("id"), r.PathValue("operationId"))
	if err != nil {
		writeError(w, http.StatusNotFound, "original WebDAV result unavailable")
		return
	}
	s.writeTaskWebDAV(w, receipt, nil)
}
