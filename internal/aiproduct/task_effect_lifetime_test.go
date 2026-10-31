package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
)

// PUBLIC broker-response delay only; no real Source or external effect.
type p08WaitingBrokerFixture struct {
	*p08BrokerClientFixture
	started, release chan struct{}
}

func (c *p08WaitingBrokerFixture) AuthorizeAtEffect(ctx context.Context, call originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	result, err := c.p08BrokerClientFixture.AuthorizeAtEffect(ctx, call)
	close(c.started)
	select {
	case <-ctx.Done():
		return originalclient.TaskAuthorityResult{State: "UNKNOWN", OriginalOperation: result.OriginalOperation}, ctx.Err()
	case <-c.release:
		return result, err
	}
}

func TestP08ManualBrokerTaskCancellationLifetime(t *testing.T) {
	for _, saveFails := range []bool{false, true} {
		t.Run(map[bool]string{false: "committed-cancel", true: "failed-cancel-preserves-effect"}[saveFails], func(t *testing.T) {
			f, _, client := newP08BrokerFixture(t, true)
			f.approve(t)
			client.result = p08BrokerResult(t, f)
			waiting := &p08WaitingBrokerFixture{p08BrokerClientFixture: client, started: make(chan struct{}), release: make(chan struct{})}
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(waiting.release) }) }
			t.Cleanup(release)
			f.prepared.broker.client = waiting
			type outcome struct {
				receipt taskReadReceipt
				err     error
			}
			done := make(chan outcome, 1)
			go func() {
				r, e := f.server.dispatchApprovedStep(context.Background(), f.session, f.task.ID, f.step.ID, "PUBLIC-original-proof-ref")
				done <- outcome{r, e}
			}()
			select {
			case <-waiting.started:
			case <-time.After(3 * time.Second):
				t.Fatal("manual broker did not start")
			}
			f.store.mu.Lock()
			task, err := f.store.ownedTaskLocked(f.session.Account, f.task.ID)
			originalPath := f.store.path
			if saveFails {
				f.store.path = filepath.Join(originalPath, "not-a-directory.json")
			}
			f.store.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			body, _ := json.Marshal(map[string]uint64{"revision": task.Revision, "generation": task.Generation})
			request := httptest.NewRequest(http.MethodPost, "/api/tasks/"+task.ID+"/cancel", bytes.NewReader(body))
			request.SetPathValue("id", task.ID)
			response := httptest.NewRecorder()
			f.server.handleTaskCancel(response, request, f.session)
			f.store.mu.Lock()
			f.store.path = originalPath
			f.store.mu.Unlock()
			if saveFails {
				if response.Code == http.StatusOK {
					t.Fatal("failed cancellation reported success")
				}
				select {
				case result := <-done:
					t.Fatalf("failed mutation cancelled manual effect: %v", result.err)
				default:
				}
				release()
			} else if response.Code != http.StatusOK {
				t.Fatalf("cancellation status=%d", response.Code)
			}
			var result outcome
			select {
			case result = <-done:
			case <-time.After(3 * time.Second):
				t.Fatal("manual effect lifetime did not settle")
			}
			stored := p08BrokerStored(f)
			if saveFails {
				if result.err != nil || result.receipt.State != "COMMITTED" || stored.Status != "COMPLETED" {
					t.Fatalf("valid original effect lost: %+v %v", result.receipt, result.err)
				}
			} else if !errors.Is(result.err, context.Canceled) || stored.Status != "UNKNOWN" || stored.ToolStep.AuthorityOperationID != client.result.OriginalOperation || stored.ToolStep.ResultCipher != "" {
				t.Fatalf("cancelled manual effect fabricated/erased outcome: status=%s error=%v", stored.Status, result.err)
			}
			f.server.mu.Lock()
			active := len(f.server.taskActiveEffects)
			f.server.mu.Unlock()
			if active != 0 || len(client.news) != 1 || f.caller.calls.Load() != 0 {
				t.Fatal("manual lifetime leaked or replayed effect")
			}
		})
	}
}
