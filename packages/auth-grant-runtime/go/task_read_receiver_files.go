//go:build darwin || linux

package grantruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"syscall"
)

// Physical Root configuration only. This is not a Source/proof parser. Normal
// capture fixes uid=0; the private uid parameter is used only by PUBLIC tests.
type receiverDirectory struct {
	Path          string
	Device, Inode uint64
	UID, GID      uint32
	Mode          uint32
}
type receiverImage struct {
	Path   string
	Bytes  int64
	SHA256 string
}
type receiverFile struct {
	files            []heldFile
	raw              []byte
	ref              protectedRef
	directory        bool
	uid              uint32
	selected, closed []bool
	firstClose       error
}

func receiverSafe(info os.FileInfo, dir bool, uid uint32) bool {
	if info == nil || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0022 != 0 {
		return false
	}
	s, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	if dir {
		return info.IsDir() && (s.Uid == 0 || s.Uid == uid)
	}
	return info.Mode().IsRegular() && s.Uid == uid && s.Nlink == 1
}
func openReceiverFile(ref protectedRef, uid uint32, max int64, image bool) (h *receiverFile, err error) {
	h = &receiverFile{ref: ref, uid: uid}
	if !filepath.IsAbs(ref.Path) || filepath.Clean(ref.Path) != ref.Path || ref.Bytes < 1 || ref.Bytes > max || len(ref.SHA256) != 64 {
		return h, ErrUnavailable
	}
	if _, e := hex.DecodeString(ref.SHA256); e != nil {
		return h, ErrProof
	}
	paths := []string{ref.Path}
	for p := filepath.Dir(ref.Path); ; p = filepath.Dir(p) {
		paths = append(paths, p)
		if p == string(filepath.Separator) {
			break
		}
	}
	for i := len(paths) - 1; i >= 0; i-- {
		p := paths[i]
		dir := i != 0
		before, e := os.Lstat(p)
		if e != nil || !receiverSafe(before, dir, uid) {
			return h, ErrCurrent
		}
		fd, e := syscall.Open(p, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
		if e != nil {
			return h, e
		}
		f := os.NewFile(uintptr(fd), p)
		h.files = append(h.files, heldFile{f: f, path: p, info: before})
		h.selected = append(h.selected, false)
		h.closed = append(h.closed, false)
		after, e := f.Stat()
		if e != nil || !os.SameFile(before, after) || !receiverSafe(after, dir, uid) {
			return h, ErrCurrent
		}
		if !dir && image && after.Mode().Perm()&0111 == 0 {
			return h, ErrCurrent
		}
	}
	f := h.files[len(h.files)-1].f
	h.raw, err = io.ReadAll(io.LimitReader(f, ref.Bytes+1))
	if err != nil {
		return h, err
	}
	sum := sha256.Sum256(h.raw)
	if int64(len(h.raw)) != ref.Bytes || hex.EncodeToString(sum[:]) != ref.SHA256 {
		return h, ErrCurrent
	}
	return h, h.current()
}
func holdReceiverRegistration(d receiverDirectory, leaf string, uid uint32) (h *receiverFile, err error) {
	h = &receiverFile{uid: uid}
	if d.UID != uid || d.Mode&0022 != 0 || leaf == "" || leaf == "." || leaf == ".." || filepath.Base(leaf) != leaf || !filepath.IsAbs(d.Path) || filepath.Clean(d.Path) != d.Path {
		return h, ErrUnavailable
	}
	info, e := os.Lstat(d.Path)
	if e != nil || !receiverSafe(info, true, uid) {
		return h, ErrCurrent
	}
	st := info.Sys().(*syscall.Stat_t)
	if uint64(st.Dev) != d.Device || st.Ino != d.Inode || st.Uid != d.UID || st.Gid != d.GID || uint32(info.Mode().Perm()) != d.Mode {
		return h, ErrCurrent
	}
	// Hold all parents and the literal postbuild record before reading. The
	// postbuild image digest is NOT compiled into the image which it describes.
	p := filepath.Join(d.Path, leaf)
	var paths []string
	for x := d.Path; ; x = filepath.Dir(x) {
		paths = append(paths, x)
		if x == string(filepath.Separator) {
			break
		}
	}
	for i := len(paths) - 1; i >= 0; i-- {
		x := paths[i]
		before, e := os.Lstat(x)
		if e != nil || !receiverSafe(before, true, uid) {
			return h, ErrCurrent
		}
		fd, e := syscall.Open(x, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
		if e != nil {
			return h, e
		}
		f := os.NewFile(uintptr(fd), x)
		h.files = append(h.files, heldFile{f: f, path: x, info: before})
		h.selected = append(h.selected, false)
		h.closed = append(h.closed, false)
		after, e := f.Stat()
		if e != nil || !os.SameFile(before, after) {
			return h, ErrCurrent
		}
	}
	actualDir, e := h.files[len(h.files)-1].f.Stat()
	if e != nil {
		return h, e
	}
	ds := actualDir.Sys().(*syscall.Stat_t)
	if uint64(ds.Dev) != d.Device || ds.Ino != d.Inode || ds.Uid != d.UID || ds.Gid != d.GID || uint32(actualDir.Mode().Perm()) != d.Mode {
		return h, ErrCurrent
	}
	before, e := os.Lstat(p)
	if e != nil || !receiverSafe(before, false, uid) || before.Size() < 1 || before.Size() > 65536 {
		return h, ErrCurrent
	}
	fd, e := syscall.Open(p, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
	if e != nil {
		return h, e
	}
	f := os.NewFile(uintptr(fd), p)
	h.files = append(h.files, heldFile{f: f, path: p, info: before})
	h.selected = append(h.selected, false)
	h.closed = append(h.closed, false)
	after, e := f.Stat()
	if e != nil || !os.SameFile(before, after) || !receiverSafe(after, false, uid) {
		return h, ErrCurrent
	}
	h.raw, e = io.ReadAll(io.LimitReader(f, 65537))
	if e != nil {
		return h, e
	}
	if int64(len(h.raw)) != before.Size() {
		return h, ErrCurrent
	}
	h.ref = protectedRef{Path: p, Bytes: int64(len(h.raw)), SHA256: digest(h.raw)}
	return h, h.current()
}
func (h *receiverFile) current() error {
	if h == nil || len(h.files) == 0 || (!h.directory && len(h.raw) == 0) {
		return ErrUnavailable
	}
	for i, x := range h.files {
		if h.selected[i] || h.closed[i] {
			return ErrCurrent
		}
		dir := h.directory || i < len(h.files)-1
		named, e := os.Lstat(x.path)
		if e != nil || !receiverSameIdentity(named, x.info, dir) || !receiverSafe(named, dir, h.uid) {
			return ErrCurrent
		}
		fi, e := x.f.Stat()
		if e != nil || !receiverSameIdentity(fi, x.info, dir) || !receiverSafe(fi, dir, h.uid) {
			return ErrCurrent
		}
		if !dir && (fi.Size() != x.info.Size() || !fi.ModTime().Equal(x.info.ModTime())) {
			return ErrCurrent
		}
	}
	if h.directory {
		return nil
	}
	b := make([]byte, h.ref.Bytes+1)
	n, e := h.files[len(h.files)-1].f.ReadAt(b, 0)
	if e != nil && e != io.EOF {
		return e
	}
	if int64(n) != h.ref.Bytes || digest(b[:n]) != h.ref.SHA256 {
		return ErrCurrent
	}
	for i, x := range h.files {
		dir := i < len(h.files)-1
		named, e := os.Lstat(x.path)
		if e != nil || !receiverSameIdentity(named, x.info, dir) || !receiverSafe(named, dir, h.uid) {
			return ErrCurrent
		}
		after, e := x.f.Stat()
		if e != nil || !receiverSameIdentity(after, x.info, dir) || !receiverSafe(after, dir, h.uid) || !dir && (after.Size() != x.info.Size() || !after.ModTime().Equal(x.info.ModTime())) {
			return ErrCurrent
		}
	}
	return nil
}
func (h *receiverFile) close() error {
	if h == nil {
		return nil
	}
	for i := len(h.files) - 1; i >= 0; i-- {
		if h.closed[i] {
			continue
		}
		if h.selected[i] {
			if h.firstClose == nil {
				h.firstClose = ErrCurrent
			}
			return h.firstClose
		}
		h.selected[i] = true
		if e := h.files[i].f.Close(); e != nil {
			if h.firstClose == nil {
				h.firstClose = e
			}
			return h.firstClose
		}
		h.closed[i] = true
	}
	return h.firstClose
}
func (h *receiverFile) debt() bool {
	if h == nil {
		return false
	}
	for _, v := range h.closed {
		if !v {
			return true
		}
	}
	return false
}
func receiverSocketInfo(info os.FileInfo, uid uint32) error {
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSymlink != 0 || info.Mode()&os.ModeSocket == 0 || info.Mode().Perm() != 0600 || st.Uid != uid || st.Nlink != 1 {
		return ErrCurrent
	}
	return nil
}
func holdReceiverSocketDirectory(d receiverDirectory, uid uint32) (h *receiverFile, err error) {
	h = &receiverFile{uid: uid, directory: true}
	if !filepath.IsAbs(d.Path) || filepath.Clean(d.Path) != d.Path || d.UID != uid || d.Mode != 0700 {
		return h, ErrUnavailable
	}
	var paths []string
	for p := d.Path; ; p = filepath.Dir(p) {
		paths = append(paths, p)
		if p == string(filepath.Separator) {
			break
		}
	}
	for i := len(paths) - 1; i >= 0; i-- {
		p := paths[i]
		before, e := os.Lstat(p)
		if e != nil || !receiverSafe(before, true, uid) {
			return h, ErrCurrent
		}
		fd, e := syscall.Open(p, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC|syscall.O_NONBLOCK, 0)
		if e != nil {
			return h, e
		}
		f := os.NewFile(uintptr(fd), p)
		h.files = append(h.files, heldFile{f: f, path: p, info: before})
		h.selected = append(h.selected, false)
		h.closed = append(h.closed, false)
		after, e := f.Stat()
		if e != nil || !os.SameFile(before, after) {
			return h, ErrCurrent
		}
		if i == 0 {
			st := after.Sys().(*syscall.Stat_t)
			if uint64(st.Dev) != d.Device || st.Ino != d.Inode || st.Uid != d.UID || st.Gid != d.GID || uint32(after.Mode().Perm()) != d.Mode {
				return h, ErrCurrent
			}
		}
	}
	return h, h.current()
}

// These are SAME private original documents owned only by this receiver child.
// The old runtime/heldSource closure algorithms are not changed or reused for
// ambiguous-close policy. A failed selected FD is never closed again.
type receiverDocumentDrain struct {
	original         *heldDocument
	selected, closed []bool
	first            error
}

func newReceiverDocumentDrain(h *heldDocument) *receiverDocumentDrain {
	n := 0
	if h != nil {
		n = len(h.files)
	}
	return &receiverDocumentDrain{original: h, selected: make([]bool, n), closed: make([]bool, n)}
}
func (d *receiverDocumentDrain) close() error {
	if d == nil || d.original == nil {
		return nil
	}
	for i := len(d.original.files) - 1; i >= 0; i-- {
		if d.closed[i] {
			continue
		}
		if d.selected[i] {
			if d.first == nil {
				d.first = ErrCurrent
			}
			return d.first
		}
		d.selected[i] = true
		if e := d.original.files[i].f.Close(); e != nil {
			if d.first == nil {
				d.first = e
			}
			return d.first
		}
		d.closed[i] = true
	}
	return d.first
}
func receiverSameIdentity(a, b os.FileInfo, dir bool) bool {
	if a == nil || b == nil || !os.SameFile(a, b) || a.Mode() != b.Mode() {
		return false
	}
	x, ok := a.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	y, ok := b.Sys().(*syscall.Stat_t)
	if !ok || x.Uid != y.Uid || x.Gid != y.Gid {
		return false
	}
	return dir || x.Nlink == y.Nlink
}
