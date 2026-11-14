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
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// PUBLIC lifecycle fixtures only: actual provider HTTP, encrypted Store and
// normal return path, with explicit local invalidation at the authority port.
// These do not implement or admit the supplier's protected Source/Node API.
type p08ReturnGateFixture struct {
	invalid atomic.Bool
	mu      sync.Mutex
	checks  []taskModelAdmissionSnapshot
	cause   error
	onCheck func(int) error
}

func (f *p08ReturnGateFixture) check(_ context.Context, session ProductSession, task TaskRecord, url, model string, body []byte) error {
	f.mu.Lock()
	f.checks = append(f.checks, taskModelAdmissionSnapshot{Session: cloneTaskModelSession(session), Task: task, ProviderURL: url, Model: model, Body: bytes.Clone(body)})
	n := len(f.checks)
	f.mu.Unlock()
	// A supplier must receive an owned operand; mutating its copy cannot
	// change the provider request, persisted original body or actual session.
	if len(body) > 0 {
		body[0] = '!'
	}
	if len(session.Scopes) > 0 {
		session.Scopes[0] = "PUBLIC-mutated-authority-copy"
	}
	if f.onCheck != nil {
		if err := f.onCheck(n); err != nil {
			return err
		}
	}
	if f.invalid.Load() {
		return f.cause
	}
	return nil
}

func (f *p08ReturnGateFixture) snapshots() []taskModelAdmissionSnapshot {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]taskModelAdmissionSnapshot(nil), f.checks...)
}

const p08ReturnAnswer = "Private actual HTTP provider final answer."

func newP08ReturnFixture(t *testing.T, late bool, cause error) (*p08ModelFixture, *p08ReturnGateFixture) {
	t.Helper()
	gate := &p08ReturnGateFixture{cause: cause}
	f := newP08ModelFixture(t, func(w http.ResponseWriter, _ *http.Request) {
		if late {
			gate.invalid.Store(true)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": p08ReturnAnswer}}}})
	})
	f.server.taskModelAdmit = gate.check
	return f, gate
}

func p08ReturnRead(t *testing.T, server *Server, session ProductSession, taskID, runID string) taskRunView {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/tasks/"+taskID+"/runs/"+runID, nil)
	request.SetPathValue("id", taskID)
	request.SetPathValue("runId", runID)
	recorder := httptest.NewRecorder()
	server.handleTaskModelRunRead(recorder, request, session)
	if recorder.Code != http.StatusOK {
		t.Fatalf("owned run read failed: %d %s", recorder.Code, recorder.Body.String())
	}
	var view taskRunView
	if err := json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
		t.Fatal(err)
	}
	return view
}

func p08AssertOriginalReturnBody(t *testing.T, gate *p08ReturnGateFixture) {
	t.Helper()
	snapshots := gate.snapshots()
	if len(snapshots) < 2 {
		t.Fatal("final return never rechecked authority")
	}
	for _, snapshot := range snapshots[1:] {
		if !reflect.DeepEqual(snapshot.Session, snapshots[0].Session) || !reflect.DeepEqual(snapshot.Task, snapshots[0].Task) || snapshot.ProviderURL != snapshots[0].ProviderURL || snapshot.Model != snapshots[0].Model || !bytes.Equal(snapshot.Body, snapshots[0].Body) {
			t.Fatal("return check substituted original admitted session/task/destination/model/body")
		}
	}
}

