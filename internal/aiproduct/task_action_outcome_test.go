package aiproduct

import (
	"bytes"
	"context"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func p08ActionCall(action, path string, body any) TaskActionCall {
	raw, _ := json.Marshal(body)
	sum := sha256.Sum256(raw)
	return TaskActionCall{OriginalOperationID: "PUBLIC-original-" + action, RequestRef: "PUBLIC-original-request-ref-" + action, RequestDigest: "PUBLIC-exact-original-SDK-digest-" + action, BodyDigest: hex.EncodeToString(sum[:]), Action: action, Method: http.MethodPost, Path: path, Body: raw}
}
func TestP08TaskActionActualCommitOriginalReadbackAndNoReplay(t *testing.T) {
	s, c, key := p08TaskStore(t)
	source, _ := NewTaskStoreSource(s)
	defer source.Close()
	p := TaskStorePrincipal{Account: c.Account, DeviceID: "holder", SessionID: "PUBLIC-original-Auth-session"}
	held, err := source.CaptureConversation(context.Background(), p, c.ID)
	if err != nil {
		t.Fatal(err)
	}
	create := p08ActionCall("create-task", "/api/tasks", map[string]any{"conversationId": c.ID})
	receipt, err := source.ExecuteLocalAction(context.Background(), held, create)
	if err != nil {
		t.Fatal(err)
	}
	body, err := receipt.Body()
	if err != nil {
		t.Fatal(err)
	}
	var task TaskRecord
	if json.Unmarshal(body, &task) != nil || task.ID == "" || task.Holder != p.DeviceID {
		t.Fatalf("not actual task: %s", body)
	}
	view, _ := receipt.View()
	if view.State != "COMMITTED" || view.Scope != "PRODUCT_LOCAL_COMMIT_ONLY" || view.BodyDigest != bindTaskBytes(body) || view.TaskID != task.ID || view.HTTPStatus != 201 || body[len(body)-1] != '\n' {
		t.Fatalf("bad outcome %+v", view)
	}
	before, _ := os.ReadFile(s.path)
	again, err := source.ExecuteLocalAction(context.Background(), held, create)
	if err != nil {
		t.Fatal(err)
	}
	same, _ := again.Body()
	after, _ := os.ReadFile(s.path)
	if !bytes.Equal(before, after) || !bytes.Equal(same, body) || len(s.state.Tasks) != 1 {
		t.Fatal("lost ACK replayed create")
	}
	changed := create
	changed.RequestRef = "replacement-ref"
	if _, err = source.ExecuteLocalAction(context.Background(), held, changed); !errors.Is(err, ErrTaskConflict) {
		t.Fatal("original op rebound")
	}
	restarted, err := NewStore(s.path, key)
	if err != nil {
		t.Fatal(err)
	}
	restored, _ := NewTaskStoreSource(restarted)
	recovered, err := restored.QueryTaskActionOutcome(context.Background(), p, create)
	if err != nil {
		t.Fatal(err)
	}
	recoveredBody, _ := recovered.Body()
	if !bytes.Equal(recoveredBody, body) {
		t.Fatal("restart changed original bytes")
	}
	snapshot, err := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	if err != nil {
		t.Fatal(err)
	}
	prepare := p08ActionCall("prepare-task", "/api/tasks/"+task.ID+"/prepare", map[string]uint64{"revision": 1, "generation": 1})
	prepared, err := source.ExecuteLocalAction(context.Background(), snapshot, prepare)
	if err != nil {
		t.Fatal(err)
	}
	preparedView, _ := prepared.View()
	if preparedView.RevisionBefore != 1 || preparedView.RevisionAfter != 2 || preparedView.GenerationAfter != 1 || s.state.Tasks[task.ID].Status != "READY" {
		t.Fatal("actual prepare not committed")
	}
	if err = receipt.Current(); err != nil {
		t.Fatal("unrelated later commit invalidated immutable original outcome")
	}
	original, err := source.QueryTaskActionOutcome(context.Background(), p, create)
	if err != nil {
		t.Fatal(err)
	}
	originalBody, _ := original.Body()
	if !bytes.Equal(originalBody, body) {
		t.Fatal("original query rewrote history to current task")
	}
	foreign := p
	foreign.DeviceID = "other"
	if _, err = source.QueryTaskActionOutcome(context.Background(), foreign, create); !errors.Is(err, ErrTaskConflict) {
		t.Fatal("foreign device acquired original receipt")
	}
}

type p08FailActionCommitAEAD struct {
	cipher.AEAD
	s *Store
}

func (a p08FailActionCommitAEAD) Seal(dst, nonce, plaintext, aad []byte) []byte {
	out := a.AEAD.Seal(dst, nonce, plaintext, aad)
	a.s.path = filepath.Join(a.s.path, "impossible.json")
	return out
}
func TestP08TaskActionCommitFailureLeavesDurableOriginalPending(t *testing.T) {
	s, c, key := p08TaskStore(t)
	task, _ := s.CreateTask(c.Account, c.ID, "holder")
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: task.Holder, SessionID: "PUBLIC-session"}
	held, _ := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	call := p08ActionCall("prepare-task", "/api/tasks/"+task.ID+"/prepare", map[string]uint64{"revision": 1, "generation": 1})
	path := s.path
	originalAEAD := s.aead
	s.aead = p08FailActionCommitAEAD{AEAD: originalAEAD, s: s}
	receipt, err := source.ExecuteLocalAction(context.Background(), held, call)
	if receipt != nil || !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatalf("failed save became commit %v", err)
	}
	s.path = path
	s.aead = originalAEAD
	if s.state.Tasks[task.ID] != task {
		t.Fatal("failed commit altered task")
	}
	if s.state.TaskActionOutcomes[taskActionKey(p, call.OriginalOperationID)].View.State != "PENDING" {
		t.Fatal("lost durable reservation")
	}
	recovered, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := NewTaskStoreSource(recovered)
	if _, err = next.QueryTaskActionOutcome(context.Background(), p, call); !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatal("PENDING became business success")
	}
	fresh, _ := next.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	if _, err = next.ExecuteLocalAction(context.Background(), fresh, call); !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatal("restart replayed failed/unknown original")
	}
	if recovered.state.Tasks[task.ID] != task {
		t.Fatal("replay mutated task")
	}
}
func TestP08TaskActionMetadataTamperCannotMintReceipt(t *testing.T) {
	s, c, key := p08TaskStore(t)
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: "holder", SessionID: "PUBLIC-session"}
	held, _ := source.CaptureConversation(context.Background(), p, c.ID)
	call := p08ActionCall("create-task", "/api/tasks", map[string]string{"conversationId": c.ID})
	if _, err := source.ExecuteLocalAction(context.Background(), held, call); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(s.path)
	if err != nil {
		t.Fatal(err)
	}
	raw = bytes.ReplaceAll(raw, []byte(call.RequestDigest), []byte("forged-digest"))
	if err = os.WriteFile(s.path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewStore(s.path, key)
	if err != nil {
		t.Fatal(err)
	}
	next, _ := NewTaskStoreSource(restarted)
	forged := call
	forged.RequestDigest = "forged-digest"
	if r, err := next.QueryTaskActionOutcome(context.Background(), p, forged); err == nil || r != nil {
		t.Fatal("mutable metadata minted a receipt")
	}
}
func TestP08TaskActionProposeCancelAndUnsupportedEffects(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	task, _ := s.CreateTask(c.Account, c.ID, "holder")
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: task.Holder, SessionID: "PUBLIC-session"}
	capture := func() *TaskStoreSnapshot {
		h, err := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
		if err != nil {
			t.Fatal(err)
		}
		return h
	}
	call := p08ActionCall("propose-tool-step", "/api/tasks/"+task.ID+"/tool-steps", map[string]any{"operationId": "proposal-original", "taskRevision": 1, "generation": 1, "toolId": "ai.conversation.read", "toolVersion": "1", "input": map[string]string{"conversationId": c.ID}})
	receipt, err := source.ExecuteLocalAction(context.Background(), capture(), call)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := receipt.Body()
	var proposal struct {
		Step     ActionRecord `json:"step"`
		Executed bool         `json:"executed"`
	}
	if json.Unmarshal(body, &proposal) != nil || proposal.Step.Status != "NEEDS_APPROVAL" || proposal.Executed {
		t.Fatal("proposal became effect permission")
	}
	cancel := p08ActionCall("cancel-task", "/api/tasks/"+task.ID+"/cancel", map[string]uint64{"revision": 1, "generation": 1})
	if _, err = source.ExecuteLocalAction(context.Background(), capture(), cancel); err != nil {
		t.Fatal(err)
	}
	if s.state.Tasks[task.ID].Status != "CANCELLED" || s.state.Actions[proposal.Step.ID].Status != "CANCELLED" {
		t.Fatal("original cancellation not committed")
	}
	unsupported := p08ActionCall("dispatch", "/api/tasks/"+task.ID+"/tool-steps/"+proposal.Step.ID+"/dispatch", map[string]string{"authorizationRef": "not authority"})
	if _, err = source.ExecuteLocalAction(context.Background(), capture(), unsupported); !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatal("local receipt executor admitted external effect")
	}
}

