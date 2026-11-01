//go:build linux

package contribution

import (
	"os"
	"syscall"
)

// Wrapper wait4 can include reaped namespace-init descendants. Group usage is
// separately read from the exact cgroup; never add both as economic CPU work.
func measureProcess(s *os.ProcessState, c *OSControls, killed bool) *ProcessUsage {
	if s == nil {
		return nil
	}
	r, ok := s.SysUsage().(*syscall.Rusage)
	if !ok || r.Maxrss < 0 || uint64(r.Maxrss) > ^uint64(0)/1024 || s.UserTime() < 0 || s.SystemTime() < 0 {
		return nil
	}
	u := &ProcessUsage{Source: "linux-wait4-wrapper-rusage", UserMicros: uint64(s.UserTime().Microseconds()), SystemMicros: uint64(s.SystemTime().Microseconds()), PeakRSSBytes: uint64(r.Maxrss) * 1024, ExitCode: s.ExitCode(), Waited: true, HostKillRequested: killed, Controls: c}
	if status, ok := s.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		u.ExitSignal = status.Signal().String()
	}
	return u
}
