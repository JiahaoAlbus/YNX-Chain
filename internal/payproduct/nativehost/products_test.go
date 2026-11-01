//go:build pay_pq && pay_cloud && pay_auth_source && pay_securelink && securelink_openssl && cgo

package nativehost

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/payproduct"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	"github.com/JiahaoAlbus/YNX-Chain/internal/securelink/native"
)

func productsNormalConfig(t *testing.T) ProductsConfig {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		t.Helper()
		if output, err := exec.Command("openssl", args...).CombinedOutput(); err != nil {
			t.Fatalf("PUBLIC fixture openssl: %v %s", err, output)
		}
	}
	key, cert := filepath.Join(dir, "PUBLIC.key"), filepath.Join(dir, "PUBLIC.pem")
	run("genpkey", "-algorithm", "ML-DSA-87", "-out", key)
	run("req", "-new", "-x509", "-key", key, "-subj", "/CN=PUBLIC-products-only", "-days", "1", "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign,digitalSignature", "-addext", "extendedKeyUsage=clientAuth,serverAuth", "-addext", "subjectAltName=DNS:pay.ynx.test", "-out", cert)
	raw, err := os.ReadFile(cert)
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		t.Fatal("PUBLIC certificate missing")
	}
	fingerprint := sha256.Sum256(block.Bytes)
	edge := securelink.Edge{ID: "products-central", LocalSAN: "pay.ynx.test", PeerSAN: "pay.ynx.test", Epoch: 1, Roots: []securelink.Root{{Fingerprint: hex.EncodeToString(fingerprint[:]), Until: time.Now().Add(time.Hour)}}, Routes: []securelink.Route{{Method: "GET", Path: "/health", Risk: "read"}}}
	link := map[string]any{"tls": native.Config{CertFile: cert, KeyFile: key, CAFile: cert, PeerSAN: "pay.ynx.test"}, "policy": securelink.Policy{Edges: []securelink.Edge{edge}}, "edgeId": edge.ID, "address": "127.0.0.1:1", "origin": "https://pay.ynx.test", "timeoutSeconds": 1, "maxConnections": 1}
	encoded, err := json.Marshal(link)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "original-link.json")
	if err = os.WriteFile(file, encoded, 0600); err != nil {
		t.Fatal(err)
	}
	productKey := bytes.Repeat([]byte{'P'}, 32)
	return ProductsConfig{Pay: payproduct.Config{StorePath: filepath.Join(dir, "pay.json"), IntegrityKey: productKey, GatewayKey: productKey, BootstrapKey: strings.Repeat("P", 32), PublicBaseURL: "https://pay.ynx.test"}, Central: payproduct.NormalCentralPayEndpoint{Origin: "https://pay.ynx.test", APIKey: "PUBLIC-no-network", LINKConfigPath: file}, Cloud: cloud.OriginalPrivateHostConfig{Cloud: cloud.Config{StatePath: filepath.Join(dir, "cloud.json"), ObjectDir: filepath.Join(dir, "objects")}}}
}

func TestProductsRealParentsWithoutEngineKeepIndependentCloud(t *testing.T) {
	cfg := productsNormalConfig(t)
	h, err := OpenProducts(context.Background(), cfg, buildinfo.Info{}, nil)
	if h == nil || err != nil || h.cloud == nil || h.pay == nil || h.native != nil {
		t.Fatal("normal product constructors or precise missing-engine cause lost", err)
	}
	handler, err := h.Handler()
	if handler == nil || err != nil || h.NativeSourceStatus() != ErrOriginalEngineContractNotLinked {
		t.Fatal("normal missing-engine CODE status lost", err)
	}
	denied := httptest.NewRecorder()
	handler.ServeHTTP(denied, httptest.NewRequest("GET", "/v5/pay/invoices/no/no", nil))
	if denied.Code != 503 {
		t.Fatal("missing engine admitted protected Pay", denied.Code)
	}
	parent := h.pay.Service()
	store, err := parent.BorrowOriginalNativePayStore()
	if err != nil || store == nil || h.pay.Service() != parent {
		t.Fatal("normal Pay Store identity changed", err)
	}
	_, server, reader, err := h.cloud.Parents()
	if err != nil {
		t.Fatal(err)
	}
	again, err := server.OpenOriginalIDEUsageBillReader()
	if err != nil || again != reader {
		t.Fatal("normal Cloud constructed another reader", err)
	}
	original, err := h.CloudHandler()
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	original.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 200 {
		t.Fatal("Pay Core gap blocked independent original Cloud", w.Code)
	}
	if _, err = os.Stat(cfg.Cloud.Cloud.StatePath + ".ide-deployments"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("read-only parent composition created another IDE journal", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err = h.Join(ctx); err != nil {
		t.Fatal(err)
	}
	if err = h.Close(); err != nil || h.pay.Service() != nil {
		t.Fatal("normal product workers/children/parents did not close", err)
	}
	w = httptest.NewRecorder()
	original.ServeHTTP(w, httptest.NewRequest("GET", "/health", nil))
	if w.Code != 503 {
		t.Fatal("retired original Cloud handler remained active", w.Code)
	}
}

func TestProductsFailedPayRetainsActualCloudForRollback(t *testing.T) {
	cfg := productsNormalConfig(t)
	cfg.Central.LINKConfigPath = ""
	h, cause := OpenProducts(context.Background(), cfg, buildinfo.Info{}, nil)
	if h == nil || cause == nil || h.cloud == nil || h.pay == nil || h.native != nil {
		t.Fatal("normal Cloud/Pay opening partial lost", cause)
	}
	if _, err := h.CloudHandler(); err != nil {
		t.Fatal("independent Cloud parent was destroyed by Pay refusal", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := h.Join(ctx); err != nil {
		t.Fatal(err)
	}
	if err := h.Close(); err != nil || h.first != cause || !h.closed {
		t.Fatal("normal rollback lost construction cause or cleanup", err)
	}
}

type productsHeldBody struct {
	entered, release chan struct{}
	once             sync.Once
}

func (b *productsHeldBody) Read([]byte) (int, error) {
	b.once.Do(func() { close(b.entered) })
	<-b.release
	return 0, io.EOF
}
func (*productsHeldBody) Close() error { return nil }

func TestProductsActualCloudRequestDrainRetainsPayParent(t *testing.T) {
	h, err := OpenProducts(context.Background(), productsNormalConfig(t), buildinfo.Info{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	original, err := h.CloudHandler()
	if err != nil {
		t.Fatal(err)
	}
	body := &productsHeldBody{entered: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() {
		defer close(done)
		original.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/api/v1/session", body))
	}()
	select {
	case <-body.entered:
	case <-time.After(2 * time.Second):
		close(body.release)
		t.Fatal("original Cloud session handler did not hold its actual body")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	joinErr := h.Join(ctx)
	closeErr := h.Close()
	retained := h.pay.Service() != nil
	close(body.release)
	<-done
	if !errors.Is(joinErr, context.DeadlineExceeded) || closeErr != ErrProductsDraining || !retained {
		t.Fatalf("undrained original child released parent: join=%v close=%v retained=%v", joinErr, closeErr, retained)
	}
	ctx2, cancel2 := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel2()
	if err = h.Join(ctx2); err != nil {
		t.Fatal(err)
	}
	if err = h.Close(); err != ErrProductsDraining || h.pay.Service() != nil || !h.closed {
		t.Fatal("actual drained child did not release parents with first close cause retained", err)
	}
}
