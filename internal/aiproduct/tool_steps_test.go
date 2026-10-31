package aiproduct

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestP08RequestToolStep(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	conversation, err := store.CreateConversation(session.Account, "Tool source")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(session.Account, conversation.ID, session.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	input := map[string]any{"operationId": "provider-call-1", "taskRevision": task.Revision, "generation": task.Generation, "toolId": "ai.conversation.read", "toolVersion": "1", "input": map[string]string{"conversationId": conversation.ID}}
	endpoint := product.URL + "/api/tasks/" + task.ID + "/tool-steps"
	raw := authedJSON(t, http.MethodPost, endpoint, input, session, http.StatusCreated)
	var result struct {
		Step     ActionRecord `json:"step"`
		Executed bool         `json:"executed"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.Executed || result.Step.Status != "NEEDS_APPROVAL" || result.Step.Risk != "low" || result.Step.ToolStep.InputCipher != "" {
		t.Fatalf("proposal leaked input or claimed execution: %s", raw)
	}
	authedJSON(t, http.MethodPost, endpoint, input, session, http.StatusOK)
	if got := len(store.Actions(session.Account)); got != 1 {
		t.Fatalf("duplicate operation created %d records", got)
	}
	input["risk"] = "low"
	input["toolId"] = "pay"
	authedJSON(t, http.MethodPost, endpoint, input, session, http.StatusBadRequest)
	delete(input, "risk")
	input["toolId"] = "ai.conversation.read"
	input["toolVersion"] = "2"
	authedJSON(t, http.MethodPost, endpoint, input, session, http.StatusBadRequest)
	input["toolVersion"] = "1"
	input["generation"] = task.Generation + 1
	authedJSON(t, http.MethodPost, endpoint, input, session, http.StatusConflict)
	stored, ok := store.Action(session.Account, result.Step.ID)
	if !ok || stored.ToolStep.InputCipher == "" || stored.Status != "NEEDS_APPROVAL" {
		t.Fatal("original encrypted proposal was not retained")
	}
	// The original review endpoint must not upgrade the new pending proposal.
	authedJSON(t, http.MethodPost, product.URL+"/api/actions/"+stored.ID+"/review", map[string]string{"decision": "approve", "permissionGatewayId": "made-up"}, session, http.StatusNotFound)
	reopened, err := NewStore(store.path, bytes.Repeat([]byte{9}, 32))
	if err != nil {
		t.Fatal(err)
	}
	got, ok := reopened.Action(session.Account, stored.ID)
	if !ok || got.ToolStep.InputDigest != stored.ToolStep.InputDigest || got.Status != "NEEDS_APPROVAL" {
		t.Fatal("proposal not recoverable after restart")
	}
}

func TestP08ToolStepTaskStateAllowlist(t *testing.T) {
	for _, status := range []string{"DRAFT", "READY", "WORKING", "NEEDS_APPROVAL", "", "UNKNOWN", "FAILED", "CANCELLED", "CANCELED", "COMPLETED", "RECONCILING", "PAUSED", "future-state"} {
		t.Run("state_"+status, func(t *testing.T) {
			store, conversation, _ := p08TaskStore(t)
			task, err := store.CreateTask("tenant-a", conversation.ID, "holder-device")
			if err != nil {
				t.Fatal(err)
			}
			task.Status = status
			store.state.Tasks[task.ID] = task
			session := ProductSession{Account: "tenant-a", DeviceID: "holder-device", Scopes: []string{"ai:conversations"}}
			raw, err := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
			if err != nil {
				t.Fatal(err)
			}
			input := toolStepRequest{OperationID: "state-check", TaskRevision: task.Revision, Generation: task.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}
			before, err := os.ReadFile(store.path)
			if err != nil {
				t.Fatal(err)
			}
			beforeSequence, beforeAudits := store.state.AuditSequence, len(store.state.Audits)
			record, created, err := store.reserveToolStep(session, task.ID, input)
			switch status {
			case "DRAFT", "READY", "WORKING", "NEEDS_APPROVAL":
				if err != nil || !created || record.Status != "NEEDS_APPROVAL" || record.ToolStep == nil {
					t.Fatalf("active task proposal refused: %+v, created=%v, err=%v", record, created, err)
				}
			default:
				if err != errToolConflict || created || record.ID != "" {
					t.Fatalf("inactive task created work: %+v, created=%v, err=%v", record, created, err)
				}
				if len(store.state.Actions) != 0 || store.state.AuditSequence != beforeSequence || len(store.state.Audits) != beforeAudits {
					t.Fatal("rejected state changed actions or audit")
				}
				after, err := os.ReadFile(store.path)
				if err != nil || !bytes.Equal(before, after) {
					t.Fatalf("rejected state changed persisted state: %v", err)
				}
			}
		})
	}
}

func TestP08ToolStepSlotConflictAndSaveFailure(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "state.json"), bytes.Repeat([]byte{3}, 32))
	if err != nil {
		t.Fatal(err)
	}
	conversation, err := store.CreateConversation("owner", "Source")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask("owner", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	session := ProductSession{Account: "owner", DeviceID: "device", Scopes: []string{"ai:conversations"}}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	input := toolStepRequest{OperationID: "stable-op", TaskRevision: task.Revision, Generation: task.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw}
	var wg sync.WaitGroup
	created := make(chan bool, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, fresh, err := store.reserveToolStep(session, task.ID, input)
			if err != nil {
				t.Error(err)
			}
			created <- fresh
		}()
	}
	wg.Wait()
	close(created)
	count := 0
	for fresh := range created {
		if fresh {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("concurrent reservations: %d", count)
	}
	// A handoff changes the current binding; the old holder cannot reuse its slot.
	if _, err := store.HandoffTask("owner", task.ID, task.Revision, task.Generation, "device", "device-2"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.reserveToolStep(session, task.ID, input); err != errToolConflict {
		t.Fatalf("old holder replay: %v", err)
	}
	current := store.state.Tasks[task.ID]
	session.DeviceID = "device-2"
	input.TaskRevision = current.Revision
	input.Generation = current.Generation
	if _, _, err := store.reserveToolStep(session, task.ID, input); err != errToolConflict {
		t.Fatalf("same operation changed binding: %v", err)
	}
	input.OperationID = "new-op"
	before := len(store.Actions("owner"))
	beforeAudit := len(store.state.Audits)
	beforeSeq := store.state.AuditSequence
	store.path = store.path + "/not-a-directory/state.json"
	if _, _, err := store.reserveToolStep(session, task.ID, input); err == nil {
		t.Fatal("failed persistence accepted")
	}
	if len(store.Actions("owner")) != before || len(store.state.Audits) != beforeAudit || store.state.AuditSequence != beforeSeq {
		t.Fatal("failed proposal left in-memory success")
	}
}
