package cloud

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductWriteJournal(t *testing.T) {
	root := filepath.Join(t.TempDir(), "journal")
	journal, err := newProductWriteJournal(root)
	if err != nil {
		t.Fatal(err)
	}
	actor := Session{Product: "docs", Account: "owner"}
	calls := 0
	next := func(w http.ResponseWriter, r *http.Request, _ Session) {
		calls++
		writeJSON(w, 201, map[string]string{"id": "created-document"})
	}
	request := func(key, body string, fn authed) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/api/v1/objects", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if key != "" {
			r.Header.Set("Idempotency-Key", key)
		}
		w := httptest.NewRecorder()
		journal.serve(w, r, actor, fn)
		return w
	}
	key := "create-document-0001"
	if w := request("", `{}`, next); w.Code != 400 {
		t.Fatalf("missing key: %d", w.Code)
	}
	first := request(key, `{"name":"one"}`, next)
	if first.Code != 201 || calls != 1 {
		t.Fatalf("first: %d calls=%d", first.Code, calls)
	}
	journal, err = newProductWriteJournal(root)
	if err != nil {
		t.Fatal(err)
	}
	replay := request(key, `{"name":"one"}`, next)
	if replay.Code != 201 || replay.Body.String() != first.Body.String() || replay.Header().Get("Idempotency-Replayed") != "true" || calls != 1 {
		t.Fatalf("durable replay: %d calls=%d", replay.Code, calls)
	}
	if w := request(key, `{"name":"changed"}`, next); w.Code != 409 || !strings.Contains(w.Body.String(), "IDEMPOTENCY_KEY_CONFLICT") || calls != 1 {
		t.Fatalf("body conflict: %d calls=%d", w.Code, calls)
	}
	uncertain := func(w http.ResponseWriter, _ *http.Request, _ Session) {
		calls++
		writeError(w, 500, "persistence acknowledgment failed")
	}
	if w := request("uncertain-write-0001", `{}`, uncertain); w.Code != 500 {
		t.Fatalf("uncertain first: %d", w.Code)
	}
	before := calls
	journal, err = newProductWriteJournal(root)
	if err != nil {
		t.Fatal(err)
	}
	if w := request("uncertain-write-0001", `{}`, next); w.Code != 409 || !strings.Contains(w.Body.String(), "WRITE_OUTCOME_UNCERTAIN") || calls != before {
		t.Fatalf("uncertain restart: %d calls=%d", w.Code, calls)
	}
	conflict := func(w http.ResponseWriter, _ *http.Request, _ Session) {
		calls++
		writeJSON(w, 409, map[string]any{"current": map[string]int{"version": 2}})
	}
	firstConflict := request("version-conflict-0001", `{}`, conflict)
	before = calls
	replayedConflict := request("version-conflict-0001", `{}`, next)
	if firstConflict.Code != 409 || replayedConflict.Code != 409 || firstConflict.Body.String() != replayedConflict.Body.String() || calls != before {
		t.Fatal("version conflict receipt changed")
	}
}
