//go:build pay_pq && pay_cloud && pay_auth_source && pay_engine_host_fixture && pay_securelink && securelink_openssl && cgo

package consensus_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct/nativehost"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

// Requires A's already relocated and signed QA copy. This synthetic fixture
// uses only its own temporary state, public test credentials and GET /health.
func TestP06RelocatedCometIsolatedHealth(t *testing.T) {
	binary, conf, modules := os.Getenv("P06_QA_RELOCATED_COMET"), os.Getenv("P06_QA_OPENSSL_CONF"), os.Getenv("P06_QA_OPENSSL_MODULES")
	if binary == "" || conf == "" || modules == "" {
		t.Fatal("exact relocated binary, config and empty modules directory required")
	}
	base := filepath.Dir(filepath.Dir(binary))
	if filepath.Base(binary) != "ynx-comet-pay-qa" || filepath.Base(filepath.Dir(binary)) != "bin" || conf != filepath.Join(base, "etc", "openssl.cnf") || modules != filepath.Join(base, "lib", "ossl-modules") {
		t.Fatal("exact bundle-relative layout required")
	}
	for _, item := range []struct{ file, key string }{{binary, "P06_QA_COMET_SHA256"}, {filepath.Join(base, "lib", "libssl.3.dylib"), "P06_QA_LIBSSL_SHA256"}, {filepath.Join(base, "lib", "libcrypto.3.dylib"), "P06_QA_LIBCRYPTO_SHA256"}} {
		r, e := filepath.EvalSymlinks(item.file)
		if e != nil || r != item.file {
			t.Fatal("exact binary or library path required", item.file)
		}
		s, e := os.Lstat(item.file)
		if e != nil || !s.Mode().IsRegular() {
			t.Fatal("regular binary or library required")
		}
		b, e := os.ReadFile(item.file)
		if e != nil {
			t.Fatal(e)
		}
		h := sha256.Sum256(b)
		if hex.EncodeToString(h[:]) != os.Getenv(item.key) {
			t.Fatal("finalized original A input hash mismatch", item.key)
		}
	}
	for _, p := range []string{binary, conf, modules} {
		r, err := filepath.EvalSymlinks(p)
		if !filepath.IsAbs(p) || err != nil || r != p {
			t.Fatal("exact absolute real input required", p)
		}
	}
	if b, err := os.ReadFile(conf); err != nil || string(b) != "openssl_conf = init\n[init]\nproviders = providers\n[providers]\ndefault = default_section\n[default_section]\nactivate = 1\n" {
		t.Fatal("unexpected OpenSSL configuration")
	}
	if entries, err := os.ReadDir(modules); err != nil || len(entries) != 0 {
		t.Fatal("provider module directory must be empty")
	}
	_, node, fixture := consensus.OpenP06OriginalBootstrapNodeFixture(t)
	if err := node.Start(); err != nil {
		t.Fatal("fixture node start", err)
	}
	if err := node.Stop(); err != nil {
		t.Fatal("fixture node stop", err)
	}
	fixture.ReleaseLeases()
	dir := t.TempDir()
	tool := os.Getenv("P06_QA_OPENSSL_TOOL")
	if !filepath.IsAbs(tool) {
		t.Fatal("absolute OpenSSL 3.6.4 QA fixture tool required")
	}
	run := func(args ...string) {
		t.Helper()
		c := exec.Command(tool, args...)
		c.Env = []string{"PATH=/usr/bin:/bin", "OPENSSL_CONF=" + conf, "OPENSSL_MODULES=" + modules}
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("public QA TLS fixture failed: %v %s", err, out)
		}
	}
	key, cert := filepath.Join(dir, "PUBLIC.key"), filepath.Join(dir, "PUBLIC.pem")
	rootKey, rootCert := filepath.Join(dir, "PUBLIC-root.key"), filepath.Join(dir, "PUBLIC-root.pem")
	run("genpkey", "-algorithm", "ML-DSA-87", "-out", key)
	run("genpkey", "-algorithm", "ML-DSA-87", "-out", rootKey)
	run("req", "-new", "-x509", "-key", rootKey, "-subj", "/CN=PUBLIC-engine-root", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign", "-out", rootCert)
	csr, ext := filepath.Join(dir, "PUBLIC.csr"), filepath.Join(dir, "PUBLIC.ext")
	run("req", "-new", "-key", key, "-subj", "/CN=PUBLIC-engine-only", "-out", csr)
	if err := os.WriteFile(ext, []byte("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth,serverAuth\nsubjectAltName=DNS:core.ynx.test\n"), 0600); err != nil {
		t.Fatal(err)
	}
	run("x509", "-req", "-in", csr, "-CA", rootCert, "-CAkey", rootKey, "-set_serial", "1", "-days", "1", "-extfile", ext, "-out", cert)
	raw, err := os.ReadFile(rootCert)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		t.Fatal("test certificate unavailable")
	}
	digest := sha256.Sum256(block.Bytes)
	// Keep the original endpoint's required route policy; the QA caller below
	// only sends the private GET /health and never invokes the write routes.
	endpointRoutes := []securelink.Route{{Method: "GET", Path: "/rpc/status", Risk: "read"}, {Method: "GET", Path: "/health", Risk: "read"}, {Method: "POST", Path: "/transactions/pq/actions/broadcast", Risk: "write"}, {Method: "POST", Path: "/rpc/", Risk: "write"}}
	for _, p := range []string{"abci_query", "tx", "block", "block_results", "commit", "validators", "consensus_params"} {
		endpointRoutes = append(endpointRoutes, securelink.Route{Method: "GET", Path: "/rpc/" + p, Risk: "read"})
	}
	policy := securelink.Policy{Edges: []securelink.Edge{{ID: "p06-core", LocalSAN: "core.ynx.test", PeerSAN: "core.ynx.test", Epoch: 1, Roots: []securelink.Root{{Fingerprint: hex.EncodeToString(digest[:]), Until: time.Now().Add(time.Hour)}}, Routes: endpointRoutes}}}
	reservation, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reservation.Addr().String()
	_ = reservation.Close()
	clientTLS := native.Config{CertFile: cert, KeyFile: key, CAFile: rootCert, PeerSAN: "core.ynx.test"}
	serverTLS := clientTLS
	serverTLS.Server = true
	link := map[string]any{"tls": clientTLS, "policy": policy, "edgeId": "p06-core", "address": address, "origin": "https://core.ynx.test", "timeoutSeconds": 3, "maxConnections": 2}
	encoded, err := json.Marshal(link)
	if err != nil {
		t.Fatal(err)
	}
	linkFile := filepath.Join(dir, "central.json")
	if err = os.WriteFile(linkFile, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	socketRoot := os.Getenv("PAY_ENGINE_SOCKET_ROOT")
	if !filepath.IsAbs(socketRoot) {
		t.Fatal("isolated short socket root required")
	}
	socketDir, err := os.MkdirTemp(socketRoot, "p06-health-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDir) })
	routes := []securelink.LocalCallerRoute{{Method: "GET", Path: "/health", MaxBodyBytes: 1024, Timeout: time.Second}}
	private := nativehost.PrivateConfig{SocketPath: filepath.Join(socketDir, "health.sock"), Service: "pay-engine", PeerUID: uint32(os.Getuid()), PeerPID: os.Getpid(), Routes: routes}
	operator := nativehost.OperatorConfig{ExpectedChainID: fixture.ChainID, Endpoint: nativehost.BFTEndpointConfig{ListenAddress: address, Origin: "https://core.ynx.test", EdgeID: "p06-core", ServerTLS: serverTLS, ClientTLS: clientTLS, ServerPolicy: policy, ClientPolicy: policy}, PayStore: filepath.Join(dir, "pay.json"), PayPublicURL: "https://pay.ynx.test", CentralMerchantID: "fixture-merchant", CentralOrigin: "https://core.ynx.test", CentralLINKConfig: linkFile, CloudState: filepath.Join(dir, "cloud.json"), CloudObjects: filepath.Join(dir, "objects"), Private: private}
	wire, err := json.Marshal(operator)
	if err != nil {
		t.Fatal(err)
	}
	operatorFile := filepath.Join(dir, "operator.json")
	if err = os.WriteFile(operatorFile, wire, 0600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "start", "--home", fixture.Home, "--migration-state", fixture.MigrationPath, "--abci-state", fixture.StatePath, "--consensus-genesis-sha256", fixture.Pins.CometGenesisSHA256, "--original-genesis-hash", fixture.Pins.OriginalGenesisHash, "--bound-migration-state-hash", fixture.Pins.MigrationStateHash, "--pay-operator-config", operatorFile)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "HOME=" + dir, "TMPDIR=" + dir, "OPENSSL_CONF=" + conf, "OPENSSL_MODULES=" + modules, "YNX_PAY_PRODUCT_INTEGRITY_KEY=" + hex.EncodeToString([]byte(strings.Repeat("P", 32))), "YNX_PAY_PRODUCT_GATEWAY_ASSERTION_KEY=" + hex.EncodeToString([]byte(strings.Repeat("P", 32))), "YNX_PAY_PRODUCT_BOOTSTRAP_KEY=" + strings.Repeat("P", 32), "YNX_PAY_PRODUCT_CENTRAL_KEY=PUBLIC-no-legacy-call"}
	log, err := os.Create(filepath.Join(dir, "process.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	cmd.Stdout = log
	cmd.Stderr = log
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if cmd.ProcessState == nil {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	client, err := securelink.NewLocalCallerClient(securelink.LocalCallerClientConfig{SocketPath: private.SocketPath, Service: private.Service, PeerUID: uint32(os.Getuid()), PeerPID: cmd.Process.Pid, Routes: routes, Timeout: time.Second, MaxResponseBytes: 1 << 16})
	if err != nil {
		t.Fatal(err)
	}
	ready := false
	for deadline := time.Now().Add(25 * time.Second); time.Now().Before(deadline); time.Sleep(100 * time.Millisecond) {
		resp, e := client.Call(ctx, "GET", "/health", "", nil)
		if e == nil && resp.StatusCode == 200 {
			ready = true
			break
		}
	}
	if !ready {
		b, _ := os.ReadFile(log.Name())
		t.Fatalf("isolated original health unavailable: %s", b)
	}
	if err = cmd.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	if err = cmd.Wait(); err != nil {
		b, _ := os.ReadFile(log.Name())
		t.Fatalf("isolated shutdown failed: %v %s", err, b)
	}
	if conn, dialErr := net.DialTimeout("tcp", address, time.Second); dialErr == nil {
		_ = conn.Close()
		t.Fatal("original fixture loopback listener remained open", address)
	}
	t.Logf("same synthetic loopback listener released: %s", address)
	t.Log("relocated process: synthetic private GET /health=200 and clean stop; no Source or payment assertion")
}
