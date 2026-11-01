package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type p08PagesFixture struct {
	pages []TaskPageSnapshot
	calls int
	fail  error
}

func (p *p08PagesFixture) ReadOriginalTaskPages(_ context.Context, r OriginalTaskPagesRequest) ([]TaskPageSnapshot, error) {
	p.calls++
	if p.fail != nil {
		return nil, p.fail
	}
	if r.Session.Account == "" || r.Task.ID == "" {
		return nil, errToolInvalid
	}
	raw, _ := json.Marshal(p.pages)
	var out []TaskPageSnapshot
	_ = json.Unmarshal(raw, &out)
	return out, nil
}
func p08Pages(taskID string) []TaskPageSnapshot {
	pages := make([]TaskPageSnapshot, 3)
	for i := range pages {
		raw, _ := json.Marshal(map[string]any{"schema": "YNX_BROWSER_SELECTED_PAGE_V1", "tabID": "PUBLIC-tab-" + string(rune('A'+i)), "profileID": "ordinary", "generation": "1", "origin": "https://example.org", "taskID": taskID, "fields": []string{"title", "text"}, "content": map[string]string{"title": "PUBLIC selected page " + string(rune('A'+i)), "text": "Synthetic comparison input <&> \u2028"}})
		hash := sha512.Sum512(raw)
		sha3hash := sha3.Sum512(raw)
		pages[i] = TaskPageSnapshot{TaskID: taskID, Reference: TaskPageReference{SelectionID: "PUBLIC-page-" + string(rune('A'+i)), Version: hex.EncodeToString(hash[:])}, TabID: "PUBLIC-tab-" + string(rune('A'+i)), ProfileID: "ordinary", Bytes: len(raw), SHA3_512: hex.EncodeToString(sha3hash[:]), Generation: 1, Origin: "https://example.org", Fields: []string{"title", "text"}, State: "AVAILABLE", Content: raw}
	}
	pages[2].State = "UNAVAILABLE"
	pages[2].Content = nil
	return pages
}
func p08PagesModel(t *testing.T, f *p08ModelFixture, hook func()) *atomic.Int32 {
	t.Helper()
	calls := &atomic.Int32{}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"isolated","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		calls.Add(1)
		var body struct{ Messages []struct{ Content string } }
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		raw, _ := json.Marshal(body)
		if !strings.Contains(string(raw), "UNAVAILABLE") || !strings.Contains(string(raw), "PUBLIC-page-A") {
			t.Error("original page labels/missing state were lost")
		}
		if hook != nil {
			hook()
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "PUBLIC comparison; page C is unavailable."}}}})
	}))
	t.Cleanup(provider.Close)
	service, err := NewTaskModelService(TaskModelConfig{ChainURL: provider.URL, ProviderURL: provider.URL, ProviderAPIKey: "PUBLIC-key", Model: "PUBLIC-fixed-model", AccessAPIKey: "PUBLIC-access", UpstreamKey: "PUBLIC-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	f.server.taskModel = service
	return calls
}
func p08PageRequest(f *p08ModelFixture, p []TaskPageSnapshot) taskRunRequest {
	r := f.request()
	r.Prompt = "Compare the selected pages and identify missing evidence."
	for _, s := range p {
		r.SelectedPages = append(r.SelectedPages, s.Reference)
	}
	return r
}
func TestP08PagesNormalModelVersionLabelsAndReadOnlyReopen(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	calls := p08PagesModel(t, f, nil)
	r := p08PageRequest(f, pages.pages)
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
	if err != nil || view.Status != "COMPLETED" || len(view.Sources) != 3 || view.Model != "PUBLIC-fixed-model" || view.TaskRevision != f.task.Revision || calls.Load() != 1 {
		t.Fatalf("normal page run: %+v %v", view, err)
	}
	for _, p := range view.Sources {
		if len(p.Content) != 0 {
			t.Fatal("source bytes escaped in result projection")
		}
	}
	raw, _ := os.ReadFile(f.server.store.path)
	if strings.Contains(string(raw), "Synthetic comparison input") || strings.Contains(string(raw), "PUBLIC-page-A") {
		t.Fatal("private source snapshot persisted in plaintext")
	}
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	server := &Server{store: reopened}
	httpRead := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/runs/"+r.RunID, nil)
	httpRead.SetPathValue("id", f.task.ID)
	httpRead.SetPathValue("runId", r.RunID)
	out := httptest.NewRecorder()
	server.handleTaskModelRunRead(out, httpRead, f.session)
	if out.Code != 200 || !strings.Contains(out.Body.String(), "PUBLIC-fixed-model") || !strings.Contains(out.Body.String(), "UNAVAILABLE") || calls.Load() != 1 {
		t.Fatalf("reopened result: %d %s", out.Code, out.Body.String())
	}
	// Retained result retry cannot substitute refs or trigger a new provider.
	r.SelectedPages[0].Version = strings.Repeat("a", 128)
	if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, r); err == nil || calls.Load() != 1 {
		t.Fatal("changed refs reused old report")
	}
}
func TestP08PagesLateNavigationAndHandoffNeverReturnReport(t *testing.T) {
	for _, change := range []string{"navigation", "handoff"} {
		t.Run(change, func(t *testing.T) {
			f := newP08ModelFixture(t)
			pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
			f.server.taskPages = pages
			calls := p08PagesModel(t, f, func() {
				if change == "navigation" {
					pages.pages[0].Generation++
					pages.pages[0].State = "STALE"
					pages.pages[0].Content = nil
				} else {
					if _, err := f.server.store.HandoffTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, "PUBLIC-human-holder"); err != nil {
						t.Error(err)
					}
				}
			})
			view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, p08PageRequest(f, pages.pages))
			if view.Content != "" || view.Status == "COMPLETED" || calls.Load() != 1 {
				t.Fatalf("late report released: %+v %v", view, err)
			}
			if change == "navigation" && !errors.Is(err, errTaskModelReturnBlocked) {
				t.Fatalf("missing return failure: %v", err)
			}
		})
	}
}
func TestP08PagesUnavailableOrChangedSourceStopsBeforeProvider(t *testing.T) {
	for _, kind := range []string{"no-source", "duplicate", "wrong-version", "hidden-field", "missing-bytes", "changed-at-disclosure"} {
		t.Run(kind, func(t *testing.T) {
			f := newP08ModelFixture(t)
			pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
			f.server.taskPages = pages
			calls := p08PagesModel(t, f, nil)
			r := p08PageRequest(f, pages.pages)
			switch kind {
			case "no-source":
				f.server.taskPages = nil
			case "duplicate":
				r.SelectedPages[1] = r.SelectedPages[0]
			case "wrong-version":
				pages.pages[0].Content = json.RawMessage(`{"title":"changed","text":"replacement"}`)
			case "hidden-field":
				pages.pages[0].Fields = append(pages.pages[0].Fields, "password")
			case "missing-bytes":
				pages.pages[2].Content = json.RawMessage(`{}`)
			case "changed-at-disclosure":
				f.server.taskModelAdmit = func(context.Context, ProductSession, TaskRecord, string, string, []byte) error {
					pages.pages[0].Generation++
					return nil
				}
			}
			_, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
			if err == nil || calls.Load() != 0 {
				t.Fatalf("unsafe pages reached provider: %v calls=%d", err, calls.Load())
			}
		})
	}
}

