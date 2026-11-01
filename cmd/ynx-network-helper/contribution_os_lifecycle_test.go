//go:build darwin

package main_test

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

func resourceMonitorBinary(t *testing.T, dir string) (string, string) {
	t.Helper()
	file := filepath.Join(dir, "ynx-network-resource-monitor")
	cmd := exec.Command("xcrun", "clang", "-arch", "arm64", "-mmacosx-version-min=12.0", "-Wall", "-Wextra", "-Werror", "../../apps/network/qa/resource_monitor.c", "-o", file)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("monitor build: %v %s", err, out)
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	h := sha256.Sum256(raw)
	return file, hex.EncodeToString(h[:])
}

func TestP09OSLimitedFixedWorkerLifecycle(t *testing.T) {
	worker, pin := wasmRunnerBinary(t)
	monitor, mpin := resourceMonitorBinary(t, filepath.Dir(worker))
	t.Run("actual-worker-meter-reopen", func(t *testing.T) {
		input := []byte(`{"height":"os-contained-synthetic-fixture"}`)
		f := wasmRunner(t, worker, pin, input)
		if err := f.r.Close(); err != nil {
			t.Fatal(err)
		}
		executor, err := contribution.NewOSLimitedWASMExecutor(worker, pin, monitor, mpin)
		if err != nil {
			t.Fatal(err)
		}
		f.executor = executor
		f.r, err = contribution.NewControlledWASMSandbox(f.path, f.authority, executor)
		if err != nil {
			t.Fatal(err)
		}
		defer f.r.Close()
		if _, err = f.start(context.Background()); err != nil {
			t.Fatal(err)
		}
		if err = f.r.Wait(context.Background()); err != nil {
			t.Fatal(err)
		}
		rec, ok := f.r.Record(f.work.Job)
		if !ok || rec.State != "submitted" {
			t.Fatalf("record=%+v", rec)
		}
		if rec.Usage.Process == nil || rec.Usage.Process.Controls == nil || rec.Usage.Process.Monitor == nil || !rec.Usage.Process.Monitor.Waited || !rec.Usage.Process.Waited || rec.Usage.Process.PeakRSSBytes == 0 {
			t.Fatalf("actual kernel accounting: %+v", rec.Usage)
		}
		receipt, err := f.r.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, input)
		if err != nil {
			t.Fatal(err)
		}
		again, err := f.r.VerifyWorkReceipt(context.Background(), f.work.Job, rec.Result, input)
		if err != nil || again != receipt {
			t.Fatalf("dedup: %v", err)
		}
		meter := f.r.VerifyResourceMeter()
		if meter.OSMeasuredChildren != 2 || meter.OSUserMicros+meter.OSSystemMicros == 0 || meter.VerifiedJobs != 1 || meter.CPUServiceVerified || meter.Rewards != "NOT_AUTHORIZED" {
			t.Fatalf("meter=%+v", meter)
		}
		t.Logf("actual receipt=%+v usage=%+v monitor=%+v meter=%+v", receipt, *rec.Usage.Process, *rec.Usage.Process.Monitor, meter)
		// Returned records cannot mutate the journal's observed kernel accounting.
		rec.Usage.Process.Monitor.UserMicros = ^uint64(0)
		if f.r.VerifyResourceMeter() != meter {
			t.Fatal("monitor usage aliases stored record")
		}
		if err = f.r.Close(); err != nil {
			t.Fatal(err)
		}
		reopened, err := contribution.NewControlledWASMSandbox(f.path, f.authority, nil)
		if err == nil {
			reopened.Close()
			t.Fatal("nil executor admitted")
		}
		next, err := contribution.NewOSLimitedWASMExecutor(worker, pin, monitor, mpin)
		if err != nil {
			t.Fatal(err)
		}
		reopened, err = contribution.NewControlledWASMSandbox(f.path, f.authority, next)
		if err != nil {
			next.Close()
			t.Fatal(err)
		}
		defer reopened.Close()
		cold := reopened.VerifyResourceMeter()
		if next.Executions() != 0 || cold.ActiveWorkers != 0 || cold.OSMeasuredChildren != 2 || cold.VerifiedJobs != 0 || cold.CPUServiceVerified {
			t.Fatalf("cold=%+v", cold)
		}
	})
	t.Run("monitor-pin-required", func(t *testing.T) {
		bad := mpin[:63] + "0"
		if bad == mpin {
			bad = mpin[:63] + "1"
		}
		e, err := contribution.NewOSLimitedWASMExecutor(worker, pin, monitor, bad)
		if err == nil {
			e.Close()
			t.Fatal("bad monitor pin admitted")
		}
	})
}

