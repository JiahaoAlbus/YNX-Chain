package cloud

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"

	"golang.org/x/sys/unix"
)

// Hold the exact staged inode across create/start. Labels and a read-only
// container mount alone do not verify host bytes or a replaced pathname.
type ideStagedArtifact struct {
	file     *os.File
	path     string
	info     os.FileInfo
	dir      os.FileInfo
	binding  IDEArtifactBinding
	verified *unix.Stat_t
}

func openIDEStagedArtifact(path string, binding IDEArtifactBinding) (*ideStagedArtifact, error) {
	if binding.ByteSize < 1 || binding.ByteSize > MaxMultipartBytes {
		return nil, ErrIDEArtifactInput
	}
	dir, err := os.Lstat(filepath.Dir(path))
	if err != nil || !dir.IsDir() || dir.Mode()&os.ModeSymlink != 0 || dir.Mode().Perm()&0077 != 0 {
		return nil, errors.Join(ErrIDEArtifactInput, err)
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, errors.Join(ErrIDEArtifactInput, err)
	}
	f := os.NewFile(uintptr(fd), "ide-approved-staged-artifact")
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0444 || info.Size() != binding.ByteSize {
		return nil, errors.Join(ErrIDEArtifactInput, err, f.Close())
	}
	return &ideStagedArtifact{file: f, path: path, info: info, dir: dir, binding: binding}, nil
}

func (a *ideStagedArtifact) verify() error {
	info, err := a.file.Stat()
	named, namedErr := os.Lstat(a.path)
	dir, dirErr := os.Lstat(filepath.Dir(a.path))
	var stat unix.Stat_t
	if err != nil || namedErr != nil || dirErr != nil || unix.Fstat(int(a.file.Fd()), &stat) != nil || stat.Nlink != 1 || !os.SameFile(a.info, info) || !os.SameFile(info, named) || !os.SameFile(a.dir, dir) || !info.Mode().IsRegular() || info.Mode().Perm() != 0444 || dir.Mode().Perm()&0077 != 0 || info.Size() != a.binding.ByteSize || !info.ModTime().Equal(a.info.ModTime()) {
		return errors.Join(ErrIDEArtifactInput, err, namedErr, dirErr)
	}
	h := sha256.New()
	n, err := io.Copy(h, io.NewSectionReader(a.file, 0, a.binding.ByteSize+1))
	if err != nil || n != a.binding.ByteSize || hex.EncodeToString(h.Sum(nil)) != a.binding.ContentDigest {
		return errors.Join(ErrIDEArtifactInput, err)
	}
	after, afterErr := a.file.Stat()
	last, lastErr := os.Lstat(a.path)
	if afterErr != nil || lastErr != nil || !os.SameFile(info, last) || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) {
		return errors.Join(ErrIDEArtifactInput, afterErr, lastErr)
	}
	var verified unix.Stat_t
	if err := unix.Fstat(int(a.file.Fd()), &verified); err != nil {
		return errors.Join(ErrIDEArtifactInput, err)
	}
	a.verified = &verified
	return nil
}

// Recheck metadata after the potentially asynchronous authority call, without
// another long digest pass. Comparing the kernel snapshot includes ctime and
// therefore rejects rewrites even if a callback restores the earlier mtime.
func (a *ideStagedArtifact) assertVerifiedIdentity() error {
	var current unix.Stat_t
	statErr := unix.Fstat(int(a.file.Fd()), &current)
	named, namedErr := os.Lstat(a.path)
	dir, dirErr := os.Lstat(filepath.Dir(a.path))
	if a.verified == nil || statErr != nil || namedErr != nil || dirErr != nil || !reflect.DeepEqual(*a.verified, current) || !os.SameFile(a.info, named) || !os.SameFile(a.dir, dir) || dir.Mode().Perm()&0077 != 0 {
		return errors.Join(ErrIDEArtifactInput, statErr, namedErr, dirErr)
	}
	return nil
}
