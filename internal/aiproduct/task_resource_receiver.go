package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strconv"
	"sync"
	"unicode/utf8"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"

	authgrant "ynx.local/authgrantpolicy"
)

// Private normal resource DATA, not OPEN WIRE or an authority registration.
// The original native bridge supplies the actual signed Grant/holder material;
// no verifier, Source, target URL, field selector or approved bool is accepted.
type OriginalTaskResourceReadRequest struct {
	Version               string
	AuthorityOperationID  string
	ExpectedGrantRevision string
	Binding               authgrant.TaskEffectBinding
	Grant, Holder         authgrant.Proof
	RawInput              []byte
	AuthorizationRef      string
	OriginalOffset        int
	OriginalChunkBytes    int
}

type OriginalTaskResourceReadResult struct {
	OperationID string                         `json:"operationId"`
	State       string                         `json:"state"`
	Original    []byte                         `json:"original"`
	AuthScope   string                         `json:"authScope"`
	Chunk       *OriginalTaskResourceReadChunk `json:"chunk,omitempty"`
}

// Chunk is a bounded fragment of the SAME original receipt. It is not a
// complete receipt/settlement result. Reassemble and check both full hashes.
type OriginalTaskResourceReadChunk struct {
	Offset     int              `json:"offset"`
	NextOffset int              `json:"nextOffset"`
	TotalBytes int              `json:"totalBytes"`
	Binding    taskBytesBinding `json:"binding"`
	Bytes      []byte           `json:"bytes"`
}

// Response limit is serialized body bytes, including base64 and final newline.
// It matches the existing LINK default; never silently raise the client budget.
const OriginalTaskReadMaxResponseBytes = 1 << 20
const OriginalTaskReadMaxChunkBytes = 256 << 10

var errTaskResourceResponseLimit = errors.New("AI_ORIGINAL_TASK_RESOURCE_RESPONSE_LIMIT")

// This owner borrows the SAME Server/Store and original native Source. It never
// closes or reconstructs either. Only per-call held Source children are owned.
type OriginalTaskReadResource struct {
	mu            sync.Mutex
	store         *Store
	verifier      authgrant.OriginalTaskGrantVerifier
	current       func(context.Context) error
	queryCurrent  func(context.Context) error
	queryMaterial func(context.Context, OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error)
	retired       bool
	children      map[*OriginalTaskResourceReadCall]struct{}
}

type OriginalTaskResourceReadCall struct {
	mu          sync.Mutex
	parent      *OriginalTaskReadResource
	reservation *authgrant.OriginalTaskReservationCheck
	check       *authgrant.TaskGrantCheck
	cancel      context.CancelFunc
	context     context.Context
	first       error
	peer        *link.LocalCaller
	closed      bool
	closeOnce   sync.Once
	closeErr    error
}

var errTaskResourceChildren = errors.New("AI_ORIGINAL_TASK_RESOURCE_CHILDREN_RETAINED")

// Only actual normal composition can obtain this: the genuine concrete native
// authority already installed on this exact Server, never an HTTP provider.
func OpenOriginalTaskReadResource(ctx context.Context, server *Server) (*OriginalTaskReadResource, error) {
	if ctx == nil || server == nil || server.store == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	effects, ok := server.toolEffects.(*originalRuntimeToolEffects)
	if !ok || effects.store != server.store || effects.runtime == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	authority, ok := effects.runtime.authority.(*nativeTaskRuntimeAuthority)
	if !ok || authority.localOwner == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	owner := &OriginalTaskReadResource{store: server.store, verifier: authority.localOwner, current: authority.localOwner.Current, queryCurrent: authority.queryCurrent, queryMaterial: authority.queryOriginalTaskMaterial, children: make(map[*OriginalTaskResourceReadCall]struct{})}
	return owner, owner.Current(ctx)
}

