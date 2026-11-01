package main

import (
	"context"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"os"
	"path/filepath"
	"testing"
)

func TestNetworkResourceCurrentHostNeverInitializesOrSuppliesRoot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resource.json")
	runner, err := contribution.NewDisabled(path)
	if err != nil {
		t.Fatal(err)
	}
	defer runner.Close()
	before, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	beforeMissing := os.IsNotExist(err)
	if cfg, err := originalResourceCurrentConfig(context.Background(), runner, contribution.ResourceIdentity{}, localipc.ProcessIdentity{}); cfg != nil || !errors.Is(err, contribution.ErrResourceCurrent) {
		t.Fatal("absent Root selection initialized", cfg, err)
	}
	after, err := os.ReadFile(path)
	if os.IsNotExist(err) != beforeMissing || err != nil && !os.IsNotExist(err) || string(before) != string(after) {
		t.Fatal("absent selection changed original journal", err)
	}
}
