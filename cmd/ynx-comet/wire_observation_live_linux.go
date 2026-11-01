//go:build linux

package main

import (
	"bytes"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

func validateOperatorWireLivePath(path string) error {
	if !utf8.ValidString(path) || len(path) > 4096 || strings.ContainsRune(path, 0) || strings.TrimSpace(path) != path || !filepath.IsAbs(path) || filepath.Clean(path) != path || filepath.Dir(path) == path {
		return errors.New("canonical absolute private live control directory required")
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil || resolved != path {
		return errors.New("live control directory must exist without symlink aliases")
	}
	var stat unix.Stat_t
	if err := unix.Lstat(path, &stat); err != nil {
		return err
	}
	if stat.Mode != unix.S_IFDIR|0700 || stat.Uid != uint32(os.Geteuid()) {
		return errors.New("same-user 0700 live control directory without special bits required")
	}
	return nil
}

func openOperatorWireLiveDirectory(path string, fresh bool) (root *os.Root, dir *os.File, parent os.FileInfo, result error) {
	if err := validateOperatorWireLivePath(path); err != nil {
		return nil, nil, nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, nil, nil, err
	}
	dir = os.NewFile(uintptr(fd), path)
	defer func() {
		if result != nil {
			if root != nil {
				_ = root.Close()
			}
			_ = dir.Close()
		}
	}()
	root, err = os.OpenRoot(path)
	if err != nil {
		return nil, dir, nil, err
	}
	parent, err = os.Lstat(path)
	if err != nil {
		return root, dir, nil, err
	}
	if err = currentOperatorWireLiveDirectory(path, root, dir, parent); err != nil {
		return root, dir, parent, err
	}
	if fresh {
		names, e := dir.Readdirnames(1)
		if len(names) != 0 || e != io.EOF {
			return root, dir, parent, errors.New("fresh empty live control directory required; preserve prior UNKNOWN")
		}
	}
	return root, dir, parent, nil
}

func currentOperatorWireLiveDirectory(path string, root *os.Root, dir *os.File, original os.FileInfo) error {
	if err := validateOperatorWireLivePath(path); err != nil {
		return err
	}
	current, e := os.Lstat(path)
	held, h := dir.Stat()
	view, r := root.Stat(".")
	if e != nil || h != nil || r != nil || !os.SameFile(original, current) || !os.SameFile(original, held) || !os.SameFile(original, view) {
		return errors.New("original live control directory changed; UNKNOWN")
	}
	return nil
}

func operatorWireLiveProcessIdentity() (operatorWireLiveIdentity, error) {
	// There is intentionally no caller-selected PID or /proc path.
	f, err := os.Open("/proc/self/stat")
	if err != nil {
		return operatorWireLiveIdentity{}, err
	}
	defer f.Close()
	raw, err := io.ReadAll(io.LimitReader(f, 4097))
	if err != nil || len(raw) > 4096 {
		return operatorWireLiveIdentity{}, errors.New("bounded original /proc/self/stat unavailable")
	}
	return decodeOperatorWireLiveIdentity(raw, uint64(os.Getpid()))
}

func decodeOperatorWireLiveIdentity(raw []byte, ownPID uint64) (operatorWireLiveIdentity, error) {
	// comm may contain spaces and ')' characters. The final delimiter precedes
	// field 3; starttime is field 22, hence index 19 in the remaining fields.
	open := bytes.IndexByte(raw, '(')
	end := bytes.LastIndex(raw, []byte(") "))
	if open < 2 || end < open {
		return operatorWireLiveIdentity{}, errors.New("invalid original proc identity")
	}
	pidText := string(raw[:open-1])
	pid, err := strconv.ParseUint(pidText, 10, 64)
	fields := strings.Fields(string(raw[end+2:]))
	if err != nil || pid == 0 || pid != ownPID || strconv.FormatUint(pid, 10) != pidText || len(fields) < 20 {
		return operatorWireLiveIdentity{}, errors.New("invalid original proc PID/start identity")
	}
	start, err := strconv.ParseUint(fields[19], 10, 64)
	if err != nil || start == 0 || strconv.FormatUint(start, 10) != fields[19] {
		return operatorWireLiveIdentity{}, errors.New("invalid original proc startTicks")
	}
	return operatorWireLiveIdentity{PID: pid, StartTicks: fields[19]}, nil
}

func operatorWireLiveMonotonic() (uint64, error) {
	var ts unix.Timespec
	if err := unix.ClockGettime(unix.CLOCK_MONOTONIC, &ts); err != nil {
		return 0, err
	}
	if ts.Sec < 0 || ts.Nsec < 0 || ts.Nsec >= 1_000_000_000 || uint64(ts.Sec) > (math.MaxUint64-uint64(ts.Nsec))/1_000_000_000 {
		return 0, errors.New("kernel CLOCK_MONOTONIC unavailable or overflow")
	}
	n := uint64(ts.Sec)*1_000_000_000 + uint64(ts.Nsec)
	if n == 0 {
		return 0, errors.New("kernel CLOCK_MONOTONIC zero is not an observation")
	}
	return n, nil
}

func operatorWireLiveFileStat(f *os.File) (unix.Stat_t, error) {
	var s unix.Stat_t
	if err := unix.Fstat(int(f.Fd()), &s); err != nil {
		return s, err
	}
	if s.Mode != unix.S_IFREG|0600 || s.Nlink != 1 || s.Uid != uint32(os.Geteuid()) {
		return s, errors.New("original single-link same-user 0600 live control file required")
	}
	return s, nil
}

func readOperatorWireLiveFile(root *os.Root, name string, limit int64) ([]byte, error) {
	if filepath.Base(name) != name || name == "." || limit <= 0 {
		return nil, errors.New("invalid bounded live file read")
	}
	f, err := root.OpenFile(name, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	before, err := operatorWireLiveFileStat(f)
	if err != nil {
		return nil, err
	}
	if before.Size <= 0 || before.Size > limit {
		return nil, errors.New("live file length outside fixed bound")
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	after, err := operatorWireLiveFileStat(f)
	if err != nil {
		return nil, err
	}
	info, e := f.Stat()
	current, c := root.Lstat(name)
	// Reading may legitimately update atime; it cannot change source identity,
	// content metadata, owner, mode or link count.
	if before.Dev != after.Dev || before.Ino != after.Ino || before.Mode != after.Mode || before.Uid != after.Uid || before.Nlink != after.Nlink || before.Size != after.Size || before.Mtim != after.Mtim || before.Ctim != after.Ctim || int64(len(raw)) != before.Size || e != nil || c != nil || !os.SameFile(info, current) {
		return nil, errors.New("original live file changed during read; UNKNOWN")
	}
	return raw, nil
}

func writeOperatorWireLiveFile(root *os.Root, dir *os.File, name string, raw []byte) (result error) {
	if filepath.Base(name) != name || name == "." || len(raw) == 0 || len(raw) > operatorWireLiveLimit {
		return errors.New("invalid bounded live output")
	}
	if _, e := root.Lstat(name); !errors.Is(e, os.ErrNotExist) {
		return errors.New("live output exists or is unknown; never overwrite")
	}
	partial := name + ".partial"
	f, err := root.OpenFile(partial, os.O_RDWR|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer func() { result = errors.Join(result, f.Close()) }()
	if _, err = operatorWireLiveFileStat(f); err != nil {
		return err
	}
	n, err := f.Write(raw)
	if err != nil {
		return err
	}
	if n != len(raw) {
		return io.ErrShortWrite
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = verifyWireObservationFile(root, partial, f, raw); err != nil {
		return err
	}
	// Both roots must still name the same original directory. No fallback
	// rename overwrites an earlier result. Failed/partial outputs are retained.
	r, h := root.Stat(".")
	d, e := dir.Stat()
	if h != nil || e != nil || !os.SameFile(r, d) {
		return errors.New("live output directory identity changed")
	}
	if err = unix.Renameat2(int(dir.Fd()), partial, int(dir.Fd()), name, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	if err = dir.Sync(); err != nil {
		return err
	}
	return verifyWireObservationFile(root, name, f, raw)
}

func publishOperatorWireLiveRequest(root *os.Root, dir *os.File, name string, raw []byte) error {
	return writeOperatorWireLiveFile(root, dir, name, raw)
}