func TestP08PagesExactReportAttachmentAndFixedDestinationReceipt(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	p08PagesModel(t, f, nil)
	r := p08PageRequest(f, pages.pages)
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := f.server.store.AddTaskModelReportAttachment(f.session, f.task.ConversationID, f.task.ID, r.RunID)
	if err != nil {
		t.Fatal(err)
	}
	again, err := f.server.store.AddTaskModelReportAttachment(f.session, f.task.ConversationID, f.task.ID, r.RunID)
	if err != nil || again.ID != attachment.ID {
		t.Fatal("report materialization was not idempotent")
	}
	expected, _ := json.Marshal(view)
	if attachment.SHA256 != taskWebDAVDigest(expected) {
		t.Fatal("report bytes are not exact original result")
	}
	dav := newP08DAVFixture(t)
	dav.cfg.MaxBytes = 256 << 10
	source := &p08WebDAVAuthority{}
	prepared, err := PrepareOriginalTaskWebDAVRuntime(source, []TaskWebDAVConfig{dav.cfg})
	if err != nil {
		t.Fatal(err)
	}
	f.server.webDAV = prepared
	input := TaskWebDAVInput{OperationID: "PUBLIC-report-delivery", ResourceID: attachment.ID, DestinationID: dav.cfg.ProfileID, TaskRevision: f.task.Revision, Generation: f.task.Generation}
	// A model final answer/local report does not provide WRITE authority.
	if _, err = f.server.executeTaskWebDAV(context.Background(), f.session, f.task.ID, input, "model-answer-is-not-approval", false); err == nil || dav.requests() != "" {
		t.Fatal("model answer authorized delivery")
	}
	receipt, err := f.server.executeTaskWebDAV(context.Background(), f.session, f.task.ID, input, "PUBLIC-explicit-egress", false)
	if err != nil || receipt.State != "CONTENT_PRESENT" || receipt.SHA256 != attachment.SHA256 || receipt.AuthorshipProven || dav.requests() != "PUT,GET" {
		t.Fatalf("exact report delivery: %+v %v", receipt, err)
	}
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	original, err := reopened.TaskWebDAVResult(f.session, f.task.ID, input.OperationID)
	if err != nil || original != receipt || dav.requests() != "PUT,GET" {
		t.Fatal("read-only result reopened new remote work")
	}
	// CAS handoff invalidates materialization of the old report, not its history.
	if _, err = reopened.HandoffTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, "PUBLIC-human"); err != nil {
		t.Fatal(err)
	}
	if _, err = reopened.AddTaskModelReportAttachment(f.session, f.task.ConversationID, f.task.ID, r.RunID); err == nil {
		t.Fatal("old holder reused pre-handoff report")
	}
}

