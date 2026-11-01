package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/aigateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/aitaskclient"
)

// Explicit PUBLIC authorization seam. This never grants normal product/Auth
// qualification; only synthetic owned attachments and loopback DAV are used.
type p08WebDAVAuthority struct {
	revoked atomic.Bool
	closed  atomic.Int32
	request TaskWebDAVAuthorizationRequest
	mu      sync.Mutex
}
type p08WebDAVLoan struct{ a *p08WebDAVAuthority }

func (a *p08WebDAVAuthority) AcquireOriginalWebDAVTask(ctx context.Context, r TaskWebDAVAuthorizationRequest) (OriginalTaskWebDAVLoan, error) {
	a.mu.Lock()
	a.request = r
	a.mu.Unlock()
	if r.AuthorizationRef != "PUBLIC-explicit-egress" || r.ContentSHA256 == "" || r.DestinationBinding == "" || r.Session.Account != r.Task.Account {
		return nil, ErrTaskWebDAVUnavailable
	}
	return &p08WebDAVLoan{a}, nil
}
func (l *p08WebDAVLoan) Current(ctx context.Context) error {
	if l.a.revoked.Load() {
		return ErrTaskWebDAVUnavailable
	}
	return ctx.Err()
}
func (l *p08WebDAVLoan) Close() error { l.a.closed.Add(1); return nil }

type p08WebDAVRuntimeFixture struct {
	s       *Server
	store   *Store
	key     []byte
	session ProductSession
	task    TaskRecord
	input   TaskWebDAVInput
	source  *p08WebDAVAuthority
	dav     *p08DAVFixture
	content []byte
}

func newP08WebDAVRuntime(t *testing.T) *p08WebDAVRuntimeFixture {
	t.Helper()
	store, c, key := p08TaskStore(t)
	task, err := store.CreateTask(c.Account, c.ID, "PUBLIC-holder")
	if err != nil {
		t.Fatal(err)
	}
	task, err = store.PrepareTask(c.Account, task.ID, task.Revision, task.Generation, task.Holder)
	if err != nil {
		t.Fatal(err)
	}
	content := []byte("PUBLIC synthetic original bytes\r\n原始\x00file\n")
	resource, err := store.AddAttachment(c.Account, c.ID, "PUBLIC-original.txt", "text/plain", content)
	if err != nil {
		t.Fatal(err)
	}
	dav := newP08DAVFixture(t)
	source := &p08WebDAVAuthority{}
	runtime, err := PrepareOriginalTaskWebDAVRuntime(source, []TaskWebDAVConfig{dav.cfg})
	if err != nil {
		t.Fatal(err)
	}
	return &p08WebDAVRuntimeFixture{s: &Server{store: store, webDAV: runtime}, store: store, key: key, session: ProductSession{ID: "PUBLIC-session", Account: c.Account, DeviceID: task.Holder, Scopes: []string{"ai:permissions", "ai:conversations"}}, task: task, input: TaskWebDAVInput{OperationID: "PUBLIC-original-operation", ResourceID: resource.ID, DestinationID: dav.cfg.ProfileID, TaskRevision: task.Revision, Generation: task.Generation}, source: source, dav: dav, content: content}
}
func (f *p08WebDAVRuntimeFixture) deliver() (TaskWebDAVReceipt, error) {
	return f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, f.input, "PUBLIC-explicit-egress", false)
}

