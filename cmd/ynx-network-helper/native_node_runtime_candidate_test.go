package main_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	binaryformat "encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/nativeconsent"
	"github.com/JiahaoAlbus/YNX-Chain/apps/network/ownednode"
)

type candidateNativeRecorder struct {
	mu       sync.Mutex
	producer *nativeconsent.Producer
	intents  []ownednode.Intent
	cancelAt int
	cancel   context.CancelFunc
}

func (r *candidateNativeRecorder) Confirm(ctx context.Context, intent ownednode.Intent, mode string) error {
	r.mu.Lock()
	r.intents = append(r.intents, intent)
	index := len(r.intents)
	r.mu.Unlock()
	if err := r.producer.Confirm(ctx, intent, mode); err != nil {
		return err
	}
	if index == r.cancelAt {
		r.cancel()
	}
	return nil
}

// Uses genuine compiled executable format and the original pinned producer
// transport. Its native response is an isolated protocol fixture, not a human
// GUI approval or original publisher/Root/runtime qualification.
func TestNetworkNativeNodeRuntimeCandidate(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("owned Unix runtime required")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	source, binary := filepath.Join(root, "observer.go"), filepath.Join(root, "ynx-network-native-consent")
	const code = `package main
import("encoding/json";"fmt";"os";"os/signal";"syscall")
func main(){if len(os.Args)==2&&os.Args[1]=="--native-consent"{var p map[string]string;if json.NewDecoder(os.Stdin).Decode(&p)!=nil{os.Exit(2)};json.NewEncoder(os.Stdout).Encode(map[string]string{"version":p["version"],"requestId":p["requestId"],"payloadSHA256":p["payloadSHA256"],"decision":"approved"});return};done:=make(chan os.Signal,1);signal.Notify(done,os.Interrupt,syscall.SIGTERM);fmt.Println("isolated actual compiled observer; no network/signer");os.WriteFile("fixture-ready",[]byte("ready"),0600);<-done;fmt.Println("owned fixture stopped")}`
	if err = os.WriteFile(source, []byte(code), 0600); err != nil {
		t.Fatal(err)
	}
	build := exec.Command("go", "build", "-p", "1", "-trimpath", "-o", binary, source)
	build.Dir = root
	build.Env = append(os.Environ(), "GOMAXPROCS=2", "GOWORK=off")
	if raw, err := build.CombinedOutput(); err != nil {
		t.Fatalf("compiled native/node protocol fixture: %v %s", err, raw)
	}
	artifact, err := os.ReadFile(binary)
	if err != nil {
		t.Fatal(err)
	}
	digest := func(b []byte) string { sum := sha256.Sum256(b); return hex.EncodeToString(sum[:]) }
	pin := digest(artifact)
	producer, err := nativeconsent.New(binary, pin, "en", "light")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := producer.Close(); err != nil {
			t.Error(err)
		}
	}()
	peer := diagnosticsPeer(t)
	manifest := ownednode.RuntimeManifest{Version: ownednode.RuntimeManifestVersion, ReleaseVersion: "controlled-qa.1", OS: runtime.GOOS, Arch: runtime.GOARCH, ManagedFilename: "node", ArtifactBytes: strconv.Itoa(len(artifact)), ArtifactSHA256: pin, SourceRevision: strings.Repeat("1", 40), SourceRepository: "https://example.invalid/isolated-source", ArtifactSource: "https://example.invalid/isolated-node", OriginalManifestSHA256: strings.Repeat("2", 64), RuntimeContractSHA256: strings.Repeat("3", 64), Role: "ordinary-observer", Network: ownednode.RuntimeNetwork{NetworkID32: strings.Repeat("4", 64), NativeChainID: "6423", NativeGenesisSHA256: strings.Repeat("5", 64), CometChainID: "explicit-independent-comet-id", CometGenesisSHA256: strings.Repeat("6", 64)}}
	writeCandidate := func(t *testing.T, m ownednode.RuntimeManifest, bytes []byte) (*ownednode.RuntimeCandidate, string, string) {
		t.Helper()
		dir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		mp, ep := filepath.Join(dir, "runtime-intake.json"), filepath.Join(dir, "downloaded-node")
		raw, _ := json.Marshal(m)
		if err = os.WriteFile(mp, raw, 0600); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(ep, bytes, 0600); err != nil {
			t.Fatal(err)
		}
		c, err := ownednode.OpenRuntimeCandidate(mp, digest(raw), ep)
		if err != nil {
			t.Fatal(err)
		}
		return c, mp, ep
	}
	newManager := func(t *testing.T, fixture bool) (*ownednode.Manager, ownednode.Config) {
		t.Helper()
		dir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		cfg := ownednode.Config{Directory: filepath.Join(dir, ownednode.DirectoryName), IsolatedFixture: fixture, MaxArtifactBytes: uint64(len(artifact)) + 1, StorageQuotaBytes: 32 << 20, StopGrace: time.Second}
		m, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { diagnosticsClose(t, m) })
		return m, cfg
	}
	prepareNative := func(t *testing.T, m *ownednode.Manager, action, digest string) (ownednode.Intent, *ownednode.Approval) {
		t.Helper()
		i, err := m.Prepare(peer, action, digest)
		if err != nil {
			t.Fatal(err)
		}
		a, err := m.ApproveNative(context.Background(), peer, i, producer)
		if err != nil {
			t.Fatal(err)
		}
		return i, a
	}
	waitReady := func(t *testing.T, m *ownednode.Manager, cfg ownednode.Config) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for {
			if _, err := os.Stat(filepath.Join(cfg.Directory, "data", "fixture-ready")); err == nil {
				return
			}
			if time.Now().After(deadline) {
				s, _ := m.Status(peer)
				t.Fatalf("compiled observer not ready %+v", s)
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
	t.Run("public-metadata-never-admits-production-and-bool-denied", func(t *testing.T) {
		c, _, _ := writeCandidate(t, manifest, artifact)
		v := c.View()
		if v.Code != "PUBLIC_BYTES_CHECKED_NO_AUTHORITY" || v.Authority || v.OriginalReleaseAdmitted {
			t.Fatalf("metadata became authority %+v", v)
		}
		m, cfg := newManager(t, false)
		wrong := manifest.Network
		wrong.NetworkID32 = manifest.Network.NativeGenesisSHA256
		if err := m.ConfigureRuntimeCandidate(peer, c, wrong); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal("genesis substituted for network domain")
		}
		if err := m.ConfigureRuntimeCandidate(peer, c, manifest.Network); err != nil {
			t.Fatal(err)
		}
		i, err := m.Prepare(peer, "install", pin)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = m.Approve(peer, i, true, time.Second); !errors.Is(err, ownednode.ErrConsent) {
			t.Fatal("production host bool minted approval")
		}
		if _, err = m.ApproveNative(context.Background(), peer, i, producer); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal("metadata bypassed original release gate")
		}
		before, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if err = m.Install(context.Background(), peer, i, nil); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal(err)
		}
		if _, err = m.Start(context.Background(), peer, i, nil); !errors.Is(err, ownednode.ErrOriginalReleaseMissing) {
			t.Fatal(err)
		}
		after, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if !bytes.Equal(before, after) {
			t.Fatal("unsupported effect wrote journal")
		}
		if _, err = os.Stat(filepath.Join(cfg.Directory, "bin", "node")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("production candidate was installed")
		}
		startup, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		cfg.Directory = filepath.Join(startup, ownednode.DirectoryName)
		cfg.RuntimeCandidate = c
		network := manifest.Network
		cfg.ExpectedRuntimeNetwork = &network
		assembled, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer diagnosticsClose(t, assembled)
		s, err := assembled.Status(peer)
		if err != nil || s.RuntimeCandidate == nil || s.RuntimeCandidate.ManifestSHA256 != v.ManifestSHA256 || s.ProductionSupported || s.ProcessOwned {
			t.Fatalf("normal startup candidate composition %+v %v", s, err)
		}
	})
	t.Run("strict-manifest-platform-role-digest-command-injection", func(t *testing.T) {
		mutations := map[string]func(*ownednode.RuntimeManifest){
			"version":          func(m *ownednode.RuntimeManifest) { m.Version = "other" },
			"release-version":  func(m *ownednode.RuntimeManifest) { m.ReleaseVersion = "../run" },
			"arch":             func(m *ownednode.RuntimeManifest) { m.Arch = "other" },
			"os":               func(m *ownednode.RuntimeManifest) { m.OS = "other" },
			"producer":         func(m *ownednode.RuntimeManifest) { m.BlockProduction = true },
			"validator":        func(m *ownednode.RuntimeManifest) { m.Validator = true },
			"signer":           func(m *ownednode.RuntimeManifest) { m.Signer = true },
			"validator-keys":   func(m *ownednode.RuntimeManifest) { m.ValidatorKeys = true },
			"role":             func(m *ownednode.RuntimeManifest) { m.Role = "validator" },
			"bytes":            func(m *ownednode.RuntimeManifest) { m.ArtifactBytes = "01" },
			"over-bound-bytes": func(m *ownednode.RuntimeManifest) { m.ArtifactBytes = "67108865" },
			"digest":           func(m *ownednode.RuntimeManifest) { m.ArtifactSHA256 = strings.Repeat("0", 64) },
			"source":           func(m *ownednode.RuntimeManifest) { m.ArtifactSource = "file:///bin/sh" },
			"credentials":      func(m *ownednode.RuntimeManifest) { m.SourceRepository = "https://user:secret@example.invalid/src" },
			"network-domain":   func(m *ownednode.RuntimeManifest) { m.Network.NetworkID32 = "6423" },
		}
		for name, mutate := range mutations {
			t.Run(name, func(t *testing.T) {
				m := manifest
				mutate(&m)
				dir := t.TempDir()
				mp, ep := filepath.Join(dir, "manifest"), filepath.Join(dir, "node")
				raw, _ := json.Marshal(m)
				os.WriteFile(mp, raw, 0600)
				os.WriteFile(ep, artifact, 0600)
				if _, err := ownednode.OpenRuntimeCandidate(mp, digest(raw), ep); err == nil {
					t.Fatal("bad candidate accepted")
				}
			})
		}
		for _, extra := range []string{`,"args":["start"]}`, `,"executable":"/bin/sh"}`, `,"signer":false}`} {
			dir := t.TempDir()
			mp, ep := filepath.Join(dir, "manifest"), filepath.Join(dir, "node")
			raw, _ := json.Marshal(manifest)
			raw = append(raw[:len(raw)-1], []byte(extra)...)
			os.WriteFile(mp, raw, 0600)
			os.WriteFile(ep, artifact, 0600)
			if _, err := ownednode.OpenRuntimeCandidate(mp, digest(raw), ep); err == nil {
				t.Fatal("unknown/duplicate executable field accepted")
			}
		}
		shell := []byte("#!/bin/sh\nexit 0\n")
		m := manifest
		m.ArtifactBytes = strconv.Itoa(len(shell))
		m.ArtifactSHA256 = digest(shell)
		dir := t.TempDir()
		raw, _ := json.Marshal(m)
		mp, ep := filepath.Join(dir, "manifest"), filepath.Join(dir, "node")
		os.WriteFile(mp, raw, 0600)
		os.WriteFile(ep, shell, 0600)
		if _, err := ownednode.OpenRuntimeCandidate(mp, digest(raw), ep); !errors.Is(err, ownednode.ErrRuntimeManifest) {
			t.Fatal("shell artifact admitted as native executable")
		}
		malformed := append([]byte(nil), artifact...)
		if runtime.GOOS == "darwin" {
			binaryformat.LittleEndian.PutUint32(malformed[20:24], ^uint32(0))
		} else {
			binaryformat.LittleEndian.PutUint64(malformed[32:40], ^uint64(0))
		}
		m = manifest
		m.ArtifactSHA256 = digest(malformed)
		raw, _ = json.Marshal(m)
		os.WriteFile(mp, raw, 0600)
		os.WriteFile(ep, malformed, 0600)
		if _, err := ownednode.OpenRuntimeCandidate(mp, digest(raw), ep); !errors.Is(err, ownednode.ErrRuntimeManifest) {
			t.Fatal("unbounded native header accepted")
		}
	})
	t.Run("candidate-source-inode-replacement-before-install-preserved", func(t *testing.T) {
		c, _, ep := writeCandidate(t, manifest, artifact)
		m, cfg := newManager(t, true)
		if err := m.ConfigureRuntimeCandidate(peer, c, manifest.Network); err != nil {
			t.Fatal(err)
		}
		i, a := prepareNative(t, m, "install", pin)
		if err := os.Rename(ep, ep+".original"); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(ep, artifact, 0600); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if err := m.InstallConfiguredFixture(context.Background(), peer, i, a); !errors.Is(err, ownednode.ErrUnsafePath) {
			t.Fatal("replaced input inode accepted")
		}
		after, _ := os.ReadFile(filepath.Join(cfg.Directory, "manager.json"))
		if !bytes.Equal(before, after) {
			t.Fatal("rejected source changed journal")
		}
		if _, err := os.Stat(ep); err != nil {
			t.Fatal("replaced source removed")
		}
	})
	t.Run("actual-native-consumer-install-start-two-decisions-restart-stop-reopen", func(t *testing.T) {
		c, _, _ := writeCandidate(t, manifest, artifact)
		m, cfg := newManager(t, true)
		if err := m.ConfigureRuntimeCandidate(peer, c, manifest.Network); err != nil {
			t.Fatal(err)
		}
		i, a := prepareNative(t, m, "install", pin)
		if err := m.InstallConfiguredFixture(context.Background(), peer, i, a); err != nil {
			t.Fatal(err)
		}
		installed, err := m.InstalledRuntimeReadback(peer)
		raw, _ := json.Marshal(manifest)
		if err != nil || !bytes.Equal(installed.ManifestOriginal, raw) || installed.Authority || installed.OriginalReleaseAdmitted || installed.Code != "ISOLATED_LIFECYCLE_FIXTURE" {
			t.Fatalf("original candidate metadata lost %+v %v", installed, err)
		}
		i, a = prepareNative(t, m, "start", "")
		first, err := m.Start(context.Background(), peer, i, a)
		if err != nil {
			t.Fatal(err)
		}
		waitReady(t, m, cfg)
		if err := os.Remove(filepath.Join(cfg.Directory, "data", "fixture-ready")); err != nil {
			t.Fatal(err)
		}
		recorder := &candidateNativeRecorder{producer: producer}
		second, err := m.RestartNative(context.Background(), peer, recorder)
		if err != nil || first == second || len(recorder.intents) != 2 || recorder.intents[0].Action != "stop" || recorder.intents[1].Action != "start" || recorder.intents[0].Generation >= recorder.intents[1].Generation {
			t.Fatalf("restart reused approval or run %+v %v", recorder.intents, err)
		}
		waitReady(t, m, cfg)
		old, err := m.ReadLogs(peer, first)
		if err != nil || old.Code != "CAPTURED" {
			t.Fatal("restart discarded original completed logs")
		}
		i, a = prepareNative(t, m, "stop", "")
		if err := m.Stop(context.Background(), peer, i, a); err != nil {
			t.Fatal(err)
		}
		diagnosticsClose(t, m)
		next, err := ownednode.New(cfg)
		if err != nil {
			t.Fatal(err)
		}
		defer diagnosticsClose(t, next)
		read, err := next.InstalledRuntimeReadback(peer)
		if err != nil || !bytes.Equal(read.ManifestOriginal, raw) || read.ManifestSHA256 != installed.ManifestSHA256 {
			t.Fatal("installed metadata changed after restart")
		}
		s, err := next.Status(peer)
		if err != nil || s.ProcessOwned || s.Stage != "stopped" || s.Diagnostics.Synchronization.LocalHeight != nil {
			t.Fatal("reopen auto-started or fabricated sync")
		}
	})
	t.Run("native-cancel-after-owned-stop-does-not-restart", func(t *testing.T) {
		c, _, _ := writeCandidate(t, manifest, artifact)
		m, cfg := newManager(t, true)
		if err := m.ConfigureRuntimeCandidate(peer, c, manifest.Network); err != nil {
			t.Fatal(err)
		}
		i, a := prepareNative(t, m, "install", pin)
		if err := m.InstallConfiguredFixture(context.Background(), peer, i, a); err != nil {
			t.Fatal(err)
		}
		i, a = prepareNative(t, m, "start", "")
		first, err := m.Start(context.Background(), peer, i, a)
		if err != nil {
			t.Fatal(err)
		}
		waitReady(t, m, cfg)
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		recorder := &candidateNativeRecorder{producer: producer, cancelAt: 2, cancel: cancel}
		if _, err := m.RestartNative(ctx, peer, recorder); !errors.Is(err, context.Canceled) {
			t.Fatalf("late native cancellation accepted %v", err)
		}
		s, err := m.Status(peer)
		if err != nil || s.ProcessOwned || s.Stage != "stopped" || s.RunID != first {
			t.Fatalf("cancelled second decision restarted %+v %v", s, err)
		}
	})
	t.Log("only isolated real executable/native protocol fixtures executed; no original Root, publisher signature, user GUI consent, public node, validator, signer, funds or production activation")
}
