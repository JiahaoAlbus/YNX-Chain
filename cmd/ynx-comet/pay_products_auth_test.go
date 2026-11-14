//go:build pay_pq && pay_cloud && pay_auth_source

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct/nativehost"
	cfg "github.com/cometbft/cometbft/config"
	"github.com/cometbft/cometbft/libs/log"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

func TestPayOperatorUsesOriginalNodeAndRejectsWrongNetwork(t *testing.T) {
	fixture := newCometJournalFixture(t)
	conf, options := bootstrapStartupFixture(t, fixture, "atomic-json")
	lease, err := consensus.AcquireApplicationStateWriterLease(options.state)
	if err != nil {
		t.Fatal(err)
	}
	defer lease.Close()
	pvLease, err := consensus.AcquireApplicationStateWriterLease(conf.PrivValidatorStateFile())
	if err != nil {
		t.Fatal(err)
	}
	defer pvLease.Close()
	var app *consensus.Application
	options.proofLiveBind = func(a *consensus.Application) error { app = a; return nil }
	n, custody, err := constructBootstrapNode(conf, log.NewNopLogger(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer custody.Close()
	defer func() { n.OnStop(); _ = n.ProxyApp().Stop() }()
	if app == nil {
		t.Fatal("normal constructor did not supply original App")
	}
	for _, key := range []string{"YNX_PAY_PRODUCT_INTEGRITY_KEY", "YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY"} {
		t.Setenv(key, strings.Repeat("ab", 32))
	}
	t.Setenv("YNX_PAY_PRODUCT_BOOTSTRAP_KEY", strings.Repeat("b", 24))
	t.Setenv("YNX_PAY_PRODUCT_CENTRAL_KEY", "public-fixture")
	dir := t.TempDir()
	cfg := nativehost.OperatorConfig{ExpectedChainID: "wrong-network", PayStore: filepath.Join(dir, "pay"), PayPublicURL: "https://pay.example", CentralMerchantID: "merchant", CentralOrigin: "https://central.example", CentralLINKConfig: filepath.Join(dir, "link"), CloudState: filepath.Join(dir, "cloud"), CloudObjects: filepath.Join(dir, "objects"), Private: nativehost.PrivateConfig{SocketPath: filepath.Join(dir, "pay.sock")}}
	write := func() {
		data, e := json.Marshal(cfg)
		if e != nil {
			t.Fatal(e)
		}
		if e = os.WriteFile(filepath.Join(dir, "config"), data, 0600); e != nil {
			t.Fatal(e)
		}
	}
	var output bytes.Buffer
	logger := log.NewTMLogger(&output)
	write()
	if h := openOperatorPayProducts(context.Background(), app, n, filepath.Join(dir, "config"), logger); h != nil || !strings.Contains(output.String(), "PAY_OPERATOR_NETWORK_MISMATCH") {
		t.Fatal("wrong network was not rejected", output.String())
	}
	if _, err := os.Stat(cfg.PayStore); !os.IsNotExist(err) {
		t.Fatal("wrong network touched product store", err)
	}
	output.Reset()
	cfg.ExpectedChainID = fixture.doc.ChainID
	write()
	if h := openOperatorPayProducts(context.Background(), app, n, filepath.Join(dir, "config"), logger); h != nil {
		closeOperatorPayProducts(h, logger)
		t.Fatal("incomplete LINK configuration unexpectedly became available")
	}
	if !strings.Contains(output.String(), "PAY_ORIGINAL_COMPOSITION_FAILED") {
		t.Fatal("matching original App/Node did not reach real constructor", output.String())
	}
}

func TestPayWrongNetworkNormalNodeStartAndShutdown(t *testing.T) {
	f := newWireObservationFixture(t)
	f.options.wireObservationOutput, f.options.wireObservationScope = "", ""
	viper.Reset()
	t.Cleanup(viper.Reset)
	t.Setenv("CMTHOME", "")
	t.Setenv("TMHOME", "")
	viper.SetConfigFile(f.config.RootDir + "/config/config.toml")
	if err := viper.ReadInConfig(); err != nil {
		t.Fatal(err)
	}
	viper.Set("p2p.laddr", "tcp://127.0.0.1:0")
	viper.Set("rpc.laddr", "tcp://127.0.0.1:0")
	viper.Set("p2p.persistent_peers", "")
	viper.Set("p2p.seeds", "")
	viper.Set("log_level", "error")
	for _, key := range []string{"YNX_PAY_PRODUCT_INTEGRITY_KEY", "YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY"} {
		t.Setenv(key, strings.Repeat("ab", 32))
	}
	t.Setenv("YNX_PAY_PRODUCT_BOOTSTRAP_KEY", strings.Repeat("b", 24))
	t.Setenv("YNX_PAY_PRODUCT_CENTRAL_KEY", "public-fixture")
	dir := t.TempDir()
	cfg := nativehost.OperatorConfig{ExpectedChainID: "wrong-network", PayStore: filepath.Join(dir, "pay"), PayPublicURL: "https://pay.example", CentralMerchantID: "merchant", CentralOrigin: "https://central.example", CentralLINKConfig: filepath.Join(dir, "link"), CloudState: filepath.Join(dir, "cloud"), CloudObjects: filepath.Join(dir, "objects"), Private: nativehost.PrivateConfig{SocketPath: filepath.Join(dir, "pay.sock")}}
	data, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	f.options.payOperatorConfig = filepath.Join(dir, "config")
	if err = os.WriteFile(f.options.payOperatorConfig, data, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	command := &cobra.Command{Use: "start"}
	command.Flags().String("home", f.config.RootDir, "isolated home")
	command.SetContext(ctx)
	if err = runPQNode(command, f.options); err != nil {
		t.Fatal("normal node failed to start/stop", err)
	}
	if _, err = os.Stat(cfg.PayStore); !os.IsNotExist(err) {
		t.Fatal("wrong network touched product store", err)
	}
	for _, path := range []string{f.options.state, f.config.PrivValidatorStateFile()} {
		lease, e := consensus.AcquireApplicationStateWriterLease(path)
		if e != nil {
			t.Fatal("normal writer lease retained", e)
		}
		_ = lease.Close()
	}
}

// This test executes the separately built normal ynx-comet binary. It uses
// only an isolated bootstrap chain; the wrong Pay network never opens a store.
func TestPayQANormalBinaryWrongNetwork(t *testing.T) {
	binary := os.Getenv("PAY_QA_COMET_BINARY")
	if binary == "" {
		t.Skip("PAY_QA_COMET_BINARY required for process-level test")
	}
	if !filepath.IsAbs(binary) {
		t.Fatal("binary must be an absolute path")
	}
	f := newWireObservationFixture(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	f.config.RPC.ListenAddress = "tcp://" + address
	f.config.RPC.PprofListenAddress = ""
	f.config.P2P.ListenAddress = "tcp://127.0.0.1:0"
	f.config.P2P.PersistentPeers = ""
	f.config.P2P.Seeds = ""
	f.config.P2P.PexReactor = false
	cfg.WriteConfigFile(filepath.Join(f.config.RootDir, "config", "config.toml"), f.config)
	for _, key := range []string{"YNX_PAY_PRODUCT_INTEGRITY_KEY", "YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY"} {
		t.Setenv(key, strings.Repeat("ab", 32))
	}
	t.Setenv("YNX_PAY_PRODUCT_BOOTSTRAP_KEY", strings.Repeat("b", 24))
	t.Setenv("YNX_PAY_PRODUCT_CENTRAL_KEY", "public-fixture")
	dir := t.TempDir()
	data, e := json.Marshal(nativehost.OperatorConfig{ExpectedChainID: "wrong-network", PayStore: filepath.Join(dir, "pay"), PayPublicURL: "https://pay.example", CentralMerchantID: "merchant", CentralOrigin: "https://central.example", CentralLINKConfig: filepath.Join(dir, "link"), CloudState: filepath.Join(dir, "cloud"), CloudObjects: filepath.Join(dir, "objects"), Private: nativehost.PrivateConfig{SocketPath: filepath.Join(dir, "pay.sock")}})
	if e != nil {
		t.Fatal(e)
	}
	configPath := filepath.Join(dir, "operator.json")
	if e = os.WriteFile(configPath, data, 0600); e != nil {
		t.Fatal(e)
	}
	logFile, e := os.Create(filepath.Join(dir, "process.log"))
	if e != nil {
		t.Fatal(e)
	}
	defer logFile.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "start", "--home", f.config.RootDir, "--migration-state", f.options.migration, "--abci-state", f.options.state, "--consensus-genesis-sha256", f.options.genesisHash, "--original-genesis-hash", f.options.originalGenesisHash, "--bound-migration-state-hash", f.options.migrationHash, "--pay-operator-config", configPath)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	if e = cmd.Start(); e != nil {
		t.Fatal(e)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	client := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: time.Second}
	defer client.CloseIdleConnections()
	ready := false
	for deadline := time.Now().Add(25 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		response, e := client.Get("http://" + address + "/status")
		if e != nil {
			continue
		}
		body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		_ = response.Body.Close()
		if response.StatusCode == 200 && bytes.Contains(body, []byte("sync_info")) {
			ready = true
			break
		}
	}
	if !ready {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		logBytes, _ := os.ReadFile(logFile.Name())
		t.Fatalf("normal binary RPC did not start: %s", logBytes)
	}
	if e = cmd.Process.Signal(os.Interrupt); e != nil {
		t.Fatal(e)
	}
	if e = cmd.Wait(); e != nil {
		logBytes, _ := os.ReadFile(logFile.Name())
		t.Fatalf("normal binary did not stop: %v %s", e, logBytes)
	}
	logBytes, e := os.ReadFile(logFile.Name())
	if e != nil {
		t.Fatal(e)
	}
	if !bytes.Contains(logBytes, []byte("PAY_OPERATOR_NETWORK_MISMATCH")) {
		t.Fatalf("wrong-network reason missing: %s", logBytes)
	}
	if _, e = os.Stat(filepath.Join(dir, "pay")); !os.IsNotExist(e) {
		t.Fatal("wrong network touched Pay store", e)
	}
}
