package main_test

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func qaDigest(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

type qaClientProcess struct {
	origin, code string
	stop, crash  func()
}

func qaClientStart(t *testing.T, binary, data, rpc string, extra ...string) qaClientProcess {
	t.Helper()
	args := []string{"--data-dir", data, "--rpc", rpc}
	args = append(args, extra...)
	cmd := exec.Command(binary, args...)
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
			_ = cmd.Process.Signal(syscall.SIGTERM)
			select {
			case e := <-done:
				if e != nil {
					t.Errorf("QA normal helper stop: %v %s", e, stderr.String())
				}
			case <-time.After(8 * time.Second):
				_ = cmd.Process.Kill()
				<-done
				t.Error("QA helper failed normal stop")
			}
		})
	}
	crash := func() {
		once.Do(func() {
			_ = cmd.Process.Kill()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("owned QA helper did not crash")
			}
		})
	}
	t.Cleanup(stop)
	ready := make(chan qaClientProcess, 1)
	go func() {
		var p qaClientProcess
		scan := bufio.NewScanner(stdout)
		for scan.Scan() {
			line := scan.Text()
			if strings.HasPrefix(line, "Open: ") {
				p.origin = strings.TrimPrefix(line, "Open: ")
			}
			if strings.HasPrefix(line, "One-use pairing code: ") {
				p.code = strings.TrimPrefix(line, "One-use pairing code: ")
				ready <- p
				return
			}
		}
		ready <- p
	}()
	select {
	case p := <-ready:
		if p.origin == "" || p.code == "" {
			stop()
			t.Fatalf("QA normal entry unavailable: %s", stderr.String())
		}
		p.stop, p.crash = stop, crash
		return p
	case <-time.After(15 * time.Second):
		crash()
		t.Fatalf("QA entry timeout: %s", stderr.String())
	}
	return qaClientProcess{}
}
func qaClientAPI(t *testing.T, p qaClientProcess, route, ticket string, body any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, p.origin+route, bytes.NewReader(raw))
	req.Header.Set("Origin", p.origin)
	req.Header.Set("Content-Type", "application/json")
	if ticket != "" {
		req.Header.Set("Authorization", "Bearer "+ticket)
	}
	res, e := (&http.Client{Timeout: 22 * time.Second}).Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer res.Body.Close()
	var out map[string]any
	d := json.NewDecoder(res.Body)
	d.UseNumber()
	if e = d.Decode(&out); e != nil {
		t.Fatalf("QA %s decode %d: %v", route, res.StatusCode, e)
	}
	return res.StatusCode, out
}
func qaClientPair(t *testing.T, p qaClientProcess) string {
	t.Helper()
	_, c := qaClientAPI(t, p, "/api/pair/challenge", "", nil)
	status, v := qaClientAPI(t, p, "/api/pair", "", map[string]any{"challenge": c["challenge"], "code": p.code})
	if status != 200 {
		t.Fatalf("QA pair: %d %+v", status, v)
	}
	return v["ticket"].(string)
}
func qaClientSaved(t *testing.T, p qaClientProcess, ticket, id string, original map[string]any) {
	t.Helper()
	status, list := qaClientAPI(t, p, "/api/receipts", ticket, map[string]any{})
	if status != 200 || list["authority"] != false {
		t.Fatalf("QA receipt list: %d %+v", status, list)
	}
	found := false
	for _, value := range list["receipts"].([]any) {
		if value.(map[string]any)["receiptId"] == id {
			found = true
		}
	}
	if !found {
		t.Fatalf("QA original receipt ID missing: %+v", list)
	}
	status, read := qaClientAPI(t, p, "/api/receipt", ticket, map[string]string{"id": id})
	if status != 200 || read["historical"] != true || read["authority"] != false {
		t.Fatalf("QA historical read upgraded authority: %d %+v", status, read)
	}
	a, _ := json.Marshal(original)
	b, _ := json.Marshal(read["receipt"])
	if !bytes.Equal(a, b) {
		t.Fatalf("QA original receipt changed after persistence/restart\n%s\n%s", a, b)
	}
}

