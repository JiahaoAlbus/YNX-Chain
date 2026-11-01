//go:build linux && !amd64

package contribution

func linuxForkSyscalls() []int { return nil }
