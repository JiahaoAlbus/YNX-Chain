package aiproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

func p08NativeReadout(t *testing.T, name string) ([]byte, []TaskPageReference) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata/browser-readout", name))
	if err != nil {
		t.Fatal(err)
	}
	expected := map[string]string{"public-three-pages-readout.json": "2821ee8ff8c7f9390277b46db54e02a33fd54b59593ef132661addc6f0dee28c", "public-navigation-stale-readout.json": "346d7a27954c12c991e2559314aeb3e056511d9b7d18c2d0d04000db873cc49e"}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expected[name] {
		t.Fatal("original P05 public fixture changed")
	}
	var d struct {
		Pages []struct {
			Reference TaskPageReference `json:"reference"`
		} `json:"pages"`
	}
	if json.Unmarshal(raw, &d) != nil {
		t.Fatal("invalid original fixture")
	}
	refs := make([]TaskPageReference, len(d.Pages))
	for i := range refs {
		refs[i] = d.Pages[i].Reference
	}
	return raw, refs
}
func TestP08NativePageOriginalSwiftReadoutAndClassification(t *testing.T) {
	for _, name := range []string{"public-three-pages-readout.json", "public-navigation-stale-readout.json"} {
		t.Run(name, func(t *testing.T) {
			raw, refs := p08NativeReadout(t, name)
			pages, err := decodeOriginalBrowserPageReadout("PUBLIC-actual-ai-task", refs, raw)
			if err != nil || len(pages) != 3 {
				t.Fatalf("original Swift readout: %v", err)
			}
			available := 0
			for _, p := range pages {
				if p.TaskID != "PUBLIC-actual-ai-task" || p.PreparationID != "browser-local:PUBLIC-COMPARE-20261101" || p.SourceClass != taskBrowserPageSourceClass || p.ContentTrust != taskPageContentTrust {
					t.Fatal("source/task identity or trust changed")
				}
				if p.State == "AVAILABLE" {
					available++
					if _, err := taskPageContent(p); err != nil {
						t.Fatal(err)
					}
				} else if len(p.Content) != 0 {
					t.Fatal("missing page contained bytes")
				}
			}
			if name == "public-three-pages-readout.json" && available != 3 || name == "public-navigation-stale-readout.json" && available != 2 {
				t.Fatal("missing-page result changed")
			}
		})
	}
}
func TestP08NativePageRejectsReadoutExpansionAndSubstitution(t *testing.T) {
	original, refs := p08NativeReadout(t, "public-three-pages-readout.json")
	for _, kind := range []string{"unknown", "duplicate", "profile", "tab", "version", "bytes", "snapshot", "state", "missing-content", "excess-size"} {
		t.Run(kind, func(t *testing.T) {
			var d map[string]any
			_ = json.Unmarshal(original, &d)
			pages := d["pages"].([]any)
			p := pages[0].(map[string]any)
			switch kind {
			case "unknown":
				d["qualified"] = true
			case "duplicate":
				forged := append([]byte(`{"schema":"forged",`), original[1:]...)
				if _, err := decodeOriginalBrowserPageReadout("PUBLIC-task", refs, forged); err == nil {
					t.Fatal("duplicate schema accepted")
				}
				return
			case "profile":
				p["profileId"] = "private"
			case "tab":
				pages[1].(map[string]any)["tabId"] = p["tabId"]
			case "version":
				p["reference"].(map[string]any)["version"] = strings.Repeat("a", 128)
			case "bytes":
				p["bytes"] = 1
			case "snapshot":
				p["snapshotUTF8"] = strings.Replace(p["snapshotUTF8"].(string), "PUBLIC", "replacement", 1)
			case "state":
				p["state"] = "STALE"
			case "missing-content":
				delete(p, "snapshotUTF8")
			case "excess-size":
				p["snapshotUTF8"] = strings.Repeat("x", 256<<10)
			}
			raw, _ := json.Marshal(d)
			if _, err := decodeOriginalBrowserPageReadout("PUBLIC-task", refs, raw); err == nil {
				t.Fatal("substituted readout accepted")
			}
		})
	}
}

type p08NativePageSource struct {
	endpoint   *taskCallerEndpoint
	calls      atomic.Int32
	revoked    atomic.Bool
	partialErr error
}

func (s *p08NativePageSource) Current(ctx context.Context) error {
	if s.revoked.Load() {
		return errors.New("PUBLIC original Source retired")
	}
	return s.endpoint.Current(ctx)
}
func (s *p08NativePageSource) ReadOriginalBrowserPageReadout(ctx context.Context, raw []byte) ([]byte, error) {
	s.calls.Add(1)
	response, err := s.endpoint.Call(ctx, "POST", "/public-effect", "application/json", raw)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != 200 {
		return response.Body, errors.New("PUBLIC protected readout refused")
	}
	if s.partialErr != nil {
		return response.Body, s.partialErr
	}
	return response.Body, nil
}

