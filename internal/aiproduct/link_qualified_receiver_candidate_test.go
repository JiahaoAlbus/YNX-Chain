//go:build link_receiver_purpose_candidate && link_registered_receiver_interop && (darwin || linux)

package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	local "github.com/JiahaoAlbus/YNX-Chain/internal/authtasklocal"
	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

// New candidate composition only: actual soleSDK receiver-purpose math/current,
// concrete Owner methods, actual P08 constructor and actual LINK listener.
// PUBLIC original Source selection and ephemeral proofs are NOT Root admission.
func TestLINKP08QualifiedReceiverPurposeCandidate(t *testing.T) {
	started := time.Now()
	resource, request, projection := taskResourceFixture(t)
	// The old P08 fixture's non-hex fake grant cannot feed the true E2.1 codec.
	// Assign a valid fixed PUBLIC id in the fixture only; production is unmodified.
	request.Binding.GrantID = "abababababababababababababababab"
	projection.snapshot.Grant.ID = request.Binding.GrantID
	projection.snapshot.Grant.Binding = request.Binding
	projection.snapshot.Effect.Slot = request.Binding.Slot()
	projection.snapshot.Budget.Slot = request.Binding.Slot()
	// This full PUBLIC crypto/listener lifecycle took >60s on Ubuntu. Establish
	// one fresh immutable fixture window before signing, longer than the 150s
	// test deadline; never refresh a live permission or change production limits.
	expires := strconv.FormatInt(time.Now().Add(3*time.Minute).UnixMilli(), 10)
	projection.snapshot.Expires = expires
	projection.snapshot.Grant.Expires = expires
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
	fixtureRoot := os.Getenv("LINK_RECEIVER_CANDIDATE_SOCKET_ROOT")
	if !filepath.IsAbs(fixtureRoot) || filepath.Clean(fixtureRoot) != fixtureRoot {
		t.Fatal("explicit safe fixture root required")
	}
	private, e := os.MkdirTemp(os.Getenv("LINK_RECEIVER_CANDIDATE_SOCKET_ROOT"), "PUBLIC-purpose-p08-")
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

	receiver, facts, e := native.PUBLICQualifiedReceiverForP08Test(t, actual)
	if receiver != nil {
		defer func() {
			if err := receiver.Close(); err != nil {
				t.Error("receiver partial cleanup", err)
			}
		}()
	}
	if e != nil {
		t.Fatal("actual receiver-purpose acquisition", e)
	}
	t.Logf("phase=permission-acquired elapsed=%s", time.Since(started))
	owner := local.PUBLICOwnerWithQualifiedReceiverForP08Test(actual, receiver)
	defer func() {
		if err := owner.Close(); err != nil {
			t.Error("concrete Owner cleanup", err)
		}
	}()
	ctx := context.Background()
	authority := &nativeTaskRuntimeAuthority{owner: actual, localOwner: owner}
	prepared := &PreparedOriginalTaskRuntime{authority: authority}
	server := &Server{store: resource.store, toolEffects: &originalRuntimeToolEffects{runtime: prepared, store: resource.store}}
	original, openErr := OpenOriginalTaskReadReceiver(ctx, server)
	if original == nil {
		t.Fatal("normal P08 dropped partial", openErr)
	}
	defer func() {
		_ = original.Retire()
		c, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = original.Join(c)
		_ = original.Close()
	}()
	if openErr != nil || original.registration != owner || original.server == nil || original.listener == nil || !original.started {
		t.Fatalf("normal P08 receiver-purpose candidate: %v %+v", openErr, original)
	}
	t.Logf("phase=normal-listener-started elapsed=%s", time.Since(started))
	socket := original.listener.Addr().String()
	info, e := os.Lstat(socket)
	if e != nil || info.Mode()&os.ModeSocket == 0 {
		t.Fatal("not an actual Unix listener", e)
	}
	conn, e := net.DialUnix("unix", nil, &net.UnixAddr{Name: socket, Net: "unix"})
	if e != nil {
		t.Fatal("same actual LINK socket", e)
	}
	if e = conn.Close(); e != nil {
		t.Fatal("actual client close", e)
	}
	request.Grant, request.Holder = gp, hp
	read := request
	read.AuthorityOperationID = ""
	read.RawInput = nil
	guard, input, e := original.resource.ReadInput(ctx, read)
	if guard == nil {
		t.Fatal("genuine P08 held Source partial", e)
	}
	defer func() { _ = guard.Close() }()
	if e != nil || !bytes.Equal(input, request.RawInput) {
		t.Fatal("actual P08 original input", e)
	}
	if e = original.Retire(); e != nil {
		t.Fatal(e)
	}
	drain, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if e = original.Join(drain); e != nil {
		t.Fatal("actual LINK/HTTP handler drain", e)
	}
	if e = original.Close(); !errors.Is(e, errTaskResourceChildren) {
		t.Fatal("P08 resource child debt not held after real listener drain", e)
	}
	if e = owner.Current(ctx); e != nil {
		t.Fatal("P08 borrower closed original grant parent", e)
	}
	if e = guard.Close(); e != nil {
		t.Fatal("actual P08 Source child release", e)
	}
	if e = original.Close(); e != nil {
		t.Fatal("P08 resource physical close", e)
	}
	t.Logf("phase=listener-and-resource-drained elapsed=%s", time.Since(started))
	// Observe genuine Source current separately AFTER real LINK/P08 cleanup.
	if e = owner.AssertOriginalTaskReadReceiverCurrent(ctx); e != nil {
		t.Fatal("borrower retired receiver-purpose parent", e)
	}
	raw, e := os.ReadFile(filepath.Join(facts, "PUBLIC-facts.json"))
	if e != nil {
		t.Fatal(e)
	}
	var v map[string]any
	if e = json.Unmarshal(raw, &v); e != nil {
		t.Fatal(e)
	}
	v["status"] = "revoked"
	raw, e = json.Marshal(v)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(facts, "PUBLIC-facts.json"), raw, 0600); e != nil {
		t.Fatal(e)
	}
	if e = owner.AssertOriginalTaskReadReceiverCurrent(ctx); e == nil {
		t.Fatal("dynamic soleSDK current revocation accepted")
	}
	if e = owner.Current(ctx); e != nil {
		t.Fatal("optional purpose revoked original grant", e)
	}
	t.Logf("phase=revocation-verified elapsed=%s", time.Since(started))
	if e = owner.Retire(); e != nil {
		t.Fatal(e)
	}
	if e = owner.Join(); e != nil {
		t.Fatal(e)
	}
	if e = owner.Close(); e != nil {
		t.Fatal(e)
	}
	evidence := map[string]any{"candidateNotFrozen": true, "sameConcreteOwner": true, "actualSoleSDKReceiverPurposeMathAndCurrent": true, "actualP08Constructor": true, "actualLINKListenerAndDrain": true, "actualP08SourceDebtAfterLINKDrain": true, "borrowedSourceParentPreserved": true, "dynamicReceiverRevokeRefused": true, "originalGrantCurrentPreserved": true, "productionReleaseRowsModified": false, "zeroArgNormalAdmission": false, "RootAdmission": false, "SourceAdmission": false, "P08BusinessAdmission": false, "PUBLICProjection": file}
	b, e := json.MarshalIndent(evidence, "", "  ")
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(os.Getenv("LINK_QUALIFIED_RECEIVER_EVIDENCE"), "actual-candidate.json"), append(b, '\n'), 0600); e != nil {
		t.Fatal(e)
	}
	t.Log("actual typed-purpose->Owner->P08->LINK listener/drain; PUBLIC candidate only Root=false Source=false")
}
