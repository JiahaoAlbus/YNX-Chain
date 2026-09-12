package main

import (
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
)

var faucetCoreTokenPattern = regexp.MustCompile(`^[0-9a-f]{64}\n?$`)

// Tokens are independent of chain signing keys and are never printed in config
// checks. An absent file disables public funding without preventing chain reads.
func loadFaucetCoreToken(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	reject := errors.New("invalid private faucet authority token file")
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Size() < 64 || before.Size() > 65 {
		return "", reject
	}
	f, err := os.Open(path)
	if err != nil {
		return "", reject
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) || opened.Mode().Perm() != 0600 {
		return "", reject
	}
	payload, err := io.ReadAll(io.LimitReader(f, 66))
	after, statErr := os.Lstat(path)
	if err != nil || statErr != nil || !os.SameFile(opened, after) || !after.Mode().IsRegular() || after.Mode().Perm() != 0600 || !faucetCoreTokenPattern.Match(payload) {
		return "", reject
	}
	return strings.TrimSuffix(string(payload), "\n"), nil
}
