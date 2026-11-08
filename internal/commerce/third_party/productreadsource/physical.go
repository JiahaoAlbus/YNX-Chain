//go:build darwin || linux

package productreadsource

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type originalFile struct {
	file          *os.File
	path          string
	id            os.FileInfo
	digest        string
	limit         int64
	raw           []byte
	closed        bool
	closeCalled   bool
	closeReturned bool
	closeDone     bool
	closeUnknown  bool
	first         error
	uid           uint32
	mode          uint32
	nlink         uint64
	ctime         unix.Timespec
	gid           uint32
}
type originalFiles struct {
	files         []*originalFile
	dirs          []*originalDirectory
	uid           uint32
	first         error
	closeSelected bool
	closeReturned bool
}
type originalDirectory struct {
	file          *os.File
	path          string
	id            os.FileInfo
	closed        bool
	closeCalled   bool
	closeReturned bool
	closeDone     bool
	closeUnknown  bool
	first         error
	uid           uint32
	mode          uint32
}

func (f *originalFiles) directory(parent *originalDirectory, name, path string) (*originalDirectory, error) {
	if f == nil || f.closeSelected {
		return nil, ErrRetired
	}
	for _, d := range f.dirs {
		if d.path == path {
			if e := d.current(); e != nil {
				return nil, e
			}
			return d, nil
		}
	}
	var fd int
	var e error
	if parent == nil {
		fd, e = unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	} else {
		fd, e = unix.Openat(int(parent.file.Fd()), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	}
	if e != nil {
		return nil, e
	}
	d := &originalDirectory{file: os.NewFile(uintptr(fd), path), path: path}
	f.dirs = append(f.dirs, d)
	var st unix.Stat_t
	if unix.Fstat(fd, &st) != nil || st.Mode&0022 != 0 || (st.Uid != 0 && st.Uid != f.uid) {
		return nil, ErrDenied
	}
	d.uid = st.Uid
	d.mode = uint32(st.Mode)
	d.id, e = d.file.Stat()
	if e != nil || !d.id.IsDir() {
		return nil, ErrDenied
	}
	if e = d.current(); e != nil {
		return nil, e
	}
	return d, nil
}
func (d *originalDirectory) current() error {
	if d == nil || d.closed || d.id == nil {
		return ErrRetired
	}
	var st unix.Stat_t
	if unix.Fstat(int(d.file.Fd()), &st) != nil || st.Uid != d.uid || uint32(st.Mode) != d.mode {
		return ErrDenied
	}
	a, e := d.file.Stat()
	b, e2 := os.Lstat(d.path)
	if e != nil || e2 != nil || !a.IsDir() || b.Mode()&os.ModeSymlink != 0 || !os.SameFile(d.id, a) || !os.SameFile(a, b) {
		return ErrDenied
	}
	return nil
}

func same(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Size() == b.Size() && a.Mode() == b.Mode() && a.ModTime() == b.ModTime()
}
func (f *originalFiles) hold(path, digest string, limit int64) ([]byte, error) {
	if f == nil || f.closeSelected {
		return nil, ErrRetired
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || !network.MatchString(digest) || limit < 1 || limit > 256<<20 {
		return nil, ErrDenied
	}
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	dir, e := f.directory(nil, "", "/")
	if e != nil {
		return nil, e
	}
	current := "/"
	for _, part := range parts[:len(parts)-1] {
		current = filepath.Join(current, part)
		dir, e = f.directory(dir, part, current)
		if e != nil {
			return nil, e
		}
	}
	leaf, e := unix.Openat(int(dir.file.Fd()), parts[len(parts)-1], unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	file := os.NewFile(uintptr(leaf), path)
	h := &originalFile{file: file, path: path, digest: digest, limit: limit}
	f.files = append(f.files, h) // adopt before any metadata/error
	st, e := file.Stat()
	if e != nil {
		return nil, e
	}
	var sys unix.Stat_t
	if unix.Fstat(leaf, &sys) != nil || !st.Mode().IsRegular() || st.Size() < 1 || st.Size() > limit || st.Mode().Perm()&0022 != 0 || (sys.Uid != 0 && sys.Uid != f.uid) {
		return nil, ErrDenied
	}
	h.id = st
	h.uid = sys.Uid
	h.mode = uint32(sys.Mode)
	h.nlink = uint64(sys.Nlink)
	h.ctime = sys.Ctim
	h.gid = sys.Gid
	raw, e := io.ReadAll(io.LimitReader(file, limit+1))
	if e != nil || int64(len(raw)) != st.Size() {
		return nil, ErrDenied
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != digest {
		return nil, ErrDenied
	}
	if e = h.current(); e != nil {
		return nil, e
	}
	h.raw = bytes.Clone(raw)
	return bytes.Clone(raw), nil
}
func (h *originalFile) current() error {
	if h == nil || h.closed || h.file == nil || h.id == nil {
		return ErrRetired
	}
	var sys unix.Stat_t
	if unix.Fstat(int(h.file.Fd()), &sys) != nil || sys.Uid != h.uid || sys.Gid != h.gid || sys.Ctim != h.ctime || uint32(sys.Mode) != h.mode || uint64(sys.Nlink) != h.nlink {
		return ErrDenied
	}
	a, e := h.file.Stat()
	if e != nil || !same(h.id, a) {
		return ErrDenied
	}
	named, e := os.Lstat(h.path)
	if e != nil || named.Mode()&os.ModeSymlink != 0 || !same(a, named) {
		return ErrDenied
	}
	for p := filepath.Dir(h.path); ; p = filepath.Dir(p) {
		st, e := os.Lstat(p)
		if e != nil || !st.IsDir() || st.Mode()&os.ModeSymlink != 0 || st.Mode().Perm()&0022 != 0 {
			return ErrDenied
		}
		if p == "/" {
			break
		}
	}
	if _, e = h.file.Seek(0, 0); e != nil {
		return e
	}
	raw, e := io.ReadAll(io.LimitReader(h.file, h.limit+1))
	if e != nil || int64(len(raw)) != h.id.Size() {
		return ErrDenied
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != h.digest {
		return ErrDenied
	}
	after, e := h.file.Stat()
	named, e2 := os.Lstat(h.path)
	if e != nil || e2 != nil || !same(after, h.id) || !same(after, named) {
		return ErrDenied
	}
	return nil
}
func (f *originalFiles) current() error {
	if f == nil {
		return ErrNotSupplied
	}
	if f.first != nil {
		return f.first
	}
	for _, d := range f.dirs {
		if e := d.current(); e != nil {
			f.first = e
			return e
		}
	}
	for _, h := range f.files {
		if e := h.current(); e != nil {
			f.first = e
			return e
		}
	}
	return nil
}
func (f *originalFiles) close() error {
	if f == nil {
		return nil
	}
	if f.closeSelected {
		return f.first
	}
	f.closeSelected = true
	for i := len(f.files) - 1; i >= 0; i-- {
		h := f.files[i]
		if e := h.closeOriginal(); e != nil && f.first == nil {
			f.first = e
		}
	}
	for i := len(f.dirs) - 1; i >= 0; i-- {
		d := f.dirs[i]
		if e := d.closeOriginal(); e != nil && f.first == nil {
			f.first = e
		}
	}
	f.closeReturned = true
	return f.first
}

// Only the original owned os.File is eligible, and a previously identified
// numeric FD must still name the SAME object before the sole close call.
func closeIdentityCurrent(file *os.File, original os.FileInfo) error {
	if file == nil {
		return ErrUnknown
	}
	if original != nil {
		now, e := file.Stat()
		if e != nil {
			return e
		}
		if !os.SameFile(now, original) {
			return ErrDenied
		}
	}
	return nil
}
func (h *originalFile) closeOriginal() error {
	if h == nil {
		return ErrUnknown
	}
	if h.closed {
		return h.first
	}
	h.closed = true
	if e := closeIdentityCurrent(h.file, h.id); e != nil {
		h.closeUnknown = true
		if h.first == nil {
			h.first = errors.Join(ErrUnknown, e)
		}
		return h.first
	}
	h.closeCalled = true
	e := closeOriginalOwnedFD(h.file)
	h.closeReturned = true
	if e != nil {
		h.closeUnknown = true
		if h.first == nil {
			h.first = e
		}
	} else {
		h.closeDone = true
	}
	return h.first
}
func (d *originalDirectory) closeOriginal() error {
	if d == nil {
		return ErrUnknown
	}
	if d.closed {
		return d.first
	}
	d.closed = true
	if e := closeIdentityCurrent(d.file, d.id); e != nil {
		d.closeUnknown = true
		if d.first == nil {
			d.first = errors.Join(ErrUnknown, e)
		}
		return d.first
	}
	d.closeCalled = true
	e := closeOriginalOwnedFD(d.file)
	d.closeReturned = true
	if e != nil {
		d.closeUnknown = true
		if d.first == nil {
			d.first = e
		}
	} else {
		d.closeDone = true
	}
	return d.first
}
func originalFDClosed(selected, called, returned, done, unknown bool) error {
	if unknown {
		return ErrUnknown
	}
	if !selected || !called || !returned {
		return ErrPending
	}
	if !done {
		return ErrUnknown
	}
	return nil
}

// Pure mechanical observations only. The owning Authority mutex protects
// these fields; no filesystem/current call or close is performed here.
func (f *originalFiles) assertOriginalClosed() error {
	if f == nil {
		return ErrDenied
	}
	if !f.closeSelected || !f.closeReturned {
		return ErrPending
	}
	for _, h := range f.files {
		if h == nil {
			return ErrUnknown
		}
		if e := originalFDClosed(h.closed, h.closeCalled, h.closeReturned, h.closeDone, h.closeUnknown); e != nil {
			return e
		}
	}
	for _, d := range f.dirs {
		if d == nil {
			return ErrUnknown
		}
		if e := originalFDClosed(d.closed, d.closeCalled, d.closeReturned, d.closeDone, d.closeUnknown); e != nil {
			return e
		}
	}
	return nil
}