// This fixture executable exists only in the test temp directory. It ignores
// SIGXCPU and TERM deliberately, so readback/cooperation cannot pass this test.
const hostileOSWorker = `
#include <sys/resource.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <string.h>
int main(int argc,char **argv){
 unsigned long cpu=0,ms=0;for(int i=1;i+1<argc;i+=2){if(!strcmp(argv[i],"--cpu-milli"))cpu=strtoul(argv[i+1],0,10);if(!strcmp(argv[i],"--duration-ms"))ms=strtoul(argv[i+1],0,10);}
 struct rlimit r={1,1};if(setrlimit(RLIMIT_CPU,&r))return 3;signal(SIGXCPU,SIG_IGN);signal(SIGTERM,SIG_IGN);
 dprintf(3,"{\"version\":\"YNX-NETWORK-WORKER-OS-LIMITS/v1\",\"platform\":\"darwin\",\"cpuSeconds\":\"%lu\",\"fileSizeBytes\":\"0\",\"coreBytes\":\"0\",\"openFiles\":\"32\",\"processes\":\"0\",\"parentBound\":true,\"memoryHard\":false,\"cpuShareHard\":false,\"diskQuotaHard\":false,\"challenge\":\"%s\"}\n",(cpu*ms+999999)/1000000,getenv("YNX_NETWORK_LIMITS_CHALLENGE"));close(3);
 char data;if(read(0,&data,1)!=1)return 4;
 volatile unsigned long value=0;for(;;)value++;
}`

