package aiproduct

import (
	"bytes"
	"context"
	"errors"
	"testing"

	authgrant "ynx.local/authgrantpolicy"
)

// PUBLIC-only composition fixture: real Go policy and original encrypted
// resource Store, without a protected signer, enrollment or production admission.
type p08RuntimeAuthorityFixture struct {
	authorization             OriginalTaskGrantAuthorization
	currentErr                error
	resolveCalls, disclosures int
	disclosureErr             error
	mutate                    func(*OriginalTaskAuthorizationRequest)
}

func (f *p08RuntimeAuthorityFixture) Current(context.Context) error { return f.currentErr }
func (f *p08RuntimeAuthorityFixture) ResolveTaskGrant(_ context.Context, r OriginalTaskAuthorizationRequest) (OriginalTaskGrantAuthorization, error) {
	f.resolveCalls++
	if f.mutate != nil {
		f.mutate(&r)
	}
	return f.authorization, nil
}
func (f *p08RuntimeAuthorityFixture) CheckTaskModelDisclosure(_ context.Context, _ ProductSession, _ TaskRecord, _, _ string, body []byte) error {
	f.disclosures++
	if len(body) > 0 {
		body[0] = '!'
	}
	return f.disclosureErr
}

func TestP08RuntimeCompositionCustodyBeforeStore(t *testing.T) {
	f := newP08ModelFixture(t)
	ctx := context.Background()
	var typedNil *p08RuntimeAuthorityFixture
	for _, authority := range []OriginalTaskRuntimeAuthority{nil, typedNil} {
		if _, err := PrepareOriginalTaskRuntime(ctx, f.provider, authority); !errors.Is(err, errTaskEffectSourceUnavailable) {
			t.Fatalf("nil authority installed: %v", err)
		}
	}
	original := errors.New("protected source retired")
	authority := &p08RuntimeAuthorityFixture{}
	prepared, err := PrepareOriginalTaskRuntime(ctx, f.provider, authority)
	if err != nil {
		t.Fatal(err)
	}
	authority.currentErr = original
	opened := 0
	if _, err = prepared.OpenOriginal(ctx, Config{}, func() (*Store, error) { opened++; return f.server.store, nil }, nil); !errors.Is(err, original) || opened != 0 {
		t.Fatalf("unavailable source opened Store: %d %v", opened, err)
	}
	authority.currentErr = nil
	server, err := prepared.OpenOriginal(ctx, Config{GatewayURL: "http://127.0.0.1:6429", GatewayKey: "isolated-normal-gateway-key", ExactWalletCallback: "ynxai://wallet-auth/callback"}, func() (*Store, error) { opened++; return f.server.store, nil }, nil)
	if err != nil || server == nil || server.taskModel != f.provider || server.toolEffects == nil || opened != 1 {
		t.Fatalf("normal constructor did not compose: %v", err)
	}
	body := []byte(`{"private":"source"}`)
	saved := append([]byte(nil), body...)
	authority.disclosureErr = original
	if err = server.taskModelAdmit(ctx, f.session, f.task, "https://model.invalid", "fixed", body); !errors.Is(err, original) || !bytes.Equal(body, saved) || authority.disclosures != 1 {
		t.Fatalf("disclosure authority or bytes lost: %v", err)
	}
	authority.currentErr = original
	if err = server.taskModelAdmit(ctx, f.session, f.task, "https://model.invalid", "fixed", body); !errors.Is(err, original) || authority.disclosures != 1 {
		t.Fatalf("retired runtime called egress: %v", err)
	}
}

func TestP08RuntimeCompositionActualGrantApprovalAndRead(t *testing.T) {
	f := newP08ModelFixture(t)
	store, binding, held := p08OriginalAuthFixture(t)
	proof := authgrant.Proof{Payload: []byte("PUBLIC-payload"), Wire: []byte("PUBLIC-not-signature"), Purpose: "PUBLIC-fixture"}
	authority := &p08RuntimeAuthorityFixture{authorization: OriginalTaskGrantAuthorization{Verifier: p08OriginalVerifierFixture{held: held}, Binding: binding, Grant: proof, Holder: proof}}
	prepared, err := PrepareOriginalTaskRuntime(context.Background(), f.provider, authority)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{store: store}
	if err = prepared.install(server); err != nil {
		t.Fatal(err)
	}
	// Return the isolated proposal to its actual pre-approval state. From here
	// only the normal protected bridge can commit the selected approval.
	store.mu.Lock()
	step := store.state.Actions[binding.StepID]
	step.Status = "NEEDS_APPROVAL"
	step.ToolStep.TaskGrantRef = ""
	step.ToolStep.ApprovedFields = nil
	store.state.Actions[step.ID] = step
	task := store.state.Tasks[binding.Task.ID]
	task.Status = "NEEDS_APPROVAL"
	store.state.Tasks[task.ID] = task
	session := ProductSession{ID: binding.SessionID, Account: binding.Account, DeviceID: binding.Holder.ID, SessionBinding: binding.ChannelBinding}
	call, err := store.effectCallLocked(session, task.ID, step.ID, false)
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	source := server.toolEffects.(originalTaskApprovalSource)
	if err = source.approveTaskStep(context.Background(), call, "original-proof-reference"); err != nil {
		t.Fatal(err)
	}
	store.mu.Lock()
	approved := store.state.Actions[step.ID]
	store.mu.Unlock()
	if approved.ToolStep.TaskGrantRef != binding.GrantID || approved.Status != "approved_not_executed" {
		t.Fatal("actual Grant approval not committed")
	}
	receipt, err := server.dispatchApprovedStep(context.Background(), session, task.ID, step.ID, "original-proof-reference")
	if err != nil || receipt.State != "COMMITTED" || !bytes.Contains(receipt.Result, []byte("actual selected source body")) || held.closed != 2 {
		t.Fatalf("normal protected composition did not read actual resource: %+v %v close=%d", receipt, err, held.closed)
	}
	calls := authority.resolveCalls
	if _, err = server.reconcileStep(context.Background(), session, task.ID, step.ID, "original-proof-reference"); err != nil || authority.resolveCalls != calls {
		t.Fatalf("retained result reran authority/effect: %v", err)
	}
}

