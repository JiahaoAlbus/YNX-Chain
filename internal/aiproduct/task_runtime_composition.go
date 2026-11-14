package aiproduct

import (
	"context"
	"errors"
	"io/fs"
	"reflect"
	"strconv"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
	authgrant "ynx.local/authgrantpolicy"
)

// These operands belong to normal in-process composition. They are neither a
// Grant wire format nor an HTTP authority registration surface.
type OriginalTaskAuthorizationRequest struct {
	AuthorizationRef    string
	Session             ProductSession
	QueryOriginal       bool
	OriginalOperationID string
	Task                TaskRecord
	Step                ActionRecord
	Input               []byte
}
type OriginalTaskGrantAuthorization struct {
	Verifier      authgrant.OriginalTaskGrantVerifier
	Binding       authgrant.TaskEffectBinding
	Grant, Holder authgrant.Proof
}

// The original protected producer implements this bridge. A product session
// and a model response cannot implement its signature/source verification.
// CheckTaskModelDisclosure must independently authorize the exact destination,
// fixed model and outgoing bytes, including every private tool result.
type OriginalTaskRuntimeAuthority interface {
	Current(context.Context) error
	ResolveTaskGrant(context.Context, OriginalTaskAuthorizationRequest) (OriginalTaskGrantAuthorization, error)
	CheckTaskModelDisclosure(context.Context, ProductSession, TaskRecord, string, string, []byte) error
}

type PreparedOriginalTaskRuntime struct {
	webDAV       *PreparedTaskWebDAVRuntime
	model        *aigateway.Service
	authority    OriginalTaskRuntimeAuthority
	shop         *PreparedOriginalShopOrderTools
	broker       *originalTaskAuthorityBroker
	owners       *originalTaskRuntimeOwners
	recoveryOnly error
}

func missingTaskRuntimeOperand(v any) bool {
	if v == nil {
		return true
	}
	r := reflect.ValueOf(v)
	switch r.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Func, reflect.Map, reflect.Slice, reflect.Chan:
		return r.IsNil()
	}
	return false
}

