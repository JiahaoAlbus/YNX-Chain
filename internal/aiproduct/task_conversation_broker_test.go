package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	policy "ynx.local/authgrantpolicy"
)

// Actual model HTTP + original registered broker consumer + Unix receiver +
// typed sole policy + encrypted Store. Auth result/Source/capability are PUBLIC
// stand-ins: no real SQLite reservation, signature or Native C/D/F admission.
type p08ConversationAuthority struct {
	t         *testing.T
	base      *p08RuntimeAuthorityFixture
	resource  *OriginalTaskReadResource
	held      *p08OriginalHeldFixture
	template  policy.TaskEffectBinding
	latest    OriginalTaskGrantAuthorization
	operation string
	request   OriginalTaskResourceReadRequest
	queries   int
}

func (a *p08ConversationAuthority) Current(ctx context.Context) error      { return ctx.Err() }
func (a *p08ConversationAuthority) queryCurrent(ctx context.Context) error { return ctx.Err() }
func (a *p08ConversationAuthority) CheckTaskModelDisclosure(ctx context.Context, s ProductSession, t TaskRecord, u, m string, b []byte) error {
	return a.base.CheckTaskModelDisclosure(ctx, s, t, u, m, b)
}
func (a *p08ConversationAuthority) ResolveTaskGrant(ctx context.Context, r OriginalTaskAuthorizationRequest) (OriginalTaskGrantAuthorization, error) {
	b := a.template
	b.GrantID = strings.Repeat("1", 32)
	b.Task.ID = r.Task.ID
	b.Task.Revision = strconv.FormatUint(r.Task.Revision, 10)
	b.Generation = strconv.FormatUint(r.Task.Generation, 10)
	b.StepID = r.Step.ID
	b.SessionID = r.Session.ID
	b.Holder.ID = r.Task.Holder
	b.Input = shopAuthBind(r.Input)
	a.latest = p08BrokerProofs(a.t, OriginalTaskGrantAuthorization{Verifier: a.resource.verifier, Binding: b})
	a.held.snapshot.Grant.ID = b.GrantID
	a.held.snapshot.Grant.Binding = b
	a.held.snapshot.Task.Ref = b.Task
	a.held.snapshot.Task.Generation = b.Generation
	a.held.snapshot.Effect.Slot = b.Slot()
	a.held.snapshot.Budget.Slot = b.Slot()
	a.request = OriginalTaskResourceReadRequest{Version: "1", AuthorityOperationID: a.operation, ExpectedGrantRevision: b.GrantRevision, Binding: b, Grant: a.latest.Grant, Holder: a.latest.Holder, RawInput: bytes.Clone(r.Input), AuthorizationRef: "PUBLIC_QUERY_REF"}
	return a.latest, ctx.Err()
}
func (a *p08ConversationAuthority) queryOriginalTaskMaterial(ctx context.Context, r OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error) {
	a.queries++
	if !r.QueryOriginal || r.Step.ID != a.latest.Binding.StepID || !bytes.Equal(r.Input, a.request.RawInput) {
		return originalBrokerQueryMaterial{}, errToolConflict
	}
	return originalBrokerQueryMaterial{State: r.Step.ToolStep.AuthorityReferenceState, Binding: a.latest.Binding, Call: originalclient.TaskAuthorityCall{Grant: a.latest.Grant, Holder: a.latest.Holder, OriginalOperation: a.operation}}, ctx.Err()
}

type p08ConversationClient struct {
	t                            *testing.T
	a                            *p08ConversationAuthority
	endpoint                     *taskCallerEndpoint
	effects, inputReads, queries int
	lostACK                      bool
	corrupt                      bool
	last                         originalclient.TaskAuthorityResult
}

