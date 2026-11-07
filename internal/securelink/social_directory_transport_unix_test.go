//go:build linux || darwin

package securelink

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"
)

var errSocialDirectoryPUBLICCurrent = errors.New("PUBLIC Main current revoked")

// Explicit PUBLIC Source/Root-verifier seam for transport only. It neither
// authenticates V4 nor issues/consumes any Host nonce or Principal.
type socialDirectoryPUBLICBinding struct {
	mu                             sync.Mutex
	originals                      SocialDirectoryOriginals
	response                       []byte
	revoked, late, retired, closed bool
	closes                         int
}

func (b *socialDirectoryPUBLICBinding) Current(context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.revoked || b.retired {
		return errSocialDirectoryPUBLICCurrent
	}
	return nil
}
func (b *socialDirectoryPUBLICBinding) Originals(context.Context) (SocialDirectoryOriginals, error) {
	return socialDirectoryCopyOriginals(b.originals)
}
func (b *socialDirectoryPUBLICBinding) InspectOriginalRootResponse(_ context.Context, raw []byte) ([32]byte, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if !bytes.Equal(raw, b.response) {
		return [32]byte{}, ErrDenied
	}
	if b.late {
		b.revoked = true
	}
	return sha256.Sum256(b.originals.RequestOriginal), nil
}
func (b *socialDirectoryPUBLICBinding) Retire()                    { b.mu.Lock(); b.retired = true; b.mu.Unlock() }
func (b *socialDirectoryPUBLICBinding) Join(context.Context) error { return nil }
func (b *socialDirectoryPUBLICBinding) Close() (bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.closes++
	b.closed = true
	return true, nil
}

// Preserve intentional UNKNOWN fake parents through process exit; cleanup
// cannot turn an unacknowledged peer into a released Source borrow.
var socialDirectoryPUBLICUnknownParents []*SocialDirectoryForwarder

const socialDirectoryPUBLICNode = `
import assert from 'node:assert/strict';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';import readline from'node:readline';
const[modulePath,socketPath,uid,pid,mode]=process.argv.slice(1);const{openSocialDirectoryInboundTransportForOriginalBootstrap:open}=await import(pathToFileURL(modulePath).href);
let owner;const body=Buffer.from('{"PUBLIC":"original response, not a Principal"}\n');
const opened=await open({socketPath,nodeUID:process.geteuid(),bridgeUID:Number(uid),bridgePID:Number(pid),service:'social-public-main',acceptTimeoutMs:500,currentTimeoutMs:2000,maxConnections:2,routes:['/v4/devices/directory','/m1qa/v4/devices/directory'].map(path=>({method:'GET',path,maxRequestBytes:0,maxResponseBytes:524288}))},async(req,res)=>{
 const acquired=await owner.acquireOriginalInbound(req);const caller=acquired.caller;if(acquired.errorPresent)throw acquired.error;
 const material=await owner.currentOriginalInbound(caller);assert.equal(material.transportKind,'localOSpeer');assert.equal('Channel'in material,false);assert.equal(material.Operation,'currentExistingSocialDeviceDirectoryPrincipalV4');assert.equal(material.SourceBindingOriginal.toString(),'PUBLIC-held-Main-binding');
 assert.equal(owner.assertOriginalInboundAtCommit(caller),undefined);
 res.setHeader('content-type','application/json');await new Promise(resolve=>res.end(body,resolve));
 const w=await owner.waitOriginalReadRelease(caller);assert.equal(w.length,74);assert.equal(w[0],87);assert.equal(w.readUInt32BE(1),69);assert.equal(w.readUInt32BE(5),0);assert.equal(w[9],1);
 assert.deepEqual(w.subarray(10,42),createHash('sha256').update(material.RequestOriginal).digest());assert.deepEqual(w.subarray(42,74),createHash('sha256').update(body).digest());
 if(mode==='drop'){process.exit(0);}
 const a=Buffer.alloc(81);a[0]=65;a.writeUInt32BE(76,1);a[9]=1;w.copy(a,10,10,74);a[74]=1;
 await owner.writeOriginalClosedAck(caller,a);await owner.releaseOriginalInbound(caller);
});owner=opened.owner;if(opened.errorPresent)throw opened.error;process.stdout.write(JSON.stringify({event:'ready',pid:process.pid})+'\n');
const lines=readline.createInterface({input:process.stdin});for await(const line of lines){if(line!=='stop')throw Error('PUBLIC stop required');owner.retire();await owner.join();await owner.close();assert.equal(owner.lifetime().closed,true);process.stdout.write(JSON.stringify({event:'closed',life:owner.lifetime()})+'\n');break;}lines.close();process.stdin.pause();
`

