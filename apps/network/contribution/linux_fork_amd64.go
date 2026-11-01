//go:build linux && amd64

package contribution

import "golang.org/x/sys/unix"

func linuxForkSyscalls() []int { return []int{unix.SYS_FORK, unix.SYS_VFORK} }
