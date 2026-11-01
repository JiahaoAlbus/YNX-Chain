//go:build linux

package contribution

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestLinuxDelegateAndAccountingParsing(t *testing.T) {
	good := "0::/user.slice/user-1000.slice/user@1000.service/app.slice/ynx-network-resource-7f69b8d298cd4390aeef980d5eb29c10.service/supervisor\n"
	if _, e := linuxUnitParent(good); e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{"0::/", "0::/user.slice/supervisor", strings.Replace(good, "supervisor", "../supervisor", 1), strings.Replace(good, "7f69", "7F69", 1), good + "1:cpu:/evil\n", strings.Replace(good, ".service/", ".scope/", 1)} {
		if _, e := linuxUnitParent(s); e == nil {
			t.Fatalf("foreign delegate accepted %q", s)
		}
	}
	for _, s := range []string{"user_usec 1\nuser_usec 2", "user_usec -1", "user_usec 01", "user_usec 1 extra", "user_usec max"} {
		if _, e := linuxNumbers(s); e == nil {
			t.Fatalf("unbounded accounting %q", s)
		}
	}
}
func TestLinuxAbsentDelegateFailsClosed(t *testing.T) {
	raw, e := os.ReadFile("/proc/self/cgroup")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = linuxUnitParent(string(raw)); e == nil {
		t.Skip("actual dedicated delegate; runtime test below exercises it")
	}
	b, e := newLinuxBackend(strings.Repeat("0", 64))
	if b != nil || !errors.Is(e, ErrUnsupported) {
		t.Fatalf("nondelegate fallback: %v", e)
	}
}

type linuxQAAuthority struct{ issuer, person ed25519.PublicKey }

