package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
	authgrant "ynx.local/authgrantpolicy"
)

// PUBLIC LOCAL CONTRACT FIXTURES ONLY. This JSON encoding and HTTP caller are
// NOT the missing sole SDK codec, protected LINK client, PQ verifier, actual
// Shop database or admitted normal runtime. Production has no such fallback.
type p08ShopLocalEnvelope struct {
	Operation   string
	RemoteRef   string
	Projection  json.RawMessage
	SourceBytes []byte
	Source      authgrant.Source
	Scope       authgrant.FenceScope
}

type p08ShopCodecFixture struct {
	mutate   func(*p08ShopLocalEnvelope)
	onDecode func()
	onEncode func()
}

func (c *p08ShopCodecFixture) EncodeShopOrderRead(_ context.Context, call OriginalShopOrderCall) (OriginalShopOrderEncodedCall, error) {
	if c.onEncode != nil {
		c.onEncode()
	}
	body, err := json.Marshal(struct {
		Input     json.RawMessage
		Operation string
	}{call.Input, call.OriginalOperationID})
	return OriginalShopOrderEncodedCall{Body: body, ContentType: "application/json"}, err
}
func (c *p08ShopCodecFixture) DecodeShopOrderRead(_ context.Context, _ OriginalShopOrderCall, response OriginalShopOrderTransportResult) (OriginalShopOrderDecodedResult, error) {
	var envelope p08ShopLocalEnvelope
	if err := strictToolJSON(bytes.NewReader(response.Body), &envelope); err != nil {
		return OriginalShopOrderDecodedResult{}, err
	}
	if c.mutate != nil {
		c.mutate(&envelope)
	}
	if c.onDecode != nil {
		c.onDecode()
	}
	return OriginalShopOrderDecodedResult{OriginalOperationID: envelope.Operation, RemoteRef: envelope.RemoteRef, ResultJSON: envelope.Projection, SourceBytes: envelope.SourceBytes, Source: envelope.Source, AuthScope: envelope.Scope}, nil
}

type p08ShopCallerFixture struct {
	codec             *p08ShopCodecFixture
	onAcquire         func()
	omitFence         bool
	url               string
	client            *http.Client
	calls, queries    atomic.Int32
	callErr, queryErr error
	callRef, queryRef string
	omitCallRef       bool
}

func (c *p08ShopCallerFixture) exchange(ctx context.Context, path string, call OriginalShopOrderCall, body []byte) (OriginalShopOrderTransportResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url+path, bytes.NewReader(body))
	if err != nil {
		return OriginalShopOrderTransportResult{}, err
	}
	req.Header.Set("X-PUBLIC-Original-Operation", call.OriginalOperationID)
	response, err := c.client.Do(req)
	if err != nil {
		return OriginalShopOrderTransportResult{}, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil {
		return OriginalShopOrderTransportResult{}, err
	}
	if response.StatusCode != http.StatusOK {
		return OriginalShopOrderTransportResult{}, fmt.Errorf("PUBLIC fixture returned %d", response.StatusCode)
	}
	return OriginalShopOrderTransportResult{Body: raw, ContentType: "application/json", RemoteRef: "shop-original-ref"}, nil
}
func (c *p08ShopCallerFixture) CallShopOrderRead(ctx context.Context, target authgrant.Sink, call OriginalShopOrderCall, beforeSend func(context.Context) error) (OriginalShopOrderTransportResult, error) {
	if target.Path != shopOrderToolPath || target.Operation != shopOrderToolID {
		return OriginalShopOrderTransportResult{}, errToolInvalid
	}
	// PUBLIC ordering fixture only; real LINK/SDK must use the actual sealed
	// TLS channel in Exchange.PrepareWire, not this loopback transport.
	if c.onAcquire != nil {
		c.onAcquire()
	}
	if c.codec == nil || beforeSend == nil {
		return OriginalShopOrderTransportResult{}, errTaskEffectSourceUnavailable
	}
	encoded, err := c.codec.EncodeShopOrderRead(ctx, call)
	if err != nil {
		return OriginalShopOrderTransportResult{}, err
	}
	if !c.omitFence {
		if err := beforeSend(ctx); err != nil {
			return OriginalShopOrderTransportResult{}, err
		}
	}
	c.calls.Add(1)
	response, err := c.exchange(ctx, shopOrderToolPath, call, encoded.Body)
	if c.callRef != "" {
		response.RemoteRef = c.callRef
	}
	if c.omitCallRef {
		response.RemoteRef = ""
	}
	return response, errors.Join(err, c.callErr)
}
func (c *p08ShopCallerFixture) QueryShopOrderRead(ctx context.Context, _ authgrant.Sink, call OriginalShopOrderCall) (OriginalShopOrderTransportResult, error) {
	c.queries.Add(1)
	// Local fixture path only: actual Source producer must use its original
	// effect-query service/channel, never POST the Shop dispatch endpoint again.
	response, err := c.exchange(ctx, "/__PUBLIC_fixture__/original-effect-query", call, call.Input)
	if c.queryRef != "" {
		response.RemoteRef = c.queryRef
	}
	return response, errors.Join(err, c.queryErr)
}

