//go:build unix

package consensus

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestProductionPackageFileRejectsRestoredMtime(t *testing.T) {
	path := filepath.Join(t.TempDir(), "public")
	original := bytes.Repeat([]byte("PUBLIC"), 1024)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	var stat unix.Stat_t
	if err := unix.Lstat(path, &stat); err != nil {
		t.Fatal(err)
	}
	stamp, err := proofHostChangeStamp(stat)
	if err != nil {
		t.Fatal(err)
	}
	err = readProductionPackageFile(path, func(r io.Reader) error {
		if _, err := io.Copy(io.Discard, r); err != nil {
			return err
		}
		f, err := os.OpenFile(path, os.O_WRONLY, 0600)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.WriteAt([]byte("X"), 0); err != nil {
			t.Fatal(err)
		}
		if err := f.Close(); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, before.ModTime(), before.ModTime()); err != nil {
			t.Fatal(err)
		}
		after, err := os.Stat(path)
		if err != nil || !os.SameFile(before, after) || before.Size() != after.Size() || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) {
			t.Fatal("counterexample did not preserve the original checked metadata", err)
		}
		if err := unix.Lstat(path, &stat); err != nil {
			t.Fatal(err)
		}
		changed, err := proofHostChangeStamp(stat)
		if err != nil || changed == stamp {
			t.Fatal("counterexample did not change kernel ctime", err)
		}
		return nil
	})
	if err == nil {
		t.Fatal("same-inode same-size modified bytes with restored mtime were accepted")
	}
	retained, err := os.ReadFile(path)
	if err != nil || retained[0] != 'X' || !bytes.Equal(retained[1:], original[1:]) {
		t.Fatal("rejected evidence was modified", err)
	}
}

func TestProductionPackageFilePostStatReplacementNeverBlocks(t *testing.T) {
	for _, kind := range []string{"fifo", "symlink", "regular", "directory"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "public")
			if err := os.WriteFile(path, []byte("PUBLIC"), 0600); err != nil {
				t.Fatal(err)
			}
			var before unix.Stat_t
			if err := unix.Lstat(path, &before); err != nil {
				t.Fatal(err)
			}
			if err := os.Rename(path, path+".original"); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "fifo":
				if err := unix.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
			case "symlink":
				if err := os.Symlink(path+".original", path); err != nil {
					t.Fatal(err)
				}
			case "regular":
				if err := os.WriteFile(path, []byte("PUBLIC"), 0600); err != nil {
					t.Fatal(err)
				}
			case "directory":
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			done := make(chan error, 1)
			go func() {
				f, _, err := openProductionPackageFileAfterStat(path, before)
				if f != nil {
					err = errors.Join(err, f.Close())
				}
				done <- err
			}()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("post-stat replacement accepted")
				}
			case <-time.After(2 * time.Second):
				// Only a regression's blocked FIFO open needs this writer to reap
				// its goroutine. It is test cleanup, never the production path.
				if kind == "fifo" {
					if fd, err := unix.Open(path, unix.O_WRONLY|unix.O_NONBLOCK|unix.O_CLOEXEC, 0); err == nil {
						_ = unix.Close(fd)
					}
				}
				select {
				case <-done:
				case <-time.After(time.Second):
				}
				t.Fatal("post-stat replacement blocked the normal package opener")
			}
			retained, err := os.ReadFile(path + ".original")
			if err != nil || string(retained) != "PUBLIC" {
				t.Fatal("rejected original evidence changed", err)
			}
		})
	}
}

func TestProductionPackageFileModesLinksAndCloseFirstCause(t *testing.T) {
	for _, mode := range []os.FileMode{0600, 0644, 0755} {
		t.Run(fmt.Sprintf("normal-%o", mode), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "empty-public")
			if err := os.WriteFile(path, nil, mode); err != nil {
				t.Fatal(err)
			}
			if err := os.Chmod(path, mode); err != nil {
				t.Fatal(err)
			}
			f, check, err := openProductionPackageFile(path)
			if err != nil {
				t.Fatal(err)
			}
			// File.Fd may switch a pollable descriptor to blocking mode. Inspect
			// through RawConn without modifying the actual opener's flags.
			conn, err := f.SyscallConn()
			if err != nil {
				t.Fatal(err)
			}
			var flags, fdflags int
			var flagErr, fdFlagErr error
			if err := conn.Control(func(fd uintptr) {
				flags, flagErr = unix.FcntlInt(fd, unix.F_GETFL, 0)
				fdflags, fdFlagErr = unix.FcntlInt(fd, unix.F_GETFD, 0)
			}); err != nil {
				t.Fatal(err)
			}
			if flagErr != nil || flags&unix.O_NONBLOCK == 0 {
				t.Fatal("held descriptor lost NONBLOCK", flagErr)
			}
			if fdFlagErr != nil || fdflags&unix.FD_CLOEXEC == 0 {
				t.Fatal("held descriptor lost CLOEXEC", fdFlagErr)
			}
			if err := check(); err != nil {
				t.Fatal(err)
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
			hash, err := hashProductionPackageFile(path)
			if err != nil || hash != productionOperatorSHA(nil) {
				t.Fatal("valid empty public input rejected", err)
			}
		})
	}
	t.Run("hardlink", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "public")
		if err := os.WriteFile(path, []byte("PUBLIC"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Link(path, path+".alias"); err != nil {
			t.Fatal(err)
		}
		if _, err := hashProductionPackageFile(path); err == nil {
			t.Fatal("multiple mutable names accepted")
		}
	})
	t.Run("first-cause-and-close-error", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "public")
		if err := os.WriteFile(path, []byte("PUBLIC"), 0600); err != nil {
			t.Fatal(err)
		}
		cause := errors.New("test-only original consumer failure")
		err := readProductionPackageFile(path, func(r io.Reader) error {
			f, ok := r.(*os.File)
			if !ok {
				t.Fatal("normal descriptor not retained")
			}
			if err := f.Close(); err != nil {
				t.Fatal(err)
			}
			return cause
		})
		if !errors.Is(err, cause) || !errors.Is(err, os.ErrClosed) {
			t.Fatal("first cause or physical close failure lost", err)
		}
	})
	t.Run("new-link-during-read", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "public")
		if err := os.WriteFile(path, []byte("PUBLIC"), 0600); err != nil {
			t.Fatal(err)
		}
		err := readProductionPackageFile(path, func(r io.Reader) error {
			if _, err := io.Copy(io.Discard, r); err != nil {
				return err
			}
			return os.Link(path, path+".alias")
		})
		if err == nil {
			t.Fatal("new alias during held read accepted")
		}
	})
}
