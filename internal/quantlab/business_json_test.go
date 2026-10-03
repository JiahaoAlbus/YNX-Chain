package quantlab

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestBusinessJSONRejectsAmbiguousFieldsBeforeDecode(t *testing.T) {
	for _, body := range []string{
		`{"Cash":1,"Cash":2}`,
		`{"Cash":1,"cash":2}`,
		`{"Cash":1,"ca\u0073h":2}`,
		`{"Cash":1,"ca\u017fh":2}`,
		`{"nested":{"Amount":1,"amount":2}}`,
		`{"rows":[{"Side":"buy","side":"sell"}]}`,
	} {
		t.Run(body, func(t *testing.T) {
			w := httptest.NewRecorder()
			var v any
			if decode(w, httptest.NewRequest("POST", "/v1/paper/reconcile", strings.NewReader(body)), &v) || w.Code != 400 || v != nil {
				t.Fatalf("ambiguous business input accepted: code=%d decoded=%v", w.Code, v)
			}
		})
	}
	for _, body := range []string{`{"Cash":0,"Position":0}`, `[{"Amount":1},{"Amount":2}]`, `{"Reason":"literal user text"}`} {
		w := httptest.NewRecorder()
		var v any
		if !decode(w, httptest.NewRequest("POST", "/", strings.NewReader(body)), &v) {
			t.Fatal("unambiguous input rejected")
		}
	}
}

func TestAmbiguousReconciliationHTTPDoesNotMutatePaperRisk(t *testing.T) {
	s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	before := s.Snapshot()["paper"].(PaperState)
	req, _ := http.NewRequest("POST", server.URL+"/v1/paper/reconcile", strings.NewReader(`{"Cash":0,"cash":1,"Position":0}`))
	req.Header.Set("X-YNX-Preview-Mode", "local-paper")
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 400 || !strings.Contains(string(body), `"error":"invalid_json"`) {
		t.Fatalf("ambiguous reconciliation reached business service: %d %s", response.StatusCode, body)
	}
	after := s.Snapshot()["paper"].(PaperState)
	if after.KillSwitch != before.KillSwitch || after.ReconciliationDelta != before.ReconciliationDelta || after.Cash != before.Cash || after.Position != before.Position {
		t.Fatal("ambiguous request changed Paper state")
	}
	valid, _ := http.NewRequest("POST", server.URL+"/v1/paper/reconcile", strings.NewReader(fmt.Sprintf(`{"Cash":%d,"Position":%d}`, before.Cash, before.Position)))
	valid.Header.Set("X-YNX-Preview-Mode", "local-paper")
	response, err = server.Client().Do(valid)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 || s.Snapshot()["paper"].(PaperState).KillSwitch {
		t.Fatal("valid exact reconciliation no longer works")
	}
}

func TestBusinessJSONPreservesTypedAndResourceBoundaries(t *testing.T) {
	for _, body := range []string{
		`{"Reason":"ok","unknown":true}`,
		`{"Reason":"ok"} {"Reason":"second"}`,
		`{"Reason":`,
		strings.Repeat("[", 130) + "0" + strings.Repeat("]", 130),
		`{"Reason":"` + strings.Repeat("x", 8<<20) + `"}`,
	} {
		var v struct{ Reason string }
		w := httptest.NewRecorder()
		if decode(w, httptest.NewRequest("POST", "/", strings.NewReader(body)), &v) || w.Code != 400 {
			t.Fatal("invalid/resource-excessive typed request accepted")
		}
	}
}
