package exchangeproduct

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

type orderReplayEndpoint struct {
	URL   string
	Close func()
	Crash func()
}

type orderReplayProcessFixture struct {
	DatabaseURL string
	StatePath   string
	MakerFeeBPS int64
	TakerFeeBPS int64
	Gateway     orderReplayHTTPGateway
}

// Only the test binary exposes this helper; no production authorizer or key
// material is created. Parent funding/signatures remain controlled fixtures.
func TestExchangePostgresOrderReplayProcessHelper(t *testing.T) {
	if os.Getenv("YNX_EXCHANGE_ORDER_PROCESS_FIXTURE") != "1" {
		t.Skip("isolated child process helper")
	}
	var fixture orderReplayProcessFixture
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		t.Fatal("invalid isolated process fixture")
	}
	u, err := url.Parse(fixture.DatabaseURL)
	if err != nil || u.Hostname() != "127.0.0.1" || !strings.HasPrefix(u.Query().Get("search_path"), "ynx_exchange_qa_") || len(fixture.Gateway) != 2 {
		t.Fatal("child process requires isolated loopback test schema")
	}
	s, err := New(Config{StateDatabaseURL: fixture.DatabaseURL, StatePath: fixture.StatePath, APIKey: adminKey, WalletCallback: "ynxexchange://wallet/callback", MakerFeeBPS: fixture.MakerFeeBPS, TakerFeeBPS: fixture.TakerFeeBPS, Gateway: fixture.Gateway, GatewayClientID: "ynx-exchange-v1", GatewayBundleID: "com.ynxweb4.exchange"})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if backend, multi := s.StorageStatus(); backend != "postgresql" || !multi {
		t.Fatal("child did not select PostgreSQL")
	}
	server := httptest.NewServer(NewServer(s))
	defer server.Close()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM)
	defer signal.Stop(stop)
	fmt.Println("orderReplayProcessURL=" + server.URL)
	<-stop
}

func startOrderReplayProcess(t *testing.T, cfg Config) orderReplayEndpoint {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	fixture := orderReplayProcessFixture{DatabaseURL: cfg.StateDatabaseURL, StatePath: cfg.StatePath, MakerFeeBPS: cfg.MakerFeeBPS, TakerFeeBPS: cfg.TakerFeeBPS, Gateway: cfg.Gateway.(orderReplayHTTPGateway)}
	input, err := json.Marshal(fixture)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(executable, "-test.run=^TestExchangePostgresOrderReplayProcessHelper$", "-test.timeout=30s")
	cmd.Env = append(os.Environ(), "YNX_EXCHANGE_ORDER_PROCESS_FIXTURE=1")
	cmd.Stdin = bytes.NewReader(input)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	// The helper logs request metadata only. Keep diagnostics private unless
	// process completion is unsuccessful; never print fixture input/DSN/proofs.
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	ready := make(chan string, 1)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if line := scanner.Text(); strings.HasPrefix(line, "orderReplayProcessURL=") {
				ready <- strings.TrimPrefix(line, "orderReplayProcessURL=")
			}
		}
	}()
	done := make(chan error, 1)
	go func() { <-readDone; done <- cmd.Wait() }()
	var once sync.Once
	terminate := func(crash bool) {
		once.Do(func() {
			if crash {
				if err := cmd.Process.Kill(); err != nil {
					t.Errorf("isolated Exchange child kill: %v", err)
				}
			} else {
				_ = cmd.Process.Signal(syscall.SIGTERM)
			}
			select {
			case err := <-done:
				if crash {
					exit, ok := err.(*exec.ExitError)
					if !ok {
						t.Errorf("child did not exit via SIGKILL: %v", err)
					} else if status, ok := exit.Sys().(syscall.WaitStatus); !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
						t.Errorf("child exit did not prove SIGKILL: %v", err)
					}
				} else if err != nil {
					t.Errorf("isolated Exchange child exit: %v", err)
				}
			case <-time.After(5 * time.Second):
				_ = cmd.Process.Kill()
				<-done
				t.Error("isolated Exchange child failed clean shutdown")
			}
		})
	}
	stop := func() { terminate(false) }
	t.Cleanup(stop)
	select {
	case endpoint := <-ready:
		u, err := url.Parse(endpoint)
		if err != nil || u.Scheme != "http" || u.Hostname() != "127.0.0.1" {
			t.Fatal("invalid isolated child endpoint")
		}
		t.Logf("actual Exchange PostgreSQL child pid=%d", cmd.Process.Pid)
		return orderReplayEndpoint{URL: endpoint, Close: stop, Crash: func() { terminate(true) }}
	case <-readDone:
		t.Fatal("isolated Exchange child exited before readiness")
	case <-time.After(10 * time.Second):
		t.Fatal("isolated Exchange child startup timeout")
	}
	return orderReplayEndpoint{}
}
