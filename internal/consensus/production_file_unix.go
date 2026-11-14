//go:build unix

package consensus

import (
	"errors"
	"os"
	"reflect"
	"strconv"

	"golang.org/x/sys/unix"
)

const productionPackageHeldStreaming = true

// Match the two Unix ABI spellings used by the existing proof source ctime
// helper. A read may update atime; neither modification nor change time may move.
func productionPackageModificationStamp(stat unix.Stat_t) (string, error) {
	v := reflect.ValueOf(stat)
	for _, name := range []string{"Mtim", "Mtimespec"} {
		s := v.FieldByName(name)
		if s.IsValid() && s.Kind() == reflect.Struct {
			sec, nsec := s.FieldByName("Sec"), s.FieldByName("Nsec")
			if sec.IsValid() && nsec.IsValid() && sec.CanInt() && nsec.CanInt() {
				return strconv.FormatInt(sec.Int(), 10) + ":" + strconv.FormatInt(nsec.Int(), 10), nil
			}
		}
	}
	return "", errors.New("production package modification identity unavailable")
}

func openProductionPackageFile(path string) (*os.File, func() error, error) {
	var before unix.Stat_t
	if err := unix.Lstat(path, &before); err != nil {
		return nil, nil, err
	}
	return openProductionPackageFileAfterStat(path, before)
}

// Keeping this private post-stat boundary explicit lets tests replace the leaf
// with a real FIFO or symlink at precisely the race boundary, without injecting
// a production opener or weakening the normal syscall path.
func openProductionPackageFileAfterStat(path string, before unix.Stat_t) (*os.File, func() error, error) {
	if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Nlink != 1 || before.Size < 0 {
		return nil, nil, errors.New("production package input must be a single-link regular file without a symlink")
	}
	changed, err := proofHostChangeStamp(before)
	if err != nil {
		return nil, nil, err
	}
	modified, err := productionPackageModificationStamp(before)
	if err != nil {
		return nil, nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, nil, err
	}
	f := os.NewFile(uintptr(fd), "production-package-public-input")
	check := func() error {
		var opened, current unix.Stat_t
		if unix.Fstat(fd, &opened) != nil || unix.Lstat(path, &current) != nil {
			return errors.New("production package file changed during complete read")
		}
		for _, stat := range []unix.Stat_t{opened, current} {
			if stat.Dev != before.Dev || stat.Ino != before.Ino || stat.Mode != before.Mode ||
				stat.Nlink != before.Nlink || stat.Uid != before.Uid || stat.Gid != before.Gid || stat.Size != before.Size {
				return errors.New("production package file changed during complete read")
			}
			c, cErr := proofHostChangeStamp(stat)
			m, mErr := productionPackageModificationStamp(stat)
			if cErr != nil || mErr != nil || c != changed || m != modified {
				return errors.New("production package file changed during complete read")
			}
		}
		return nil
	}
	if err := check(); err != nil {
		return nil, nil, errors.Join(err, f.Close())
	}
	return f, check, nil
}