func TestP08WebDAVDurableOriginalRecovery(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	f.dav.lostACK = true
	first, err := f.deliver()
	if err == nil || first.State != "UNKNOWN" || f.dav.requests() != "PUT" {
		t.Fatalf("lostACK promoted or replayed %+v %v %s", first, err, f.dav.requests())
	}
	raw, _ := os.ReadFile(f.store.path)
	if bytes.Contains(raw, f.content) || bytes.Contains(raw, []byte(f.dav.cfg.Password)) {
		t.Fatal("content or credential persisted plaintext")
	}
	reopened, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.s.store = reopened
	receipt, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: f.input.OperationID}, "PUBLIC-explicit-egress", true)
	if err != nil || receipt.State != "CONTENT_PRESENT" || receipt.AuthorshipProven || receipt.ETag == "" || receipt.RemoteID != f.dav.cfg.Object || receipt.SHA256 != taskWebDAVDigest(f.content) || f.dav.requests() != "PUT,GET" {
		t.Fatalf("original not recovered %+v %v %s", receipt, err, f.dav.requests())
	}
	again, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, f.input, "PUBLIC-explicit-egress", false)
	if err != nil || again != receipt || f.dav.requests() != "PUT,GET" {
		t.Fatal("original receipt changed or duplicate effect")
	}
	stored, err := reopened.TaskWebDAVResult(f.session, f.task.ID, f.input.OperationID)
	if err != nil || stored != receipt {
		t.Fatal("user did not receive original persisted receipt")
	}
	other := f.session
	other.Account = "PUBLIC-other-account"
	if _, err := reopened.TaskWebDAVResult(other, f.task.ID, f.input.OperationID); err == nil {
		t.Fatal("cross-account receipt leaked")
	}
}

func TestP08WebDAVUnknownAbsentNeverRetries(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	f.dav.status = 503
	if _, err := f.deliver(); err == nil {
		t.Fatal("unresolved PUT accepted")
	}
	f.dav.mu.Lock()
	f.dav.status = 0
	f.dav.mu.Unlock()
	receipt, err := f.deliver()
	if err == nil || receipt.State != "UNKNOWN" || receipt.ContentState != "ABSENT" || f.dav.requests() != "PUT,GET" {
		t.Fatalf("absent triggered replay %+v %v %s", receipt, err, f.dav.requests())
	}
	f.source.revoked.Store(true)
	_, err = f.deliver()
	if err == nil || f.dav.requests() != "PUT,GET" {
		t.Fatal("revoked source sent query/PUT")
	}
}

func TestP08WebDAVDurabilityFailureNeverResubmits(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	originalPath := f.store.path
	// Fail final persistence after real PUT/GET. The original durable UNKNOWN
	// reservation survives and reopen recovers by GET only.
	f.dav.afterRequest = func(method string) {
		if method == "GET" {
			f.store.mu.Lock()
			f.store.path = filepath.Join(originalPath, "not-a-directory")
			f.store.mu.Unlock()
		}
	}
	_, err := f.deliver()
	if err == nil {
		t.Fatal("save failure hidden")
	}
	f.store.path = originalPath
	f.dav.mu.Lock()
	f.dav.afterRequest = nil
	f.dav.mu.Unlock()
	reopened, err := NewStore(originalPath, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.s.store = reopened
	r, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, f.input, "PUBLIC-explicit-egress", false)
	if err != nil || r.State != "CONTENT_PRESENT" || f.dav.requests() != "PUT,GET,GET" {
		t.Fatalf("persistence failure replayed original %s %+v %v", f.dav.requests(), r, err)
	}
	missing := newP08WebDAVRuntime(t)
	missing.store.path = filepath.Join(missing.store.path, "bad")
	if _, err := missing.deliver(); err == nil || missing.dav.requests() != "" {
		t.Fatal("PUT preceded durable reservation")
	}
}

func TestP08WebDAVConcurrentOnceAndBoundDestination(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, _ = f.deliver() }()
	}
	wg.Wait()
	if strings.Count(f.dav.requests(), "PUT") != 1 {
		t.Fatal("concurrent original PUT replay", f.dav.requests())
	}
	altered := f.input
	altered.ResourceID = "attachment_other"
	if _, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, altered, "PUBLIC-explicit-egress", false); !errors.Is(err, errToolConflict) {
		t.Fatal("operation source replaced")
	}
	if f.source.closed.Load() == 0 {
		t.Fatal("original borrowed loan not closed")
	}
}

