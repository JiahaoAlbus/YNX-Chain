package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aitaskclient"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	open "github.com/JiahaoAlbus/YNX-Chain/packages/open-protocol/go"
	policy "ynx.local/authgrantpolicy"
)

// PUBLIC consumer fixtures only. E21/E3 and Shop DATA use the actual SDK;
// opaque proof wires and this private client establish no signature, Source,
// Node reservation, protected LINK channel or production admission.
type p08BrokerClientFixture struct {
	t                               *testing.T
	result                          originalclient.TaskAuthorityResult
	effectErr, queryErr, currentErr error
	news, queries                   []originalclient.TaskAuthorityCall
	afterEffect                     func()
}

func (c *p08BrokerClientFixture) Current(ctx context.Context) error {
	return errors.Join(ctx.Err(), c.currentErr)
}
func (c *p08BrokerClientFixture) AuthorizeAtEffect(_ context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	c.t.Helper()
	if call.OriginalOperation != "" {
		c.t.Fatal("NEW sent a caller-selected Node operation")
	}
	g, err := open.DecodeBoundGrant(call.Grant.Payload)
	if err != nil {
		c.t.Fatal(err)
	}
	h, err := open.DecodeGrantEffect(call.Holder.Payload)
	if err != nil {
		c.t.Fatal(err)
	}
	raw, err := open.EncodeBoundGrant(h.Grant)
	if err != nil || !bytes.Equal(raw, call.Grant.Payload) || call.GrantRef != (open.LegacyGrantRefV1{Realm: g.Realm, Tenant: g.Tenant, Kind: "grant", ID: g.ID, Rev: g.Rev}) || shopPolicyBind(g.Binding.Input) != shopAuthBind(call.RawInput) {
		c.t.Fatal("NEW lost exact E21/E3, input or original Grant ref")
	}
	c.news = append(c.news, call)
	if c.afterEffect != nil {
		c.afterEffect()
	}
	return c.result, c.effectErr
}
func (c *p08BrokerClientFixture) QueryOriginalEffect(_ context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	c.queries = append(c.queries, call)
	return c.result, c.queryErr
}

type p08BrokerAuthorityFixture struct {
	*p08RuntimeAuthorityFixture
	f              *p08ShopFixture
	queryErr       error
	materialErr    error
	queryCalls     int
	queryOperation string
	queryBinding   func(*policy.TaskEffectBinding)
}

func (a *p08BrokerAuthorityFixture) queryCurrent(ctx context.Context) error {
	return errors.Join(ctx.Err(), a.queryErr)
}
func (a *p08BrokerAuthorityFixture) queryOriginalTaskMaterial(_ context.Context, r OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error) {
	a.f.t.Helper()
	a.queryCalls++
	if a.materialErr != nil {
		return originalBrokerQueryMaterial{}, a.materialErr
	}
	// The local step is a lookup key only. The independent original Node
	// operation below comes from the persisted authority reference.
	if !r.QueryOriginal || r.OriginalOperationID != a.f.step.ID || !bytes.Equal(r.Input, a.f.input) || r.Session.ID != a.f.session.ID {
		a.f.t.Fatal("query lost original product identity/input")
	}
	op := r.Step.ToolStep.AuthorityOperationID
	if a.queryOperation != "" {
		op = a.queryOperation
	}
	auth := a.authorization
	if a.queryBinding != nil {
		a.queryBinding(&auth.Binding)
	}
	g, err := open.DecodeBoundGrant(auth.Grant.Payload)
	if err != nil {
		a.f.t.Fatal(err)
	}
	state := r.Step.ToolStep.AuthorityReferenceState
	if state == "" && op != "" {
		state = "UNKNOWN"
	}
	return originalBrokerQueryMaterial{State: state, Binding: auth.Binding, Call: originalclient.TaskAuthorityCall{Grant: auth.Grant, Holder: auth.Holder, GrantRef: open.LegacyGrantRefV1{Realm: g.Realm, Tenant: g.Tenant, Kind: "grant", ID: g.ID, Rev: g.Rev}, OriginalOperation: op}}, a.queryErr
}

func p08BrokerProofs(t *testing.T, auth OriginalTaskGrantAuthorization) OriginalTaskGrantAuthorization {
	t.Helper()
	vector := p08ShopSDKFixtureFromOriginalVector(t)
	g, err := open.DecodeBoundGrant(vector.call.Grant.Payload)
	if err != nil {
		t.Fatal(err)
	}
	b := auth.Binding
	g.ID, g.Rev, g.Realm, g.Tenant, g.Audience, g.Operation = b.GrantID, b.GrantRevision, b.Realm, b.Tenant, b.Audience, b.Tool.Operation
	g.Holder, g.HolderEpoch = shopSDKRef(b.Holder), b.HolderEpoch
	g.Issuer.Realm, g.Issuer.Tenant = b.Realm, b.Tenant
	g.Resources = []open.LegacyGrantRefV1{shopSDKRef(b.Resources[0])}
	g.Binding = open.GrantStepBindingV1{Task: shopSDKRef(b.Task), Generation: b.Generation, StepID: b.StepID, Input: shopSDKBind(b.Input), Tool: open.GrantToolV1{ID: b.Tool.ID, Version: b.Tool.Version, Schema: shopSDKBind(b.Tool.Schema)}, Target: shopSDKTarget(b.Target), Purpose: b.Tool.Purpose, Risk: b.Tool.Risk, HolderSession: open.GrantSessionV1{ID: b.SessionID, Epoch: b.SessionEpoch, Channel: b.ChannelBinding}, Sources: []open.GrantSourceV1{shopSDKSource(b.Sources[0])}}
	gp, err := open.EncodeBoundGrant(g)
	if err != nil {
		t.Fatal(err)
	}
	hp, err := open.EncodeGrantEffect(g, g.Binding)
	if err != nil {
		t.Fatal(err)
	}
	auth.Grant = policy.Proof{Purpose: open.BoundGrantDomain, Payload: gp, Wire: bytes.Clone(vector.call.Grant.Wire)}
	auth.Holder = policy.Proof{Purpose: open.GrantEffectDomain, Payload: hp, Wire: bytes.Clone(vector.call.Holder.Wire)}
	return auth
}

