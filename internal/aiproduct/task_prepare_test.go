package aiproduct

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestP08NormalTaskPrepareAndUnadmittedRun(t *testing.T) {
	gateway := newGatewayFixture(t, true)
	defer gateway.Close()
	store, product := testProduct(t, gateway.URL)
	defer product.Close()
	session := authenticate(t, product.URL, store, newTestIdentity(t))
	other := authenticate(t, product.URL, store, newTestIdentityFromSeed(t, 84, "other-device"))
	conversation, err := store.CreateConversation(session.Account, "Normal API task")
	if err != nil {
		t.Fatal(err)
	}
	raw := authedJSON(t, http.MethodPost, product.URL+"/api/tasks", map[string]string{"conversationId": conversation.ID}, session, http.StatusCreated)
	var task TaskRecord
	if err := json.Unmarshal(raw, &task); err != nil {
		t.Fatal(err)
	}
	if task.Status != "DRAFT" || task.Revision != 1 || task.Generation != 1 {
		t.Fatalf("incorrect draft: %+v", task)
	}
	endpoint := product.URL + "/api/tasks/" + task.ID
	authedJSON(t, http.MethodPost, endpoint+"/prepare", map[string]uint64{"revision": 1, "generation": 1}, other, http.StatusNotFound)
	raw = authedJSON(t, http.MethodPost, endpoint+"/prepare", map[string]uint64{"revision": 1, "generation": 1}, session, http.StatusOK)
	var prepared struct {
		Task     TaskRecord `json:"task"`
		Granted  bool       `json:"authorityGranted"`
		Executed bool       `json:"executed"`
	}
	if err := json.Unmarshal(raw, &prepared); err != nil {
		t.Fatal(err)
	}
	if prepared.Task.Status != "READY" || prepared.Task.Revision != 2 || prepared.Granted || prepared.Executed {
		t.Fatalf("preparation minted authority: %s", raw)
	}
	authedJSON(t, http.MethodPost, endpoint+"/prepare", map[string]uint64{"revision": 1, "generation": 1}, session, http.StatusConflict)
	authedJSON(t, http.MethodPost, endpoint+"/runs", map[string]any{"runId": "normal-run", "taskRevision": 2, "generation": 1, "prompt": "Read selected source", "authorizationRef": "ordinary-session-not-Grant"}, session, http.StatusServiceUnavailable)
	if len(store.state.TaskRuns) != 0 || len(store.state.Actions) != 0 || len(store.state.Permissions) != 0 {
		t.Fatal("unadmitted run created authority or consumed an effect")
	}
}
