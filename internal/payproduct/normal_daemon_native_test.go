//go:build pay_pq && pay_securelink && securelink_openssl && cgo && pay_normal_daemon

package payproduct

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Opt-in only: the original runner supplies the one actually compiled normal
// binary and hash. No second build, self-check branch, fake handler or Root.
func TestNormalHostedDaemonStartupAndShutdown(t *testing.T) {
	binary, expected := os.Getenv("PAY_NORMAL_PARENT_DAEMON_BINARY"), os.Getenv("PAY_NORMAL_PARENT_DAEMON_SHA256")
	if !filepath.IsAbs(binary) || len(expected) != 64 {
		t.Fatal("exact compiled normal daemon path and SHA256 required")
	}
	raw, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != expected {
		t.Fatal("normal daemon hash differs")
	}
	cfg, central := normalProductFixture(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, binary)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "YNX_PAY_PRODUCT_") {
			command.Env = append(command.Env, value)
		}
	}
	command.Env = append(command.Env, "YNX_PAY_PRODUCT_ADDR="+address, "YNX_PAY_PRODUCT_STORE="+cfg.StorePath, "YNX_PAY_PRODUCT_INTEGRITY_KEY="+hex.EncodeToString(cfg.IntegrityKey), "YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY="+hex.EncodeToString(cfg.GatewayKey), "YNX_PAY_PRODUCT_BOOTSTRAP_KEY="+cfg.BootstrapKey, "YNX_PAY_PRODUCT_PUBLIC_URL="+cfg.PublicBaseURL, "YNX_PAY_PRODUCT_CENTRAL_MERCHANT_ID=PUBLIC-normal-parent", "YNX_PAY_PRODUCT_CENTRAL_URL="+central.Origin, "YNX_PAY_PRODUCT_CENTRAL_KEY="+central.APIKey, "YNX_PAY_PRODUCT_LINK_CONFIG="+central.LINKConfigPath)
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = command.Process.Kill(); _ = command.Wait() }()
	client := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 200 * time.Millisecond}
	defer client.CloseIdleConnections()
	ready := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		response, requestErr := client.Get("http://" + address + "/v5/pay/invoices/not-an-authority/not-an-invoice")
		if requestErr == nil {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
			_ = response.Body.Close()
			ready = response.StatusCode == http.StatusServiceUnavailable && bytes.Contains(body, []byte("NATIVE_PAY_AUTHORITY_UNAVAILABLE"))
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !ready {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("actual normal entry did not refuse unavailable Source: %s", output.String())
	}
	if err = command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err = command.Wait(); err != nil {
		t.Fatalf("normal SIGTERM/worker drain/child-parent close failed: %v %s", err, output.String())
	}
	if !strings.Contains(output.String(), "native_source_unavailable") || strings.Contains(output.String(), "cleanup_pending") {
		t.Fatalf("normal lifecycle outcome changed: %s", output.String())
	}
	// Reopen the same original durable file only after the original process exits.
	if _, err = OpenStore(cfg.StorePath, cfg.IntegrityKey); err != nil {
		t.Fatal("normal original Store did not survive process shutdown", err)
	}
}
