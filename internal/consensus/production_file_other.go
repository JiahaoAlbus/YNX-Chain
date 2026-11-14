//go:build !unix

package consensus

import (
	"errors"
	"os"
)

const productionPackageHeldStreaming = false

// Preserve the pre-existing reader on other platforms. The Unix descriptor and
// change-time guarantees are not claimed by this compatibility implementation.
func openProductionPackageFile(path string) (*os.File, func() error, error) {
	before, err := os.Lstat(path)
	if err != nil {
		return nil, nil, err
	}
	if !before.Mode().IsRegular() {
		return nil, nil, errors.New("production package input must be a regular file without a symlink")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	check := func() error {
		opened, openErr := f.Stat()
		current, pathErr := os.Lstat(path)
		same := func(info os.FileInfo) bool {
			return info != nil && info.Mode() == before.Mode() && os.SameFile(before, info) &&
				info.Size() == before.Size() && info.ModTime().Equal(before.ModTime())
		}
		if openErr != nil || pathErr != nil || !same(opened) || !same(current) {
			return errors.New("production package file changed during complete read")
		}
		return nil
	}
	if err := check(); err != nil {
		return nil, nil, errors.Join(err, f.Close())
	}
	return f, check, nil
}