func (c *p08ConversationClient) Current(ctx context.Context) error { return ctx.Err() }
func (c *p08ConversationClient) post(ctx context.Context, path string, r OriginalTaskResourceReadRequest) (OriginalTaskResourceReadResult, error) {
	raw, _ := json.Marshal(r)
	response, err := c.endpoint.Call(ctx, "POST", path, "application/json", raw)
	if err != nil {
		return OriginalTaskResourceReadResult{}, err
	}
	if response.StatusCode != 200 {
		return OriginalTaskResourceReadResult{}, errTaskEffectUnresolved
	}
	var result OriginalTaskResourceReadResult
	err = json.Unmarshal(response.Body, &result)
	return result, err
}
func (c *p08ConversationClient) AuthorizeAtEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	if call.OriginalOperation != "" || !bytes.Equal(call.RawInput, c.a.request.RawInput) || !bytes.Equal(call.Grant.Payload, c.a.latest.Grant.Payload) || !bytes.Equal(call.Holder.Payload, c.a.latest.Holder.Payload) {
		c.t.Fatal("broker lost exact original request")
	}
	c.effects++
	input := cloneOriginalResourceRequest(c.a.request)
	input.AuthorityOperationID = ""
	input.RawInput = nil
	raw, _ := json.Marshal(input)
	response, err := c.endpoint.Call(ctx, "POST", OriginalTaskReadInputPath, "application/json", raw)
	if err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	var read struct {
		Input []byte `json:"input"`
	}
	if response.StatusCode != 200 || json.Unmarshal(response.Body, &read) != nil || !bytes.Equal(read.Input, call.RawInput) {
		return originalclient.TaskAuthorityResult{}, errToolConflict
	}
	c.inputReads++
	actual, err := c.post(ctx, OriginalTaskReadExecutePath, c.a.request)
	if err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	c.last = originalclient.TaskAuthorityResult{State: "COMMITTED", OriginalOperation: c.a.operation, Original: string(actual.Original)}
	if c.lostACK {
		return originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: c.a.operation}, errors.New("PUBLIC original Auth ACK lost after real resource commit")
	}
	result := c.last
	if c.corrupt {
		result.Original += " "
	}
	return result, nil
}
func (c *p08ConversationClient) QueryOriginalEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	c.queries++
	if call.OriginalOperation != c.a.operation {
		return originalclient.TaskAuthorityResult{}, errToolConflict
	}
	actual, err := c.post(ctx, OriginalTaskReadQueryPath, c.a.request)
	if err != nil {
		return originalclient.TaskAuthorityResult{}, err
	}
	return originalclient.TaskAuthorityResult{State: actual.State, OriginalOperation: actual.OperationID, Original: string(actual.Original)}, nil
}

