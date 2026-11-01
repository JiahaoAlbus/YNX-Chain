package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

// This actual compiled child implements only the original read-only Comet
// Status / ABCI identity response shapes. It is PUBLIC isolated transport data,
// not a CORE ordinary executable, admission, signer, block producer or proof.
const nodeSyncFixture = `package main
import("encoding/base64";"encoding/json";"net";"net/http";"os";"os/signal";"strconv";"strings";"syscall";"time")
func main(){
 seed,err:=os.ReadFile("sync-seed.json");if err!=nil{os.Exit(2)};var n map[string]string;if json.Unmarshal(seed,&n)!=nil{os.Exit(2)}
 l,err:=net.ListenUnix("unix",&net.UnixAddr{Name:"comet-sync.sock",Net:"unix"});if err!=nil{os.Exit(3)};l.SetUnlinkOnClose(false);os.Chmod("comet-sync.sock",0600);owned,_:=os.Lstat("comet-sync.sock")
 defer func(){l.Close();if info,e:=os.Lstat("comet-sync.sock");e==nil&&os.SameFile(info,owned){os.Remove("comet-sync.sock")}}()
 handler:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
 modeRaw,_:=os.ReadFile("sync-mode");mode:=string(modeRaw);height:="9007199254740993";if mode=="leading-zero"{height="01"};if mode=="negative"{height="-1"};if mode=="overflow"{height="9223372036854775808"}
 if mode=="blocked"{os.WriteFile("sync-reading",[]byte(r.URL.Path),0600);for{if _,e:=os.Stat("sync-release");e==nil{break};time.Sleep(time.Millisecond)}}
 if r.URL.Path=="/status"{
  if mode=="exit"{os.Exit(9)};if mode=="large"{w.Write([]byte(strings.Repeat("x",33000)));return};if mode=="redirect"{w.Header().Set("Location","http://127.0.0.1:1/");w.WriteHeader(302);return}
  network:=n["cometChainId"];if mode=="wrong-comet"{network="other-chain"}
  catching:=any(false);if mode=="missing-bool"{catching=nil};h:=any(height);if mode=="numeric-height"{h=json.Number(height)}
  if mode=="duplicate"{w.Write([]byte("{\"jsonrpc\":\"2.0\",\"result\":{\"node_info\":{\"network\":\""+network+"\",\"network\":\""+network+"\"},\"sync_info\":{\"latest_block_height\":\""+height+"\",\"catching_up\":false}}}"));return}
  json.NewEncoder(w).Encode(map[string]any{"jsonrpc":"2.0","id":-1,"result":map[string]any{"node_info":map[string]any{"network":network},"sync_info":map[string]any{"latest_block_height":h,"catching_up":catching},"validator_info":map[string]any{"untrusted":"<script>height=999 synced=true</script>"}}});return
 }
 if r.URL.Path!="/abci_query"||r.URL.Query().Get("path")!=strconv.Quote("/pq-wallet/identity"){w.WriteHeader(404);return}
 native,genesis,cometGenesis:=n["nativeChainId"],n["nativeGenesisSHA256"],n["cometGenesisSHA256"]
 if mode=="wrong-native"{native="6424"};if mode=="wrong-genesis"{genesis=strings.Repeat("a",64)};if mode=="wrong-comet-genesis"{cometGenesis=strings.Repeat("b",64)}
 identity:=map[string]any{"version":"ynx-pq-wallet-identity-v1","source":"configured-abci-bootstrap","recordsView":"committed","hashAlgorithm":"sha256","nativeChainId":native,"nativeGenesisHash":genesis,"cometChainId":n["cometChainId"],"cometGenesisSHA256":cometGenesis,"migrationStateHash":strings.Repeat("7",64),"migrationHeight":"1","initialHeight":"2","currentStateHeight":height,"currentStateAppHash":strings.Repeat("8",64)}
 if mode=="extra-identity"{identity["networkId32"]=n["networkId32"]};if mode=="wrong-source"{identity["source"]="caller-supplied"}
 raw,_:=json.Marshal(identity);json.NewEncoder(w).Encode(map[string]any{"jsonrpc":"2.0","id":-1,"result":map[string]any{"response":map[string]any{"code":0,"height":height,"value":base64.StdEncoding.EncodeToString(raw)}}})
 })
 server:=&http.Server{Handler:handler,ReadHeaderTimeout:time.Second};go server.Serve(l);os.WriteFile("sync-ready",[]byte("ready"),0600)
 done:=make(chan os.Signal,1);signal.Notify(done,os.Interrupt,syscall.SIGTERM);<-done;server.Close()
}`

