//go:build pay_pq

package payproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/buildinfo"
)

type archiveReadProcessConfig struct {
	StorePath                                          string
	IntegrityKey                                       []byte
	Genesis                                            []byte
	NativeChainID                                      uint64
	Merchant, InvoiceID, SourceOrder, SessionID, Ready string
}
type archivePublicReadAuthority struct{ cfg archiveReadProcessConfig }

func (a archivePublicReadAuthority) Authorize(ctx context.Context, access NativePayAccess) (NativePayAuthorization, error) {
	if access.Operation != "read" || access.Merchant != a.cfg.Merchant || access.InvoiceID != a.cfg.InvoiceID {
		return NativePayAuthorization{}, ErrNativePayUnavailable
	}
	return NativePayAuthorization{Principal: a.cfg.Merchant, BoundInvoiceRead: true, BoundInvoiceID: a.cfg.InvoiceID, BoundOrderID: a.cfg.SourceOrder, BoundSessionID: a.cfg.SessionID, Height: 1, Until: time.Now().Add(time.Minute), Current: ctx.Err}, nil
}

type archiveOfflineTransport struct{}

func (archiveOfflineTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("PUBLIC offline Core must not be queried during historical read")
}

func TestNativePayArchiveReadbackChild(t *testing.T) {
	file := os.Getenv("PAY_PUBLIC_ARCHIVE_CHILD_CONFIG")
	if file == "" {
		t.Skip("subprocess-only PUBLIC read authority fixture")
	}
	var cfg archiveReadProcessConfig
	raw, err := os.ReadFile(file)
	if err != nil || json.Unmarshal(raw, &cfg) != nil {
		t.Fatal("explicit PUBLIC child config required", err)
	}
	parent, err := New(Config{StorePath: cfg.StorePath, IntegrityKey: cfg.IntegrityKey, GatewayKey: bytes32(8), BootstrapKey: "PUBLIC-archive-read-child-fixture", PublicBaseURL: "https://public.invalid", PayAPI: &fakePay{}})
	if err != nil {
		t.Fatal(err)
	}
	caller, err := NewNativePayHTTP("http://127.0.0.1:1", &http.Client{Transport: archiveOfflineTransport{}, Timeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	native, err := NewNativePayService(parent, NativePayConfig{Genesis: cfg.Genesis, NativeChainID: cfg.NativeChainID, HTTP: caller, Authority: archivePublicReadAuthority{cfg}})
	if err != nil {
		t.Fatal(err)
	}
	server := NewClosedProductionServerWithLogger(parent, buildinfo.Info{}, nil)
	if err = server.MountNativePay(native); err != nil {
		t.Fatal(err)
	}
	endpoint := httptest.NewServer(server.Handler())
	defer endpoint.Close()
	data, _ := json.Marshal(map[string]any{"endpoint": endpoint.URL, "pid": os.Getpid(), "PUBLICSource": true})
	if err = os.WriteFile(cfg.Ready, data, 0600); err != nil {
		t.Fatal(err)
	}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGTERM)
	defer signal.Stop(stopped)
	select {
	case <-stopped:
	case <-time.After(30 * time.Second):
		t.Fatal("original read child did not stop")
	}
}

func assertNativeArchiveTwoProcessRestarts(t *testing.T, n *NativePayService, f nativeCoreWorkflowManifest, before map[string]string) {
	t.Helper()
	original, err := os.ReadFile(n.parent.store.path)
	if err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for generation := 0; generation < 2; generation++ {
		func() {
			dir := t.TempDir()
			ready := filepath.Join(dir, "ready.json")
			cfg := archiveReadProcessConfig{StorePath: n.parent.store.path, IntegrityKey: n.parent.key, Genesis: n.cfg.Genesis, NativeChainID: n.cfg.NativeChainID, Merchant: f.Merchant, InvoiceID: f.Terms.InvoiceID, SourceOrder: "order-100", SessionID: f.Terms.SessionID, Ready: ready}
			raw, _ := json.Marshal(cfg)
			file := filepath.Join(dir, "PUBLIC-read-config.json")
			if err = os.WriteFile(file, raw, 0600); err != nil {
				t.Fatal(err)
			}
			command := exec.Command(executable, "-test.run=^TestNativePayArchiveReadbackChild$", "-test.timeout=35s", "-test.v=true")
			command.Env = append(os.Environ(), "PAY_PUBLIC_ARCHIVE_CHILD_CONFIG="+file)
			var output bytes.Buffer
			command.Stdout = &output
			command.Stderr = &output
			if err = command.Start(); err != nil {
				t.Fatal(err)
			}
			waited := false
			defer func() {
				if !waited {
					_ = command.Process.Kill()
					_ = command.Wait()
				}
			}()
			var metadata struct {
				Endpoint     string `json:"endpoint"`
				PID          int    `json:"pid"`
				PUBLICSource bool   `json:"PUBLICSource"`
			}
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				data, e := os.ReadFile(ready)
				if e == nil && json.Unmarshal(data, &metadata) == nil && metadata.Endpoint != "" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if metadata.Endpoint == "" || metadata.PID != command.Process.Pid || !metadata.PUBLICSource {
				t.Fatal("normal historical read process not ready")
			}
			transport := &http.Transport{}
			defer transport.CloseIdleConnections()
			client, e := NewNativeInvoiceIntentClient(metadata.Endpoint, &http.Client{Transport: transport, Timeout: 5 * time.Second})
			if e != nil {
				t.Fatal(e)
			}
			for hash, digest := range before {
				archive, e := client.ReadOriginalArchive(context.Background(), f.Merchant, f.Terms.InvoiceID, hash, func() error { return nil })
				if e != nil || archive.Digest != digest {
					t.Fatal("process restart changed same original public archive", generation, e)
				}
			}
			if err = command.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			err = command.Wait()
			waited = true
			if err != nil {
				t.Fatal("read process drain", err, output.String())
			}
			after, e := os.ReadFile(n.parent.store.path)
			if e != nil || !bytes.Equal(original, after) {
				t.Fatal("normal restart/read changed original disk bytes", e)
			}
		}()
	}
	t.Log("NORMAL_ARCHIVE_PROCESS restarts2=true originalClosedProductionHTTP=true CoreOffline=true archiveDigestsUnchanged=true diskBytesUnchanged=true SIGTERM0=true PUBLICSourceOnly=true")
}