func TestP08PagesReportHTTPExactSourceAndRejectMixedContent(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	p08PagesModel(t, f, nil)
	r := p08PageRequest(f, pages.pages)
	if _, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r); err != nil {
		t.Fatal(err)
	}
	for _, mixed := range []bool{false, true} {
		body := map[string]string{"taskId": f.task.ID, "runId": r.RunID}
		if mixed {
			body["contentBase64"] = "ZmFrZQ"
		}
		raw, _ := json.Marshal(body)
		request := httptest.NewRequest(http.MethodPost, "/api/conversations/"+f.task.ConversationID+"/attachments", strings.NewReader(string(raw)))
		request.SetPathValue("id", f.task.ConversationID)
		response := httptest.NewRecorder()
		f.server.handleAttachmentCreate(response, request, f.session)
		want := http.StatusCreated
		if mixed {
			want = http.StatusBadRequest
		}
		if response.Code != want {
			t.Fatalf("materialize endpoint: %d %s", response.Code, response.Body.String())
		}
	}
}

func TestP08PagesHumanHandoffContinuesOriginalTask(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	calls := p08PagesModel(t, f, nil)
	first := p08PageRequest(f, pages.pages)
	before, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, first)
	if err != nil {
		t.Fatal(err)
	}
	next, err := f.server.store.HandoffTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, "PUBLIC-human")
	if err != nil {
		t.Fatal(err)
	}
	human := f.session
	human.DeviceID = next.Holder
	human.ID = "PUBLIC-human-session"
	revised := first
	revised.RunID = "PUBLIC-human-revised-run"
	revised.TaskRevision = next.Revision
	revised.Generation = next.Generation
	revised.Prompt = "Human revision: compare only supported claims and keep missing page C explicit."
	after, err := f.server.runTaskModel(context.Background(), human, f.task.ID, revised)
	if err != nil || after.TaskID != before.TaskID || after.ID == before.ID || after.Generation != next.Generation || after.Status != "COMPLETED" || calls.Load() != 2 {
		t.Fatalf("human continuation: %+v %v", after, err)
	}
	if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, first); err == nil || calls.Load() != 2 {
		t.Fatal("previous holder resumed provider work")
	}
}

