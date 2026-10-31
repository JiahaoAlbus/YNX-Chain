package aiproduct

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestP08AgentConfigurationHTTPAndTaskFence(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	other := authenticate(t, product.URL, store, newTestIdentityFromSeed(t, 84, "other-device"))
	input := map[string]any{"name": "Selected source assistant", "modelRef": "gateway.configured", "toolIds": []string{"ai.conversation.read"}, "state": "enabled"}
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/agents", input, session, http.StatusCreated)
	var result struct {
		Agent   AgentConfiguration `json:"agent"`
		Granted bool               `json:"authorityGranted"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.Granted || result.Agent.Revision != 1 {
		t.Fatalf("configuration created authority: %s", raw)
	}
	conversation, err := store.CreateConversation(session.Account, "Configured source")
	if err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask(session.Account, conversation.ID, session.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	raw = authedJSON(t, http.MethodPost, product.URL+"/api/tasks/"+task.ID+"/agent-configuration", map[string]any{"revision": 1, "generation": 1, "agentConfigurationId": result.Agent.ID}, session, http.StatusOK)
	var bound struct {
		Task    TaskRecord `json:"task"`
		Granted bool       `json:"authorityGranted"`
	}
	if err := json.Unmarshal(raw, &bound); err != nil {
		t.Fatal(err)
	}
	if bound.Granted || bound.Task.Holder != session.DeviceID || bound.Task.Revision != 2 {
		t.Fatalf("binding changed holder/authority: %s", raw)
	}
	input["expectedRevision"] = uint64(1)
	input["state"] = "paused"
	authedJSON(t, http.MethodPatch, product.URL+"/api/agents/"+result.Agent.ID, input, other, http.StatusNotFound)
	authedJSON(t, http.MethodPatch, product.URL+"/api/agents/"+result.Agent.ID, input, session, http.StatusOK)
	toolInput, _ := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	if _, _, err := store.reserveToolStep(ProductSession{Account: session.Account, DeviceID: session.DeviceID, Scopes: []string{"ai:conversations"}}, task.ID, toolStepRequest{OperationID: "paused-config", TaskRevision: 2, Generation: 1, ToolID: "ai.conversation.read", ToolVersion: "1", Input: toolInput}); err == nil {
		t.Fatal("paused configuration scheduled tool")
	}
	input["expectedRevision"] = uint64(2)
	input["state"] = "enabled"
	authedJSON(t, http.MethodPatch, product.URL+"/api/agents/"+result.Agent.ID, input, session, http.StatusOK)
	store.mu.Lock()
	err = store.assertTaskAgentConfigurationLocked(bound.Task, "ai.conversation.read")
	store.mu.Unlock()
	if err == nil {
		t.Fatal("reenable silently resumed old task configuration revision")
	}
	if len(store.state.Permissions) != 0 || len(store.state.Actions) != 0 {
		t.Fatal("configuration minted Grant or executed work")
	}
}
