package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
)

// PUBLIC fixtures exercise the product port only: they are not a registered
// V6 action, real Auth Source, Native holder, or permission to disclose.
func p08ReturnRecheckFixture(t *testing.T) (*p08ModelFixture, *p08ReturnGateFixture, *TaskStoreSource, *TaskStoreSnapshot, TaskActionCall, taskModelRun) {
	t.Helper()
	f, gate := newP08ReturnFixture(t, true, errors.New("PUBLIC return Source unavailable"))
	request := f.request()
	blocked, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err == nil || blocked.Status != "RETURN_BLOCKED" {
		t.Fatalf("original answer not blocked: %+v %v", blocked, err)
	}
	source, err := f.server.OpenTaskStoreSource()
	if err != nil {
		t.Fatal(err)
	}
	p := TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: f.task.ID, RunID: request.RunID})
	if err != nil {
		t.Fatal(err)
	}
	call := p08ActionCall(taskReturnRecheckLocalAction, "/api/tasks/"+f.task.ID+"/runs/"+request.RunID+"/return-recheck", map[string]any{"runId": request.RunID, "taskRevision": f.task.Revision, "generation": f.task.Generation})
	return f, gate, source, held, call, f.server.store.state.TaskRuns[blocked.ID]
}

func TestP08OriginalReturnPortAtomicSameOperation(t *testing.T) {
	f, gate, source, held, call, before := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call)
	if err != nil {
		t.Fatal(err)
	}
	defer receipt.Close()
	data, err := receipt.Body()
	if err != nil {
		t.Fatal(err)
	}
	var result taskRunView
	if json.Unmarshal(data, &result) != nil || result.Content != p08ReturnAnswer || result.Status != "COMPLETED" || f.requests.Load() != 1 {
		t.Fatalf("original result not returned: %+v", result)
	}
	stored := f.server.store.state.TaskRuns[before.ID]
	if stored.AnswerCipher != before.AnswerCipher || stored.AdmissionCipher != before.AdmissionCipher || stored.ReturnState != taskModelReturnVerified {
		t.Fatal("original answer/admission changed")
	}
	lookup, err := source.QueryTaskActionOutcome(context.Background(), held.view.Principal, call)
	if err != nil {
		t.Fatal(err)
	}
	defer lookup.Close()
	view, err := lookup.View()
	if err != nil || view.OriginalOperationID != call.OriginalOperationID || view.RunRecordID != before.ID {
		t.Fatal("wrong original outcome")
	}
	checks := len(gate.snapshots())
	again, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call)
	if err != nil {
		t.Fatal(err)
	}
	defer again.Close()
	againBody, err := again.Body()
	if err != nil || !bytes.Equal(data, againBody) || len(gate.snapshots()) != checks || f.requests.Load() != 1 {
		t.Fatal("original outcome lookup re-executed or changed bytes")
	}
	changed := call
	changed.RequestRef = "PUBLIC-foreign-original-ref"
	if r, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, changed); r != nil || !errors.Is(err, ErrTaskConflict) {
		t.Fatal("changed original request reused outcome")
	}
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	if cold.state.TaskRuns[before.ID].ReturnState != taskModelReturnVerified || cold.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)].View.State != "COMMITTED" {
		t.Fatal("answer and original outcome not committed together")
	}
	coldSource, err := NewTaskStoreSource(cold)
	if err != nil {
		t.Fatal(err)
	}
	defer coldSource.Close()
	coldReceipt, err := coldSource.QueryTaskActionOutcome(context.Background(), held.view.Principal, call)
	if err != nil {
		t.Fatal(err)
	}
	defer coldReceipt.Close()
	coldBody, err := coldReceipt.Body()
	if err != nil || !bytes.Equal(data, coldBody) || f.requests.Load() != 1 {
		t.Fatal("cold query changed original result or called model")
	}
}

