package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type p08BlockingPageRead struct {
	pages              []TaskPageSnapshot
	started            chan context.Context
	release            chan struct{}
	ignoreCancellation bool
	calls              atomic.Int32
}

func (p *p08BlockingPageRead) ReadOriginalTaskPages(ctx context.Context, in OriginalTaskPagesRequest) ([]TaskPageSnapshot, error) {
	p.calls.Add(1)
	p.started <- ctx
	if p.ignoreCancellation {
		<-p.release
		return p.pages, nil
	}
	<-ctx.Done()
	return p.pages, ctx.Err() // deliberate partial DATA alongside failure
}
func p08AwaitPageRead(t *testing.T, p *p08BlockingPageRead) context.Context {
	t.Helper()
	select {
	case ctx := <-p.started:
		return ctx
	case <-time.After(3 * time.Second):
		t.Fatal("original Source reader did not enter")
		return nil
	}
}
func p08AwaitPageError(t *testing.T, done <-chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(3 * time.Second):
		t.Fatal("owned Source reader did not stop")
		return nil
	}
}
func p08CancelCurrentTask(t *testing.T, f *p08ModelFixture) {
	t.Helper()
	raw, _ := json.Marshal(map[string]uint64{"revision": f.task.Revision, "generation": f.task.Generation})
	r := httptest.NewRequest(http.MethodPost, "/api/tasks/"+f.task.ID+"/cancel", bytes.NewReader(raw))
	r.SetPathValue("id", f.task.ID)
	w := httptest.NewRecorder()
	f.server.handleTaskCancel(w, r, f.session)
	if w.Code != 200 {
		t.Fatalf("normal cancel handler: %d %s", w.Code, w.Body.String())
	}
}
func p08AssertNoPageWork(t *testing.T, f *p08ModelFixture) {
	t.Helper()
	f.server.mu.Lock()
	active := len(f.server.taskPageReads)
	f.server.mu.Unlock()
	if active != 0 || f.requests.Load() != 0 || len(f.server.store.state.TaskRuns) != 0 {
		t.Fatal("cancelled read leaked an active capture, model call or run")
	}
	raw, err := os.ReadFile(f.server.store.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("Synthetic comparison input")) {
		t.Fatal("unaccepted source bytes reached durable state")
	}
}
func TestP08PageReadLifecycleCancelInitialReadThroughNormalHandler(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08BlockingPageRead{pages: pages, started: make(chan context.Context, 1)}
	f.server.taskPages = source
	done := make(chan error, 1)
	go func() {
		_, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, p08PageRequest(f, pages))
		done <- err
	}()
	ctx := p08AwaitPageRead(t, source)
	deadline, ok := ctx.Deadline()
	if !ok || time.Until(deadline) > taskPageReadTimeout {
		t.Fatal("source acquisition has no bounded lifetime")
	}
	p08CancelCurrentTask(t, f)
	if err := p08AwaitPageError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatalf("original cancellation not propagated: %v", err)
	}
	if ctx.Err() == nil {
		t.Fatal("source still owns live caller context")
	}
	p08AssertNoPageWork(t, f)
}
func TestP08PageReadLifecycleConcurrentSameRunBothCancelled(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08BlockingPageRead{pages: pages, started: make(chan context.Context, 2)}
	f.server.taskPages = source
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, p08PageRequest(f, pages))
			done <- err
		}()
	}
	one, two := p08AwaitPageRead(t, source), p08AwaitPageRead(t, source)
	p08CancelCurrentTask(t, f)
	for i := 0; i < 2; i++ {
		if err := p08AwaitPageError(t, done); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	}
	if one.Err() == nil || two.Err() == nil || source.calls.Load() != 2 {
		t.Fatal("same-run cancellation lost an admitted read")
	}
	p08AssertNoPageWork(t, f)
}
func TestP08PageReadLifecycleLateHandoffResultRejected(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08BlockingPageRead{pages: pages, started: make(chan context.Context, 1), release: make(chan struct{}), ignoreCancellation: true}
	f.server.taskPages = source
	done := make(chan error, 1)
	go func() {
		_, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, p08PageRequest(f, pages))
		done <- err
	}()
	p08AwaitPageRead(t, source)
	if _, err := f.server.store.HandoffTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, "PUBLIC-human"); err != nil {
		t.Fatal(err)
	}
	// Even an original producer that finishes late without respecting ctx must
	// not return usable bytes after the actual task CAS changed the holder.
	close(source.release)
	if err := p08AwaitPageError(t, done); !errors.Is(err, errToolConflict) {
		t.Fatalf("late handoff bytes accepted: %v", err)
	}
	p08AssertNoPageWork(t, f)
}
func TestP08PageReadLifecycleOtherPrincipalCannotCancelOwnerRead(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08BlockingPageRead{pages: pages, started: make(chan context.Context, 1)}
	f.server.taskPages = source
	done := make(chan error, 1)
	go func() {
		_, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, p08PageRequest(f, pages))
		done <- err
	}()
	ctx := p08AwaitPageRead(t, source)
	f.server.cancelTaskModelRuns("PUBLIC-another-account", f.task.ID)
	if ctx.Err() != nil {
		t.Fatal("foreign principal cancelled an owned read")
	}
	p08CancelCurrentTask(t, f)
	if err := p08AwaitPageError(t, done); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	p08AssertNoPageWork(t, f)
}
func TestP08PageReadLifecyclePreexistingTaskChangeNeverCallsSource(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08PagesFixture{pages: pages}
	f.server.taskPages = source
	if _, err := f.server.store.CancelTask(f.task.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder); err != nil {
		t.Fatal(err)
	}
	_, err := f.server.readTaskPages(context.Background(), f.session, f.task, []TaskPageReference{pages[0].Reference}, "PUBLIC-proof", "PUBLIC-original-run")
	if err == nil || source.calls != 0 {
		t.Fatal("stale task opened a Source read")
	}
	p08AssertNoPageWork(t, f)
}
func TestP08PageReadLifecycleShortCallerDeadlinePreserved(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08BlockingPageRead{pages: pages, started: make(chan context.Context, 1)}
	f.server.taskPages = source
	parent, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := f.server.runTaskModel(parent, f.session, f.task.ID, p08PageRequest(f, pages))
		done <- err
	}()
	ctx := p08AwaitPageRead(t, source)
	parentDeadline, _ := parent.Deadline()
	deadline, ok := ctx.Deadline()
	if !ok || deadline.After(parentDeadline) {
		t.Fatal("page read extended original caller deadline")
	}
	if err := p08AwaitPageError(t, done); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("original timeout lost: %v", err)
	}
	p08AssertNoPageWork(t, f)
}
func TestP08PageReadLifecycleDurableSnapshotRevalidatesWholeBinding(t *testing.T) {
	for _, kind := range []string{"sha512", "sha3", "bytes", "preparation", "task", "trusted-class", "empty", "nonce", "dropped-cipher", "unknown-json", "missing-sha3", "missing-size", "bare-query-origin"} {
		t.Run(kind, func(t *testing.T) {
			f := newP08ModelFixture(t)
			pages := p08Pages(f.task.ID)
			input := p08PageRequest(f, pages)
			input.preparedPages = pages
			run, _, _, _, _, err := f.server.beginTaskRun(f.session, f.task.ID, input)
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "sha512":
				pages[0].Reference.Version = strings.Repeat("a", 128)
			case "sha3":
				pages[0].SHA3_512 = strings.Repeat("a", 128)
			case "bytes":
				pages[0].Bytes++
			case "missing-sha3":
				pages[2].SHA3_512 = ""
			case "missing-size":
				pages[2].Bytes = 0
			case "bare-query-origin":
				pages[2].Origin += "?"
			case "preparation":
				pages[0].PreparationID = "PUBLIC-another-preparation"
			case "task":
				pages[0].TaskID = "PUBLIC-another-task"
			case "trusted-class":
				pages[0].ContentTrust = "TRUSTED"
			case "empty":
				pages = nil
			case "nonce":
				run.PagesNonce = ""
			case "dropped-cipher":
				run.PagesCipher = ""
				run.PagesNonce = ""
			}
			if kind != "nonce" && kind != "dropped-cipher" {
				raw, _ := json.Marshal(pages)
				if kind == "unknown-json" {
					raw = bytes.Replace(raw, []byte(`"reference":`), []byte(`"qualified":true,"reference":`), 1)
				}
				run.PagesNonce, run.PagesCipher, err = f.server.store.encrypt(run.Account, run.TaskID, run.ID+":pages", string(raw))
				if err != nil {
					t.Fatal(err)
				}
			}
			f.server.store.mu.Lock()
			result, err := f.server.store.taskRunPagesLocked(run)
			f.server.store.mu.Unlock()
			if err == nil || len(result) != 0 {
				t.Fatalf("durable %s snapshot returned %d pages with error=%v", kind, len(result), err)
			}
		})
	}
}

