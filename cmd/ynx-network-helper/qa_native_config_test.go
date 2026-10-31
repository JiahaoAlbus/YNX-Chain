package main_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

// This process is the normal compiled macOS launcher, not direct helper flags.
// Its task-specific QA directory and original CORE materials are isolated.
func qaNativeStart(t *testing.T, launcher, qaDirectory, rpc string) qaClientProcess {
	t.Helper()
	cmd := exec.Command(launcher, "--headless", "--rpc", rpc)
	cmd.Env = append(os.Environ(), "YNX_NETWORK_QA_DIRECTORY="+qaDirectory)
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
					t.Errorf("native normal stop: %v %s", e, stderr.String())
				}
			case <-time.After(8 * time.Second):
				_ = cmd.Process.Kill()
				<-done
				t.Error("native owned helper stop timed out")
			}
		})
	}
	crash := func() {
		once.Do(func() {
			_ = cmd.Process.Kill()
			select {
			case <-done:
			case <-time.After(8 * time.Second):
				t.Fatal("native owned crash timed out")
			}
		})
	}
	t.Cleanup(stop)
	ready := make(chan qaClientProcess, 1)
	go func() {
		var p qaClientProcess
		s := bufio.NewScanner(stdout)
		for s.Scan() {
			line := s.Text()
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
			t.Fatalf("normal native profile startup failed: %s", stderr.String())
		}
		p.stop, p.crash = stop, crash
		return p
	case <-time.After(15 * time.Second):
		crash()
		t.Fatalf("normal native profile startup timed out: %s", stderr.String())
	}
	return qaClientProcess{}
}