func TestP08ModelReturnLateSourceLifecycle(t *testing.T) {
	for _, mode := range []string{"revoked", "expired", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			cause := errors.New("PUBLIC original Source " + mode)
			f, gate := newP08ReturnFixture(t, true, cause)
			request := f.request()
			request.Prompt = "Private selected prompt for return lifecycle."
			view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
			if !errors.Is(err, cause) || !errors.Is(err, errTaskModelReturnBlocked) || view.Status != "RETURN_BLOCKED" || view.Content != "" || f.requests.Load() != 1 {
				t.Fatalf("late Source failure exposed answer/recalled provider: %+v %v", view, err)
			}
			run := f.server.store.state.TaskRuns[view.ID]
			if run.ReturnState != taskModelReturnBlocked || run.Active || run.AnswerCipher == "" || run.AdmissionCipher == "" || run.FirstCause == "" {
				t.Fatal("blocked original final/admission was not durable")
			}
			answer, err := f.server.store.decrypt(run.Account, storedMessage{Message: Message{ID: run.ID + ":answer", ConversationID: run.TaskID}, Nonce: run.AnswerNonce, Cipher: run.AnswerCipher})
			if err != nil || answer != p08ReturnAnswer {
				t.Fatalf("blocked answer was lost: %v", err)
			}
			disk, err := os.ReadFile(f.server.store.path)
			if err != nil {
				t.Fatal(err)
			}
			if bytes.Contains(disk, []byte(p08ReturnAnswer)) || bytes.Contains(disk, []byte(request.Prompt)) || bytes.Contains(disk, []byte("isolated-provider-key")) {
				t.Fatal("private original admission/answer/credential leaked to disk")
			}
			if got := p08ReturnRead(t, f.server, f.session, f.task.ID, run.ID); got.Content != "" || got.Status != "RETURN_BLOCKED" {
				t.Fatalf("GET bypassed blocked return: %+v", got)
			}
			request.Prompt = ""
			for _, resume := range []bool{false, true} {
				request.Resume = resume
				if got, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, cause) || got.Content != "" || got.Status != "RETURN_BLOCKED" || f.requests.Load() != 1 {
					t.Fatalf("repeat/resume bypassed gate or replayed model: %+v %v", got, err)
				}
			}
			restarted, err := NewStore(f.server.store.path, f.key)
			if err != nil {
				t.Fatal(err)
			}
			server := &Server{store: restarted, taskModel: f.provider, toolEffects: f.server.toolEffects, taskModelAdmit: gate.check}
			if got, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, cause) || got.Content != "" || f.requests.Load() != 1 {
				t.Fatalf("restart re-entered old checkpoint/provider: %+v %v", got, err)
			}
			retained := restarted.state.TaskRuns[run.ID]
			if retained.AnswerCipher != run.AnswerCipher || retained.AdmissionCipher != run.AdmissionCipher || retained.CheckpointCipher != run.CheckpointCipher || retained.FirstCause != run.FirstCause {
				t.Fatal("return retry replaced original answer/admission/checkpoint/first cause")
			}
			p08AssertOriginalReturnBody(t, gate)
			if strings.Contains(f.session.Scopes[0], "mutated") {
				t.Fatal("authority mutated actual caller session")
			}
			if mode == "unavailable" {
				// Explicit retry checks the recovered SAME Source and returns only
				// its stored answer. No Grant resolve, provider or tool call occurs.
				gate.invalid.Store(false)
				got, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request)
				if err != nil || got.Status != "COMPLETED" || got.Content != p08ReturnAnswer || f.requests.Load() != 1 {
					t.Fatalf("same-Source return retry did not release original answer: %+v %v", got, err)
				}
				checks := len(gate.snapshots())
				gate.invalid.Store(true)
				if history := p08ReturnRead(t, server, f.session, f.task.ID, run.ID); history.Content != p08ReturnAnswer || len(gate.snapshots()) != checks {
					t.Fatal("already delivered COMPLETED history semantics changed")
				}
			}
		})
	}
}

func TestP08ModelReturnPendingCrashRecoveryAndSingleClaim(t *testing.T) {
	f, gate := newP08ReturnFixture(t, false, errors.New("PUBLIC Source expired during return check"))
	entered, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	gate.onCheck = func(n int) error {
		if n == 1 {
			return nil
		}
		if n == 2 {
			close(entered)
			<-release
		}
		return gate.cause
	}
	type outcome struct {
		view taskRunView
		err  error
	}
	done := make(chan outcome, 1)
	request := f.request()
	go func() {
		view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
		done <- outcome{view, err}
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("return check not entered")
	}
	key := modelRunKey(f.session.Account, f.task.ID, request.RunID)
	f.server.store.mu.Lock()
	pending := f.server.store.state.TaskRuns[key]
	f.server.store.mu.Unlock()
	if pending.ReturnState != taskModelReturnPending || pending.AnswerCipher == "" || !pending.Active {
		t.Fatal("provider final was not private/durable before check")
	}
	if got, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, errTaskEffectUnresolved) || got.Content != "" || len(gate.snapshots()) != 2 || f.requests.Load() != 1 {
		t.Fatalf("concurrent return acquired second check/provider: %+v %v", got, err)
	}
	backup := filepath.Join(t.TempDir(), "return-pending.ynxbackup")
	if _, err := f.server.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), f.key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	server := &Server{store: store, taskModel: f.provider, toolEffects: f.server.toolEffects, taskModelAdmit: gate.check}
	request.Prompt, request.Resume = "", true
	if got, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, gate.cause) || got.Content != "" || got.Status != "RETURN_BLOCKED" || f.requests.Load() != 1 {
		t.Fatalf("pending return restart lost original final/replayed HTTP: %+v %v", got, err)
	}
	release <- struct{}{}
	select {
	case got := <-done:
		if !errors.Is(got.err, gate.cause) || got.view.Content != "" {
			t.Fatalf("original pending return escaped: %+v %v", got.view, got.err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("original return check did not drain")
	}
	p08AssertOriginalReturnBody(t, gate)
}

func TestP08ModelReturnMissingAdmissionAndHistory(t *testing.T) {
	f, gate := newP08ReturnFixture(t, false, errTaskEffectSourceUnavailable)
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
	if err != nil || view.Content != p08ReturnAnswer {
		t.Fatalf("valid current return failed: %+v %v", view, err)
	}
	store := f.server.store
	store.mu.Lock()
	legacy := store.state.TaskRuns[view.ID]
	legacy.Status, legacy.ReturnState, legacy.AdmissionNonce, legacy.AdmissionCipher = "UNKNOWN", "", "", ""
	legacy.FirstCause = "ORIGINAL_UNRESOLVED_CAUSE"
	err = store.saveTaskRunLocked(legacy, "PUBLIC_legacy_answer_without_admission_fixture")
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	checks := len(gate.snapshots())
	request := f.request()
	request.Prompt, request.Resume = "", true
	blocked, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, errTaskModelReturnBlocked) || blocked.Content != "" || blocked.FirstCause != legacy.FirstCause || f.requests.Load() != 1 || len(gate.snapshots()) != checks {
		t.Fatalf("missing original admission gained default authorization/replayed checkpoint: %+v %v", blocked, err)
	}
	if got := p08ReturnRead(t, f.server, f.session, f.task.ID, view.ID); got.Content != "" {
		t.Fatal("legacy undelivered answer exposed by GET")
	}
}

