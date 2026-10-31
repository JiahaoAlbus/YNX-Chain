package main_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
)

const serviceKnownTx = "0x5469bfc2a41b76150b765122e4dc5e02c3bbe66886c24f46efe0dfd60edea5ac"

func TestP09NormalServiceNativeIdentityQueryHistoryRestart(t *testing.T) {
	short, err := os.MkdirTemp("/tmp", "ynx-network-service-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(short) })
	dir, err := filepath.EvalSymlinks(short)
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "ynx-network-helper")
	root, _ := filepath.Abs("../..")
	build := exec.Command("go", "build", "-mod=readonly", "-p", "1", "-o", binary, "./cmd/ynx-network-helper")
	build.Dir = root
	build.Env = append(os.Environ(), "GOMAXPROCS=2")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("normal helper build: %v %s", err, output)
	}
	participant := newParticipationFixture(t, false)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/txs/"+serviceKnownTx {
			participant.handler(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"hash":"`+serviceKnownTx+`","status":"reported-only"}`)
	}))
	defer upstream.Close()
	data := filepath.Join(dir, "product-state")
	configRaw, _ := json.Marshal(map[string]any{"version": "YNX-NETWORK-PARTICIPATION-CONFIG/v1", "network": participant.network})
	configPath := filepath.Join(dir, "independent-network-config.json")
	if err := os.WriteFile(configPath, configRaw, 0600); err != nil {
		t.Fatal(err)
	}
	configHash := sha256.Sum256(configRaw)
	start := func() (string, string, func(), func()) {
		cmd := exec.Command(binary, "--data-dir", data, "--rpc", upstream.URL, "--participation-config", configPath, "--participation-config-sha256", hex.EncodeToString(configHash[:]), "--governance-rpc", upstream.URL)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		var once sync.Once
		stop := func() {
			once.Do(func() {
				cmd.Process.Signal(syscall.SIGTERM)
				select {
				case err := <-done:
					if err != nil {
						t.Errorf("normal service shutdown: %v %s", err, stderr.String())
					}
				case <-time.After(8 * time.Second):
					cmd.Process.Kill()
					<-done
					t.Error("normal service did not release owned processes")
				}
			})
		}
		t.Cleanup(stop)
		crash := func() {
			once.Do(func() {
				cmd.Process.Kill()
				select {
				case <-done:
				case <-time.After(5 * time.Second):
					t.Fatal("owned helper process did not exit")
				}
			})
		}
		type launch struct{ url, code string }
		ready := make(chan launch, 1)
		go func() {
			scanner := bufio.NewScanner(stdout)
			var value launch
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "Open: ") {
					value.url = strings.TrimPrefix(line, "Open: ")
				}
				if strings.HasPrefix(line, "One-use pairing code: ") {
					value.code = strings.TrimPrefix(line, "One-use pairing code: ")
					ready <- value
					return
				}
			}
			ready <- value
		}()
		select {
		case value := <-ready:
			if value.url == "" || value.code == "" {
				t.Fatalf("normal entry unavailable: %s", stderr.String())
			}
			return value.url, value.code, stop, crash
		case <-time.After(15 * time.Second):
			t.Fatal("normal helper launch timed out")
		}
		return "", "", stop, crash
	}
	api := func(origin, path, ticket string, body any) (int, map[string]any) {
		raw, _ := json.Marshal(body)
		request, _ := http.NewRequest(http.MethodPost, origin+path, bytes.NewReader(raw))
		request.Header.Set("Origin", origin)
		request.Header.Set("Content-Type", "application/json")
		if ticket != "" {
			request.Header.Set("Authorization", "Bearer "+ticket)
		}
		client := &http.Client{Timeout: 5 * time.Second}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var out map[string]any
		if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, out
	}
	pairEntry := func(origin, code string) string {
		_, challenge := api(origin, "/api/pair/challenge", "", nil)
		status, out := api(origin, "/api/pair", "", map[string]any{"challenge": challenge["challenge"], "code": code})
		if status != 200 {
			t.Fatalf("normal pair: %d %v", status, out)
		}
		return out["ticket"].(string)
	}
	origin, code, stop, _ := start()
	ticket := pairEntry(origin, code)
	status, out := api(origin, "/api/lookup", ticket, map[string]string{"txId": serviceKnownTx})
	if status != 200 || out["view"].(map[string]any)["level"] != "RPC_ONLY" {
		t.Fatalf("public lookup flow: %d %v", status, out)
	}
	native := exec.Command(binary, "--data-dir", data, "--native-status")
	result, err := native.CombinedOutput()
	if err != nil {
		t.Fatalf("native entry: %v %s", err, result)
	}
	var peer localipc.Response
	if err := json.Unmarshal(result, &peer); err != nil {
		t.Fatal(err)
	}
	if !peer.Peer.NativeIPCVerified || peer.Peer.BrowserIdentityVerified || peer.Peer.UID != uint32(os.Geteuid()) {
		t.Fatalf("not actual kernel native identity: %+v", peer)
	}
	for _, operation := range []string{"node_status", "resource_meter", "resource_stop"} {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		response, err := localipc.Call(ctx, filepath.Join(data, "ipc"), localipc.Request{Version: localipc.Version, ID: operation, Operation: operation, Payload: json.RawMessage(`{}`)})
		cancel()
		if err != nil {
			t.Fatalf("native %s: %v", operation, err)
		}
		var payload map[string]any
		if response.Result == nil || json.Unmarshal(response.Result.Payload, &payload) != nil || payload["code"] != "OK" {
			t.Fatalf("native service result: %+v", response)
		}
		if operation == "node_status" && payload["node"].(map[string]any)["productionSupported"] != false {
			t.Fatal("ordinary node original release was invented")
		}
		if operation == "resource_meter" && payload["productionEnabled"] != false {
			t.Fatal("contribution enabled on launch")
		}
	}
	nativePayload := func(operation string, value any) map[string]any {
		raw, _ := json.Marshal(value)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		response, err := localipc.Call(ctx, filepath.Join(data, "ipc"), localipc.Request{Version: localipc.Version, ID: operation, Operation: operation, Payload: raw})
		if err != nil {
			t.Fatalf("native participation %s: %v", operation, err)
		}
		var out map[string]any
		if response.Result == nil || json.Unmarshal(response.Result.Payload, &out) != nil {
			t.Fatalf("native participation response: %+v", response)
		}
		return out
	}
	prepared := nativePayload("participation_prepare", participant.request("native-user-delegation"))
	if prepared["code"] != "UNSUPPORTED" {
		t.Fatalf("missing original Wallet not surfaced: %v", prepared)
	}
	entry := prepared["entry"].(map[string]any)
	entryID := entry["id"].(string)
	if entry["state"] != "UNSUPPORTED" {
		t.Fatal("unsupported intent not durable")
	}
	if submitted := nativePayload("participation_submit", map[string]string{"id": entryID}); submitted["code"] != "UNSUPPORTED" {
		t.Fatal("native caller replaced Wallet authority")
	}
	if calls, signatures, _ := participant.counts(); calls != 0 || signatures != 0 {
		t.Fatal("normal service reached fixture publisher without original Wallet")
	}
	stop()
	if _, err := os.Lstat(filepath.Join(data, "ipc", localipc.SocketName)); !os.IsNotExist(err) {
		t.Fatalf("native endpoint not released: %v", err)
	}
	origin2, code2, stop2, crash2 := start()
	defer stop2()
	if status, _ := api(origin2, "/api/history", ticket, nil); status != 401 {
		t.Fatal("old ticket survived helper restart")
	}
	newTicket := pairEntry(origin2, code2)
	status, out = api(origin2, "/api/history", newTicket, nil)
	if status != 200 || out["authority"] != false || len(out["observations"].([]any)) != 1 {
		t.Fatalf("restart history flow: %d %v", status, out)
	}
	if restored := nativePayload("participation_get", map[string]string{"id": entryID}); restored["entry"].(map[string]any)["state"] != "REVOKED" {
		t.Fatalf("lost durable Wallet handoff: %+v", restored)
	}
	newIntent := nativePayload("participation_prepare", participant.request("new-native-session-intent"))
	if newIntent["code"] != "UNSUPPORTED" || newIntent["entry"].(map[string]any)["id"] == entryID {
		t.Fatalf("new session could not prepare with original Wallet still gated: %+v", newIntent)
	}
	newEntryID := newIntent["entry"].(map[string]any)["id"].(string)
	// A previously acknowledged service crash must recover its known endpoint
	// and kernel locks without deleting UNKNOWN data or adopting a stored PID.
	crash2()
	origin3, code3, stop3, _ := start()
	defer stop3()
	if status, _ := api(origin3, "/api/history", newTicket, nil); status != 401 {
		t.Fatal("crashed process ticket replayed")
	}
	thirdTicket := pairEntry(origin3, code3)
	status, out = api(origin3, "/api/history", thirdTicket, nil)
	if status != 200 || out["authority"] != false || len(out["observations"].([]any)) != 1 {
		t.Fatalf("crash recovery lost projection: %d %v", status, out)
	}
	if restored := nativePayload("participation_get", map[string]string{"id": entryID}); restored["entry"].(map[string]any)["state"] != "REVOKED" {
		t.Fatalf("crash changed durable handoff: %+v", restored)
	}
	if restored := nativePayload("participation_get", map[string]string{"id": newEntryID}); restored["entry"].(map[string]any)["state"] != "REVOKED" {
		t.Fatalf("crash restored stale prepared authority: %+v", restored)
	}
	if publishes, signatures, _ := participant.counts(); publishes != 0 || signatures != 0 {
		t.Fatal("recovery created a replacement signature or publish")
	}
}
