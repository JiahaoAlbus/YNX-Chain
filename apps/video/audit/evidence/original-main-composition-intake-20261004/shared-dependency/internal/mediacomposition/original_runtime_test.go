//go:build ynx_canonical_media && ynx_media_combined_authority

package mediacomposition

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
	"testing"
)

func TestOriginalMediaInputsRefusePartialAndUnboundSource(t *testing.T) {
	ctx := context.Background()
	if p, e := PrepareOriginalVideo(ctx, nil); p != nil || e != nil {
		t.Fatalf("public-only: %v %v", p, e)
	}
	if p, e := PrepareOriginalMusic(ctx, nil); p != nil || e != nil {
		t.Fatalf("public-only: %v %v", p, e)
	}
	if _, e := PrepareOriginalVideo(ctx, &VideoInputs{}); e == nil {
		t.Fatal("partial video inputs accepted")
	}
	if _, e := PrepareOriginalMusic(ctx, &MusicInputs{}); e == nil {
		t.Fatal("partial music inputs accepted")
	}
	if e := sourceCheck(&productsessionv2.RegisteredClientSet{})(); e == nil {
		t.Fatal("unbound reader treated as provenance")
	}
	cancelCtx, cancel := context.WithCancel(ctx)
	cancel()
	if _, e := PrepareOriginalVideo(cancelCtx, nil); !errors.Is(e, context.Canceled) {
		t.Fatalf("video cancel: %v", e)
	}
	if _, e := PrepareOriginalMusic(cancelCtx, nil); !errors.Is(e, context.Canceled) {
		t.Fatalf("music cancel: %v", e)
	}
}
func TestOriginalMediaActorGuardChecksSourceAfterActor(t *testing.T) {
	closed := errors.New("source revoked")
	live := true
	calls := 0
	source := func() error {
		if !live {
			return closed
		}
		return nil
	}
	actor := func(context.Context) error { calls++; live = false; return nil }
	if e := actorGuard(context.Background(), source, actor); !errors.Is(e, closed) {
		t.Fatalf("actor changed source but guard returned %v", e)
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	if e := actorGuard(context.Background(), source, actor); !errors.Is(e, closed) || calls != 1 {
		t.Fatal("pre-effect source refusal failed")
	}
	if e := actorGuard(context.Background(), func() error { return nil }, nil); e == nil {
		t.Fatal("missing actor accepted")
	}
}
