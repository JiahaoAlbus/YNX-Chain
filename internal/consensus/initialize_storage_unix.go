//go:build linux || darwin

package consensus

import "golang.org/x/sys/unix"

func measureInitializationStorage(parent string) (initializationStorage, error) {
	var fs unix.Statfs_t
	if err := unix.Statfs(parent, &fs); err != nil {
		return initializationStorage{}, err
	}
	return initializationStorage{
		blockSize:       initializationAllocationUnit(fs),
		availableBlocks: uint64(fs.Bavail),
		availableInodes: uint64(fs.Ffree),
		reportsInodes:   fs.Files != 0,
	}, nil
}