func TestP08TaskActionCompleteUsesVerifiedResourceResults(t *testing.T) {
	f := newP08ModelFixture(t)
	input := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	f.approveStep(t, pending.Steps[0])
	f.expected.StepID = pending.Steps[0]
	f.server.toolEffects = &p08EffectFixture{store: f.server.store, expected: f.expected}
	input.Prompt = ""
	input.Resume = true
	run, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	source, _ := NewTaskStoreSource(f.server.store)
	p := TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: f.task.ID})
	if err != nil {
		t.Fatal(err)
	}
	call := p08ActionCall("complete-task", "/api/tasks/"+f.task.ID+"/complete", map[string]any{"revision": f.task.Revision, "generation": f.task.Generation, "runId": run.ID})
	receipt, err := source.ExecuteLocalAction(context.Background(), held, call)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := receipt.Body()
	var response struct {
		Task     TaskRecord `json:"task"`
		Verified bool       `json:"effectsVerified"`
	}
	if json.Unmarshal(body, &response) != nil || !response.Verified || response.Task.Status != "COMPLETED" {
		t.Fatalf("unverified workflow completion %s", body)
	}
}

type p08CancelActionAckAEAD struct {
	cipher.AEAD
	cancel context.CancelFunc
}

func (a p08CancelActionAckAEAD) Seal(dst, nonce, plaintext, aad []byte) []byte {
	out := a.AEAD.Seal(dst, nonce, plaintext, aad)
	a.cancel()
	return out
}
func TestP08TaskActionLostAckAndEncryptedBackupRecovery(t *testing.T) {
	s, c, key := p08TaskStore(t)
	task, _ := s.CreateTask(c.Account, c.ID, "holder")
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: task.Holder, SessionID: "PUBLIC-session"}
	ctx, cancel := context.WithCancel(context.Background())
	held, _ := source.Capture(ctx, TaskStoreCapture{Principal: p, TaskID: task.ID})
	call := p08ActionCall("prepare-task", "/api/tasks/"+task.ID+"/prepare", map[string]uint64{"revision": 1, "generation": 1})
	oldAEAD := s.aead
	s.aead = p08CancelActionAckAEAD{AEAD: oldAEAD, cancel: cancel}
	if receipt, err := source.ExecuteLocalAction(ctx, held, call); receipt != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("lost ack not retained %v", err)
	}
	s.aead = oldAEAD
	recovered, err := source.QueryTaskActionOutcome(context.Background(), p, call)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := recovered.Body()
	if s.state.Tasks[task.ID].Revision != 2 {
		t.Fatal("actual original commit missing")
	}
	s.mu.Lock()
	err = recovered.Current()
	s.mu.Unlock()
	if err != nil {
		t.Fatalf("receipt Current not usable in original CAS lock: %v", err)
	}
	backup := filepath.Join(t.TempDir(), "outcome.ynxbackup")
	if _, err = s.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	encrypted, _ := os.ReadFile(backup)
	if bytes.Contains(encrypted, []byte(call.RequestRef)) {
		t.Fatal("backup exposed request ref")
	}
	restored, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restored.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	next, _ := NewTaskStoreSource(restored)
	again, err := next.QueryTaskActionOutcome(context.Background(), p, call)
	if err != nil {
		t.Fatal(err)
	}
	same, _ := again.Body()
	if !bytes.Equal(same, body) {
		t.Fatal("backup changed result bytes")
	}
	again.Close()
	if again.Current() == nil {
		t.Fatal("released receipt remained current")
	}
	next.Close()
	if _, err = next.QueryTaskActionOutcome(context.Background(), p, call); err == nil {
		t.Fatal("retired source queried")
	}
}

