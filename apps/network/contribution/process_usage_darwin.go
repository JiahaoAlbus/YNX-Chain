//go:build darwin

package contribution

import (
	"os"
	"syscall"
)

// XNU calcru supplies resident_size_max directly in bytes. CPU times come from
// this exact child's wait4, never cumulative RUSAGE_CHILDREN or guest counters.
func measureProcess(state *os.ProcessState, controls *OSControls, kill bool) *ProcessUsage {
	if state == nil {
		return nil
	}
	r, ok := state.SysUsage().(*syscall.Rusage)
	if !ok || r.Maxrss < 0 || state.UserTime() < 0 || state.SystemTime() < 0 {
		return nil
	}
	u := &ProcessUsage{Source: "darwin-wait4-rusage", UserMicros: uint64(state.UserTime().Microseconds()), SystemMicros: uint64(state.SystemTime().Microseconds()), PeakRSSBytes: uint64(r.Maxrss), ExitCode: state.ExitCode(), Waited: true, HostKillRequested: kill, Controls: controls}
	if status, ok := state.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		u.ExitSignal = status.Signal().String()
	}
	return u
}
