//go:build (linux || darwin) && ynx_public_trace_testsupport && ynx_current4_auth_interop

package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

type current4InteropOutput struct{ data []byte }

func (b *current4InteropOutput) Write(p []byte) (int, error) {
	if len(p) > 32768-len(b.data) {
		return 0, errors.New("PUBLIC interop output exceeds bound")
	}
	b.data = append(b.data, p...)
	return len(p), nil
}

func current4InteropOriginals(t *testing.T) {
	t.Helper()
	dir := filepath.Join("testdata", "current4_auth_r2")
	raw, err := os.ReadFile(filepath.Join(dir, "PROVENANCE.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		ForeignSources []struct {
			File     string
			Bytes    int
			SHA256   string
			Verbatim bool
		}
	}
	if json.Unmarshal(raw, &manifest) != nil || len(manifest.ForeignSources) != 7 {
		t.Fatal("original Auth/SDK closed source provenance missing")
	}
	required := map[string]string{
		"Current4WireClient.cpp":                   "039aa90079102a5fb66ad376cc659f9971e09d1f32f5cc6595deb0a77a18d107",
		"Current4WireClient.hpp":                   "f8ed5dc77e06ac70bf224a2816deaaa4db9b25173b4d135a8d2b51e58c5f3424",
		"network-consent-policy-current-wire-v1.h": "1197965ac26958a39f65b0314c2779f6046bafbe583a9959c78b6a335b460487",
	}
	seen := map[string]bool{}
	for _, p := range manifest.ForeignSources {
		if !p.Verbatim || filepath.Base(p.File) != p.File || seen[p.File] {
			t.Fatal("foreign Auth source role differs")
		}
		seen[p.File] = true
		b, err := os.ReadFile(filepath.Join(dir, p.File))
		sum := sha256.Sum256(b)
		if err != nil || len(b) != p.Bytes || hex.EncodeToString(sum[:]) != p.SHA256 {
			t.Fatal("original Auth source changed", p.File)
		}
		if fixed, ok := required[p.File]; ok && fixed != p.SHA256 {
			t.Fatal("formal Auth/SDK pin changed", p.File)
		}
	}
	for name := range required {
		if !seen[name] {
			t.Fatal("formal Auth/SDK source absent", name)
		}
	}
}

func current4InteropEndpoint(t *testing.T, f *publicTraceObserver, ctx context.Context) (*pqCurrent4Wire, *os.File) {
	t.Helper()
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if err != nil {
		t.Fatal(err)
	}
	unix.CloseOnExec(fds[0])
	unix.CloseOnExec(fds[1])
	left := os.NewFile(uintptr(fds[0]), "PUBLIC original Go Current4 endpoint")
	right := os.NewFile(uintptr(fds[1]), "PUBLIC Auth r2 inherited endpoint")
	t.Cleanup(func() { _ = left.Close(); _ = right.Close() })
	s, err := f.app.WalletPolicyLiveSource()
	if err != nil {
		t.Fatal(err)
	}
	// The OS credential on an inherited socketpair identifies its creator.
	// This PUBLIC harness independently expects its own creator PID/UID; it
	// DOES NOT prove the subsequently exec'd C++ image or Root-qualified peer.
	w, err := attachPQCurrent4Wire(ctx, s, left, pqCurrent4Peer{uint32(os.Getuid()), int32(os.Getpid())})
	if w != nil {
		t.Cleanup(func() { _ = w.closeWalletPolicyCurrent4Child() })
	}
	if err != nil || w == nil {
		t.Fatal("real Core producer partial/open", err)
	}
	return w, right
}

