//go:build (linux || darwin) && securelink_openssl && cgo

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// This PUBLIC script loads the production LINK module and actual native addon.
// It does not supply an Auth Source, SDK codec, SQL store or TaskGrant approval.
const desktopTaskGrantNodeTLSFixture = `
import assert from 'node:assert/strict';
import readline from 'node:readline';
import {pathToFileURL} from 'node:url';
const [modulePath,socketPath,goUID,goPID]=process.argv.slice(1);
const {openTaskGrantInboundTransportForOriginalBootstrap:open}=await import(pathToFileURL(modulePath).href);
const suffixes=['issue','effect','query','effect-query','effect-reconcile','revoke','management'];
const routes=suffixes.map(s=>({method:'POST',path:'/internal/auth/task-grants/'+s,maxRequestBytes:1048576,maxResponseBytes:1048576}));
let owner,count=0;
const opened=await open({socketPath,nodeUID:process.geteuid(),bridgeUID:Number(goUID),bridgePID:Number(goPID),service:'desktop-grant-tls-test',acceptTimeoutMs:500,currentTimeoutMs:2000,maxConnections:8,routes},async(req,res)=>{
 let caller;
 try{
  const acquired=await owner.acquireOriginalInbound(req);caller=acquired.caller;
  if(acquired.errorPresent)throw acquired.error;
  assert.ok(caller);
  const material=await owner.currentOriginalInbound(caller);
  assert.equal(material.Method,'POST');assert.equal(material.Path,req.url);
  assert.equal(material.ContentType,'application/json');
  assert.equal(material.Channel.LocalSAN,'adapter.ynx.test');
  assert.equal(material.Channel.Peer.SubjectAltName,'pay.ynx.test');
  assert.equal(material.Channel.Exporter.length,32);
  assert.match(material.Channel.Peer.CertDigest,/^[0-9a-f]{64}$/);
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=Buffer.concat(chunks);assert.deepEqual(body,material.Body);
  assert.equal(owner.assertOriginalInboundAtCommit(caller),undefined);
  await owner.releaseOriginalInbound(caller);caller=null;
  assert.equal(req.socket.destroyed,false);
  count++;process.stdout.write(JSON.stringify({event:'request',path:req.url,body:body.toString('base64'),exporterBytes:material.Channel.Exporter.length})+'\n');
  res.writeHead(200,{'content-type':'application/json'});res.end(body);
 }finally{if(caller)await owner.releaseOriginalInbound(caller);}
});
owner=opened.owner;if(opened.errorPresent)throw opened.error;
assert.ok(owner.registeredServer());
process.stdout.write(JSON.stringify({event:'ready',pid:process.pid})+'\n');
const lines=readline.createInterface({input:process.stdin});
let stopped=false;
for await(const line of lines){
 if(line!=='stop'||stopped)throw Error('PUBLIC stop command required');stopped=true;
 owner.retire();await owner.join();await Promise.all([owner.close(),owner.close()]);
 const life=owner.lifetime();assert.equal(life.closed,true);assert.equal(life.joined,true);assert.equal(life.callerHolds,0);assert.equal(life.pending,0);assert.equal(life.cleanupUnknown,false);assert.equal(count,7);
 process.stdout.write(JSON.stringify({event:'closed',count,life})+'\n');break;
}
lines.close();process.stdin.pause();if(!stopped)throw Error('PUBLIC cleanup command not supplied');
`