func TestP09OSMonitorStopsUncooperativeChild(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	monitor, mpin := resourceMonitorBinary(t, dir)
	source := filepath.Join(dir, "hostile.c")
	if err = os.WriteFile(source, []byte(hostileOSWorker), 0600); err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(dir, "ynx-network-task-worker")
	if out, err := exec.Command("xcrun", "clang", "-O0", source, "-o", worker).CombinedOutput(); err != nil {
		t.Fatalf("fixture build: %v %s", err, out)
	}
	raw, _ := os.ReadFile(worker)
	h := sha256.Sum256(raw)
	pin := hex.EncodeToString(h[:])
	t.Run("readback-before-input", func(t *testing.T) {
		badDir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		badWorker := filepath.Join(badDir, "ynx-network-task-worker")
		badSource := filepath.Join(badDir, "replayed.c")
		code := strings.Replace(hostileOSWorker, `getenv("YNX_NETWORK_LIMITS_CHALLENGE")`, `"00000000000000000000000000000000"`, 1)
		if err = os.WriteFile(badSource, []byte(code), 0600); err != nil {
			t.Fatal(err)
		}
		if out, err := exec.Command("xcrun", "clang", badSource, "-o", badWorker).CombinedOutput(); err != nil {
			t.Fatalf("fixture: %v %s", err, out)
		}
		b, _ := os.ReadFile(badWorker)
		sum := sha256.Sum256(b)
		e, err := contribution.NewOSLimitedWASMExecutor(badWorker, hex.EncodeToString(sum[:]), monitor, mpin)
		if err != nil {
			t.Fatal(err)
		}
		defer e.Close()
		_, u, err := e.Execute(context.Background(), []byte("must-not-release"), contribution.Limits{CPUMilli: "1000", MemoryBytes: "9000000", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"})
		if !errors.Is(err, contribution.ErrOSLimits) || u.BytesRead != 0 || u.Process == nil || !u.Process.Waited || !u.Process.HostKillRequested || u.Process.Monitor != nil {
			t.Fatalf("replayed readback admitted input: %v %+v", err, u)
		}
	})
	t.Run("monitor-ready-before-input", func(t *testing.T) {
		badDir, err := filepath.EvalSymlinks(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		badMonitor := filepath.Join(badDir, "ynx-network-resource-monitor")
		b, err := os.ReadFile("/usr/bin/true")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(badMonitor, b, 0700); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(b)
		e, err := contribution.NewOSLimitedWASMExecutor(worker, pin, badMonitor, hex.EncodeToString(sum[:]))
		if err != nil {
			t.Fatal(err)
		}
		defer e.Close()
		_, u, err := e.Execute(context.Background(), []byte("must-not-release"), contribution.Limits{CPUMilli: "1000", MemoryBytes: "9000000", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"})
		if !errors.Is(err, contribution.ErrOSLimits) || u.BytesRead != 0 || u.Process == nil || !u.Process.Waited || !u.Process.HostKillRequested {
			t.Fatalf("missing monitor readiness admitted input: %v %+v", err, u)
		}
	})
	for _, mode := range []string{"cpu-budget", "explicit-stop"} {
		t.Run(mode, func(t *testing.T) {
			e, err := contribution.NewOSLimitedWASMExecutor(worker, pin, monitor, mpin)
			if err != nil {
				t.Fatal(err)
			}
			defer e.Close()
			limits := contribution.Limits{CPUMilli: "40", MemoryBytes: "9000000", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"}
			type result struct {
				u   contribution.Usage
				err error
			}
			done := make(chan result, 1)
			began := time.Now()
			go func() {
				_, u, err := e.Execute(context.Background(), []byte("fixture"), limits)
				done <- result{u, err}
			}()
			if mode == "explicit-stop" {
				deadline := time.Now().Add(2 * time.Second)
				for {
					_, started, read := e.LocalProcess()
					if started && read > 0 {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("worker never received gated input")
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
				if mode == "cpu-budget" && !errors.Is(r.err, contribution.ErrLimit) {
					t.Fatalf("budget error=%v usage=%+v", r.err, r.u)
				}
				u := r.u.Process
				if u == nil || u.Monitor == nil || !u.Waited || !u.Monitor.Waited || !u.HostKillRequested || u.ExitSignal != "killed" {
					t.Fatalf("owned kill/wait: %+v", u)
				}
				if mode == "cpu-budget" && (u.UserMicros+u.SystemMicros < 200000 || u.UserMicros+u.SystemMicros > 1200000) {
					t.Fatalf("Mach conversion or CPU enforcement: %+v", u)
				}
				if occupied, started, _ := e.LocalProcess(); occupied || started {
					t.Fatal("Stop returned with child occupied")
				}
				if time.Since(began) > 3*time.Second {
					t.Fatal("forced stop exceeded bound")
				}
				t.Logf("mode=%s wall=%s worker=%+v monitor=%+v", mode, time.Since(began), *u, *u.Monitor)
			case <-time.After(4 * time.Second):
				t.Fatal("uncooperative worker not stopped")
			}
		})
	}
}

func TestP09OSMonitorChangedSourcePreservesUsage(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	monitor, mpin := resourceMonitorBinary(t, dir)
	source := filepath.Join(dir, "hostile.c")
	if err = os.WriteFile(source, []byte(hostileOSWorker), 0600); err != nil {
		t.Fatal(err)
	}
	worker := filepath.Join(dir, "ynx-network-task-worker")
	if out, err := exec.Command("xcrun", "clang", source, "-o", worker).CombinedOutput(); err != nil {
		t.Fatalf("fixture: %v %s", err, out)
	}
	raw, _ := os.ReadFile(worker)
	sum := sha256.Sum256(raw)
	e, err := contribution.NewOSLimitedWASMExecutor(worker, hex.EncodeToString(sum[:]), monitor, mpin)
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	type result struct {
		u   contribution.Usage
		err error
	}
	done := make(chan result, 1)
	go func() {
		_, u, err := e.Execute(context.Background(), []byte("account-even-when-code-changes"), contribution.Limits{CPUMilli: "1000", MemoryBytes: "9000000", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"})
		done <- result{u, err}
	}()
	deadline := time.Now().Add(2 * time.Second)
	for {
		_, started, read := e.LocalProcess()
		if started && read > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("worker never admitted")
		}
		time.Sleep(time.Millisecond)
	}
	if err = os.WriteFile(monitor, []byte("changed test-owned monitor source; captured running code remains original"), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err = e.Stop(ctx); err != nil {
		t.Fatal(err)
	}
	r := <-done
	if !errors.Is(r.err, contribution.ErrInvalid) || r.u.BytesRead == 0 || r.u.WallMicros == 0 || r.u.Process == nil || r.u.Process.Monitor == nil || !r.u.Process.Monitor.Waited {
		t.Fatalf("code-change failure lost actual usage: %v %+v", r.err, r.u)
	}
	t.Logf("changed source rejected with bytes=%d wallMicros=%d and both wait4 observations preserved", r.u.BytesRead, r.u.WallMicros)
}

// The parent probe is test-only. The real fixed worker must exit after its
// original parent dies while stdin remains open and no input has been released.
func TestP09OSWorkerParentProbe(t *testing.T) {
	if os.Getenv("YNX_OS_PARENT_PROBE") != "1" {
		return
	}
	r, w, err := os.Pipe()
	if err != nil {
		os.Exit(81)
	}
	cmd := exec.Command(os.Getenv("YNX_OS_PROBE_WORKER"), "--bytes", "1", "--cpu-milli", "1000", "--memory-bytes", "9000000", "--duration-ms", "5000")
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	cmd.ExtraFiles = []*os.File{w}
	cmd.Env = []string{"GOMAXPROCS=1", "YNX_NETWORK_OS_LIMITS=1", "YNX_NETWORK_PARENT_PID=" + strconv.Itoa(os.Getpid()), "YNX_NETWORK_LIMITS_CHALLENGE=0123456789abcdef0123456789abcdef"}
	if cmd.Start() != nil {
		os.Exit(82)
	}
	w.Close()
	raw, err := io.ReadAll(io.LimitReader(r, 1025))
	r.Close()
	var ack map[string]any
	if err != nil || json.Unmarshal(raw, &ack) != nil || ack["parentBound"] != true {
		os.Exit(83)
	}
	fmt.Println(cmd.Process.Pid)
	_ = cmd.Wait()
	os.Exit(84)
}
func TestP09OSWorkerExitsAfterParentDeath(t *testing.T) {
	worker, _ := wasmRunnerBinary(t)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestP09OSWorkerParentProbe$")
	cmd.Env = append(os.Environ(), "YNX_OS_PARENT_PROBE=1", "YNX_OS_PROBE_WORKER="+worker)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer stdin.Close()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	scanner := bufio.NewScanner(stdout)
	if !scanner.Scan() {
		t.Fatal("no actual worker parent readback")
	}
	pid, err := strconv.Atoi(scanner.Text())
	if err != nil || pid <= 1 {
		t.Fatal("invalid child observation")
	}
	began := time.Now()
	if err = cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = cmd.Wait()
	deadline := time.Now().Add(time.Second)
	for {
		// Observation only: this test never signals a PID read from stdout.
		raw, err := exec.Command("/bin/ps", "-p", strconv.Itoa(pid), "-o", "stat=").Output()
		if err != nil || strings.TrimSpace(string(raw)) == "" || strings.HasPrefix(strings.TrimSpace(string(raw)), "Z") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("orphan worker still live after parent death: %s", raw)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Logf("actual fixed worker stopped after original parent death in %s; stdin kept open", time.Since(began))
}

func TestP09OSMonitorCannotClaimLiveChildExited(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	monitorSource, err := os.ReadFile("../../apps/network/qa/resource_monitor.c")
	if err != nil {
		t.Fatal(err)
	}
	changed := strings.Replace(string(monitorSource), "if(getppid()!=parent)return 0;", `if(getppid()!=parent)return 0; emit("exited",argv[10],pid,parent,&u);return 0;`, 1)
	src := filepath.Join(dir, "false-exit.c")
	if err = os.WriteFile(src, []byte(changed), 0600); err != nil {
		t.Fatal(err)
	}
	monitor := filepath.Join(dir, "ynx-network-resource-monitor")
	if out, err := exec.Command("xcrun", "clang", src, "-o", monitor).CombinedOutput(); err != nil {
		t.Fatalf("fixture monitor: %v %s", err, out)
	}
	b, _ := os.ReadFile(monitor)
	mh := sha256.Sum256(b)
	worker := filepath.Join(dir, "ynx-network-task-worker")
	src = filepath.Join(dir, "hostile.c")
	os.WriteFile(src, []byte(hostileOSWorker), 0600)
	if out, err := exec.Command("xcrun", "clang", src, "-o", worker).CombinedOutput(); err != nil {
		t.Fatalf("fixture worker: %v %s", err, out)
	}
	b, _ = os.ReadFile(worker)
	wh := sha256.Sum256(b)
	e, err := contribution.NewOSLimitedWASMExecutor(worker, hex.EncodeToString(wh[:]), monitor, hex.EncodeToString(mh[:]))
	if err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	began := time.Now()
	_, u, err := e.Execute(context.Background(), []byte("fixture"), contribution.Limits{CPUMilli: "1000", MemoryBytes: "9000000", StorageBytes: "0", EgressBytes: "0", DurationMillis: "5000"})
	if !errors.Is(err, contribution.ErrOSLimits) || u.Process == nil || u.Process.Monitor == nil || !u.Process.HostKillRequested || !u.Process.Waited || !u.Process.Monitor.Waited || time.Since(began) > time.Second {
		t.Fatalf("live child left unmonitored: %v %+v", err, u)
	}
	t.Logf("false exit fails closed and waits both children in %s", time.Since(began))
}
