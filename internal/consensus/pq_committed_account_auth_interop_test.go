//go:build darwin && ynx_public_trace_testsupport && ynx_account_auth_interop

package consensus

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	cmtjson "github.com/cometbft/cometbft/libs/json"
	"golang.org/x/sys/unix"
)

type accountAuthOutput struct{ b []byte }

func (b *accountAuthOutput) Write(p []byte) (int, error) {
	if len(p) > 32768-len(b.b) {
		return 0, errors.New("PUBLIC Auth output exceeds bound")
	}
	b.b = append(b.b, p...)
	return len(p), nil
}
func accountAuthForeign(t *testing.T) {
	t.Helper()
	base := filepath.Join("testdata", "account_auth_interop")
	raw, e := os.ReadFile(filepath.Join(base, "PROVENANCE.json"))
	if e != nil {
		t.Fatal(e)
	}
	var manifest struct {
		AuthFinalH              struct{ SHA256 string }
		All68SourcePinsVerified bool
		Copied                  []struct {
			Path     string
			Bytes    int
			SHA256   string
			Verbatim bool
		}
	}
	if json.Unmarshal(raw, &manifest) != nil || manifest.AuthFinalH.SHA256 != "ff6bf6bc34fc0e82665ab7399da900dea816a680a6c30f4b1f48a2e3e949b987" || !manifest.All68SourcePinsVerified || len(manifest.Copied) != 33 {
		t.Fatal("Auth final68 provenance missing")
	}
	for _, p := range manifest.Copied {
		if !p.Verbatim || !filepath.IsLocal(p.Path) {
			t.Fatal("foreign path")
		}
		b, e := os.ReadFile(filepath.Join(base, p.Path))
		sum := sha256.Sum256(b)
		if e != nil || len(b) != p.Bytes || hex.EncodeToString(sum[:]) != p.SHA256 {
			t.Fatal("Auth original changed", p.Path)
		}
	}
}
func accountAuthFixture(t *testing.T) string {
	t.Helper()
	out := t.TempDir()
	if e := os.Chmod(out, 0700); e != nil {
		t.Fatal(e)
	}
	for _, d := range []string{"public", "journal", "slot"} {
		if e := os.Mkdir(filepath.Join(out, d), 0700); e != nil {
			t.Fatal(e)
		}
	}
	source := filepath.Join("testdata", "account_auth_interop", "auth-public-fixture")
	if e := filepath.WalkDir(source, func(p string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.IsDir() {
			return nil
		}
		rel, e := filepath.Rel(source, p)
		if e != nil {
			return e
		}
		b, e := os.ReadFile(p)
		if e != nil {
			return e
		}
		return os.WriteFile(filepath.Join(out, rel), b, 0600)
	}); e != nil {
		t.Fatal(e)
	}
	return out
}
func accountAuthPair(t *testing.T) (*os.File, *os.File) {
	t.Helper()
	fds, e := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM, 0)
	if e != nil {
		t.Fatal(e)
	}
	for _, fd := range fds {
		unix.CloseOnExec(fd)
	}
	a, b := os.NewFile(uintptr(fds[0]), "PUBLIC account test host"), os.NewFile(uintptr(fds[1]), "PUBLIC Auth inherited client")
	t.Cleanup(func() { _ = a.Close(); _ = b.Close() })
	return a, b
}
func accountAuthAttach(t *testing.T, f *committedTraceObserver, ctx context.Context, owner string) (*pqCommittedAccountWire, *os.File) {
	t.Helper()
	a, b := accountAuthPair(t)
	w, e := attachPQCommittedAccountWire(ctx, f.app, owner, a, pqAccountWirePeer{uid: uint32(os.Getuid()), pid: int32(os.Getpid())})
	if w != nil {
		t.Cleanup(func() { _ = w.closeWalletPolicyAccountProofChild() })
	}
	if e != nil {
		t.Fatal("actual Go account wire", e)
	}
	return w, b
}
func accountAuthExpected(t *testing.T, f *committedTraceObserver) string {
	t.Helper()
	dir := t.TempDir()
	s, e := f.app.WalletPolicyLiveSource()
	if e != nil {
		t.Fatal(e)
	}
	r, e := s.Read(context.Background(), f.expected.Owner)
	if e != nil {
		t.Fatal(e)
	}
	v, e := r.OwnerPolicy()
	if e != nil || v.ExecutionRegistration == nil {
		t.Fatal("original PUBLIC account", e)
	}
	cp, e := r.Checkpoint()
	if e != nil {
		t.Fatal(e)
	}
	data := map[string][]byte{"apphash.bin": cp.AppHash[:], "policy.bin": v.PolicyOriginal, "pka.bin": v.ExecutionRegistration.PKA, "pkb.bin": v.ExecutionRegistration.PKB}
	for h, n := range map[int64]string{10: "block10.bin", 11: "block11.bin"} {
		lb, e := DecodePQTrustedLightBlock(f.rows[h-f.receipt.FirstHeight].LightBlock)
		if e != nil {
			t.Fatal(e)
		}
		b, e := cmtjson.Marshal(lb)
		if e != nil {
			t.Fatal(e)
		}
		data[n] = b
	}
	for n, b := range data {
		if e := os.WriteFile(filepath.Join(dir, n), b, 0600); e != nil {
			t.Fatal(e)
		}
	}
	return dir
}
func accountAuthBinary(t *testing.T, key string) string {
	t.Helper()
	p := os.Getenv(key)
	st, e := os.Lstat(p)
	if !filepath.IsAbs(p) || e != nil || !st.Mode().IsRegular() || st.Mode().Perm()&0111 == 0 {
		t.Fatal("explicit original Auth test binary required", key)
	}
	return p
}
func accountAuthRun(t *testing.T, ctx context.Context, binary, mode, fixture, expected string, files []*os.File, control *net.UnixConn, f *committedTraceObserver, workers []*pqCommittedAccountWire) {
	t.Helper()
	cmd := exec.CommandContext(ctx, binary, mode, expected)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LC_ALL=C", "GOMAXPROCS=2", "GOMEMLIMIT=1536MiB", "PUBLIC_RECEIPT_FIXTURE=" + fixture}
	cmd.ExtraFiles = files
	out, errout := &accountAuthOutput{}, &accountAuthOutput{}
	cmd.Stdout = out
	cmd.Stderr = errout
	if e := cmd.Start(); e != nil {
		t.Fatal(e)
	}
	for _, fd := range files {
		_ = fd.Close()
	}
	// Only this test control socket coordinates actual existing BlockExecutor.
	// No control byte is part of the account protocol or a production P09 slot.
	if mode == "joint" {
		for _, height := range []int64{11, 12} {
			var c [1]byte
			if _, e := io.ReadFull(control, c[:]); e != nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				t.Fatal("Auth did not reach original continuation", e, string(out.b), string(errout.b))
			}
			if c[0] != byte('B'+height-11) {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				t.Fatal("unexpected PUBLIC continuation signal")
			}
			f.advance(t, height)
			if _, e := control.Write(c[:]); e != nil {
				_ = cmd.Process.Kill()
				_ = cmd.Wait()
				t.Fatal(e)
			}
		}
	}
	e := cmd.Wait()
	if e != nil {
		t.Fatal("actual Auth CPP joint", mode, e, string(out.b), string(errout.b))
	}
	if !bytes.HasPrefix(out.b, []byte("PASS ")) {
		t.Fatal("actual client success marker absent")
	}
	for _, w := range workers {
		accountWireWait(t, w)
		if !accountWireHandler(t, w).IsClosed() {
			t.Fatal("actual Go reader physical debt remains")
		}
	}
	t.Log(strings.TrimSpace(string(out.b)))
}
func TestPQCommittedAccountPUBLICAuthFinalR1Joint(t *testing.T) {
	accountAuthForeign(t)
	binary := accountAuthBinary(t, "YNX_ACCOUNT_AUTH_INTEROP_BINARY")
	root0 := accountAuthBinary(t, "YNX_ACCOUNT_AUTH_ROOT0_BINARY")
	fixture := accountAuthFixture(t)
	f := committedAccountFixture(t, "atomic-json", 10)
	node := f.node
	expected := accountAuthExpected(t, f)
	t.Run("OriginalClientNotReadyReadyAndReceiptMismatch", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		a, fd1 := accountAuthAttach(t, f, ctx, f.expected.Owner)
		b, fd2 := accountAuthAttach(t, f, ctx, f.expected.Owner)
		ctl, fd3 := accountAuthPair(t)
		c, e := net.FileConn(ctl)
		_ = ctl.Close()
		if e != nil {
			t.Fatal(e)
		}
		u := c.(*net.UnixConn)
		defer u.Close()
		_ = u.SetDeadline(time.Now().Add(35 * time.Second))
		accountAuthRun(t, ctx, binary, "joint", fixture, expected, []*os.File{fd1, fd2, fd3}, u, f, []*pqCommittedAccountWire{a, b})
		if f.node != node || f.app.committed.Height != 12 {
			t.Fatal("shared Node replaced")
		}
	})
	t.Run("OriginalPairedZeroPartialPhysicalDrain", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		a, fd := accountAuthAttach(t, f, ctx, "0x1111111111111111111111111111111111111111")
		accountAuthRun(t, ctx, binary, "paired0", fixture, expected, []*os.File{fd}, nil, f, []*pqCommittedAccountWire{a})
		if a.cause() == nil {
			t.Fatal("failed capture first cause lost")
		}
	})
	t.Run("UnmodifiedProductionRoot0RefusesBeforeHost", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		accountAuthRun(t, ctx, root0, "root0", fixture, expected, nil, nil, f, nil)
	})
}
