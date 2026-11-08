//go:build link_registered_receiver_interop && (darwin || linux)

package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	local "github.com/JiahaoAlbus/YNX-Chain/internal/authtasklocal"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

type p08ReceiverGateClient struct{ effects int }

func (c *p08ReceiverGateClient) Current(ctx context.Context) error { return ctx.Err() }
func (c *p08ReceiverGateClient) AuthorizeAtEffect(context.Context, originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	c.effects++
	return originalclient.TaskAuthorityResult{}, errTaskEffectSourceUnavailable
}
func (*p08ReceiverGateClient) QueryOriginalEffect(context.Context, originalclient.TaskAuthorityCall) (originalclient.TaskAuthorityResult, error) {
	return originalclient.TaskAuthorityResult{}, errTaskEffectUnresolved
}

// Actual ordinary protected Grant/PQ verification under the existing PUBLIC
// fixture. No receiver permission is installed, signed or fabricated here.
func TestP08NativeReceiverDispatchReadiness(t *testing.T) {
	resource, request, projection := taskResourceFixture(t)
	request.Binding.GrantID = "abababababababababababababababab"
	projection.snapshot.Grant.ID = request.Binding.GrantID
	projection.snapshot.Grant.Binding = request.Binding
	projection.snapshot.Effect.Slot = request.Binding.Slot()
	projection.snapshot.Budget.Slot = request.Binding.Slot()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	home, err = filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(home, "PUBLIC-receiver-gate-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	actual, _, _, _, _, err := native.PUBLICOriginalReceiverGrantForP08Test(dir, projection.snapshot, "")
	if err != nil {
		if actual != nil {
			_ = actual.Close()
		}
		t.Fatal(err)
	}
	owner := local.PUBLICOwnerWithGrantForReceiverTest(actual)
	t.Cleanup(func() {
		if err := owner.Close(); err != nil {
			t.Error(err)
		}
	})
	model := newP08ModelFixture(t)
	client := &p08ReceiverGateClient{}
	prepared := &PreparedOriginalTaskRuntime{model: model.provider, authority: &nativeTaskRuntimeAuthority{owner: actual, localOwner: owner}, broker: &originalTaskAuthorityBroker{client: client}}
	effects := &originalRuntimeToolEffects{runtime: prepared, store: resource.store}
	server := &Server{store: resource.store, toolEffects: effects}
	session := ProductSession{ID: request.Binding.SessionID, Account: request.Binding.Account, DeviceID: request.Binding.Holder.ID}
	ctx := context.Background()
	if err := prepared.current(ctx); err != nil {
		t.Fatal("ordinary Grant/broker must be current before this receiver-only refusal", err)
	}
	for _, stage := range []string{"not-mounted", "missing-registration", "retired"} {
		t.Run(stage, func(t *testing.T) {
			if stage == "missing-registration" {
				partial, err := OpenOriginalTaskReadReceiver(ctx, server)
				if partial == nil || !errors.Is(err, native.ErrTaskReadReceiverNotSupplied) || effects.receiver != partial {
					t.Fatal("normal borrower not retained", err)
				}
				t.Cleanup(func() { p08CloseReadReceiver(t, partial) })
				duplicate, err := OpenOriginalTaskReadReceiver(ctx, server)
				if duplicate == nil || !errors.Is(err, errToolConflict) || effects.receiver != partial {
					t.Fatal("second constructor replaced original debt", err)
				}
				p08CloseReadReceiver(t, duplicate)
			}
			if stage == "retired" {
				_ = effects.receiver.Retire()
			}
			before, _ := json.Marshal(resource.store.state)
			disk, err := os.ReadFile(resource.store.path)
			if err != nil {
				t.Fatal(err)
			}
			_, err = server.dispatchApprovedStep(ctx, session, request.Binding.Task.ID, request.Binding.StepID, "PUBLIC_QUERY_REF")
			if !errors.Is(err, errTaskEffectSourceUnavailable) {
				t.Fatal("receiver-only start did not refuse before reservation", err)
			}
			after, _ := json.Marshal(resource.store.state)
			diskAfter, err := os.ReadFile(resource.store.path)
			if err != nil || !bytes.Equal(before, after) || !bytes.Equal(disk, diskAfter) || client.effects != 0 {
				t.Fatal("known unavailable receiver reserved, dispatched or changed original state")
			}
			if err := effects.taskToolAvailable(ctx, shopOrderToolID); err != nil {
				t.Fatal("receiver absence poisoned independent Shop readiness", err)
			}
			if err := prepared.current(ctx); err != nil {
				t.Fatal("receiver absence poisoned model/ordinary Grant runtime", err)
			}
		})
	}
}