func (o *OriginalTaskReadResource) Current(ctx context.Context) error {
	if o == nil || ctx == nil || o.store == nil || o.current == nil || missingTaskRuntimeOperand(o.verifier) {
		return errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	o.mu.Lock()
	retired := o.retired
	o.mu.Unlock()
	if retired {
		return errTaskEffectSourceUnavailable
	}
	if err := o.current(ctx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.retired {
		return errTaskEffectSourceUnavailable
	}
	return nil
}

func (o *OriginalTaskReadResource) Retire() {
	if o == nil {
		return
	}
	o.mu.Lock()
	o.retired = true
	var cancel []context.CancelFunc
	for child := range o.children {
		cancel = append(cancel, child.cancel)
	}
	o.mu.Unlock()
	for _, stop := range cancel {
		stop()
	}
}

func (o *OriginalTaskReadResource) Close() error {
	if o == nil {
		return nil
	}
	o.Retire()
	o.mu.Lock()
	defer o.mu.Unlock()
	if len(o.children) != 0 {
		return errTaskResourceChildren
	}
	return nil
}

func cloneOriginalResourceRequest(r OriginalTaskResourceReadRequest) OriginalTaskResourceReadRequest {
	if r.Binding.EgressActual != nil {
		copy := *r.Binding.EgressActual
		r.Binding.EgressActual = &copy
	}
	r.RawInput = bytes.Clone(r.RawInput)
	r.Grant.Payload = bytes.Clone(r.Grant.Payload)
	r.Grant.Wire = bytes.Clone(r.Grant.Wire)
	r.Holder.Payload = bytes.Clone(r.Holder.Payload)
	r.Holder.Wire = bytes.Clone(r.Holder.Wire)
	r.Binding.Fields = append([]string(nil), r.Binding.Fields...)
	r.Binding.Resources = append([]authgrant.Ref(nil), r.Binding.Resources...)
	r.Binding.Sources = append([]authgrant.Source(nil), r.Binding.Sources...)
	for i := range r.Binding.Sources {
		r.Binding.Sources[i].Fields = append([]string(nil), r.Binding.Sources[i].Fields...)
	}
	return r
}

func (o *OriginalTaskReadResource) begin(ctx context.Context, r OriginalTaskResourceReadRequest, execution bool) (*OriginalTaskResourceReadCall, error) {
	if err := o.Current(ctx); err != nil {
		return nil, err
	}
	if r.OriginalOffset != 0 || r.OriginalChunkBytes != 0 || r.Version != "1" || execution && len(r.AuthorityOperationID) < 1 || !execution && r.AuthorityOperationID != "" || len(r.AuthorityOperationID) > 256 || r.ExpectedGrantRevision != r.Binding.GrantRevision || r.Binding.Tool.ID != "ai.conversation.read" || r.Binding.Tool.Operation != "ai.conversation.read" || r.Binding.Tool.Version != "1" || r.Binding.Tool.Risk != "read" || r.Binding.EgressActual != nil || len(r.RawInput) > 32<<10 {
		return nil, errToolInvalid
	}
	if execution && (bindTaskBytes(r.RawInput) != (taskBytesBinding{Bytes: len(r.RawInput), SHA3_512: r.Binding.Input.SHA3_512, SHA512: r.Binding.Input.SHA512}) || r.Binding.Input.Bytes != strconv.Itoa(len(r.RawInput))) {
		return nil, errToolConflict
	}
	c, err := o.retainCall(ctx)
	if err != nil {
		return nil, err
	}
	callCtx := c.context
	if execution {
		// Only the originally installed protected local owner can implement this
		// sibling. Ordinary grant verification/op DATA cannot substitute for it.
		verifier, ok := o.verifier.(authgrant.OriginalTaskReservationVerifier)
		if !ok || missingTaskRuntimeOperand(verifier) {
			c.first = errTaskEffectSourceUnavailable
			return c, c.first
		}
		c.reservation, err = authgrant.OpenOriginalReservedTaskRead(callCtx, verifier, r.Binding, r.Grant, r.Holder, r.AuthorityOperationID)
	} else {
		c.check, err = authgrant.OpenTaskGrantAtEffect(callCtx, o.verifier, r.Binding, r.Grant, r.Holder)
	} // adopt the original partial BEFORE inspecting the acquisition error

	if err != nil {
		c.first = err
		return c, err
	}
	return c, nil
}

// Retain every operation, including history-only queries, across asynchronous
// Source work. Retirement must not acknowledge a drain while a query can egress.
func (o *OriginalTaskReadResource) retainCall(ctx context.Context) (*OriginalTaskResourceReadCall, error) {
	callCtx, cancel := context.WithCancel(ctx)
	c := &OriginalTaskResourceReadCall{parent: o, context: callCtx, cancel: cancel}
	if peer, e := link.LocalCallerFromContext(ctx); e == nil {
		c.peer = peer
	}
	o.mu.Lock()
	if o.retired || len(o.children) >= 16 {
		o.mu.Unlock()
		cancel()
		return nil, errTaskResourceChildren
	}
	o.children[c] = struct{}{}
	o.mu.Unlock()
	return c, nil
}

func (o *OriginalTaskReadResource) historyCurrent(ctx context.Context) error {
	if ctx == nil || ctx.Err() != nil {
		return errTaskEffectSourceUnavailable
	}
	o.mu.Lock()
	retired := o.retired
	o.mu.Unlock()
	if retired {
		return errTaskEffectSourceUnavailable
	}
	if err := o.queryCurrent(ctx); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.retired {
		return errTaskEffectSourceUnavailable
	}
	return nil
}

func (c *OriginalTaskResourceReadCall) Current(ctx context.Context) error {
	if c == nil || ctx == nil {
		return errTaskEffectSourceUnavailable
	}
	c.mu.Lock()
	closed, first := c.closed, c.first
	c.mu.Unlock()
	if first != nil {
		return first
	}
	if closed {
		return errTaskEffectSourceUnavailable
	}
	if err := c.parent.Current(ctx); err != nil {
		return err
	}
	if err := c.context.Err(); err != nil {
		return err
	}
	if c.peer != nil {
		if _, err := c.peer.Current(ctx); err != nil {
			return err
		}
	}
	if c.reservation != nil {
		_, err := c.reservation.Current(ctx) // repeatable, never dispatches
		return err
	}
	_, err := authgrant.CheckTaskGrantAtEffect(ctx, c.check)
	return err
}

// Only Execute passes this original dedicated claim into the Store.mu final
// callback. Current checks elsewhere must never select the once-only claim.
func (c *OriginalTaskResourceReadCall) claimAtEffect(ctx context.Context) error {
	if c == nil || c.reservation == nil {
		return errTaskEffectSourceUnavailable
	}
	if err := c.Current(ctx); err != nil {
		return err
	}
	_, err := c.reservation.ClaimAtEffect(ctx)
	return err
}

func (c *OriginalTaskResourceReadCall) Retire() {
	if c != nil {
		c.cancel()
	}
}
func (c *OriginalTaskResourceReadCall) Close() error {
	if c == nil {
		return nil
	}
	c.closeOnce.Do(func() {
		c.Retire()
		if c.reservation != nil {
			c.closeErr = c.reservation.Close()
		} else if c.check != nil {
			c.closeErr = c.check.Close()
		}
		if c.closeErr == nil {
			c.mu.Lock()
			c.closed = true
			c.mu.Unlock()
			c.parent.mu.Lock()
			delete(c.parent.children, c)
			c.parent.mu.Unlock()
		}
	})
	return c.closeErr // uncertain close retains this child; never blind retry
}

// Execute is the normal finite resource callee. The caller adopts owner even
// with an error; exact durable bytes remain in the original encrypted Store.
func (o *OriginalTaskReadResource) Execute(ctx context.Context, request OriginalTaskResourceReadRequest) (owner *OriginalTaskResourceReadCall, result OriginalTaskResourceReadResult, err error) {
	r := cloneOriginalResourceRequest(request)
	owner, err = o.begin(ctx, r, true)
	if err != nil {
		return owner, result, err
	}
	b := r.Binding
	revision, e := strconv.ParseUint(b.Task.Revision, 10, 64)
	if e != nil {
		return owner, result, e
	}
	generation, e := strconv.ParseUint(b.Generation, 10, 64)
	if e != nil {
		return owner, result, e
	}
	expected := taskReadExpectation{Account: b.Account, TaskID: b.Task.ID, StepID: b.StepID, Holder: b.Holder.ID, TaskRevision: revision, Generation: generation, Input: bindTaskBytes(r.RawInput), Fields: append([]string(nil), b.Fields...), AuthorityOperationID: r.AuthorityOperationID, GrantRef: b.GrantID}
	if len(b.Resources) != 1 || len(b.Sources) != 1 || b.Sources[0].Resource != b.Resources[0] || !reflect.DeepEqual(b.Sources[0].Fields, b.Fields) {
		return owner, result, errToolConflict
	}
	expected.ConversationID = b.Resources[0].ID
	n, e := strconv.Atoi(b.Sources[0].Binding.Bytes)
	if e != nil || n < 0 || n > 1<<20 {
		return owner, result, errToolInvalid
	}
	expected.SourceBinding = &taskBytesBinding{Bytes: n, SHA3_512: b.Sources[0].Binding.SHA3_512, SHA512: b.Sources[0].Binding.SHA512}
	o.store.mu.Lock()
	task, e := o.store.ownedTaskLocked(b.Account, b.Task.ID)
	o.store.mu.Unlock()
	if e != nil {
		return owner, result, e
	}
	if b.Task.Kind != "task" || b.Resources[0].Kind != "conversation" || b.Resources[0].ID != task.ConversationID || b.Tool.Schema != (authgrant.Bind{Bytes: strconv.Itoa(len(taskModelTools()[0].Parameters)), SHA3_512: bindTaskBytes(taskModelTools()[0].Parameters).SHA3_512, SHA512: bindTaskBytes(taskModelTools()[0].Parameters).SHA512}) {
		return owner, result, errToolConflict
	}
	receipt, e := o.store.commitTaskReadAtEffectFence(owner.context, expected, func() error { return owner.claimAtEffect(owner.context) })
	if e != nil {
		return owner, result, e
	}
	original, e := marshalOriginalTaskResourceReceipt(receipt, r.AuthorityOperationID)
	if e != nil {
		return owner, result, e
	}
	result = OriginalTaskResourceReadResult{OperationID: r.AuthorityOperationID, State: "COMMITTED", Original: original, AuthScope: string(authgrant.EgressOnlyReadFence)}
	return owner, result, owner.Current(ctx)
}

func marshalOriginalTaskResourceReceipt(receipt taskReadReceipt, operation string) ([]byte, error) {
	receipt.OriginalOperationID = operation
	receipt.AuthorityOperationID = operation
	receipt.AuthScope = string(authgrant.EgressOnlyReadFence)
	return json.Marshal(receipt)
}

// ReadInput holds the original verification loan across the actual encrypted
// input read. The input is DATA for same-SQL reservation, never an authority.
func (o *OriginalTaskReadResource) ReadInput(ctx context.Context, request OriginalTaskResourceReadRequest) (owner *OriginalTaskResourceReadCall, input []byte, err error) {
	r := cloneOriginalResourceRequest(request)
	owner, err = o.begin(ctx, r, false)
	if err != nil {
		return owner, nil, err
	}
	b := r.Binding
	o.store.mu.Lock()
	defer o.store.mu.Unlock()
	task, err := o.store.ownedTaskLocked(b.Account, b.Task.ID)
	if err != nil {
		return owner, nil, err
	}
	record, ok := o.store.state.Actions[b.StepID]
	if !ok || record.Account != b.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID || record.ToolStep.ToolID != "ai.conversation.read" || record.ToolStep.TaskGrantRef != b.GrantID || strconv.FormatUint(task.Revision, 10) != b.Task.Revision || strconv.FormatUint(task.Generation, 10) != b.Generation || task.Holder != b.Holder.ID || !task.CancelledAt.IsZero() || (task.Status != "READY" && task.Status != "WORKING") || !reflect.DeepEqual(record.ToolStep.ApprovedFields, b.Fields) {
		return owner, nil, errToolConflict
	}
	if record.Status != "approved_not_executed" && record.Status != "DISPATCHING" && record.Status != "COMPLETED" {
		return owner, nil, errToolConflict
	}
	if err = o.store.assertTaskAgentConfigurationLocked(task, "ai.conversation.read"); err != nil {
		return owner, nil, err
	}
	schema := bindTaskBytes(taskModelTools()[0].Parameters)
	if b.Task.Kind != "task" || len(b.Resources) != 1 || len(b.Sources) != 1 || b.Resources[0].Kind != "conversation" || b.Resources[0].ID != task.ConversationID || b.Sources[0].Resource != b.Resources[0] || !reflect.DeepEqual(b.Sources[0].Fields, b.Fields) || b.Tool.Schema != (authgrant.Bind{Bytes: strconv.Itoa(schema.Bytes), SHA3_512: schema.SHA3_512, SHA512: schema.SHA512}) || record.ToolStep.Holder != task.Holder || record.ToolStep.Generation != task.Generation || record.ToolStep.ToolVersion != "1" || record.ConversationID != task.ConversationID {
		return owner, nil, errToolConflict
	}
	if err = owner.Current(ctx); err != nil {
		return owner, nil, err
	}
	plain, err := o.store.decrypt(b.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: task.ID}, Nonce: record.ToolStep.InputNonce, Cipher: record.ToolStep.InputCipher})
	if err != nil {
		return owner, nil, err
	}
	actual := bindTaskBytes([]byte(plain))
	if b.Input != (authgrant.Bind{Bytes: strconv.Itoa(actual.Bytes), SHA3_512: actual.SHA3_512, SHA512: actual.SHA512}) {
		return owner, nil, errToolConflict
	}
	if err = owner.Current(ctx); err != nil {
		return owner, nil, err
	}
	return owner, []byte(plain), nil
}