func TestP08OriginalReturnPortUnknownNeverReplays(t *testing.T) {
	f, gate, source, held, call, before := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("unavailable Source admitted: %v", err)
	}
	first := f.server.store.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)]
	if !first.FirstCausePresent || first.FirstCauseClass != "ORIGINAL_CHECK_FAILED" {
		t.Fatal("safe first cause class not retained")
	}
	disk, err := os.ReadFile(f.server.store.path)
	if err != nil || bytes.Contains(disk, []byte("PUBLIC return Source unavailable")) {
		t.Fatal("raw Source failure leaked to storage")
	}
	gate.invalid.Store(false)
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("pending original replayed: %v", err)
	}
	other := call
	other.OriginalOperationID = "PUBLIC-replacement-operation"
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, other); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("replacement original admitted: %v", err)
	}
	if !reflect.DeepEqual(before, f.server.store.state.TaskRuns[before.ID]) || f.requests.Load() != 1 {
		t.Fatal("pending return changed original or called model again")
	}
	cold, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	if cold.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)].View.State != "PENDING" || !reflect.DeepEqual(before, cold.state.TaskRuns[before.ID]) {
		t.Fatal("cold restart lost original pending/answer")
	}
	coldRecord := cold.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)]
	if !coldRecord.FirstCausePresent || coldRecord.FirstCauseClass != first.FirstCauseClass {
		t.Fatal("cold retry lost or replaced first cause class")
	}
	coldSource, err := NewTaskStoreSource(cold)
	if err != nil {
		t.Fatal(err)
	}
	defer coldSource.Close()
	original, err := coldSource.CaptureOriginalActionOutcome(context.Background(), TaskStoreActionOriginalLookup{Principal: held.view.Principal, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action})
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	originalView, err := original.View()
	if err != nil || originalView.State != "UNKNOWN" || originalView.Status != 0 {
		t.Fatal("cold lookup promoted pending original to success")
	}
	present, class, err := original.FirstCauseDATA()
	if err != nil || !present || class != first.FirstCauseClass {
		t.Fatal("cold original lookup did not return the retained safe first cause class")
	}
}

func TestP08OriginalReturnPortRejectsOldActionsAndMismatchedRequest(t *testing.T) {
	f, gate, source, held, call, _ := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	for _, action := range []string{"task.run-resume", "task.run-read", "cancel-task"} {
		rejected := call
		rejected.Action = action
		if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, rejected); receipt != nil || err == nil {
			t.Fatal("existing action reached provisional return port")
		}
	}
	bad := call
	bad.Method = http.MethodGet
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, bad); receipt != nil || err == nil {
		t.Fatal("GET admitted as return effect")
	}
	badPath := call
	badPath.Path = "/api/tasks/foreign/runs/foreign/return-recheck"
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, badPath); receipt != nil || err == nil {
		t.Fatal("foreign task path accepted")
	}
	badRun := p08ActionCall(taskReturnRecheckLocalAction, "/api/tasks/"+f.task.ID+"/runs/foreign/return-recheck", map[string]any{"runId": "foreign", "taskRevision": f.task.Revision, "generation": f.task.Generation})
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, badRun); receipt != nil || err == nil {
		t.Fatal("foreign signed run accepted")
	}
	badBody := p08ActionCall(taskReturnRecheckLocalAction, call.Path, map[string]any{"runId": f.request().RunID, "taskRevision": f.task.Revision, "generation": f.task.Generation, "unexpected": true})
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, badBody); receipt != nil || err == nil {
		t.Fatal("unknown body member accepted")
	}
	badCase := p08ActionCall(taskReturnRecheckLocalAction, call.Path, map[string]any{"RunId": f.request().RunID, "taskRevision": f.task.Revision, "generation": f.task.Generation})
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, badCase); receipt != nil || err == nil {
		t.Fatal("case-folded body alias accepted")
	}
	foreign := held.view.Principal
	foreign.SessionID = "PUBLIC-replacement-session"
	foreignHeld, err := source.Capture(context.Background(), TaskStoreCapture{Principal: foreign, TaskID: f.task.ID, RunID: f.request().RunID})
	if err != nil {
		t.Fatal(err)
	}
	defer foreignHeld.Close()
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), foreignHeld, call); receipt != nil || err == nil {
		t.Fatal("replacement session accessed original answer")
	}
	if f.requests.Load() != 1 || len(f.server.store.state.TaskActionOutcomes) != 0 {
		t.Fatal("invalid request reserved or ran original")
	}
}

func TestP08OriginalReturnPortConcurrentReplacementCannotEnter(t *testing.T) {
	f, gate, source, held, call, _ := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	entered, release := make(chan struct{}), make(chan struct{})
	gate.onCheck = func(n int) error {
		if n == 3 {
			close(entered)
			<-release
		}
		return nil
	}
	type outcome struct {
		receipt *TaskActionOutcomeReceipt
		err     error
	}
	done := make(chan outcome, 1)
	go func() {
		r, e := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call)
		done <- outcome{r, e}
	}()
	<-entered
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		close(release)
		t.Fatalf("same pending action re-entered: %v", err)
	}
	other := call
	other.OriginalOperationID = "PUBLIC-replacement-operation"
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, other); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		close(release)
		t.Fatalf("concurrent replacement entered: %v", err)
	}
	close(release)
	result := <-done
	if result.err != nil {
		t.Fatal(result.err)
	}
	defer result.receipt.Close()
	if f.requests.Load() != 1 || len(gate.snapshots()) != 3 {
		t.Fatal("replacement called the model or authorization")
	}
}

