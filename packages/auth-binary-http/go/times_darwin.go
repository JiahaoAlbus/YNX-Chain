//go:build darwin

package binaryhttpsource

import "golang.org/x/sys/unix"

func sameFileTimes(a, b *unix.Stat_t) bool {
	return a.Mtim == b.Mtim && a.Ctim == b.Ctim
}