func TestP08WebDAVAuthenticatedReceiptAndBackupRollback(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	backup := filepath.Join(t.TempDir(), "PUBLIC-old.backup")
	if _, err := f.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	if _, err := f.deliver(); err != nil {
		t.Fatal(err)
	}
	if _, err := f.store.RestoreBackup(backup); err == nil {
		t.Fatal("backup rollback discarded original DAV attempt")
	}
	// The plaintext projection cannot be promoted into author/receipt proof.
	key := taskWebDAVKey(f.session.Account, f.task.ID, f.input.OperationID)
	f.store.mu.Lock()
	r := f.store.state.WebDAVDeliveries[key]
	r.Receipt.AuthorshipProven = true
	f.store.state.WebDAVDeliveries[key] = r
	f.store.mu.Unlock()
	if _, err := f.store.TaskWebDAVResult(f.session, f.task.ID, f.input.OperationID); err == nil {
		t.Fatal("unauthenticated authored receipt accepted")
	}
	if _, err := f.deliver(); err == nil {
		t.Fatal("tampered receipt used by dispatcher")
	}
}

func TestP08WebDAVOriginalQueryAfterCancelOrHandoff(t *testing.T) {
	for _, mode := range []string{"cancel", "handoff"} {
		t.Run(mode, func(t *testing.T) {
			f := newP08WebDAVRuntime(t)
			f.dav.lostACK = true
			if _, err := f.deliver(); err == nil {
				t.Fatal("missing UNKNOWN")
			}
			var err error
			if mode == "cancel" {
				_, err = f.store.CancelTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID)
			} else {
				_, err = f.store.HandoffTask(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.session.DeviceID, "PUBLIC-new-holder")
			}
			if err != nil {
				t.Fatal(err)
			}
			r, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: f.input.OperationID}, "PUBLIC-explicit-egress", true)
			if err != nil || r.State != "CONTENT_PRESENT" || f.dav.requests() != "PUT,GET" {
				t.Fatalf("original query blocked or resubmitted %s %v", f.dav.requests(), err)
			}
			f.source.mu.Lock()
			request := f.source.request
			f.source.mu.Unlock()
			if !request.QueryOriginal || request.OriginalHolder != f.session.DeviceID || request.OriginalGeneration != f.task.Generation {
				t.Fatal("original history replaced by new task authority")
			}
			fresh := f.input
			fresh.OperationID = "PUBLIC-new-operation"
			if _, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, fresh, "PUBLIC-explicit-egress", false); err == nil || f.dav.requests() != "PUT,GET" {
				t.Fatal("cancel/handoff allowed a fresh PUT")
			}
		})
	}
}

func TestP08WebDAVServiceRejectsAmbiguityAndMissingSource(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	for _, body := range []string{`{"operationId":"one","operationId":"two"}`, `{"url":"http://127.0.0.1:1/metadata"}`, `{"authorizationRef":"a","authorizationRef":"b"}`} {
		r := httptest.NewRequest("POST", "/api/tasks/original/webdav", strings.NewReader(body))
		r.SetPathValue("id", f.task.ID)
		w := httptest.NewRecorder()
		f.s.handleTaskWebDAVDeliver(w, r, f.session)
		if w.Code != 400 || f.dav.requests() != "" {
			t.Fatal("ambiguous/injected service payload accepted")
		}
	}
	f.s.webDAV = nil
	body, _ := json.Marshal(struct {
		TaskWebDAVInput
		AuthorizationRef string `json:"authorizationRef"`
	}{f.input, "PUBLIC-explicit-egress"})
	r := httptest.NewRequest("POST", "/api/tasks/original/webdav", bytes.NewReader(body))
	r.SetPathValue("id", f.task.ID)
	w := httptest.NewRecorder()
	f.s.handleTaskWebDAVDeliver(w, r, f.session)
	if w.Code != 503 || f.dav.requests() != "" || len(f.store.state.WebDAVDeliveries) != 0 {
		t.Fatal("session/model replaced original WRITE Source")
	}
}