func TestNetworkNativeNodeSynchronization(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("kernel Unix child identity required")
	}
	buildRoot, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source, binary := filepath.Join(buildRoot, "sync-observer.go"), filepath.Join(buildRoot, "sync-observer")
	if err = os.WriteFile(source, []byte(nodeSyncFixture), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("go", "build", "-p", "1", "-trimpath", "-o", binary, source)
	command.Dir, command.Env = buildRoot, append(os.Environ(), "GOMAXPROCS=2", "GOWORK=off")
	if raw, err := command.CombinedOutput(); err != nil {
		t.Fatalf("actual read-only child compile: %v %s", err, raw)
	}
	artifact, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(artifact)
	digest := hex.EncodeToString(sum[:])
	peer := diagnosticsPeer(t)
	network := ownednode.RuntimeNetwork{NetworkID32: strings.Repeat("4", 64), NativeChainID: "6423", NativeGenesisSHA256: strings.Repeat("5", 64), CometChainID: "ynx_6423-1", CometGenesisSHA256: strings.Repeat("6", 64)}
	newManager := func(t *testing.T, enabled bool) (*ownednode.Manager, ownednode.Config) {
		t.Helper()
		dir, err := os.MkdirTemp(os.TempDir(), "ns-")
		if err != nil {
			t.Fatal(err)
		}
		dir, err = filepath.EvalSymlinks(dir)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = os.RemoveAll(dir) })
		cfg := ownednode.Config{Directory: filepath.Join(dir, ownednode.DirectoryName), IsolatedFixture: true, MaxArtifactBytes: uint64(len(artifact)) + 1, StorageQuotaBytes: 32 << 20, StopGrace: time.Second}
		if enabled {
			n := network
			cfg.FixtureSynchronizationNetwork = &n
		}
		m, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { diagnosticsClose(t, m) })
		intent, approval := diagnosticsApproval(t, m, peer, "install", digest)
		if err = m.InstallFixture(context.Background(), peer, intent, approval, artifact); err != nil {
			t.Fatal(err)
		}
		seed, _ := json.Marshal(network)
		if err = os.WriteFile(filepath.Join(cfg.Directory, "data", "sync-seed.json"), seed, 0600); err != nil {
			t.Fatal(err)
		}
		return m, cfg
	}
	start := func(t *testing.T, m *ownednode.Manager, cfg ownednode.Config) string {
		t.Helper()
		_ = os.Remove(filepath.Join(cfg.Directory, "data", "sync-ready"))
		i, a := diagnosticsApproval(t, m, peer, "start", "")
		run, err := m.Start(context.Background(), peer, i, a)
		if err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(3 * time.Second)
		for {
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "sync-ready")); err == nil {
				return run
			}
			if time.Now().After(deadline) {
				s, _ := m.Status(peer)
				t.Fatalf("child did not expose isolated original-shape endpoint %+v", s)
			}
			time.Sleep(time.Millisecond)
		}
	}
	stop := func(t *testing.T, m *ownednode.Manager) {
		t.Helper()
		i, a := diagnosticsApproval(t, m, peer, "stop", "")
		if err := m.Stop(context.Background(), peer, i, a); err != nil {
			t.Fatal(err)
		}
	}
	mode := func(t *testing.T, cfg ownednode.Config, s string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(cfg.Directory, "data", "sync-mode"), []byte(s), 0600); err != nil {
			t.Fatal(err)
		}
	}
	empty := func(t *testing.T, s ownednode.Synchronization) {
		t.Helper()
		if s.LocalHeight != nil || s.TargetHeight != nil || s.CatchingUp != nil || s.Source != nil || s.UpdatedAt != nil || s.ExpiresAt != nil || s.RunID != nil || s.Generation != nil || s.NetworkIdentity != nil || s.Authority || s.NetworkID32Observed {
			t.Fatalf("stale/missing report retained data or authority %+v", s)
		}
	}
	t.Run("default-off-and-production-cannot-enable-fixture", func(t *testing.T) {
		m, cfg := newManager(t, false)
		start(t, m, cfg)
		s, err := m.RefreshSynchronization(context.Background(), peer)
		if err != nil || s.Code != "NOT_SUPPLIED" {
			t.Fatalf("default reader not closed %+v %v", s, err)
		}
		empty(t, s)
		bad := cfg
		bad.Directory = filepath.Join(filepath.Dir(cfg.Directory), "bad", ownednode.DirectoryName)
		bad.IsolatedFixture = false
		bad.FixtureSynchronizationNetwork = &network
		if _, err := ownednode.New(bad); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatalf("production accepted fixture %v", err)
		}
		if _, err := os.Stat(bad.Directory); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("rejected fixture created production directory")
		}
	})
	t.Run("actual-peer-big-integer-freshness-stop-and-cold-reopen", func(t *testing.T) {
		m, cfg := newManager(t, true)
		run := start(t, m, cfg)
		original, err := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if err != nil {
			t.Fatal(err)
		}
		s, err := m.RefreshSynchronization(context.Background(), peer)
		if err != nil || s.Code != "ISOLATED_PROCESS_REPORTED" || s.LocalHeight == nil || *s.LocalHeight != "9007199254740993" || s.TargetHeight != nil || s.CatchingUp == nil || *s.CatchingUp || s.Source == nil || *s.Source != "owned-process-unix-comet" || s.RunID == nil || *s.RunID != run || s.Generation == nil || s.UpdatedAt == nil || s.ExpiresAt == nil || s.NetworkIdentity == nil || s.NetworkIdentity.NativeGenesisSHA256 != network.NativeGenesisSHA256 || s.Authority || s.NetworkID32Observed || !s.IsolatedFixture {
			t.Fatalf("actual child observation invalid %+v %v", s, err)
		}
		*s.LocalHeight = "tampered"
		s.NetworkIdentity.NativeGenesisSHA256 = "tampered"
		read, err := m.Status(peer)
		if err != nil || *read.Diagnostics.Synchronization.LocalHeight != "9007199254740993" || read.Diagnostics.Synchronization.NetworkIdentity.NativeGenesisSHA256 != network.NativeGenesisSHA256 {
			t.Fatalf("caller altered cache %+v %v", read, err)
		}
		after, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if !bytes.Equal(original, after) {
			t.Fatal("read-only synchronization changed journal")
		}
		expiry, _ := time.Parse(time.RFC3339Nano, *read.Diagnostics.Synchronization.ExpiresAt)
		time.Sleep(time.Until(expiry) + 10*time.Millisecond)
		expired, _ := m.Status(peer)
		if expired.Diagnostics.Synchronization.Code != "EXPIRED" {
			t.Fatalf("expired report retained %+v", expired.Diagnostics.Synchronization)
		}
		empty(t, expired.Diagnostics.Synchronization)
		stop(t, m)
		stopped, _ := m.Status(peer)
		empty(t, stopped.Diagnostics.Synchronization)
		run2 := start(t, m, cfg)
		if run2 == run {
			t.Fatal("restart reused run")
		}
		fresh, _ := m.Status(peer)
		empty(t, fresh.Diagnostics.Synchronization)
		stop(t, m)
		diagnosticsClose(t, m)
		next, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer diagnosticsClose(t, next)
		cold, err := next.Status(peer)
		if err != nil || cold.ProcessOwned || cold.RunID != run2 || cold.Diagnostics.Synchronization.Code != "NOT_RUNNING" {
			t.Fatalf("cold reopen adopted sample/process %+v %v", cold, err)
		}
		empty(t, cold.Diagnostics.Synchronization)
	})
	t.Run("actual-child-original-callee-validation", func(t *testing.T) {
		m, cfg := newManager(t, true)
		start(t, m, cfg)
		for _, bad := range []string{"wrong-comet", "wrong-native", "wrong-genesis", "wrong-comet-genesis", "wrong-source", "extra-identity", "leading-zero", "negative", "overflow", "numeric-height", "missing-bool", "duplicate", "large", "redirect"} {
			t.Run(bad, func(t *testing.T) {
				mode(t, cfg, bad)
				s, err := m.RefreshSynchronization(context.Background(), peer)
				if err == nil || s.Code != "UNAVAILABLE" {
					t.Fatalf("invalid child report accepted %+v %v", s, err)
				}
				empty(t, s)
				status, _ := m.Status(peer)
				empty(t, status.Diagnostics.Synchronization)
			})
		}
	})
	t.Run("same-uid-foreign-process-socket-replacement", func(t *testing.T) {
		m, cfg := newManager(t, true)
		start(t, m, cfg)
		socket := filepath.Join(cfg.Directory, "data", "comet-sync.sock")
		if err := os.Rename(socket, filepath.Join(filepath.Dir(cfg.Directory), "original-sync.sock")); err != nil {
			t.Fatal(err)
		}
		listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: socket, Net: "unix"})
		if err != nil {
			t.Fatal(err)
		}
		listener.SetUnlinkOnClose(false)
		defer listener.Close()
		if err = os.Chmod(socket, 0600); err != nil {
			t.Fatal(err)
		}
		server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("foreign process received protected read before kernel PID validation")
			w.Write([]byte(`{}`))
		})}
		go server.Serve(listener)
		defer server.Close()
		s, err := m.RefreshSynchronization(context.Background(), peer)
		if err == nil || s.Code != "UNAVAILABLE" {
			t.Fatalf("same UID substituted for held child %+v %v", s, err)
		}
		empty(t, s)
		stop(t, m)
		if _, err = os.Lstat(socket); err != nil {
			t.Fatal("manager/child deleted foreign replacement socket")
		}
	})
	t.Run("cancel-overlap-and-stop-fence-late-response", func(t *testing.T) {
		m, cfg := newManager(t, true)
		start(t, m, cfg)
		mode(t, cfg, "blocked")
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		result := make(chan error, 1)
		go func() { _, err := m.RefreshSynchronization(ctx, peer); result <- err }()
		deadline := time.Now().Add(time.Second)
		for {
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "sync-reading")); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("actual child read barrier absent")
			}
			time.Sleep(time.Millisecond)
		}
		overlap, err := m.RefreshSynchronization(context.Background(), peer)
		if err == nil {
			t.Fatal("overlapping reader accepted")
		}
		empty(t, overlap)
		cancel()
		select {
		case err := <-result:
			if err == nil {
				t.Fatal("cancelled read accepted")
			}
		case <-time.After(time.Second):
			t.Fatal("cancel did not close actual read")
		}
		if err := os.WriteFile(filepath.Join(cfg.Directory, "data", "sync-release"), []byte("release"), 0600); err != nil {
			t.Fatal(err)
		}
		status, _ := m.Status(peer)
		empty(t, status.Diagnostics.Synchronization)
		_ = os.Remove(filepath.Join(cfg.Directory, "data", "sync-reading"))
		_ = os.Remove(filepath.Join(cfg.Directory, "data", "sync-release"))
		go func() { _, err := m.RefreshSynchronization(context.Background(), peer); result <- err }()
		deadline = time.Now().Add(time.Second)
		for {
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "sync-reading")); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("stop read barrier absent")
			}
			time.Sleep(time.Millisecond)
		}
		stop(t, m)
		select {
		case err := <-result:
			if err == nil {
				t.Fatal("stopped run published late sample")
			}
		case <-time.After(time.Second):
			t.Fatal("stop did not cancel held read")
		}
		status, _ = m.Status(peer)
		empty(t, status.Diagnostics.Synchronization)
	})
	t.Run("deadline-and-unexpected-exit", func(t *testing.T) {
		t.Run("deadline-releases-read-without-sample", func(t *testing.T) {
			m, cfg := newManager(t, true)
			start(t, m, cfg)
			mode(t, cfg, "blocked")
			began := time.Now()
			sample, err := m.RefreshSynchronization(context.Background(), peer)
			if !errors.Is(err, context.DeadlineExceeded) || time.Since(began) > 3500*time.Millisecond {
				t.Fatalf("fixed read deadline failed %+v %v %s", sample, err, time.Since(began))
			}
			empty(t, sample)
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "sync-reading")); err != nil {
				t.Fatal("deadline did not exercise actual child read")
			}
			status, _ := m.Status(peer)
			empty(t, status.Diagnostics.Synchronization)
			stop(t, m)
		})
		t.Run("actual-exit-seals-current-observation", func(t *testing.T) {
			m, cfg := newManager(t, true)
			start(t, m, cfg)
			sample, err := m.RefreshSynchronization(context.Background(), peer)
			if err != nil || sample.Code != "ISOLATED_PROCESS_REPORTED" {
				t.Fatalf("exit setup lacked real child sample %+v %v", sample, err)
			}
			mode(t, cfg, "exit")
			if _, err = m.RefreshSynchronization(context.Background(), peer); err == nil {
				t.Fatal("exited child delivered new observation")
			}
			deadline := time.Now().Add(time.Second)
			for {
				status, _ := m.Status(peer)
				if !status.ProcessOwned {
					if status.Diagnostics.Synchronization.Code != "NOT_RUNNING" || !strings.Contains(status.LastExit, "9") {
						t.Fatalf("exited child not sealed %+v", status)
					}
					empty(t, status.Diagnostics.Synchronization)
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("actual owned Wait did not finish")
				}
				time.Sleep(time.Millisecond)
			}
			// Abrupt exit leaves an unknown filesystem endpoint. It is retained,
			// never unlinked as an excuse to replay a new process automatically.
			if _, err := os.Lstat(filepath.Join(cfg.Directory, "data", "comet-sync.sock")); err != nil {
				t.Fatal("abrupt-exit endpoint residue silently removed")
			}
			i, a := diagnosticsApproval(t, m, peer, "start", "")
			if _, err := m.Start(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrUnsafePath) {
				t.Fatalf("stale endpoint reused on restart %v", err)
			}
		})
	})
	t.Log("real held Go child + kernel UID/PID + original read-only Comet shapes; isolated transport only, no production ordinary node, networkId32 observation or target height supplied")
}
