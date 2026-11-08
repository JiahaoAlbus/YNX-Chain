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
	"time"

	local "github.com/JiahaoAlbus/YNX-Chain/internal/authtasklocal"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

// Only the original PUBLIC Grant-selection/Store fixture is used. Receiver
// release[] and concrete receiver factory remain unchanged. This is a consumer
// refusal/lifetime test, never a registered receiver or new Source permission.
func TestLINKP08RegisteredReceiverNormalConsumer(t *testing.T) {
	for _, mode := range []string{"ordered-partial-drain", "early-parent-close-keeps-debt"} {
		t.Run(mode, func(t *testing.T) {
			resource, request, projection := taskResourceFixture(t)
			// The old P08 fixture's non-hex fake grant cannot feed the true E2.1 codec.
			// Assign a valid fixed PUBLIC id in the fixture only; production is unmodified.
			request.Binding.GrantID = "abababababababababababababababab"
			projection.snapshot.Grant.ID = request.Binding.GrantID
			projection.snapshot.Grant.Binding = request.Binding
			projection.snapshot.Effect.Slot = request.Binding.Slot()
			projection.snapshot.Budget.Slot = request.Binding.Slot()
			resource.store.mu.Lock()
			record := resource.store.state.Actions[request.Binding.StepID]
			step := *record.ToolStep
			step.TaskGrantRef = request.Binding.GrantID
			record.ToolStep = &step
			resource.store.state.Actions[record.ID] = record
			saveErr := resource.store.saveLocked()
			resource.store.mu.Unlock()
			if saveErr != nil {
				t.Fatal(saveErr)
			}
			// The original protected reader rejects unsafe ancestors such as /tmp.
			// Use the actual runner's canonical home on both Darwin and Linux;
			// retain every original permission/proof check without a fixed user path.
			home, e := os.UserHomeDir()
			if e != nil {
				t.Fatal(e)
			}
			home, e = filepath.EvalSymlinks(home)
			if e != nil {
				t.Fatal(e)
			}
			private, e := os.MkdirTemp(home, "PUBLIC-reg-p08-")
			if e != nil {
				t.Fatal(e)
			}
			defer os.RemoveAll(private)
			actual, g, gp, hp, file, e := native.PUBLICOriginalReceiverGrantForP08Test(private, projection.snapshot, "")
			_ = g
			if e != nil {
				if actual != nil {
					_ = actual.Close()
				}
				t.Fatal("original PUBLIC Source/Core fixture", e)
			}
			owner := local.PUBLICOwnerWithGrantForReceiverTest(actual)
			defer func() { _ = owner.Close() }()
			// Compile AND consume the actual P08 private contract, not an extracted copy.
			var original originalTaskReadReceiverRegistration = owner
			ctx := context.Background()
			if e = owner.Current(ctx); e != nil {
				t.Fatal("valid original grant before receiver", e)
			}
			path, cfg, readErr := original.ReadOriginalTaskReadReceiverRegistration(ctx)
			if !errors.Is(readErr, native.ErrTaskReadReceiverNotSupplied) || path != "" || cfg.Service != "" || cfg.Handler != nil || len(cfg.Routes) != 0 {
				t.Fatalf("missing purpose returned config: %q %+v %v", path, cfg, readErr)
			}
			if e = original.AssertOriginalTaskReadReceiverCurrent(ctx); !errors.Is(e, native.ErrTaskReadReceiverNotSupplied) {
				t.Fatal("actual receiver current", e)
			}
			// SAME original concrete Owner in the actual normal P08 server graph.
			authority := &nativeTaskRuntimeAuthority{owner: actual, localOwner: owner}
			prepared := &PreparedOriginalTaskRuntime{authority: authority}
			server := &Server{store: resource.store, toolEffects: &originalRuntimeToolEffects{runtime: prepared, store: resource.store}}
			partial, openErr := OpenOriginalTaskReadReceiver(ctx, server)
			if partial == nil {
				t.Fatal("normal consumer dropped partial")
			}
			defer func() {
				_ = partial.Retire()
				c, cancel := context.WithTimeout(ctx, time.Second)
				defer cancel()
				_ = partial.Join(c)
				_ = partial.Close()
			}()
			if !errors.Is(openErr, native.ErrTaskReadReceiverNotSupplied) || partial.registration != owner || partial.resource == nil || partial.resource.verifier != owner || partial.server != nil || partial.listener != nil || partial.started {
				t.Fatalf("normal P08 did not reach exact actual receiver getter before no-listen refusal: %v %+v", openErr, partial)
			}
			if e = owner.Current(ctx); e != nil {
				t.Fatal("receiver absence poisoned original grant", e)
			}
			// True supplied Source and Core dual proofs, through actual local Owner.
			// An optional receiver must not rewrite the original NEW projection.
			held, e := owner.OpenTaskGrantSource(ctx, request.Binding, gp, hp)
			if held == nil {
				t.Fatal("original partial dropped", e)
			}
			if e != nil {
				_ = held.Close()
				t.Fatal("NEW source/proof after optional receiver failure", e)
			}
			snapshot, e := held.Snapshot(ctx)
			if e != nil || snapshot.Effect.State != "NEW" || snapshot.Effect.OriginalOp != "" {
				_ = held.Close()
				t.Fatal("receiver changed original NEW", e, snapshot.Effect)
			}
			if e = held.Close(); e != nil {
				t.Fatal(e)
			}
			request.Grant, request.Holder = gp, hp
			read := request
			read.AuthorityOperationID = ""
			read.RawInput = nil
			guard, input, e := partial.resource.ReadInput(ctx, read)
			if guard == nil {
				t.Fatal("P08 input dropped real Source child", e)
			}
			defer func() { _ = guard.Close() }()
			if e != nil || !bytes.Equal(input, request.RawInput) {
				t.Fatal("same existing encrypted input through real Source", e)
			}
			if e = partial.Retire(); e != nil {
				t.Fatal(e)
			}
			drain, cancel := context.WithTimeout(ctx, time.Second)
			defer cancel()
			// There is no listener: Join is only the true no-listener partial branch.
			if e = partial.Join(drain); e != nil {
				t.Fatal(e)
			}
			if e = partial.Close(); !errors.Is(e, errTaskResourceChildren) {
				t.Fatal("P08 partial discarded real held Source debt", e)
			}
			if e = owner.Current(ctx); e != nil {
				t.Fatal("borrower closed/retired valid original Source", e)
			}
			var firstParentClose error
			if mode == "early-parent-close-keeps-debt" {
				firstParentClose = owner.Close()
				if !errors.Is(firstParentClose, local.ErrChildrenRetained) {
					t.Fatal("parent closed across P08 child", firstParentClose)
				}
				if e = owner.Join(); !errors.Is(e, local.ErrChildrenRetained) {
					t.Fatal("parent Join forgot actual held Source", e)
				}
			}
			if e = guard.Close(); e != nil {
				t.Fatal("original P08 Source child physical close", e)
			}
			if e = partial.Join(drain); e != nil {
				t.Fatal(e)
			}
			if e = partial.Close(); e != nil {
				t.Fatal("P08 resource drain after child release", e)
			}
			if mode == "ordered-partial-drain" {
				if e = owner.Current(ctx); e != nil {
					t.Fatal("P08 borrower closed grant parent", e)
				}
				if e = owner.Retire(); e != nil {
					t.Fatal(e)
				}
			}
			if e = owner.Join(); e != nil {
				t.Fatal("actual Owner debt not drained", e)
			}
			closeErr := owner.Close()
			if mode == "ordered-partial-drain" && closeErr != nil {
				t.Fatal("ordered normal owner cleanup", closeErr)
			}
			if mode == "early-parent-close-keeps-debt" && closeErr != firstParentClose {
				t.Fatal("early precondition first cause not preserved", firstParentClose, closeErr)
			}
			evidence := map[string]any{"mode": mode, "actualConcreteOwnerMethods": true, "normalP08ConstructorReachedExactOwner": true, "nonnullPartial": true, "listenerCreated": false, "serverCreated": false, "receiverSourceRowsModified": false, "SourceJSONOrBoolSubstitute": false, "originalNEWSourceProofsVerified": true, "originalNEWStateUnchanged": true, "P08BorrowerDidNotCloseGrantParent": true, "originalEncryptedInputExact": true, "P08RealChildDebtRefusedPrematureClose": true, "ownerJoinAfterChildClose": true, "ownerOrderedCloseNil": mode == "ordered-partial-drain", "earlyCloseDiagnosticRetained": mode == "early-parent-close-keeps-debt", "LINKListenerDrainExecuted": false, "RootAdmission": false, "genuineSourceSelection": false, "receiverPurposePermission": false, "P08Business": false}
			b, _ := json.MarshalIndent(evidence, "", "  ")
			if e = os.WriteFile(filepath.Join(os.Getenv("LINK_REGISTERED_RECEIVER_EVIDENCE"), mode+".json"), append(b, '\n'), 0600); e != nil {
				t.Fatal(e)
			}
			b, e = os.ReadFile(file)
			if e != nil {
				t.Fatal(e)
			}
			if e = os.WriteFile(filepath.Join(os.Getenv("LINK_REGISTERED_RECEIVER_EVIDENCE"), mode+"-PUBLIC-projection.json"), b, 0600); e != nil {
				t.Fatal(e)
			}
			t.Logf("actualP08NormalConstructor actualOwnerGetters receiverNotSupplied noListener NEW-preserved realP08SourceDebt mode=%s Root=false receiverPurpose=false", mode)
		})
	}
}