func (a linuxQAAuthority) VerifyManifest(ctx context.Context, id string, payload, sig []byte) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if id != "linux-fixture-issuer" || !ed25519.Verify(a.issuer, payload, sig) {
		return ErrDenied
	}
	return nil
}
func (a linuxQAAuthority) VerifyConsent(ctx context.Context, id string, payload, sig []byte) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if id != "linux-fixture-person" || !ed25519.Verify(a.person, payload, sig) {
		return ErrDenied
	}
	return nil
}
func linuxQACode(t *testing.T, name string) (string, string) {
	t.Helper()
	dir := os.Getenv("YNX_NETWORK_LINUX_QA_DIRECTORY")
	if !filepath.IsAbs(dir) || filepath.Clean(dir) != dir {
		t.Fatal("explicit QA stage required")
	}
	p := filepath.Join(dir, name)
	raw, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	h := sha256.Sum256(raw)
	pin := hex.EncodeToString(h[:])
	expected := os.Getenv("YNX_NETWORK_LINUX_QA_" + strings.ToUpper(strings.ReplaceAll(name, "-", "_")) + "_SHA256")
	if pin != expected {
		t.Fatal("independent fixed QA executable pin mismatch")
	}
	return p, pin
}
func TestLinuxContainedRuntime(t *testing.T) {
	if os.Getenv("YNX_NETWORK_LINUX_QA") != "1" {
		t.Skip("requires explicitly scheduled Linux delegate; compile is not containment evidence")
	}
	worker, pin := linuxQACode(t, "ynx-network-task-worker")
	sandboxPin := os.Getenv("YNX_NETWORK_LINUX_QA_BWRAP_SHA256")
	elfFile, e := elf.Open(worker)
	if e != nil {
		t.Fatal(e)
	}
	for _, p := range elfFile.Progs {
		if p.Type == elf.PT_INTERP {
			t.Fatal("worker must be static")
		}
	}
	elfFile.Close()
	newExecutor := func(t *testing.T, worker, pin string) *PinnedWASMExecutor {
		t.Helper()
		e, err := NewLinuxContainedWASMExecutor(worker, pin, sandboxPin)
		if err != nil {
			t.Fatalf("UNSUPPORTED or failed actual host controls (no fallback): %v", err)
		}
		e.diagnostic = func(d processDiagnostic) {
			t.Logf("owned setup diagnostic: stderr=%q controls=%+v runErr=%v limitErr=%v groupErr=%v inputReleased=%d", d.Stderr, d.Controls, d.RunError, d.LimitError, d.GroupError, d.Usage.BytesRead)
			if d.Usage.Process != nil {
				if d.Controls != nil && d.Controls.Linux != nil {
					t.Logf("actual Linux controls=%+v", *d.Controls.Linux)
				}
				t.Logf("actual wrapper wait4=%+v group=%+v", *d.Usage.Process, d.Usage.Process.Group)
			}
		}
		return e
	}
	t.Run("fixed-worker-meter-cold", func(t *testing.T) {
		ip, ik, _ := ed25519.GenerateKey(rand.Reader)
		pp, pk, _ := ed25519.GenerateKey(rand.Reader)
		a := linuxQAAuthority{ip, pp}
		input := []byte(`{"classification":"synthetic-linux-contained"}`)
		e := newExecutor(t, worker, pin)
		r, err := NewControlledWASMSandbox(t.TempDir()+"/journal.json", a, e)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Close()
		l := Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(MaxMemoryBytes), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
		w := Work{Job: "linux-fixed-1", Kind: PublicBlockHistogramKind, Issuer: "linux-fixture-issuer", Input: Bind(input), Limits: l, ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}
		c := Consent{Principal: "linux-fixture-person", Job: w.Job, Manifest: Bind(ManifestPayload(w)), Limits: l, ExpiresAt: w.ExpiresAt, Nonce: "linux-once-1", Allow: true}
		if _, err = r.StartContribution(context.Background(), w, c, ed25519.Sign(ik, ManifestPayload(w)), ed25519.Sign(pk, ConsentPayload(c)), input); err != nil {
			t.Fatal(err)
		}
		if err = r.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
		rec, _ := r.Record(w.Job)
		if rec.State != "submitted" || rec.Usage.Process == nil || rec.Usage.Process.Group == nil || !rec.Usage.Process.Group.Empty || rec.Usage.Process.Controls == nil || !validOSControls(rec.Usage.Process.Controls) {
			t.Fatalf("not actually contained: %+v", rec)
		}
		receipt, err := r.VerifyWorkReceipt(context.Background(), w.Job, rec.Result, input)
		if err != nil {
			t.Fatal(err)
		}
		again, err := r.VerifyWorkReceipt(context.Background(), w.Job, rec.Result, input)
		if err != nil || again != receipt {
			t.Fatal("unique result failed")
		}
		m := r.VerifyResourceMeter()
		if m.LinuxMeasuredGroups != 1 || m.LinuxGroupMemoryPeakBytes == 0 || m.LinuxGroupUserMicros+m.LinuxGroupSystemMicros == 0 || m.CPUServiceVerified || m.Rewards != "NOT_AUTHORIZED" {
			t.Fatalf("meter=%+v", m)
		}
		t.Logf("actual controls=%+v group=%+v receipt=%+v meter=%+v", *rec.Usage.Process.Controls.Linux, *rec.Usage.Process.Group, receipt, m)
		path := r.path
		if err = r.Close(); err != nil {
			t.Fatal(err)
		}
		next := newExecutor(t, worker, pin)
		cold, err := NewControlledWASMSandbox(path, a, next)
		if err != nil {
			t.Fatal(err)
		}
		defer cold.Close()
		cm := cold.VerifyResourceMeter()
		if next.Executions() != 0 || cm.ActiveWorkers != 0 || cm.VerifiedJobs != 0 || cm.LinuxGroupUserMicros != m.LinuxGroupUserMicros || cm.LinuxMeasuredGroups != 1 {
			t.Fatalf("cold=%+v", cm)
		}
	})
	t.Run("normal-helper-controlled-cli-reopen", func(t *testing.T) {
		helper, _ := linuxQACode(t, "ynx-network-helper")
		ip, ik, _ := ed25519.GenerateKey(rand.Reader)
		pp, pk, _ := ed25519.GenerateKey(rand.Reader)
		input := []byte(`{"classification":"synthetic-packaged-linux-cli"}`)
		l := Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(MaxMemoryBytes), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
		w := Work{Job: "linux-cli-1", Kind: PublicBlockHistogramKind, Issuer: "linux-fixture-issuer", Input: Bind(input), Limits: l, ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}
		c := Consent{Principal: "linux-fixture-person", Job: w.Job, Manifest: Bind(ManifestPayload(w)), Limits: l, ExpiresAt: w.ExpiresAt, Nonce: "linux-cli-once-1", Allow: true}
		packet := map[string]any{"version": "YNX-NETWORK-CONTROLLED-WASM-PACKET/v1", "classification": SandboxClass, "work": w, "consent": c, "issuerPublicKey": hex.EncodeToString(ip), "consentPublicKey": hex.EncodeToString(pp), "manifestSignature": hex.EncodeToString(ed25519.Sign(ik, ManifestPayload(w))), "consentSignature": hex.EncodeToString(ed25519.Sign(pk, ConsentPayload(c))), "input": input}
		raw, err := json.Marshal(packet)
		if err != nil {
			t.Fatal(err)
		}
		directory, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		if err = os.Chmod(directory, 0700); err != nil {
			t.Fatal(err)
		}
		file := filepath.Join(directory, "packet.json")
		if err = os.WriteFile(file, raw, 0600); err != nil {
			t.Fatal(err)
		}
		keyPin := func(key []byte) string { h := sha256.Sum256(key); return hex.EncodeToString(h[:]) }
		var first Receipt
		var firstMeter Meter
		for _, starts := range []uint64{1, 0} {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			out, err := exec.CommandContext(ctx, helper, "--run-controlled-wasm", file, "--data-dir", directory, "--controlled-issuer-key-sha256", keyPin(ip), "--controlled-consent-key-sha256", keyPin(pp)).CombinedOutput()
			cancel()
			if err != nil {
				t.Fatalf("same-package normal helper CLI: %v %s", err, out)
			}
			var report struct {
				Classification string  `json:"classification"`
				Production     bool    `json:"productionEnabled"`
				Human          bool    `json:"humanConsentEstablished"`
				Worker         uint64  `json:"workerExecutions"`
				Stopped        bool    `json:"stopped"`
				After          bool    `json:"workerAfterStop"`
				Receipt        Receipt `json:"receipt"`
				Meter          Meter   `json:"meter"`
			}
			if json.Unmarshal(out, &report) != nil || report.Classification != SandboxClass || report.Production || report.Human || report.Worker != starts || !report.Stopped || report.After || report.Meter.ActiveWorkers != 0 || report.Meter.VerifiedJobs != 1 || report.Meter.LinuxMeasuredGroups != 1 || report.Meter.CPUServiceVerified || report.Meter.Rewards != "NOT_AUTHORIZED" {
				t.Fatalf("normal CLI report: %s", out)
			}
			// Recompute output without trusting the worker's histogram or receipt hashes.
			counts := make([]byte, HistogramOutputBytes)
			for _, byteValue := range input {
				offset := int(byteValue) * 4
				n := uint32(counts[offset]) | uint32(counts[offset+1])<<8 | uint32(counts[offset+2])<<16 | uint32(counts[offset+3])<<24
				n++
				counts[offset] = byte(n)
				counts[offset+1] = byte(n >> 8)
				counts[offset+2] = byte(n >> 16)
				counts[offset+3] = byte(n >> 24)
			}
			if report.Receipt.Result.Output != Bind(counts) {
				t.Fatal("independent histogram mismatch")
			}
			if starts == 1 {
				first = report.Receipt
				firstMeter = report.Meter
			} else if first.ID != report.Receipt.ID || firstMeter.LinuxGroupUserMicros != report.Meter.LinuxGroupUserMicros || firstMeter.LinuxGroupSystemMicros != report.Meter.LinuxGroupSystemMicros {
				t.Fatal("cold replay or duplicated cgroup CPU")
			}
			t.Logf("same-package CLI workerStarts=%d receipt=%s meter=%+v", starts, report.Receipt.ID, report.Meter)
		}
	})
	probe, probePin := linuxQACode(t, "ynx-network-resource-probe")
	// The product constructor admits only the fixed worker basename. These
	// test-only probe bytes are copied into that fixed name inside private QA
	// space, independently pinned, and never selected by a public job payload.
	raw, err := os.ReadFile(probe)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != probePin {
		t.Fatal("probe changed")
	}
	fixtureDir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture := filepath.Join(fixtureDir, processWorkerName)
	if err = os.WriteFile(fixture, raw, 0700); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"memory", "cpu", "pids", "surface", "scratch", "stop"} {
		t.Run(mode, func(t *testing.T) {
			e := newExecutor(t, fixture, probePin)
			defer e.Close()
			l := Limits{CPUMilli: "1000", MemoryBytes: strconv.Itoa(MaxMemoryBytes), StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
			input := []byte(mode)
			if mode == "scratch" {
				input = []byte("surface")
				l.StorageBytes = "1048576"
			}
			if mode == "cpu" {
				l.CPUMilli = "100"
				l.DurationMillis = "1500"
			}
			type outcome struct {
				usage Usage
				err   error
			}
			done := make(chan outcome, 1)
			began := time.Now()
			go func() { _, usage, err := e.Execute(context.Background(), input, l); done <- outcome{usage, err} }()
			if mode == "stop" {
				deadline := time.Now().Add(3 * time.Second)
				for {
					_, started, read := e.LocalProcess()
					if started && read > 0 {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("no gated input to stop")
					}
					time.Sleep(time.Millisecond)
				}
				ctx, cancel := context.WithTimeout(context.Background(), time.Second)
				defer cancel()
				if err = e.Stop(ctx); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case r := <-done:
				u := r.usage.Process
				if u == nil || u.Group == nil || !u.Waited || !u.Group.Empty || u.Controls == nil {
					t.Fatalf("missing real controls/cleanup: err=%v usage=%+v", r.err, r.usage)
				}
				switch mode {
				case "memory":
					if r.err == nil || u.Group.OOMKills == 0 {
						t.Fatalf("no actual memory OOM: %v %+v", r.err, *u.Group)
					}
				case "cpu":
					if r.err == nil || u.Group.ThrottledMicros == 0 || u.Group.UserMicros+u.Group.SystemMicros > 700000 {
						t.Fatalf("CPU bandwidth not enforced: %v %+v", r.err, *u.Group)
					}
				case "pids":
					if r.err == nil || u.Group.PidsDenied == 0 {
						t.Fatalf("pids max not enforced: %v %+v", r.err, *u.Group)
					}
				case "surface", "scratch":
					if r.err != nil {
						t.Fatalf("isolated surface checks failed: %v %+v", r.err, *u.Group)
					}
				case "stop":
					if r.err == nil || !u.HostKillRequested || time.Since(began) > 4*time.Second {
						t.Fatalf("explicit stop failed: %v %+v", r.err, *u)
					}
				}
				if occupied, started, _ := e.LocalProcess(); occupied || started {
					t.Fatal("active child after Wait")
				}
				if err = e.Close(); err != nil {
					t.Fatal(err)
				}
				t.Logf("mode=%s wall=%s actualControls=%+v group=%+v err=%v", mode, time.Since(began), *u.Controls.Linux, *u.Group, r.err)
			case <-time.After(7 * time.Second):
				t.Fatal("contained worker not bounded")
			}
		})
	}

}