// One normal compiled helper process flow covers the NEW client surface, not
// old UI/verification greens. The upstream is a real controlled HTTP fixture.
// SIGTERM/SIGKILL affect only processes this test starts, with private data.
func TestP09QAClientNormalProcessReceiptRecovery(t *testing.T) {
	short, e := os.MkdirTemp("/tmp", "ynx-nqa-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(short) })
	dir, e := filepath.EvalSymlinks(short)
	if e != nil {
		t.Fatal(e)
	}
	root, _ := filepath.Abs("../..")
	binary := filepath.Join(dir, "ynx-network-helper")
	build := exec.Command("go", "build", "-mod=readonly", "-p", "1", "-o", binary, "./cmd/ynx-network-helper")
	build.Dir = root
	build.Env = append(os.Environ(), "GOMAXPROCS=2")
	if out, e := build.CombinedOutput(); e != nil {
		t.Fatalf("QA helper compile: %v %s", e, out)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/status":
			io.WriteString(w, `{"height":42,"chainId":6423,"level":"STATE_VERIFIED","source":"controlled-http-fixture"}`)
		case "/blocks/42":
			io.WriteString(w, `{"height":42,"hash":"fixture-block-42"}`)
		case "/validators":
			io.WriteString(w, `{"validators":[{"address":"fixture-validator","active":true,"votingPower":"10"}]}`)
		case "/txs/" + serviceKnownTx:
			io.WriteString(w, `{"hash":"`+serviceKnownTx+`","status":"paid","level":"STATE_VERIFIED","nativeGrant":true,"nonce":"9007199254740993"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	data := filepath.Join(dir, "state")
	p := qaClientStart(t, binary, data, upstream.URL)
	ticket := qaClientPair(t, p)
	status, nodes := qaClientAPI(t, p, "/api/node-report", ticket, map[string]any{})
	if status != 200 || nodes["classification"] != "RPC_ONLY" {
		t.Fatalf("QA node report: %d %+v", status, nodes)
	}
	reports := nodes["reports"].(map[string]any)
	for _, name := range []string{"status", "latestBlock", "validators"} {
		if reports[name].(map[string]any)["status"] != "reported" {
			t.Fatalf("QA actual fixed node callee missing %s: %+v", name, reports)
		}
	}
	status, original := qaClientAPI(t, p, "/api/client-receipt", ticket, map[string]string{"txId": serviceKnownTx})
	if status != 200 || original["view"].(map[string]any)["level"] != "RPC_ONLY" {
		t.Fatalf("QA RPC source manufactured proof: %d %+v", status, original)
	}
	id, ok := original["receiptId"].(string)
	if !ok || id == "" {
		t.Fatal("QA receipt not persisted")
	}
	qaClientSaved(t, p, ticket, id, original)
	status, native := qaClientAPI(t, p, "/api/native-status", ticket, map[string]any{})
	if status != 200 || native["browserIdentityVerified"] != false || native["native"] == nil {
		t.Fatalf("QA native status/identity boundary: %d %+v", status, native)
	}
	p.stop()
	second := qaClientStart(t, binary, data, upstream.URL)
	if status, _ := qaClientAPI(t, second, "/api/receipts", ticket, map[string]any{}); status != 401 {
		t.Fatal("QA normal restart restored old ticket")
	}
	secondTicket := qaClientPair(t, second)
	qaClientSaved(t, second, secondTicket, id, original)
	second.crash()
	third := qaClientStart(t, binary, data, upstream.URL)
	if status, _ := qaClientAPI(t, third, "/api/receipts", secondTicket, map[string]any{}); status != 401 {
		t.Fatal("QA SIGKILL restart restored old ticket")
	}
	thirdTicket := qaClientPair(t, third)
	qaClientSaved(t, third, thirdTicket, id, original)
	if status, _ := qaClientAPI(t, third, "/api/revoke", thirdTicket, map[string]any{}); status != 200 {
		t.Fatal("QA normal revoke failed")
	}
	if status, _ := qaClientAPI(t, third, "/api/receipt", thirdTicket, map[string]string{"id": id}); status != 401 {
		t.Fatal("QA revoked ticket still reads private receipt")
	}
	third.stop()
}

// The new client-receipt route also consumes one genuine original CORE signed
// public QA fixture through the real offline command. This is isolated proof
// math/transport, not a deployed source, Wallet grant or funds-state proof.
func TestP09QAClientOriginalCOREProofReceipt(t *testing.T) {
	short, e := os.MkdirTemp("/tmp", "ynx-nqa-proof-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(short) })
	dir, _ := filepath.EvalSymlinks(short)
	root, _ := filepath.Abs("../..")
	helper, proof := filepath.Join(dir, "helper"), filepath.Join(dir, "proof")
	for target, output := range map[string]string{"./cmd/ynx-network-helper": helper, "./cmd/ynx-consensus-proof-verify": proof} {
		c := exec.Command("go", "build", "-mod=readonly", "-p", "1", "-o", output, target)
		c.Dir = root
		c.Env = append(os.Environ(), "GOMAXPROCS=2")
		if out, e := c.CombinedOutput(); e != nil {
			t.Fatalf("QA original executable build: %v %s", e, out)
		}
	}
	fixture := filepath.Join(dir, "public-fixture.json")
	generate := exec.Command("go", "test", "-mod=readonly", "-p", "1", "./internal/consensus", "-run", "^TestPQConsensusTransactionProofPublicFixture$", "-count=1")
	generate.Dir = root
	generate.Env = append(os.Environ(), "GOMAXPROCS=2", "YNX_PQ_TRANSACTION_PROOF_FIXTURE_OUT="+fixture)
	if out, e := generate.CombinedOutput(); e != nil {
		t.Fatalf("original CORE isolated public export: %v %s", e, out)
	}
	raw, e := os.ReadFile(fixture)
	if e != nil {
		t.Fatal(e)
	}
	var f struct {
		SyntheticOnly bool `json:"syntheticOnly"`
		Materials     []struct {
			Name   string `json:"name"`
			Bytes  []byte `json:"bytes"`
			SHA256 string `json:"sha256"`
		} `json:"materials"`
		Parameters map[string]string `json:"trustContextParameters"`
		Files      map[string]string `json:"trustContextFiles"`
		Cases      []struct {
			Expected json.RawMessage `json:"expectedTransaction"`
			Request  json.RawMessage `json:"request"`
		} `json:"cases"`
	}
	if json.Unmarshal(raw, &f) != nil || !f.SyntheticOnly || len(f.Cases) != 3 {
		t.Fatal("not original isolated fixture")
	}
	for _, m := range f.Materials {
		if filepath.Base(m.Name) != m.Name || qaDigest(m.Bytes) != m.SHA256 {
			t.Fatal("fixture material binding")
		}
		if e = os.WriteFile(filepath.Join(dir, m.Name), m.Bytes, 0600); e != nil {
			t.Fatal(e)
		}
	}
	for field, name := range f.Files {
		f.Parameters[field] = filepath.Join(dir, name)
	}
	selected := f.Cases[0]
	contextRaw, _ := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": f.Parameters, "expectedTransaction": json.RawMessage(selected.Expected)})
	contextPath := filepath.Join(dir, "independent-isolated-context.json")
	if e = os.WriteFile(contextPath, contextRaw, 0600); e != nil {
		t.Fatal(e)
	}
	code, _ := os.ReadFile(proof)
	var target struct {
		TransactionHash string `json:"transactionHash"`
		NativeWireHash  string `json:"nativeWireHash"`
		Index           string `json:"index"`
		Block           struct {
			HeaderHeight string `json:"headerHeight"`
		} `json:"block"`
	}
	var request struct {
		Proof json.RawMessage `json:"proof"`
	}
	if json.Unmarshal(selected.Expected, &target) != nil || json.Unmarshal(selected.Request, &request) != nil {
		t.Fatal("fixture target")
	}
	index, _ := strconv.ParseUint(target.Index, 10, 32)
	collector, _ := json.Marshal(map[string]any{"version": "YNX-PQ-RPC-TRANSACTION-PROOF/v1", "source": "original-core-controlled-QA", "status": "collected", "nativeTransactionHash": target.NativeWireHash, "abciTransactionHash": target.TransactionHash, "executionHeight": target.Block.HeaderHeight, "cometIndex": index, "independentFinality": false, "proofVerification": "not-performed", "proof": request.Proof})
	tx := "0x" + strings.TrimPrefix(target.TransactionHash, "0x")
	native := "0x" + strings.TrimPrefix(target.NativeWireHash, "0x")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/txs/" + tx:
			io.WriteString(w, `{"hash":"`+tx+`","source":"controlled-only"}`)
		case "/txs/" + native + "/pq-finality-proof":
			w.Write(collector)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	p := qaClientStart(t, helper, filepath.Join(dir, "state"), upstream.URL, "--pq-verifier", proof, "--pq-verifier-sha256", qaDigest(code), "--pq-context", contextPath, "--pq-context-sha256", qaDigest(contextRaw))
	ticket := qaClientPair(t, p)
	status, saved := qaClientAPI(t, p, "/api/client-receipt", ticket, map[string]string{"txId": tx})
	view, ok := saved["view"].(map[string]any)
	if status != 200 || !ok || view["level"] != "INCLUSION_VERIFIED" || view["abciResultVerified"] != true || view["fundsVerified"] != false || view["nativeGrant"] != false || view["executionOutcome"] != "succeeded" {
		t.Fatalf("new QA client original proof flow: %d %+v", status, saved)
	}
	if saved["contextPin"] != qaDigest([]byte(":"+qaDigest(contextRaw)+":"+qaDigest(code))) {
		t.Fatalf("original independent context pin lost: %+v", saved)
	}
	id := saved["receiptId"].(string)
	qaClientSaved(t, p, ticket, id, saved)
	p.stop()
}
