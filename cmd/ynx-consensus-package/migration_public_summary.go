package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"golang.org/x/sys/unix"
)

const migrationPublicSummaryVersion = "YNX-MIGRATION-PUBLIC-SUMMARY/v1"
const migrationPublicSummaryMaximum = 1 << 30

// This is DATA about the exact complete input, not a substitute migration,
// checkpoint, validator binding, execution authorization or deployment receipt.
type migrationPublicSummary struct {
	Version               string `json:"version"`
	Classification        string `json:"classification"`
	SourceSHA256          string `json:"sourceSHA256"`
	SourceBytes           string `json:"sourceBytes"`
	Height                string `json:"height"`
	LastBlockHash         string `json:"lastBlockHash"`
	StateHash             string `json:"stateHash"`
	FirstCanonicalAccount string `json:"firstCanonicalAccount"`
}

// Compare the complete seconds/nanoseconds pair without UnixNano overflow.
// Accept only the two known Unix ABI spellings. Missing, ambiguous or malformed
// time fields cannot silently reduce source identity to second resolution.
func migrationSummaryTime(stat any, names ...string) ([2]int64, bool) {
	var out [2]int64
	v := reflect.ValueOf(stat)
	if !v.IsValid() || v.Kind() != reflect.Struct {
		return out, false
	}
	found := false
	for _, name := range names {
		field := v.FieldByName(name)
		if !field.IsValid() {
			continue
		}
		if found || field.Kind() != reflect.Struct {
			return out, false
		}
		sec, nsec := field.FieldByName("Sec"), field.FieldByName("Nsec")
		if !sec.IsValid() || !nsec.IsValid() || !sec.CanInt() || !nsec.CanInt() || nsec.Int() < 0 || nsec.Int() >= 1_000_000_000 {
			return out, false
		}
		out, found = [2]int64{sec.Int(), nsec.Int()}, true
	}
	return out, found
}

func sameMigrationSummaryInput(a, b unix.Stat_t) bool {
	if a.Dev != b.Dev || a.Ino != b.Ino || a.Mode != b.Mode || a.Nlink != b.Nlink || a.Uid != b.Uid || a.Gid != b.Gid || a.Size != b.Size {
		return false
	}
	am, amOK := migrationSummaryTime(a, "Mtim", "Mtimespec")
	bm, bmOK := migrationSummaryTime(b, "Mtim", "Mtimespec")
	ac, acOK := migrationSummaryTime(a, "Ctim", "Ctimespec")
	bc, bcOK := migrationSummaryTime(b, "Ctim", "Ctimespec")
	return amOK && bmOK && acOK && bcOK && am == bm && ac == bc
}

// Hold the exact original FD through complete validation and the caller's
// read-only inspection. atime may change; identity, ns mtime/ctime may not.
func withVerifiedMigrationInput(path string, inspect func(chain.ConsensusMigrationState, string, string) ([]byte, error)) ([]byte, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil || resolved != absolute {
		return nil, errors.New("migration check requires an existing original path without symlinks")
	}
	var before unix.Stat_t
	if err = unix.Lstat(absolute, &before); err != nil {
		return nil, fmt.Errorf("stat original migration: %w", err)
	}
	if before.Mode&unix.S_IFMT != unix.S_IFREG || before.Mode&0022 != 0 || before.Nlink != 1 || before.Size <= 0 || before.Size > migrationPublicSummaryMaximum {
		return nil, errors.New("migration check requires one nonempty regular input within the existing 1GiB bound")
	}
	fd, err := unix.Open(absolute, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open original migration: %w", err)
	}
	f := os.NewFile(uintptr(fd), "original-public-migration")
	defer f.Close()
	check := func() error {
		var opened, current unix.Stat_t
		if unix.Fstat(fd, &opened) != nil || unix.Lstat(absolute, &current) != nil || !sameMigrationSummaryInput(before, opened) || !sameMigrationSummaryInput(before, current) {
			return errors.New("original migration identity changed during complete migration check")
		}
		return nil
	}
	if err = check(); err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(f, migrationPublicSummaryMaximum+1))
	if err != nil || int64(len(raw)) != before.Size || len(raw) > migrationPublicSummaryMaximum {
		return nil, errors.New("original migration changed or exceeded its existing read bound")
	}
	if err = check(); err != nil {
		return nil, err
	}
	// This is the identical decoder -> ConsensusMigrationState.Validate path
	// used by ordinary -verify-migration-state, not validation of a summary.
	migration, err := verifyMigrationStatePayload(raw)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(raw)
	// The callback may construct an entire Application. Release the additional
	// raw input before that work, while retaining the same original FD guard.
	sourceBytes := strconv.Itoa(len(raw))
	raw = nil
	encoded, err := inspect(migration, hex.EncodeToString(digest[:]), sourceBytes)
	if err != nil {
		return nil, err
	}
	if err := check(); err != nil {
		return nil, err
	}
	return encoded, nil
}

func writeMigrationCheckOutput(output io.Writer, encoded []byte) error {
	encoded = append(encoded, '\n')
	n, err := output.Write(encoded)
	if err == nil && n != len(encoded) {
		return io.ErrShortWrite
	}
	return err
}

// The opt-in summary and preservation checks share the same bounded original
// FD through strict complete validation and their read-only inspection. No
// caller may substitute summary metadata for the original migration.
func writeMigrationPublicSummary(path string, output io.Writer) error {
	encoded, err := withVerifiedMigrationInput(path, func(migration chain.ConsensusMigrationState, sourceSHA256, sourceBytes string) ([]byte, error) {
		summary := migrationPublicSummary{Version: migrationPublicSummaryVersion, Classification: "data",
			SourceSHA256: sourceSHA256, SourceBytes: sourceBytes,
			Height: strconv.FormatUint(migration.Height, 10), LastBlockHash: migration.LastBlockHash, StateHash: migration.StateHash}
		for _, account := range migration.Accounts {
			if accountaddress.IsCanonical(account.Address) {
				summary.FirstCanonicalAccount = account.Address
				break
			}
		}
		encoded, err := json.Marshal(summary)
		if err != nil || len(encoded)+1 > 4096 {
			return nil, errors.New("migration public summary exceeds its fixed output bound")
		}
		return encoded, nil
	})
	if err != nil {
		return err
	}
	return writeMigrationCheckOutput(output, encoded)
}
