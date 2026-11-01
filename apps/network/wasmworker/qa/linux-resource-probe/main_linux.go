//go:build linux

// Explicit QA-only executable. Never linked into or selected by the product
// fixed worker. It uses the same private readback module inside the scheduled
// cgroup to challenge actual kernel isolation, not guest self-reported limits.
package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/wasmworker/internal/oslimits"
	"golang.org/x/sys/unix"
)

func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(9) }
func main() {
	if len(os.Args) != 9 {
		fail("QA_ARGS")
	}
	values := map[string]uint64{}
	for i := 1; i < len(os.Args); i += 2 {
		n, e := strconv.ParseUint(os.Args[i+1], 10, 64)
		if e != nil {
			fail("QA_ARGS")
		}
		values[os.Args[i]] = n
	}
	_, stop, e := oslimits.Apply(values["--cpu-milli"], values["--duration-ms"])
	if e != nil {
		fail("QA_LIMITS")
	}
	defer stop()
	input, e := io.ReadAll(io.LimitReader(os.Stdin, 64))
	if e != nil || len(input) == 0 {
		fail("QA_INPUT")
	}
	switch string(input) {
	case "memory":
		b := make([]byte, 64<<20)
		for i := range b {
			b[i] = byte(i)
		}
		runtime.KeepAlive(b)
		fail("MEMORY_LIMIT_FAILED")
	case "cpu":
		began := time.Now()
		for time.Since(began) < 2*time.Second {
		} // external wall+cpu.max control
	case "pids":
		for i := 0; i < 64; i++ {
			go func() { runtime.LockOSThread(); time.Sleep(10 * time.Second) }()
		}
		time.Sleep(10 * time.Second)
	case "surface":
		for _, family := range []int{unix.AF_INET, unix.AF_INET6, unix.AF_UNIX} {
			fd, err := unix.Socket(family, unix.SOCK_STREAM, 0)
			if err == nil {
				unix.Close(fd)
				fail("SOCKET_ALLOWED")
			}
			if err != unix.EPERM {
				fail("SOCKET_WRONG_FAILURE")
			}
		}
		if err := os.WriteFile("/forbidden-host-write", []byte("x"), 0600); err == nil {
			fail("ROOT_WRITE_ALLOWED")
		}
		for _, p := range []string{"/etc/passwd", "/home", "/root", "/sys"} {
			if _, err := os.Stat(p); err == nil {
				fail("HOST_PATH_VISIBLE")
			}
		}
		if err := exec.CommandContext(context.Background(), "/worker").Run(); err == nil {
			fail("FORK_ALLOWED")
		}
		scratch, _ := strconv.ParseUint(os.Getenv("YNX_NETWORK_SCRATCH_BYTES"), 10, 64)
		f, err := os.OpenFile("/scratch/bounded", os.O_CREATE|os.O_WRONLY, 0600)
		if scratch == 0 {
			if err == nil {
				f.Close()
				fail("ZERO_SCRATCH_WRITABLE")
			}
		} else {
			if err != nil {
				fail("SCRATCH_UNAVAILABLE")
			}
			block := make([]byte, 4096)
			var written uint64
			for written < scratch+4096 {
				n, e := f.Write(block)
				written += uint64(n)
				if e != nil {
					break
				}
			}
			f.Close()
			if written > scratch {
				fail("SCRATCH_GREW_PAST_LIMIT")
			}
			if written != scratch {
				fail("SCRATCH_NOT_EXPECTED_BOUND")
			}
		}
	case "stop":
		time.Sleep(10 * time.Second)
	default:
		fail("QA_KIND")
	}
	if _, e = os.Stdout.Write(make([]byte, 1024)); e != nil {
		fail("QA_OUTPUT")
	}
}