func TestP08TaskActionNarrowOriginalOutcomeABI(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	task, _ := s.CreateTask(c.Account, c.ID, "holder")
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: task.Holder, SessionID: "PUBLIC-session"}
	held, _ := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	call := p08ActionCall("prepare-task", "/api/tasks/"+task.ID+"/prepare", map[string]uint64{"revision": 1, "generation": 1})
	receipt, err := source.ExecuteLocalAction(context.Background(), held, call)
	if err != nil {
		t.Fatal(err)
	}
	if !errors.Is(held.Current(), ErrTaskStoreSnapshotStale) {
		t.Fatal("writer task epoch was not invalidated by actual commit")
	}
	body, _ := receipt.Body()
	lookup := TaskStoreActionOriginalLookup{Principal: p, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action}
	outcome, err := source.CaptureOriginalActionOutcome(context.Background(), lookup)
	if err != nil {
		t.Fatal(err)
	}
	view, err := outcome.View()
	sum := sha256.Sum256(body)
	if err != nil || view.State != "COMMITTED" || view.OriginalRef == "" || view.Status != 200 || view.BodyBytes != uint64(len(body)) || view.BodyDigest != hex.EncodeToString(sum[:]) {
		t.Fatalf("incorrect actual writer projection %+v %v", view, err)
	}
	s.mu.Lock()
	err = outcome.Current()
	s.mu.Unlock()
	if err != nil {
		t.Fatal("original receipt Current acquired Store mutex or lost real record")
	}
	outcome.Release()
	if outcome.Current() == nil {
		t.Fatal("release did not invalidate outcome")
	}
	bad := lookup
	bad.Action = "cancel-task"
	if _, err = source.CaptureOriginalActionOutcome(context.Background(), bad); !errors.Is(err, ErrTaskConflict) {
		t.Fatal("changed action acquired original outcome")
	}
	// A real durable reservation with a rejected CAS has no sealed result and
	// can only project UNKNOWN, even though its original product row exists.
	fresh, _ := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	wrong := p08ActionCall("complete-task", "/api/tasks/"+task.ID+"/complete", map[string]any{"revision": 2, "generation": 1, "runId": "not-completed"})
	if _, err = source.ExecuteLocalAction(context.Background(), fresh, wrong); err == nil {
		t.Fatal("unverified completion accepted")
	}
	pending, err := source.CaptureOriginalActionOutcome(context.Background(), TaskStoreActionOriginalLookup{Principal: p, OperationID: wrong.OriginalOperationID, RequestDigest: wrong.RequestDigest, Action: wrong.Action})
	if err != nil {
		t.Fatal(err)
	}
	unknown, _ := pending.View()
	if unknown.State != "UNKNOWN" || unknown.OriginalRef == "" || unknown.Status != 0 || unknown.BodyDigest != "" {
		t.Fatalf("reservation fabricated terminal result %+v", unknown)
	}
}

