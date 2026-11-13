package productreadsource

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestShopV4CanceledRequestDoesNotRetireSource(t *testing.T) {
	a := publicAuthority("/public/unused")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := a.Current(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if a.retired.Load() || a.first != nil {
		t.Fatal("request cancellation retired shared authority")
	}
	if err := a.atomicCurrent(context.Background(), nil); err != nil {
		t.Fatal("other request lost current after cancellation", err)
	}
}

func TestShopV4CancellationDoesNotMaskHeldFileFailure(t *testing.T) {
	a := publicAuthority("/public/unused")
	dir := ownedProtectedFixture(t)
	path := filepath.Join(dir, "original")
	raw := []byte("PUBLIC original file")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	a.files.uid = uint32(os.Geteuid())
	if _, err := a.files.hold(path, rawDigest(raw), int64(len(raw))); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close() })
	if err := os.Rename(path, filepath.Join(dir, "saved")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	first := a.Current(ctx)
	if !errors.Is(first, ErrDenied) || !a.retired.Load() || a.first != first {
		t.Fatal("real held file substitution lost to canceled request", first)
	}
}

func TestShopV4SharedParentCancellationStillRetiresSource(t *testing.T) {
	a := publicAuthority("/public/unused")
	ctx, cancel := context.WithCancel(context.Background())
	a.parent = ctx
	cancel()
	first := a.Current(ctx)
	if !errors.Is(first, context.Canceled) || !a.retired.Load() || a.first != first {
		t.Fatal("shared parent cancellation must retire its own Source", first)
	}
}

type originalVerifierStarted struct{ seen chan struct{} }

func (w originalVerifierStarted) Write(b []byte) (int, error) {
	select {
	case w.seen <- struct{}{}:
	default:
	}
	return len(b), nil
}

func TestShopV4OriginalVerifierCancellationAndExitStayDistinct(t *testing.T) {
	request, cancelRequest := context.WithCancel(context.Background())
	defer cancelRequest()
	call, cancelCall := context.WithTimeout(request, 4*time.Second)
	defer cancelCall()
	cmd := exec.CommandContext(call, "/bin/sh", "-c", "printf started; exec sleep 10")
	seen := make(chan struct{}, 1)
	cmd.Stdout = originalVerifierStarted{seen}
	done := make(chan error, 1)
	go func() { done <- runOriginalSourceVerifier(request, call, cmd) }()
	select {
	case <-seen:
		cancelRequest()
	case err := <-done:
		t.Fatal("original test verifier did not start", err)
	case <-call.Done():
		t.Fatal("no original verifier start witness")
	}
	if err := <-done; err != context.Canceled || cmd.ProcessState == nil {
		t.Fatal("canceled process must physically drain with original request cause", err)
	}

	live := context.Background()
	timed, stop := context.WithTimeoutCause(live, time.Millisecond, errOriginalVerifierTimeout)
	defer stop()
	<-timed.Done()
	if err := runOriginalSourceVerifier(live, timed, exec.CommandContext(timed, "/bin/sh", "-c", "exit 0")); !errors.Is(err, ErrDenied) {
		t.Fatal("independent verifier timeout is not request cancellation", err)
	}
	if err := runOriginalSourceVerifier(live, live, exec.CommandContext(live, "/bin/sh", "-c", "exit 9")); !errors.Is(err, ErrDenied) {
		t.Fatal("independent verifier failure is not request cancellation", err)
	}
}

func TestShopV4SourceVerifierUnknownDoesNotReleaseAuthority(t *testing.T) {
	a := publicAuthority("/public/unused")
	first := &publicZeroCloseError{0}
	a.sourceVerifierUnknown = true
	a.fail(first)
	for i := 0; i < 2; i++ {
		if err := a.Close(); err != first {
			t.Fatal("lost original first cause", err)
		}
		if err := a.AssertOriginalClosed(); !errors.Is(err, ErrUnknown) || a.files.closeSelected {
			t.Fatal("unknown verifier debt cannot select FD close", err)
		}
	}
}