func TestDesktopTaskGrantNativeTLSSevenRoutesToActualNode(t *testing.T) {
	uid := localTestUID(t)
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	repository := filepath.Clean(filepath.Join(wd, "../.."))
	caller := filepath.Join(repository, "cmd/ynx-secure-link-caller")
	for _, leaf := range []string{
		"cmd/ynx-secure-link-caller/build/caller.node",
		"cmd/ynx-secure-link-caller/native.c",
		"cmd/ynx-secure-link-caller/inbound-caller.mjs",
		"cmd/ynx-secure-link-caller/task-grant-transport.mjs",
		"cmd/ynx-secure-link-caller/task-grant-transport-private.mjs",
		"internal/securelink/authority_ingress_unix.go",
		"internal/securelink/task_grant_transport_unix.go",
		"internal/securelink/task_grant_transport_openssl_test.go",
		"internal/securelink/native/bridge.c",
		"internal/securelink/native/bridge.h",
	} {
		raw, e := os.ReadFile(filepath.Join(repository, leaf))
		if e != nil {
			t.Fatalf("matching original native/module prerequisite %s: %v", leaf, e)
		}
		hash := sha256.Sum256(raw)
		t.Logf("PUBLIC_TASK_GRANT_TLS_INPUT %s bytes=%d sha256=%s", leaf, len(raw), hex.EncodeToString(hash[:]))
	}
	socketDirectory, err := os.MkdirTemp("", "tg7-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketDirectory) })
	if err = os.Chmod(socketDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	socketPath := filepath.Join(socketDirectory, "s")
	if len([]byte(socketPath)) >= 104 {
		t.Fatal("owned temporary Unix socket exceeds the actual Darwin path boundary")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, "node", "--input-type=module", "--eval", desktopTaskGrantNodeTLSFixture,
		filepath.Join(caller, "task-grant-transport.mjs"), socketPath, strconv.FormatUint(uint64(uid), 10), strconv.Itoa(os.Getpid()))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	events := make(chan map[string]json.RawMessage, 16)
	readDone := make(chan error, 1)
	go func() {
		defer close(readDone)
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 1024), 64<<10)
		for scanner.Scan() {
			var event map[string]json.RawMessage
			if e := json.Unmarshal(scanner.Bytes(), &event); e != nil {
				readDone <- e
				close(events)
				return
			}
			events <- event
		}
		readDone <- scanner.Err()
		close(events)
	}()
	var waitErr error
	waited := false
	t.Cleanup(func() {
		_ = stdin.Close()
		if !waited {
			_ = cmd.Process.Kill() // Only this test's owned child on failure.
			waitErr = cmd.Wait()
			<-readDone
		}
		if stderr.Len() > 0 {
			t.Logf("PUBLIC TaskGrant Node stderr: %s", stderr.String())
		}
	})
	next := func(kind string) map[string]json.RawMessage {
		t.Helper()
		select {
		case event, ok := <-events:
			if !ok {
				t.Fatalf("actual Node ended before %s", kind)
			}
			var actual string
			if e := json.Unmarshal(event["event"], &actual); e != nil || actual != kind {
				t.Fatalf("expected actual Node %s, got %v", kind, event)
			}
			return event
		case <-ctx.Done():
			t.Fatalf("actual Node %s deadline: %v", kind, ctx.Err())
			return nil
		}
	}
	ready := next("ready")
	var nodePID int
	if err = json.Unmarshal(ready["pid"], &nodePID); err != nil || nodePID != cmd.Process.Pid {
		t.Fatal("Node readiness is not the owned actual process")
	}
	suffixes := []string{"issue", "effect", "query", "effect-query", "effect-reconcile", "revoke", "management"}
	cfg := AuthorityIPCIngressConfig{Service: "desktop-grant-tls-test", SocketPath: socketPath, PeerUID: uid, PeerPID: nodePID}
	fixture := newTLSFixture(t)
	policy := fixture.policy(true)
	policy.Edges[0].ID = "desktop-task-grant-public-transport"
	policy.Edges[0].Routes = nil
	for _, suffix := range suffixes {
		path := "/internal/auth/task-grants/" + suffix
		cfg.Routes = append(cfg.Routes, AuthorityIngressRoute{Method: http.MethodPost, Path: path, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20, Timeout: 3 * time.Second})
		policy.Edges[0].Routes = append(policy.Edges[0].Routes, Route{Method: http.MethodPost, Path: path, Risk: "write"})
	}
	ingress, err := NewDesktopTaskGrantIPCIngress(cfg)
	if err != nil {
		t.Fatal(err)
	}
	var server *HTTPServer
	var serveDone chan error
	// Adopt the ingress immediately. The same cleanup also adopts a later
	// successful TLS-server construction before any listener operation can fail.
	t.Cleanup(func() {
		_ = ingress.Retire()
		if server != nil {
			_ = server.Close()
		}
		drain, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		if e := ingress.Join(drain); e != nil {
			t.Errorf("actual desktop ingress did not drain: %v", e)
		}
		if e := ingress.Close(); e != nil {
			t.Errorf("actual desktop ingress close: %v", e)
		}
		if serveDone != nil {
			<-serveDone
		}
	})
	gate, err := NewGate(policy)
	if err != nil {
		t.Fatal(err)
	}
	server, err = NewHTTPServer(HTTPServerConfig{TLS: fixture.config(true), Gate: gate, EdgeID: policy.Edges[0].ID, Handler: ingress})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	serveDone = make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()
	for _, route := range cfg.Routes {
		body := []byte(fmt.Sprintf("{ \"PUBLIC\":\"seven TLS transport routes\", \"path\":%q }\n", route.Path))
		conn := dialNative(t, fixture, listener.Addr().String())
		request, e := http.NewRequest(http.MethodPost, "https://adapter.ynx.test"+route.Path, bytes.NewReader(body))
		if e != nil {
			t.Fatal(e)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Close = true
		if e = request.Write(conn); e != nil {
			t.Fatal(e)
		}
		response, e := http.ReadResponse(bufio.NewReader(conn), request)
		if e != nil {
			t.Fatal(e)
		}
		returned, e := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if e != nil || response.StatusCode != 200 || !bytes.Equal(returned, body) {
			t.Fatalf("actual PQ/SCM/Node %s: status=%d err=%v raw=%q", route.Path, response.StatusCode, e, returned)
		}
		event := next("request")
		var observedPath string
		var observedBody []byte // JSON base64 is only the PUBLIC diagnostic copy.
		if e = json.Unmarshal(event["path"], &observedPath); e != nil || observedPath != route.Path {
			t.Fatal("Node observed another original route")
		}
		if e = json.Unmarshal(event["body"], &observedBody); e != nil || !bytes.Equal(observedBody, body) {
			t.Fatal("Node C material/body differed from original TLS bytes")
		}
	}
	if _, err = io.WriteString(stdin, "stop\n"); err != nil {
		t.Fatal(err)
	}
	closed := next("closed")
	if !bytes.Contains(closed["life"], []byte(`"closed":true`)) {
		t.Fatal("actual Node physical close was not observed")
	}
	_ = stdin.Close()
	if err = <-readDone; err != nil {
		t.Fatal(err)
	}
	waitErr = cmd.Wait()
	waited = true
	if waitErr != nil {
		t.Fatalf("owned actual Node did not exit normally: %v; %s", waitErr, stderr.String())
	}
	if !strings.Contains(string(closed["life"]), `"sourceVerified":false`) {
		t.Fatal("PUBLIC transport fixture lost its Source boundary")
	}
	t.Logf("PUBLIC_TASK_GRANT_NATIVE_TLS seven routes actual NodePID=%d GoPID=%d normalExit=true RootAdmission=false Source4=false", nodePID, os.Getpid())
}
