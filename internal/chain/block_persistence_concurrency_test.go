package chain

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestProduceBlockKeepsConcurrentReadsAvailableDuringCheckpoint(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	for range 100_000 {
		devnet.ProduceBlock()
	}
	devnet.dataDir = t.TempDir()

	done := make(chan struct{})
	go func() {
		devnet.ProduceBlock()
		close(done)
	}()

	tmpPath := filepath.Join(devnet.dataDir, "devnet-state.json.tmp")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if info, err := os.Stat(tmpPath); err == nil && info.Size() > 0 {
			break
		}
		select {
		case <-done:
			t.Fatal("checkpoint completed before concurrent-read probe observed durable output")
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("checkpoint did not begin in time")
		}
		time.Sleep(time.Millisecond)
	}

	started := time.Now()
	status := devnet.Status()
	if elapsed := time.Since(started); elapsed > 250*time.Millisecond {
		t.Fatalf("status read was blocked by checkpoint for %s", elapsed)
	}
	if status["height"].(uint64) != 100_001 {
		t.Fatalf("status did not observe committed in-memory block: %v", status)
	}
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("checkpoint did not complete")
	}
}
