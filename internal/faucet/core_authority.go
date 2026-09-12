package faucet

import (
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
)

var coreTokenPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// A Core service token is separate from the BFT transaction-signing key.
func loadCoreAuthToken(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		return "", errors.New("Core authority token must be a private regular file with mode 0600")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", errors.New("Core authority token file is unavailable")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return "", errors.New("Core authority token file changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(f, 67))
	if err != nil {
		return "", errors.New("Core authority token could not be read")
	}
	token := strings.TrimSuffix(string(data), "\n")
	if !coreTokenPattern.MatchString(token) {
		return "", errors.New("Core authority token has invalid encoding")
	}
	return token, nil
}
