//go:build unix

package consensus

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

// ApplicationStateWriterLease fences the two production CLI entry points. A
// separate ABCI server and the in-process node cannot write the same state.
// Copies share one lock lifetime. Closing never removes any state or lock file.
type ApplicationStateWriterLease struct{ core *applicationWriterCore }
type applicationWriterCore struct {
	mu   sync.Mutex
	file *os.File
}

func AcquireApplicationStateWriterLease(path string) (*ApplicationStateWriterLease, error) {
	if path == "" {
		return nil, errors.New("durable application path is required for writer lease")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	parent, err := filepath.EvalSymlinks(filepath.Dir(abs))
	if err != nil {
		return nil, err
	}
	lockPath := filepath.Join(parent, filepath.Base(abs)+".writer.lock")
	fd, err := unix.Open(lockPath, unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0o600)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), "application-writer-lease")
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	var stat unix.Stat_t
	if err := unix.Fstat(fd, &stat); err != nil {
		file.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0o600 || stat.Nlink != 1 {
		file.Close()
		return nil, errors.New("application writer lease must be a private, single-link regular file")
	}
	if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("application state already has a writer or cannot be exclusively locked")
	}
	return &ApplicationStateWriterLease{core: &applicationWriterCore{file: file}}, nil
}

func (lease *ApplicationStateWriterLease) Close() error {
	if lease == nil || lease.core == nil {
		return nil
	}
	core := lease.core
	core.mu.Lock()
	defer core.mu.Unlock()
	if core.file == nil {
		return nil
	}
	file := core.file
	core.file = nil
	return errors.Join(unix.Flock(int(file.Fd()), unix.LOCK_UN), file.Close())
}
