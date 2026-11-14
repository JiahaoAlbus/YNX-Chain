//go:build darwin

package ownednode

import "syscall"

func managerLockCtime(s *syscall.Stat_t) syscall.Timespec { return s.Ctimespec }
