package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

// The executable is an actual compiled local Go observer, with fixed stdout,
// stderr and signal handling. No shell, network, keys or ordinary-node claim.
func TestNetworkNativeNodeDiagnostics(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original Unix owned process required")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source, binary := filepath.Join(root, "observer.go"), filepath.Join(root, "observer")
	const observer = `package main
import("bytes";"os";"os/signal";"syscall";"time")
func main(){parent:=os.Getppid();done:=make(chan os.Signal,1);signal.Notify(done,os.Interrupt,syscall.SIGTERM);header:=[]byte("untrusted <script>never-evaluate</script> height=9007199254740993 synced=true\n");out:=append(header,bytes.Repeat([]byte{0,1,10,34,60,62},12000)...);os.Stdout.Write(out);os.Stderr.Write(bytes.Repeat([]byte{255,254,2,10},18000));os.WriteFile("fixture-ready",[]byte("ready"),0600);if _,err:=os.Stat("fixture-exit");err==nil{os.Exit(9)};ticker:=time.NewTicker(10*time.Millisecond);defer ticker.Stop();for{select{case <-done:os.Stdout.Write([]byte("stop\n"));os.Stderr.Write([]byte("stopped\n"));return;case <-ticker.C:if os.Getppid()!=parent{os.WriteFile("fixture-parent-gone",[]byte("fixture observed parent exit"),0600);return}}}}`
	if err = os.WriteFile(source, []byte(observer), 0600); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-p", "1", "-trimpath", "-o", binary, source)
	build.Dir = root
	build.Env = append(os.Environ(), "GOMAXPROCS=2", "GOWORK=off")
	if raw, err := build.CombinedOutput(); err != nil {
		t.Fatalf("actual observer compile: %v %s", err, raw)
	}
	artifact, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(artifact)
	pin := hex.EncodeToString(sum[:])
	peer := diagnosticsPeer(t)
	newManager := func(t *testing.T) (*ownednode.Manager, ownednode.Config) {
		t.Helper()
		dir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		cfg := ownednode.Config{Directory: filepath.Join(dir, ownednode.DirectoryName), IsolatedFixture: true, MaxArtifactBytes: uint64(len(artifact)) + 1, StorageQuotaBytes: 32 << 20, StopGrace: time.Second}
		m, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { diagnosticsClose(t, m) })
		i, a := diagnosticsApproval(t, m, peer, "install", pin)
		if err = m.InstallFixture(context.Background(), peer, i, a, artifact); err != nil {
			t.Fatal(err)
		}
		return m, cfg
	}
	start := func(t *testing.T, m *ownednode.Manager) string {
		t.Helper()
		i, a := diagnosticsApproval(t, m, peer, "start", "")
		run, err := m.Start(context.Background(), peer, i, a)
		if err != nil {
			t.Fatal(err)
		}
		return run
	}
	wait := func(t *testing.T, m *ownednode.Manager, cfg ownednode.Config, running bool) ownednode.Status {
		t.Helper()
		deadline := time.Now().Add(4 * time.Second)
		for {
			s, err := m.Status(peer)
			_, ready := os.Stat(filepath.Join(cfg.Directory, "data", "fixture-ready"))
			if err == nil && s.ProcessOwned == running && (!running || ready == nil) {
				return s
			}
			if time.Now().After(deadline) {
				t.Fatalf("actual process status timeout %+v %v", s, err)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	stop := func(t *testing.T, m *ownednode.Manager) {
		t.Helper()
		i, a := diagnosticsApproval(t, m, peer, "stop", "")
		if err := m.Stop(context.Background(), peer, i, a); err != nil {
			t.Fatal(err)
		}
	}
	t.Run("actual-bounded-logs-live-stop-reopen-and-history", func(t *testing.T) {
		m, cfg := newManager(t)
		before, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		initial, err := m.Status(peer)
		if err != nil || initial.Diagnostics.Logs.Code != "NOT_SUPPLIED" || initial.Diagnostics.Synchronization.Code != "NOT_SUPPLIED" || initial.Diagnostics.Synchronization.LocalHeight != nil || initial.Diagnostics.Synchronization.TargetHeight != nil || initial.Diagnostics.Synchronization.CatchingUp != nil {
			t.Fatalf("missing runtime fabricated sync: %+v %v", initial, err)
		}
		after, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if !bytes.Equal(before, after) {
			t.Fatal("read-only diagnostic changed journal")
		}
		run := start(t, m)
		s := wait(t, m, cfg, true)
		if s.Diagnostics.Recovery.Code != "OWNED_RUNNING" || s.Diagnostics.Recovery.AutoRestart || s.Diagnostics.Recovery.StoredPIDIsControlHandle || s.Diagnostics.Authority || s.ProductionSupported {
			t.Fatalf("observation promoted to authority: %+v", s.Diagnostics)
		}
		live, err := m.ReadLogs(peer, run)
		if err != nil || live.Code != "CAPTURING" || live.Stdout == nil || live.Stderr == nil || live.Stdout.Complete || live.Authority || *live.Stdout.Truncated != true || *live.Stderr.Truncated != true {
			t.Fatalf("actual live log unavailable %+v %v", live, err)
		}
		stop(t, m)
		s = wait(t, m, cfg, false)
		if s.Stage != "stopped" || s.Diagnostics.Recovery.Code != "IDLE" {
			t.Fatalf("normal owned Wait not retained: %+v", s)
		}
		sealed, err := m.ReadLogs(peer, run)
		if err != nil || sealed.Code != "CAPTURED" || !sealed.Stdout.Complete || !sealed.Stderr.Complete {
			t.Fatalf("sealed log readback: %+v %v", sealed, err)
		}
		for name, stream := range map[string]*ownednode.LogStream{"stdout": sealed.Stdout, "stderr": sealed.Stderr} {
			raw, err := os.ReadFile(filepath.Join(cfg.Directory, "logs", run, name+".log"))
			if err != nil || len(raw) != ownednode.MaxLogStreamBytes || stream.CapturedBytes != strconv.Itoa(len(raw)) || !stream.WireTruncated || stream.Encoding != "utf-8-with-replacement" {
				t.Fatalf("bounded file/stream mismatch %s %+v %v", name, stream, err)
			}
			hash := sha256.Sum256(raw)
			if hex.EncodeToString(hash[:]) != stream.SHA256 {
				t.Fatal("raw file digest lost")
			}
			observed, _ := strconv.ParseUint(*stream.ObservedBytes, 10, 64)
			dropped, _ := strconv.ParseUint(*stream.DroppedBytes, 10, 64)
			expected := uint64(72000 + len("stopped\n"))
			if name == "stdout" {
				expected = uint64(len("untrusted <script>never-evaluate</script> height=9007199254740993 synced=true\n") + 72000 + len("stop\n"))
			}
			if observed != expected || observed != uint64(len(raw))+dropped || dropped == 0 {
				t.Fatal("capture/observed/dropped counters invented")
			}
		}
		wire, _ := json.Marshal(s.Diagnostics)
		if len(wire) > 8<<10 || strings.Contains(string(wire), "<script>") || s.Diagnostics.Synchronization.LocalHeight != nil || s.Diagnostics.Synchronization.CatchingUp != nil {
			t.Fatalf("unbounded/authority-promoted diagnostics: %d %s", len(wire), wire)
		}
		diagnosticsClose(t, m)
		next, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer diagnosticsClose(t, next)
		restored, err := next.ReadLogs(peer, run)
		x, _ := json.Marshal(sealed)
		y, _ := json.Marshal(restored)
		if err != nil || !bytes.Equal(x, y) {
			t.Fatalf("original logs changed after normal reopen: %v\n%s\n%s", err, x, y)
		}
		start(t, next)
		wait(t, next, cfg, true)
		stop(t, next)
		older, err := next.ReadLogs(peer, run)
		y, _ = json.Marshal(older)
		if err != nil || !bytes.Equal(x, y) {
			t.Fatal("new run replaced original log history")
		}
		if _, err = next.ReadLogs(localipc.Peer{}, run); !errors.Is(err, localipc.ErrPeerDenied) {
			t.Fatal("unverified peer gained logs")
		}
		if out, err := next.ReadLogs(peer, "../../manager.json"); err != nil || out.Code != "NOT_SUPPLIED" || out.Stdout != nil {
			t.Fatal("unknown run selected arbitrary path")
		}
	})
	t.Run("abnormal-exit-retains-observed-logs-and-firstcause", func(t *testing.T) {
		m, cfg := newManager(t)
		if err := os.WriteFile(filepath.Join(cfg.Directory, "data", "fixture-exit"), []byte("controlled fixture exit"), 0600); err != nil {
			t.Fatal(err)
		}
		run := start(t, m)
		s := wait(t, m, cfg, false)
		logs, err := m.ReadLogs(peer, run)
		if err != nil || logs.Code != "CAPTURED" || s.Stage != "stopped" || s.LastExit != "exit status 9" || s.FirstCause != "exit status 9" || s.Diagnostics.Synchronization.LocalHeight != nil {
			t.Fatalf("abnormal effect/firstcause lost %+v %+v %v", s, logs, err)
		}
	})
	t.Run("sealed-bytes-and-directory-replacement-denied-preserved", func(t *testing.T) {
		for _, replace := range []string{"in-place", "same-bytes-new-inode", "logs-directory"} {
			t.Run(replace, func(t *testing.T) {
				m, cfg := newManager(t)
				run := start(t, m)
				wait(t, m, cfg, true)
				stop(t, m)
				path := filepath.Join(cfg.Directory, "logs", run, "stdout.log")
				raw, _ := os.ReadFile(path)
				if replace == "in-place" {
					raw[0] ^= 1
					if err := os.WriteFile(path, raw, 0600); err != nil {
						t.Fatal(err)
					}
				} else if replace == "same-bytes-new-inode" {
					if err := os.Rename(path, path+".original"); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, raw, 0600); err != nil {
						t.Fatal(err)
					}
				} else {
					path = filepath.Join(cfg.Directory, "logs")
					if err := os.Rename(path, path+".original"); err != nil {
						t.Fatal(err)
					}
					if err := os.Mkdir(path, 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(filepath.Join(path, "foreign"), []byte("preserve"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				if _, err := m.ReadLogs(peer, run); !errors.Is(err, ownednode.ErrUnsafePath) {
					t.Fatalf("replaced log accepted: %v", err)
				}
				if _, err := os.Stat(path); err != nil {
					t.Fatal("unknown/replaced bytes removed")
				}
			})
		}
	})
	t.Run("live-log-replacement-stops-only-owned-handle-and-preserves-unknown", func(t *testing.T) {
		m, cfg := newManager(t)
		run := start(t, m)
		wait(t, m, cfg, true)
		path := filepath.Join(cfg.Directory, "logs", run, "stderr.log")
		if err := os.Rename(path, path+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("unknown replacement; preserve"), 0600); err != nil {
			t.Fatal(err)
		}
		s := wait(t, m, cfg, false)
		if s.Stage != "reconcile_required" || s.FirstCause == "" || s.Diagnostics.Recovery.Code != "RECONCILING" || !s.Diagnostics.Recovery.PriorEffectUnknown {
			t.Fatalf("replacement lost UNKNOWN %+v", s)
		}
		if got, _ := os.ReadFile(path); string(got) != "unknown replacement; preserve" {
			t.Fatal("unknown replacement was cleaned")
		}
		if _, err := os.Stat(path + ".original"); err != nil {
			t.Fatal("original output was cleaned")
		}
		if _, err := m.ReadLogs(peer, run); !errors.Is(err, ownednode.ErrUnsafePath) {
			t.Fatal("replaced output read as valid")
		}
	})
	t.Run("existing-journal-migration-preserves-original-data-and-foreign-logs", func(t *testing.T) {
		for _, foreign := range []bool{false, true} {
			t.Run(strconv.FormatBool(foreign), func(t *testing.T) {
				m, cfg := newManager(t)
				original, err := m.ManagedArtifactReadback(peer)
				if err != nil {
					t.Fatal(err)
				}
				diagnosticsClose(t, m)
				path := filepath.Join(cfg.Directory, "manager.json")
				raw, _ := os.ReadFile(path)
				at := bytes.LastIndex(raw, []byte(`,"logsIdentity":`))
				if at < 0 {
					t.Fatal("original optional migration field absent")
				}
				old := append(append([]byte(nil), raw[:at]...), '}')
				if err = os.WriteFile(path, old, 0600); err != nil {
					t.Fatal(err)
				}
				if foreign {
					if err = os.WriteFile(filepath.Join(cfg.Directory, "logs", "foreign"), []byte("unknown logs"), 0600); err != nil {
						t.Fatal(err)
					}
				} else if err = os.Remove(filepath.Join(cfg.Directory, "logs")); err != nil {
					t.Fatal(err)
				}
				next, err := ownednode.New(cfg)
				if foreign {
					if !errors.Is(err, ownednode.ErrUnsafePath) {
						if next != nil {
							diagnosticsClose(t, next)
						}
						t.Fatal("foreign pre-existing log directory adopted")
					}
					retained, _ := os.ReadFile(path)
					if !bytes.Equal(retained, old) {
						t.Fatal("migration failure overwrote original journal")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				defer diagnosticsClose(t, next)
				actual, err := next.ManagedArtifactReadback(peer)
				if err != nil || actual.Identity != original.Identity || actual.DataIdentity != original.DataIdentity || actual.SHA256 != original.SHA256 {
					t.Fatal("migration replaced original artifact/data")
				}
				s, err := next.Status(peer)
				if err != nil || s.Stage != "installed" || s.ProcessOwned || s.Diagnostics.Logs.Code != "NOT_SUPPLIED" {
					t.Fatalf("migration auto-started or invented logs %+v %v", s, err)
				}
			})
		}
	})
	t.Run("incomplete-reopen-is-unknown-not-replayed-or-counters-invented", func(t *testing.T) {
		dir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		cfg := ownednode.Config{Directory: filepath.Join(dir, ownednode.DirectoryName), IsolatedFixture: true, MaxArtifactBytes: uint64(len(artifact)) + 1, StorageQuotaBytes: 32 << 20, StopGrace: time.Second}
		fixtureConfig, _ := json.Marshal(cfg)
		configPath := filepath.Join(dir, "fixture-config.json")
		if err := os.WriteFile(configPath, fixtureConfig, 0600); err != nil {
			t.Fatal(err)
		}
		owner := exec.Command(os.Args[0], "-test.run=^TestNetworkNativeNodeDiagnosticsCrashOwner$", "-test.count=1")
		owner.Env = append(os.Environ(), "YNX_NODE_DIAGNOSTICS_FIXTURE_CONFIG="+configPath, "YNX_NODE_DIAGNOSTICS_FIXTURE_ARTIFACT="+binary)
		var output bytes.Buffer
		owner.Stdout, owner.Stderr = &output, &output
		if err := owner.Start(); err != nil {
			t.Fatal(err)
		}
		waited := false
		defer func() {
			if !waited {
				_ = owner.Process.Kill()
				_ = owner.Wait()
			}
		}()
		deadline := time.Now().Add(5 * time.Second)
		var run string
		for {
			raw, err := os.ReadFile(filepath.Join(dir, "fixture-owner-ready"))
			if err == nil {
				run = string(raw)
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("actual manager child not ready: %s", output.String())
			}
			time.Sleep(10 * time.Millisecond)
		}
		if err := owner.Process.Kill(); err != nil {
			t.Fatal(err)
		}
		if err := owner.Wait(); err == nil {
			t.Fatal("fixture manager did not observe actual SIGKILL")
		}
		waited = true
		for {
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "fixture-parent-gone")); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("fixture did not observe original parent death; no PID-based cleanup is permitted")
			}
			time.Sleep(10 * time.Millisecond)
		}
		// The fixture's parent watcher is only test cleanup, never a claimed
		// production node guarantee. The reopened manager owns no child handle.
		next, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer diagnosticsClose(t, next)
		s, err := next.Status(peer)
		logs, readErr := next.ReadLogs(peer, run)
		if err != nil || readErr != nil || s.Stage != "reconcile_required" || s.ProcessOwned || s.Diagnostics.Recovery.Code != "RECONCILING" || !s.Diagnostics.Recovery.PriorEffectUnknown || logs.Code != "INCOMPLETE" || logs.Stdout.ObservedBytes != nil || logs.Stdout.DroppedBytes != nil || logs.Stdout.Truncated != nil {
			t.Fatalf("crash read invented certainty %+v %+v %v %v", s, logs, err, readErr)
		}
		i, a := diagnosticsApproval(t, next, peer, "start", "")
		if _, err = next.Start(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrReconcile) {
			t.Fatal("UNKNOWN restart replayed")
		}
	})
	t.Log("actual controlled Go stdout/stderr and original owned Stop/Wait only; no ordinary runtime, sync, authority or public activation")
}

// Invoked only by the target above as a real crashable owner process. Original
// journal and logs survive its SIGKILL unchanged; no direct state fabrication.
func TestNetworkNativeNodeDiagnosticsCrashOwner(t *testing.T) {
	configPath := os.Getenv("YNX_NODE_DIAGNOSTICS_FIXTURE_CONFIG")
	if configPath == "" {
		t.Skip("isolated subprocess fixture only")
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	var cfg ownednode.Config
	if err = json.Unmarshal(raw, &cfg); err != nil || !cfg.IsolatedFixture {
		t.Fatal("controlled fixture config required")
	}
	artifact, err := os.ReadFile(os.Getenv("YNX_NODE_DIAGNOSTICS_FIXTURE_ARTIFACT"))
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(artifact)
	peer := diagnosticsPeer(t)
	m, err := ownednode.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer diagnosticsClose(t, m)
	i, a := diagnosticsApproval(t, m, peer, "install", hex.EncodeToString(sum[:]))
	if err = m.InstallFixture(context.Background(), peer, i, a, artifact); err != nil {
		t.Fatal(err)
	}
	i, a = diagnosticsApproval(t, m, peer, "start", "")
	run, err := m.Start(context.Background(), peer, i, a)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(4 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "fixture-ready")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("actual fixture output not drained")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err = os.WriteFile(filepath.Join(filepath.Dir(cfg.Directory), "fixture-owner-ready"), []byte(run), 0600); err != nil {
		t.Fatal(err)
	}
	select {}
}

func diagnosticsPeer(t *testing.T) localipc.Peer {
	t.Helper()
	dir, err := os.MkdirTemp(os.TempDir(), "nd-")
	if err != nil {
		t.Fatal(err)
	}
	dir, err = filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	seen := make(chan localipc.Peer, 1)
	s, err := localipc.Start(context.Background(), localipc.Config{Directory: filepath.Join(dir, "ipc"), Handler: func(_ context.Context, p localipc.Peer, _ localipc.Request) (localipc.Result, error) {
		select {
		case seen <- p:
		default:
		}
		return localipc.Result{Status: &localipc.Status{Service: "isolated-node-diagnostics", NodeControl: "unavailable", ResourceContribution: "disabled"}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := s.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	if _, err := localipc.Call(context.Background(), filepath.Join(dir, "ipc"), localipc.Request{Version: localipc.Version, ID: "diagnostics", Operation: "status"}); err != nil {
		t.Fatal(err)
	}
	return <-seen
}
func diagnosticsClose(t *testing.T, m *ownednode.Manager) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := m.Close(ctx); err != nil {
		t.Error(err)
	}
}
func diagnosticsApproval(t *testing.T, m *ownednode.Manager, p localipc.Peer, action, digest string) (ownednode.Intent, *ownednode.Approval) {
	t.Helper()
	i, err := m.Prepare(p, action, digest)
	if err != nil {
		t.Fatal(err)
	}
	a, err := m.Approve(p, i, true, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	return i, a
}
