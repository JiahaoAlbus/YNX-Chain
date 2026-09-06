package api

import (
	"context"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

func TestEthereumIndependentEthersLifecycle(t *testing.T) {
	if os.Getenv("YNX_ETHERS_MODULE") == "" {
		t.Skip("set YNX_ETHERS_MODULE to an existing ethers 6 install for independent client integration")
	}
	dir := t.TempDir()
	d, err := chain.NewPersistentDevnet(chain.DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	_ = d.SetEthereumNativeTransfers(true)
	v := loadRPCVectors(t)[0]
	_, err = d.Faucet(v.Sender, 100)
	if err != nil {
		t.Fatal(err)
	}
	d.ProduceBlock()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	defer func() { cancel(); <-stopped }()
	go func() { defer close(stopped); d.Start(ctx, 50*time.Millisecond) }()
	server := httptest.NewServer(NewServer(d))
	defer server.Close()
	command := exec.CommandContext(ctx, "node", "../../testdata/ethereum-native/ethers-lifecycle.cjs", server.URL+"/evm")
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("independent ethers lifecycle: %v\n%s", err, output)
	}
	t.Log(string(output))
	cancel()
	<-stopped
	if outputDir := os.Getenv("YNX_ETHEREUM_TEST_OUTPUT"); outputDir != "" {
		if err = os.MkdirAll(outputDir, 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(outputDir, "ethers-lifecycle.json"), output, 0600); err != nil {
			t.Fatal(err)
		}
		// Export an authenticated complete snapshot for old-binary rollback QA;
		// this contains only synthetic local accounts and no private material.
		snapshot, err := d.ReplicationSnapshotJSON()
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(outputDir, "local-synthetic-snapshot.json"), snapshot, 0600); err != nil {
			t.Fatal(err)
		}
	}
}
