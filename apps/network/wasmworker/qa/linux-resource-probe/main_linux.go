//go:build linux

// Explicit QA-only executable. Never linked into or selected by the product
// fixed worker. It uses the same private readback module inside the scheduled
// cgroup to challenge actual kernel isolation, not guest self-reported limits.
package main

import (
	"context"
	"errors"
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
		if err := os.WriteFile("/forbidden-host-write", []byte("x"), 0600); !errors.Is(err, unix.EROFS) {
			fail("ROOT_NOT_READ_ONLY")
		}
		for _, p := range []string{"/etc/passwd", "/home", "/root", "/sys"} {
			if _, err := os.Stat(p); err == nil {
				fail("HOST_PATH_VISIBLE")
			}
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		child := exec.CommandContext(ctx, "/worker")
		// The empty sandbox deliberately has no /dev/null. Nil stdio would
		// make Cmd.Start open that absent path before reaching fork/clone,
		// so retain only the probe's existing descriptors for this challenge.
		child.Stdin, child.Stdout, child.Stderr = os.Stdin, os.Stdout, os.Stderr
		err := child.Start()
		if err == nil {
			_ = child.Process.Kill()
			_ = child.Wait()
			cancel()
			fail("FORK_ALLOWED")
		}
		cancel()
		if !errors.Is(err, unix.EPERM) {
			fail(fmt.Sprintf("FORK_WRONG_FAILURE %T: %v", err, err))
		}
		scratch, _ := strconv.ParseUint(os.Getenv("YNX_NETWORK_SCRATCH_BYTES"), 10, 64)
		if scratch == 0 {
			f, err := os.OpenFile("/scratch/bounded", os.O_CREATE|os.O_WRONLY, 0600)
			if err == nil {
				f.Close()
				fail("ZERO_SCRATCH_WRITABLE")
			}
			if !errors.Is(err, unix.EROFS) {
				fail("ZERO_SCRATCH_WRONG_FAILURE")
			}
		} else {
			// Neither file reaches RLIMIT_FSIZE. Only aggregate tmpfs space
			// can reject the second file after the total reaches its size.
			each := scratch * 3 / 4
			var total uint64
			full := false
			for _, name := range []string{"a", "b"} {
				f, err := os.OpenFile("/scratch/"+name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
				if err != nil {
					fail("SCRATCH_CREATE")
				}
				var count uint64
				block := make([]byte, 4096)
				for count < each {
					nwant := each - count
					if nwant > uint64(len(block)) {
						nwant = uint64(len(block))
					}
					n, err := f.Write(block[:nwant])
					count += uint64(n)
					total += uint64(n)
					if err != nil {
						if !errors.Is(err, unix.ENOSPC) {
							f.Close()
							fail("SCRATCH_WRONG_FAILURE")
						}
						full = true
						break
					}
				}
				f.Close()
			}
			if !full || total != scratch {
				fail("SCRATCH_AGGREGATE_BOUND_FAILED")
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