type p08NativePageAdapter struct{ source *p08NativePageSource }

func (a p08NativePageAdapter) ReadOriginalTaskPages(ctx context.Context, in OriginalTaskPagesRequest) ([]TaskPageSnapshot, error) {
	return readOriginalNativeTaskPages(ctx, a.source, in)
}
func p08NativePageEndpoint(t *testing.T, f *p08ModelFixture, raw []byte, hook func()) *p08NativePageSource {
	t.Helper()
	registration := p08CallerEndpointRegistration(t)
	source := &p08NativePageSource{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		caller, err := link.LocalCallerFromRequest(r)
		if err != nil {
			t.Error(err)
			w.WriteHeader(403)
			return
		}
		material, err := caller.Current(r.Context())
		if err != nil {
			t.Error(err)
			w.WriteHeader(403)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || !bytes.Equal(body, material.RequestBody) {
			t.Error("original request DATA changed")
			w.WriteHeader(403)
			return
		}
		var in originalTaskPageReadRequest
		if strictToolJSON(bytes.NewReader(body), &in) != nil || in.Schema != "YNX_AI_BROWSER_PAGE_READ_REQUEST_V1" || !toolOperationID.MatchString(in.RunID) || in.Session.ID != f.session.ID || in.Session.Account != f.task.Account || in.Session.DeviceID != f.task.Holder || in.Task.ID != f.task.ID || in.Task.Revision != f.task.Revision || in.Task.Generation != f.task.Generation || !in.QueryOriginal && in.AuthorizationRef != "isolated-approved-reference" || bytes.Contains(body, []byte("never-send-original-token-hash")) {
			t.Error("original task/session/revision or private fields changed")
			w.WriteHeader(403)
			return
		}
		if hook != nil {
			hook()
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
	})
	endpoint, err := openTaskCallerEndpoint(context.Background(), registration, handler)
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, endpoint)
	source.endpoint = endpoint
	return source
}
func TestP08NativePageActualLINKToolLoopAndOriginalSourceVersions(t *testing.T) {
	f := newP08ModelFixture(t)
	raw, refs := p08NativeReadout(t, "public-three-pages-readout.json")
	f.session.TokenHash = "never-send-original-token-hash"
	source := p08NativePageEndpoint(t, f, raw, nil)
	f.server.taskPages = p08NativePageAdapter{source}
	request := f.request()
	request.SelectedPages = refs
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
		t.Fatalf("original model tool proposal: %+v %v", pending, err)
	}
	f.approveStep(t, pending.Steps[0])
	f.expected.StepID = pending.Steps[0]
	f.server.toolEffects.(*p08EffectFixture).expected = f.expected
	request.Resume = true
	result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || result.Status != "COMPLETED" || len(result.Sources) != 3 || f.requests.Load() != 2 || source.calls.Load() < 6 {
		t.Fatalf("real IPC/tool loop: %+v %v calls=%d", result, err, source.calls.Load())
	}
	for _, p := range result.Sources {
		if p.SourceClass != taskBrowserPageSourceClass || p.ContentTrust != taskPageContentTrust || p.PreparationID == p.TaskID {
			t.Fatal("source identity/classification lost")
		}
	}
	before := source.calls.Load()
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	reopened.mu.Lock()
	view, err := reopened.taskRunViewLocked(reopened.state.TaskRuns[result.ID])
	reopened.mu.Unlock()
	if err != nil || view.Content != result.Content || source.calls.Load() != before {
		t.Fatal("read-only reopen replayed original Source")
	}
	t.Logf("PUBLIC synthetic qualification/provider only; real LINK Unix UID=%d PID=%d original calls=%d; actual selected-source factory remains NOT_SUPPLIED", os.Geteuid(), os.Getpid(), source.calls.Load())
}
func TestP08NativePagePartialOrLateRevokeDropsAllBytes(t *testing.T) {
	for _, kind := range []string{"partial-error", "retired-during-read", "cancelled"} {
		t.Run(kind, func(t *testing.T) {
			f := newP08ModelFixture(t)
			raw, refs := p08NativeReadout(t, "public-three-pages-readout.json")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var source *p08NativePageSource
			source = p08NativePageEndpoint(t, f, raw, func() {
				if kind == "retired-during-read" {
					source.revoked.Store(true)
				}
				if kind == "cancelled" {
					cancel()
				}
			})
			if kind == "partial-error" {
				source.partialErr = errors.New("PUBLIC original read failed after response")
			}
			out, err := readOriginalNativeTaskPages(ctx, source, OriginalTaskPagesRequest{Session: f.session, Task: f.task, RunID: "PUBLIC-original-read", References: refs, AuthorizationRef: "isolated-approved-reference"})
			if err == nil || len(out) != 0 || source.calls.Load() != 1 {
				t.Fatalf("partial/late read escaped %+v %v", out, err)
			}
		})
	}
}
func TestP08NativePageNormalMissingCalleeIsExplicit(t *testing.T) {
	owner := &nativeTaskRuntimeAuthority{}
	if pages, err := owner.ReadOriginalTaskPages(context.Background(), OriginalTaskPagesRequest{}); len(pages) != 0 || !errors.Is(err, ErrTaskPagesSourceNotSupplied) || !errors.Is(err, errTaskEffectSourceUnavailable) {
		t.Fatalf("missing callee was not explicit: %+v %v", pages, err)
	}
	f := newP08ModelFixture(t)
	f.server.taskPages = owner
	request := f.request()
	_, refs := p08NativeReadout(t, "public-three-pages-readout.json")
	request.SelectedPages = refs
	body, _ := json.Marshal(request)
	r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/runs", bytes.NewReader(body))
	r.SetPathValue("id", f.task.ID)
	w := httptest.NewRecorder()
	f.server.handleTaskModelRun(w, r, f.session)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "AI_BROWSER_PROTECTED_PAGE_READER_NOT_SUPPLIED") || f.requests.Load() != 0 {
		t.Fatalf("missing source reached model: %d %s", w.Code, w.Body.String())
	}
}

