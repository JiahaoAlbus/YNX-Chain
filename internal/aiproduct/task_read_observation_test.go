package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"testing"
)

func p08ReadCall(path string) TaskActionCall {
	sum := sha256.Sum256(nil)
	return TaskActionCall{OriginalOperationID: "PUBLIC-original-read", RequestRef: "PUBLIC-read-ref", RequestDigest: "PUBLIC-SDK-read-digest", Action: "PUBLIC-verified-read-action", Method: http.MethodGet, Path: path, BodyDigest: hex.EncodeToString(sum[:])}
}
func TestP08RealReadObservationAndNoWrites(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	own, _ := s.CreateTask(c.Account, c.ID, "holder-a")
	_, _ = s.CreateTask(c.Account, c.ID, "holder-b")
	source, _ := NewTaskStoreSource(s)
	server := &Server{store: s}
	session := ProductSession{ID: "PUBLIC-actual-session", Account: c.Account, DeviceID: "holder-a"}
	before, _ := os.ReadFile(s.path)
	observation, err := source.ObserveOriginalTaskRead(context.Background(), server, session, p08ReadCall("/api/tasks"))
	if err != nil {
		t.Fatal(err)
	}
	view, _ := observation.View()
	body, _ := observation.Body()
	var page TaskPage
	if json.Unmarshal(body, &page) != nil || len(page.Tasks) != 1 || page.Tasks[0].ID != own.ID || view.Decision != "OBSERVED" || view.Scope != "READ_ONLY_OBSERVATION" {
		t.Fatalf("not restricted observation %+v %s", view, body)
	}
	sum := sha256.Sum256(body)
	if view.BodyDigest != hex.EncodeToString(sum[:]) || view.BodyBytes != uint64(len(body)) {
		t.Fatal("read digest not actual writer bytes")
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(before, after) || len(s.state.TaskActionOutcomes) != 0 {
		t.Fatal("observation consumed a business slot or wrote data")
	}
	held, err := source.ObserveOriginalTaskRead(context.Background(), server, session, p08ReadCall("/api/tasks/"+own.ID))
	if err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	err = held.Current()
	s.mu.Unlock()
	if err != nil {
		t.Fatal("read current re-locked Store")
	}
	if _, err = s.HandoffTask(c.Account, own.ID, 1, 1, "holder-a", "holder-b"); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(held.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("changed read snapshot remained current")
	}
	for _, path := range []string{"//api/tasks", "/api/tasks/", "/api/tasks?afterId=%zz", "/api/tasks?other=1", "/api/tasks?afterId=a&afterId=b", "/api/tasks/../tasks"} {
		if o, err := source.ObserveOriginalTaskRead(context.Background(), server, session, p08ReadCall(path)); o != nil || err == nil {
			t.Fatalf("invalid read route observed: %s", path)
		}
	}
}
func TestP08OriginalOutcomeOuterReadIsObserved(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: "holder", SessionID: "PUBLIC-original-session"}
	held, _ := source.CaptureConversation(context.Background(), p, c.ID)
	create := p08ActionCall("create-task", "/api/tasks", map[string]string{"conversationId": c.ID})
	if _, err := source.ExecuteLocalAction(context.Background(), held, create); err != nil {
		t.Fatal(err)
	}
	lookup := TaskStoreActionOriginalLookup{Principal: p, OperationID: create.OriginalOperationID, RequestDigest: create.RequestDigest, Action: create.Action}
	session := ProductSession{ID: "PUBLIC-current-query-session", Account: p.Account, DeviceID: p.DeviceID}
	before, _ := os.ReadFile(s.path)
	observation, err := source.ObserveOriginalTaskOutcome(context.Background(), session, p08ReadCall("/PUBLIC-original-auth-query-callee"), lookup)
	if err != nil {
		t.Fatal(err)
	}
	view, _ := observation.View()
	body, _ := observation.Body()
	var payload struct {
		Original TaskStoreActionOutcomeView `json:"original"`
	}
	if json.Unmarshal(body, &payload) != nil || view.Decision != "OBSERVED" || view.Scope != "READ_ONLY_OBSERVATION" || payload.Original.State != "COMMITTED" {
		t.Fatalf("query confused with new commit %+v %s", view, body)
	}
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(before, after) || len(s.state.Tasks) != 1 {
		t.Fatal("query repeated business action")
	}
	session.DeviceID = "different-holder"
	if _, err = source.ObserveOriginalTaskOutcome(context.Background(), session, p08ReadCall("/PUBLIC-query"), lookup); err == nil {
		t.Fatal("unrelated holder read original outcome")
	}
	observation.Release()
	if observation.Current() == nil {
		t.Fatal("released read current")
	}
}
func TestP08ReadObservationUsesRestrictedOldHolderRun(t *testing.T) {
	f := newP08ModelFixture(t)
	runID := "PUBLIC-original-run"
	key := modelRunKey(f.session.Account, f.task.ID, runID)
	f.server.store.state.TaskRuns = map[string]taskModelRun{key: {ID: key, RunID: runID, TaskID: f.task.ID, Account: f.session.Account, Holder: f.session.DeviceID, Generation: 1, Status: "NEEDS_APPROVAL", AnswerCipher: "not decrypted as new result"}}
	if _, err := f.server.store.HandoffTask(f.session.Account, f.task.ID, 1, 1, f.session.DeviceID, "holder-next"); err != nil {
		t.Fatal(err)
	}
	source, _ := NewTaskStoreSource(f.server.store)
	observation, err := source.ObserveOriginalTaskRead(context.Background(), f.server, f.session, p08ReadCall("/api/tasks/"+f.task.ID+"/runs/"+runID))
	if err != nil {
		t.Fatal(err)
	}
	body, _ := observation.Body()
	var view taskRunView
	if json.Unmarshal(body, &view) != nil || !view.RecoveryOnly || view.Content != "" {
		t.Fatalf("old holder observed new private output %s", body)
	}
	if f.requests.Load() != 0 {
		t.Fatal("run read replayed provider")
	}
}