// Query borrows independent original HISTORY material. It never opens a
// NEW-effect guard, creates a replacement Grant or re-executes the read.
func (o *OriginalTaskReadResource) Query(ctx context.Context, request OriginalTaskResourceReadRequest) (OriginalTaskResourceReadResult, error) {
	r := cloneOriginalResourceRequest(request)
	b := r.Binding
	if r.OriginalOffset < 0 || r.OriginalOffset > 2<<20 || r.OriginalChunkBytes < 0 || r.OriginalChunkBytes > OriginalTaskReadMaxChunkBytes || r.OriginalChunkBytes == 0 && r.OriginalOffset != 0 {
		return OriginalTaskResourceReadResult{}, errToolInvalid
	}
	if o == nil || o.queryCurrent == nil || o.queryMaterial == nil || ctx == nil || r.Version != "1" || r.AuthorityOperationID == "" || len(r.AuthorityOperationID) > 256 || r.ExpectedGrantRevision != b.GrantRevision || r.AuthorizationRef == "" || len(r.AuthorizationRef) > 256 {
		return OriginalTaskResourceReadResult{}, errTaskEffectSourceUnavailable
	}
	call, err := o.retainCall(ctx)
	if err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	defer call.Close() // history borrows no effect Source; removal is synchronous
	ctx = call.context
	if err := o.historyCurrent(ctx); err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	o.store.mu.Lock()
	task, err := o.store.ownedTaskLocked(b.Account, b.Task.ID)
	record, exists := o.store.state.Actions[b.StepID]
	var input string
	if err == nil && (!exists || record.Account != b.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID || record.ToolStep.ToolID != "ai.conversation.read") {
		err = errToolConflict
	}
	if err == nil {
		input, err = o.store.decrypt(b.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: task.ID}, Nonce: record.ToolStep.InputNonce, Cipher: record.ToolStep.InputCipher})
	}
	o.store.mu.Unlock()
	if err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	material, err := o.queryMaterial(ctx, OriginalTaskAuthorizationRequest{AuthorizationRef: r.AuthorizationRef, QueryOriginal: true, OriginalOperationID: record.ID, Session: ProductSession{ID: b.SessionID, Account: b.Account, DeviceID: b.Holder.ID}, Task: task, Step: publicToolStep(record), Input: []byte(input)})
	if err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	if material.Call.OriginalOperation != r.AuthorityOperationID || !reflect.DeepEqual(material.Binding, b) || !reflect.DeepEqual(material.Call.Grant, r.Grant) || !reflect.DeepEqual(material.Call.Holder, r.Holder) {
		return OriginalTaskResourceReadResult{}, errToolConflict
	}
	o.store.mu.Lock()
	defer o.store.mu.Unlock()
	if err = o.historyCurrent(ctx); err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	if peer, e := link.LocalCallerFromContext(ctx); e == nil {
		if _, err = peer.Current(ctx); err != nil {
			return OriginalTaskResourceReadResult{}, err
		}
	}
	stored, ok := o.store.state.Actions[b.StepID]
	if !ok || stored.Account != b.Account || stored.ToolStep == nil || stored.ToolStep.AuthorityOperationID != r.AuthorityOperationID || stored.ToolStep.TaskGrantRef != b.GrantID {
		return OriginalTaskResourceReadResult{}, errToolConflict
	}
	if stored.Status != "COMPLETED" {
		return OriginalTaskResourceReadResult{OperationID: r.AuthorityOperationID, State: "UNKNOWN"}, nil
	}
	if stored.ToolStep.ResultAuthScope != string(authgrant.EgressOnlyReadFence) || !reflect.DeepEqual(stored.ToolStep.ResultFields, b.Fields) {
		return OriginalTaskResourceReadResult{}, errToolConflict
	}
	receipt, err := o.store.taskReadReceiptLocked(stored)
	if err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	original, err := marshalOriginalTaskResourceReceipt(receipt, r.AuthorityOperationID)
	if err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	result := OriginalTaskResourceReadResult{OperationID: r.AuthorityOperationID, State: "COMMITTED", Original: original, AuthScope: string(authgrant.EgressOnlyReadFence)}
	if r.OriginalChunkBytes != 0 {
		if r.OriginalOffset >= len(original) {
			return OriginalTaskResourceReadResult{}, errToolInvalid
		}
		end := r.OriginalOffset + r.OriginalChunkBytes
		if end > len(original) {
			end = len(original)
		}
		result.State, result.Original = "ORIGINAL_CHUNK", nil
		result.Chunk = &OriginalTaskResourceReadChunk{Offset: r.OriginalOffset, NextOffset: end, TotalBytes: len(original), Binding: bindTaskBytes(original), Bytes: bytes.Clone(original[r.OriginalOffset:end])}
	}
	if err = o.historyCurrent(ctx); err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	return result, nil
}

