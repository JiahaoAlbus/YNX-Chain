package aiproduct

import (
	"context"
	"errors"
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