// Preparation is not Source admission. The real producer's current fence is
// checked at construction and again at each use. No environment flag, zero
// value, request body or process-global setter can install this runtime.
func PrepareOriginalTaskRuntime(ctx context.Context, model *aigateway.Service, authority OriginalTaskRuntimeAuthority) (*PreparedOriginalTaskRuntime, error) {
	if ctx == nil || model == nil || missingTaskRuntimeOperand(authority) {
		return nil, errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := authority.Current(ctx); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return &PreparedOriginalTaskRuntime{model: model, authority: authority}, nil
}

// The Shop path requires its original SDK codec, registered profile and
// protected LINK caller together. Preparing a local-only runtime does not
// silently enable a remote order tool.
func PrepareOriginalTaskRuntimeWithShop(ctx context.Context, model *aigateway.Service, authority OriginalTaskRuntimeAuthority, shop *PreparedOriginalShopOrderTools) (*PreparedOriginalTaskRuntime, error) {
	if shop == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	if err := shop.current(ctx); err != nil {
		return nil, err
	}
	p, err := PrepareOriginalTaskRuntime(ctx, model, authority)
	if err != nil {
		return nil, err
	}
	p.shop = shop
	if err := p.current(ctx); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *PreparedOriginalTaskRuntime) current(ctx context.Context) error {
	if p != nil && p.recoveryOnly != nil {
		return p.recoveryOnly
	}
	if ctx == nil || p == nil || p.model == nil || missingTaskRuntimeOperand(p.authority) {
		return errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := p.authority.Current(ctx); err != nil {
		return err
	}
	if p.shop != nil {
		if err := p.shop.current(ctx); err != nil {
			return err
		}
	}
	if p.broker != nil {
		if err := p.broker.effectCurrent(ctx); err != nil {
			return err
		}
	}
	return ctx.Err()
}

// OpenOriginal preserves the original Store opener and fails before touching
// product state when custody is unavailable. It creates no second task store.
func (p *PreparedOriginalTaskRuntime) OpenOriginal(ctx context.Context, cfg Config, open func() (*Store, error), static fs.FS) (*Server, error) {
	if err := p.current(ctx); err != nil {
		return nil, err
	}
	if open == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	store, err := open()
	if err != nil {
		return nil, err
	}
	if store == nil {
		return nil, errTaskEffectSourceUnavailable
	}
	if err := p.current(ctx); err != nil {
		return nil, err
	}
	cfg.TaskRuntime = p
	server, err := NewServer(cfg, store, static)
	if err != nil {
		return nil, err
	}
	if err := p.current(ctx); err != nil {
		return nil, err
	}
	return server, nil
}

func (p *PreparedOriginalTaskRuntime) install(s *Server) error {
	check := p.current
	if p != nil && p.owners != nil {
		check = p.queryCurrent
	}
	if err := check(context.Background()); err != nil {
		return err
	}
	if _, native := p.authority.(*nativeTaskRuntimeAuthority); native && p.broker == nil {
		return errTaskEffectSourceUnavailable
	}
	if s == nil || s.store == nil {
		return errTaskEffectSourceUnavailable
	}
	if s.cfg.AllowLocalFixtureAuth {
		return errors.New("original task runtime cannot use fixture authentication")
	}
	s.taskModel = p.model
	s.taskPages, _ = p.authority.(OriginalTaskPagesAuthority)
	s.webDAV = p.webDAV
	s.toolEffects = &originalRuntimeToolEffects{runtime: p, store: s.store}
	s.taskModelAdmit = func(ctx context.Context, session ProductSession, task TaskRecord, url, model string, body []byte) error {
		if err := p.current(ctx); err != nil {
			return err
		}
		if err := p.authority.CheckTaskModelDisclosure(ctx, session, task, url, model, append([]byte(nil), body...)); err != nil {
			return err
		}
		return p.current(ctx)
	}
	return nil
}

type originalRuntimeToolEffects struct {
	runtime    *PreparedOriginalTaskRuntime
	store      *Store
	receiverMu sync.Mutex
	receiver   *OriginalTaskReadReceiver // borrowed; normal main owns shutdown
}

func (e *originalRuntimeToolEffects) resolve(ctx context.Context, call taskEffectCall, ref string, query ...bool) (OriginalTaskGrantAuthorization, error) {
	var zero OriginalTaskGrantAuthorization
	if e == nil || e.store == nil {
		return zero, errTaskEffectSourceUnavailable
	}
	if err := e.runtime.current(ctx); err != nil {
		return zero, err
	}
	if ref == "" || len(ref) > 256 {
		return zero, errToolInvalid
	}
	e.store.mu.Lock()
	live, err := e.store.ownedTaskLocked(call.Account, call.CurrentTask.ID)
	record, exists := e.store.state.Actions[call.OriginalStep.ID]
	var input string
	if err == nil && (!exists || record.Account != call.Account || record.ToolStep == nil || record.ToolStep.TaskID != live.ID) {
		err = errToolNotFound
	}
	if err == nil && (live.Holder != call.CurrentTask.Holder || live.Generation != call.CurrentTask.Generation || live.Revision != call.CurrentTask.Revision) {
		err = errToolConflict
	}
	if err == nil {
		input, err = e.store.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: live.ID}, Nonce: record.ToolStep.InputNonce, Cipher: record.ToolStep.InputCipher})
	}
	e.store.mu.Unlock()
	if err != nil {
		return zero, err
	}
	if call.Session.ID == "" || call.Session.Account != call.Account || call.Session.DeviceID != live.Holder {
		return zero, errToolConflict
	}
	if (record.ToolStep.ToolID != "ai.conversation.read" && record.ToolStep.ToolID != shopOrderToolID) || record.ToolStep.ToolVersion != "1" {
		return zero, errToolInvalid
	}
	if record.ToolStep.ToolID == shopOrderToolID && e.runtime.shop == nil && e.runtime.broker == nil {
		return zero, errTaskEffectSourceUnavailable
	}
	queryOriginal := len(query) == 1 && query[0]
	session := call.Session
	session.Scopes = append([]string(nil), session.Scopes...)
	request := OriginalTaskAuthorizationRequest{AuthorizationRef: ref, Session: session, QueryOriginal: queryOriginal, OriginalOperationID: record.ID, Task: live, Step: publicToolStep(record), Input: []byte(input)}
	if _, err := bindOriginalGrantRequest(request); err != nil {
		return zero, err
	}
	auth, err := e.runtime.authority.ResolveTaskGrant(ctx, request)
	if err != nil {
		return zero, err
	}
	if err = e.runtime.current(ctx); err != nil {
		return zero, err
	}
	b := auth.Binding
	// ChannelBinding is verified by the original protected producer. The
	// product session's separate SessionBinding is not a transport channel.
	if b.SessionID != session.ID {
		return zero, errToolConflict
	}
	if record.ToolStep.ToolID == shopOrderToolID {
		if e.runtime.broker != nil {
			_, err := e.runtime.broker.selected(e.store, call, auth, queryOriginal)
			return auth, err
		}
		if e.runtime.shop == nil {
			return zero, errTaskEffectSourceUnavailable
		}
		if _, err := e.runtime.shop.selected(ctx, e.store, call, auth, queryOriginal); err != nil {
			return zero, err
		}
		return auth, nil
	}
	raw := bindTaskBytes([]byte(input))
	schema := bindTaskBytes(taskModelTools()[0].Parameters)
	expectedBind := func(v taskBytesBinding) authgrant.Bind {
		return authgrant.Bind{Bytes: strconv.Itoa(v.Bytes), SHA3_512: v.SHA3_512, SHA512: v.SHA512}
	}
	if missingTaskRuntimeOperand(auth.Verifier) || b.Account != call.Account || b.Task.ID != live.ID || b.Task.Revision != strconv.FormatUint(live.Revision, 10) || b.Generation != strconv.FormatUint(live.Generation, 10) || b.Holder.ID != live.Holder || b.StepID != record.ID || b.Tool.ID != record.ToolStep.ToolID || b.Tool.Operation != record.ToolStep.ToolID || b.Tool.Version != "1" || b.Tool.Risk != "read" || b.Tool.Schema != expectedBind(schema) || b.Input != expectedBind(raw) || b.EgressActual != nil || len(b.Resources) != 1 || len(b.Sources) != 1 || b.Resources[0].ID != live.ConversationID || b.Sources[0].Resource != b.Resources[0] {
		return zero, errToolConflict
	}
	if record.ToolStep.TaskGrantRef != "" && b.GrantID != record.ToolStep.TaskGrantRef {
		return zero, errToolConflict
	}
	return auth, nil
}