const OriginalTaskReadResourceService = "ynx-ai-original-task-read-v1"
const OriginalTaskReadInputPath = "/internal/ai/original-task-read/input"
const OriginalTaskReadExecutePath = "/internal/ai/original-task-read/execute"
const OriginalTaskReadQueryPath = "/internal/ai/original-task-read/query"

// Handler belongs behind the original LINK LocalCallerServer with exact finite
// routes and independently selected peer credentials. A public HTTP request or
// copied context cannot enter. It creates no listener or destination override.
func (o *OriginalTaskReadResource) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		peer, err := link.LocalCallerFromRequest(r)
		if err != nil {
			http.Error(w, "original resource caller denied", http.StatusForbidden)
			return
		}
		actual, err := peer.Current(r.Context())
		if err != nil || actual.Service != OriginalTaskReadResourceService || actual.Method != "POST" || actual.Path != r.URL.Path || actual.ContentType != "application/json" || r.URL.RawQuery != "" || len(actual.RequestBody) > 1<<20 {
			http.Error(w, "original finite resource route denied", http.StatusForbidden)
			return
		}
		if r.URL.Path != OriginalTaskReadInputPath && r.URL.Path != OriginalTaskReadExecutePath && r.URL.Path != OriginalTaskReadQueryPath {
			http.Error(w, "original finite resource route denied", http.StatusNotFound)
			return
		}
		var request OriginalTaskResourceReadRequest
		decoder := json.NewDecoder(bytes.NewReader(actual.RequestBody))
		decoder.DisallowUnknownFields()
		if !utf8.Valid(actual.RequestBody) || rejectDuplicateShopJSON(actual.RequestBody) != nil || decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
			http.Error(w, "invalid original resource DATA", http.StatusBadRequest)
			return
		}
		var owner *OriginalTaskResourceReadCall
		var result any
		switch r.URL.Path {
		case OriginalTaskReadInputPath:
			var input []byte
			owner, input, err = o.ReadInput(r.Context(), request)
			result = struct {
				Input []byte `json:"input"`
			}{input}
		case OriginalTaskReadExecutePath:
			owner, result, err = o.Execute(r.Context(), request)
		case OriginalTaskReadQueryPath:
			result, err = o.Query(r.Context(), request)
		}
		if owner != nil {
			if err == nil {
				err = owner.Current(r.Context())
			}
			err = errors.Join(err, owner.Close())
		}
		var response []byte
		if err == nil {
			response, err = marshalTaskResourceResponse(result)
		}
		if err == nil {
			_, err = peer.Current(r.Context())
		}
		status := http.StatusOK
		if err != nil {
			status = http.StatusConflict
			operation := request.AuthorityOperationID
			if len(operation) > 256 {
				operation = ""
			} // untrusted DATA cannot enlarge failure egress
			failure := struct {
				State, OriginalOperationID string
				Code                       string `json:"code,omitempty"`
				RecoverOnly                bool   `json:"recoverOnly,omitempty"`
				QueryPath                  string `json:"queryPath,omitempty"`
				ChunkBytes                 int    `json:"chunkBytes,omitempty"`
			}{State: "UNKNOWN", OriginalOperationID: operation}
			if errors.Is(err, errTaskResourceResponseLimit) && operation != "" {
				failure.Code, failure.RecoverOnly = "RESPONSE_LIMIT", true
				failure.QueryPath, failure.ChunkBytes = OriginalTaskReadQueryPath, OriginalTaskReadMaxChunkBytes
			}
			response, _ = marshalTaskResourceResponse(failure) // fixed bounded metadata, no receipt fragment
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(response)))
		w.WriteHeader(status)
		_, _ = w.Write(response) // a failed write never triggers an effect retry
	})
}

func marshalTaskResourceResponse(value any) ([]byte, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if len(body) >= OriginalTaskReadMaxResponseBytes {
		return nil, errTaskResourceResponseLimit
	}
	return append(body, '\n'), nil
}