func TestP08ModelReturnDecisionSaveFailureKeepsPrivateRecovery(t *testing.T) {
	cause := errors.New("PUBLIC original Source unavailable at return")
	f, gate := newP08ReturnFixture(t, false, cause)
	path := f.server.store.path
	gate.onCheck = func(n int) error {
		if n < 2 {
			return nil
		}
		if n == 2 {
			f.server.store.mu.Lock()
			f.server.store.path = filepath.Join(path, "not-a-directory.json")
			f.server.store.mu.Unlock()
		}
		return cause
	}
	request := f.request()
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, cause) || view.Content != "" || f.requests.Load() != 1 {
		t.Fatalf("failed return decision save leaked/replayed final: %+v %v", view, err)
	}
	f.server.store.mu.Lock()
	f.server.store.path = path
	f.server.store.mu.Unlock()
	store, err := NewStore(path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	key := modelRunKey(f.session.Account, f.task.ID, request.RunID)
	pending := store.state.TaskRuns[key]
	if pending.AnswerCipher == "" || pending.AdmissionCipher == "" || pending.ReturnState != taskModelReturnPending || !pending.Active {
		t.Fatal("decision write failure lost durable original answer or falsely committed authorization")
	}
	server := &Server{store: store, taskModel: f.provider, toolEffects: f.server.toolEffects, taskModelAdmit: gate.check}
	request.Prompt, request.Resume = "", true
	blocked, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, cause) || blocked.Content != "" || blocked.Status != "RETURN_BLOCKED" || f.requests.Load() != 1 || store.state.TaskRuns[key].AnswerCipher != pending.AnswerCipher || store.state.TaskRuns[key].AdmissionCipher != pending.AdmissionCipher {
		t.Fatalf("recovery from failed decision save bypassed/replayed: %+v %v", blocked, err)
	}
	p08AssertOriginalReturnBody(t, gate)
}

func TestP08ModelReturnRejectsChangedFenceDuringCheck(t *testing.T) {
	for _, mode := range []string{"holder", "cancel", "configuration"} {
		t.Run(mode, func(t *testing.T) {
			f, gate := newP08ReturnFixture(t, false, nil)
			var configuration AgentConfiguration
			if mode == "configuration" {
				configuration = p08CreateAgentConfiguration(t, f.server.store, f.session.Account)
				bound, err := f.server.store.BindAgentConfiguration(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, configuration.ID)
				if err != nil {
					t.Fatal(err)
				}
				f.task = bound
			}
			gate.onCheck = func(n int) error {
				if n != 2 {
					return nil
				}
				switch mode {
				case "holder":
					_, err := f.server.store.HandoffTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID, "new-holder")
					return err
				case "cancel":
					_, err := f.server.store.CancelTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID)
					return err
				default:
					_, err := f.server.store.ConfigureAgent(f.session.Account, configuration.ID, configuration.Revision, configuration.Name, configuration.ModelRef, configuration.ToolIDs, "paused")
					return err
				}
			}
			view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
			if err == nil || view.Content != "" || view.Status != "STOPPED" || f.requests.Load() != 1 {
				t.Fatalf("return check overwrote current local fence: %+v %v", view, err)
			}
			run := f.server.store.state.TaskRuns[view.ID]
			if run.AnswerCipher == "" || run.ReturnState != taskModelReturnBlocked {
				t.Fatal("blocked old-holder answer not retained privately")
			}
		})
	}
}