func (e *originalRuntimeToolEffects) approveTaskStep(ctx context.Context, call taskEffectCall, ref string) (err error) {
	auth, err := e.resolve(ctx, call, ref)
	if err != nil {
		return err
	}
	held, err := authgrant.OpenTaskGrantAtEffect(ctx, auth.Verifier, auth.Binding, auth.Grant, auth.Holder)
	if held != nil {
		defer func() {
			if closeErr := held.Close(); closeErr != nil {
				err = errors.Join(err, closeErr)
			}
		}()
	}
	if err != nil {
		return err
	}
	b := auth.Binding
	expected := taskReadExpectation{Account: b.Account, TaskID: b.Task.ID, StepID: b.StepID, Holder: b.Holder.ID, TaskRevision: call.CurrentTask.Revision, Generation: call.CurrentTask.Generation, Input: taskBytesBinding{Bytes: 0, SHA3_512: b.Input.SHA3_512, SHA512: b.Input.SHA512}, Fields: append([]string(nil), b.Fields...)}
	n, err := strconv.Atoi(b.Input.Bytes)
	if err != nil {
		return err
	}
	expected.Input.Bytes = n
	_, err = e.store.commitTaskApprovalAtFence(ctx, expected, b.GrantID, func() error {
		if err := e.runtime.current(ctx); err != nil {
			return err
		}
		_, err := authgrant.CheckTaskGrantAtEffect(ctx, held)
		return err
	})
	return err
}

func (e *originalRuntimeToolEffects) dispatchTaskTool(ctx context.Context, call taskEffectCall, ref string) (taskReadReceipt, error) {
	if err := e.taskToolAvailable(ctx, call.OriginalStep.ToolStep.ToolID); err != nil {
		return taskReadReceipt{}, err
	}
	auth, err := e.resolve(ctx, call, ref)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if call.OriginalStep.ToolStep.ToolID == shopOrderToolID {
		if e.runtime.broker != nil {
			return e.runtime.broker.dispatch(ctx, e, call, ref, auth)
		}
		return e.runtime.shop.dispatchTaskOrder(ctx, e.store, call, auth)
	}
	if e.runtime.broker != nil {
		return e.runtime.broker.dispatchConversation(ctx, e, call, ref, auth)
	}
	outcome, err := e.store.commitOriginalAuthTaskRead(ctx, auth.Verifier, auth.Binding, auth.Grant, auth.Holder)
	if err != nil {
		return outcome.Receipt, err
	}
	if err = e.runtime.current(ctx); err != nil {
		return outcome.Receipt, err
	}
	return outcome.Receipt, nil
}

func (e *originalRuntimeToolEffects) reconcileTaskTool(ctx context.Context, call taskEffectCall, ref string) (taskReadReceipt, error) {
	// A local resource has no remote dispatch to retry. A durable committed
	// result is read by the existing reconciliation route; an unresolved slot
	// stays unresolved. Never re-execute the read under a replacement Grant.
	if err := e.runtime.queryCurrent(ctx); err != nil {
		return taskReadReceipt{}, errors.Join(errTaskEffectSourceUnavailable, err)
	}
	if e.runtime.broker != nil {
		return e.runtime.broker.reconcile(ctx, e, call, ref)
	}
	if source, ok := e.runtime.authority.(originalTaskOperationQueryAuthority); ok {
		return e.queryOriginalAuthorityReference(ctx, call, ref, source)
	}
	if call.OriginalStep.ToolStep != nil && call.OriginalStep.ToolStep.ToolID == shopOrderToolID {
		auth, err := e.resolve(ctx, call, ref, true)
		if err != nil {
			return taskReadReceipt{}, err
		}
		return e.runtime.shop.reconcileTaskOrder(ctx, e.store, call, auth)
	}
	return taskReadReceipt{}, errTaskEffectUnresolved
}
