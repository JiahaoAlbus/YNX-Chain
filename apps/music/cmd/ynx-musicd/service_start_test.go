package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/music"
)

// Refusing local callbacks only; no producer, grant, Wallet or listener.
func TestOriginalMusicSourceRefusalBeforeStateOpen(t *testing.T) {
	root := filepath.Join(t.TempDir(), "not-opened")
	refused := errors.New("original source no longer current")
	calls := 0
	cfg := music.Config{StatePath: filepath.Join(root, "state.json"), MediaDir: filepath.Join(root, "media")}
	svc, err := newOriginalMusicService(cfg, func() error { calls++; return refused })
	if svc != nil || !errors.Is(err, refused) || calls != 1 {
		t.Fatalf("constructor did not retain original refusal: svc=%v calls=%d err=%v", svc, calls, err)
	}
	if _, err = os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("refused source opened state directory: %v", err)
	}
}