// An official upstream is real; the page source, model and approval operands
// here are PUBLIC synthetic fixtures, never real Browser/Native qualification.
func TestP08PagesOfficialExactReportDelivery(t *testing.T) {
	connection := os.Getenv("P08_WEBDAV_CONNECTION_FILE")
	if connection == "" {
		t.Skip("explicit isolated official upstream connection not supplied")
	}
	stat, err := os.Stat(connection)
	if err != nil || stat.Mode().Perm() != 0600 {
		t.Fatal("private PUBLIC connection required")
	}
	var c struct{ URL, Username, Password string }
	raw, err := os.ReadFile(connection)
	if err != nil || json.Unmarshal(raw, &c) != nil {
		t.Fatal("invalid connection")
	}
	u, err := url.Parse(c.URL)
	if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
		t.Fatal("isolated numeric loopback required")
	}
	f := newP08ModelFixture(t)
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	p08PagesModel(t, f, nil)
	r := p08PageRequest(f, pages.pages)
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
	if err != nil {
		t.Fatal(err)
	}
	attachment, err := f.server.store.AddTaskModelReportAttachment(f.session, f.task.ConversationID, f.task.ID, r.RunID)
	if err != nil {
		t.Fatal(err)
	}
	cfg := TaskWebDAVConfig{ProfileID: "PUBLIC-official-golden-report", Origin: strings.TrimRight(c.URL, "/"), User: c.Username, Password: c.Password, Root: "/", Object: randomID("p08-golden-report") + ".json", MaxBytes: 256 << 10, PublicLoopback: true}
	source := &p08WebDAVAuthority{}
	prepared, err := PrepareOriginalTaskWebDAVRuntime(source, []TaskWebDAVConfig{cfg})
	if err != nil {
		t.Fatal(err)
	}
	f.server.webDAV = prepared
	receipt, err := f.server.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: "PUBLIC-original-golden-report", ResourceID: attachment.ID, DestinationID: cfg.ProfileID, TaskRevision: f.task.Revision, Generation: f.task.Generation}, "PUBLIC-explicit-egress", false)
	if err != nil || receipt.State != "CONTENT_PRESENT" || receipt.SHA256 != attachment.SHA256 || receipt.AuthorshipProven {
		t.Fatalf("official report: %+v %v", receipt, err)
	}
	request, err := http.NewRequest(http.MethodGet, strings.TrimRight(c.URL, "/")+"/"+cfg.Object, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.SetBasicAuth(c.Username, c.Password)
	client := &http.Client{Timeout: 10 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal("independent GET failed")
	}
	defer response.Body.Close()
	actual, err := io.ReadAll(io.LimitReader(response.Body, 256<<10))
	expected, _ := json.Marshal(view)
	if err != nil || response.StatusCode != 200 || !bytes.Equal(actual, expected) {
		t.Fatal("upstream report differs from exact original result")
	}
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	original, err := reopened.TaskWebDAVResult(f.session, f.task.ID, "PUBLIC-original-golden-report")
	if err != nil || original != receipt {
		t.Fatal("original receipt not preserved")
	}
	t.Logf("official isolated upstream report %s bytes=%d sha256=%s; original result reopened read-only; model/approval PUBLIC synthetic", cfg.Object, len(actual), receipt.SHA256)
}

