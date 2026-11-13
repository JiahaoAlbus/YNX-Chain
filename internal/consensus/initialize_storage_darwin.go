package consensus

import "golang.org/x/sys/unix"

func initializationAllocationUnit(fs unix.Statfs_t) uint64 {
	return uint64(fs.Bsize)
}