func TestPQCurrent4WirePUBLICAuthR2CrossProcessInterop(t *testing.T) {
	current4InteropOriginals(t)
	binaryPath := os.Getenv("YNX_CURRENT4_AUTH_R2_INTEROP_BINARY")
	if !filepath.IsAbs(binaryPath) {
		t.Fatal("explicit test-only compiled original Auth r2 binary required")
	}
	st, err := os.Lstat(binaryPath)
	if err != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0111 == 0 {
		t.Fatal("original Auth r2 executable is not a regular test artifact")
	}
	trace := os.Getenv("YNX_PUBLIC_REGISTERED_OBSERVER_TRACE")
	// Two independent original PUBLIC homes are constructed BEFORE any joint
	// request. Each stays alive for its complete channel; no shared Node is
	// restarted to obtain another CAPTURE slot. The unchanged helper performs
	// actual BlockExecutor/engine-store validation and original cold loading.
	positive := openPublicTraceObserver(t, trace)
	denied := openPublicTraceObserver(t, trace)
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	s, err := positive.app.WalletPolicyLiveSource()
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := s.Read(ctx, positive.expected.Owner)
	if err != nil {
		t.Fatal(err)
	}
	v, err := sealed.OwnerPolicy()
	if err != nil {
		t.Fatal(err)
	}
	other, err := denied.app.WalletPolicyLiveSource()
	if err != nil {
		t.Fatal(err)
	}
	sealedOther, err := other.Read(ctx, denied.expected.Owner)
	if err != nil {
		t.Fatal(err)
	}
	ov, err := sealedOther.OwnerPolicy()
	if err != nil || v.Owner != ov.Owner || v.NetworkID != ov.NetworkID || v.ExecutionHeight != ov.ExecutionHeight || !bytes.Equal(v.PolicyOriginal, ov.PolicyOriginal) {
		t.Fatal("independent PUBLIC sources differ", err)
	}
	expected := t.TempDir()
	height := make([]byte, 8)
	binary.BigEndian.PutUint64(height, v.ExecutionHeight)
	for name, data := range map[string][]byte{"network.bin": v.NetworkID[:], "owner.bin": []byte(v.Owner), "height.bin": height, "policy.bin": v.PolicyOriginal} {
		if err = os.WriteFile(filepath.Join(expected, name), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	w1, fd1 := current4InteropEndpoint(t, positive, ctx)
	w2, fd2 := current4InteropEndpoint(t, denied, ctx)
	cmd := exec.CommandContext(ctx, binaryPath, expected)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C"}
	cmd.ExtraFiles = []*os.File{fd1, fd2} // TEST ONLY fixed slots 3 and 4.
	stdout, stderr := &current4InteropOutput{}, &current4InteropOutput{}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if err = cmd.Start(); err != nil {
		t.Fatal("original Auth r2 exec", err)
	}
	childPID := cmd.Process.Pid
	if childPID == os.Getpid() {
		t.Fatal("not a foreign process")
	}
	_ = fd1.Close()
	_ = fd2.Close() // parent cannot retain the client's transport debt
	if err = cmd.Wait(); err != nil {
		t.Fatalf("actual Auth r2 process failed: %v; bounded diagnostics: %s", err, stderr.data)
	}
	current4Wait(t, w1)
	current4Wait(t, w2)
	const want = "PASS original-auth-r2-to-real-core-policy-and-cleanup\nPASS original-auth-r2-code0-partial-denial-and-cleanup\n"
	if string(stdout.data) != want || len(stderr.data) != 0 {
		t.Fatal("actual original Auth joint outcomes differ")
	}
	if w1.sequence != 6 || w1.cause() != nil || w2.sequence != 4 || !errors.Is(w2.cause(), errPQCurrent4Binding) {
		t.Fatal("foreign producer operations/first failure differ; denial latch sent an extra operation")
	}
	if positive.node == nil || denied.node == nil || positive.node.IsRunning() || denied.node.IsRunning() {
		t.Fatal("joint test started/replaced an original Node")
	}
	// CLOSE did not close shared Node/App/source. The next ordinary DATA read
	// uses that very same source (no replacement channel or observer restart).
	again, err := s.Read(ctx, v.Owner)
	if err != nil {
		t.Fatal("foreign close retired shared parent", err)
	}
	av, err := again.OwnerPolicy()
	if err != nil || !bytes.Equal(av.PolicyOriginal, v.PolicyOriginal) {
		t.Fatal("shared parent changed", err)
	}
	artifact, err := os.ReadFile(binaryPath)
	if err != nil {
		t.Fatal(err)
	}
	artifactSum, policySum := sha256.Sum256(artifact), sha256.Sum256(v.PolicyOriginal)
	receipt := map[string]any{"PUBLIC": true, "parentPID": os.Getpid(), "cppPID": childPID, "distinctProcesses": true, "policyBytes": len(v.PolicyOriginal), "policySHA256": hex.EncodeToString(policySum[:]), "executionHeight": fmt.Sprint(v.ExecutionHeight), "cppSHA256": hex.EncodeToString(artifactSum[:]), "positiveOps": w1.sequence, "deniedOps": w2.sequence, "sourceNodesStarted": 0, "RootQualifiedPeer": false, "NativeCurrent": false, "formalP09Slot": false, "positiveAndPartialCleanupAcknowledged": true}
	raw, err := json.Marshal(receipt)
	if err != nil {
		t.Fatal(err)
	}
	t.Log("YNX_CURRENT4_AUTH_R2_PUBLIC_INTEROP " + strings.TrimSpace(string(raw)))
}
