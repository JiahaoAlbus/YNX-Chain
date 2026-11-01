package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/localipc"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"
)

// This actual compiled Go observer has no shell, network, key or publisher.
// It writes only fixed observation/stop files in its fixed managed cwd. It is
// not an original A-signed node, public validator or production runtime.
func TestP09OwnedNodeArtifactRuntime(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("original managed Unix runtime required")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "observer.go")
	binary := filepath.Join(root, "ordinary-observer-fixture")
	const observer = `package main
import("encoding/json";"os";"os/signal";"sort";"strings";"syscall")
func main(){done:=make(chan os.Signal,1);signal.Notify(done,os.Interrupt,syscall.SIGTERM);cwd,_:=os.Getwd();exe,_:=os.Executable();keys:=[]string{};for _,entry:=range os.Environ(){keys=append(keys,strings.SplitN(entry,"=",2)[0])};sort.Strings(keys);_,home:=os.LookupEnv("HOME");_,secret:=os.LookupEnv("YNX_NODE_FIXTURE_SENTINEL");_,dyld:=os.LookupEnv("DYLD_INSERT_LIBRARIES");raw,_:=json.Marshal(map[string]any{"cwd":cwd,"executable":exe,"args":os.Args,"environmentKeys":keys,"homePresent":home,"secretPresent":secret,"dyldPresent":dyld});if os.WriteFile("runtime-observation.json",raw,0600)!=nil{os.Exit(7)};<-done;if os.WriteFile("runtime-stopped",[]byte("owned fixture stopped"),0600)!=nil{os.Exit(8)}}`
	if err = os.WriteFile(source, []byte(observer), 0600); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-p", "1", "-trimpath", "-o", binary, source)
	build.Dir = root
	build.Env = append(os.Environ(), "GOMAXPROCS=2", "GOWORK=off")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("real isolated observer compile: %v %s", err, out)
	}
	artifact, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(artifact)
	pin := hex.EncodeToString(sum[:])
	// A short dedicated WD TMPDIR keeps the real kernel IPC socket within the
	// platform limit; no HOME override or artificial Peer is used.
	short, err := os.MkdirTemp(os.TempDir(), "p-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(short) })
	physical, err := filepath.EvalSymlinks(short)
	if err != nil {
		t.Fatal(err)
	}
	seen := make(chan localipc.Peer, 1)
	server, err := localipc.Start(context.Background(), localipc.Config{Directory: filepath.Join(physical, "ipc"), Handler: func(_ context.Context, p localipc.Peer, _ localipc.Request) (localipc.Result, error) {
		select {
		case seen <- p:
		default:
		}
		return localipc.Result{Status: &localipc.Status{Service: "isolated-node-runtime-contract", NodeControl: "unavailable", ResourceContribution: "disabled"}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := server.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	if _, err = localipc.Call(context.Background(), filepath.Join(physical, "ipc"), localipc.Request{Version: localipc.Version, ID: "actual_node_fixture", Operation: "status"}); err != nil {
		t.Fatal(err)
	}
	peer := <-seen
	makeManager := func(t *testing.T) (*ownednode.Manager, ownednode.Config) {
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
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if err := m.Close(ctx); err != nil {
				t.Error(err)
			}
		})
		return m, cfg
	}
	approve := func(t *testing.T, m *ownednode.Manager, action, digest string) (ownednode.Intent, *ownednode.Approval) {
		t.Helper()
		i, err := m.Prepare(peer, action, digest)
		if err != nil {
			t.Fatal(err)
		}
		a, err := m.Approve(peer, i, true, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		return i, a
	}
	install := func(t *testing.T, m *ownednode.Manager) {
		t.Helper()
		i, a := approve(t, m, "install", pin)
		if err := m.InstallFixture(context.Background(), peer, i, a, artifact); err != nil {
			t.Fatal(err)
		}
	}
	start := func(t *testing.T, m *ownednode.Manager) string {
		t.Helper()
		i, a := approve(t, m, "start", "")
		id, err := m.Start(context.Background(), peer, i, a)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	stop := func(t *testing.T, m *ownednode.Manager) {
		t.Helper()
		i, a := approve(t, m, "stop", "")
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := m.Stop(ctx, peer, i, a); err != nil {
			t.Fatal(err)
		}
	}
	observe := func(t *testing.T, cfg ownednode.Config) map[string]any {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for {
			raw, err := os.ReadFile(filepath.Join(cfg.Directory, "data", "runtime-observation.json"))
			if err == nil {
				var v map[string]any
				if json.Unmarshal(raw, &v) == nil {
					return v
				}
			}
			if time.Now().After(deadline) {
				t.Fatal("actual compiled child observation not supplied")
			}
			time.Sleep(time.Millisecond * 5)
		}
	}
	t.Run("atomic-byte-install-readback-clean-runtime-owned-stop-reopen", func(t *testing.T) {
		m, cfg := makeManager(t)
		install(t, m)
		read, err := m.ManagedArtifactReadback(peer)
		if err != nil || read.SHA256 != pin || read.Bytes != "" && read.Identity.Bytes != read.Bytes || read.ProductionSupported || read.Authority {
			t.Fatalf("real artifact readback: %+v %v", read, err)
		}
		original, err := os.ReadFile(read.Path)
		if err != nil || !bytes.Equal(original, artifact) {
			t.Fatal("installed byte identity lost")
		}
		before, err := os.Stat(read.Path)
		if err != nil {
			t.Fatal(err)
		}
		binBefore, _ := os.Stat(filepath.Join(cfg.Directory, "bin"))
		dataBefore, _ := os.Stat(filepath.Join(cfg.Directory, "data"))
		runID := start(t, m)
		view := observe(t, cfg)
		if view["cwd"] != filepath.Join(cfg.Directory, "data") || view["homePresent"] != false || view["secretPresent"] != false || view["dyldPresent"] != false {
			t.Fatalf("unsafe inherited environment/cwd: %+v", view)
		}
		var keys []string
		for _, v := range view["environmentKeys"].([]any) {
			keys = append(keys, v.(string))
		}
		sort.Strings(keys)
		if strings.Join(keys, ",") != "GOMAXPROCS,LANG,LC_ALL" {
			t.Fatalf("environment is not fixed/secret-free: %v", keys)
		}
		executable := view["executable"].(string)
		if executable == read.Path || filepath.Base(executable) != "node" || !strings.HasPrefix(executable, filepath.Join(cfg.Directory, "bin", "runtime-")) {
			t.Fatalf("original mutable path used for exec: %s", executable)
		}
		if args := view["args"].([]any); len(args) != 1 || args[0] != executable {
			t.Fatalf("arbitrary args reached observer: %+v", args)
		}
		stoppedPath := filepath.Join(cfg.Directory, "data", "runtime-stopped")
		stop(t, m)
		if raw, err := os.ReadFile(stoppedPath); err != nil || string(raw) != "owned fixture stopped" {
			t.Fatalf("Stop returned before actual child exited: %s %v", raw, err)
		}
		status, err := m.Status(peer)
		if err != nil || status.Stage != "stopped" || status.ProcessOwned || status.RunID != runID {
			t.Fatalf("owned Wait status: %+v %v", status, err)
		}
		if _, err = os.Lstat(filepath.Dir(executable)); !os.IsNotExist(err) {
			t.Fatalf("known capture not cleaned after Wait: %v", err)
		}
		after, _ := os.Stat(read.Path)
		binAfter, _ := os.Stat(filepath.Join(cfg.Directory, "bin"))
		dataAfter, _ := os.Stat(filepath.Join(cfg.Directory, "data"))
		if !os.SameFile(before, after) || !os.SameFile(binBefore, binAfter) || !os.SameFile(dataBefore, dataAfter) {
			t.Fatal("install/run changed original bin/data/artifact inode")
		}
		if err = m.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
		reopened, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer reopened.Close(context.Background())
		restored, err := reopened.ManagedArtifactReadback(peer)
		if err != nil || restored.Identity != read.Identity || restored.BinIdentity != read.BinIdentity || restored.DataIdentity != read.DataIdentity {
			t.Fatalf("artifact identity not durably bound: %+v %v", restored, err)
		}
		state, err := reopened.Status(peer)
		if err != nil || state.ProcessOwned || state.Stage != "stopped" || state.RunID != runID {
			t.Fatalf("reopen auto-started/adopted process: %+v %v", state, err)
		}
	})
	t.Run("unknown-destination-never-overwritten", func(t *testing.T) {
		m, cfg := makeManager(t)
		target := filepath.Join(cfg.Directory, "bin", "node")
		old := []byte("unknown previous bytes")
		if err := os.WriteFile(target, old, 0700); err != nil {
			t.Fatal(err)
		}
		i, a := approve(t, m, "install", pin)
		if err := m.InstallFixture(context.Background(), peer, i, a, artifact); !errors.Is(err, ownednode.ErrUnsafePath) {
			t.Fatalf("existing artifact adopted/overwritten: %v", err)
		}
		if got, _ := os.ReadFile(target); !bytes.Equal(got, old) {
			t.Fatal("unknown old file changed")
		}
	})
	t.Run("cancel-before-install-no-claim-or-partial-artifact", func(t *testing.T) {
		m, cfg := makeManager(t)
		i, a := approve(t, m, "install", pin)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := m.InstallFixture(ctx, peer, i, a, artifact); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(cfg.Directory, "bin", "node")); !os.IsNotExist(err) {
			t.Fatal("cancelled install left final artifact")
		}
		install(t, m)
	})
	t.Run("bin-and-data-inode-replacement-denied-and-preserved", func(t *testing.T) {
		for _, name := range []string{"bin", "data"} {
			t.Run(name, func(t *testing.T) {
				m, cfg := makeManager(t)
				install(t, m)
				i, a := approve(t, m, "start", "")
				dir := filepath.Join(cfg.Directory, name)
				if err := os.Rename(dir, dir+".original"); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(dir, 0700); err != nil {
					t.Fatal(err)
				}
				unknown := filepath.Join(dir, "keep")
				if err := os.WriteFile(unknown, []byte("unknown replacement"), 0600); err != nil {
					t.Fatal(err)
				}
				if _, err := m.Start(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrUnsafePath) {
					t.Fatalf("replaced %s directory launched: %v", name, err)
				}
				if raw, _ := os.ReadFile(unknown); string(raw) != "unknown replacement" {
					t.Fatal("replacement content deleted")
				}
				if _, err := os.Stat(dir + ".original"); err != nil {
					t.Fatal("original directory deleted")
				}
				if err := m.Close(context.Background()); err != nil {
					t.Fatal(err)
				}
				if next, err := ownednode.New(cfg); err == nil {
					_ = next.Close(context.Background())
					t.Fatal("reopen adopted substituted directory inode")
				}
			})
		}
	})
	t.Run("artifact-same-bytes-new-inode-denied", func(t *testing.T) {
		m, cfg := makeManager(t)
		install(t, m)
		i, a := approve(t, m, "start", "")
		path := filepath.Join(cfg.Directory, "bin", "node")
		if err := os.Rename(path, path+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, artifact, 0700); err != nil {
			t.Fatal(err)
		}
		if _, err := m.ManagedArtifactReadback(peer); !errors.Is(err, ownednode.ErrUnsafePath) {
			t.Fatal("readback adopted changed inode")
		}
		if _, err := m.Start(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrUnsafePath) {
			t.Fatalf("new inode executed: %v", err)
		}
	})
	t.Run("runtime-postcheck-replacement-stops-only-owned-capture", func(t *testing.T) {
		m, cfg := makeManager(t)
		install(t, m)
		start(t, m)
		view := observe(t, cfg)
		runtimeDir := filepath.Dir(view["executable"].(string))
		path := filepath.Join(cfg.Directory, "bin", "node")
		if err := os.Rename(path, path+".original"); err != nil {
			t.Fatal(err)
		}
		replacement := []byte("retained replacement; not executable")
		if err := os.WriteFile(path, replacement, 0700); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(3 * time.Second)
		for {
			status, _ := m.Status(peer)
			if !status.ProcessOwned {
				if status.Stage != "reconcile_required" || status.FirstCause == "" {
					t.Fatalf("postcheck lost unknown failure: %+v", status)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("changed runtime did not kill/Wait own captured child")
			}
			time.Sleep(time.Millisecond * 10)
		}
		if raw, _ := os.ReadFile(path); !bytes.Equal(raw, replacement) {
			t.Fatal("replacement removed on Wait")
		}
		if _, err := os.Stat(runtimeDir); err != nil {
			t.Fatal("unknown failed runtime capture was deleted")
		}
	})
	t.Run("durable-partial-install-state-is-not-replayed", func(t *testing.T) {
		m, cfg := makeManager(t)
		if err := m.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(cfg.Directory, "manager.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		raw = bytes.Replace(raw, []byte(`"stage":"not_installed"`), []byte(`"stage":"installing"`), 1)
		raw = bytes.Replace(raw, []byte(`"artifactSHA256":""`), []byte(`"artifactSHA256":"`+pin+`"`), 1)
		if err = os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		partial := filepath.Join(cfg.Directory, "bin", "install-isolated.tmp")
		if err = os.WriteFile(partial, []byte("partial bytes retained"), 0700); err != nil {
			t.Fatal(err)
		}
		reopened, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer reopened.Close(context.Background())
		s, err := reopened.Status(peer)
		if err != nil || s.Stage != "reconcile_required" || s.ProcessOwned {
			t.Fatalf("interrupted install was promoted/replayed: %+v %v", s, err)
		}
		i, a := approve(t, reopened, "start", "")
		if _, err = reopened.Start(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrReconcile) {
			t.Fatal(err)
		}
		if got, _ := os.ReadFile(partial); string(got) != "partial bytes retained" {
			t.Fatal("partial installation evidence removed")
		}
		if _, err = os.Stat(filepath.Join(cfg.Directory, "bin", "node")); !os.IsNotExist(err) {
			t.Fatal("reopen fabricated installed node")
		}
	})

	t.Run("journal-unrecognized-in-place-bytes-preserved", func(t *testing.T) {
		m, cfg := makeManager(t)
		install(t, m)
		path := filepath.Join(cfg.Directory, "manager.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		changed := append(append([]byte(nil), raw...), byte(' '))
		if err = os.WriteFile(path, changed, 0600); err != nil {
			t.Fatal(err)
		}
		i, a := approve(t, m, "start", "")
		if _, err = m.Start(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrReconcile) {
			t.Fatalf("changed metadata was overwritten or launched: %v", err)
		}
		if got, _ := os.ReadFile(path); !bytes.Equal(got, changed) {
			t.Fatal("unknown metadata bytes overwritten during failed claim")
		}
		if _, err = os.Stat(filepath.Join(cfg.Directory, "data", "runtime-observation.json")); !os.IsNotExist(err) {
			t.Fatal("unknown journal launched child")
		}
	})
	t.Run("root-inode-replacement-not-adopted-on-reopen", func(t *testing.T) {
		m, cfg := makeManager(t)
		install(t, m)
		if err := m.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
		original := cfg.Directory + ".original"
		if err := os.Rename(cfg.Directory, original); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(cfg.Directory, 0700); err != nil {
			t.Fatal(err)
		}
		entries, err := os.ReadDir(original)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if err = os.Rename(filepath.Join(original, entry.Name()), filepath.Join(cfg.Directory, entry.Name())); err != nil {
				t.Fatal(err)
			}
		}
		if next, err := ownednode.New(cfg); !errors.Is(err, ownednode.ErrUnsafePath) {
			if next != nil {
				_ = next.Close(context.Background())
			}
			t.Fatalf("new root with moved original children was adopted: %v", err)
		}
		if _, err = os.Stat(filepath.Join(cfg.Directory, "bin", "node")); err != nil {
			t.Fatal("replacement check deleted retained original bytes")
		}
	})
	t.Run("running-data-inode-replacement-is-unknown-and-preserved", func(t *testing.T) {
		m, cfg := makeManager(t)
		install(t, m)
		start(t, m)
		observe(t, cfg)
		data := filepath.Join(cfg.Directory, "data")
		if err := os.Rename(data, data+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(data, 0700); err != nil {
			t.Fatal(err)
		}
		unknown := filepath.Join(data, "keep")
		if err := os.WriteFile(unknown, []byte("foreign replacement"), 0600); err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(3 * time.Second)
		for {
			status, _ := m.Status(peer)
			if !status.ProcessOwned {
				if status.Stage != "reconcile_required" {
					t.Fatalf("changed data inode lost UNKNOWN: %+v", status)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("owned child not reaped after runtime data replacement")
			}
			time.Sleep(10 * time.Millisecond)
		}
		if got, _ := os.ReadFile(unknown); string(got) != "foreign replacement" {
			t.Fatal("foreign data directory was cleaned")
		}
		if _, err := os.Stat(filepath.Join(data+".original", "runtime-observation.json")); err != nil {
			t.Fatal("original data history lost")
		}
	})
	t.Run("production-still-requires-original-signed-release", func(t *testing.T) {
		_, cfg := makeManager(t)
		cfg.Directory = filepath.Join(filepath.Dir(cfg.Directory), "production", ownednode.DirectoryName)
		if err := os.Mkdir(filepath.Dir(cfg.Directory), 0700); err != nil {
			t.Fatal(err)
		}
		cfg.IsolatedFixture = false
		m, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer m.Close(context.Background())
		if err = m.Install(context.Background(), peer, ownednode.Intent{}, nil); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal(err)
		}
		if _, err = m.Start(context.Background(), peer, ownednode.Intent{}, nil); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal(err)
		}
		if err = m.InstallFixture(context.Background(), peer, ownednode.Intent{}, nil, artifact); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal(err)
		}
	})
	t.Log("real compiled Go observation fixture only; no original A release, production ordinary node, network, keys or signer activated")
}