func newP08BrokerFixture(t *testing.T, proposal bool) (*p08ShopFixture, *p08BrokerAuthorityFixture, *p08BrokerClientFixture) {
	t.Helper()
	f := newP08ShopFixture(t, proposal)
	// The older policy-only fixture used a readable mock Grant ID. The
	// actual E21 grammar requires the original 16-byte hex identifier.
	f.template.GrantID = strings.Repeat("1", 32)
	f.held.snapshot.Grant.ID = f.template.GrantID
	d := open.ShopOrderReadToolDescriptorDATA()
	f.profile.Tool = policy.Tool{ID: d.ID, Version: d.Version, Operation: d.Operation, Purpose: d.Purpose, Risk: d.Risk, Schema: shopPolicyBind(d.Schema)}
	// Nonstandard registered names exercise selection from verified material,
	// rather than guessing a service/order kind in the product broker.
	f.profile.Target.Service, f.profile.OrderKind = "PUBLIC-registered-shop", "PUBLIC-registered-order"
	c := &p08BrokerClientFixture{t: t}
	a := &p08BrokerAuthorityFixture{p08RuntimeAuthorityFixture: f.authority, f: f}
	f.authority.mutate = func(r *OriginalTaskAuthorizationRequest) {
		if r.QueryOriginal {
			t.Fatal("query used NEW ResolveTaskGrant")
		}
		if !bytes.Equal(r.Input, f.input) || r.Session.ID != f.session.ID {
			t.Fatal("resolver lost input/session")
		}
		f.authority.authorization = p08BrokerProofs(t, f.authorization(r.Task, r.Step))
	}
	f.prepared.authority, f.prepared.shop, f.prepared.broker = a, nil, &originalTaskAuthorityBroker{client: c}
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	return f, a, c
}

func p08BrokerResult(t *testing.T, f *p08ShopFixture) originalclient.TaskAuthorityResult {
	t.Helper()
	b := f.authority.authorization.Binding
	selection, err := open.DecodeShopOrderReadInputDATA(f.input)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]string
	if err := json.Unmarshal(f.data, &data); err != nil {
		t.Fatal(err)
	}
	s := b.Sources[0]
	declared := open.ShopOrderReadDeclaredSourceDATA{Resource: shopSDKRef(s.Resource), Fields: s.Fields, Label: s.Label, Binding: shopSDKBind(s.Binding)}
	encoded, err := open.EncodeShopOrderReadResponseDATA(open.ShopOrderReadResponseValueDATA{Version: "1", Profile: open.ShopOrderReadResultProfile, Projection: open.ShopOrderReadProjectionDATA{OrderID: selection.OrderID, Snapshot: selection.Snapshot, Fields: selection.Fields, Data: data}, Source: declared, AuthFence: string(policy.EgressOnlyReadFence)}, open.ShopOrderReadExpectedResponseDATA{Selection: selection, Source: declared})
	if err != nil {
		t.Fatal(err)
	}
	op := strings.Repeat("ab", 32)
	return originalclient.TaskAuthorityResult{State: "COMMITTED", OriginalOperation: op, Original: "PUBLIC-opaque-authority-original", Resource: &originalclient.TaskResourceResult{OperationID: op, RemoteRef: "shop-original-ref", AuthScope: string(policy.EgressOnlyReadFence), Source: s, ResponseBinding: shopPolicyBind(encoded.ResponseBinding), ResponseOriginal: encoded.ResponseOriginal, SourceBytes: encoded.SourceBytes}}
}

func p08BrokerStored(f *p08ShopFixture) ActionRecord {
	f.store.mu.Lock()
	defer f.store.mu.Unlock()
	r := f.store.state.Actions[f.step.ID]
	b := *r.ToolStep
	r.ToolStep = &b
	return r
}
func p08BrokerRestart(t *testing.T, f *p08ShopFixture) {
	t.Helper()
	store, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.store, f.server = store, &Server{store: store}
	// PUBLIC private install; no HTTP/global setter or normal Source factory.
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
}

