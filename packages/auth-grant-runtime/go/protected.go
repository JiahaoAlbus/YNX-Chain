//go:build darwin || linux

package grantruntime

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

var ErrUnavailable = errors.New("GRANT_PROTECTED_SOURCE_NOT_SUPPLIED")
var ErrCurrent = errors.New("GRANT_PROTECTED_CURRENT_CHANGED")
var ErrProof = errors.New("GRANT_ORIGINAL_PROOF_INVALID")
var ErrRetired = errors.New("GRANT_RUNTIME_RETIRED")

// Private release-selected ref. Not a request DTO, public setter or new DB.
type protectedRef struct {
	Path, SHA256 string
	Bytes        int64
}
type heldFile struct {
	f    *os.File
	path string
	info os.FileInfo
}
type heldDocument struct {
	files    []heldFile
	ref      protectedRef
	raw      []byte
	once     sync.Once
	closeErr error
}

func digest(b []byte) string { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }
func safeInfo(i os.FileInfo, dir bool) bool {
	if i == nil || i.Mode()&os.ModeSymlink != 0 || i.Mode().Perm()&0022 != 0 {
		return false
	}
	s, ok := i.Sys().(*syscall.Stat_t)
	if !ok {
		return false
	}
	if dir {
		return i.IsDir() && (s.Uid == 0 || s.Uid == uint32(os.Geteuid()))
	}
	return i.Mode().IsRegular() && s.Uid == uint32(os.Geteuid()) && s.Nlink == 1 && i.Mode().Perm()&0077 == 0
}

// Every opened FD transfers in h even on error. No hidden lost partial owner.
func holdDocument(r protectedRef) (h *heldDocument, err error) {
	h = &heldDocument{ref: r}
	if !filepath.IsAbs(r.Path) || filepath.Clean(r.Path) != r.Path || r.Bytes < 1 || r.Bytes > 1<<20 || len(r.SHA256) != 64 {
		return h, ErrUnavailable
	}
	paths := []string{r.Path}
	for p := filepath.Dir(r.Path); ; p = filepath.Dir(p) {
		paths = append(paths, p)
		if p == string(filepath.Separator) {
			break
		}
	}
	for i := len(paths) - 1; i >= 0; i-- {
		p := paths[i]
		dir := i != 0
		before, e := os.Lstat(p)
		if e != nil || !safeInfo(before, dir) {
			return h, ErrCurrent
		}
		fd, e := syscall.Open(p, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0)
		if e != nil {
			return h, e
		}
		f := os.NewFile(uintptr(fd), p)
		h.files = append(h.files, heldFile{f: f, path: p, info: before})
		after, e := f.Stat()
		if e != nil || !os.SameFile(before, after) || !safeInfo(after, dir) {
			return h, ErrCurrent
		}
	}
	f := h.files[len(h.files)-1].f
	h.raw, err = io.ReadAll(io.LimitReader(f, r.Bytes+1))
	if err != nil {
		return h, err
	}
	if int64(len(h.raw)) != r.Bytes || digest(h.raw) != r.SHA256 {
		return h, ErrCurrent
	}
	return h, h.current()
}
func (h *heldDocument) current() error {
	if h == nil || len(h.files) == 0 {
		return ErrUnavailable
	}
	for i, x := range h.files {
		named, e := os.Lstat(x.path)
		if e != nil || !os.SameFile(named, x.info) || !safeInfo(named, i < len(h.files)-1) {
			return ErrCurrent
		}
		fi, e := x.f.Stat()
		if e != nil || !os.SameFile(fi, x.info) || !safeInfo(fi, i < len(h.files)-1) {
			return ErrCurrent
		}
		if i == len(h.files)-1 && (fi.ModTime() != x.info.ModTime() || fi.Size() != x.info.Size()) {
			return ErrCurrent
		}
	}
	b := make([]byte, h.ref.Bytes+1)
	n, e := h.files[len(h.files)-1].f.ReadAt(b, 0)
	if e != nil && e != io.EOF {
		return e
	}
	if int64(n) != h.ref.Bytes || digest(b[:n]) != h.ref.SHA256 {
		return ErrCurrent
	}
	return nil
}
func (h *heldDocument) close() error {
	if h == nil {
		return nil
	}
	h.once.Do(func() {
		for i := len(h.files) - 1; i >= 0; i-- {
			h.closeErr = errors.Join(h.closeErr, h.files[i].f.Close())
		}
	})
	return h.closeErr
}
func decodePrivate(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		return e
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return ErrProof
	}
	b, e := json.Marshal(out)
	if e != nil || !bytes.Equal(raw, b) {
		return ErrProof
	}
	return nil
}
