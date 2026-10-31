package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestP08BoundTaskApprovalPreservesAuthorityBoundary(t *testing.T) {
	for _, mode := range []string{"absent-verifier", "wrong-generation", "denied-proof", "save-failure", "original-approved"} {
		t.Run(mode, func(t *testing.T) {
			store, conversation, _ := p08TaskStore(t)
			task, err := store.CreateTask("tenant-a", conversation.ID, "device")
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
			step, _, err := store.reserveToolStep(ProductSession{Account: "tenant-a", DeviceID: "device", Scopes: []string{"ai:conversations"}}, task.ID, toolStepRequest{OperationID: "approval-original", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
			if err != nil {
				t.Fatal(err)
			}
			expected := taskReadExpectation{Account: "tenant-a", TaskID: task.ID, StepID: step.ID, Holder: "device", TaskRevision: 1, Generation: 1, Input: bindTaskBytes(raw), Fields: []string{"messages"}}
			calls := 0
			check := func() error { calls++; return nil }
			cause := errors.New("isolated original approval refused")
			if mode == "absent-verifier" {
				check = nil
			}
			if mode == "wrong-generation" {
				expected.Generation++
			}
			if mode == "denied-proof" {
				check = func() error { calls++; return cause }
			}
			original := store.path
			before, err := os.ReadFile(original)
			if err != nil {
				t.Fatal(err)
			}
			stateBefore, _ := json.Marshal(store.state)
			if mode == "save-failure" {
				store.path = filepath.Join(original, "impossible.json")
			}
			approved, err := store.commitTaskApprovalAtFence(context.Background(), expected, "isolated-original-grant", check)
			if mode == "original-approved" {
				if err != nil || approved.Status != "approved_not_executed" || approved.ToolStep.TaskGrantRef != "isolated-original-grant" || calls != 1 || store.state.Tasks[task.ID].Status != "READY" || approved.ToolStep.ResultCipher != "" {
					t.Fatalf("approval claimed effect or lost binding: %+v %v", approved, err)
				}
			} else {
				if err == nil || approved.ID != "" {
					t.Fatalf("unverified approval accepted: %+v %v", approved, err)
				}
				after, readErr := os.ReadFile(original)
				stateAfter, _ := json.Marshal(store.state)
				if readErr != nil || !bytes.Equal(before, after) || !bytes.Equal(stateBefore, stateAfter) {
					t.Fatal("failed approval changed proposal, task, audit or disk")
				}
				if mode == "denied-proof" && !errors.Is(err, cause) {
					t.Fatal("original refusal cause lost")
				}
			}
		})
	}
}

func TestP08ApprovalHTTPRequiresOriginalSource(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	conversation, err := store.CreateConversation(session.Account, "Approval source")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(session.Account, conversation.ID, session.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	step, _, err := store.reserveToolStep(ProductSession{Account: session.Account, DeviceID: session.DeviceID, Scopes: []string{"ai:conversations"}}, task.ID, toolStepRequest{OperationID: "http-approval", TaskRevision: 1, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw})
	if err != nil {
		t.Fatal(err)
	}
	authedJSON(t, http.MethodPost, product.URL+"/api/tasks/"+task.ID+"/tool-steps/"+step.ID+"/approve", map[string]string{"authorizationRef": "ordinary-session-is-not-proof"}, session, http.StatusServiceUnavailable)
	if stored, _ := store.Action(session.Account, step.ID); stored.Status != "NEEDS_APPROVAL" || stored.ToolStep.TaskGrantRef != "" {
		t.Fatal("ordinary session upgraded to task approval")
	}
}