func TestSocialDirectoryActualMainForwarderNodeWACK(t *testing.T) {
	socialDirectoryPUBLICActualMain(t, []string{"normal", "late-source", "drop"})
}

func TestSocialDirectoryActualMainKnownCleanup(t *testing.T) {
	socialDirectoryPUBLICActualMain(t, []string{"retire-known", "cancel-known"})
}

func socialDirectoryPUBLICActualMain(t *testing.T, modes []string) {
	t.Helper()
	for _, mode := range modes {
		t.Run(mode, func(t *testing.T) {
			if os.Geteuid() == 0 {
				t.Fatal("nonzero actual registered principal required")
			}
			wd, e := os.Getwd()
			if e != nil {
				t.Fatal(e)
			}
			module := filepath.Clean(filepath.Join(wd, "../../cmd/ynx-secure-link-caller/social-directory-transport.mjs"))
			if _, e = os.Stat(filepath.Join(filepath.Dir(module), "build/caller.node")); e != nil {
				t.Fatalf("matching original native addon required before Go controls: %v", e)
			}
			dir, e := os.MkdirTemp("", "sdm-")
			if e != nil {
				t.Fatal(e)
			}
			t.Cleanup(func() { _ = os.RemoveAll(dir) })
			if e = os.Chmod(dir, 0700); e != nil {
				t.Fatal(e)
			}
			socket := filepath.Join(dir, "s")
			if len([]byte(socket)) >= 104 {
				t.Fatal("owned Unix endpoint exceeds actual OS limit")
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			t.Cleanup(cancel)
			cmd := exec.CommandContext(ctx, "node", "--input-type=module", "--eval", socialDirectoryPUBLICNode, module, socket, strconv.Itoa(os.Geteuid()), strconv.Itoa(os.Getpid()), mode)
			stdout, e := cmd.StdoutPipe()
			if e != nil {
				t.Fatal(e)
			}
			stdin, e := cmd.StdinPipe()
			if e != nil {
				t.Fatal(e)
			}
			var stderr bytes.Buffer
			cmd.Stderr = &stderr
			if e = cmd.Start(); e != nil {
				t.Fatal(e)
			}
			scanner := bufio.NewScanner(stdout)
			waited := false
			t.Cleanup(func() {
				_ = stdin.Close()
				if !waited {
					_ = cmd.Process.Kill()
					_ = cmd.Wait()
				}
				if stderr.Len() > 0 {
					t.Log(stderr.String())
				}
			})
			if !scanner.Scan() {
				t.Fatal("actual Node readiness missing")
			}
			var ready struct {
				Event string
				PID   int
			}
			if e = json.Unmarshal(scanner.Bytes(), &ready); e != nil || ready.Event != "ready" || ready.PID != cmd.Process.Pid {
				t.Fatal("actual owned Node process mismatch")
			}
			requestCtx, requestCancel := context.WithCancel(context.Background())
			defer requestCancel()
			r := httptest.NewRequest(http.MethodGet, SocialDirectoryPath, nil).WithContext(requestCtx)
			r.Host = "main-public.test"
			r.Header.Set(SocialDirectoryProofHeader, "PUBLIC-not-a-V4-proof")
			// Literal PUBLIC input is not claimed to be Auth canonical request6.
			raw := []byte(`{"requestId":"req_PUBLIC_directory_0001","method":"GET","path":"/v4/devices/directory","body":"","proofHeader":"PUBLIC-not-a-V4-proof","expected":{"PUBLIC":"not qualified"}}`)
			binding := &socialDirectoryPUBLICBinding{originals: SocialDirectoryOriginals{raw, []byte("PUBLIC-held-Main-binding"), []byte("PUBLIC-source-window")}, response: []byte("{\"PUBLIC\":\"original response, not a Principal\"}\n"), late: mode == "late-source"}
			opens := 0
			f, e := NewSocialDirectoryForwarderForOriginalBootstrap(SocialDirectoryForwarderConfig{Service: "social-public-main", SocketPath: socket, PeerUID: uint32(os.Geteuid()), PeerPID: ready.PID, Timeout: 5 * time.Second, OpenOriginalReadBinding: func(_ context.Context, same *http.Request, caller *OriginalSocialDirectoryCaller, op SocialDirectoryOperation) (SocialDirectoryReadBinding, error) {
				opens++
				if same != r || op != SocialDirectoryCurrent || caller.CurrentOriginalRequest(r) != nil {
					return nil, ErrDenied
				}
				return binding, nil
			}})
			if e != nil {
				t.Fatal(e)
			}
			loan, forwardErr := f.ForwardOriginal(r.Context(), r, SocialDirectoryCurrent)
			if loan == nil {
				t.Fatalf("non-null controlled partial response: %v", forwardErr)
			}
			if mode == "late-source" {
				if !errors.Is(forwardErr, errSocialDirectoryPUBLICCurrent) {
					t.Fatalf("lost actual late current: %v", forwardErr)
				}
			} else if forwardErr != nil {
				t.Fatal(forwardErr)
			}
			data := loan.Response()
			if !data.BodyComplete || data.StatusCode != 200 || !bytes.Equal(data.Body, binding.response) {
				t.Fatalf("actual Main response not retained: %+v", data)
			}
			data.Body[0] = 0
			if !bytes.Equal(loan.Response().Body, binding.response) {
				t.Fatal("response aliases consumer storage")
			}
			if mode == "retire-known" {
				loan.Retire()
			}
			if mode == "cancel-known" {
				requestCancel()
				<-loan.call.originalEnded
			}
			done, finishErr := loan.Finish(ctx)
			if mode == "drop" {
				if done || finishErr == nil || !loan.Lifetime().Unknown {
					t.Fatal("EOF substituted for A")
				}
				if life := loan.Lifetime(); !life.LocalPhysicalDone || life.RemotePhysicalClosed || life.BindingPhysicalClosed {
					t.Fatalf("lost A did not separately return local fd/worker while retaining remote/Source debt: %+v", life)
				}
				binding.mu.Lock()
				closed, closes := binding.closed, binding.closes
				binding.mu.Unlock()
				if closed || closes != 0 {
					t.Fatal("unknown peer dropped Main Source debt")
				}
				if next, e := f.ForwardOriginal(r.Context(), r, SocialDirectoryCurrent); e == nil || next != nil || opens != 1 {
					t.Fatal("same attempt replayed after lost A")
				}
				if next, e := f.ForwardOriginal(r.Context(), r, SocialDirectoryRecheck); e == nil || next != nil || opens != 1 {
					t.Fatal("UNKNOWN switched to recheck")
				}
				socialDirectoryPUBLICUnknownParents = append(socialDirectoryPUBLICUnknownParents, f)
				_ = stdin.Close()
				e = cmd.Wait()
				waited = true
				if e != nil {
					t.Fatal(e)
				}
				return
			}
			if !done || !loan.Lifetime().Closed || !loan.Lifetime().LocalPhysicalDone || !loan.Lifetime().RemotePhysicalClosed {
				t.Fatalf("valid A and actual drain not complete: %v %+v", finishErr, loan.Lifetime())
			}
			if mode == "normal" && finishErr != nil {
				t.Fatal(finishErr)
			}
			if mode == "late-source" && (!errors.Is(finishErr, errSocialDirectoryPUBLICCurrent) || loan.Lifetime().Usable) {
				t.Fatal("late Source failure became success")
			}
			if (mode == "retire-known" || mode == "cancel-known") && (!errors.Is(finishErr, context.Canceled) || loan.Lifetime().Usable) {
				t.Fatalf("business cancellation lost first cause or blocked same-original cleanup: %v %+v", finishErr, loan.Lifetime())
			}
			binding.mu.Lock()
			closes := binding.closes
			binding.mu.Unlock()
			if closes != 1 {
				t.Fatal("actual Main binding was not closed once")
			}
			if _, e = io.WriteString(stdin, "stop\n"); e != nil {
				t.Fatal(e)
			}
			if !scanner.Scan() {
				t.Fatal("actual Node physical close missing")
			}
			var stopped struct{ Event string }
			if e = json.Unmarshal(scanner.Bytes(), &stopped); e != nil || stopped.Event != "closed" {
				t.Fatal("Node close witness mismatch")
			}
			_ = stdin.Close()
			for scanner.Scan() {
			}
			if e = scanner.Err(); e != nil {
				t.Fatal(e)
			}
			e = cmd.Wait()
			waited = true
			if e != nil {
				t.Fatalf("actual owned Node exit: %v %s", e, stderr.String())
			}
			t.Logf("PUBLIC actual Main/Node L-C W74/A81 mode=%s GoPID=%d NodePID=%d SourceAdmission=false nonceConsumed=false", mode, os.Getpid(), ready.PID)
		})
	}
}

func TestSocialDirectoryClosedCancelledCapacityReclaimed(t *testing.T) {
	dir, e := os.MkdirTemp("", "sdc-")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if e = os.Chmod(dir, 0700); e != nil {
		t.Fatal(e)
	}
	openErr := errors.New("PUBLIC original binding partial; no dispatch")
	var bindings []*socialDirectoryPUBLICBinding
	f, e := NewSocialDirectoryForwarderForOriginalBootstrap(SocialDirectoryForwarderConfig{Service: "social-public-capacity", SocketPath: filepath.Join(dir, "s"), PeerUID: uint32(os.Geteuid()), PeerPID: os.Getpid(), Timeout: time.Second, MaxConcurrentRequests: 1,
		OpenOriginalReadBinding: func(context.Context, *http.Request, *OriginalSocialDirectoryCaller, SocialDirectoryOperation) (SocialDirectoryReadBinding, error) {
			b := &socialDirectoryPUBLICBinding{}
			bindings = append(bindings, b)
			return b, openErr
		}})
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 3; i++ {
		ctx, cancel := context.WithCancel(context.Background())
		r := httptest.NewRequest(http.MethodGet, SocialDirectoryPath, nil).WithContext(ctx)
		r.Header.Set(SocialDirectoryProofHeader, "PUBLIC-not-a-V4-proof")
		loan, err := f.ForwardOriginal(ctx, r, SocialDirectoryCurrent)
		if loan == nil || !errors.Is(err, openErr) {
			cancel()
			t.Fatalf("closed cancelled request retained capacity at %d: %v", i, err)
		}
		cancel()
		<-loan.call.originalEnded // Actual original-context callback ran first.
		f.mu.Lock()
		before := len(f.seen)
		f.mu.Unlock()
		if before != 1 {
			t.Fatal("partial binding disappeared before physical cleanup")
		}
		if done, err := loan.Finish(context.Background()); !done || !errors.Is(err, openErr) {
			t.Fatalf("partial cleanup lost first cause/physical fact: %v %v", done, err)
		}
		f.mu.Lock()
		after := len(f.seen)
		f.mu.Unlock()
		if after != 0 || !loan.Lifetime().Closed || loan.Lifetime().DispatchPossible {
			t.Fatalf("known-closed cancelled tombstone not reclaimed: %d %+v", after, loan.Lifetime())
		}
	}
	for _, b := range bindings {
		if b.closes != 1 {
			t.Fatal("actual partial binding close was replayed")
		}
	}
	t.Log("PUBLIC capacity=1 three original cancelled partials drained; no HTTP/Host/nonce/Source admission")
}
