//go:build darwin

package oslimits

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Each probe changes only a separate owned test child, never the test runner.
// Probe branches are absent from the production fixed worker.
func TestDarwinLimitChild(t *testing.T) {
	mode := os.Getenv("YNX_OS_LIMIT_PROBE")
	if mode == "" {
		return
	}
	duration := uint64(5000)
	if mode == "cpu" {
		duration = 1000
	}
	report, stop, err := Apply(1000, duration)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(71)
	}
	defer stop()
	raw, _ := json.Marshal(report)
	fmt.Println(string(raw))
	switch mode {
	case "cpu":
		// Retain the failed RLIMIT_CPU counterexample as a bounded observation.
		// Enforcement is tested through the parent monitor, never this readback.
		until := time.Now().Add(2 * time.Second)
		for time.Now().Before(until) {
		}
		fmt.Println("CPU_READBACK_ONLY")
	case "file":
		err := os.WriteFile(os.Getenv("YNX_OS_LIMIT_PROBE_FILE"), []byte("blocked"), 0600)
		if err == nil {
			os.Exit(72)
		}
		fmt.Println("FILE_DENIED")
	case "fork":
		if exec.Command("/usr/bin/true").Run() == nil {
			os.Exit(73)
		}
		fmt.Println("FORK_DENIED")
	case "files":
		var opened []*os.File
		for i := 0; i < 64; i++ {
			file, e := os.Open("/dev/null")
			if e != nil {
				if !errors.Is(e, unix.EMFILE) {
					os.Exit(74)
				}
				fmt.Printf("FD_DENIED %d\n", len(opened))
				os.Exit(0)
			}
			opened = append(opened, file)
		}
		os.Exit(75)
	case "memory-observation":
		data := make([]byte, 64<<20)
		for i := range data {
			data[i] = byte(i)
		}
		fmt.Printf("RSS_NOT_CAPPED %d\n", len(data))
	default:
		os.Exit(76)
	}
	os.Exit(0)
}

func TestDarwinActualResourceLimits(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("unprivileged controlled worker refuses root")
	}
	for _, mode := range []string{"cpu", "file", "fork", "files", "memory-observation"} {
		t.Run(mode, func(t *testing.T) {
			var original, after unix.Rlimit
			_ = unix.Getrlimit(unix.RLIMIT_FSIZE, &original)
			ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestDarwinLimitChild$")
			file := t.TempDir() + "/no-growth"
			cmd.Env = append(os.Environ(), "YNX_OS_LIMIT_PROBE="+mode, "YNX_OS_LIMIT_PROBE_FILE="+file, "GOMAXPROCS=1")
			var out, stderr bytes.Buffer
			cmd.Stdout = &out
			cmd.Stderr = &stderr
			err := cmd.Run()
			if ctx.Err() != nil {
				t.Fatalf("probe exceeded bound: %s", stderr.String())
			}
			line, _, _ := strings.Cut(out.String(), "\n")
			var report Report
			if json.Unmarshal([]byte(line), &report) != nil || report.FileSizeBytes != "0" || report.CoreBytes != "0" || report.Processes != "0" || report.OpenFiles != "32" || report.MemoryHard || report.CPUShareHard || report.DiskQuotaHard || !report.ParentBound {
				t.Fatalf("actual readback: %s %s %v", out.String(), stderr.String(), err)
			}
			if mode == "cpu" {
				status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
				if err != nil && (!ok || !status.Signaled() || status.Signal() != syscall.SIGXCPU) {
					t.Fatalf("CPU probe abnormal: %v %s", err, stderr.String())
				}
				t.Logf("RLIMIT_CPU readback is not accepted as enforcement: exit=%v actualCPU=%s", err, cmd.ProcessState.UserTime()+cmd.ProcessState.SystemTime())
			} else if mode == "file" {
				info, e := os.Stat(file)
				if e == nil && info.Size() != 0 {
					t.Fatalf("file grew despite zero cap: %d", info.Size())
				}
				if err != nil {
					status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
					if !ok || !status.Signaled() || status.Signal() != syscall.SIGXFSZ {
						t.Fatalf("file failure not cap: %v %s", err, stderr.String())
					}
				}
			} else if err != nil {
				t.Fatalf("resource probe: %v %s", err, stderr.String())
			}
			_ = unix.Getrlimit(unix.RLIMIT_FSIZE, &after)
			if original != after {
				t.Fatal("child changed parent process limits")
			}
			t.Logf("mode=%s actual=%s exit=%s stdout=%s", mode, line, cmd.ProcessState.String(), strings.TrimSpace(out.String()))
		})
	}
}
