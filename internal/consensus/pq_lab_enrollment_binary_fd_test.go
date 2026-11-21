//go:build unix

package consensus

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"golang.org/x/sys/unix"
)

const syntheticCLIMaxBytes = 512 << 20

type syntheticCLICopyHooks struct {
	space              func(string, uint64) error
	writer             func(io.Writer) io.Writer
	afterCopy          func() error
	sourceBeforeClose  func(*os.File) error
	outputBeforeClose  func(*os.File) error
	readbackBeforeStat func(*os.File) error
	directorySync      func(*os.File) error
}

// Source and target are test-only synthetic DATA; the caller must separately
// bind the inherited binary/hash to its independent build receipt. A failure
// leaves the original marker and any partial output untouched and never signs.
func copySyntheticCLIFromFD(root, fdText, expected string, identity *os.FileInfo, hooks *syntheticCLICopyHooks) (resultErr error) {
	fd, err := strconv.Atoi(fdText)
	if err != nil || fd < 3 || fd > 4096 || strconv.Itoa(fd) != fdText || fdText == os.Getenv("YNX_PQ_ENROLLMENT_CREDENTIAL_FD") || fdText == os.Getenv("YNX_PQ_ENROLLMENT_RESERVATION_FD") || !enrollmentReserveID(expected) || identity == nil {
		return errors.New("distinct original synthetic CLI descriptor and independent hash required")
	}
	dup, err := unix.Dup(fd)
	if err != nil {
		return err
	}
	unix.CloseOnExec(dup)
	src := os.NewFile(uintptr(dup), "original-synthetic-cli")
	defer func() {
		if hooks != nil && hooks.sourceBeforeClose != nil {
			resultErr = errors.Join(resultErr, hooks.sourceBeforeClose(src))
		}
		resultErr = errors.Join(resultErr, src.Close())
	}()
	before, err := src.Stat()
	var original unix.Stat_t
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm()&0022 != 0 || before.Size() <= 0 || before.Size() > syntheticCLIMaxBytes || unix.Fstat(dup, &original) != nil || original.Nlink != 1 || original.Uid != uint32(os.Getuid()) {
		return errors.New("bounded original private-owner synthetic CLI binary required")
	}
	required := uint64(before.Size()) + (1 << 30) + (425 << 20) + (1 << 20)
	if hooks != nil && hooks.space != nil {
		err = hooks.space(root, required)
	} else {
		err = syntheticCLISpace(root, required)
	}
	if err != nil {
		return err
	}
	path := filepath.Join(root, "synthetic-ynx-consensus-pq-lab")
	outFD, err := unix.Open(path, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0700)
	if err != nil {
		return err
	}
	out := os.NewFile(uintptr(outFD), "retained-synthetic-cli")
	closed := false
	defer func() {
		if !closed {
			resultErr = errors.Join(resultErr, out.Close())
		}
	}()
	var sink io.Writer = out
	if hooks != nil && hooks.writer != nil {
		sink = hooks.writer(out)
	}
	h := sha256.New()
	n, err := io.CopyBuffer(io.MultiWriter(sink, h), io.NewSectionReader(src, 0, before.Size()+1), make([]byte, 128<<10))
	if err != nil {
		return err
	}
	if n != before.Size() || hex.EncodeToString(h.Sum(nil)) != expected {
		return errors.New("original synthetic CLI bytes or independent hash differ")
	}
	if hooks != nil && hooks.afterCopy != nil {
		if err = hooks.afterCopy(); err != nil {
			return err
		}
	}
	after, err := src.Stat()
	var current unix.Stat_t
	if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) || unix.Fstat(dup, &current) != nil || current.Dev != original.Dev || current.Ino != original.Ino || current.Nlink != 1 || current.Uid != original.Uid {
		return errors.New("original synthetic CLI identity changed during copy")
	}
	if err = out.Sync(); err != nil {
		return err
	}
	created, err := out.Stat()
	if err != nil {
		return err
	}
	readFD, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	read := os.NewFile(uintptr(readFD), "retained-synthetic-cli-readback")
	if hooks != nil && hooks.readbackBeforeStat != nil {
		if err = hooks.readbackBeforeStat(read); err != nil {
			return errors.Join(err, read.Close())
		}
	}
	actual, err := read.Stat()
	if err != nil || !os.SameFile(created, actual) || actual.Size() != before.Size() || actual.Mode().Perm() != 0700 {
		return errors.Join(errors.New("retained synthetic CLI identity differs"), err, read.Close())
	}
	h2 := sha256.New()
	readN, readErr := io.Copy(h2, io.LimitReader(read, before.Size()+1))
	readErr = errors.Join(readErr, read.Close())
	if readErr != nil {
		return readErr
	}
	if readN != before.Size() || hex.EncodeToString(h2.Sum(nil)) != expected {
		return errors.New("retained synthetic CLI readback differs")
	}
	if hooks != nil && hooks.outputBeforeClose != nil {
		err = hooks.outputBeforeClose(out)
	}
	err = errors.Join(err, out.Close())
	closed = true
	if err != nil {
		return err
	}
	var directorySync func(*os.File) error
	if hooks != nil {
		directorySync = hooks.directorySync
	}
	if err = pqLabSyncOriginalDirectory(root, directorySync); err != nil {
		return err
	}
	*identity = created
	return nil
}