func TestP08AuthorityBrokerModelEncryptedResultJourney(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, false)
	ctx := context.Background()
	r := taskRunRequest{RunID: "PUBLIC-broker-model", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Read selected order through original authority.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID}}
	pending, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	f.step, _ = f.store.Action(f.session.Account, pending.Steps[0])
	f.approve(t)
	c.result = p08BrokerResult(t, f)
	wire := bytes.Clone(c.result.Resource.ResponseOriginal)
	backup := filepath.Join(t.TempDir(), "PUBLIC-broker.ynxbackup")
	if _, err := f.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	restored, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), f.key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	f.store, f.server.store = restored, restored
	if err := f.prepared.install(f.server); err != nil {
		t.Fatal(err)
	}
	r.Resume, r.Prompt = true, ""
	result, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Actual PUBLIC HTTP provider answer for the verified order." || len(c.news) != 1 || len(c.queries) != 0 || a.queryCalls != 0 || f.providerRequests.Load() != 2 || a.disclosures != 3 || f.caller.calls.Load() != 0 {
		t.Fatalf("broker/model journey: %+v %v NEW=%d query=%d disclosure=%d", result, err, len(c.news), len(c.queries), a.disclosures)
	}
	stored := p08BrokerStored(f)
	if stored.Status != "COMPLETED" || stored.ToolStep.AuthorityOperationID != c.result.OriginalOperation || stored.ToolStep.RemoteOperationID != f.step.ID || stored.ToolStep.ResultWireCipher == "" || stored.ToolStep.ResultCipher == "" {
		t.Fatal("exact original wire/reference was not durably encrypted")
	}
	disk, err := os.ReadFile(f.store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(disk, wire) || bytes.Contains(disk, f.projection) || bytes.Contains(disk, []byte(result.Content)) || bytes.Contains(disk, c.news[0].Grant.Payload) {
		t.Fatal("private result/model/proof exposed on disk")
	}
	// Response buffers owned by the client cannot mutate persisted receipt.
	c.result.Resource.ResponseOriginal[0] = '!'
	p08BrokerRestart(t, f)
	receipt, err := f.server.reconcileStep(ctx, f.session, f.task.ID, f.step.ID, r.AuthorizationRef)
	if err != nil || receipt.State != "COMMITTED" || receipt.AuthorityOperationID != c.result.OriginalOperation || !bytes.Contains(receipt.Result, []byte("processing")) || len(c.news) != 1 || len(c.queries) != 0 {
		t.Fatalf("encrypted receipt restart: %+v %v", receipt, err)
	}
}

func TestP08AuthorityBrokerPartialUnknownRestartQueryOnly(t *testing.T) {
	for _, effectUnavailable := range []bool{false, true} {
		t.Run(map[bool]string{false: "effect-current", true: "effect-retired-query-current"}[effectUnavailable], func(t *testing.T) {
			f, a, c := newP08BrokerFixture(t, true)
			f.approve(t)
			complete := p08BrokerResult(t, f)
			late := errors.New("PUBLIC late original Source failure")
			c.result, c.effectErr = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: complete.OriginalOperation}, late
			if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); !errors.Is(err, late) {
				t.Fatalf("late error lost: %v", err)
			}
			before := p08BrokerStored(f)
			if before.Status != "UNKNOWN" || before.ToolStep.AuthorityOperationID != complete.OriginalOperation || before.ToolStep.ResultCipher != "" || before.ToolStep.EffectFirstCause == "" {
				t.Fatal("partial Node op lost or treated as resource receipt")
			}
			if effectUnavailable {
				a.currentErr = errors.New("PUBLIC effect Source retired")
				// PUBLIC private installation of the recovery-only branch. No
				// original owner factory or production Source is acquired here.
				f.prepared.owners = &originalTaskRuntimeOwners{}
				f.prepared.recoveryOnly = a.currentErr
			}
			p08BrokerRestart(t, f)
			resolves := a.resolveCalls
			c.result, c.effectErr = complete, nil
			receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
			if err != nil || receipt.State != "COMMITTED" || receipt.AuthorityOperationID != complete.OriginalOperation || len(c.news) != 1 || len(c.queries) != 1 || a.resolveCalls != resolves || a.queryCalls != 1 {
				t.Fatalf("historical recovery: %+v %v NEW=%d query=%d", receipt, err, len(c.news), len(c.queries))
			}
			q := c.queries[0]
			if q.OriginalOperation != complete.OriginalOperation || q.OriginalOperation == f.step.ID || !bytes.Equal(q.RawInput, c.news[0].RawInput) || !reflect.DeepEqual(q.Grant, c.news[0].Grant) || !reflect.DeepEqual(q.Holder, c.news[0].Holder) || p08BrokerStored(f).ToolStep.EffectFirstCause != before.ToolStep.EffectFirstCause {
				t.Fatal("query replaced original operation/proofs/input/first cause")
			}
			if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil || len(c.news) != 1 {
				t.Fatal("recovery replayed NEW")
			}
		})
	}
}

