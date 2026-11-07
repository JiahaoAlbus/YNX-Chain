package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"testing"
)

func p08OriginalReceiptFixture(t *testing.T) (*Store, *TaskStoreSource, TaskStorePrincipal, TaskActionCall, *TaskActionOutcomeReceipt, []byte) {
	t.Helper()
	store, conversation, key := p08TaskStore(t)
	source, _ := NewTaskStoreSource(store)
	p := TaskStorePrincipal{Account: conversation.Account, DeviceID: "PUBLIC-holder", SessionID: "PUBLIC-original-session"}
	held, err := source.CaptureConversation(context.Background(), p, conversation.ID)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { held.Close(); source.Close() })
	call := p08ActionCall("create-task", "/api/tasks", map[string]any{"conversationId": conversation.ID})
	receipt, err := source.ExecuteLocalAction(context.Background(), held, call)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { receipt.Close() })
	return store, source, p, call, receipt, key
}
func TestP08DurableOriginalReceiptBodyColdQueryNoReplay(t *testing.T) {
	store, source, p, call, receipt, key := p08OriginalReceiptFixture(t)
	before, _ := os.ReadFile(store.path)
	original, err := receipt.ReadOriginalOutcomeDATA()
	if err != nil {
		t.Fatal(err)
	}
	if original.View.State != "COMMITTED" || original.View.Scope != "PRODUCT_LOCAL_COMMIT_ONLY" || original.View.OriginalOperationID != call.OriginalOperationID || original.View.RequestDigest != call.RequestDigest || original.View.RequestRef != call.RequestRef || original.View.BodyDigest != bindTaskBytes(original.BodyOriginal) {
		t.Fatal("durable original binding lost")
	}
	record := store.state.TaskActionOutcomes[taskActionKey(p, call.OriginalOperationID)]
	raw, err := store.decrypt(p.Account, storedMessage{Message: Message{ID: call.OriginalOperationID + ":task-action-result", ConversationID: original.View.TaskID}, Nonce: record.BodyNonce, Cipher: record.BodyCipher})
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		View json.RawMessage `json:"view"`
		Body []byte          `json:"body"`
	}
	if json.Unmarshal([]byte(raw), &payload) != nil || !bytes.Equal(payload.View, original.BusinessReceiptOriginal) || !bytes.Equal(payload.Body, original.BodyOriginal) {
		t.Fatal("receipt/body were reconstructed instead of read from same authenticated payload")
	}
	lookup := TaskStoreActionOriginalLookup{Principal: p, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action}
	outcome, err := source.CaptureOriginalActionOutcome(context.Background(), lookup)
	if err != nil {
		t.Fatal(err)
	}
	defer outcome.Close()
	read, err := outcome.ReadOriginalOutcomeDATA()
	if err != nil || !reflect.DeepEqual(read, original) {
		t.Fatal("query differs from original execution", err)
	}
	reopened, err := NewStore(store.path, key)
	if err != nil {
		t.Fatal(err)
	}
	cold, _ := NewTaskStoreSource(reopened)
	defer cold.Close()
	retained, err := cold.CaptureOriginalActionOutcome(context.Background(), lookup)
	if err != nil {
		t.Fatal(err)
	}
	defer retained.Close()
	read, err = retained.ReadOriginalOutcomeDATA()
	if err != nil || !reflect.DeepEqual(read, original) || len(reopened.state.Tasks) != 1 || len(reopened.state.TaskActionOutcomes) != 1 {
		t.Fatal("cold original-op read changed receipt or replayed business", err)
	}
	original.BodyOriginal[0] ^= 1
	original.BusinessReceiptOriginal[0] ^= 1
	again, err := receipt.ReadOriginalOutcomeDATA()
	if err != nil || !reflect.DeepEqual(again, read) {
		t.Fatal("caller mutated original custody", err)
	}
	after, _ := os.ReadFile(store.path)
	if !bytes.Equal(before, after) {
		t.Fatal("receipt read modified durable file")
	}
}
func TestP08OriginalReceiptPreservesStoredJSONBytes(t *testing.T) {
	store, source, p, call, receipt, key := p08OriginalReceiptFixture(t)
	v, _ := receipt.View()
	body, _ := receipt.Body()
	// PUBLIC old-writer representation control: SAME authenticated values with
	// distinct persisted JSON formatting. Remarshaling a View would lose it.
	storedView, _ := json.MarshalIndent(v, "", "  ")
	encodedBody, _ := json.Marshal(body)
	raw := append([]byte(`{"view":`), storedView...)
	raw = append(raw, []byte(`,"body":`)...)
	raw = append(raw, encodedBody...)
	raw = append(raw, '}')
	store.mu.Lock()
	record := store.state.TaskActionOutcomes[taskActionKey(p, call.OriginalOperationID)]
	var err error
	record.BodyNonce, record.BodyCipher, err = store.encrypt(p.Account, v.TaskID, call.OriginalOperationID+":task-action-result", string(raw))
	store.state.TaskActionOutcomes[taskActionKey(p, call.OriginalOperationID)] = record
	if err == nil {
		err = store.saveLocked()
	}
	store.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if data, err := receipt.ReadOriginalOutcomeDATA(); err == nil || len(data.BodyOriginal) != 0 {
		t.Fatal("old held owner survived changed durable record")
	}
	reopened, err := NewStore(store.path, key)
	if err != nil {
		t.Fatal(err)
	}
	source, _ = NewTaskStoreSource(reopened)
	defer source.Close()
	held, err := source.CaptureOriginalActionOutcome(context.Background(), TaskStoreActionOriginalLookup{Principal: p, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action})
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	data, err := held.ReadOriginalOutcomeDATA()
	if err != nil || !bytes.Equal(data.BusinessReceiptOriginal, storedView) || !bytes.Equal(data.BodyOriginal, body) {
		t.Fatal("authenticated original bytes were remarshaled", err)
	}
}
func TestP08OriginalReceiptForeignBindingRejects(t *testing.T) {
	_, source, p, call, _, _ := p08OriginalReceiptFixture(t)
	base := TaskStoreActionOriginalLookup{Principal: p, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action}
	for _, field := range []string{"account", "device", "session", "operation", "digest", "action"} {
		t.Run(field, func(t *testing.T) {
			bad := base
			switch field {
			case "account":
				bad.Principal.Account = "foreign"
			case "device":
				bad.Principal.DeviceID = "foreign"
			case "session":
				bad.Principal.SessionID = "foreign"
			case "operation":
				bad.OperationID = "foreign"
			case "digest":
				bad.RequestDigest = "foreign"
			case "action":
				bad.Action = "cancel-task"
			}
			outcome, err := source.CaptureOriginalActionOutcome(context.Background(), bad)
			if outcome != nil {
				defer outcome.Close()
			}
			if err == nil {
				t.Fatal("foreign original acquired receipt")
			}
		})
	}
}
func TestP08OriginalReceiptCancelCloseRetireRejectsBytes(t *testing.T) {
	for _, mode := range []string{"cancel", "close", "retire"} {
		t.Run(mode, func(t *testing.T) {
			_, source, p, call, _, _ := p08OriginalReceiptFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			outcome, err := source.CaptureOriginalActionOutcome(ctx, TaskStoreActionOriginalLookup{Principal: p, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action})
			if err != nil {
				t.Fatal(err)
			}
			defer outcome.Close()
			switch mode {
			case "cancel":
				cancel()
			case "close":
				outcome.Close()
			case "retire":
				source.Retire()
			}
			data, err := outcome.ReadOriginalOutcomeDATA()
			if err == nil || len(data.BusinessReceiptOriginal) != 0 || len(data.BodyOriginal) != 0 {
				t.Fatal("closed/cancelled/retired custody returned bytes")
			}
		})
	}
	var receipt *TaskActionOutcomeReceipt
	if _, err := receipt.ReadOriginalOutcomeDATA(); !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatal("nil receipt was accepted")
	}
}
func TestP08PendingOriginalOutcomeCannotProvideCommittedBytes(t *testing.T) {
	store, conversation, key := p08TaskStore(t)
	task, _ := store.CreateTask(conversation.Account, conversation.ID, "PUBLIC-holder")
	source, _ := NewTaskStoreSource(store)
	defer source.Close()
	p := TaskStorePrincipal{Account: conversation.Account, DeviceID: task.Holder, SessionID: "PUBLIC-session"}
	snapshot, _ := source.Capture(context.Background(), TaskStoreCapture{Principal: p, TaskID: task.ID})
	defer snapshot.Close()
	call := p08ActionCall("prepare-task", "/api/tasks/"+task.ID+"/prepare", map[string]uint64{"revision": 1, "generation": 1})
	path, aead := store.path, store.aead
	store.aead = p08FailActionCommitAEAD{AEAD: aead, s: store}
	_, err := source.ExecuteLocalAction(context.Background(), snapshot, call)
	store.path = path
	store.aead = aead
	if !errors.Is(err, ErrTaskActionOutcomeUnknown) {
		t.Fatal("expected durable pending first cause", err)
	}
	reopened, err := NewStore(path, key)
	if err != nil {
		t.Fatal(err)
	}
	cold, _ := NewTaskStoreSource(reopened)
	defer cold.Close()
	outcome, err := cold.CaptureOriginalActionOutcome(context.Background(), TaskStoreActionOriginalLookup{Principal: p, OperationID: call.OriginalOperationID, RequestDigest: call.RequestDigest, Action: call.Action})
	if err != nil {
		t.Fatal(err)
	}
	defer outcome.Close()
	view, _ := outcome.View()
	if view.State != "UNKNOWN" {
		t.Fatal("pending reservation promoted")
	}
	data, err := outcome.ReadOriginalOutcomeDATA()
	if !errors.Is(err, ErrTaskActionOutcomeUnknown) || len(data.BusinessReceiptOriginal) != 0 || len(data.BodyOriginal) != 0 || reopened.state.Tasks[task.ID].Status != task.Status {
		t.Fatal("pending outcome minted successful originals or replayed")
	}
}