func TestP08TaskActionServerEntryCancelsActualInflightModel(t *testing.T) {
	entered, ended := make(chan struct{}), make(chan struct{})
	f := newP08ModelFixture(t, func(_ http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done(); close(ended) })
	done := make(chan error, 1)
	go func() {
		_, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
		done <- err
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("provider HTTP not entered")
	}
	source, _ := NewTaskStoreSource(f.server.store)
	p := TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: f.task.ID})
	if err != nil {
		t.Fatal(err)
	}
	current, _ := held.View()
	call := p08ActionCall("cancel-task", "/api/tasks/"+f.task.ID+"/cancel", map[string]uint64{"revision": current.Task.Revision, "generation": current.Task.Generation})
	receipt, err := f.server.ExecuteOriginalLocalTaskAction(context.Background(), held, call)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-ended:
	case <-time.After(3 * time.Second):
		t.Fatal("actual model HTTP not cancelled")
	}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("cancel did not drain original model")
	}
	if err = receipt.Current(); err != nil {
		t.Fatal("model drain rewrote immutable action receipt")
	}
	if f.requests.Load() != 1 {
		t.Fatal("cancel replayed provider")
	}
}

func TestP08TaskActionRejectsBodyDigestMismatchBeforeReservation(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	source, _ := NewTaskStoreSource(s)
	p := TaskStorePrincipal{Account: c.Account, DeviceID: "holder", SessionID: "PUBLIC-session"}
	held, _ := source.CaptureConversation(context.Background(), p, c.ID)
	call := p08ActionCall("create-task", "/api/tasks", map[string]string{"conversationId": c.ID})
	call.BodyDigest = "wrong-projected-body-digest"
	if r, err := source.ExecuteLocalAction(context.Background(), held, call); r != nil || !errors.Is(err, errToolInvalid) {
		t.Fatal("request mutated after SDK projection was executed")
	}
	if len(s.state.TaskActionOutcomes) != 0 || len(s.state.Tasks) != 0 {
		t.Fatal("digest mismatch reserved or executed an action")
	}
}
