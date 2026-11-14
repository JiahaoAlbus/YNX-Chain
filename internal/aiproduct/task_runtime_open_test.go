package aiproduct

import (
	"context"
	"errors"
	"strings"
	"testing"

	native "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-runtime/go"
)

func TestP08NormalTaskRuntimeOriginalFactoriesAndPartialClose(t *testing.T) {
	owner, err := OpenOriginalTaskRuntime(context.Background(), TaskModelConfig{})
	// Actual original release tables remain empty. A valid model config, an
	// env toggle or fixture login cannot supply an admitted protected producer.
	if owner == nil || !errors.Is(err, native.ErrUnavailable) {
		t.Fatalf("original unadmitted runtime acquired: owner=%t error=%v", owner != nil, err)
	}
	for _, stage := range []string{"effect grant", "history grant", "protected caller"} {
		if !strings.Contains(err.Error(), "original AI task "+stage+":") {
			t.Fatalf("missing startup stage %q: %v", stage, err)
		}
	}
	if owner.model != nil || owner.authority != nil || owner.broker != nil {
		t.Fatal("partial Source acquisition installed model or task effects")
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	var absent *PreparedOriginalTaskRuntime
	if err := absent.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestP08NormalTaskRuntimeCancellationBeforeAcquisition(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	owner, err := OpenOriginalTaskRuntime(ctx, TaskModelConfig{})
	if owner == nil || !errors.Is(err, context.Canceled) || owner.owners.native != nil || owner.owners.client != nil {
		t.Fatalf("cancelled startup acquired custody: %v", err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestP08NormalLocalCustodyRetainsBothFailedOriginalAcquisitions(t *testing.T) {
	owner, err := OpenOriginalTaskRuntime(context.Background(), TaskModelConfig{})
	if !errors.Is(err, native.ErrUnavailable) || owner == nil || owner.owners.native == nil {
		t.Fatalf("empty normal acquisition changed: %v", err)
	}
	local := owner.owners.native
	if local.localOwner == nil || local.localHistory == nil || !errors.Is(local.localAcquireError, native.ErrUnavailable) || !errors.Is(local.localHistoryAcquireError, native.ErrUnavailable) {
		t.Fatal("normal local effect/history partial or original failure lost")
	}
	if err := local.localOwner.Current(context.Background()); !errors.Is(err, native.ErrUnavailable) {
		t.Fatal("local OS accessibility became TaskGrant", err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
	if err := owner.Close(); err != nil {
		t.Fatal(err)
	}
}
