package localipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

// PUBLIC/CONTROLLED original-store and kernel controls, not a registered issuer,
// protected native fence, Root/NAPI capture or production permission.
func resourceFixture(t *testing.T, selected contribution.ResourceIdentity) (*Server, *contribution.Runner, string, ProcessIdentity) {
	t.Helper()
	base := resourceTestBase()
	root, err := os.MkdirTemp(base, "p09rc-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(root) })
	runner, err := contribution.NewDisabled(filepath.Join(root, "resource.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = runner.Close() })
	if err = runner.InitializeCurrentResource(context.Background(), resourcePublic); err != nil {
		t.Fatal(err)
	}
	identity, err := ObserveProcessIdentity(context.Background(), int32(os.Getpid()))
	if err != nil {
		t.Fatal(err)
	}
	server, err := Start(context.Background(), Config{Directory: filepath.Join(root, "ipc"), Handler: func(ctx context.Context, p Peer, r Request) (Result, error) {
		return Result{Status: &Status{Service: "PUBLIC_CONTROLLED", NodeControl: "disabled", ResourceContribution: "disabled"}}, nil
	}, ResourceCurrent: &ResourceCurrentConfig{Runner: runner, SelectedResource: selected, ExpectedClient: identity}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close(context.Background()) })
	return server, runner, root, identity
}

var resourcePublic = contribution.ResourceIdentity{SourceID: "PUBLIC-original", InstanceID: "PUBLIC-own-instance", ResourceKey: "PUBLIC-own-resource"}

func resourceTestBase() string {
	if info, err := os.Stat("/Volumes/西部数据"); err == nil && info.IsDir() {
		return "/Volumes/西部数据"
	}
	if runtime.GOOS == "darwin" {
		return "/private/tmp"
	}
	return "/tmp"
}

func drainRPC(t *testing.T, rpc *ResourceCurrentRPC) {
	t.Helper()
	_ = rpc.Retire(context.Background())
	joined, err := rpc.Join(context.Background())
	if !joined {
		t.Fatal("held join", joined, err)
	}
	closed, err := rpc.Close(context.Background())
	if !closed {
		t.Fatal("held close", closed, err)
	}
}
func heldCount(server *Server) int {
	server.resourceCurrent.mu.Lock()
	defer server.resourceCurrent.mu.Unlock()
	return len(server.resourceCurrent.sessions)
}
func untilNoDebt(t *testing.T, server *Server) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for heldCount(server) != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if heldCount(server) != 0 {
		t.Fatal("original reader debt lost or not drained")
	}
}

func TestResourceCurrentHeldSameKernelConnection(t *testing.T) {
	server, runner, root, identity := resourceFixture(t, resourcePublic)
	before, _ := os.ReadFile(filepath.Join(root, "resource.json"))
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	if rpc == nil || heldCount(server) != 1 {
		t.Fatal("no concrete held original reader")
	}
	first, err := rpc.Current(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	nativeFD := rpc.connection
	session := first.Observation.SessionID
	if first.Authority || first.RegisteredIssuer || first.ProductionEnabled || first.ResourceCurrent == nil || first.ResourceCurrent.Epoch != "1" || first.ResourceCurrent.Sequence != "1" || first.Observation.Server != identity || !first.Observation.Lifetime.PartialAcquired {
		t.Fatalf("invented authority or identity: %+v", first)
	}
	raw, _ := json.Marshal(first.ResourceCurrent)
	var nine map[string]any
	_ = json.Unmarshal(raw, &nine)
	if len(nine) != 9 || first.ResourceCurrent.ExpiresAtMS-first.ResourceCurrent.IssuedAtMS != 20000 {
		t.Fatal("original nine fields/20s changed", string(raw))
	}
	// The original default idle is 3s. Only this actual typed borrow survives it.
	time.Sleep(3200 * time.Millisecond)
	second, err := rpc.Current(context.Background())
	if err != nil || rpc.connection != nativeFD || second.Observation.SessionID != session || heldCount(server) != 1 {
		t.Fatal("redial/reborrow or original idle timeout", err)
	}
	after, _ := os.ReadFile(filepath.Join(root, "resource.json"))
	if !bytes.Equal(before, after) {
		t.Fatal("current read committed or rebound resource")
	}
	drainRPC(t, rpc)
	untilNoDebt(t, server)
	if _, err = rpc.Current(context.Background()); err == nil {
		t.Fatal("closed object rearmed")
	}
	if _, err = runner.ReadCurrentResourceDATA(context.Background()); err != nil {
		t.Fatal("lease close killed Runner", err)
	}
	t.Logf("PUBLIC_CONTROLLED actualOS=%+v sameSession=%s exact9=%s; same fd across >3s, no dispatcher/issuer/fence/Root", identity, session, raw)
}
func TestResourceCurrentIdentityAndSelectionRefusals(t *testing.T) {
	server, _, _, identity := resourceFixture(t, resourcePublic)
	for _, tc := range []struct {
		name string
		edit func(*ProcessIdentity)
	}{
		{"wrong-pid", func(p *ProcessIdentity) { p.PID++ }},
		{"wrong-start-incarnation", func(p *ProcessIdentity) { p.StartIdentity += "-not-this-start" }},
		{"wrong-image-bytes", func(p *ProcessIdentity) { p.ImageSHA256 = strings.Repeat("0", 64) }},
		{"wrong-image-path", func(p *ProcessIdentity) { p.ImagePath = "/bin/sh" }},
		{"wrong-uid", func(p *ProcessIdentity) { p.UID++ }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			expected := identity
			tc.edit(&expected)
			rpc, err := OpenResourceCurrent(context.Background(), server.directory, expected, resourcePublic)
			if err == nil || rpc != nil || heldCount(server) != 0 {
				t.Fatal("wrong actual Go identity borrowed reader", rpc, err)
			}
		})
	}
	if rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, contribution.ResourceIdentity{}); err == nil || rpc != nil {
		t.Fatal("empty selected ref supplied Root")
	}
	foreign := resourcePublic
	foreign.ResourceKey = "PUBLIC-foreign"
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, foreign)
	if err == nil || rpc == nil {
		t.Fatal("wrong client-selected resource must retain failed actual borrow", err)
	}
	_ = rpc.connection.Close()
	untilNoDebt(t, server)
}
func TestResourceCurrentPartialFaultSameReaderAndDisconnectUnknown(t *testing.T) {
	server, _, root, identity := resourceFixture(t, resourcePublic)
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	server.resourceCurrent.mu.Lock()
	var original *resourceCurrentSession
	for lease := range server.resourceCurrent.sessions {
		original = lease
	}
	server.resourceCurrent.mu.Unlock()
	if err = os.WriteFile(filepath.Join(root, "resource.json"), []byte("PUBLIC malformed original store"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = rpc.Current(context.Background()); err == nil {
		t.Fatal("tampered original current accepted")
	}
	if heldCount(server) != 1 || original.reader == nil {
		t.Fatal("partial original reader dropped")
	}
	_ = rpc.Retire(context.Background())
	if _, err = rpc.Current(context.Background()); err == nil {
		t.Fatal("retired failed reader rearmed")
	}
	drainRPC(t, rpc)
	untilNoDebt(t, server)
	server2, _, _, identity2 := resourceFixture(t, resourcePublic)
	lost, err := OpenResourceCurrent(context.Background(), server2.directory, identity2, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	_ = lost.connection.Close()
	_, err = lost.Current(context.Background())
	if err == nil {
		t.Fatal("disconnected session redialed")
	}
	untilNoDebt(t, server2)
	if complete, err := lost.Close(context.Background()); complete || !errors.Is(err, ErrResourceRemoteUnknown) {
		t.Fatal("closed socket falsely proved remote physical close", complete, err)
	}
}
func TestResourceCurrentRootSelectedStoreMismatchPartial(t *testing.T) {
	selected := resourcePublic
	selected.InstanceID = "PUBLIC-other-incarnation"
	server, _, _, identity := resourceFixture(t, selected)
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, selected)
	if err == nil || rpc == nil {
		t.Fatal("wrong host-selected store allowed", err)
	}
	rpc.mu.Lock()
	partial := rpc.last.Observation != nil && rpc.last.Observation.Lifetime.PartialAcquired
	rpc.mu.Unlock()
	if !partial {
		t.Fatal("nonnull reader on store mismatch lost")
	}
	drainRPC(t, rpc)
	untilNoDebt(t, server)
}
func TestResourceCurrentFamilyCannotInitializeOrSwitchProtocol(t *testing.T) {
	server, _, _, identity := resourceFixture(t, resourcePublic)
	for _, operation := range []string{"resource_current", "resource_current_retire", "resource_current_join", "resource_current_close"} {
		for _, raw := range []string{`{"resourceKey":"other"}`, `{"pid":1}`, `{"imageSHA256":"self-report"}`, `{"allow":true}`, `{"epoch":"17"}`} {
			if _, err := Call(context.Background(), server.directory, Request{Version: Version, ID: "public_reject", Operation: operation, Payload: json.RawMessage(raw)}); err == nil {
				t.Fatal("wire initializer/identity accepted", operation, raw)
			}
		}
	}
	if heldCount(server) != 0 {
		t.Fatal("malformed payload acquired original")
	}
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = rpc.roundTrip(context.Background(), "resource_current_init"); err == nil {
		t.Fatal("new initializer allowed")
	}
	_ = rpc.connection.Close()
	untilNoDebt(t, server)
}

func TestResourceCurrentOrdinaryConnectionKeepsThreeSecondIdle(t *testing.T) {
	server, _, _, _ := resourceFixture(t, resourcePublic)
	connection, err := net.Dial("unix", server.SocketPath())
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	buffer := bufio.NewReader(connection)
	raw, _ := json.Marshal(Request{Version: Version, ID: "ordinary_status", Operation: "status"})
	request, _ := http.NewRequest(http.MethodPost, "http://localipc/v1/call", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	if err = request.Write(connection); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(buffer, request)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if heldCount(server) != 0 {
		t.Fatal("ordinary status borrowed resource")
	}
	time.Sleep(3200 * time.Millisecond)
	_ = connection.SetDeadline(time.Now().Add(time.Second))
	err = request.Write(connection)
	if err == nil {
		_, err = http.ReadResponse(buffer, request)
	}
	if err == nil {
		t.Fatal("ordinary unselected connection gained extended idle")
	}
}

func TestResourceCurrentCancelledReadNeverRearmsSameRPC(t *testing.T) {
	server, _, _, identity := resourceFixture(t, resourcePublic)
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err = rpc.Current(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation lost", err)
	}
	if _, err = rpc.Current(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatal("failed current rearmed or lost firstcause", err)
	}
	if heldCount(server) != 1 {
		t.Fatal("same held reader replaced")
	}
	drainRPC(t, rpc)
	untilNoDebt(t, server)
}

func TestResourceCurrentMalformedHeldFrameCannotReborrow(t *testing.T) {
	server, _, _, identity := resourceFixture(t, resourcePublic)
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	session := rpc.session
	raw, _ := json.Marshal(Request{Version: Version, ID: "held_bad_frame", Operation: "resource_current", Payload: json.RawMessage(`{"epoch":"caller-cannot-select"}`)})
	request, _ := http.NewRequest(http.MethodPost, "http://localipc/v1/call", bytes.NewReader(raw))
	request.Header.Set("Content-Type", "application/json")
	if err = request.Write(rpc.connection); err != nil {
		t.Fatal(err)
	}
	response, err := http.ReadResponse(rpc.buffer, request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	var denied Response
	_ = json.Unmarshal(body, &denied)
	if denied.Code != "DENIED" {
		t.Fatal("bad held frame not refused", string(body))
	}
	untilNoDebt(t, server)
	if _, err = rpc.Current(context.Background()); err == nil {
		t.Fatal("malformed original read rearmed concrete borrow")
	}
	if rpc.session != session || heldCount(server) != 0 {
		t.Fatal("failed same connection reborrowed")
	}
	drainRPC(t, rpc)
}

func TestResourceCurrentClosedBorrowRevertsOriginalIdle(t *testing.T) {
	server, _, _, identity := resourceFixture(t, resourcePublic)
	rpc, err := OpenResourceCurrent(context.Background(), server.directory, identity, resourcePublic)
	if err != nil {
		t.Fatal(err)
	}
	defer rpc.connection.Close()
	if err = rpc.Retire(context.Background()); err != nil {
		t.Fatal(err)
	}
	if joined, e := rpc.Join(context.Background()); !joined || e != nil {
		t.Fatal(joined, e)
	}
	closed, e := rpc.roundTrip(context.Background(), "resource_current_close")
	if e != nil || !closed.Observation.Lifetime.PhysicalComplete {
		t.Fatal("real borrow not closed", e)
	}
	untilNoDebt(t, server)
	time.Sleep(3200 * time.Millisecond)
	if _, err = rpc.roundTrip(context.Background(), "resource_current_close"); err == nil {
		t.Fatal("closed borrow retained longer idle privilege")
	}
}
