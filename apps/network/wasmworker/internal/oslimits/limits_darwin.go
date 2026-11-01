//go:build darwin

package oslimits

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"time"

	"golang.org/x/sys/unix"
)

var errLimits = errors.New("fixed worker OS limits unavailable")

// Apply runs before stdin/guest execution. Hard limits cannot be raised by
// this unprivileged fixed worker. CPU is a whole-second readback (not verified enforcement),
// not an unignorable CPU-share quota. FSIZE=0 blocks regular-file growth, not
// directory metadata allocation. No host RSS or complete disk quota is claimed.
func Apply(cpuMilli, durationMS uint64) (Report, func(), error) {
	var report Report
	if cpuMilli == 0 || cpuMilli > 1000 || durationMS == 0 || durationMS > 5000 || os.Geteuid() == 0 {
		return report, nil, errLimits
	}
	pipeMode := os.Getenv("YNX_NETWORK_OS_LIMITS")
	if pipeMode != "" && pipeMode != "1" {
		return report, nil, errLimits
	}
	parent := os.Getppid()
	challenge := ""
	if pipeMode == "1" {
		requested, err := strconv.Atoi(os.Getenv("YNX_NETWORK_PARENT_PID"))
		challenge = os.Getenv("YNX_NETWORK_LIMITS_CHALLENGE")
		decoded, e := hex.DecodeString(challenge)
		if err != nil || requested != parent || strconv.Itoa(requested) != os.Getenv("YNX_NETWORK_PARENT_PID") || e != nil || len(decoded) != 16 || hex.EncodeToString(decoded) != challenge {
			return report, nil, errLimits
		}
	}
	if parent <= 1 {
		return report, nil, errLimits
	}
	seconds := (cpuMilli*durationMS + 999999) / 1000000
	if seconds == 0 {
		seconds = 1
	}
	for _, limit := range []struct {
		resource int
		value    uint64
	}{{unix.RLIMIT_CORE, 0}, {unix.RLIMIT_FSIZE, 0}, {unix.RLIMIT_NOFILE, 32}, {unix.RLIMIT_NPROC, 0}, {unix.RLIMIT_CPU, seconds}} {
		var before, after unix.Rlimit
		if unix.Getrlimit(limit.resource, &before) != nil || before.Max < limit.value || unix.Setrlimit(limit.resource, &unix.Rlimit{Cur: limit.value, Max: limit.value}) != nil || unix.Getrlimit(limit.resource, &after) != nil || after.Cur != limit.value || after.Max != limit.value {
			return report, nil, errLimits
		}
	}
	report = Report{Version: Version, Platform: "darwin", CPUSeconds: strconv.FormatUint(seconds, 10), FileSizeBytes: "0", CoreBytes: "0", OpenFiles: "32", Processes: "0", ParentBound: true, Challenge: challenge}
	if pipeMode == "1" {
		file := os.NewFile(3, "worker-os-limits")
		if file == nil {
			return Report{}, nil, errLimits
		}
		info, err := file.Stat()
		if err != nil || info.Mode()&os.ModeNamedPipe == 0 {
			_ = file.Close()
			return Report{}, nil, errLimits
		}
		raw, err := json.Marshal(report)
		if err != nil {
			_ = file.Close()
			return Report{}, nil, errLimits
		}
		n, writeErr := file.Write(append(raw, '\n'))
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil || n != len(raw)+1 {
			return Report{}, nil, errLimits
		}
	}
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(10 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				if os.Getppid() != parent {
					os.Exit(125)
				}
			}
		}
	}()
	return report, func() { close(stop) }, nil
}
