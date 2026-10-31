package aiproduct

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"unicode/utf8"

	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	authgrant "ynx.local/authgrantpolicy"
)

const shopOrderToolID = "shop.order.read"
const shopOrderToolPath = "/api/tools/shop.order.read"
const shopOrderModelName = "ynx_shop_order_read_v1"

// Local selected input, not the missing SDK Grant/Source wire. No actor,
// tenant, schema, risk, provider, URL or credential is selectable here.
type taskShopOrderInput struct {
	OrderID  string   `json:"orderId"`
	Fields   []string `json:"fields"`
	Snapshot string   `json:"snapshot"`
}

// Exact original Shop schema DATA, not authority or SDK wire.
//
//go:embed shop_order_read.input.schema.json
var shopOrderRegisteredInputSchema []byte
var shopOrderSnapshot = regexp.MustCompile(`^[0-9a-f]{128}$`)
var shopOrderOperationRef = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,256}$`)

// Original broker locators are opaque owned strings, never a URL/path to
// interpret or a caller-selected dispatch destination.
func validShopOrderRemoteRef(ref string) bool {
	return len(ref) > 0 && len(ref) <= 4096 && utf8.ValidString(ref)
}

func validShopOrderField(field string) bool {
	switch field {
	case "status", "currency", "totalYNXT", "subtotalYNXT", "shippingYNXT", "taxYNXT", "createdAt", "updatedAt", "reservationExpiresAt":
		return true
	}
	return false
}

func canonicalTaskToolInput(toolID string, raw []byte) ([]byte, string, error) {
	if toolID == shopOrderToolID {
		_, canonical, err := canonicalShopOrderInput(raw)
		return canonical, "", err
	}
	var selected conversationToolInput
	if toolID != "ai.conversation.read" || len(raw) == 0 || len(raw) > 32<<10 || strictToolJSON(bytes.NewReader(raw), &selected) != nil || selected.ConversationID == "" {
		return nil, "", errToolInvalid
	}
	canonical, err := json.Marshal(selected)
	return canonical, selected.ConversationID, err
}

func validateTaskToolApprovalFields(toolID string, raw []byte, task TaskRecord, fields []string) error {
	if toolID == shopOrderToolID {
		selected, canonical, err := canonicalShopOrderInput(raw)
		if err != nil || !bytes.Equal(canonical, raw) || !reflect.DeepEqual(selected.Fields, fields) {
			return errToolConflict
		}
		return nil
	}
	var selected conversationToolInput
	if toolID != "ai.conversation.read" || strictToolJSON(strings.NewReader(string(raw)), &selected) != nil || selected.ConversationID != task.ConversationID || len(fields) == 0 || len(fields) > 2 {
		return errToolInvalid
	}
	seen := map[string]bool{}
	for _, field := range fields {
		if seen[field] || (field != "conversation" && field != "messages") {
			return errToolInvalid
		}
		seen[field] = true
	}
	return nil
}

func canonicalShopOrderInput(raw []byte) (taskShopOrderInput, []byte, error) {
	var input taskShopOrderInput
	if len(raw) == 0 || len(raw) > 32<<10 || !utf8.Valid(raw) || rejectDuplicateShopJSON(raw) != nil || strictToolJSON(bytes.NewReader(raw), &input) != nil || len(input.OrderID) == 0 || len(input.OrderID) > 256 || !shopOrderSnapshot.MatchString(input.Snapshot) || len(input.Fields) == 0 || len(input.Fields) > 9 {
		return input, nil, errToolInvalid
	}
	seen := map[string]bool{}
	for _, field := range input.Fields {
		if seen[field] || !validShopOrderField(field) {
			return input, nil, errToolInvalid
		}
		seen[field] = true
	}
	sort.Strings(input.Fields)
	// Validate the actual original string representations with the SDK. Keep
	// pre-approval field sorting, but never repair unpaired Unicode escapes or
	// alternate-cased keys through encoding/json's replacement/case folding.
	var exact map[string]json.RawMessage
	if json.Unmarshal(raw, &exact) != nil || len(exact) != 3 || exact["orderId"] == nil || exact["fields"] == nil || exact["snapshot"] == nil {
		return input, nil, errToolInvalid
	}
	checked, err := json.Marshal(struct {
		OrderID  json.RawMessage `json:"orderId"`
		Fields   []string        `json:"fields"`
		Snapshot json.RawMessage `json:"snapshot"`
	}{exact["orderId"], input.Fields, exact["snapshot"]})
	if err != nil {
		return input, nil, err
	}
	if _, err := open.DecodeShopOrderReadInputDATA(checked); err != nil {
		return input, nil, errToolInvalid
	}
	canonical, err := json.Marshal(input)
	return input, canonical, err
}

// Reject ambiguous duplicate keys before decoding any selected input/result.
func rejectDuplicateShopJSON(raw []byte) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	var walk func(int) error
	walk = func(depth int) error {
		if depth > 16 {
			return errToolInvalid
		}
		token, err := d.Token()
		if err != nil {
			return err
		}
		delim, composite := token.(json.Delim)
		if !composite {
			return nil
		}
		if delim != '{' && delim != '[' {
			return errToolInvalid
		}
		keys := map[string]bool{}
		for d.More() {
			if delim == '{' {
				key, err := d.Token()
				if err != nil {
					return err
				}
				k, ok := key.(string)
				if !ok || keys[k] {
					return errToolInvalid
				}
				keys[k] = true
			}
			if err := walk(depth + 1); err != nil {
				return err
			}
		}
		_, err = d.Token()
		return err
	}
	if err := walk(0); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errToolInvalid
	}
	return nil
}

// Registered producer operands, never decoded from a model or HTTP request.
type OriginalShopOrderProfile struct {
	Tool      authgrant.Tool
	Target    authgrant.Sink
	OrderKind string
}

// OriginalShopOrderCall carries exact original identities and signed operands
// into the sole SDK codec / protected LINK caller. It is not a public wire.
type OriginalShopOrderCall struct {
	Binding             authgrant.TaskEffectBinding
	Grant, Holder       authgrant.Proof
	Input               []byte
	OriginalOperationID string
	RemoteRef           string
	Session             ProductSession
}

type OriginalShopOrderEncodedCall struct {
	Body        []byte
	ContentType string
}

type OriginalShopOrderTransportResult struct {
	Body        []byte
	ContentType string
	RemoteRef   string
	// In-process evidence from the actual protected caller. Never an HTTP
	// header, JSON capability, Source or permission; not serialized or logged.
	protectedTransport any
}

// RemoteRef, including on error, must be the protected producer's original
// bounded locator, never an unverified HTTP header. If none is supplied, query
// must still resolve by OriginalOperationID. A locator never proves execution.

// The product's thin adapter must decode with the original SDK DATA codec,
// then verify response proof and request association through the original
// protected Auth bridge before returning this value. Pure SDK decoding alone
// is not verification. The original operation, remote locator and Source must
// come from that authenticated response, never copied from the request or an
// HTTP header. Missing protected response contracts remain unavailable.
type OriginalShopOrderDecodedResult struct {
	OriginalOperationID string
	RemoteRef           string
	ResultJSON          []byte
	SourceBytes         []byte
	Source              authgrant.Source
	AuthScope           authgrant.FenceScope
}

type OriginalShopOrderCodec interface {
	DecodeShopOrderRead(context.Context, OriginalShopOrderCall, OriginalShopOrderTransportResult) (OriginalShopOrderDecodedResult, error)
}

// Implemented ONLY by the original protected LINK producer. The query method
// must authorize a read of the same original task+step slot using the Source's
// original effect-query path. It must never redispatch or mint a new slot.
// There is deliberately no http.Client/URL/transport-success fallback here.
// Call must acquire the actual LINK channel first, encode using the original
// SDK's real channel contract inside Exchange.PrepareWire, then synchronously
// invoke beforeSend before emitting those exact bytes. A missing SDK channel
// contract is unavailable; it cannot be replaced by pre-encoding or modifying
// already signed input. Only a protected adapter may implement this interface.
type OriginalShopOrderProtectedCaller interface {
	CallShopOrderRead(context.Context, authgrant.Sink, OriginalShopOrderCall, func(context.Context) error) (OriginalShopOrderTransportResult, error)
	QueryShopOrderRead(context.Context, authgrant.Sink, OriginalShopOrderCall) (OriginalShopOrderTransportResult, error)
}

type PreparedOriginalShopOrderTools struct {
	codec        OriginalShopOrderCodec
	caller       OriginalShopOrderProtectedCaller
	profile      OriginalShopOrderProfile
	currentFence func(context.Context) error
}

func PrepareOriginalShopOrderTools(ctx context.Context, codec OriginalShopOrderCodec, caller OriginalShopOrderProtectedCaller, profile OriginalShopOrderProfile, current func(context.Context) error) (*PreparedOriginalShopOrderTools, error) {
	p := &PreparedOriginalShopOrderTools{codec: codec, caller: caller, profile: profile, currentFence: current}
	if err := p.current(ctx); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *PreparedOriginalShopOrderTools) current(ctx context.Context) error {
	if p == nil || ctx == nil || missingTaskRuntimeOperand(p.codec) || missingTaskRuntimeOperand(p.caller) || p.currentFence == nil {
		return errTaskEffectSourceUnavailable
	}
	t, target := p.profile.Tool, p.profile.Target
	if t.ID != shopOrderToolID || t.Operation != shopOrderToolID || t.Version != "1" || t.Risk != "read" || t.Purpose == "" || t.Schema != shopAuthBind(shopOrderRegisteredInputSchema) || target.Path != shopOrderToolPath || target.Operation != shopOrderToolID || target.Service == "" || target.Tenant == "" || target.Origin == "" || target.Region == "" || p.profile.OrderKind == "" {
		return errTaskEffectSourceUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := p.currentFence(ctx); err != nil {
		return err
	}
	return ctx.Err()
}

func validShopAuthBind(binding authgrant.Bind) bool {
	n, err := strconv.ParseUint(binding.Bytes, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != binding.Bytes || len(binding.SHA3_512) != 128 || len(binding.SHA512) != 128 {
		return false
	}
	_, a := hex.DecodeString(binding.SHA3_512)
	_, b := hex.DecodeString(binding.SHA512)
	return a == nil && b == nil
}

func shopAuthBind(raw []byte) authgrant.Bind {
	b := bindTaskBytes(raw)
	return authgrant.Bind{Bytes: strconv.Itoa(b.Bytes), SHA3_512: b.SHA3_512, SHA512: b.SHA512}
}

// Validate for normal-runtime resolve/approval before its held Auth check.
func (p *PreparedOriginalShopOrderTools) validateTaskOrderAuthorization(ctx context.Context, store *Store, call taskEffectCall, authorization OriginalTaskGrantAuthorization) error {
	_, err := p.selected(ctx, store, call, authorization, false)
	return err
}

func (p *PreparedOriginalShopOrderTools) selected(ctx context.Context, store *Store, call taskEffectCall, authorization OriginalTaskGrantAuthorization, query bool) (OriginalShopOrderCall, error) {
	if err := p.current(ctx); err != nil {
		return OriginalShopOrderCall{}, err
	}
	if store == nil || missingTaskRuntimeOperand(authorization.Verifier) {
		return OriginalShopOrderCall{}, errTaskEffectSourceUnavailable
	}
	return selectOriginalShopOrderCall(store, call, authorization, p.profile, query)
}

// Local identity/DATA selection only. Authority comes from the original
// verifier or broker; a historical selection never opens a new Grant check.
func selectOriginalShopOrderCall(store *Store, call taskEffectCall, authorization OriginalTaskGrantAuthorization, profile OriginalShopOrderProfile, query bool) (OriginalShopOrderCall, error) {
	var zero OriginalShopOrderCall
	if store == nil {
		return zero, errTaskEffectSourceUnavailable
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	task, err := store.ownedTaskLocked(call.Account, call.CurrentTask.ID)
	record, exists := store.state.Actions[call.OriginalOperationID]
	if err != nil || !exists || record.Account != call.Account || record.ToolStep == nil || record.ToolStep.TaskID != task.ID {
		return zero, errToolNotFound
	}
	step, b := record.ToolStep, authorization.Binding
	if step.ToolID != shopOrderToolID || step.ToolVersion != "1" || call.Session.ID == "" || call.Session.Account != task.Account || b.SessionID != call.Session.ID || b.Account != task.Account || b.StepID != record.ID || b.Task.ID != task.ID || b.Task.Revision != strconv.FormatUint(step.TaskRevision, 10) || b.Generation != strconv.FormatUint(step.Generation, 10) || b.Holder.ID != step.Holder || b.Tool != profile.Tool || b.Target != profile.Target || b.Audience != profile.Target.Service || b.Tenant != profile.Target.Tenant || b.EgressActual != nil || len(b.Resources) != 1 || len(b.Sources) != 1 {
		return zero, errToolConflict
	}
	if !query {
		if task.Revision != step.TaskRevision || task.Generation != step.Generation || task.Holder != step.Holder || task.Holder != call.Session.DeviceID || !task.CancelledAt.IsZero() {
			return zero, errToolConflict
		}
		if err := store.assertTaskAgentConfigurationLocked(task, shopOrderToolID); err != nil {
			return zero, err
		}
	}
	if step.TaskGrantRef != "" && step.TaskGrantRef != b.GrantID {
		return zero, errToolConflict
	}
	if step.TaskGrantRef != "" && !reflect.DeepEqual(step.ApprovedFields, b.Fields) {
		return zero, errToolConflict
	}
	raw, err := store.decrypt(record.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: task.ID}, Nonce: step.InputNonce, Cipher: step.InputCipher})
	if err != nil {
		return zero, err
	}
	selection, canonical, err := canonicalShopOrderInput([]byte(raw))
	if err != nil || !bytes.Equal(canonical, []byte(raw)) || b.Input != shopAuthBind(canonical) || !reflect.DeepEqual(b.Fields, selection.Fields) {
		return zero, errToolConflict
	}
	resource, source := b.Resources[0], b.Sources[0]
	if resource.ID != selection.OrderID || resource.Kind != profile.OrderKind || resource.Realm != b.Realm || resource.Tenant != b.Tenant || source.Resource != resource || !reflect.DeepEqual(source.Fields, selection.Fields) || !validShopAuthBind(source.Binding) {
		return zero, errToolConflict
	}
	if query {
		if (record.Status != "UNKNOWN" && record.Status != "DISPATCHING" && record.Status != "RECONCILING") || step.RemoteOperationID != record.ID {
			return zero, errToolConflict
		}
	} else if record.Status != "NEEDS_APPROVAL" && record.Status != "DISPATCHING" && record.Status != "approved_not_executed" {
		return zero, errToolConflict
	}
	// Snapshot identity is in the exact canonical Input; Source/resource revision
	// is the original authority's reference, never invented from this hash.
	return cloneShopOrderCall(OriginalShopOrderCall{Binding: b, Grant: authorization.Grant, Holder: authorization.Holder, Input: canonical, OriginalOperationID: record.ID, RemoteRef: step.RemoteRef, Session: call.Session}), nil
}

func cloneShopOrderCall(call OriginalShopOrderCall) OriginalShopOrderCall {
	call.Input = bytes.Clone(call.Input)
	call.Grant.Payload, call.Grant.Wire = bytes.Clone(call.Grant.Payload), bytes.Clone(call.Grant.Wire)
	call.Holder.Payload, call.Holder.Wire = bytes.Clone(call.Holder.Payload), bytes.Clone(call.Holder.Wire)
	call.Binding.Fields = append([]string(nil), call.Binding.Fields...)
	call.Binding.Resources = append([]authgrant.Ref(nil), call.Binding.Resources...)
	call.Binding.Sources = append([]authgrant.Source(nil), call.Binding.Sources...)
	for i := range call.Binding.Sources {
		call.Binding.Sources[i].Fields = append([]string(nil), call.Binding.Sources[i].Fields...)
	}
	call.Session.Scopes = append([]string(nil), call.Session.Scopes...)
	return call
}

// Query deliberately does NOT open a NEW-effect Auth guard. UNKNOWN is owned
// by the original protected Source's query path inside the LINK caller.
func (p *PreparedOriginalShopOrderTools) reconcileTaskOrder(ctx context.Context, store *Store, call taskEffectCall, authorization OriginalTaskGrantAuthorization) (taskReadReceipt, error) {
	selected, err := p.selected(ctx, store, call, authorization, true)
	if err != nil {
		return taskReadReceipt{}, err
	}
	response, err := p.caller.QueryShopOrderRead(ctx, p.profile.Target, cloneShopOrderCall(selected))
	locatorErr := captureShopRemoteRef(store, selected, response.RemoteRef)
	if err != nil || locatorErr != nil {
		return taskReadReceipt{}, errors.Join(errTaskEffectUnresolved, err, locatorErr)
	}
	return p.acceptResult(ctx, store, call, selected, response)
}

func (p *PreparedOriginalShopOrderTools) dispatchTaskOrder(ctx context.Context, store *Store, call taskEffectCall, authorization OriginalTaskGrantAuthorization) (receipt taskReadReceipt, err error) {
	selected, err := p.selected(ctx, store, call, authorization, false)
	if err != nil {
		return receipt, err
	}
	if call.OriginalStep.Status != "DISPATCHING" || call.OriginalStep.ToolStep == nil || call.OriginalStep.ToolStep.TaskGrantRef == "" || !reflect.DeepEqual(call.OriginalStep.ToolStep.ApprovedFields, selected.Binding.Fields) {
		return receipt, errToolConflict
	}
	held, err := authgrant.OpenTaskGrantAtEffect(ctx, authorization.Verifier, selected.Binding, selected.Grant, selected.Holder)
	if held != nil {
		defer func() {
			if closeErr := held.Close(); closeErr != nil {
				err = errors.Join(err, closeErr)
			}
		}()
	}
	if err != nil {
		return receipt, err
	}
	if _, err = authgrant.CheckTaskGrantAtEffect(ctx, held); err != nil {
		return receipt, err
	}
	var checked atomic.Bool
	beforeSend := func(sendCtx context.Context) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if sendCtx == nil {
			return errTaskEffectSourceUnavailable
		}
		if err := p.current(sendCtx); err != nil {
			return err
		}
		if _, err := p.selected(sendCtx, store, call, authorization, false); err != nil {
			return err
		}
		// This is an egress fence; Shop still checks under its original order lock.
		if _, err := authgrant.CheckTaskGrantAtEffect(sendCtx, held); err != nil {
			return err
		}
		checked.Store(true)
		return nil
	}
	response, err := p.caller.CallShopOrderRead(ctx, p.profile.Target, cloneShopOrderCall(selected), beforeSend)
	locatorErr := captureShopRemoteRef(store, selected, response.RemoteRef)
	if !checked.Load() {
		return receipt, errors.Join(errTaskEffectUnresolved, errTaskEffectSourceUnavailable, err, locatorErr)
	}
	if err != nil || locatorErr != nil {
		return receipt, errors.Join(errTaskEffectUnresolved, err, locatorErr)
	}
	return p.acceptResult(ctx, store, call, selected, response)
}
