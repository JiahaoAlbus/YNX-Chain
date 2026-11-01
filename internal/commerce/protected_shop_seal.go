//go:build commerce_v2

package commerce

import (
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// The Shop-local browser cookie seal is exactly the existing constructor's
// 32 raw bytes. Loading it neither enrolls a backend nor supplies Source.Current.
// Keep this product operand separate from Auth's PKCS8 signing-key loader.
func loadOriginalShopBrowserSeal(path string) ([]byte, error) {
	reject := func() ([]byte, error) { return nil, ErrOriginalShopCompositionUnavailable }
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return reject()
	}
	parts := strings.Split(strings.TrimPrefix(path, string(filepath.Separator)), string(filepath.Separator))
	if len(parts) == 0 || parts[len(parts)-1] == "" {
		return reject()
	}
	dir, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return reject()
	}
	defer func() { unix.Close(dir) }()
	protectedDirectory := func(fd int) bool {
		var st unix.Stat_t
		return unix.Fstat(fd, &st) == nil && uint32(st.Mode)&unix.S_IFMT == unix.S_IFDIR && uint32(st.Mode)&0022 == 0 && (st.Uid == 0 || st.Uid == uint32(os.Getuid()))
	}
	for _, component := range parts[:len(parts)-1] {
		if !protectedDirectory(dir) {
			return reject()
		}
		next, e := unix.Openat(dir, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if e != nil {
			return reject()
		}
		unix.Close(dir)
		dir = next
	}
	if !protectedDirectory(dir) {
		return reject()
	}
	leaf := parts[len(parts)-1]
	fd, err := unix.Openat(dir, leaf, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return reject()
	}
	file := os.NewFile(uintptr(fd), "shop-browser-seal")
	defer file.Close()
	valid := func(st *unix.Stat_t) bool {
		return uint32(st.Mode)&unix.S_IFMT == unix.S_IFREG && uint32(st.Mode)&0777 == 0600 && st.Uid == uint32(os.Getuid()) && st.Nlink == 1 && st.Size == 32
	}
	var before, after, bound unix.Stat_t
	if unix.Fstat(fd, &before) != nil || !valid(&before) {
		return reject()
	}
	data, err := io.ReadAll(io.LimitReader(file, 33))
	if err != nil || len(data) != 32 || unix.Fstat(fd, &after) != nil || unix.Fstatat(dir, leaf, &bound, unix.AT_SYMLINK_NOFOLLOW) != nil || !valid(&after) || !valid(&bound) || before.Dev != after.Dev || before.Ino != after.Ino || before.Dev != bound.Dev || before.Ino != bound.Ino {
		clear(data)
		return reject()
	}
	return data, nil
}