func TestP08WebDAVNewOperationCannotReplayUnknownDestination(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	f.dav.lostACK = true
	if _, err := f.deliver(); err == nil {
		t.Fatal("lost ACK not UNKNOWN")
	}
	other := f.input
	other.OperationID = "PUBLIC-replacement-operation"
	r, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, other, "PUBLIC-explicit-egress", false)
	if !errors.Is(err, ErrTaskWebDAVUnknown) || r.OperationID != f.input.OperationID || f.dav.requests() != "PUT" || len(f.store.state.WebDAVDeliveries) != 1 {
		t.Fatal("replacement operation replayed unresolved write")
	}
	key := taskWebDAVKey(f.session.Account, f.task.ID, f.input.OperationID)
	f.store.mu.Lock()
	original := f.store.state.WebDAVDeliveries[key]
	altered := original
	altered.Receipt.State = "CONTENT_PRESENT"
	f.store.state.WebDAVDeliveries[key] = altered
	f.store.mu.Unlock()
	if _, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, other, "PUBLIC-explicit-egress", false); err == nil || f.dav.requests() != "PUT" {
		t.Fatal("tampered prior receipt bypassed original-only recovery")
	}
	f.store.mu.Lock()
	f.store.state.WebDAVDeliveries[key] = original
	f.store.mu.Unlock()
	r, err = f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: f.input.OperationID}, "PUBLIC-explicit-egress", true)
	if err != nil || r.State != "CONTENT_PRESENT" || f.dav.requests() != "PUT,GET" {
		t.Fatal("original query did not recover without PUT")
	}
}

func TestP08WebDAVDestinationAliasCannotReplayUnknown(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	f.dav.lostACK = true
	alias := f.dav.cfg
	alias.ProfileID = "PUBLIC-second-label"
	var err error
	f.s.webDAV, err = PrepareOriginalTaskWebDAVRuntime(f.source, []TaskWebDAVConfig{f.dav.cfg, alias})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.deliver(); err == nil {
		t.Fatal("original ACK not lost")
	}
	other := f.input
	other.OperationID = "PUBLIC-alias-operation"
	other.DestinationID = alias.ProfileID
	r, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, other, "PUBLIC-explicit-egress", false)
	if !errors.Is(err, ErrTaskWebDAVUnknown) || r.OperationID != f.input.OperationID || f.dav.requests() != "PUT" {
		t.Fatal("destination label bypassed original unknown object")
	}
	if _, err := f.s.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: f.input.OperationID}, "PUBLIC-explicit-egress", true); err != nil || f.dav.requests() != "PUT,GET" {
		t.Fatal("alias guard changed original recovery")
	}
}

func TestP08WebDAVModelAndNormalClientResult(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	args, _ := json.Marshal(map[string]string{"resourceId": f.input.ResourceID, "destinationId": f.input.DestinationID})
	executor := &taskModelExecutor{s: f.s, session: f.session, run: taskModelRun{TaskID: f.task.ID, RunID: "PUBLIC-model-run", TaskRevision: f.task.Revision, Generation: f.task.Generation, ToolIDs: []string{taskWebDAVToolID}}, authorizationRef: "PUBLIC-explicit-egress"}
	call := aigateway.ToolCall{ID: "PUBLIC-model-call", Type: "function"}
	call.Function.Name = taskWebDAVModelName
	call.Function.Arguments = string(args)
	result, err := executor.ExecuteTool(context.Background(), call)
	if err != nil || result.Status != aigateway.ToolCompleted || !bytes.Contains(result.Content, []byte(`"state":"CONTENT_PRESENT"`)) || !bytes.Contains(result.Content, []byte(`"authorshipProven":false`)) {
		t.Fatalf("model got fabricated completion %s %v", result.Content, err)
	}
	var receipt TaskWebDAVReceipt
	_ = json.Unmarshal(result.Content, &receipt)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.SetPathValue("id", f.task.ID)
		r.SetPathValue("operationId", receipt.OperationID)
		f.s.handleTaskWebDAVResult(w, r, f.session)
	}))
	defer server.Close()
	// Actual normal CLI client path/HTTP response, explicit PUBLIC identity
	// seam above; no real Wallet proof or canonical Source admission claimed.
	client, err := aitaskclient.New(server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := client.Do(context.Background(), aitaskclient.Request{Action: "webdav-result", TaskID: f.task.ID, StepID: receipt.OperationID, Proof: "PUBLIC-proof-not-authority"})
	if err != nil || !bytes.Contains(response.Body, []byte(receipt.ETag[1:len(receipt.ETag)-1])) {
		t.Fatal("normal client did not read persisted original", err, string(response.Body))
	}
	var out struct {
		Receipt TaskWebDAVReceipt `json:"receipt"`
	}
	if json.Unmarshal(response.Body, &out) != nil || out.Receipt != receipt {
		t.Fatal("user/model result mismatch")
	}
	if binary := os.Getenv("P08_WEBDAV_CLI_BINARY"); binary != "" {
		proofFile := filepath.Join(t.TempDir(), "PUBLIC-proof.txt")
		if err := os.WriteFile(proofFile, []byte("PUBLIC-proof-not-authority"), 0600); err != nil {
			t.Fatal(err)
		}
		command := exec.CommandContext(context.Background(), binary, "-action", "webdav-result", "-daemon", server.URL, "-task", f.task.ID, "-step", receipt.OperationID, "-proof-file", proofFile)
		raw, err := command.Output()
		if err != nil {
			t.Fatal("actual normal CLI failed", err)
		}
		var actual struct {
			Receipt TaskWebDAVReceipt `json:"receipt"`
		}
		if json.Unmarshal(raw, &actual) != nil || actual.Receipt != receipt {
			t.Fatal("CLI did not expose exact original result")
		}
		t.Log("actual normal ynx-ai-task CLI read the exact original model observation")
	}
}

