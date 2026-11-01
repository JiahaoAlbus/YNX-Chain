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
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/participation"
)

// Real helper process + kernel IPC + original codec/HTTP fixtures. No Wallet
// approval, actual Main publisher, public business, funds or UI is exercised.
func TestP0906ParticipationNormalReviewCancelColdRestart(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("Unix kernel peer required")
	}
	base := os.TempDir()
	if st, e := os.Stat("/Volumes/西部数据"); e == nil && st.IsDir() {
		base = "/Volumes/西部数据"
	}
	dir, err := os.MkdirTemp(base, "p09review-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	f := newParticipationFixture(t, false)
	binary := filepath.Join(dir, "ynx-network-helper")
	// Reuse the actual current test toolchain without selecting/downloading one.
	compile := exec.Command(filepath.Join(runtime.GOROOT(), "bin/go"), "build", "-mod=readonly", "-p", "1", "-o", binary, "./cmd/ynx-network-helper")
	compile.Dir, _ = filepath.Abs("../..")
	if output, e := compile.CombinedOutput(); e != nil {
		t.Fatalf("actual helper compile: %s %v", output, e)
	}
	raw, _ := json.Marshal(map[string]any{"version": "YNX-NETWORK-PARTICIPATION-CONFIG/v1", "network": f.network})
	pin := sha256.Sum256(raw)
	config := filepath.Join(dir, "network.json")
	if err = os.WriteFile(config, raw, 0600); err != nil {
		t.Fatal(err)
	}
	data := filepath.Join(dir, "data")
	start := func() (string, string, func()) {
		cmd := exec.Command(binary, "--listen", "127.0.0.1:0", "--data-dir", data, "--rpc", f.server.URL, "--governance-rpc", f.server.URL, "--participation-config", config, "--participation-config-sha256", hex.EncodeToString(pin[:]))
		stdout, e := cmd.StdoutPipe()
		if e != nil {
			t.Fatal(e)
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if e = cmd.Start(); e != nil {
			t.Fatal(e)
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		var once sync.Once
		stop := func() {
			once.Do(func() {
				_ = cmd.Process.Signal(syscall.SIGINT)
				select {
				case e := <-done:
					if e != nil {
						t.Errorf("owned helper exit: %v", e)
					}
				case <-time.After(8 * time.Second):
					_ = cmd.Process.Kill()
					<-done
					t.Error("owned helper did not exit")
				}
				if stderr.Len() != 0 {
					t.Errorf("helper stderr: %s", stderr.String())
				}
			})
		}
		t.Cleanup(stop)
		ready := make(chan [2]string, 1)
		go func() {
			var pair [2]string
			scanner := bufio.NewScanner(stdout)
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "Open: ") {
					pair[0] = strings.TrimPrefix(line, "Open: ")
				}
				if strings.HasPrefix(line, "One-use pairing code: ") {
					pair[1] = strings.TrimPrefix(line, "One-use pairing code: ")
					ready <- pair
					return
				}
			}
			ready <- pair
		}()
		select {
		case pair := <-ready:
			if pair[0] == "" || pair[1] == "" {
				t.Fatal("normal readiness unavailable")
			}
			return pair[0], pair[1], stop
		case <-time.After(12 * time.Second):
			stop()
			t.Fatal("normal readiness deadline")
		}
		return "", "", stop
	}
	call := func(op string, payload any) map[string]any {
		body, _ := json.Marshal(payload)
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		res, e := localipc.Call(ctx, filepath.Join(data, "ipc"), localipc.Request{Version: localipc.Version, ID: "review_" + op, Operation: op, Payload: body})
		if e != nil || !res.Peer.NativeIPCVerified || res.Peer.BrowserIdentityVerified || res.Result == nil {
			t.Fatalf("actual kernel %s: %+v %v", op, res, e)
		}
		var value map[string]any
		if e = json.Unmarshal(res.Result.Payload, &value); e != nil {
			t.Fatal(e)
		}
		return value
	}
	origin, code, stop := start()
	prepared := call("participation_prepare", f.request("normal-review"))
	if prepared["code"] != "UNSUPPORTED" {
		t.Fatalf("publisher absence: %v", prepared)
	}
	id := prepared["entry"].(map[string]any)["id"].(string)
	view := call("participation_review", map[string]string{"id": id})
	review := view["review"].(map[string]any)
	if view["code"] != "OK" || view["walletApproval"] != false || review["conditionStatus"] != "CURRENT_RPC_REPORTED" || review["walletHandoffState"] != "NOT_SUPPLIED" || review["authority"] != false || review["independentFinality"] != false {
		t.Fatalf("normal data-only review: %v", view)
	}
	input := review["walletInput"].(map[string]any)
	if len(input) != 3 || input["kind"] != "stake_delegate" || input["fee"] != "1" || input["payload"].(map[string]any)["amountYNXT"] != "10" {
		t.Fatalf("Main DATA keys: %v", input)
	}
	post := func(endpoint, ticket string, body any) map[string]any {
		encoded, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, origin+endpoint, bytes.NewReader(encoded))
		req.Header.Set("Origin", origin)
		req.Header.Set("Content-Type", "application/json")
		if ticket != "" {
			req.Header.Set("Authorization", "Bearer "+ticket)
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		var value map[string]any
		_ = json.NewDecoder(res.Body).Decode(&value)
		if res.StatusCode != 200 {
			t.Fatalf("pair endpoint %s: %d", endpoint, res.StatusCode)
		}
		return value
	}
	challenge := post("/api/pair/challenge", "", nil)
	paired := post("/api/pair", "", map[string]any{"challenge": challenge["challenge"], "code": code})
	ticket := paired["ticket"].(string)
	for _, op := range []string{"participation_review", "participation_cancel"} {
		req, _ := http.NewRequest(http.MethodPost, origin+"/api/"+op, strings.NewReader(`{"id":"`+id+`"}`))
		req.Header.Set("Origin", origin)
		req.Header.Set("Authorization", "Bearer "+ticket)
		req.Header.Set("Content-Type", "application/json")
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			t.Fatalf("receipt ticket acquired %s", op)
		}
	}
	cancelled := call("participation_cancel", map[string]string{"id": id})
	entry := cancelled["entry"].(map[string]any)
	if cancelled["code"] != "CANCELLED" || entry["state"] != participation.Cancelled || entry["cancelRequestedAt"] == "" {
		t.Fatalf("normal cancellation: %v", cancelled)
	}
	if submitted := call("participation_submit", map[string]string{"id": id}); submitted["code"] != "CANCELLED" {
		t.Fatal("normal cancellation was dispatchable")
	}
	stop()
	_, _, stop2 := start()
	defer stop2()
	restored := call("participation_review", map[string]string{"id": id})["review"].(map[string]any)
	if restored["localDispatchCancelled"] != true || restored["originalEffectMayExist"] != false || restored["entry"].(map[string]any)["state"] != participation.Cancelled {
		t.Fatalf("cold original lost: %v", restored)
	}
	fresh := call("participation_prepare", f.request("explicit-normal-reopen"))
	if fresh["code"] != "UNSUPPORTED" || fresh["entry"].(map[string]any)["id"] == id {
		t.Fatalf("fresh metadata session: %v", fresh)
	}
	stop2()
	participationStatusNoEffects(t, f)
}
