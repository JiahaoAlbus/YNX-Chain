//go:build linux

package main

import (
	"fmt"
	"os"
	"runtime"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

type commitMonotonicClock struct{ source, boot, namespace, reason string }

func currentTimeNamespace() (string, error) {
	var stat syscall.Stat_t
	if err := syscall.Stat("/proc/thread-self/ns/time", &stat); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d", stat.Dev, stat.Ino), nil
}
func newCommitMonotonicClock(source string) commitMonotonicClock {
	c := commitMonotonicClock{source: source}
	if source == "" {
		c.reason = "synthetic build source declaration unavailable"
		return c
	}
	boot, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		c.reason = "kernel boot identity unavailable"
		return c
	}
	c.boot = strings.TrimSpace(string(boot))
	if len(c.boot) != 36 {
		c.reason = "kernel boot identity malformed"
		return c
	}
	c.namespace, err = currentTimeNamespace()
	if err != nil {
		c.reason = "kernel time namespace unavailable"
	}
	return c
}
func (c commitMonotonicClock) read() commitMonotonicReading {
	if c.reason != "" {
		return commitMonotonicReading{Reason: c.reason}
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	var ts unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &ts); err != nil {
		return commitMonotonicReading{Reason: "CLOCK_MONOTONIC unavailable"}
	}
	namespace, err := currentTimeNamespace()
	if err != nil || namespace != c.namespace || ts.Sec < 0 || ts.Nsec < 0 || ts.Nsec >= 1000000000 || ts.Sec > 9223372036 || (ts.Sec == 9223372036 && ts.Nsec > 854775807) {
		return commitMonotonicReading{Reason: "clock or time namespace changed"}
	}
	return commitMonotonicReading{NS: fmt.Sprintf("%d", ts.Sec*1000000000+ts.Nsec)}
}