type p08RecoveringPageRead struct {
	pages   []TaskPageSnapshot
	blocked atomic.Bool
	calls   atomic.Int32
}

func (p *p08RecoveringPageRead) ReadOriginalTaskPages(ctx context.Context, in OriginalTaskPagesRequest) ([]TaskPageSnapshot, error) {
	p.calls.Add(1)
	if p.blocked.Load() {
		return nil, errors.New("PUBLIC original Source temporarily unavailable")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	raw, _ := json.Marshal(p.pages)
	var out []TaskPageSnapshot
	_ = json.Unmarshal(raw, &out)
	return out, nil
}
func TestP08PageReadLifecycleColdReturnRecoveryNeverReplaysModel(t *testing.T) {
	f := newP08ModelFixture(t)
	pages := p08Pages(f.task.ID)
	source := &p08RecoveringPageRead{pages: pages}
	f.server.taskPages = source
	modelCalls := p08PagesModel(t, f, func() { source.blocked.Store(true) })
	request := p08PageRequest(f, pages)
	blocked, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, errTaskModelReturnBlocked) || blocked.Content != "" || modelCalls.Load() != 1 {
		t.Fatalf("private return did not block: status=%s contentBytes=%d err=%v", blocked.Status, len(blocked.Content), err)
	}
	original := f.server.store.state.TaskRuns[blocked.ID]
	if original.AnswerCipher == "" || original.PagesCipher == "" || original.ReturnState != taskModelReturnBlocked {
		t.Fatal("original private answer/source snapshot not retained")
	}
	reopened, err := NewStore(f.server.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	source.blocked.Store(false)
	server := &Server{store: reopened, taskPages: source, taskModel: f.server.taskModel, taskModelAdmit: f.server.taskModelAdmit, toolEffects: &p08EffectFixture{store: reopened, expected: f.expected}}
	recovered, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || recovered.Status != "COMPLETED" || recovered.Content == "" || len(recovered.Sources) != 3 || modelCalls.Load() != 1 {
		t.Fatalf("original return recovery: status=%s err=%v modelCalls=%d", recovered.Status, err, modelCalls.Load())
	}
	retained := reopened.state.TaskRuns[blocked.ID]
	if retained.AnswerCipher != original.AnswerCipher || retained.PagesCipher != original.PagesCipher || retained.PromptCipher != original.PromptCipher {
		t.Fatal("return recovery replaced original encrypted material")
	}
	calls := source.calls.Load()
	r := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/runs/"+request.RunID, nil)
	r.SetPathValue("id", f.task.ID)
	r.SetPathValue("runId", request.RunID)
	w := httptest.NewRecorder()
	server.handleTaskModelRunRead(w, r, f.session)
	if w.Code != 200 || source.calls.Load() != calls || modelCalls.Load() != 1 {
		t.Fatal("readonly reopened answer reentered a Source/model")
	}
}