func TestP09QANativeProofConfigurationFlow(t *testing.T) {
	if runtime.GOOS != "darwin" || runtime.GOARCH != "arm64" {
		t.Skip("native QA launcher requires macOS ARM64; no GUI is opened")
	}
	short, e := os.MkdirTemp("/tmp", "ynx-npc-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(short) })
	dir, e := filepath.EvalSymlinks(short)
	if e != nil {
		t.Fatal(e)
	}
	root, _ := filepath.Abs("../..")
	contents := filepath.Join(dir, "QA.app", "Contents")
	for _, d := range []string{"Helpers", "MacOS", "Resources"} {
		if e = os.MkdirAll(filepath.Join(contents, d), 0700); e != nil {
			t.Fatal(e)
		}
	}
	physicalQADirectory := filepath.Join(dir, "qa")
	if e = os.Mkdir(physicalQADirectory, 0700); e != nil {
		t.Fatal(e)
	}
	// Intentionally exercise /tmp's macOS alias through the dedicated QA root;
	// the launcher must use its POSIX physical path, without changing user home.
	qaDirectory := strings.TrimPrefix(physicalQADirectory, "/private")
	helper, proof := filepath.Join(contents, "Helpers", "ynx-network-helper"), filepath.Join(contents, "Helpers", "ynx-consensus-proof-verify")
	run := func(name string, args ...string) []byte {
		t.Helper()
		c := exec.Command(name, args...)
		c.Dir = root
		c.Env = append(os.Environ(), "GOMAXPROCS=2")
		out, e := c.CombinedOutput()
		if e != nil {
			t.Fatalf("native config %s: %v\n%s", name, e, out)
		}
		return out
	}
	for _, pair := range [][2]string{{helper, "./cmd/ynx-network-helper"}, {proof, "./cmd/ynx-consensus-proof-verify"}} {
		run("go", "build", "-mod=readonly", "-p", "1", "-o", pair[0], pair[1])
	}
	launcher := filepath.Join(contents, "MacOS", "ynx-network-qa")
	run("xcrun", "--sdk", "macosx", "clang", "-arch", "arm64", "-mmacosx-version-min=12.0", "-fobjc-arc", "-Wno-deprecated-declarations", "-framework", "Cocoa", "-framework", "WebKit", filepath.Join(root, "apps/network/qa/launcher.m"), filepath.Join(root, "apps/network/qa/proof_profile.m"), "-o", launcher)
	fixture := filepath.Join(dir, "original-public-fixture.json")
	generate := exec.Command("go", "test", "-mod=readonly", "-p", "1", "./internal/consensus", "-run", "^TestPQConsensusTransactionProofPublicFixture$", "-count=1")
	generate.Dir = root
	generate.Env = append(os.Environ(), "GOMAXPROCS=2", "YNX_PQ_TRANSACTION_PROOF_FIXTURE_OUT="+fixture)
	if out, e := generate.CombinedOutput(); e != nil {
		t.Fatalf("original CORE isolated signed fixture export: %v %s", e, out)
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
		t.Fatal("not original isolated public fixture")
	}
	for _, m := range f.Materials {
		if filepath.Base(m.Name) != m.Name || qaDigest(m.Bytes) != m.SHA256 {
			t.Fatal("original material binding")
		}
		if e = os.WriteFile(filepath.Join(dir, m.Name), m.Bytes, 0600); e != nil {
			t.Fatal(e)
		}
	}
	for key, name := range f.Files {
		f.Parameters[key] = filepath.Join(dir, name)
	}
	selected := f.Cases[0]
	contextRaw, _ := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": f.Parameters, "expectedTransaction": json.RawMessage(selected.Expected)})
	contextPath, secondPath := filepath.Join(dir, "original-context.json"), filepath.Join(dir, "second-public-context.json")
	for _, p := range []string{contextPath, secondPath} {
		if e = os.WriteFile(p, contextRaw, 0600); e != nil {
			t.Fatal(e)
		}
	}
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
		t.Fatal("original target")
	}
	index, _ := strconv.ParseUint(target.Index, 10, 32)
	collector, _ := json.Marshal(map[string]any{"version": "YNX-PQ-RPC-TRANSACTION-PROOF/v1", "source": "isolated-original-CORE-native-config-fixture", "status": "collected", "nativeTransactionHash": target.NativeWireHash, "abciTransactionHash": target.TransactionHash, "executionHeight": target.Block.HeaderHeight, "cometIndex": index, "independentFinality": false, "proofVerification": "not-performed", "proof": request.Proof})
	tx, native := "0x"+strings.TrimPrefix(target.TransactionHash, "0x"), "0x"+strings.TrimPrefix(target.NativeWireHash, "0x")
	report := `{"hash":"` + tx + `","nonce":9007199254740993,"memo":"escaped \\\"quote\\\" and slash\\\\","source":"isolated-native-configuration"}`
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/txs/" + tx:
			io.WriteString(w, report)
		case "/txs/" + native + "/pq-finality-proof":
			w.Write(collector)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	helperCode, _ := os.ReadFile(helper)
	proofCode, _ := os.ReadFile(proof)
	buildID := "qa-" + qaDigest([]byte(dir))[:16]
	revision := strings.TrimSpace(string(run("git", "rev-parse", "HEAD")))
	buildRaw, _ := json.Marshal(map[string]any{"version": "YNX-NETWORK-LOCAL-QA/v1", "buildID": buildID, "sourceRevision": revision, "helperSHA256": qaDigest(helperCode), "proofSHA256": qaDigest(proofCode), "defaultRPC": upstream.URL, "publisherSigned": false, "installed": false})
	if e = os.WriteFile(filepath.Join(contents, "Resources", "qa-build.json"), buildRaw, 0600); e != nil {
		t.Fatal(e)
	}
	cli := func(wantOK bool, args ...string) []byte {
		t.Helper()
		c := exec.Command(launcher, args...)
		c.Env = append(os.Environ(), "YNX_NETWORK_QA_DIRECTORY="+qaDirectory)
		out, e := c.CombinedOutput()
		if (e == nil) != wantOK {
			t.Fatalf("native config options %v wantOK=%v: %v %s", args, wantOK, e, out)
		}
		return out
	}
	probeDirectory := func(directory string) {
		t.Helper()
		c := exec.Command(launcher, "--proof-profile")
		c.Env = append(os.Environ(), "YNX_NETWORK_QA_DIRECTORY="+directory)
		out, err := c.CombinedOutput()
		if err == nil || bytes.Contains(out, []byte("Open: ")) {
			t.Fatalf("unsafe task-specific QA root accepted: %s %v %s", directory, err, out)
		}
	}
	probeDirectory(filepath.Join(dir, "not-created"))
	probeDirectory(contextPath)
	if e = os.Chmod(physicalQADirectory, 0755); e != nil {
		t.Fatal(e)
	}
	probeDirectory(qaDirectory)
	if e = os.Chmod(physicalQADirectory, 0700); e != nil {
		t.Fatal(e)
	}
	if out := cli(true, "--proof-profile"); !bytes.Contains(out, []byte(`"configured":false`)) {
		t.Fatalf("new profile inferred authority: %s", out)
	}
	data := filepath.Join(physicalQADirectory, buildID)
	profilePath := filepath.Join(data, "proof-profile.json")
	if _, e = os.Stat(data); e != nil {
		t.Fatalf("native task-specific QA directory not honored: %v", e)
	}
	pin := qaDigest(contextRaw)
	cli(false, "--configure-proof-context", contextPath, "--context-sha256", strings.Repeat("0", 64))
	cli(false, "--configure-proof-context", contextPath, "--context-sha256", pin[:63])
	cli(false, "--configure-proof-context", contextPath)
	if _, e = os.Stat(profilePath); !os.IsNotExist(e) {
		t.Fatal("failed configuration created a profile")
	}
	cli(true, "--configure-proof-context", contextPath, "--context-sha256", strings.ToUpper(pin))
	firstProfile, e := os.ReadFile(profilePath)
	if e != nil {
		t.Fatal(e)
	}
	if bytes.Contains(firstProfile, []byte("verifier")) || bytes.Contains(firstProfile, []byte("executable")) || !bytes.Contains(firstProfile, []byte(pin)) {
		t.Fatalf("profile can select executable or lost independent input: %s", firstProfile)
	}

	// Exercise the same local candidate API used before the native alert's Apply.
	// Abandoning the candidate models Cancel and never stops or changes a session.
	harnessSource := filepath.Join(dir, "cancel.m")
	harness := `#import <Foundation/Foundation.h>
#import "proof_profile.h"
int main(int argc,const char**argv){@autoreleasepool{NSString *dir=@(argv[1]);NSDictionary *build=@{@"buildID":@(argv[2]),@"sourceRevision":@(argv[3])};QAProofProfile *store=[[QAProofProfile alloc]initWithDirectory:dir build:build];NSError *error=nil;NSDictionary *old=[store load:&error];if(!old||error)return 11;NSData *before=[NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"proof-profile.json"]];NSDictionary *candidate=[store candidateForPath:@(argv[4]) independentSHA256:@(argv[5]) error:&error];if(!candidate||error)return 12;/* Cancel: no save and no lifecycle callback. */NSDictionary *after=[store load:&error];NSData *bytes=[NSData dataWithContentsOfFile:[dir stringByAppendingPathComponent:@"proof-profile.json"]];if(error||![old isEqual:after]||![bytes isEqual:before])return 13;puts("CANCEL_PRESERVED");return 0;}}`
	if e = os.WriteFile(harnessSource, []byte(harness), 0600); e != nil {
		t.Fatal(e)
	}
	harnessBinary := filepath.Join(dir, "cancel-check")
	run("xcrun", "--sdk", "macosx", "clang", "-fobjc-arc", "-Wno-deprecated-declarations", "-framework", "Foundation", "-I", filepath.Join(root, "apps/network/qa"), harnessSource, filepath.Join(root, "apps/network/qa/proof_profile.m"), "-o", harnessBinary)
	p := qaNativeStart(t, launcher, qaDirectory, upstream.URL)
	ticket := qaClientPair(t, p)
	run(harnessBinary, data, buildID, revision, secondPath, pin)
	cli(false, "--configure-proof-context", secondPath, "--context-sha256", pin)
	if now, _ := os.ReadFile(profilePath); !bytes.Equal(now, firstProfile) {
		t.Fatal("cancel or concurrent configuration changed the running profile")
	}
	status, saved := qaClientAPI(t, p, "/api/client-receipt", ticket, map[string]string{"txId": tx})
	view, ok := saved["view"].(map[string]any)
	if status != 200 || !ok || view["level"] != "INCLUSION_VERIFIED" || view["abciResultVerified"] != true || view["fundsVerified"] != false || view["nativeGrant"] != false {
		t.Fatalf("normal native profile did not reach original CORE: %d %+v", status, saved)
	}
	if saved["contextPin"] != qaDigest([]byte(":"+pin+":"+qaDigest(proofCode))) || saved["reportText"] != report || saved["report"].(map[string]any)["nonce"].(json.Number).String() != "9007199254740993" {
		t.Fatalf("independent input or original large integer report lost: %+v", saved)
	}
	id := saved["receiptId"].(string)
	qaClientSaved(t, p, ticket, id, saved)
	p.stop()

	// Reconfiguration is allowed only after this native process has exited. It
	// reuses no browser ticket, and the previous receipt remains historical only.
	cli(true, "--configure-proof-context", secondPath, "--context-sha256", pin)
	if previous, e := os.ReadFile(filepath.Join(data, "proof-profile.previous-"+qaDigest(firstProfile)+".json")); e != nil || !bytes.Equal(previous, firstProfile) {
		t.Fatal("previous configuration was not preserved")
	}
	second := qaNativeStart(t, launcher, qaDirectory, upstream.URL)
	if second.code == p.code {
		t.Fatal("reconfiguration reused old pairing code")
	}
	if status, _ := qaClientAPI(t, second, "/api/receipts", ticket, map[string]any{}); status != 401 {
		t.Fatal("reconfiguration restored old ticket")
	}
	secondTicket := qaClientPair(t, second)
	qaClientSaved(t, second, secondTicket, id, saved)
	second.crash()
	third := qaNativeStart(t, launcher, qaDirectory, upstream.URL)
	thirdTicket := qaClientPair(t, third)
	qaClientSaved(t, third, thirdTicket, id, saved)
	third.stop()

	// Missing/replaced public input prevents startup, while an explicit new
	// independently pinned choice can recover without deleting the old bytes.
	changedContext := []byte(`{"changed":true,"nonce":9007199254740993}`)
	if e = os.WriteFile(secondPath, changedContext, 0600); e != nil {
		t.Fatal(e)
	}
	cli(false, "--headless", "--rpc", upstream.URL)
	cli(true, "--configure-proof-context", contextPath, "--context-sha256", pin)
	if preserved, _ := os.ReadFile(secondPath); !bytes.Equal(preserved, changedContext) {
		t.Fatal("explicit recovery deleted or rewrote the replaced public material")
	}
	if e = os.WriteFile(secondPath, contextRaw, 0600); e != nil {
		t.Fatal(e)
	}
	cli(true, "--configure-proof-context", secondPath, "--context-sha256", pin)
	goodProfile, _ := os.ReadFile(profilePath)
	cases := []struct {
		name   string
		change func()
	}{
		{"damaged-profile", func() { _ = os.WriteFile(profilePath, append(append([]byte{}, goodProfile...), byte(' ')), 0600) }},
		{"wrong-owner-large-integer", func() {
			var doc map[string]any
			_ = json.Unmarshal(goodProfile, &doc)
			doc["ownerUID"] = json.Number("9007199254740993")
			raw, _ := json.Marshal(doc)
			_ = os.WriteFile(profilePath, raw, 0600)
		}},
		{"foreign-build", func() {
			var doc map[string]any
			_ = json.Unmarshal(goodProfile, &doc)
			doc["buildID"] = "qa-0000000000000000"
			raw, _ := json.Marshal(doc)
			_ = os.WriteFile(profilePath, raw, 0600)
		}},
		{"executable-injection", func() {
			var doc map[string]any
			_ = json.Unmarshal(goodProfile, &doc)
			doc["pqVerifier"] = "/bin/sh"
			raw, _ := json.Marshal(doc)
			_ = os.WriteFile(profilePath, raw, 0600)
		}},
		{"duplicate-profile-key", func() {
			raw := append(append([]byte{}, goodProfile[:len(goodProfile)-1]...), []byte(`,"ownerUID":"9007199254740993"}`)...)
			_ = os.WriteFile(profilePath, raw, 0600)
		}},
		{"unsafe-profile-permissions", func() { _ = os.Chmod(profilePath, 0666) }},
		{"context-replaced", func() { _ = os.WriteFile(secondPath, []byte(`{"changed":true}`), 0600) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.change()
			badProfile, _ := os.ReadFile(profilePath)
			badContext, _ := os.ReadFile(secondPath)
			out := cli(false, "--headless", "--rpc", upstream.URL)
			if bytes.Contains(out, []byte("Open: ")) {
				t.Fatalf("failed profile still started helper: %s", out)
			}
			after, _ := os.ReadFile(profilePath)
			contextAfter, _ := os.ReadFile(secondPath)
			if !bytes.Equal(after, badProfile) || !bytes.Equal(contextAfter, badContext) {
				t.Fatal("fail-closed path rewrote damaged input")
			}
			_ = os.WriteFile(profilePath, goodProfile, 0600)
			_ = os.Chmod(profilePath, 0600)
			_ = os.WriteFile(secondPath, contextRaw, 0600)
		})
	}
	// The local profile is only byte/path configuration: an accurately pinned
	// non-CORE JSON file reaches the real helper, which rejects its original schema.
	invalid := filepath.Join(dir, "not-a-CORE-context.json")
	bad := []byte(`{"version":"not-original-CORE","nonce":9007199254740993}`)
	_ = os.WriteFile(invalid, bad, 0600)
	cli(true, "--configure-proof-context", invalid, "--context-sha256", qaDigest(bad))
	out := cli(false, "--headless", "--rpc", upstream.URL)
	if bytes.Contains(out, []byte("Open: ")) || !bytes.Contains(out, []byte("original transaction trust context required")) {
		t.Fatalf("local wrapper replaced original CORE context validation: %s", out)
	}
	cli(true, "--configure-proof-context", secondPath, "--context-sha256", pin)
	final := qaNativeStart(t, launcher, qaDirectory, upstream.URL)
	finalTicket := qaClientPair(t, final)
	qaClientSaved(t, final, finalTicket, id, saved)
	final.stop()
	t.Log("native configuration -> packaged helper -> original CORE signed isolated proof -> exact large-integer receipt -> configuration/session/crash recovery PASS; no GUI, deployed Source, Wallet approval or funds authority")
}