func newP08ConversationLoop(t *testing.T) (*p08ModelFixture, *p08ConversationAuthority, *p08ConversationClient) {
	t.Helper()
	model := newP08ModelFixture(t)
	_, template, held := p08OriginalAuthFixture(t)
	// Select this actual model fixture's own conversation/task before constructing
	// PUBLIC Source projections. No normal factory is replaced or installed.
	template.Account = model.session.Account
	template.Task.ID = model.task.ID
	template.Holder.ID = model.session.DeviceID
	template.Resources[0].ID = model.task.ConversationID
	template.Sources[0].Resource = template.Resources[0]
	_, messages, err := model.server.store.Conversation(model.session.Account, model.task.ConversationID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"messages": messages})
	template.Sources[0].Binding = shopAuthBind(raw)
	held.snapshot.Grant.Binding = template
	held.snapshot.Sources = template.Sources
	held.snapshot.AuthorizedResources = template.Resources
	held.snapshot.Task.Ref = template.Task
	held.snapshot.Task.Holder = template.Holder
	held.snapshot.Holder.Ref = template.Holder
	held.snapshot.Grant.Holder = template.Holder
	held.snapshot.Effect.Slot = template.Slot()
	held.snapshot.Budget.Slot = template.Slot()
	op := strings.Repeat("a", 64)
	reserved := &p08ResourceReservationFixture{held: held, operation: op}
	resource := &OriginalTaskReadResource{store: model.server.store, verifier: reserved, current: func(ctx context.Context) error { return ctx.Err() }, queryCurrent: func(ctx context.Context) error { return ctx.Err() }, children: make(map[*OriginalTaskResourceReadCall]struct{})}
	a := &p08ConversationAuthority{t: t, base: &p08RuntimeAuthorityFixture{}, resource: resource, held: held, template: template, operation: op}
	resource.queryMaterial = func(ctx context.Context, q OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error) {
		return originalBrokerQueryMaterial{State: "UNKNOWN", Binding: a.latest.Binding, Call: originalclient.TaskAuthorityCall{Grant: a.latest.Grant, Holder: a.latest.Holder, OriginalOperation: op}}, ctx.Err()
	}
	registration := p08CallerEndpointRegistration(t)
	registration.service = OriginalTaskReadResourceService
	registration.routes = nil
	for _, path := range []string{OriginalTaskReadInputPath, OriginalTaskReadExecutePath, OriginalTaskReadQueryPath} {
		registration.routes = append(registration.routes, link.LocalCallerRoute{Method: "POST", Path: path, MaxBodyBytes: 1 << 20, Timeout: 3 * time.Second})
	}
	endpoint, err := openTaskCallerEndpoint(context.Background(), registration, resource.Handler())
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, endpoint)
	client := &p08ConversationClient{t: t, a: a, endpoint: endpoint}
	prepared := &PreparedOriginalTaskRuntime{model: model.provider, authority: a, broker: &originalTaskAuthorityBroker{client: client}}
	if err = prepared.install(model.server); err != nil {
		t.Fatal(err)
	}
	return model, a, client
}
func approveConversationLoop(t *testing.T, f *p08ModelFixture, pending taskRunView) {
	t.Helper()
	f.server.store.mu.Lock()
	call, err := f.server.store.effectCallLocked(f.session, f.task.ID, pending.Steps[0], false)
	f.server.store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err = f.server.toolEffects.(originalTaskApprovalSource).approveTaskStep(context.Background(), call, "PUBLIC_QUERY_REF"); err != nil {
		t.Fatal(err)
	}
}

func TestP08ConversationRegisteredModelFeedback(t *testing.T) {
	f, a, c := newP08ConversationLoop(t)
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume = true
	request.Prompt = ""
	answer, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || answer.Status != "COMPLETED" || c.effects != 1 || c.inputReads != 1 || f.requests.Load() != 2 {
		t.Fatalf("normal registered feedback: %+v %v effects=%d input=%d model=%d", answer, err, c.effects, c.inputReads, f.requests.Load())
	}
	step := f.server.store.state.Actions[pending.Steps[0]]
	if step.ToolStep.AuthorityOperationID != a.operation || step.ToolStep.ResultWireCipher == "" || step.ToolStep.AuthorityReferenceState != "COMMITTED" {
		t.Fatal("original op/wire acceptance not durable")
	}
	wire, err := f.server.store.taskModelFeedbackContent(f.session.Account, f.task.ID, step.ID, taskReadReceipt{EffectRef: step.ID, Binding: step.ToolStep.ResultBinding})
	if err != nil || !bytes.Equal(wire, []byte(c.last.Original)) {
		t.Fatal("model got reconstructed/mismatched original")
	}
	disk, _ := os.ReadFile(f.server.store.path)
	if bytes.Contains(disk, []byte("actual selected source body")) {
		t.Fatal("receipt plaintext persisted")
	}
	if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); err != nil || c.effects != 1 || f.requests.Load() != 2 {
		t.Fatal("completed workflow replayed")
	}
}

