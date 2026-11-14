//go:build unix

package consensus

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"sync"

	"golang.org/x/crypto/pbkdf2"
	"golang.org/x/sys/unix"
)

// Internal experimental capability. Normal paths never enable this; tests
// explicitly attach one to an isolated synthetic session. It is not a wallet
// interface. The owner stores a secret in-process longer; clearing the Go byte
// slice cannot guarantee erasure of runtime or cipher-internal copies.
type pqLabExperimentalKDFCache struct {
	mu               sync.Mutex
	sealed           bool
	onWait           func() // private deterministic timing-test seam; nil in normal code
	onClear          func() // private deterministic timing-test seam; nil in normal code
	key              []byte
	salt             [32]byte
	credentialDigest [32]byte
	vaultDigest      [32]byte
	vaultIdentity    os.FileInfo
}

func (c *pqLabExperimentalKDFCache) clearLocked() {
	clear(c.key)
	c.key = nil
	clear(c.salt[:])
	clear(c.credentialDigest[:])
	clear(c.vaultDigest[:])
	c.vaultIdentity = nil
}
func (c *pqLabExperimentalKDFCache) clear() {
	if c.onClear != nil {
		c.onClear()
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.clearLocked()
}
func (c *pqLabExperimentalKDFCache) seal() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sealed = true
	c.clearLocked()
}

// Caller holds mu through the entire original owner open and all checks.
func (c *pqLabExperimentalKDFCache) aeadLocked(credential, salt, vault []byte, vaultIdentity os.FileInfo, metrics *PQLabMetrics) (cipher.AEAD, error) {
	if c.sealed {
		return nil, errors.New("experimental synthetic cache retired")
	}
	if len(credential) != 32 || len(salt) != 32 || vaultIdentity == nil {
		return nil, errors.New("exact inherited lab credential and salt required")
	}
	ch, vh := sha256.Sum256(credential), sha256.Sum256(vault)
	if c.key != nil && (!bytes.Equal(c.salt[:], salt) || c.credentialDigest != ch || c.vaultDigest != vh || c.vaultIdentity == nil || !os.SameFile(c.vaultIdentity, vaultIdentity)) {
		c.clearLocked()
	}
	if c.key == nil {
		end := pqLabMeasure(metrics, "sender.pbkdf2_600000")
		c.key = pbkdf2.Key(credential, salt, 600000, 32, sha256.New)
		end()
		copy(c.salt[:], salt)
		c.credentialDigest = ch
		c.vaultDigest = vh
		c.vaultIdentity = vaultIdentity
	} else {
		end := pqLabMeasure(metrics, "sender.pbkdf2_cache_hit")
		end()
	}
	block, err := aes.NewCipher(c.key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// Pin the exact no-follow descriptor that supplied the bytes. Path-only
// before/after checks permit an A->B->A replacement around the actual read.
func readExperimentalOriginalVault(path string, limit int64) ([]byte, os.FileInfo, error) {
	if err := requireInspectionPath(path); err != nil {
		return nil, nil, err
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, nil, err
	}
	file := os.NewFile(uintptr(fd), "synthetic-experimental-vault")
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Size() > limit {
		return nil, nil, errors.New("original synthetic vault must be bounded regular 0600")
	}
	var st unix.Stat_t
	if err = unix.Fstat(fd, &st); err != nil || st.Nlink != 1 {
		return nil, nil, errors.New("original synthetic vault must have one link")
	}
	pathBefore, err := os.Lstat(path)
	if err != nil || !os.SameFile(before, pathBefore) {
		return nil, nil, errors.New("original synthetic vault path differs from read handle")
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		clear(raw)
		return nil, nil, errors.New("original synthetic vault read exceeds bound")
	}
	after, err := file.Stat()
	if err != nil {
		clear(raw)
		return nil, nil, err
	}
	pathAfter, err := os.Lstat(path)
	var finalStat unix.Stat_t
	finalErr := unix.Fstat(fd, &finalStat)
	if err != nil || finalErr != nil || finalStat.Nlink != 1 || !os.SameFile(before, after) || !os.SameFile(before, pathAfter) || before.Size() != after.Size() || before.Mode() != after.Mode() || !before.ModTime().Equal(after.ModTime()) || int64(len(raw)) != before.Size() {
		clear(raw)
		return nil, nil, errors.New("original synthetic vault changed during read")
	}
	return raw, before, nil
}