func TestP08RuntimeCompositionRejectsCrossBoundGrant(t *testing.T) {
	f := newP08ModelFixture(t)
	for _, kind := range []string{"account", "step", "input", "resource", "tool", "session"} {
		t.Run(kind, func(t *testing.T) {
			store, binding, held := p08OriginalAuthFixture(t)
			store.mu.Lock()
			step := store.state.Actions[binding.StepID]
			step.ToolStep.TaskGrantRef = ""
			store.state.Actions[step.ID] = step
			task := store.state.Tasks[binding.Task.ID]
			store.mu.Unlock()
			switch kind {
			case "account":
				binding.Account = "another-account"
			case "step":
				binding.StepID = "another-step"
			case "input":
				binding.Input.SHA512 = "wrong"
			case "resource":
				binding.Resources[0].ID = "another-conversation"
			case "tool":
				binding.Tool.ID = "shop.order.read"
			case "session":
				binding.SessionID = "another-session"
			}
			authority := &p08RuntimeAuthorityFixture{authorization: OriginalTaskGrantAuthorization{Verifier: p08OriginalVerifierFixture{held: held}, Binding: binding}}
			prepared, err := PrepareOriginalTaskRuntime(context.Background(), f.provider, authority)
			if err != nil {
				t.Fatal(err)
			}
			effect := &originalRuntimeToolEffects{runtime: prepared, store: store}
			call := taskEffectCall{Session: ProductSession{ID: "isolated-session", Account: task.Account, DeviceID: task.Holder, SessionBinding: "isolated-channel"}, Account: task.Account, CurrentTask: task, OriginalStep: step, OriginalOperationID: step.ID}
			if _, err = effect.resolve(context.Background(), call, "original-ref"); err == nil || held.closed != 0 {
				t.Fatalf("cross-bound grant reached Source: %v", err)
			}
		})
	}
}

func TestP08RuntimeCompositionLateCustodyAndCancellation(t *testing.T) {
	f := newP08ModelFixture(t)
	for _, cancelled := range []bool{false, true} {
		t.Run(map[bool]string{false: "late-retirement", true: "cancelled-opener"}[cancelled], func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			source := &p08RuntimeAuthorityFixture{}
			prepared, err := PrepareOriginalTaskRuntime(ctx, f.provider, source)
			if err != nil {
				t.Fatal(err)
			}
			original := errors.New("source changed while original Store opened")
			server, err := prepared.OpenOriginal(ctx, Config{}, func() (*Store, error) {
				if cancelled {
					cancel()
				} else {
					source.currentErr = original
				}
				return f.server.store, nil
			}, nil)
			if cancelled {
				original = context.Canceled
			}
			if server != nil || !errors.Is(err, original) {
				t.Fatalf("late failure exposed prepared server: %v", err)
			}
		})
	}
}

func TestP08RuntimeCompositionSourceContentMustStayBound(t *testing.T) {
	store, binding, held := p08OriginalAuthFixture(t)
	// A current account, task and Grant do not authorize bytes which changed
	// after the protected Source snapshot was selected.
	if _, err := store.AddMessage(binding.Account, binding.Resources[0].ID, Message{Role: "user", Content: "new unapproved private content", Status: "complete"}); err != nil {
		t.Fatal(err)
	}
	proof := authgrant.Proof{Payload: []byte("PUBLIC-payload"), Wire: []byte("PUBLIC-not-signature"), Purpose: "PUBLIC-fixture"}
	outcome, err := store.commitOriginalAuthTaskRead(context.Background(), p08OriginalVerifierFixture{held: held}, binding, proof, proof)
	if err == nil || outcome.Receipt.State == "COMMITTED" || len(outcome.Receipt.Result) != 0 || held.closed != 1 {
		t.Fatalf("changed source bytes escaped: %+v %v", outcome, err)
	}
	store.mu.Lock()
	step := store.state.Actions[binding.StepID]
	store.mu.Unlock()
	if step.Status == "COMPLETED" || step.ToolStep.ResultCipher != "" {
		t.Fatal("unapproved source bytes persisted as committed result")
	}
}

func TestP08RuntimeCompositionNeverMixesFixtureLogin(t *testing.T) {
	f := newP08ModelFixture(t)
	prepared, err := PrepareOriginalTaskRuntime(context.Background(), f.provider, &p08RuntimeAuthorityFixture{})
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Config{TaskRuntime: prepared, GatewayURL: "http://127.0.0.1:6429", GatewayKey: "isolated-normal-gateway-key", ExactWalletCallback: "ynxai://wallet-auth/callback", AllowLocalFixtureAuth: true}, f.server.store, nil)
	if server != nil || err == nil {
		t.Fatal("normal protected runtime accepted fixture login")
	}
}