type p08ShopFixture struct {
	t                *testing.T
	store            *Store
	key              []byte
	task             TaskRecord
	session          ProductSession
	input            []byte
	selection        taskShopOrderInput
	step             ActionRecord
	template         authgrant.TaskEffectBinding
	held             *p08OriginalHeldFixture
	profile          OriginalShopOrderProfile
	codec            *p08ShopCodecFixture
	caller           *p08ShopCallerFixture
	authority        *p08RuntimeAuthorityFixture
	bridge           *PreparedOriginalShopOrderTools
	prepared         *PreparedOriginalTaskRuntime
	server           *Server
	projection, data []byte
	providerRequests atomic.Int32
	queryRequests    atomic.Int32
	queryOriginal    bool
}

func newP08ShopFixture(t *testing.T, withProposal bool) *p08ShopFixture {
	t.Helper()
	store, binding, held := p08OriginalAuthFixture(t)
	f := &p08ShopFixture{t: t, store: store, key: bytes.Repeat([]byte{83}, 32), template: binding, held: held, codec: &p08ShopCodecFixture{}}
	f.task = store.state.Tasks[binding.Task.ID]
	f.session = ProductSession{ID: binding.SessionID, Account: binding.Account, DeviceID: binding.Holder.ID, Scopes: []string{"ai:conversations", "ai:permissions", "ai:generate"}, SessionBinding: "product-session-binding-is-not-auth-channel"}
	f.selection = taskShopOrderInput{OrderID: "order-original", Snapshot: strings.Repeat("a", 128), Fields: []string{"currency", "status", "totalYNXT"}}
	f.input, _ = json.Marshal(f.selection)
	f.data = []byte(`{"currency":"YNXT","status":"processing","totalYNXT":"17"}`)
	f.projection, _ = json.Marshal(taskShopOrderProjection{OrderID: f.selection.OrderID, Snapshot: f.selection.Snapshot, Fields: f.selection.Fields, Data: map[string]json.RawMessage{"currency": json.RawMessage(`"YNXT"`), "status": json.RawMessage(`"processing"`), "totalYNXT": json.RawMessage(`"17"`)}})
	f.profile = OriginalShopOrderProfile{Tool: authgrant.Tool{ID: shopOrderToolID, Operation: shopOrderToolID, Version: "1", Purpose: "read-exact-order", Risk: "read", Schema: shopAuthBind(shopOrderRegisteredInputSchema)}, Target: authgrant.Sink{Service: "isolated-shop", Tenant: binding.Tenant, Origin: "https://shop.invalid", Path: shopOrderToolPath, Region: "isolated", Operation: shopOrderToolID}, OrderKind: "shop-order"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/status":
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"PUBLIC-fixture","nativeCurrencySymbol":"YNXT"}`))
			return
		case "/chat/completions":
			var payload struct {
				Messages []struct {
					Role, Content string
					ID            string `json:"tool_call_id"`
				}
				Tools []json.RawMessage
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
				return
			}
			round := f.providerRequests.Add(1)
			if len(payload.Tools) != 1 || !bytes.Contains(payload.Tools[0], []byte(shopOrderModelName)) {
				t.Error("model tools were not pinned to explicit Shop selection")
			}
			if round == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "original-shop-model-call", "type": "function", "function": map[string]string{"name": shopOrderModelName, "arguments": string(f.input)}}}}}}})
			} else {
				last := payload.Messages[len(payload.Messages)-1]
				if last.Role != "tool" || last.ID != "original-shop-model-call" || !strings.Contains(last.Content, "processing") || !strings.Contains(last.Content, "shop-original-ref") {
					t.Error("model did not receive exact original call/verified Shop bytes")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "Actual PUBLIC HTTP provider answer for the verified order."}}}})
			}
			return
		case "/__PUBLIC_fixture__/original-effect-query":
			f.queryRequests.Add(1)
		case shopOrderToolPath:
		default:
			http.Error(w, "PUBLIC fixture target mismatch", 400)
			return
		}
		operation := r.Header.Get("X-PUBLIC-Original-Operation")
		if r.Method != http.MethodPost || operation == "" {
			http.Error(w, "PUBLIC target/method/operation mismatch", 403)
			return
		}
		if r.URL.Path == shopOrderToolPath {
			var encoded struct {
				Input     json.RawMessage
				Operation string
			}
			if json.NewDecoder(r.Body).Decode(&encoded) != nil || encoded.Operation != operation || !bytes.Equal(encoded.Input, f.input) {
				http.Error(w, "PUBLIC exact canonical input mismatch", 403)
				return
			}
		}
		resource := f.template.Resources[0]
		resource.Kind, resource.ID = f.profile.OrderKind, f.selection.OrderID
		_ = json.NewEncoder(w).Encode(p08ShopLocalEnvelope{Operation: operation, RemoteRef: "shop-original-ref", Projection: f.projection, SourceBytes: f.data, Source: authgrant.Source{Resource: resource, Fields: f.selection.Fields, Label: "RESTRICTED", Binding: shopAuthBind(f.data)}, Scope: authgrant.EgressOnlyReadFence})
	}))
	t.Cleanup(server.Close)
	f.caller = &p08ShopCallerFixture{url: server.URL, client: server.Client(), codec: f.codec}
	var err error
	f.bridge, err = PrepareOriginalShopOrderTools(context.Background(), f.codec, f.caller, f.profile, func(context.Context) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	f.authority = &p08RuntimeAuthorityFixture{}
	f.authority.mutate = func(request *OriginalTaskAuthorizationRequest) {
		f.queryOriginal = request.QueryOriginal
		if request.Session.ID != f.session.ID || request.Session.SessionBinding == f.template.ChannelBinding || !bytes.Equal(request.Input, f.input) {
			t.Error("normal authority request lost original session/canonical input")
		}
		f.authority.authorization = f.authorization(request.Task, request.Step)
	}
	model, err := aigateway.New(aigateway.Config{ChainURL: server.URL, ProviderURL: server.URL, Model: "PUBLIC-fixed-model", ProviderAPIKey: "PUBLIC-model-key", AccessAPIKey: "PUBLIC-access", UpstreamKey: "PUBLIC-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	f.prepared, err = PrepareOriginalTaskRuntimeWithShop(context.Background(), model, f.authority, f.bridge)
	if err != nil {
		t.Fatal(err)
	}
	f.server = &Server{store: store}
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	if withProposal {
		f.step, _, err = store.reserveToolStep(f.session, f.task.ID, toolStepRequest{OperationID: "shop-original-op", TaskRevision: f.task.Revision, Generation: f.task.Generation, ToolID: shopOrderToolID, ToolVersion: "1", Input: f.input})
		if err != nil {
			t.Fatal(err)
		}
	}
	return f
}

func (f *p08ShopFixture) authorization(task TaskRecord, step ActionRecord) OriginalTaskGrantAuthorization {
	b := f.template
	b.Task.Revision, b.Generation, b.StepID = strconv.FormatUint(step.ToolStep.TaskRevision, 10), strconv.FormatUint(step.ToolStep.Generation, 10), step.ID
	b.Tool, b.Target, b.Audience = f.profile.Tool, f.profile.Target, f.profile.Target.Service
	b.Input, b.Fields = shopAuthBind(f.input), append([]string(nil), f.selection.Fields...)
	resource := b.Resources[0]
	resource.Kind, resource.ID = f.profile.OrderKind, f.selection.OrderID
	b.Resources = []authgrant.Ref{resource}
	b.Sources = []authgrant.Source{{Resource: resource, Fields: append([]string(nil), b.Fields...), Label: "RESTRICTED", Binding: shopAuthBind(f.data)}}
	s := f.held.snapshot
	s.Grant.Binding, s.Task.Ref, s.Task.Generation = b, b.Task, b.Generation
	s.Catalog.Tool, s.Catalog.Audience = b.Tool, b.Audience
	s.AuthorizedResources, s.Sources = b.Resources, b.Sources
	s.Budget.Slot, s.Effect.Slot = b.Slot(), b.Slot()
	f.held.snapshot = s
	proof := authgrant.Proof{Payload: []byte("PUBLIC-payload"), Wire: []byte("PUBLIC-not-signature"), Purpose: "PUBLIC-only-fixture"}
	return OriginalTaskGrantAuthorization{Verifier: p08OriginalVerifierFixture{held: f.held}, Binding: b, Grant: proof, Holder: proof}
}

func (f *p08ShopFixture) approve(t *testing.T) {
	t.Helper()
	f.store.mu.Lock()
	call, err := f.store.effectCallLocked(f.session, f.task.ID, f.step.ID, false)
	f.store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := f.server.toolEffects.(originalTaskApprovalSource).approveTaskStep(context.Background(), call, "PUBLIC-original-proof-ref"); err != nil {
		t.Fatal(err)
	}
	step, _ := f.store.Action(f.session.Account, f.step.ID)
	if step.Status != "approved_not_executed" || step.ToolStep.TaskGrantRef == "" || !reflect.DeepEqual(step.ToolStep.ApprovedFields, f.selection.Fields) || step.ToolStep.ResultCipher != "" {
		t.Fatalf("normal approval lost exact fields or claimed effect: %+v", step)
	}
}

func TestP08ShopOrderStrictInputAndIdempotency(t *testing.T) {
	f := newP08ShopFixture(t, true)
	selection := f.selection
	selection.Fields = []string{"totalYNXT", "currency", "status"}
	unsorted, _ := json.Marshal(selection)
	_, canonical, err := canonicalShopOrderInput(unsorted)
	if err != nil || !bytes.Equal(canonical, f.input) {
		t.Fatalf("field selection did not canonicalize: %s %v", canonical, err)
	}
	for _, mutate := range []func(*taskShopOrderInput){
		func(i *taskShopOrderInput) { i.OrderID = "" }, func(i *taskShopOrderInput) { i.OrderID = strings.Repeat("x", 257) },
		func(i *taskShopOrderInput) { i.Snapshot = strings.Repeat("a", 127) }, func(i *taskShopOrderInput) { i.Snapshot = strings.Repeat("A", 128) },
		func(i *taskShopOrderInput) { i.Fields = []string{"status", "address"} }, func(i *taskShopOrderInput) { i.Fields = []string{"status", "status"} },
		func(i *taskShopOrderInput) { i.Fields = nil }, func(i *taskShopOrderInput) { i.Fields = make([]string, 10) },
	} {
		input := f.selection
		mutate(&input)
		raw, _ := json.Marshal(input)
		if _, _, err := canonicalShopOrderInput(raw); err == nil {
			t.Fatalf("invalid selection accepted: %s", raw)
		}
	}
	for _, raw := range [][]byte{[]byte(`{"orderId":"a","orderId":"b"}`), append([]byte(`{"role":"buyer",`), f.input[1:]...), append([]byte(`{"risk":"read",`), f.input[1:]...), append([]byte(`{"schema":{},`), f.input[1:]...)} {
		if _, _, err := canonicalShopOrderInput(raw); err == nil {
			t.Fatal("ambiguous or caller-owned schema/risk accepted")
		}
	}
	step, created, err := f.store.reserveToolStep(f.session, f.task.ID, toolStepRequest{OperationID: "shop-original-op", TaskRevision: 1, Generation: 1, ToolID: shopOrderToolID, ToolVersion: "1", Input: unsorted})
	if err != nil || created || step.ID != f.step.ID {
		t.Fatalf("same canonical operation did not return original: %+v %v", step, err)
	}
	changed := f.selection
	changed.OrderID = "another-order"
	raw, _ := json.Marshal(changed)
	if _, _, err := f.store.reserveToolStep(f.session, f.task.ID, toolStepRequest{OperationID: "shop-original-op", TaskRevision: 1, Generation: 1, ToolID: shopOrderToolID, ToolVersion: "1", Input: raw}); !errors.Is(err, errToolConflict) {
		t.Fatalf("same operation rebound to another order: %v", err)
	}
}

func TestP08ShopOrderNormalApprovalDispatchRestart(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || receipt.State != "COMMITTED" || receipt.Scope != "remote-verified-read" || receipt.AuthScope != string(authgrant.EgressOnlyReadFence) || receipt.OriginalOperationID != f.step.ID || receipt.RemoteRef != "shop-original-ref" || !bytes.Equal(receipt.Result, f.projection) || !reflect.DeepEqual(receipt.Fields, f.selection.Fields) || f.caller.calls.Load() != 1 {
		t.Fatalf("actual local contract flow failed: %+v %v", receipt, err)
	}
	disk, err := os.ReadFile(f.store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(disk, []byte("processing")) || bytes.Contains(disk, f.projection) || bytes.Contains(disk, f.data) {
		t.Fatal("Shop source/wire/result persisted in plaintext")
	}
	restarted, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.server.store, f.store = restarted, restarted
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	recovered, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || !bytes.Equal(recovered.Result, receipt.Result) || recovered.RemoteRef != receipt.RemoteRef || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 0 {
		t.Fatalf("durable verified result was redispatched: %+v %v", recovered, err)
	}
	if len(f.store.state.Permissions) != 0 {
		t.Fatal("consumer created local Grant")
	}
}

func TestP08ShopOrderPublicBindingCopyAndWireRead(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil {
		t.Fatal(err)
	}
	stored, _ := f.store.Action(f.session.Account, f.step.ID)
	expected := *stored.ToolStep.ResultWireBinding
	public := publicToolStep(stored)
	if public.ToolStep.ResultWireNonce != "" || public.ToolStep.ResultWireCipher != "" || public.ToolStep.ResultWireBinding == nil {
		t.Fatal("public step exposed encrypted wire or lost its binding")
	}
	public.ToolStep.ResultWireBinding.SHA512 = strings.Repeat("0", 128)
	public.ToolStep.ResultFields[0] = "address"
	public.ToolStep.ApprovedFields[0] = "address"
	projection, err := f.store.ReadTaskProjection(f.session.Account, f.task.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, step := range projection.Steps {
		if step.ID != f.step.ID {
			continue
		}
		found = true
		if step.ToolStep.ResultWireNonce != "" || step.ToolStep.ResultWireCipher != "" || step.ToolStep.ResultWireBinding == nil {
			t.Fatal("projection exposed encrypted wire")
		}
		step.ToolStep.ResultWireBinding.Bytes++
	}
	if !found {
		t.Fatal("projection omitted committed Shop step")
	}
	receipt.WireBinding.SHA3_512 = strings.Repeat("f", 128)
	f.store.mu.Lock()
	defer f.store.mu.Unlock()
	authoritative := f.store.state.Actions[f.step.ID]
	if *authoritative.ToolStep.ResultWireBinding != expected || !reflect.DeepEqual(authoritative.ToolStep.ResultFields, f.selection.Fields) || !reflect.DeepEqual(authoritative.ToolStep.ApprovedFields, f.selection.Fields) {
		t.Fatal("returned Go projection/receipt aliased authoritative Store")
	}
	recovered, err := f.store.taskReadReceiptLocked(authoritative)
	if err != nil || !bytes.Equal(recovered.Result, f.projection) {
		t.Fatalf("independent receipt no longer reads original wire: %v", err)
	}
	// Keeping COMPLETED + the genuine result ciphertext is insufficient when
	// its actual original encrypted wire cannot authenticate/decrypt.
	corrupt := authoritative
	binding := *corrupt.ToolStep
	binding.ResultWireCipher = ""
	corrupt.ToolStep = &binding
	if result, err := f.store.taskReadReceiptLocked(corrupt); err == nil || result.State == "COMMITTED" || len(result.Result) != 0 {
		t.Fatal("receipt trusted status/result metadata without actual encrypted wire")
	}
}

func TestP08ShopOrderUnknownPartialLocatorAndQuery(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	firstCause := errors.New("PUBLIC response lost after remote read")
	f.caller.callErr = firstCause
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); !errors.Is(err, firstCause) {
		t.Fatalf("partial error lost first cause: %v", err)
	}
	unknown, _ := f.store.Action(f.session.Account, f.step.ID)
	if unknown.Status != "UNKNOWN" || unknown.ToolStep.RemoteRef != "shop-original-ref" || unknown.ToolStep.ResultCipher != "" || unknown.ToolStep.EffectFirstCause == "" {
		t.Fatalf("partial locator lost or promoted to receipt: %+v", unknown)
	}
	restarted, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.store, f.server.store = restarted, restarted
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	f.held.snapshot.Effect.State = "UNKNOWN" // NEW-effect policy would refuse this.
	receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || receipt.State != "COMMITTED" || receipt.EffectRef != f.step.ID || receipt.RemoteRef != unknown.ToolStep.RemoteRef || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 1 || !f.queryOriginal {
		t.Fatalf("UNKNOWN was not original query-only: %+v %v", receipt, err)
	}
	completed, _ := f.store.Action(f.session.Account, f.step.ID)
	if completed.ToolStep.EffectFirstCause != unknown.ToolStep.EffectFirstCause {
		t.Fatal("reconcile overwrote first cause")
	}
}

func TestP08ShopOrderRejectsUnboundReturnBytes(t *testing.T) {
	for _, mode := range []string{"operation", "remote", "source", "fields", "snapshot", "extra_data", "source_bytes", "decode_error"} {
		t.Run(mode, func(t *testing.T) {
			f := newP08ShopFixture(t, true)
			f.approve(t)
			f.codec.mutate = func(envelope *p08ShopLocalEnvelope) {
				switch mode {
				case "operation":
					envelope.Operation = "unrelated-operation"
				case "remote":
					envelope.RemoteRef = "different-remote"
				case "source":
					envelope.Source.Resource.ID = "neighbor-order"
				case "source_bytes":
					envelope.SourceBytes = []byte(`{"status":"unapproved"}`)
				case "decode_error":
					envelope.Projection = json.RawMessage(`not-json`)
				default:
					var projection taskShopOrderProjection
					_ = json.Unmarshal(envelope.Projection, &projection)
					switch mode {
					case "fields":
						projection.Fields = []string{"status"}
					case "snapshot":
						projection.Snapshot = strings.Repeat("b", 128)
					case "extra_data":
						projection.Data["address"] = json.RawMessage(`"private address"`)
					}
					envelope.Projection, _ = json.Marshal(projection)
				}
			}
			receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
			step, _ := f.store.Action(f.session.Account, f.step.ID)
			if err == nil || receipt.State == "COMMITTED" || len(receipt.Result) != 0 || step.Status != "UNKNOWN" || step.ToolStep.ResultCipher != "" || step.ToolStep.ResultWireCipher != "" || step.ToolStep.RemoteRef != "shop-original-ref" || f.caller.calls.Load() != 1 {
				t.Fatalf("unbound HTTP 200 became success: status=%s receipt=%s err=%v", step.Status, receipt.State, err)
			}
		})
	}
}

func TestP08ShopOrderPartialQueryLocatorConflictAndRecovery(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	f.caller.callErr = errors.New("PUBLIC dispatch response lost")
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
		t.Fatal("fixture did not enter UNKNOWN")
	}
	initial, _ := f.store.Action(f.session.Account, f.step.ID)
	f.caller.queryErr, f.caller.queryRef = errors.New("PUBLIC original query response lost"), "another-remote-ref"
	if _, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
		t.Fatal("conflicting partial locator accepted")
	}
	conflict, _ := f.store.Action(f.session.Account, f.step.ID)
	if conflict.Status != "UNKNOWN" || conflict.ToolStep.RemoteRef != initial.ToolStep.RemoteRef || conflict.ToolStep.EffectFirstCause != initial.ToolStep.EffectFirstCause || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 1 {
		t.Fatal("query overwrote original locator/cause or redispatched")
	}
	f.caller.queryErr, f.caller.queryRef = nil, "shop-original-ref"
	receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || receipt.State != "COMMITTED" || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 2 {
		t.Fatalf("original query did not recover after conflict: %s %v", receipt.State, err)
	}
}

func TestP08ShopOrderQueryPartialLocatorSurvivesRestart(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	f.caller.omitCallRef, f.caller.callErr = true, errors.New("PUBLIC original dispatch has no locator")
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
		t.Fatal("dispatch unexpectedly succeeded")
	}
	initial, _ := f.store.Action(f.session.Account, f.step.ID)
	if initial.ToolStep.RemoteRef != "" || initial.ToolStep.RemoteOperationID != f.step.ID {
		t.Fatal("locator was invented or original operation lost")
	}
	queryCause := errors.New("PUBLIC query returned partial original locator")
	f.caller.queryErr = queryCause
	if _, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); !errors.Is(err, queryCause) {
		t.Fatalf("query lost original first cause: %v", err)
	}
	partial, _ := f.store.Action(f.session.Account, f.step.ID)
	if partial.ToolStep.RemoteRef != "shop-original-ref" || partial.Status != "UNKNOWN" || partial.ToolStep.ResultCipher != "" || partial.ToolStep.EffectFirstCause != initial.ToolStep.EffectFirstCause {
		t.Fatal("partial query locator discarded/promoted or earlier cause overwritten")
	}
	restarted, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.store, f.server.store = restarted, restarted
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	f.caller.queryErr = nil
	receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || receipt.RemoteRef != partial.ToolStep.RemoteRef || receipt.State != "COMMITTED" || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 2 {
		t.Fatalf("partial query recovery did not stay on original operation: %s %v", receipt.State, err)
	}
}

func TestP08ShopOrderSaveFailureRetainsOriginalRecovery(t *testing.T) {
	f := newP08ShopFixture(t, true)
	f.approve(t)
	path := f.store.path
	var before []byte
	f.codec.onDecode = func() {
		before, _ = json.Marshal(f.store.state) // Captured locator is already durable.
		f.store.path = filepath.Join(path, "cannot-be-directory.json")
	}
	receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err == nil || receipt.State == "COMMITTED" || len(receipt.Result) != 0 {
		t.Fatal("failed result save returned success")
	}
	after, _ := json.Marshal(f.store.state)
	if !bytes.Equal(before, after) {
		t.Fatal("failed local result save changed memory/audit/events")
	}
	restarted, err := NewStore(path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	step, _ := restarted.Action(f.session.Account, f.step.ID)
	if step.Status != "DISPATCHING" || step.ToolStep.RemoteRef != "shop-original-ref" || step.ToolStep.ResultCipher != "" || step.ToolStep.ResultWireCipher != "" {
		t.Fatal("failed save lost locator or persisted partial result")
	}
	f.codec.onDecode = nil
	f.store, f.server.store = restarted, restarted
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	recovered, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	if err != nil || recovered.State != "COMMITTED" || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 1 {
		t.Fatalf("save failure caused redispatch or prevented original query: %s %v", recovered.State, err)
	}
}

func TestP08ShopOrderClosedWithoutProtectedOperands(t *testing.T) {
	f := newP08ShopFixture(t, true)
	var nilCodec *p08ShopCodecFixture
	for _, codec := range []OriginalShopOrderCodec{nil, nilCodec} {
		if _, err := PrepareOriginalShopOrderTools(context.Background(), codec, f.caller, f.profile, func(context.Context) error { return nil }); !errors.Is(err, errTaskEffectSourceUnavailable) {
			t.Fatalf("missing SDK codec installed: %v", err)
		}
	}
	profile := f.profile
	profile.Tool.Schema = shopAuthBind([]byte("different schema"))
	if _, err := PrepareOriginalShopOrderTools(context.Background(), f.codec, f.caller, profile, func(context.Context) error { return nil }); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatalf("arbitrary schema admitted: %v", err)
	}
	if _, err := PrepareOriginalShopOrderTools(context.Background(), f.codec, nil, f.profile, func(context.Context) error { return nil }); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatalf("missing LINK caller installed: %v", err)
	}
	if _, err := PrepareOriginalShopOrderTools(context.Background(), f.codec, f.caller, f.profile, nil); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatalf("no current protected custody fence installed: %v", err)
	}
	plain := &Server{store: f.store}
	request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/tool-steps/"+f.step.ID+"/dispatch", strings.NewReader(`{"authorizationRef":"not-a-Grant"}`))
	request.SetPathValue("id", f.task.ID)
	request.SetPathValue("stepId", f.step.ID)
	response := httptest.NewRecorder()
	plain.handleTaskToolDispatch(response, request, f.session)
	if response.Code != http.StatusServiceUnavailable || f.caller.calls.Load() != 0 {
		t.Fatal("default endpoint did not fail 503 before external calls")
	}
	step, _ := f.store.Action(f.session.Account, f.step.ID)
	if step.Status != "NEEDS_APPROVAL" || step.ToolStep.RemoteOperationID != "" || step.ToolStep.TaskGrantRef != "" {
		t.Fatal("absence of normal operands claimed authority/effect")
	}
}

func TestP08ShopOrderApprovalExactFieldsAndSession(t *testing.T) {
	for _, mode := range []string{"wrong_session", "fields", "resource", "tenant", "grant", "source", "save_failure"} {
		t.Run(mode, func(t *testing.T) {
			f := newP08ShopFixture(t, true)
			f.authority.mutate = func(request *OriginalTaskAuthorizationRequest) {
				auth := f.authorization(request.Task, request.Step)
				switch mode {
				case "wrong_session":
					auth.Binding.SessionID = "other-session"
				case "fields":
					auth.Binding.Fields = []string{"status"}
				case "resource":
					auth.Binding.Resources[0].ID = "another-order"
				case "tenant":
					auth.Binding.Tenant = "another-tenant"
				case "grant":
					auth.Binding.Tool.Risk = "asset"
				case "source":
					auth.Binding.Sources[0].Binding.SHA512 = "invalid-source-hash"
				}
				f.authority.authorization = auth
			}
			f.store.mu.Lock()
			call, err := f.store.effectCallLocked(f.session, f.task.ID, f.step.ID, false)
			f.store.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			before, _ := json.Marshal(f.store.state)
			if mode == "save_failure" {
				f.store.path = filepath.Join(f.store.path, "impossible.json")
			}
			err = f.server.toolEffects.(originalTaskApprovalSource).approveTaskStep(context.Background(), call, "PUBLIC-original-proof-ref")
			after, _ := json.Marshal(f.store.state)
			if err == nil || !bytes.Equal(before, after) || f.caller.calls.Load() != 0 {
				t.Fatalf("approval accepted unbound proof or changed failed state: mode=%s err=%v", mode, err)
			}
		})
	}
}

func TestP08ShopOrderModelCheckpointWholeLocalContract(t *testing.T) {
	f := newP08ShopFixture(t, false)
	request := taskRunRequest{RunID: "shop-model-original", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Read the explicitly selected order snapshot.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID}}
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 || f.providerRequests.Load() != 1 || f.caller.calls.Load() != 0 {
		t.Fatalf("model bypassed actual Shop approval: %+v %v", pending, err)
	}
	f.step, _ = f.store.Action(f.session.Account, pending.Steps[0])
	f.approve(t)
	backup := filepath.Join(t.TempDir(), "shop-pending.ynxbackup")
	if _, err := f.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	restored, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), f.key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restored.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	f.store, f.server.store = restored, restored
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	request.Prompt, request.Resume = "", true
	result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Actual PUBLIC HTTP provider answer for the verified order." || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 0 || f.providerRequests.Load() != 2 || f.authority.disclosures != 3 {
		t.Fatalf("whole local Shop model workflow failed: %+v %v", result, err)
	}
	if _, err := f.store.CompleteTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, result.ID); err != nil {
		t.Fatalf("verified model+Shop workflow could not complete original task: %v", err)
	}
	disk, err := os.ReadFile(f.store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(disk, []byte(result.Content)) || bytes.Contains(disk, f.projection) || bytes.Contains(disk, []byte(request.AuthorizationRef)) {
		t.Fatal("private checkpoint/answer/auth ref exposed on disk")
	}
	if !reflect.DeepEqual(f.store.state.TaskRuns[result.ID].ToolIDs, []string{shopOrderToolID}) {
		t.Fatal("model run lost its original service-tool selection")
	}
}

func TestP08ShopOrderOriginalSchemaSelection(t *testing.T) {
	f := newP08ShopFixture(t, false)
	for _, id := range []string{strings.Repeat("x", 256), strings.Repeat("界", 85), "https://logical-id.invalid/order:only-an-id"} {
		selected := f.selection
		selected.OrderID = id
		raw, _ := json.Marshal(selected)
		got, canonical, err := canonicalShopOrderInput(raw)
		if err != nil || got.OrderID != id || !bytes.Equal(raw, canonical) {
			t.Fatalf("original Shop identifier rejected or rewritten: %q %v", id, err)
		}
	}
	for _, id := range []string{strings.Repeat("x", 257), strings.Repeat("界", 86)} {
		selected := f.selection
		selected.OrderID = id
		raw, _ := json.Marshal(selected)
		if _, _, err := canonicalShopOrderInput(raw); err == nil {
			t.Fatal("Shop byte limit bypassed")
		}
	}
	legacy := append([]byte(`{"role":"buyer",`), f.input[1:]...)
	if _, _, err := canonicalShopOrderInput(legacy); err == nil {
		t.Fatal("caller-selected role admitted")
	}
	invalid := append([]byte(nil), f.input...)
	invalid = append(invalid[:len(invalid)-1], 0xff, '}')
	if _, _, err := canonicalShopOrderInput(invalid); err == nil {
		t.Fatal("invalid UTF-8 accepted")
	}
	var definition map[string]any
	if err := json.Unmarshal(taskShopOrderModelDefinition().Parameters, &definition); err != nil {
		t.Fatal(err)
	}
	if _, exists := definition["properties"].(map[string]any)["role"]; exists {
		t.Fatal("model still offers role selection")
	}
	if f.profile.Tool.Schema != shopAuthBind(shopOrderRegisteredInputSchema) {
		t.Fatal("Auth descriptor does not bind exact original Shop artifact")
	}
}

func TestP08ShopOrderLegacySignedInputNeverRewritten(t *testing.T) {
	f := newP08ShopFixture(t, true)
	legacy := append([]byte(`{"role":"buyer",`), f.input[1:]...)
	f.input = legacy
	f.store.mu.Lock()
	step := f.store.state.Actions[f.step.ID]
	binding := *step.ToolStep
	var err error
	binding.InputNonce, binding.InputCipher, err = f.store.encrypt(step.Account, binding.TaskID, step.ID, string(legacy))
	if err != nil {
		f.store.mu.Unlock()
		t.Fatal(err)
	}
	binding.RemoteOperationID = step.ID
	binding.RemoteRef = "original-legacy-ref"
	step.Status = "UNKNOWN"
	step.ToolStep = &binding
	f.store.state.Actions[step.ID] = step
	if err = f.store.saveLocked(); err != nil {
		f.store.mu.Unlock()
		t.Fatal(err)
	}
	before := *step.ToolStep
	f.store.mu.Unlock()
	if _, err = f.server.reconcileStep(context.Background(), f.session, f.task.ID, step.ID, "PUBLIC-original-proof-ref"); err == nil {
		t.Fatal("old signed role input was silently upgraded")
	}
	f.store.mu.Lock()
	after := f.store.state.Actions[step.ID]
	f.store.mu.Unlock()
	if after.Status != "UNKNOWN" || after.ToolStep.InputNonce != before.InputNonce || after.ToolStep.InputCipher != before.InputCipher || after.ToolStep.RemoteRef != before.RemoteRef || f.caller.calls.Load() != 0 || f.caller.queries.Load() != 0 {
		t.Fatal("legacy signed intent, original reference or effect changed")
	}
}
