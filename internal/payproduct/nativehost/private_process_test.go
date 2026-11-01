//go:build pay_pq && pay_cloud && pay_auth_source && pay_securelink && securelink_openssl && cgo && pay_product_private

package nativehost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
)

// Exact one already-built normal entry, two fresh endpoint generations, the
// same original product files. No Root/Source/ledger substitute is created.
func TestPrivateNormalProcessColdRecoveryAndSIGTERM(t *testing.T) {
	binary, expected, socketRoot := os.Getenv("PAY_PRIVATE_HOST_BINARY"), os.Getenv("PAY_PRIVATE_HOST_SHA256"), os.Getenv("PAY_PRIVATE_SOCKET_ROOT")
	if !filepath.IsAbs(binary) || !filepath.IsAbs(socketRoot) || len(expected) != 64 {
		t.Fatal("exact compiled private host/hash and owned external short socket root required")
	}
	raw, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(raw)
	if hex.EncodeToString(digest[:]) != expected {
		t.Fatal("normal private host binary differs")
	}
	cfg := productsNormalConfig(t)
	socketDir, err := os.MkdirTemp(socketRoot, "p06-private-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDir) })
	routes := []securelink.LocalCallerRoute{{Method: "GET", Path: "/health", MaxBodyBytes: 1024, Timeout: time.Second}, {Method: "GET", Path: "/v5/pay/invoices/no/no", MaxBodyBytes: 1024, Timeout: time.Second}}
	for generation := 1; generation <= 2; generation++ {
		socket := filepath.Join(socketDir, strconv.Itoa(generation)+".sock")
		privateCfg := PrivateConfig{SocketPath: socket, Service: "pay-products", PeerUID: uint32(os.Getuid()), PeerPID: os.Getpid(), Routes: routes}
		wire := map[string]any{"Pay": map[string]any{"StorePath": cfg.Pay.StorePath, "IntegrityKey": cfg.Pay.IntegrityKey, "GatewayKey": cfg.Pay.GatewayKey, "BootstrapKey": cfg.Pay.BootstrapKey, "PublicBaseURL": cfg.Pay.PublicBaseURL}, "Central": cfg.Central, "Cloud": cfg.Cloud.Cloud, "Private": privateCfg}
		// Cloud wire contains only the original paths, no callback/config grant.
		wire["Cloud"] = map[string]string{"StatePath": cfg.Cloud.Cloud.StatePath, "ObjectDir": cfg.Cloud.Cloud.ObjectDir}
		encoded, err := json.Marshal(wire)
		if err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(t.TempDir(), "private.json")
		if err = os.WriteFile(file, encoded, 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		command := exec.CommandContext(ctx, binary, "--config", file)
		var output bytes.Buffer
		command.Stdout, command.Stderr = &output, &output
		if err = command.Start(); err != nil {
			cancel()
			t.Fatal(err)
		}
		client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: socket, Service: privateCfg.Service, PeerUID: uint32(os.Getuid()), PeerPID: command.Process.Pid, Routes: routes, Timeout: time.Second, MaxResponseBytes: 1 << 16})
		if err != nil {
			_ = command.Process.Kill()
			_ = command.Wait()
			cancel()
			t.Fatal(err)
		}
		ready := false
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			response, requestErr := client.Call(ctx, "GET", "/health", "", nil)
			if requestErr == nil {
				ready = response.StatusCode == 200
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		denied, requestErr := client.Call(ctx, "GET", "/v5/pay/invoices/no/no", "", nil)
		if !ready || requestErr != nil || denied.StatusCode != 503 || !bytes.Contains(denied.Body, []byte("NATIVE_PAY_AUTHORITY_UNAVAILABLE")) {
			_ = command.Process.Kill()
			_ = command.Wait()
			cancel()
			t.Fatalf("normal private original handler outcomes differ: ready=%v status=%d err=%v log=%s", ready, denied.StatusCode, requestErr, output.String())
		}
		_ = command.Process.Signal(syscall.SIGTERM)
		err = command.Wait()
		cancel()
		if err != nil || !strings.Contains(output.String(), "private_products_stopped") || !strings.Contains(output.String(), "PAY_HOST_ORIGINAL_ENGINE_SOURCE_CONTRACT_NOT_LINKED") {
			t.Fatalf("normal private drain/close failed: %v %s", err, output.String())
		}
		if _, err = os.Lstat(socket); err != nil {
			t.Fatal("normal shutdown deleted an existing endpoint", err)
		}
		if _, err = os.Stat(cfg.Cloud.Cloud.StatePath + ".ide-deployments"); !os.IsNotExist(err) {
			t.Fatal("no-Source recovery created another IDE journal", err)
		}
	}
}
