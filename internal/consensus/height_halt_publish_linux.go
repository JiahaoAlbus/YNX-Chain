//go:build linux

package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

func publishHeightHaltRequestPlatform(raw []byte, options HeightHaltPublicationOptions, result HeightHaltPublicationResult, hooks *heightHaltPublicationHooks) (_ HeightHaltPublicationResult, err error) {
	parent := filepath.Dir(options.ApplicationStatePath)
	directory, err := openHeightHaltPublicationDirectory(parent)
	if err != nil {
		return HeightHaltPublicationResult{}, err
	}
	defer func() { err = errors.Join(err, directory.Close()) }()
	dirFD := int(directory.Fd())
	var originalParent unix.Stat_t
	if err := unix.Fstat(dirFD, &originalParent); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if !privateHeightHaltPublicationStat(originalParent, true) {
		return HeightHaltPublicationResult{}, errors.New("height halt publication requires the same uid's original private 0700 application parent")
	}
	checkParent := func() error {
		resolved, err := filepath.EvalSymlinks(parent)
		if err != nil || resolved != parent {
			return errors.New("height halt application parent acquired a symlink or disappeared")
		}
		var current unix.Stat_t
		if err := unix.Lstat(parent, &current); err != nil {
			return err
		}
		if !privateHeightHaltPublicationStat(current, true) || !sameHeightHaltPublicationIdentity(originalParent, current) {
			return errors.New("height halt original application parent identity or permissions changed")
		}
		var application unix.Stat_t
		if err := unix.Fstatat(dirFD, filepath.Base(options.ApplicationStatePath), &application, unix.AT_SYMLINK_NOFOLLOW); err != nil {
			return err
		}
		if !privateHeightHaltPublicationStat(application, false) || application.Size < 1 {
			return errors.New("height halt requires the original same-uid private regular single-link application state")
		}
		return nil
	}
	if err := checkParent(); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	target := filepath.Base(options.Control.Path)
	staging := target + ".partial"
	checkAbsent := func(names ...string) error {
		for _, name := range names {
			var existing unix.Stat_t
			if err := unix.Fstatat(dirFD, name, &existing, unix.AT_SYMLINK_NOFOLLOW); !errors.Is(err, unix.ENOENT) {
				if err != nil {
					return err
				}
				return errors.New("height halt request, partial or UNKNOWN material already exists; preserve it without retry")
			}
		}
		return nil
	}
	if err := checkAbsent(target, staging, target+".UNKNOWN", target+".tmp"); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	fd, err := unix.Openat(dirFD, staging, unix.O_RDWR|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0o600)
	if err != nil {
		return HeightHaltPublicationResult{}, err
	}
	file := os.NewFile(uintptr(fd), filepath.Join(parent, staging))
	defer func() { err = errors.Join(err, file.Close()) }()
	// No failure path unlinks this staging file, the request or original state.
	if err := file.Chmod(0o600); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	var originalFile unix.Stat_t
	if err := unix.Fstat(fd, &originalFile); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if !privateHeightHaltPublicationStat(originalFile, false) {
		return HeightHaltPublicationResult{}, errors.New("exclusive height halt staging file has an unexpected identity")
	}
	write := (*os.File).Write
	if hooks != nil && hooks.write != nil {
		write = hooks.write
	}
	n, err := write(file, raw)
	if err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if n != len(raw) {
		return HeightHaltPublicationResult{}, io.ErrShortWrite
	}
	syncFile, syncDirectory := (*os.File).Sync, (*os.File).Sync
	if hooks != nil && hooks.syncFile != nil {
		syncFile = hooks.syncFile
	}
	if hooks != nil && hooks.syncDirectory != nil {
		syncDirectory = hooks.syncDirectory
	}
	if err := syncFile(file); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	// Make the retained partial durable before the publication boundary too.
	if err := syncDirectory(directory); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkParent(); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkAbsent(target, target+".UNKNOWN", target+".tmp"); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkHeightHaltPublishedFile(dirFD, staging, fd, originalFile, raw); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if hooks != nil && hooks.beforeRename != nil {
		if err := hooks.beforeRename(); err != nil {
			return HeightHaltPublicationResult{}, err
		}
	}
	if err := checkParent(); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkHeightHaltPublishedFile(dirFD, staging, fd, originalFile, raw); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkAbsent(target+".UNKNOWN", target+".tmp"); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	// This is the only publication primitive. No link/copy/overwrite fallback
	// is valid, including on ENOSYS or an unsupported filesystem.
	if err := unix.Renameat2(dirFD, staging, dirFD, target, unix.RENAME_NOREPLACE); err != nil {
		return HeightHaltPublicationResult{}, fmt.Errorf("exclusive atomic height halt publication refused; retain partial: %w", err)
	}
	if hooks != nil && hooks.afterRename != nil {
		if err := hooks.afterRename(); err != nil {
			return HeightHaltPublicationResult{}, err
		}
	}
	if err := syncDirectory(directory); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkParent(); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkHeightHaltPublishedFile(dirFD, target, fd, originalFile, raw); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	if err := checkAbsent(staging, target+".UNKNOWN", target+".tmp"); err != nil {
		return HeightHaltPublicationResult{}, err
	}
	result.Published = true
	return result, nil
}

// Walk with directory fds so no ancestor symlink can redirect a write. The
// original final parent's identity is additionally checked around publication.
func openHeightHaltPublicationDirectory(path string) (*os.File, error) {
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	for _, component := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if component == "" {
			continue
		}
		next, err := unix.Openat(fd, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		closeErr := unix.Close(fd)
		if err != nil {
			return nil, errors.Join(err, closeErr)
		}
		if closeErr != nil {
			_ = unix.Close(next)
			return nil, closeErr
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), path), nil
}

func privateHeightHaltPublicationStat(stat unix.Stat_t, directory bool) bool {
	if stat.Uid != uint32(os.Geteuid()) || stat.Mode&(unix.S_ISUID|unix.S_ISGID|unix.S_ISVTX) != 0 {
		return false
	}
	if directory {
		return stat.Mode&unix.S_IFMT == unix.S_IFDIR && stat.Mode&0o777 == 0o700
	}
	return stat.Mode&unix.S_IFMT == unix.S_IFREG && stat.Mode&0o777 == 0o600 && stat.Nlink == 1
}

func sameHeightHaltPublicationIdentity(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Mode == b.Mode && a.Uid == b.Uid && a.Gid == b.Gid
}

func checkHeightHaltPublishedFile(dirFD int, name string, fileFD int, original unix.Stat_t, expected []byte) error {
	var opened, named unix.Stat_t
	if err := unix.Fstat(fileFD, &opened); err != nil {
		return err
	}
	if err := unix.Fstatat(dirFD, name, &named, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	if !privateHeightHaltPublicationStat(opened, false) || !privateHeightHaltPublicationStat(named, false) ||
		!sameHeightHaltPublicationIdentity(original, opened) || !sameHeightHaltPublicationIdentity(opened, named) || opened.Size != int64(len(expected)) || named.Size != opened.Size {
		return errors.New("height halt request identity, permissions or link count changed")
	}
	actual := make([]byte, len(expected)+1)
	n, err := unix.Pread(fileFD, actual, 0)
	if err != nil || !bytes.Equal(actual[:n], expected) {
		return errors.New("height halt request bytes changed before publication completed")
	}
	return nil
}