func TestP08OriginalEffectQueryObservedWithoutReplay(t *testing.T) {
	store, expected, _ := taskReadFixture(t)
	protected := &p08EffectFixture{store: store, expected: expected, mode: "lost-after-commit"}
	server := &Server{store: store, toolEffects: protected}
	session := ProductSession{ID: "PUBLIC-query-session", Account: expected.Account, DeviceID: expected.Holder}
	if _, err := server.dispatchApprovedStep(context.Background(), session, expected.TaskID, expected.StepID, "isolated-approved-reference"); err == nil {
		t.Fatal("lost ACK became success")
	}
	source, _ := NewTaskStoreSource(store)
	call := p08ActionCall("PUBLIC-original-query", "/api/tasks/"+expected.TaskID+"/tool-steps/"+expected.StepID+"/reconcile", map[string]string{"authorizationRef": "isolated-approved-reference"})
	observation, err := source.ObserveOriginalTaskQuery(context.Background(), server, session, call)
	if err != nil {
		t.Fatal(err)
	}
	view, _ := observation.View()
	body, _ := observation.Body()
	if view.Decision != "OBSERVED" || view.Scope != "READ_ONLY_OBSERVATION" || !bytes.Contains(body, []byte("actual selected source body")) || protected.dispatches != 1 || protected.queries != 0 {
		t.Fatalf("original query replayed or fabricated action %+v %s", view, body)
	}
	if _, err = store.HandoffTask(session.Account, expected.TaskID, 1, 1, session.DeviceID, "holder-next"); err != nil {
		t.Fatal(err)
	}
	historical, err := source.ObserveOriginalTaskQuery(context.Background(), server, session, call)
	if err != nil {
		t.Fatal(err)
	}
	minimal, _ := historical.Body()
	if bytes.Contains(minimal, []byte("actual selected source body")) || !bytes.Contains(minimal, []byte("recoveryOnly")) || protected.dispatches != 1 || protected.queries != 0 {
		t.Fatalf("old holder query exposed result or replayed %s", minimal)
	}
	store.mu.Lock()
	original := store.state.Actions[expected.StepID]
	original.Status = "UNKNOWN"
	err = store.saveToolEffectLocked(original, "PUBLIC-original-uncertainty")
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	missing := &Server{store: store}
	if _, err = source.ObserveOriginalTaskQuery(context.Background(), missing, session, call); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatal("no Source became an observation")
	}
}

type p08OriginalReadRecoverySource struct{ *p08EffectFixture }

func (f *p08OriginalReadRecoverySource) reconcileTaskTool(_ context.Context, call taskEffectCall, _ string) (taskReadReceipt, error) {
	f.queries++
	if call.OriginalOperationID != f.expected.StepID {
		return taskReadReceipt{}, errToolConflict
	}
	f.store.mu.Lock()
	defer f.store.mu.Unlock()
	record := f.store.state.Actions[call.OriginalOperationID]
	record.Status = "COMPLETED"
	receipt, err := f.store.taskReadReceiptLocked(record)
	if err != nil {
		return taskReadReceipt{}, err
	}
	if err = f.store.saveToolEffectLocked(record, "PUBLIC-original-read-recovered"); err != nil {
		return taskReadReceipt{}, err
	}
	return receipt, nil
}
func TestP08ReadQueryAcceptsActualRecoveredOriginalEpoch(t *testing.T) {
	store, expected, _ := taskReadFixture(t)
	base := &p08EffectFixture{store: store, expected: expected, mode: "lost-after-commit"}
	server := &Server{store: store, toolEffects: base}
	session := ProductSession{ID: "PUBLIC-session", Account: expected.Account, DeviceID: expected.Holder}
	_, _ = server.dispatchApprovedStep(context.Background(), session, expected.TaskID, expected.StepID, "isolated-approved-reference")
	store.mu.Lock()
	record := store.state.Actions[expected.StepID]
	record.Status = "UNKNOWN"
	err := store.saveToolEffectLocked(record, "PUBLIC-reconcile-needed")
	before := store.authorityEpoch.Load()
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	original := &p08OriginalReadRecoverySource{base}
	server.toolEffects = original
	source, _ := NewTaskStoreSource(store)
	call := p08ActionCall("PUBLIC-original-query", "/api/tasks/"+expected.TaskID+"/tool-steps/"+expected.StepID+"/reconcile", map[string]string{"authorizationRef": "PUBLIC-original-query-ref"})
	observation, err := source.ObserveOriginalTaskQuery(context.Background(), server, session, call)
	if err != nil {
		t.Fatal(err)
	}
	view, _ := observation.View()
	if view.Decision != "OBSERVED" || observation.Current() != nil || store.authorityEpoch.Load() == before || base.dispatches != 1 || base.queries != 1 {
		t.Fatal("actual original recovery was replayed, stale or called new commit")
	}
}