func TestP08AuthorityBrokerUnknownModelCheckpointRecovery(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, false)
	ctx := context.Background()
	r := taskRunRequest{RunID: "PUBLIC-broker-unknown-model", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Read selected order.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID}}
	pending, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	f.step, _ = f.store.Action(f.session.Account, pending.Steps[0])
	f.approve(t)
	complete := p08BrokerResult(t, f)
	c.result = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: complete.OriginalOperation}
	c.effectErr = errors.New("PUBLIC response lost after Node reservation")
	r.Resume, r.Prompt = true, ""
	unknown, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if unknown.Status != "UNKNOWN" || unknown.Content != "" || f.providerRequests.Load() != 1 || len(c.news) != 1 {
		t.Fatalf("UNKNOWN produced a model answer or replay: %+v %v", unknown, err)
	}
	first := p08BrokerStored(f).ToolStep.EffectFirstCause
	p08BrokerRestart(t, f)
	resolves := a.resolveCalls
	c.result, c.effectErr = complete, nil
	result, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Actual PUBLIC HTTP provider answer for the verified order." || len(c.news) != 1 || len(c.queries) != 1 || c.queries[0].OriginalOperation != complete.OriginalOperation || a.resolveCalls != resolves || f.providerRequests.Load() != 2 || p08BrokerStored(f).ToolStep.EffectFirstCause != first {
		t.Fatalf("original checkpoint/query/model recovery: %+v %v NEW=%d query=%d", result, err, len(c.news), len(c.queries))
	}
}

func TestP08ShopModelResumeRefusesRevokedAuthorityBeforeClaim(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, false)
	ctx := context.Background()
	request := taskRunRequest{
		RunID: "PUBLIC-shop-revoked-resume", TaskRevision: f.task.Revision, Generation: f.task.Generation,
		Prompt: "Read the selected order.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID},
	}
	pending, err := f.server.runTaskModel(ctx, f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	f.step, _ = f.store.Action(f.session.Account, pending.Steps[0])
	f.approve(t)
	c.result = p08BrokerResult(t, f)
	before, err := os.ReadFile(f.store.path)
	if err != nil {
		t.Fatal(err)
	}
	revoked := errors.New("PUBLIC original effect authority revoked")
	a.currentErr = revoked
	request.Resume, request.Prompt = true, ""
	_, err = f.server.runTaskModel(ctx, f.session, f.task.ID, request)
	after, readErr := os.ReadFile(f.store.path)
	if readErr != nil {
		t.Fatal(readErr)
	}
	if !errors.Is(err, revoked) || !errors.Is(err, errTaskEffectSourceUnavailable) ||
		!bytes.Equal(before, after) || len(c.news) != 0 || len(c.queries) != 0 || f.providerRequests.Load() != 1 {
		t.Fatalf("revoked resume changed checkpoint=%t, effect=%d query=%d provider=%d err=%v",
			!bytes.Equal(before, after), len(c.news), len(c.queries), f.providerRequests.Load(), err)
	}

	a.currentErr = nil
	p08BrokerRestart(t, f)
	resumed, err := f.server.runTaskModel(ctx, f.session, f.task.ID, request)
	if err != nil || resumed.Status != "COMPLETED" || resumed.ID != pending.ID ||
		len(c.news) != 1 || len(c.queries) != 0 || f.providerRequests.Load() != 2 {
		t.Fatalf("original checkpoint did not resume: status=%q effect=%d query=%d provider=%d err=%v",
			resumed.Status, len(c.news), len(c.queries), f.providerRequests.Load(), err)
	}
}

func TestP08AuthorityBrokerModelRevocationBeforeShopCommit(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, false)
	ctx := context.Background()
	r := taskRunRequest{RunID: "PUBLIC-shop-revoke-before-commit", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Read the selected order.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID}}
	pending, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	f.step, _ = f.store.Action(f.session.Account, pending.Steps[0])
	f.approve(t)
	complete := p08BrokerResult(t, f)
	c.result = complete
	c.afterEffect = func() { a.currentErr = errors.New("PUBLIC effect authority revoked before local commit") }
	r.Resume, r.Prompt = true, ""
	unknown, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	step := p08BrokerStored(f)
	if !errors.Is(err, a.currentErr) || unknown.Status != "UNKNOWN" || unknown.Content != "" ||
		step.Status != "UNKNOWN" || step.ToolStep.ResultCipher != "" || step.ToolStep.ResultWireCipher != "" ||
		step.ToolStep.AuthorityOperationID != complete.OriginalOperation || step.ToolStep.RemoteRef != complete.Resource.RemoteRef ||
		len(c.news) != 1 || len(c.queries) != 0 || f.providerRequests.Load() != 1 {
		t.Fatalf("revoked effect crossed the result boundary: run=%q step=%q NEW=%d QUERY=%d provider=%d err=%v",
			unknown.Status, step.Status, len(c.news), len(c.queries), f.providerRequests.Load(), err)
	}

	// Keep the effect authority revoked during explicit historical recovery.
	a.f.prepared.owners = &originalTaskRuntimeOwners{}
	a.f.prepared.recoveryOnly = a.currentErr
	p08BrokerRestart(t, f)
	resolves := a.resolveCalls
	receipt, err := f.server.reconcileStep(ctx, f.session, f.task.ID, f.step.ID, r.AuthorizationRef)
	if err != nil || receipt.State != "COMMITTED" || receipt.AuthorityOperationID != complete.OriginalOperation ||
		len(c.news) != 1 || len(c.queries) != 1 || c.queries[0].OriginalOperation != complete.OriginalOperation ||
		!bytes.Equal(c.queries[0].RawInput, c.news[0].RawInput) || a.resolveCalls != resolves || f.providerRequests.Load() != 1 {
		t.Fatalf("query-only recovery: state=%q NEW=%d QUERY=%d provider=%d err=%v",
			receipt.State, len(c.news), len(c.queries), f.providerRequests.Load(), err)
	}

	// A new model disclosure still needs current effect/disclosure authority.
	a.currentErr, f.prepared.recoveryOnly = nil, nil
	p08BrokerRestart(t, f)
	result, err := f.server.runTaskModel(ctx, f.session, f.task.ID, r)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Actual PUBLIC HTTP provider answer for the verified order." ||
		len(c.news) != 1 || len(c.queries) != 1 || f.providerRequests.Load() != 2 {
		t.Fatalf("model continuation: status=%q NEW=%d QUERY=%d provider=%d err=%v",
			result.Status, len(c.news), len(c.queries), f.providerRequests.Load(), err)
	}
}

