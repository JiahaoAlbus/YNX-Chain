package chain

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestStartWithPauseKeepsHeightStableAndResumes(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	initial := devnet.LatestHeight()
	var paused atomic.Bool
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go devnet.StartWithPause(ctx, 5*time.Millisecond, paused.Load)

	waitForHeightAbove(t, devnet, initial)
	paused.Store(true)
	time.Sleep(20 * time.Millisecond)
	stable := devnet.LatestHeight()
	time.Sleep(30 * time.Millisecond)
	if got := devnet.LatestHeight(); got != stable {
		t.Fatalf("height advanced while paused: %d -> %d", stable, got)
	}
	paused.Store(false)
	waitForHeightAbove(t, devnet, stable)
}

func waitForHeightAbove(t *testing.T, devnet *Devnet, height uint64) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if devnet.LatestHeight() > height {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("height did not advance above %d", height)
}