func TestP08OriginalReturnPortCancelDuringOriginalCheckKeepsPending(t *testing.T) {
	f, gate, source, held, call, before := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	gate.onCheck = func(n int) error {
		if n == 3 {
			_, err := f.server.store.CancelTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID)
			return err
		}
		return nil
	}
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("cancelled return released: %v", err)
	}
	current := f.server.store.state.TaskRuns[before.ID]
	if !current.Cancelled || current.AnswerCipher != before.AnswerCipher || current.AdmissionCipher != before.AdmissionCipher || f.server.store.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)].View.State != "PENDING" || f.requests.Load() != 1 {
		t.Fatal("cancel changed original or released pending result")
	}
}

type p08ReturnCommitContext struct {
	context.Context
	afterGate atomic.Bool
	once      sync.Once
	checked   chan struct{}
	release   chan struct{}
}

func (c *p08ReturnCommitContext) Err() error {
	err := c.Context.Err()
	if c.afterGate.Load() {
		c.once.Do(func() { close(c.checked); <-c.release })
	}
	return err
}

func TestP08OriginalReturnPortInvocationCancelledBeforeCommitLock(t *testing.T) {
	f, gate, source, held, call, before := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	base, cancel := context.WithCancel(context.Background())
	defer cancel()
	ctx := &p08ReturnCommitContext{Context: base, checked: make(chan struct{}), release: make(chan struct{})}
	gate.onCheck = func(n int) error {
		if n == 3 {
			ctx.afterGate.Store(true)
		}
		return nil
	}
	type outcome struct {
		receipt *TaskActionOutcomeReceipt
		err     error
	}
	done := make(chan outcome, 1)
	go func() { r, e := f.server.ExecuteOriginalTaskModelReturnRecheck(ctx, held, call); done <- outcome{r, e} }()
	<-ctx.checked
	f.server.store.mu.Lock()
	close(ctx.release)
	cancel() // capture context is still live; invocation context is not.
	f.server.store.mu.Unlock()
	result := <-done
	if result.receipt != nil || !errors.Is(result.err, context.Canceled) || !errors.Is(result.err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("cancelled invocation committed: %v", result.err)
	}
	stored := f.server.store.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)]
	if held.Current() != nil || !reflect.DeepEqual(before, f.server.store.state.TaskRuns[before.ID]) || stored.View.State != "PENDING" || !stored.FirstCausePresent || stored.FirstCauseClass != "INVOCATION_CANCELLED" {
		t.Fatal("cancelled invocation changed answer or original pending")
	}
}

func TestP08OriginalReturnPortDecisionSaveFailurePreservesPending(t *testing.T) {
	f, gate, source, held, call, before := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	path := f.server.store.path
	gate.onCheck = func(n int) error {
		if n == 3 {
			f.server.store.mu.Lock()
			f.server.store.path = filepath.Join(path, "not-a-directory.json")
			f.server.store.mu.Unlock()
		}
		return nil
	}
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call); receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("failed save returned a receipt: %v", err)
	}
	f.server.store.mu.Lock()
	f.server.store.path = path
	f.server.store.mu.Unlock()
	cold, err := NewStore(path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	pending := cold.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)]
	if !reflect.DeepEqual(before, cold.state.TaskRuns[before.ID]) || pending.View.State != "PENDING" || pending.FirstCausePresent || f.requests.Load() != 1 {
		t.Fatal("failed decision save lost the original pending record or answer")
	}
}

func TestP08OriginalReturnPortRetiredSourceNeverCommits(t *testing.T) {
	f, gate, source, held, call, before := p08ReturnRecheckFixture(t)
	defer source.Close()
	defer held.Close()
	gate.invalid.Store(false)
	gate.onCheck = func(n int) error {
		if n == 3 {
			source.Retire()
		}
		return nil
	}
	if receipt, err := f.server.ExecuteOriginalTaskModelReturnRecheck(context.Background(), held, call); receipt != nil || !errors.Is(err, ErrTaskStoreSnapshotStale) || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("retired source committed: %v", err)
	}
	record := f.server.store.state.TaskActionOutcomes[taskActionKey(held.view.Principal, call.OriginalOperationID)]
	if record.View.State != "PENDING" || !record.FirstCausePresent || record.FirstCauseClass != "ORIGINAL_SNAPSHOT_STALE" || !reflect.DeepEqual(before, f.server.store.state.TaskRuns[before.ID]) || f.requests.Load() != 1 {
		t.Fatal("retired source changed original return or lost its pending cause")
	}
}