func TestP08NativePageLegacyEncryptedLabelsKeepOriginalComparison(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08PagesFixture{pages: pages}
	f.server.taskPages = source
	input := p08PageRequest(f, pages)
	input.preparedPages = pages
	run, _, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	cipher := run.PagesCipher
	if err = f.server.checkTaskRunPages(context.Background(), f.session, run, input.AuthorizationRef); err != nil {
		t.Fatalf("new labels invalidated original encrypted snapshot: %v", err)
	}
	f.server.store.mu.Lock()
	original, err := f.server.store.taskRunPagesLocked(run)
	unchanged := f.server.store.state.TaskRuns[run.ID].PagesCipher == cipher
	f.server.store.mu.Unlock()
	if err != nil || !unchanged || original[0].SourceClass != "" || original[0].ContentTrust != "" || original[0].PreparationID != "" {
		t.Fatal("original encrypted source labels were rewritten")
	}
	raw, _ := json.Marshal(original)
	if bytes.Contains(raw, []byte("sourceClass")) || bytes.Contains(raw, []byte("contentTrust")) {
		t.Fatal("legacy canonical report fields changed")
	}
}

func TestP08NativePageHumanReportOriginalRecoveryJourney(t *testing.T) {
	f := newP08ModelFixture(t)
	raw, refs := p08NativeReadout(t, "public-three-pages-readout.json")
	source := p08NativePageEndpoint(t, f, raw, nil)
	f.server.taskPages = p08NativePageAdapter{source}
	var modelCalls atomic.Int32
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/status" {
			_, _ = w.Write([]byte(`{"chainId":6423,"height":23,"network":"isolated","nativeCurrencySymbol":"YNXT"}`))
			return
		}
		modelCalls.Add(1)
		var body struct {
			Messages []struct {
				Role, Content string
				ToolCallID    string `json:"tool_call_id"`
			}
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.Messages) == 0 {
			t.Error("model request missing")
			w.WriteHeader(400)
			return
		}
		last := body.Messages[len(body.Messages)-1]
		if last.Role != "tool" {
			if !strings.Contains(last.Content, taskBrowserPageSourceClass) || !strings.Contains(last.Content, taskPageContentTrust) {
				t.Error("source classes lost")
			}
			args, _ := json.Marshal(conversationToolInput{ConversationID: f.task.ConversationID})
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "tool_calls", "message": map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "PUBLIC-original-comparison-call", "type": "function", "function": map[string]any{"name": "ynx_conversation_read_v1", "arguments": string(args)}}}}}}})
			return
		}
		if !strings.Contains(last.Content, "actual selected source body") {
			t.Error("actual tool read result lost")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "PUBLIC synthetic provider comparison returned after original selected-source and tool read."}}}})
	}))
	defer model.Close()
	service, err := NewTaskModelService(TaskModelConfig{ChainURL: model.URL, ProviderURL: model.URL, ProviderAPIKey: "PUBLIC-provider", Model: "PUBLIC-same-fixed-model", AccessAPIKey: "PUBLIC-gateway", UpstreamKey: "PUBLIC-upstream"})
	if err != nil {
		t.Fatal(err)
	}
	f.server.taskModel = service
	run := func(id, prompt string) taskRunView {
		t.Helper()
		request := f.request()
		request.RunID = id
		request.Prompt = prompt
		request.TaskRevision = f.task.Revision
		request.Generation = f.task.Generation
		request.SelectedPages = refs
		pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
		if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 {
			t.Fatalf("original proposal: %+v %v", pending, err)
		}
		f.expected.StepID = pending.Steps[0]
		f.approveStep(t, pending.Steps[0])
		f.server.toolEffects = &p08EffectFixture{store: f.server.store, expected: f.expected}
		request.Resume = true
		final, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
		if err != nil || final.Status != "COMPLETED" {
			t.Fatalf("actual original tool loop: %+v %v", final, err)
		}
		return final
	}
	first := run("PUBLIC-agent-comparison", "Compare approved original page versions.")
	previousSession := f.session
	next, err := f.server.store.HandoffTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, "PUBLIC-human-holder")
	if err != nil {
		t.Fatal(err)
	}
	f.task = next
	f.session.ID = "PUBLIC-human-session"
	f.session.DeviceID = next.Holder
	f.expected.Holder = next.Holder
	f.expected.Generation = next.Generation
	f.expected.TaskRevision = next.Revision
	final := run("PUBLIC-human-revision", "Human revision of the original task: retain source versions and distinguish untrusted page content.")
	if final.TaskID != first.TaskID || final.Generation == first.Generation || modelCalls.Load() != 4 {
		t.Fatal("handoff created another task or changed fixed model")
	}
	report, err := f.server.store.AddTaskModelReportAttachment(f.session, f.task.ConversationID, f.task.ID, final.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.server.store.AddTaskModelReportAttachment(previousSession, f.task.ConversationID, f.task.ID, first.ID); err == nil {
		t.Fatal("old holder materialized obsolete report")
	}
	dav := newP08DAVFixture(t)
	dav.cfg.MaxBytes = 256 << 10
	dav.lostACK = true
	authority := &p08WebDAVAuthority{}
	prepared, err := PrepareOriginalTaskWebDAVRuntime(authority, []TaskWebDAVConfig{dav.cfg})
	if err != nil {
		t.Fatal(err)
	}
	f.server.webDAV = prepared
	input := TaskWebDAVInput{OperationID: "PUBLIC-human-approved-exact-report", ResourceID: report.ID, DestinationID: dav.cfg.ProfileID, TaskRevision: f.task.Revision, Generation: f.task.Generation}
	if _, err = f.server.executeTaskWebDAV(context.Background(), f.session, f.task.ID, input, "model-text-is-not-report-approval", false); err == nil || dav.requests() != "" {
		t.Fatal("model text authorized PUT")
	}
	unknown, err := f.server.executeTaskWebDAV(context.Background(), f.session, f.task.ID, input, "PUBLIC-explicit-egress", false)
	if err == nil || unknown.State != "UNKNOWN" || dav.requests() != "PUT" {
		t.Fatalf("lost acknowledgement promoted: %+v %v", unknown, err)
	}
	sourceCalls := source.calls.Load()
	request := f.request()
	request.RunID = "PUBLIC-no-replacement-work"
	request.SelectedPages = refs
	if _, err = f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, errTaskEffectUnresolved) || source.calls.Load() != sourceCalls || modelCalls.Load() != 4 {
		t.Fatalf("UNKNOWN scheduled replacement source/model: %v", err)
	}
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	recovered := &Server{store: reopened, webDAV: prepared}
	receipt, err := recovered.executeTaskWebDAV(context.Background(), f.session, f.task.ID, TaskWebDAVInput{OperationID: input.OperationID}, "PUBLIC-explicit-egress", true)
	if err != nil || receipt.State != "CONTENT_PRESENT" || receipt.SHA256 != report.SHA256 || receipt.AuthorshipProven || dav.requests() != "PUT,GET" {
		t.Fatalf("original report recovery: %+v %v", receipt, err)
	}
	got, err := reopened.TaskWebDAVResult(f.session, f.task.ID, input.OperationID)
	if err != nil || got != receipt || dav.requests() != "PUT,GET" || source.calls.Load() != sourceCalls {
		t.Fatal("read-only receipt replayed work")
	}
	if _, err = reopened.CompleteTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, final.ID); err != nil {
		t.Fatalf("recovered original workflow could not close: %v", err)
	}
	t.Logf("PUBLIC source/approval/model only; real LINK+owned Store+HTTP model-tool-loop+synthetic DAV fault path; same task=%s original op=%s sha256=%s calls=PUT,GET; no real Native approval/provider qualification", f.task.ID, input.OperationID, receipt.SHA256)
}
