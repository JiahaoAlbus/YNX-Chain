package binaryhttpsource

import (
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"strings"
)

// Same actual uid0/current and non-group/world-writable ancestor rule as
// original_source_process.go, now enforced with retained parent-relative FDs.
// It never changes ancestor permissions, follows a parent symlink or mkdirs.
type directoryPart struct {
	fd          int
	name        string
	original    unix.Stat_t
	closeCalled bool
	closeError  error
}
type secureDirectory struct {
	parts []*directoryPart
	path  string
}

func secureDirMode(s *unix.Stat_t, leaf bool) bool {
	return s.Mode&unix.S_IFMT == unix.S_IFDIR && (s.Uid == 0 || s.Uid == uint32(os.Geteuid())) && s.Mode&0022 == 0 && (!leaf || (s.Uid == uint32(os.Geteuid()) && s.Mode&0777 == 0700))
}
func sameNode(a, b *unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Uid == b.Uid && a.Gid == b.Gid && a.Mode == b.Mode && a.Nlink == b.Nlink
}

// APFS directory nlink changes when our regular children are created. It is
// not directory identity; regular body/journal still require Nlink==1. Keep
// dev/inode/uid/gid/mode and each retained parent-relative binding exact.
func sameDirectoryNode(a, b *unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Uid == b.Uid && a.Gid == b.Gid && a.Mode == b.Mode
}
func openDirectory(p string) (*secureDirectory, error) {
	d := &secureDirectory{path: p}
	if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == "/" || strings.ContainsAny(p, "\x00\\\r\n") {
		return d, errDirectory
	}
	fd, e := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if e != nil {
		return d, e
	}
	top := &directoryPart{fd: fd}
	d.parts = append(d.parts, top)
	if e = unix.Fstat(fd, &top.original); e != nil || !secureDirMode(&top.original, false) {
		if e != nil {
			return d, e
		}
		return d, errDirectory
	}
	names := strings.Split(strings.TrimPrefix(p, "/"), "/")
	for i, name := range names {
		if name == "" || name == "." || name == ".." {
			return d, errDirectory
		}
		parent := d.parts[len(d.parts)-1]
		fd, e = unix.Openat(parent.fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if e != nil {
			return d, e
		}
		part := &directoryPart{fd: fd, name: name}
		d.parts = append(d.parts, part)
		if e = unix.Fstat(fd, &part.original); e != nil {
			return d, e
		}
		if !secureDirMode(&part.original, i == len(names)-1) {
			return d, errDirectory
		}
	}
	return d, d.current()
}
func (d *secureDirectory) leaf() int {
	if d == nil || len(d.parts) == 0 {
		return -1
	}
	return d.parts[len(d.parts)-1].fd
}
func (d *secureDirectory) current() error {
	if d == nil || len(d.parts) == 0 {
		return errDirectory
	}
	for i, p := range d.parts {
		if p.closeCalled || p.fd < 0 {
			return errDirectory
		}
		var actual unix.Stat_t
		if e := unix.Fstat(p.fd, &actual); e != nil {
			return e
		}
		if !sameDirectoryNode(&actual, &p.original) || !secureDirMode(&actual, i == len(d.parts)-1) {
			return errDirectory
		}
		if i > 0 {
			var named unix.Stat_t
			if e := unix.Fstatat(d.parts[i-1].fd, p.name, &named, unix.AT_SYMLINK_NOFOLLOW); e != nil {
				return e
			}
			if !sameDirectoryNode(&named, &actual) {
				return errDirectory
			}
		}
	}
	return nil
}
func (d *secureDirectory) close() error {
	if d == nil {
		return nil
	}
	for i := len(d.parts) - 1; i >= 0; i-- {
		p := d.parts[i]
		if p.closeCalled {
			if p.closeError != nil {
				return p.closeError
			}
			continue
		}
		p.closeCalled = true
		fd := p.fd
		p.fd = -1
		p.closeError = unix.Close(fd)
		if p.closeError != nil {
			return p.closeError
		}
	}
	return nil
}

type heldFile struct {
	file       *os.File
	name       string
	original   unix.Stat_t
	closed     bool
	closeError error
}

func unixFsync(fd int) error { return unix.Fsync(fd) }
func openOwned(d *secureDirectory, name string, create bool) (*heldFile, error) {
	h := &heldFile{name: name}
	if d == nil || strings.ContainsAny(name, "/\\\x00") || name == "" || name == "." || name == ".." {
		return h, errDirectory
	}
	if e := d.current(); e != nil {
		return h, e
	}
	flags := unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_CLOEXEC
	if create {
		flags = unix.O_RDWR | unix.O_CREAT | unix.O_EXCL | unix.O_NOFOLLOW | unix.O_CLOEXEC
	}
	fd, e := unix.Openat(d.leaf(), name, flags, 0600)
	if e != nil {
		return h, e
	}
	h.file = os.NewFile(uintptr(fd), name)
	if e = unix.Fstat(fd, &h.original); e != nil {
		return h, e
	}
	if h.original.Mode&unix.S_IFMT != unix.S_IFREG || h.original.Mode&0777 != 0600 || h.original.Uid != uint32(os.Geteuid()) || h.original.Nlink != 1 {
		return h, errDirectory
	}
	return h, h.current(d)
}
func (h *heldFile) current(d *secureDirectory) error {
	if h == nil || h.file == nil || h.closed {
		return errChanged
	}
	if e := d.current(); e != nil {
		return e
	}
	var held, named unix.Stat_t
	if e := unix.Fstat(int(h.file.Fd()), &held); e != nil {
		return e
	}
	if e := unix.Fstatat(d.leaf(), h.name, &named, unix.AT_SYMLINK_NOFOLLOW); e != nil {
		return e
	}
	if !sameNode(&held, &h.original) || !sameNode(&named, &held) || held.Size != h.original.Size || !sameFileTimes(&held, &h.original) {
		return errChanged
	}
	return nil
}
func (h *heldFile) close() error {
	if h == nil {
		return nil
	}
	if h.closed {
		return h.closeError
	}
	h.closed = true
	if h.file != nil {
		h.closeError = h.file.Close()
	}
	return h.closeError
}