func TestP08WebDAVProviderToolResultRoundTrip(t *testing.T) {
	var args string
	var rounds atomic.Int32
	f := newP08ModelFixture(t)
	providerServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"isolated","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		if r.URL.Path != "/chat/completions" {
			w.WriteHeader(404)
			return
		}
		var body struct {
			Messages []struct {
				Role       string `json:"role"`
				Content    string `json:"content"`
				ToolCallID string `json:"tool_call_id"`
			} `json:"messages"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("provider body malformed")
			w.WriteHeader(400)
			return
		}
		if rounds.Add(1) == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "content": "", "tool_calls": []any{map[string]any{"id": "PUBLIC-webdav-modelcall", "type": "function", "function": map[string]any{"name": taskWebDAVModelName, "arguments": args}}}}}}})
			return
		}
		last := body.Messages[len(body.Messages)-1]
		if last.Role != "tool" || last.ToolCallID != "PUBLIC-webdav-modelcall" || !strings.Contains(last.Content, `"state":"CONTENT_PRESENT"`) || !strings.Contains(last.Content, `"authorshipProven":false`) {
			t.Error("provider received fabricated write authorship or no real tool observation")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "The exact bytes were observed at the selected destination; authorship is unproven."}}}})
	}))
	t.Cleanup(providerServer.Close)
	provider, err := aigateway.New(aigateway.Config{ChainURL: providerServer.URL, ProviderURL: providerServer.URL, Model: "isolated-fixed-model", ProviderAPIKey: "isolated-provider-key", AccessAPIKey: "isolated-access", UpstreamKey: "isolated-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	f.server.taskModel = provider
	resource, err := f.server.store.AddAttachment(f.session.Account, f.task.ConversationID, "PUBLIC-provider.txt", "text/plain", []byte("PUBLIC provider-selected original resource"))
	if err != nil {
		t.Fatal(err)
	}
	dav := newP08DAVFixture(t)
	source := &p08WebDAVAuthority{}
	f.server.webDAV, err = PrepareOriginalTaskWebDAVRuntime(source, []TaskWebDAVConfig{dav.cfg})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(map[string]string{"resourceId": resource.ID, "destinationId": dav.cfg.ProfileID})
	args = string(b)
	request := f.request()
	request.ToolIDs = []string{taskWebDAVToolID}
	request.AuthorizationRef = "PUBLIC-explicit-egress"
	answer, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || answer.Status != "COMPLETED" || rounds.Load() != 2 || !strings.Contains(answer.Content, "authorship is unproven") || len(answer.Steps) != 1 || dav.requests() != "PUT,GET" {
		t.Fatalf("actual provider tool loop failed status=%s requests=%d dav=%s err=%v", answer.Status, rounds.Load(), dav.requests(), err)
	}
	original, err := f.server.store.TaskWebDAVResult(f.session, f.task.ID, answer.Steps[0])
	if err != nil || original.State != "CONTENT_PRESENT" || original.AuthorshipProven {
		t.Fatal("user's original model receipt missing", err)
	}
}