func TestP08ShopOrderCancelAtBrokerReturnColdHTTPRecovery(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, false)
	ctx := context.Background()
	request := taskRunRequest{
		RunID: "PUBLIC-shop-cancel-at-return", TaskRevision: f.task.Revision, Generation: f.task.Generation,
		Prompt: "Read the selected order.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID},
	}
	pending, err := f.server.runTaskModel(ctx, f.session, f.task.ID, request)
	if err != nil || len(pending.Steps) != 1 || pending.Status != "NEEDS_APPROVAL" {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	var found bool
	f.step, found = f.store.Action(f.session.Account, pending.Steps[0])
	if !found {
		t.Fatal("proposed Shop step is missing")
	}
	f.approve(t)
	c.result = p08BrokerResult(t, f)
	c.afterEffect = func() {
		task := f.store.state.Tasks[f.task.ID]
		body, _ := json.Marshal(map[string]uint64{"revision": task.Revision, "generation": task.Generation})
		r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+task.ID+"/cancel", bytes.NewReader(body))
		r.SetPathValue("id", task.ID)
		w := httptest.NewRecorder()
		f.server.handleTaskCancel(w, r, f.session)
		if w.Code != http.StatusOK || f.store.state.Tasks[task.ID].Status != "RECONCILING" {
			t.Fatalf("cancel did not retain effect debt: %d %s", w.Code, w.Body.String())
		}
	}
	request.Resume, request.Prompt = true, ""
	view, err := f.server.runTaskModel(ctx, f.session, f.task.ID, request)
	step := p08BrokerStored(f)
	if !errors.Is(err, context.Canceled) || !view.Cancelled || view.Status != "UNKNOWN" || view.Content != "" ||
		step.Status != "UNKNOWN" || step.ToolStep.AuthorityOperationID != c.result.OriginalOperation ||
		step.ToolStep.ResultCipher != "" || len(c.news) != 1 || f.providerRequests.Load() != 1 {
		t.Fatalf("cancelled run accepted late result: run=%q step=%q dispatches=%d provider=%d err=%v",
			view.Status, step.Status, len(c.news), f.providerRequests.Load(), err)
	}

	a.currentErr = errors.New("PUBLIC effect authority revoked")
	f.prepared.owners = &originalTaskRuntimeOwners{}
	f.prepared.recoveryOnly = a.currentErr
	p08BrokerRestart(t, f)
	path := "/api/tasks/" + f.task.ID + "/tool-steps/" + f.step.ID
	read := func() *httptest.ResponseRecorder {
		return conversationResultRead(f.server, f.session, f.task.ID, f.step.ID)
	}
	if w := read(); w.Code != http.StatusConflict || bytes.Contains(w.Body.Bytes(), []byte("processing")) {
		t.Fatalf("unsettled result was readable: %d", w.Code)
	}

	body, _ := json.Marshal(map[string]string{"authorizationRef": request.AuthorizationRef})
	r := httptest.NewRequest(http.MethodPost, path+"/reconcile", bytes.NewReader(body))
	r.SetPathValue("id", f.task.ID)
	r.SetPathValue("stepId", f.step.ID)
	w := httptest.NewRecorder()
	f.server.handleTaskToolReconcile(w, r, f.session)
	if w.Code != http.StatusOK || f.store.state.Tasks[f.task.ID].Status != "CANCELLED" {
		t.Fatalf("historical query did not settle cancelled task: %d %s", w.Code, w.Body.String())
	}
	p08BrokerRestart(t, f)
	got := read()
	var receipt taskReadReceipt
	var expectedProjection struct {
		Projection json.RawMessage `json:"projection"`
	}
	if err := json.Unmarshal(c.result.Resource.ResponseOriginal, &expectedProjection); err != nil {
		t.Fatal(err)
	}
	if got.Code != http.StatusOK || got.Header().Get("Cache-Control") != "no-store" ||
		json.Unmarshal(got.Body.Bytes(), &receipt) != nil || receipt.AuthorityOperationID != c.result.OriginalOperation ||
		receipt.RemoteRef != c.result.Resource.RemoteRef || !bytes.Equal(receipt.Result, expectedProjection.Projection) ||
		receipt.WireBinding == nil || *receipt.WireBinding != bindTaskBytes(c.result.Resource.ResponseOriginal) {
		t.Fatalf("cold GET lost original result: %d %s", got.Code, got.Body.String())
	}
	if _, err := f.server.runTaskModel(ctx, f.session, f.task.ID, request); err == nil {
		t.Fatal("cancelled run resumed model disclosure")
	}
	if len(c.news) != 1 || len(c.queries) != 1 || c.queries[0].OriginalOperation != c.result.OriginalOperation ||
		!bytes.Equal(c.queries[0].RawInput, c.news[0].RawInput) || f.providerRequests.Load() != 1 {
		t.Fatal("historical recovery replayed the order tool or disclosed its result to the model")
	}
}

