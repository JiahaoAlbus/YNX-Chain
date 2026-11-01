package aitaskclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

func testJournal(t *testing.T) *Journal {
	t.Helper()
	j, e := OpenJournal(filepath.Join(t.TempDir(), "delivery"))
	if e != nil {
		t.Fatal(e)
	}
	return j
}
func TestTaskClientLostResponsePersistsUnknownAndNoReplay(t *testing.T) {
	var calls atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		conn, _, e := w.(http.Hijacker).Hijack()
		if e != nil {
			t.Error(e)
			return
		}
		_ = conn.Close()
	}))
	defer peer.Close()
	j := testJournal(t)
	client, e := New(peer.URL, j)
	if e != nil {
		t.Fatal(e)
	}
	req := Request{Action: "step-dispatch", TaskID: "task_original", StepID: "step_original", OperationID: "local_original", Proof: "PUBLIC-proof-not-authority", Body: json.RawMessage(`{"authorizationRef":"PUBLIC-secret-grant-ref"}`)}
	if _, e := client.Do(context.Background(), req); e == nil {
		t.Fatal("lost response became success")
	}
	reopened, e := OpenJournal(j.directory)
	if e != nil {
		t.Fatal(e)
	}
	record, e := reopened.Read(req.OperationID)
	if e != nil || record.State != "UNKNOWN" || record.StepID != req.StepID {
		t.Fatalf("original delivery not retained: %+v %v", record, e)
	}
	raw, _ := os.ReadFile(filepath.Join(j.directory, req.OperationID+".json"))
	if strings.Contains(string(raw), req.Proof) || strings.Contains(string(raw), "PUBLIC-secret-grant-ref") {
		t.Fatal("private data leaked into journal")
	}
	restarted, _ := New(peer.URL, reopened)
	if _, e := restarted.Do(context.Background(), req); !errors.Is(e, ErrUnresolved) || calls.Load() != 1 {
		t.Fatalf("restart replayed original effect: %d %v", calls.Load(), e)
	}
}
func TestTaskClientOriginalQueryAndResponseNotCompletion(t *testing.T) {
	j := testJournal(t)
	var calls atomic.Int32
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/api/tasks/task_original/tool-steps/step_original/reconcile" || r.Header.Get(productsessionv2.ProofHeader) != "PUBLIC-fresh-proof" || r.Header.Get("Authorization") != "" {
			t.Error("original route/proof changed")
		}
		w.WriteHeader(409)
		_, _ = w.Write([]byte(`{"error":"UNKNOWN","originalOperation":"PUBLIC-original"}`))
	}))
	defer peer.Close()
	c, _ := New(peer.URL, j)
	out, e := c.Do(context.Background(), Request{Action: "step-reconcile", TaskID: "task_original", StepID: "step_original", OperationID: "query_once", Proof: "PUBLIC-fresh-proof", Body: json.RawMessage(`{"authorizationRef":"PUBLIC-ref"}`)})
	var rejected *HTTPError
	if !errors.As(e, &rejected) || out.Status != 409 || calls.Load() != 1 || out.Operation.State != "REJECTED_RESPONSE" {
		t.Fatalf("query response became receipt: %+v %v", out, e)
	}
}
func TestTaskClientRejectsRedirectWithoutLeakingProof(t *testing.T) {
	var leaked atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked.Add(1) }))
	defer destination.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", destination.URL)
		w.WriteHeader(307)
		_, _ = w.Write([]byte(`{"redirect":true}`))
	}))
	defer origin.Close()
	c, _ := New(origin.URL, testJournal(t))
	if _, e := c.Do(context.Background(), Request{Action: "session", Proof: "PUBLIC-proof"}); e == nil || leaked.Load() != 0 {
		t.Fatal("redirect followed")
	}
	for _, bad := range []string{"https://127.0.0.1:6438", "http://localhost:6438", "http://127.0.0.1:6438/other", "http://user@127.0.0.1:6438", "http://example.com:80"} {
		if _, e := New(bad, nil); e == nil {
			t.Fatal("unsafe destination accepted", bad)
		}
	}
}
func TestJournalPendingSurvivesCrashAndPrivateFileChecks(t *testing.T) {
	j := testJournal(t)
	_, e := j.Begin("crashed", "http://127.0.0.1:1", Route{Method: "POST", Path: "/api/tasks"}, "", "", "", []byte(`{}`))
	if e != nil {
		t.Fatal(e)
	}
	again, _ := OpenJournal(j.directory)
	if _, e := again.Begin("crashed", "http://127.0.0.1:1", Route{Method: "POST", Path: "/api/tasks"}, "", "", "", []byte(`{}`)); !errors.Is(e, ErrUnresolved) {
		t.Fatal("crashed pending replay admitted", e)
	}
	proof := filepath.Join(t.TempDir(), "proof")
	if e := os.WriteFile(proof, []byte("PUBLIC"), 0644); e != nil {
		t.Fatal(e)
	}
	if _, e := ReadPrivateFile(proof, 100); e == nil {
		t.Fatal("public credential file admitted")
	}
	if e := os.Chmod(proof, 0600); e != nil {
		t.Fatal(e)
	}
	link := proof + "-link"
	_ = os.Symlink(proof, link)
	if _, e := ReadPrivateFile(link, 100); e == nil {
		t.Fatal("credential symlink admitted")
	}
}
func TestExplicitLocalFileInspectionRealBytes(t *testing.T) {
	file := filepath.Join(t.TempDir(), "actual.txt")
	if e := os.WriteFile(file, []byte("Actual OS read\n"), 0600); e != nil {
		t.Fatal(e)
	}
	result, e := InspectFile(context.Background(), file)
	if e != nil || result.Bytes != 15 || result.SHA256 != digest([]byte("Actual OS read\n")) || len(result.SHA3_512) != 128 || result.TaskGrant || result.ModelDisclosed {
		t.Fatalf("inspection fabricated authority/content: %+v %v", result, e)
	}
	_ = os.Symlink(file, file+"-link")
	if _, e := InspectFile(context.Background(), file+"-link"); e == nil {
		t.Fatal("symlink inspected")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e := InspectFile(ctx, file); !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
}

func TestTaskClientCanonicalHandoffRoute(t *testing.T) {
	route, err := Resolve(Request{Action: "task-handoff", TaskID: "task_original"})
	if err != nil || route.Method != "POST" || route.Path != "/open/v1/tasks/task_original/handoffs" || !route.Private {
		t.Fatalf("wrong original route %+v %v", route, err)
	}
	if _, err := Resolve(Request{Action: "task-handoff", TaskID: "../foreign"}); err == nil {
		t.Fatal("path injection accepted")
	}
}