func TestP08ConversationLostACKColdQueryAndFeedback(t *testing.T) {
	f, a, c := newP08ConversationLoop(t)
	c.lostACK = true
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume = true
	request.Prompt = ""
	unknown, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err == nil || unknown.Status != "UNKNOWN" || c.effects != 1 || f.requests.Load() != 1 {
		t.Fatalf("lost ACK escaped: %+v %v", unknown, err)
	}
	step := f.server.store.state.Actions[pending.Steps[0]]
	if step.Status != "COMPLETED" || step.ToolStep.AuthorityOperationID != a.operation || step.ToolStep.AuthorityReferenceState != "UNKNOWN" {
		t.Fatal("local fact/original UNKNOWN was lost")
	}
	f.server.store.mu.Lock()
	_, gateErr := f.server.store.taskFeedbackReceiptLocked(step)
	unresolved := f.server.store.taskHasUnresolvedEffectLocked(f.task.ID)
	f.server.store.mu.Unlock()
	if !errors.Is(gateErr, errTaskEffectUnresolved) || !unresolved {
		t.Fatal("local commit alone admitted feedback/new work")
	}
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	// The original receiver is retained as the original read-only resource. Model
	// consumer cold-reopens the same product image; query never reexecutes it.
	resumed := &Server{store: cold}
	prepared := &PreparedOriginalTaskRuntime{model: f.provider, authority: a, broker: &originalTaskAuthorityBroker{client: c}}
	if err = prepared.install(resumed); err != nil {
		t.Fatal(err)
	}
	answer, err := resumed.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || answer.Status != "COMPLETED" || c.effects != 1 || c.inputReads != 1 || c.queries != 1 || f.requests.Load() != 2 {
		t.Fatalf("cold query feedback: %+v %v effects=%d reads=%d query=%d model=%d", answer, err, c.effects, c.inputReads, c.queries, f.requests.Load())
	}
}

func TestP08ConversationRejectsReserializedOriginalThenRecovers(t *testing.T) {
	f, a, c := newP08ConversationLoop(t)
	c.corrupt = true
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume = true
	request.Prompt = ""
	stopped, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err == nil || stopped.Status != "UNKNOWN" || f.requests.Load() != 1 || c.effects != 1 {
		t.Fatal("mismatched original reached model")
	}
	step := f.server.store.state.Actions[pending.Steps[0]]
	if step.ToolStep.ResultWireCipher != "" || step.ToolStep.AuthorityOperationID != a.operation {
		t.Fatal("invalid receipt accepted or original operation lost")
	}
	answer, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || answer.Status != "COMPLETED" || c.effects != 1 || c.queries != 1 || f.requests.Load() != 2 {
		t.Fatalf("exact original query recovery failed: %+v %v", answer, err)
	}
}

func TestP08ConversationVerifiedWireSaveFailureKeepsOriginal(t *testing.T) {
	f, a, c := newP08ConversationLoop(t)
	c.lostACK = true
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume = true
	request.Prompt = ""
	_, _ = f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	s := f.server.store
	s.mu.Lock()
	call, err := s.effectCallLocked(f.session, f.task.ID, pending.Steps[0], false)
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	effects := f.server.toolEffects.(*originalRuntimeToolEffects)
	before, _ := json.Marshal(s.state)
	path := s.path
	s.path = filepath.Dir(path)
	_, err = effects.runtime.broker.acceptConversation(context.Background(), effects, call, a.latest.Binding, c.last)
	s.path = path
	after, _ := json.Marshal(s.state)
	if err == nil || !bytes.Equal(before, after) || c.effects != 1 {
		t.Fatal("receipt save failure lost original or changed state")
	}
	if _, err = effects.runtime.broker.acceptConversation(context.Background(), effects, call, a.latest.Binding, c.last); err != nil || c.effects != 1 {
		t.Fatalf("original receipt could not persist without replay: %v", err)
	}
}

func TestP08ConversationMissingAuthScopeCannotDowngradeFeedback(t *testing.T) {
	f, _, _ := newP08ConversationLoop(t)
	record := f.server.store.state.Actions[f.expected.StepID]
	expected := f.expected
	if _, err := f.server.store.commitTaskReadAtEffectFence(context.Background(), expected, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	f.server.store.mu.Lock()
	record = f.server.store.state.Actions[record.ID]
	binding := *record.ToolStep
	binding.AuthorityOperationID = strings.Repeat("a", 64)
	binding.AuthorityReferenceState = "COMMITTED"
	binding.ResultAuthScope = ""
	record.ToolStep = &binding
	_, err := f.server.store.taskFeedbackReceiptLocked(record)
	f.server.store.mu.Unlock()
	if !errors.Is(err, errTaskEffectUnresolved) {
		t.Fatal("missing scope made registered receipt a legacy local success")
	}
}
