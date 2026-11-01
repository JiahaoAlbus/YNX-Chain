package main_test

import (
	"context"
	"os/exec"
	"testing"
	"time"
)

// Original helper CI entry covers the native transport guards and web caller.
// The Darwin runner explicitly reports unsupported platforms; it opens no GUI.
func TestNetworkNativeBridgeModule(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "node", "--test", "../../apps/network/qa/native-bridge.test.mjs", "../../apps/network/web/native-bridge.test.mjs")
	if raw, err := command.CombinedOutput(); err != nil {
		t.Fatalf("original Native bridge transport: %v %s", err, raw)
	}
}
