package productsessionv2

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
)

// LoadBackendEd25519PrivateKey reads only a protected backend PKCS8 key file.
// It does not register a client or select a product tuple. Callers keep an empty
// paired key ID/file configuration disabled and reject partial configuration.
// No underlying error or path is returned to logs or clients.
func LoadBackendEd25519PrivateKey(path string) (ed25519.PrivateKey, error) {
	reject := func() (ed25519.PrivateKey, error) { return nil, fail("INVALID_BACKEND_KEY_CONFIG", 500) }
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
	// Walk via bound directory descriptors, never a privileged pathname read
	// through a replaceable or symlink ancestor. Only root/current UID may own
	// ancestors, and neither group nor other may replace their entries.
	for _, component := range parts[:len(parts)-1] {
		if !protectedBackendDirectory(dir) {
			return reject()
		}
		next, e := unix.Openat(dir, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if e != nil {
			return reject()
		}
		unix.Close(dir)
		dir = next
	}
	if !protectedBackendDirectory(dir) {
		return reject()
	}
	leaf := parts[len(parts)-1]
	fd, err := unix.Openat(dir, leaf, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return reject()
	}
	file := os.NewFile(uintptr(fd), "backend-key")
	defer file.Close()
	var before unix.Stat_t
	if unix.Fstat(fd, &before) != nil || !protectedBackendKeyStat(&before) {
		return reject()
	}
	data, err := io.ReadAll(io.LimitReader(file, 8193))
	defer clear(data)
	var after, bound unix.Stat_t
	if err != nil || len(data) > 8192 || int64(len(data)) != before.Size || unix.Fstat(fd, &after) != nil || unix.Fstatat(dir, leaf, &bound, unix.AT_SYMLINK_NOFOLLOW) != nil || !protectedBackendKeyStat(&after) || !protectedBackendKeyStat(&bound) || before.Dev != after.Dev || before.Ino != after.Ino || before.Size != after.Size || before.Dev != bound.Dev || before.Ino != bound.Ino || before.Size != bound.Size {
		return reject()
	}
	trimmed := bytes.TrimSpace(data)
	// pem.Decode can skip a malformed first block and decode a later key.
	// Require exactly one complete matching delimiter pair before decoding,
	// so the accepted block is the original whole input, not a skipped suffix.
	if !bytes.HasPrefix(trimmed, []byte("-----BEGIN PRIVATE KEY-----")) || !bytes.HasSuffix(trimmed, []byte("-----END PRIVATE KEY-----")) || bytes.Count(trimmed, []byte("-----BEGIN ")) != 1 || bytes.Count(trimmed, []byte("-----END ")) != 1 {
		return reject()
	}
	block, rest := pem.Decode(trimmed)
	if block == nil || block.Type != "PRIVATE KEY" || len(block.Headers) != 0 || len(bytes.TrimSpace(rest)) != 0 {
		return reject()
	}
	defer clear(block.Bytes)
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return reject()
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(key) != ed25519.PrivateKeySize {
		return reject()
	}
	result := append(ed25519.PrivateKey(nil), key...)
	clear(key)
	return result, nil
}

func protectedBackendDirectory(fd int) bool {
	var st unix.Stat_t
	return unix.Fstat(fd, &st) == nil && uint32(st.Mode)&unix.S_IFMT == unix.S_IFDIR && uint32(st.Mode)&0022 == 0 && (st.Uid == 0 || st.Uid == uint32(os.Getuid()))
}

func protectedBackendKeyStat(st *unix.Stat_t) bool {
	return uint32(st.Mode)&unix.S_IFMT == unix.S_IFREG && uint32(st.Mode)&0777 == 0600 && st.Uid == uint32(os.Getuid()) && st.Nlink == 1 && st.Size > 0 && st.Size <= 8192
}