func TestP08AuthorityBrokerRejectsMismatchedHistoryBeforeBindingOperation(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, true)
	f.approve(t)
	good := p08BrokerResult(t, f)
	ctx := context.Background()
	const ref = "PUBLIC-original-proof-ref"
	c.effectErr = errors.New("PUBLIC lost acknowledgement before original operation ID")
	if _, err := f.server.dispatchApprovedStep(ctx, f.session, f.task.ID, f.step.ID, ref); !errors.Is(err, c.effectErr) {
		t.Fatalf("lost acknowledgement: %v", err)
	}
	before := p08BrokerStored(f)
	if before.Status != "UNKNOWN" || before.ToolStep.AuthorityOperationID != "" {
		t.Fatal("test requires an uncertain step with no original ID yet")
	}
	p08BrokerRestart(t, f)
	a.queryOperation = strings.Repeat("cd", 32)
	a.queryBinding = func(b *policy.TaskEffectBinding) { b.SessionID = "PUBLIC-other-session" }
	if _, err := f.server.reconcileStep(ctx, f.session, f.task.ID, f.step.ID, ref); !errors.Is(err, errToolConflict) {
		t.Fatalf("mismatched history accepted: %v", err)
	}
	rejected := p08BrokerStored(f)
	if !reflect.DeepEqual(before, rejected) || len(c.queries) != 0 {
		t.Fatalf("mismatched history changed durable step or reached broker: operation=%q queries=%d",
			rejected.ToolStep.AuthorityOperationID, len(c.queries))
	}

	// The original holder DATA must match the detached history binding.
	a.queryBinding = nil
	originalHolder := a.authorization.Holder
	a.authorization.Holder.Payload = []byte("PUBLIC-invalid-original-holder")
	_, err := f.server.reconcileStep(ctx, f.session, f.task.ID, f.step.ID, ref)
	a.authorization.Holder = originalHolder
	if err == nil || !reflect.DeepEqual(before, p08BrokerStored(f)) || len(c.queries) != 0 {
		t.Fatal("mismatched Shop holder DATA changed durable step or reached broker")
	}

	p08BrokerRestart(t, f)
	a.queryBinding = nil
	a.queryOperation = good.OriginalOperation
	c.result = good
	receipt, err := f.server.reconcileStep(ctx, f.session, f.task.ID, f.step.ID, ref)
	if err != nil || receipt.State != "COMMITTED" || receipt.AuthorityOperationID != good.OriginalOperation ||
		len(c.news) != 1 || len(c.queries) != 1 || c.queries[0].OriginalOperation != good.OriginalOperation ||
		!bytes.Equal(c.queries[0].RawInput, c.news[0].RawInput) || p08BrokerStored(f).ToolStep.EffectFirstCause != before.ToolStep.EffectFirstCause {
		t.Fatalf("original order recovery: state=%q operation=%q NEW=%d QUERY=%d err=%v",
			receipt.State, receipt.AuthorityOperationID, len(c.news), len(c.queries), err)
	}
}

func TestP08ShopHistoryHTTPReportsUnavailableWithoutChangingOriginal(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, true)
	f.approve(t)
	good := p08BrokerResult(t, f)
	c.result = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: good.OriginalOperation}
	c.effectErr = errors.New("PUBLIC acknowledgement lost")
	const ref = "PUBLIC-original-proof-ref"
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, ref); !errors.Is(err, c.effectErr) {
		t.Fatalf("lost acknowledgement: %v", err)
	}
	p08BrokerRestart(t, f)
	before, err := os.ReadFile(f.store.path)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Config{GatewayURL: "http://127.0.0.1:1", GatewayKey: testGatewayKey,
		ExactWalletCallback: FormalCallback, TaskRuntime: f.prepared}, f.store, nil)
	if err != nil {
		t.Fatal(err)
	}
	server.wallet = &p08UserRecoveryAuthorizer{session: f.session}
	peer := httptest.NewServer(server.Handler())
	defer peer.Close()
	journal, err := aitaskclient.OpenJournal(filepath.Join(t.TempDir(), "operations"))
	if err != nil {
		t.Fatal(err)
	}
	client, err := aitaskclient.New(peer.URL, journal)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	query := aitaskclient.Request{Action: "step-reconcile", OperationID: "history-denied", TaskID: f.task.ID,
		StepID: f.step.ID, Proof: "PUBLIC-controlled-proof", Body: json.RawMessage(`{"authorizationRef":"PUBLIC-original-proof-ref"}`)}
	a.queryErr = errors.New("PUBLIC history authority offline")
	denied, err := client.Do(ctx, query)
	var httpErr *aitaskclient.HTTPError
	if !errors.As(err, &httpErr) || denied.Status != http.StatusServiceUnavailable {
		t.Fatalf("history refusal: %d %v", denied.Status, err)
	}
	after, err := os.ReadFile(f.store.path)
	if err != nil || !bytes.Equal(before, after) || a.queryCalls != 0 || len(c.queries) != 0 ||
		len(c.news) != 1 || f.providerRequests.Load() != 0 {
		t.Fatal("history outage changed the original or called tool/model")
	}
	a.queryErr, c.result = nil, good
	query.OperationID = "history-readback"
	if _, err := client.Do(ctx, query); err != nil {
		t.Fatal(err)
	}

	read := aitaskclient.Request{Action: "step-result", TaskID: f.task.ID, StepID: f.step.ID,
		Proof: query.Proof, ExpectedAuthorityOperationID: strings.Repeat("cd", 32)}
	if r, err := client.Do(ctx, read); err == nil || len(r.Body) != 0 {
		t.Fatal("client exposed receipt for a mismatched original operation")
	}
	read.ExpectedAuthorityOperationID = good.OriginalOperation
	result, err := client.Do(ctx, read)
	var receipt taskReadReceipt
	if err != nil || json.Unmarshal(result.Body, &receipt) != nil ||
		receipt.AuthorityOperationID != good.OriginalOperation || receipt.WireBinding == nil ||
		*receipt.WireBinding != bindTaskBytes(good.Resource.ResponseOriginal) {
		t.Fatalf("original result: HTTP %d, %v", result.Status, err)
	}
	if len(c.news) != 1 || len(c.queries) != 1 || c.queries[0].OriginalOperation != good.OriginalOperation ||
		f.providerRequests.Load() != 0 {
		t.Fatal("result reads replayed an operation or invoked the model")
	}
}