func TestP08PagesOriginalByteEncodingAndTaskBinding(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	// Use P05-style unescaped HTML and whitespace, whose exact original hash
	// would change if json.RawMessage were compacted/escaped during checkpoint.
	pages.pages[0].Content = bytes.ReplaceAll(pages.pages[0].Content, []byte(`\u003c\u0026\u003e`), []byte(`<&>`))
	pages.pages[0].Content = append([]byte("\n "), pages.pages[0].Content...)
	sum := sha512.Sum512(pages.pages[0].Content)
	sum3 := sha3.Sum512(pages.pages[0].Content)
	pages.pages[0].Bytes = len(pages.pages[0].Content)
	pages.pages[0].Reference.Version = hex.EncodeToString(sum[:])
	pages.pages[0].SHA3_512 = hex.EncodeToString(sum3[:])
	calls := p08PagesModel(t, f, nil)
	r := p08PageRequest(f, pages.pages)
	view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r)
	if err != nil || view.Status != "COMPLETED" || calls.Load() != 1 {
		t.Fatalf("original byte encoding changed: %+v %v", view, err)
	}
	// Another task/preparation label cannot relabel the original Browser bytes.
	pages.pages[0].TaskID = "PUBLIC-preparation-not-real-task"
	r.RunID = "PUBLIC-relabel-attempt"
	if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, r); err == nil || calls.Load() != 1 {
		t.Fatal("local preparation ID was treated as real task authority")
	}
}
func TestP08PagesProviderQuotaHasNoFabricatedReport(t *testing.T) {
	f := newP08ModelFixture(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"PUBLIC synthetic quota exhausted"}}`))
	})
	pages := &p08PagesFixture{pages: p08Pages(f.task.ID)}
	f.server.taskPages = pages
	r := p08PageRequest(f, pages.pages)
	raw, _ := json.Marshal(r)
	request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/runs", bytes.NewReader(raw))
	request.SetPathValue("id", f.task.ID)
	out := httptest.NewRecorder()
	f.server.handleTaskModelRun(out, request, f.session)
	if out.Code != http.StatusTooManyRequests || strings.Contains(out.Body.String(), `"content"`) || f.requests.Load() != 1 {
		t.Fatalf("quota fabricated success: %d %s", out.Code, out.Body.String())
	}
	if _, err := f.server.store.AddTaskModelReportAttachment(f.session, f.task.ConversationID, f.task.ID, r.RunID); err == nil {
		t.Fatal("quota failure became a report attachment")
	}
	if _, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, r); err == nil || f.requests.Load() != 1 {
		t.Fatal("unconfirmed model run automatically retried provider")
	}
}

type p08PagesComposition struct {
	*p08RuntimeAuthorityFixture
	*p08PagesFixture
}

func TestP08PagesOriginalPreparedServerConsumption(t *testing.T) {
	f := newP08ModelFixture(t)
	calls := p08PagesModel(t, f, nil)
	owner := &p08PagesComposition{&p08RuntimeAuthorityFixture{}, &p08PagesFixture{pages: p08Pages(f.task.ID)}}
	prepared, err := PrepareOriginalTaskRuntime(context.Background(), f.server.taskModel, owner)
	if err != nil {
		t.Fatal(err)
	}
	server, err := prepared.OpenOriginal(context.Background(), Config{GatewayURL: "http://127.0.0.1:6429", GatewayKey: "PUBLIC-normal-key", ExactWalletCallback: "ynxai://wallet-auth/callback"}, func() (*Store, error) { return f.server.store, nil }, nil)
	if err != nil {
		t.Fatal(err)
	}
	r := p08PageRequest(f, owner.pages)
	raw, _ := json.Marshal(r)
	request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/runs", bytes.NewReader(raw))
	request.SetPathValue("id", f.task.ID)
	response := httptest.NewRecorder()
	server.handleTaskModelRun(response, request, f.session)
	if response.Code != 200 || owner.calls < 4 || owner.disclosures != 2 || calls.Load() != 1 || server.cfg.AllowLocalFixtureAuth {
		t.Fatalf("normal prepared consumer: %d %s pageCalls=%d disclosures=%d", response.Code, response.Body.String(), owner.calls, owner.disclosures)
	}
}