func verifySyntheticCLIPath(root, expected string, identity os.FileInfo) (resultErr error) {
	if !enrollmentReserveID(expected) || identity == nil {
		return errors.New("independent synthetic CLI hash and original identity required")
	}
	path := filepath.Join(root, "synthetic-ynx-consensus-pq-lab")
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || !os.SameFile(identity, before) || identity.Mode() != before.Mode() || identity.Size() != before.Size() || !identity.ModTime().Equal(before.ModTime()) || before.Mode().Perm() != 0700 || before.Size() <= 0 || before.Size() > syntheticCLIMaxBytes {
		return errors.New("original retained synthetic CLI unavailable")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	f := os.NewFile(uintptr(fd), "retained-synthetic-cli-verification")
	defer func() { resultErr = errors.Join(resultErr, f.Close()) }()
	opened, err := f.Stat()
	var id unix.Stat_t
	if err != nil || !os.SameFile(before, opened) || unix.Fstat(fd, &id) != nil || id.Nlink != 1 || id.Uid != uint32(os.Getuid()) {
		return errors.New("retained synthetic CLI identity changed")
	}
	h := sha256.New()
	n, err := io.Copy(h, io.LimitReader(f, before.Size()+1))
	if err != nil {
		return err
	}
	after, e := f.Stat()
	current, e2 := os.Lstat(path)
	if e != nil || e2 != nil || !os.SameFile(before, after) || !os.SameFile(before, current) || before.Size() != after.Size() || before.Size() != current.Size() || before.Mode() != after.Mode() || before.Mode() != current.Mode() || !before.ModTime().Equal(after.ModTime()) || !before.ModTime().Equal(current.ModTime()) || n != before.Size() || hex.EncodeToString(h.Sum(nil)) != expected {
		return errors.New("retained synthetic CLI bytes or identity changed")
	}
	return nil
}

func syntheticCLISpace(root string, required uint64) error {
	var stat unix.Statfs_t
	if err := unix.Statfs(root, &stat); err != nil {
		return err
	}
	block := uint64(stat.Bsize)
	if block == 0 || required/block > uint64(stat.Bavail) || required%block != 0 && required/block >= uint64(stat.Bavail) {
		return errors.New("insufficient space for retained synthetic CLI")
	}
	return nil
}

type syntheticPartialWriter struct{ out io.Writer }

func (w syntheticPartialWriter) Write(p []byte) (int, error) {
	if len(p) > 2 {
		p = p[:2]
	}
	n, err := w.out.Write(p)
	if err != nil {
		return n, err
	}
	return n, unix.ENOSPC
}

func TestSyntheticEnrollmentCLIBinaryFDControls(t *testing.T) {
	for _, mode := range []string{"accept", "wrong-hash", "duplicate-credential", "duplicate-socket", "invalid-fd", "non-regular-fd", "low-space", "partial-write", "source-changed", "source-close", "output-close", "readback-close", "directory-sync"} {
		t.Run(mode, func(t *testing.T) {
			base := pqLabWorkloadTemp(t)
			root := filepath.Join(base, "output")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			sourcePath := filepath.Join(base, "original-cli")
			raw := []byte("independently pinned synthetic CLI bytes")
			if err := os.WriteFile(sourcePath, raw, 0700); err != nil {
				t.Fatal(err)
			}
			source, err := os.Open(sourcePath)
			if err != nil {
				t.Fatal(err)
			}
			defer source.Close()
			fd := strconv.Itoa(int(source.Fd()))
			t.Setenv("YNX_PQ_ENROLLMENT_CREDENTIAL_FD", "")
			t.Setenv("YNX_PQ_ENROLLMENT_RESERVATION_FD", "")
			pin := pqLabSHA(raw)
			hooks := new(syntheticCLICopyHooks)
			switch mode {
			case "wrong-hash":
				pin = pqLabSHA([]byte("other"))
			case "duplicate-credential":
				t.Setenv("YNX_PQ_ENROLLMENT_CREDENTIAL_FD", fd)
			case "duplicate-socket":
				t.Setenv("YNX_PQ_ENROLLMENT_RESERVATION_FD", fd)
			case "invalid-fd":
				fd = "-1"
			case "non-regular-fd":
				reader, writer, e := os.Pipe()
				if e != nil {
					t.Fatal(e)
				}
				defer reader.Close()
				defer writer.Close()
				fd = strconv.Itoa(int(reader.Fd()))
			case "low-space":
				hooks.space = func(string, uint64) error { return unix.ENOSPC }
			case "partial-write":
				hooks.writer = func(w io.Writer) io.Writer { return syntheticPartialWriter{out: w} }
			case "source-changed":
				hooks.afterCopy = func() error { return os.Chmod(sourcePath, 0600) }
			case "source-close":
				hooks.sourceBeforeClose = func(f *os.File) error { return f.Close() }
			case "output-close":
				hooks.outputBeforeClose = func(f *os.File) error { return f.Close() }
			case "readback-close":
				hooks.readbackBeforeStat = func(f *os.File) error { return f.Close() }
			case "directory-sync":
				hooks.directorySync = func(*os.File) error { return unix.EIO }
			}
			var identity os.FileInfo
			err = copySyntheticCLIFromFD(root, fd, pin, &identity, hooks)
			if (err == nil) != (mode == "accept") {
				t.Fatalf("unexpected copy result: %v", err)
			}
			path := filepath.Join(root, "synthetic-ynx-consensus-pq-lab")
			if mode == "accept" {
				got, e := os.ReadFile(path)
				if e != nil || string(got) != string(raw) {
					t.Fatal("binary readback differs", e)
				}
				if e = verifySyntheticCLIPath(root, pin, identity); e != nil {
					t.Fatal(e)
				}
				if copySyntheticCLIFromFD(root, fd, pin, &identity, hooks) == nil {
					t.Fatal("existing output replaced")
				}
				replacement := filepath.Join(base, "replacement")
				if e = os.WriteFile(replacement, raw, 0700); e != nil {
					t.Fatal(e)
				}
				if e = os.Rename(replacement, path); e != nil {
					t.Fatal(e)
				}
				if verifySyntheticCLIPath(root, pin, identity) == nil {
					t.Fatal("same-bytes replacement accepted")
				}
			}
			if mode == "partial-write" {
				info, e := os.Stat(path)
				if e != nil || info.Size() != 2 || !errors.Is(err, unix.ENOSPC) {
					t.Fatal("original partial output/first cause lost", e, err)
				}
			}
			if mode == "low-space" {
				if _, e := os.Lstat(path); !os.IsNotExist(e) {
					t.Fatal("low space wrote output", e)
				}
				if !errors.Is(err, unix.ENOSPC) {
					t.Fatal("space first cause lost", err)
				}
			}
			if mode == "source-close" || mode == "output-close" || mode == "readback-close" {
				if !errors.Is(err, os.ErrClosed) {
					t.Fatal("close error was lost", err)
				}
			}
			if mode == "directory-sync" && !errors.Is(err, unix.EIO) {
				t.Fatal("directory sync first cause lost", err)
			}
		})
	}
}