func TestP08HistorySourceLostDuringOriginalMaterialRead(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, true)
	f.approve(t)
	good := p08BrokerResult(t, f)
	c.result = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: good.OriginalOperation}
	c.effectErr = errors.New("PUBLIC acknowledgement lost")
	const ref = "PUBLIC-original-proof-ref"
	if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, ref); !errors.Is(err, c.effectErr) {
		t.Fatal(err)
	}
	p08BrokerRestart(t, f)
	before, err := os.ReadFile(f.store.path)
	if err != nil {
		t.Fatal(err)
	}
	a.materialErr = native.ErrUnavailable
	body := strings.NewReader(`{"authorizationRef":"PUBLIC-original-proof-ref"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/tool-steps/"+f.step.ID+"/reconcile", body)
	request.SetPathValue("id", f.task.ID)
	request.SetPathValue("stepId", f.step.ID)
	response := httptest.NewRecorder()
	f.server.handleTaskToolReconcile(response, request, f.session)
	after, err := os.ReadFile(f.store.path)
	if err != nil || response.Code != http.StatusServiceUnavailable || !bytes.Equal(before, after) || len(c.news) != 1 || len(c.queries) != 0 {
		t.Fatalf("history refusal HTTP=%d changed=%t NEW=%d QUERY=%d err=%v", response.Code, !bytes.Equal(before, after), len(c.news), len(c.queries), err)
	}
	a.materialErr, c.result = nil, good
	receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, ref)
	if err != nil || receipt.AuthorityOperationID != good.OriginalOperation || len(c.news) != 1 || len(c.queries) != 1 {
		t.Fatalf("original recovery failed: %+v %v", receipt, err)
	}
}

func TestP08AuthorityBrokerQueryFailureRetainsOriginalFacts(t *testing.T) {
	f, a, c := newP08BrokerFixture(t, true)
	f.approve(t)
	complete := p08BrokerResult(t, f)
	c.result = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: complete.OriginalOperation}
	c.effectErr = errors.New("PUBLIC uncertain dispatch")
	_, _ = f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
	before := p08BrokerStored(f)
	p08BrokerRestart(t, f)
	a.currentErr = errors.New("PUBLIC effect Source unavailable")
	c.result, c.queryErr = complete, errors.New("PUBLIC late query Source expiry")
	if _, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); !errors.Is(err, c.queryErr) {
		t.Fatalf("query error hidden: %v", err)
	}
	after := p08BrokerStored(f)
	if after.Status != "UNKNOWN" || after.ToolStep.AuthorityOperationID != before.ToolStep.AuthorityOperationID || after.ToolStep.EffectFirstCause != before.ToolStep.EffectFirstCause || after.ToolStep.ResultCipher != "" || len(c.news) != 1 || len(c.queries) != 1 {
		t.Fatal("late query error became success, lost original facts or redispatched")
	}
	// Even a COMMITTED reference retained with that error is not a resource
	// receipt. Independent query-current failure must stop before another call.
	a.queryErr = errors.New("PUBLIC history Source unavailable")
	if _, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); !errors.Is(err, a.queryErr) || len(c.queries) != 1 {
		t.Fatal("history-unavailable query reached the client")
	}
	a.queryErr, c.queryErr = nil, nil
	if receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err != nil || receipt.State != "COMMITTED" || len(c.news) != 1 || len(c.queries) != 2 {
		t.Fatalf("original query could not recover: %+v %v", receipt, err)
	}
}

func TestP08AuthorityBrokerRejectsUncorrelatedResource(t *testing.T) {
	for _, mode := range []string{"missing-resource", "resource-op", "source", "source-bytes", "response-binding", "response-body", "scope", "missing-ref", "node-op", "query-node-op"} {
		t.Run(mode, func(t *testing.T) {
			f, a, c := newP08BrokerFixture(t, true)
			f.approve(t)
			good := p08BrokerResult(t, f)
			c.result = good
			if mode == "node-op" || mode == "query-node-op" {
				c.result = originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: good.OriginalOperation}
				c.effectErr = errors.New("PUBLIC uncertain effect")
				_, _ = f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
				c.result = good
				if mode == "node-op" {
					c.result.OriginalOperation = strings.Repeat("cd", 32)
				} else {
					a.queryOperation = strings.Repeat("cd", 32)
				}
				if _, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
					t.Fatal("different Node op accepted")
				}
			} else {
				switch mode {
				case "missing-resource":
					c.result.Resource = nil
				case "resource-op":
					c.result.Resource.OperationID = strings.Repeat("cd", 32)
				case "source":
					c.result.Resource.Source.Resource.ID = "other-order"
				case "source-bytes":
					c.result.Resource.SourceBytes = []byte(`{"status":"other"}`)
				case "response-binding":
					c.result.Resource.ResponseBinding.SHA512 = strings.Repeat("0", 128)
				case "response-body":
					c.result.Resource.ResponseOriginal = append(c.result.Resource.ResponseOriginal, ' ')
				case "scope":
					c.result.Resource.AuthScope = "PUBLIC-unverified"
				case "missing-ref":
					c.result.Resource.RemoteRef = ""
				}
				if receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil || receipt.State == "COMMITTED" {
					t.Fatal("uncorrelated resource accepted")
				}
			}
			stored := p08BrokerStored(f)
			if stored.Status != "UNKNOWN" || stored.ToolStep.ResultCipher != "" || stored.ToolStep.ResultWireCipher != "" || stored.ToolStep.AuthorityOperationID != good.OriginalOperation {
				t.Fatal("rejected response committed data or replaced Node op")
			}
			if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil || len(c.news) != 1 || f.caller.calls.Load() != 0 {
				t.Fatal("uncertain slot re-POSTed")
			}
		})
	}
}

func TestP08AuthorityBrokerPartialOpaqueLocatorRecovery(t *testing.T) {
	for _, ref := range []string{
		"ynx-shop://原订单/结果?opaque=a/b%20c#never-follow",
		strings.Repeat("界", 1000) + " opaque / ? : #",
		strings.Repeat("x", 4096),
	} {
		t.Run(strconv.Itoa(len(ref))+"-bytes", func(t *testing.T) {
			f, a, c := newP08BrokerFixture(t, true)
			f.approve(t)
			c.result = p08BrokerResult(t, f)
			c.result.Resource.RemoteRef = ref
			// Original is an opaque service field, never a nested receipt, URL,
			// JSON instruction or replacement for the independent Resource facts.
			c.result.Original = `{"ResourceResult":"DO NOT PARSE","url":"https://invalid.invalid/never-follow",`
			c.effectErr = errors.New("PUBLIC partial result with late current failure")
			if receipt, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); !errors.Is(err, c.effectErr) || receipt.State == "COMMITTED" {
				t.Fatalf("late partial result became success: %+v %v", receipt, err)
			}
			before := p08BrokerStored(f)
			if before.Status != "UNKNOWN" || before.ToolStep.RemoteRef != ref || before.ToolStep.AuthorityOperationID != c.result.OriginalOperation || before.ToolStep.ResultCipher != "" || before.ToolStep.ResultWireCipher != "" {
				t.Fatal("partial opaque locator lost or became committed result")
			}
			p08BrokerRestart(t, f)
			resolves := a.resolveCalls
			// A different later locator must not overwrite the durable first one.
			c.result.Resource.RemoteRef = "ynx-shop://different-original"
			c.effectErr = nil
			if _, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
				t.Fatal("conflicting locator accepted")
			}
			conflict := p08BrokerStored(f)
			if conflict.ToolStep.RemoteRef != ref || conflict.ToolStep.EffectFirstCause != before.ToolStep.EffectFirstCause || conflict.ToolStep.ResultCipher != "" {
				t.Fatal("conflicting locator overwrote original metadata/first cause")
			}
			c.result.Resource.RemoteRef = ref
			receipt, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
			if err != nil || receipt.State != "COMMITTED" || receipt.RemoteRef != ref || receipt.AuthorityOperationID != c.result.OriginalOperation || len(c.news) != 1 || len(c.queries) != 2 || a.resolveCalls != resolves || f.caller.calls.Load() != 0 || f.providerRequests.Load() != 0 {
				t.Fatalf("opaque original query recovery: %+v %v", receipt, err)
			}
		})
	}
}

func TestP08AuthorityBrokerRejectsUnboundedLocator(t *testing.T) {
	for name, ref := range map[string]string{"oversize": strings.Repeat("x", 4097), "invalid-utf8": string([]byte{0xff})} {
		t.Run(name, func(t *testing.T) {
			f, _, c := newP08BrokerFixture(t, true)
			f.approve(t)
			c.result = p08BrokerResult(t, f)
			c.result.Resource.RemoteRef = ref
			if _, err := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref"); err == nil {
				t.Fatal("unbounded or invalid UTF-8 locator accepted")
			}
			r := p08BrokerStored(f)
			if r.Status != "UNKNOWN" || r.ToolStep.AuthorityOperationID != c.result.OriginalOperation || r.ToolStep.RemoteRef != "" || r.ToolStep.ResultCipher != "" || r.ToolStep.ResultWireCipher != "" || len(c.news) != 1 {
				t.Fatal("invalid locator persisted or Node operation lost")
			}
		})
	}
}
