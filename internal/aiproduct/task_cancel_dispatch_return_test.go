package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
)

// Pause at the actual production Source-return boundary, after the original
// broker/Unix receiver have run. Only scheduling and Auth fixtures are PUBLIC.
type p08CancelAtDispatchReturn struct {
	originalToolEffectSource
	after func()
}

func (s *p08CancelAtDispatchReturn) dispatchTaskTool(ctx context.Context, call taskEffectCall, ref string) (taskReadReceipt, error) {
	receipt, err := s.originalToolEffectSource.dispatchTaskTool(ctx, call, ref)
	s.after()
	return receipt, err
}

func (s *p08CancelAtDispatchReturn) taskToolAvailable(ctx context.Context, tool string) error {
	return s.originalToolEffectSource.(*originalRuntimeToolEffects).taskToolAvailable(ctx, tool)
}

// Return the original Auth answer after cancellation, before the broker saves
// its verified receipt. This is the cancellation/acknowledgement race.
type p08CancelAtAuthorityReturn struct {
	originalTaskBrokerClient
	after func()
}

func (s *p08CancelAtAuthorityReturn) AuthorizeAtEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	result, err := s.originalTaskBrokerClient.AuthorizeAtEffect(ctx, call)
	s.after()
	return result, err
}

func TestP08CancelDuringDispatchReturn(t *testing.T) {
	for _, mode := range []string{"settled", "other-debt", "lost-ack", "save-failure"} {
		t.Run(mode, func(t *testing.T) {
			f, _, client := newP08ConversationLoop(t)
			client.lostACK = mode == "lost-ack"
			request := f.request()
			request.AuthorizationRef = "PUBLIC_QUERY_REF"
			pending, err := f.server.runTaskModel(context.Background(), f.session, f.task.ID, request)
			if err != nil || len(pending.Steps) != 1 {
				t.Fatalf("proposal: %+v %v", pending, err)
			}
			approveConversationLoop(t, f, pending)
			store, stepID := f.server.store, pending.Steps[0]
			path := store.path
			var cancelled TaskRecord
			var atCancel, diskAtCancel []byte
			effects := f.server.toolEffects.(*originalRuntimeToolEffects)
			effects.runtime.broker.client = &p08CancelAtAuthorityReturn{originalTaskBrokerClient: client, after: func() {
				if mode == "other-debt" {
					other := store.state.Actions[stepID]
					binding := *other.ToolStep
					other.ID, other.Status, other.ToolStep = "PUBLIC-other-pending-step", "UNKNOWN", &binding
					if err := store.SaveAction(other); err != nil {
						t.Fatal(err)
					}
				}
				task := store.state.Tasks[f.task.ID]
				cancelled, err = store.CancelTask(f.session.Account, task.ID, task.Revision, task.Generation, task.Holder)
				if err != nil {
					t.Fatal(err)
				}
				if cancelled.Status != "RECONCILING" {
					t.Fatal("cancel did not observe the pending original Auth receipt")
				}
			}}
			f.server.toolEffects = &p08CancelAtDispatchReturn{originalToolEffectSource: effects, after: func() {
				atCancel, _ = json.Marshal(store.state)
				diskAtCancel, err = os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if mode == "save-failure" {
					store.path = filepath.Dir(path)
				}
			}}
			receipt, dispatchErr := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, stepID, "PUBLIC_QUERY_REF")
			store.path = path
			if client.effects != 1 || client.inputReads != 1 || client.queries != 0 || f.requests.Load() != 1 {
				t.Fatal("dispatch return replayed original effect, input, query or model")
			}
			if mode == "lost-ack" {
				if dispatchErr == nil || store.state.Tasks[f.task.ID].Status != "RECONCILING" {
					t.Fatal("unsettled Auth result closed cancellation")
				}
				return
			}
			if mode == "save-failure" {
				after, _ := json.Marshal(store.state)
				diskAfter, readErr := os.ReadFile(path)
				if dispatchErr == nil || readErr != nil || !bytes.Equal(atCancel, after) || !bytes.Equal(diskAtCancel, diskAfter) {
					t.Fatal("failed cancellation settlement reported success or altered persisted receipt/state")
				}
			} else if dispatchErr != nil || receipt.State != "COMMITTED" {
				t.Fatalf("original dispatch: %+v %v", receipt, dispatchErr)
			}
			cold, err := NewStore(path, f.key)
			if err != nil {
				t.Fatal(err)
			}
			if mode == "other-debt" {
				if cold.state.Tasks[f.task.ID].Status != "RECONCILING" {
					t.Fatal("a completed result erased another original operation's debt")
				}
				return
			}
			if mode == "settled" && cold.state.Tasks[f.task.ID].Status != "CANCELLED" {
				t.Fatal("committed dispatch return left cancellation stuck in RECONCILING")
			}
			resumed := &Server{store: cold} // stored receipt retry needs no Source
			if _, err = resumed.reconcileStep(context.Background(), f.session, f.task.ID, stepID, "PUBLIC_QUERY_REF"); err != nil {
				t.Fatal(err)
			}
			finished := cold.state.Tasks[f.task.ID]
			if finished.Status != "CANCELLED" || finished.CancelledAt != cancelled.CancelledAt || finished.Revision != cancelled.Revision+1 {
				t.Fatal("settlement lost cancellation identity/revision")
			}
			w := conversationResultRead(resumed, f.session, f.task.ID, stepID)
			if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), []byte(client.last.Original)) {
				t.Fatal("cold cancellation lost the exact original user result")
			}
			before, _ := os.ReadFile(path)
			if _, err = resumed.reconcileStep(context.Background(), f.session, f.task.ID, stepID, "PUBLIC_QUERY_REF"); err != nil {
				t.Fatal(err)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) || client.effects != 1 || client.queries != 0 || f.requests.Load() != 1 {
				t.Fatal("settlement retry changed audit or replayed effect/query/model")
			}
		})
	}
}
