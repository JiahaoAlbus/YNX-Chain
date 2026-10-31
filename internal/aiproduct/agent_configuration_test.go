package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

func p08AgentConfigurationStore(t *testing.T) (*Store, []byte) {
	t.Helper()
	key := bytes.Repeat([]byte{108}, 32) // Isolated content encryption fixture.
	s, err := NewStore(filepath.Join(t.TempDir(), "state.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	return s, key
}

// Uses the parent's actual binding, preparation, proposal and resource handler.
// Only approval and the final Auth Source check below are isolated fixtures.
func p08AgentConfiguredReadFixture(t *testing.T) (*Store, TaskRecord, AgentConfiguration, taskReadExpectation) {
	t.Helper()
	store, _ := p08AgentConfigurationStore(t)
	configuration := p08CreateAgentConfiguration(t, store, "tenant-a")
	conversation, err := store.CreateConversation("tenant-a", "Configured source")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.AddMessage("tenant-a", conversation.ID, Message{Role: "user", Status: "complete", Content: "actual configured source body"}); err != nil {
		t.Fatal(err)
	}
	task, err := store.CreateTask("tenant-a", conversation.ID, "device")
	if err != nil {
		t.Fatal(err)
	}
	task, err = store.BindAgentConfiguration("tenant-a", task.ID, task.Revision, task.Generation, task.Holder, configuration.ID)
	if err != nil {
		t.Fatal(err)
	}
	task, err = store.PrepareTask("tenant-a", task.ID, task.Revision, task.Generation, task.Holder)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(conversationToolInput{ConversationID: conversation.ID})
	if err != nil {
		t.Fatal(err)
	}
	step, created, err := store.reserveToolStep(ProductSession{Account: task.Account, DeviceID: task.Holder, Scopes: []string{"ai:conversations"}}, task.ID, toolStepRequest{
		OperationID: "configured-original-read", TaskRevision: task.Revision, Generation: task.Generation, ToolID: "ai.conversation.read", ToolVersion: "1", Input: raw,
	})
	if err != nil || !created || step.Status != "NEEDS_APPROVAL" {
		t.Fatalf("configuration did not preserve separate approval: %+v %v", step, err)
	}
	if _, err := store.commitTaskApprovalAtFence(context.Background(), taskReadExpectation{Account: task.Account, TaskID: task.ID, StepID: step.ID, Holder: task.Holder, TaskRevision: task.Revision, Generation: task.Generation, Input: bindTaskBytes(raw), Fields: []string{"messages"}}, "isolated-grant-reference", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	return store, task, configuration, taskReadExpectation{Account: task.Account, TaskID: task.ID, StepID: step.ID, Holder: task.Holder, TaskRevision: task.Revision, Generation: task.Generation, Input: bindTaskBytes(raw), Fields: []string{"messages"}}
}

type p08AgentPausingEffectSource struct {
	store                            *Store
	expected                         taskReadExpectation
	configuration                    AgentConfiguration
	pauseBeforeRead                  bool
	dispatches, queries, finalChecks int
}

func (f *p08AgentPausingEffectSource) pause() error {
	_, err := f.store.ConfigureAgent(f.configuration.Account, f.configuration.ID, f.configuration.Revision, f.configuration.Name, f.configuration.ModelRef, f.configuration.ToolIDs, "paused")
	return err
}

func (f *p08AgentPausingEffectSource) dispatchTaskTool(ctx context.Context, call taskEffectCall, ref string) (taskReadReceipt, error) {
	f.dispatches++
	if ref != "isolated-approved-reference" || call.OriginalOperationID != f.expected.StepID {
		return taskReadReceipt{}, errors.New("isolated original authority binding denied")
	}
	if f.pauseBeforeRead {
		if err := f.pause(); err != nil {
			return taskReadReceipt{}, err
		}
	}
	receipt, err := f.store.commitTaskReadAtEffectFence(ctx, f.expected, func() error { f.finalChecks++; return nil })
	if err == nil && !f.pauseBeforeRead {
		err = f.pause()
	}
	return receipt, err
}

func (f *p08AgentPausingEffectSource) reconcileTaskTool(_ context.Context, call taskEffectCall, _ string) (taskReadReceipt, error) {
	f.queries++
	if call.OriginalOperationID != f.expected.StepID {
		return taskReadReceipt{}, errors.New("changed original reconciliation binding")
	}
	f.store.mu.Lock()
	defer f.store.mu.Unlock()
	return f.store.taskReadReceiptLocked(f.store.state.Actions[call.OriginalOperationID])
}

func TestP08AgentConfigurationIntegratedDispatchAndResourceFence(t *testing.T) {
	t.Run("paused_queue_never_reaches_source", func(t *testing.T) {
		store, task, configuration, expected := p08AgentConfiguredReadFixture(t)
		paused, err := store.ConfigureAgent(task.Account, configuration.ID, configuration.Revision, configuration.Name, configuration.ModelRef, configuration.ToolIDs, "paused")
		if err != nil {
			t.Fatal(err)
		}
		source := &p08EffectFixture{store: store, expected: expected}
		server := &Server{store: store, toolEffects: source}
		session := ProductSession{Account: task.Account, DeviceID: task.Holder}
		before, err := json.Marshal(store.state)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := server.dispatchApprovedStep(context.Background(), session, task.ID, expected.StepID, "isolated-approved-reference"); !errors.Is(err, ErrAgentConfigurationUnavailable) {
			t.Fatalf("paused queued step reached dispatch: %v", err)
		}
		after, err := json.Marshal(store.state)
		if err != nil || !bytes.Equal(before, after) || source.dispatches != 0 {
			t.Fatalf("blocked queue changed original operation or called Source: %v", err)
		}
		if _, err := store.ConfigureAgent(task.Account, configuration.ID, paused.Revision, configuration.Name, configuration.ModelRef, configuration.ToolIDs, "enabled"); err != nil {
			t.Fatal(err)
		}
		if _, err := server.dispatchApprovedStep(context.Background(), session, task.ID, expected.StepID, "isolated-approved-reference"); !errors.Is(err, ErrAgentConfigurationUnavailable) || source.dispatches != 0 {
			t.Fatalf("re-enable silently rebound queued task: %v", err)
		}
	})
	t.Run("pause_after_dispatch_before_resource_read", func(t *testing.T) {
		store, task, configuration, expected := p08AgentConfiguredReadFixture(t)
		source := &p08AgentPausingEffectSource{store: store, expected: expected, configuration: configuration, pauseBeforeRead: true}
		server := &Server{store: store, toolEffects: source}
		receipt, err := server.dispatchApprovedStep(context.Background(), ProductSession{Account: task.Account, DeviceID: task.Holder}, task.ID, expected.StepID, "isolated-approved-reference")
		if err == nil || len(receipt.Result) != 0 || source.dispatches != 1 || source.finalChecks != 0 {
			t.Fatalf("resource fence read after pause: %+v %v source=%+v", receipt, err, source)
		}
		step, found := store.Action(task.Account, expected.StepID)
		if !found || step.Status == "COMPLETED" || step.ToolStep.ResultCipher != "" || step.ToolStep.EffectFirstCause == "" {
			t.Fatalf("paused resource fabricated receipt or lost first cause: %+v", step)
		}
		_, reconcileErr := server.reconcileStep(context.Background(), ProductSession{Account: task.Account, DeviceID: task.Holder}, task.ID, expected.StepID, "isolated-approved-reference")
		if !errors.Is(reconcileErr, errTaskEffectUnresolved) || source.queries != 1 || source.dispatches != 1 || source.finalChecks != 0 {
			t.Fatalf("paused UNKNOWN was not query-only: %v queries=%d dispatches=%d", reconcileErr, source.queries, source.dispatches)
		}
		unresolved, _ := store.Action(task.Account, expected.StepID)
		if unresolved.Status != step.Status || unresolved.ToolStep.EffectFirstCause != step.ToolStep.EffectFirstCause || unresolved.ToolStep.RemoteOperationID != step.ToolStep.RemoteOperationID {
			t.Fatal("unresolved query replaced original status, operation or first cause")
		}
	})
}

func TestP08AgentConfigurationIntegratedModelBackupRestore(t *testing.T) {
	f := newP08ModelFixture(t)
	configuration := p08CreateAgentConfiguration(t, f.server.store, f.session.Account)
	bound, err := f.server.store.BindAgentConfiguration(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, configuration.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.task = bound
	f.expected.TaskRevision = bound.Revision
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || pending.Status != "NEEDS_APPROVAL" || len(pending.Steps) != 1 || f.requests.Load() != 1 {
		t.Fatalf("configured model skipped approval: %+v %v", pending, err)
	}
	step, ok := f.server.store.Action(f.session.Account, pending.Steps[0])
	if !ok || step.Status != "NEEDS_APPROVAL" {
		t.Fatal("original model proposal missing")
	}
	f.approveStep(t, step.ID)
	f.expected.StepID = step.ID
	backup := filepath.Join(t.TempDir(), "configured-pending.ynxbackup")
	if _, err := f.server.store.CreateBackup(backup); err != nil {
		t.Fatal(err)
	}
	restored, err := NewStore(filepath.Join(t.TempDir(), "restored.json"), f.key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restored.RestoreBackup(backup); err != nil {
		t.Fatal(err)
	}
	configured, err := restored.AgentConfiguration(f.session.Account, configuration.ID)
	if err != nil || !reflect.DeepEqual(configured, configuration) {
		t.Fatalf("backup lost configuration pin: %+v %v", configured, err)
	}
	source := &p08EffectFixture{store: restored, expected: f.expected}
	server := &Server{store: restored, taskModel: f.provider, toolEffects: source, taskModelAdmit: f.server.taskModelAdmit}
	request.Prompt, request.Resume = "", true
	result, err := server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || result.Status != "COMPLETED" || result.Content != "Final answer from the isolated HTTP provider." || source.dispatches != 1 || f.requests.Load() != 2 || f.admissions.Load() != 3 {
		t.Fatalf("configured restore did not complete real tool/provider flow: %+v %v source=%+v", result, err, source)
	}
	disk, err := os.ReadFile(restored.path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(disk, []byte("actual selected source body")) || bytes.Contains(disk, []byte(result.Content)) || len(restored.state.Permissions) != 0 {
		t.Fatal("configured flow exposed private content or minted a Grant")
	}
}

func TestP08AgentConfigurationIntegratedPauseAfterEffectBeforeDisclosure(t *testing.T) {
	f := newP08ModelFixture(t)
	configuration := p08CreateAgentConfiguration(t, f.server.store, f.session.Account)
	bound, err := f.server.store.BindAgentConfiguration(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, configuration.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.task, f.expected.TaskRevision = bound, bound.Revision
	request := f.request()
	pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if err != nil || len(pending.Steps) != 1 {
		t.Fatalf("pending setup failed: %+v %v", pending, err)
	}
	step, _ := f.server.store.Action(f.session.Account, pending.Steps[0])
	f.approveStep(t, step.ID)
	f.expected.StepID = step.ID
	source := &p08AgentPausingEffectSource{store: f.server.store, expected: f.expected, configuration: configuration}
	f.server.toolEffects = source
	request.Prompt, request.Resume = "", true
	result, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
	if !errors.Is(err, ErrAgentConfigurationUnavailable) || result.Status != "STOPPED" || result.Content != "" || source.dispatches != 1 || source.finalChecks != 1 || f.requests.Load() != 1 || f.admissions.Load() != 1 {
		t.Fatalf("pause leaked tool result to provider or invented final answer: %+v %v source=%+v", result, err, source)
	}
	completed, _ := f.server.store.Action(f.session.Account, step.ID)
	if completed.Status != "COMPLETED" || completed.ToolStep.ResultCipher == "" {
		t.Fatal("pause erased an already committed original effect")
	}
	recovered, err := f.server.reconcileStep(context.Background(), f.session, f.task.ID, step.ID, "isolated-approved-reference")
	// Already committed: reconcile returns the durable original receipt without
	// another Source query, whereas UNKNOWN above queries its original operation.
	if err != nil || recovered.EffectRef != step.ID || !bytes.Contains(recovered.Result, []byte("actual selected source body")) || source.queries != 0 || source.dispatches != 1 {
		t.Fatalf("pause prevented original reconciliation or redispatched effect: %+v %v", recovered, err)
	}
	paused, err := f.server.store.AgentConfiguration(f.session.Account, configuration.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.server.store.ConfigureAgent(f.session.Account, configuration.ID, paused.Revision, configuration.Name, configuration.ModelRef, configuration.ToolIDs, "enabled"); err != nil {
		t.Fatal(err)
	}
	if _, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request); !errors.Is(err, ErrAgentConfigurationUnavailable) || f.requests.Load() != 1 || source.dispatches != 1 {
		t.Fatalf("re-enable resumed stale configured model run: %v", err)
	}
}

func TestP08AgentConfigurationIntegratedInFlightPauseCommit(t *testing.T) {
	for _, mode := range []string{"committed_pause_cancels", "failed_pause_preserves_run"} {
		t.Run(mode, func(t *testing.T) {
			started, release := make(chan struct{}), make(chan struct{}, 1)
			f := newP08ModelFixture(t, func(w http.ResponseWriter, r *http.Request) {
				close(started)
				select {
				case <-r.Context().Done():
					return
				case <-release:
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
					"finish_reason": "stop", "message": map[string]string{"role": "assistant", "content": "Actual provider answer from the still-enabled configuration."},
				}}})
			})
			defer close(release)
			configuration := p08CreateAgentConfiguration(t, f.server.store, f.session.Account)
			bound, err := f.server.store.BindAgentConfiguration(f.session.Account, f.task.ID, f.task.Revision, f.task.Generation, f.task.Holder, configuration.ID)
			if err != nil {
				t.Fatal(err)
			}
			f.task = bound
			type outcome struct {
				view taskRunView
				err  error
			}
			done := make(chan outcome, 1)
			go func() {
				view, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, f.request())
				done <- outcome{view: view, err: err}
			}()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("configured HTTP model request did not start")
			}
			store := f.server.store
			store.mu.Lock()
			originalPath := store.path
			if mode == "failed_pause_preserves_run" {
				store.path = filepath.Join(originalPath, "not-a-directory.json")
			}
			store.mu.Unlock()
			body, err := json.Marshal(map[string]any{"expectedRevision": configuration.Revision, "name": configuration.Name, "modelRef": configuration.ModelRef, "toolIds": configuration.ToolIDs, "state": "paused"})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPatch, "/api/agents/"+configuration.ID, bytes.NewReader(body))
			request.SetPathValue("agentId", configuration.ID)
			response := httptest.NewRecorder()
			// Actual parent's handler, with the explicit isolated session fixture.
			// No HTTP path is added and no production admission is manufactured.
			f.server.handleAgentConfigurationWrite(response, request, f.session)
			store.mu.Lock()
			store.path = originalPath
			store.mu.Unlock()
			current, err := store.AgentConfiguration(f.session.Account, configuration.ID)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "failed_pause_preserves_run" {
				if response.Code != http.StatusConflict || !reflect.DeepEqual(current, configuration) {
					t.Fatalf("failed pause changed CONFIG or reported success: status=%d config=%+v", response.Code, current)
				}
				// Release the original HTTP provider only after the failed mutation.
				release <- struct{}{}
			} else if response.Code != http.StatusOK || current.State != "paused" || current.Revision != configuration.Revision+1 {
				t.Fatalf("pause did not commit: status=%d config=%+v", response.Code, current)
			}
			select {
			case result := <-done:
				if mode == "failed_pause_preserves_run" {
					if result.err != nil || result.view.Status != "COMPLETED" || result.view.Content != "Actual provider answer from the still-enabled configuration." {
						t.Fatalf("failed pause cancelled valid original model work: %+v %v", result.view, result.err)
					}
				} else if !errors.Is(result.err, context.Canceled) || result.view.Status != "STOPPED" || result.view.Content != "" {
					t.Fatalf("committed pause did not cancel active model work: %+v %v", result.view, result.err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("in-flight configuration transition did not settle")
			}
			wantAdmissions := int32(1)
			if mode == "failed_pause_preserves_run" {
				// The valid original run separately checks its retained final
				// answer before release. This is not another provider request.
				wantAdmissions = 2
			}
			if f.requests.Load() != 1 || f.admissions.Load() != wantAdmissions || len(store.state.Permissions) != 0 {
				t.Fatalf("configuration transition retried provider or changed disclosure checks/authority: requests=%d admissions=%d want=%d", f.requests.Load(), f.admissions.Load(), wantAdmissions)
			}
		})
	}
}

func p08CreateAgentConfiguration(t *testing.T, s *Store, account string) AgentConfiguration {
	t.Helper()
	configuration, err := s.ConfigureAgent(account, "", 0, "Reader", "gateway.configured", []string{"ai.conversation.read"}, "enabled")
	if err != nil {
		t.Fatal(err)
	}
	return configuration
}

func TestP08AgentConfigurationPersistenceCloneAndNoGrant(t *testing.T) {
	s, key := p08AgentConfigurationStore(t)
	s.state.AgentConfigurations = nil // Missing field in a legacy snapshot.
	before, err := json.Marshal(s.state)
	if err != nil {
		t.Fatal(err)
	}
	tools := []string{"ai.conversation.read"}
	configuration, err := s.ConfigureAgent("tenant-a", "", 0, " Reader ", "gateway.configured", tools, "enabled")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(configuration.ID, "agentcfg_") || configuration.Account != "tenant-a" || configuration.Name != "Reader" || configuration.ModelRef != "gateway.configured" || configuration.State != "enabled" || configuration.Revision != 1 || configuration.CreatedAt.IsZero() || configuration.CreatedAt != configuration.UpdatedAt {
		t.Fatalf("invalid initial CONFIG object: %+v", configuration)
	}
	// Strip only the explicitly owned config and audit fields. All task,
	// permission, identity/session, step, outbox and other state must be exact.
	unrelated := s.state
	unrelated.AgentConfigurations = nil
	unrelated.Audits, unrelated.AuditSequence = []AuditRecord{}, 0
	after, err := json.Marshal(unrelated)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("CONFIG changed authority or unrelated state: %v", err)
	}
	original := cloneAgentConfiguration(configuration)
	tools[0] = "caller-mutated-input"
	configuration.ToolIDs[0] = "caller-mutated-response"
	read, err := s.AgentConfiguration("tenant-a", original.ID)
	if err != nil || !reflect.DeepEqual(read, original) {
		t.Fatalf("create input/response aliases state: %+v %v", read, err)
	}
	read.ToolIDs[0] = "mutated-read"
	listed := s.AgentConfigurations("tenant-a")
	if len(listed) != 1 || !reflect.DeepEqual(listed[0], original) {
		t.Fatalf("bad owner list: %+v", listed)
	}
	listed[0].ToolIDs[0] = "mutated-list"
	updated, err := s.ConfigureAgent("tenant-a", original.ID, 1, "Updated reader", "gateway.configured", []string{"ai.conversation.read"}, "paused")
	if err != nil || updated.Revision != 2 || updated.CreatedAt != original.CreatedAt || updated.UpdatedAt.Before(original.UpdatedAt) {
		t.Fatalf("update failed: %+v %v", updated, err)
	}
	expected := cloneAgentConfiguration(updated)
	updated.ToolIDs[0] = "mutated-update-response"
	restarted, err := NewStore(s.path, key)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := restarted.AgentConfiguration("tenant-a", original.ID)
	if err != nil || !reflect.DeepEqual(persisted, expected) {
		t.Fatalf("restart changed configuration: %+v %v", persisted, err)
	}
	current, err := s.AgentConfiguration("tenant-a", original.ID)
	if err != nil || !reflect.DeepEqual(current, expected) {
		t.Fatalf("returned update aliases state: %+v %v", current, err)
	}
}

func TestP08AgentConfigurationOwnershipAndValidation(t *testing.T) {
	s, _ := p08AgentConfigurationStore(t)
	configuration := p08CreateAgentConfiguration(t, s, "tenant-a")
	other := p08CreateAgentConfiguration(t, s, "tenant-b")
	for _, account := range []string{"tenant-b", "", " \t", strings.Repeat("a", 257)} {
		for _, id := range []string{configuration.ID, "missing"} {
			if result, err := s.AgentConfiguration(account, id); !errors.Is(err, os.ErrNotExist) || result.ID != "" {
				t.Fatalf("read existence leak: %+v %v", result, err)
			}
			if result, err := s.ConfigureAgent(account, id, 1, "bad", "unregistered-model", []string{"pay"}, "invalid"); !errors.Is(err, os.ErrNotExist) || result.ID != "" {
				t.Fatalf("update existence leak: %+v %v", result, err)
			}
		}
	}
	if list := s.AgentConfigurations("tenant-b"); len(list) != 1 || list[0].ID != other.ID {
		t.Fatalf("cross-owner list: %+v", list)
	}
	if list := s.AgentConfigurations(" "); len(list) != 0 {
		t.Fatalf("blank account listed configurations: %+v", list)
	}
	if _, err := s.ConfigureAgent("tenant-a", "caller-chosen-id", 0, "Name", "gateway.configured", nil, "enabled"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("caller selected an arbitrary creation ID: %v", err)
	}
	if _, err := s.ConfigureAgent("tenant-a", "", 1, "Name", "gateway.configured", nil, "enabled"); !errors.Is(err, ErrAgentConfigurationConflict) {
		t.Fatalf("create accepted nonzero expected revision: %v", err)
	}
	for _, tc := range []struct {
		name, model, state string
		tools              []string
	}{
		{"", "gateway.configured", "enabled", nil},
		{" \t", "gateway.configured", "enabled", nil},
		{strings.Repeat("n", 121), "gateway.configured", "enabled", nil},
		{"Name", "https://arbitrary-provider.invalid", "enabled", nil},
		{"Name", "gateway.configured.fast", "enabled", nil},
		{"Name", "gateway.configured", "UNKNOWN", nil},
		{"Name", "gateway.configured", "enabled", []string{"ai.conversation.read", "ai.conversation.read"}},
		{"Name", "gateway.configured", "enabled", []string{"unregistered"}},
		{"Name", "gateway.configured", "enabled", []string{""}},
		{"Name", "gateway.configured", "enabled", []string{strings.Repeat("t", 129)}},
		{"Name", "gateway.configured", "enabled", make([]string, 33)},
	} {
		if _, err := s.ConfigureAgent("tenant-a", "", 0, tc.name, tc.model, tc.tools, tc.state); !errors.Is(err, ErrAgentConfigurationInvalid) {
			t.Fatalf("invalid CONFIG accepted: %+v %v", tc, err)
		}
	}
	if _, err := s.AgentConfiguration("tenant-a", strings.Repeat("a", 129)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oversized ID accepted: %v", err)
	}
	if _, err := s.ConfigureAgent("tenant-a", strings.Repeat("a", 129), 1, "Name", "gateway.configured", nil, "enabled"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("oversized update ID accepted: %v", err)
	}
	if len(s.AgentConfigurations("tenant-a")) != 1 {
		t.Fatal("rejected inputs created configurations")
	}
}

func TestP08AgentConfigurationCASAndOverflow(t *testing.T) {
	s, _ := p08AgentConfigurationStore(t)
	configuration := p08CreateAgentConfiguration(t, s, "tenant-a")
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, name := range []string{"Reader A", "Reader B"} {
		wg.Add(1)
		go func(name string) {
			defer wg.Done()
			<-start
			_, err := s.ConfigureAgent("tenant-a", configuration.ID, 1, name, "gateway.configured", configuration.ToolIDs, "paused")
			results <- err
		}(name)
	}
	close(start)
	wg.Wait()
	close(results)
	winners, conflicts := 0, 0
	for err := range results {
		if err == nil {
			winners++
		} else if errors.Is(err, ErrAgentConfigurationConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	current, err := s.AgentConfiguration("tenant-a", configuration.ID)
	if err != nil || current.Revision != 2 || winners != 1 || conflicts != 1 {
		t.Fatalf("CAS did not have exactly one winner: %+v %v winners=%d conflicts=%d", current, err, winners, conflicts)
	}
	if _, err := s.ConfigureAgent("tenant-a", configuration.ID, 1, "Stale", "gateway.configured", nil, "enabled"); !errors.Is(err, ErrAgentConfigurationConflict) {
		t.Fatalf("stale update accepted: %v", err)
	}
	current.Revision = ^uint64(0)
	s.state.AgentConfigurations[current.ID] = current // Isolated overflow fixture.
	if _, err := s.ConfigureAgent("tenant-a", current.ID, current.Revision, "Overflow", "gateway.configured", nil, "enabled"); !errors.Is(err, ErrAgentConfigurationConflict) {
		t.Fatalf("revision wrapped: %v", err)
	}
}

func TestP08AgentConfigurationPauseAndRevisionGate(t *testing.T) {
	s, _ := p08AgentConfigurationStore(t)
	configuration := p08CreateAgentConfiguration(t, s, "tenant-a")
	check := func(task TaskRecord, tool string) error {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.assertTaskAgentConfigurationLocked(task, tool)
	}
	if err := check(TaskRecord{Account: "tenant-a"}, ""); err != nil {
		t.Fatalf("original default path changed: %v", err)
	}
	task := TaskRecord{Account: "tenant-a", AgentConfigurationID: configuration.ID, AgentConfigurationRevision: configuration.Revision}
	for _, tool := range []string{"", "ai.conversation.read"} {
		if err := check(task, tool); err != nil {
			t.Fatalf("current enabled configuration refused: %v", err)
		}
	}
	if err := check(task, "unregistered"); !errors.Is(err, ErrAgentConfigurationUnavailable) {
		t.Fatalf("unlisted tool allowed: %v", err)
	}
	for _, account := range []string{"tenant-b", ""} {
		foreign := task
		foreign.Account = account
		if err := check(foreign, ""); !errors.Is(err, ErrAgentConfigurationUnavailable) {
			t.Fatalf("cross-owner task configuration allowed: %v", err)
		}
	}
	missing := task
	missing.AgentConfigurationID = "missing"
	if err := check(missing, ""); !errors.Is(err, ErrAgentConfigurationUnavailable) {
		t.Fatalf("missing configuration allowed: %v", err)
	}
	paused, err := s.ConfigureAgent("tenant-a", configuration.ID, 1, "Reader", "gateway.configured", configuration.ToolIDs, "paused")
	if err != nil {
		t.Fatal(err)
	}
	if err := check(task, ""); !errors.Is(err, ErrAgentConfigurationUnavailable) {
		t.Fatalf("old task bypassed pause: %v", err)
	}
	task.AgentConfigurationRevision = paused.Revision
	if err := check(task, "ai.conversation.read"); !errors.Is(err, ErrAgentConfigurationUnavailable) {
		t.Fatalf("paused CONFIG allowed execution: %v", err)
	}
	resumed, err := s.ConfigureAgent("tenant-a", configuration.ID, paused.Revision, "Reader", "gateway.configured", nil, "enabled")
	if err != nil {
		t.Fatal(err)
	}
	if err := check(task, ""); !errors.Is(err, ErrAgentConfigurationUnavailable) {
		t.Fatalf("re-enable silently rebound old task: %v", err)
	}
	task.AgentConfigurationRevision = resumed.Revision
	if err := check(task, ""); err != nil {
		t.Fatalf("explicit current model config refused: %v", err)
	}
	if err := check(task, "ai.conversation.read"); !errors.Is(err, ErrAgentConfigurationUnavailable) {
		t.Fatalf("removed tool still available: %v", err)
	}
}

func TestP08AgentConfigurationSaveFailureRollback(t *testing.T) {
	for _, operation := range []string{"create_nil", "create_existing", "update"} {
		t.Run(operation, func(t *testing.T) {
			s, key := p08AgentConfigurationStore(t)
			configuration := p08CreateAgentConfiguration(t, s, "tenant-a")
			if operation == "create_nil" {
				s.state.AgentConfigurations = nil
			}
			// Exercise the original audit retention boundary as well as nil map.
			for len(s.state.Audits) < 10000 {
				s.auditLocked("tenant-a", "fixture", configuration.ID, "isolated audit retention fixture")
			}
			if err := s.saveLocked(); err != nil {
				t.Fatal(err)
			}
			before, err := json.Marshal(s.state)
			if err != nil {
				t.Fatal(err)
			}
			path := s.path
			diskBefore, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			s.path = filepath.Join(path, "not-a-directory.json")
			id, revision := "", uint64(0)
			if operation == "update" {
				id, revision = configuration.ID, configuration.Revision
			}
			result, err := s.ConfigureAgent("tenant-a", id, revision, "Changed", "gateway.configured", []string{"ai.conversation.read"}, "paused")
			var firstCause *os.PathError
			if err == nil || result.ID != "" || !errors.As(err, &firstCause) || firstCause.Op != "mkdir" {
				t.Fatalf("save failure lost first cause or returned success: %+v %v", result, err)
			}
			after, marshalErr := json.Marshal(s.state)
			if marshalErr != nil || !bytes.Equal(before, after) {
				t.Fatalf("failed save changed state or audit chain: %v", marshalErr)
			}
			diskAfter, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(diskBefore, diskAfter) {
				t.Fatalf("failed save changed durable state: %v", err)
			}
			restarted, err := NewStore(path, key)
			if err != nil {
				t.Fatal(err)
			}
			if operation != "create_nil" {
				read, err := restarted.AgentConfiguration("tenant-a", configuration.ID)
				if err != nil || !reflect.DeepEqual(read, configuration) {
					t.Fatalf("failed save changed restarted config: %+v %v", read, err)
				}
			} else if len(restarted.AgentConfigurations("tenant-a")) != 0 {
				t.Fatal("failed create survived restart")
			}
		})
	}
}
