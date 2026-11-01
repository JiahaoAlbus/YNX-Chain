package aiproduct

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestP08OriginalPublicRunLookupAfterResponseLoss(t *testing.T) {
	f := newP08ModelFixture(t)
	input := f.request()
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, input)
	if err != nil || view.ID == "" || view.RunID != input.RunID {
		t.Fatalf("original run: %+v %v", view, err)
	}
	before := f.requests.Load()
	for _, id := range []string{view.ID, input.RunID} {
		r := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/runs/"+id, nil)
		r.SetPathValue("id", f.task.ID)
		r.SetPathValue("runId", id)
		w := httptest.NewRecorder()
		f.server.handleTaskModelRunRead(w, r, f.session)
		var got taskRunView
		if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &got) != nil || got.ID != view.ID || got.RunID != input.RunID {
			t.Fatalf("original lookup %s: %d %s", id, w.Code, w.Body.String())
		}
	}
	other := f.session
	other.Account = "PUBLIC-foreign-account"
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.SetPathValue("id", f.task.ID)
	r.SetPathValue("runId", input.RunID)
	w := httptest.NewRecorder()
	f.server.handleTaskModelRunRead(w, r, other)
	if w.Code != 404 {
		t.Fatal("public run alias escaped original account")
	}
	if f.requests.Load() != before {
		t.Fatal("run query replayed provider")
	}
}