func TestP08ModelReturnShopEffectsAndCheckpointPreserved(t *testing.T) {
	f := newP08ShopFixture(t, false)
	original := f.server.taskModelAdmit
	var checks atomic.Int32
	cause := errors.New("PUBLIC Shop model return Source expired")
	f.server.taskModelAdmit = func(ctx context.Context, session ProductSession, task TaskRecord, url, model string, body []byte) error {
		if err := original(ctx, session, task, url, model, body); err != nil {
			return err
		}
		if checks.Add(1) >= 3 {
			return cause
		}
		return nil
	}
	request := taskRunRequest{RunID: "return-shop-original", TaskRevision: f.task.Revision, Generation: f.task.Generation, Prompt: "Read the selected Shop order.", AuthorizationRef: "PUBLIC-original-proof-ref", ToolIDs: []string{shopOrderToolID}}
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("Shop pending setup failed: %+v %v", pending, err)
	}
	f.step, _ = f.store.Action(f.session.Account, pending.Steps[0])
	f.approve(t)
	f.store.mu.Lock()
	prior := f.store.state.TaskRuns[pending.ID]
	prior.FirstCause = "EARLIER_ORIGINAL_RUN_CAUSE"
	err = f.store.saveTaskRunLocked(prior, "PUBLIC_prior_first_cause_fixture")
	f.store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	request.Prompt, request.Resume = "", true
	blocked, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, cause) || blocked.Status != "RETURN_BLOCKED" || blocked.Content != "" || f.providerRequests.Load() != 2 || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 0 {
		t.Fatalf("late Shop return failure leaked/replayed: %+v %v", blocked, err)
	}
	run := f.store.state.TaskRuns[pending.ID]
	step, _ := f.store.Action(f.session.Account, f.step.ID)
	if run.AnswerCipher == "" || run.CheckpointCipher != prior.CheckpointCipher || run.FirstCause != prior.FirstCause || step.Status != "COMPLETED" || step.ToolStep.RemoteOperationID != f.step.ID || step.ToolStep.RemoteRef == "" || step.ToolStep.ResultWireCipher == "" {
		t.Fatal("return block erased original checkpoint/effect/wire/ref/first cause")
	}
	backup := filepath.Join(t.TempDir(), "blocked-shop-return.ynxbackup")
	if _, err := f.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), f.key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	server := &Server{store: store}
	if err := f.prepared.install(server); err != nil {
		t.Fatal(err)
	}
	server.taskModelAdmit = f.server.taskModelAdmit
	resolves := f.authority.resolveCalls
	if retry, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, cause) || retry.Content != "" || retry.FirstCause != prior.FirstCause || f.providerRequests.Load() != 2 || f.caller.calls.Load() != 1 || f.caller.queries.Load() != 0 || f.authority.resolveCalls != resolves {
		t.Fatalf("blocked Shop restore re-entered grant/tool/provider/checkpoint: %+v %v", retry, err)
	}
}

func TestP08ModelRunReadWithDifferentSessionIsMetadataOnly(t *testing.T) {
	f, gate := newP08ReturnFixture(t, false, nil)
	request := f.request()
	run, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || run.Content != p08ReturnAnswer {
		t.Fatalf("original return: status=%q err=%v", run.Status, err)
	}
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{store: cold}
	reopened := f.session
	reopened.ID += "-different-session"
	for _, id := range []string{run.ID, run.RunID} {
		history := p08ReturnRead(t, server, reopened, f.task.ID, id)
		if !history.RecoveryOnly || history.Content != "" || history.ID != run.ID {
			t.Fatal("same device with different session received the original answer")
		}
	}
	if original := p08ReturnRead(t, server, f.session, f.task.ID, run.RunID); original.Content != p08ReturnAnswer || original.RecoveryOnly {
		t.Fatal("original session lost the verified answer after restart")
	}
	if f.requests.Load() != 1 || len(gate.snapshots()) != 2 {
		t.Fatal("readback re-entered the model or disclosure gate")
	}
}
