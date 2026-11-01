//go:build unix

package consensus

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"syscall"

	"golang.org/x/sys/unix"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Only this package's tests supply hooks. Every production read owns one descriptor from the
// initial identity check through decoding, canonical comparison and EOF.
type pqOperatorMigrationReadHooks struct {
	afterDecode func() error
}

func readPQOperatorMigration(path string, maximum int64, hooks *pqOperatorMigrationReadHooks) (state chain.ConsensusMigrationState, result error) {
	// Retain the original operator reader's path semantics and fixed public
	// permission policy. No caller-supplied hash or validation override is accepted.
	if path == "" || maximum <= 0 || maximum > 1<<30 {
		return state, errors.New("operator migration requires an existing file and the fixed positive bound")
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maximum {
		return state, errors.New("operator migration input must be an existing bounded regular file without a symlink")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return state, err
	}
	file := os.NewFile(uintptr(fd), "pq-operator-migration")
	defer func() { result = errors.Join(result, file.Close()) }()
	check := func() error {
		opened, openErr := file.Stat()
		current, pathErr := os.Lstat(path)
		same := func(info os.FileInfo) bool {
			if info == nil || info.Mode() != before.Mode() || !os.SameFile(before, info) ||
				info.Size() != before.Size() || !info.ModTime().Equal(before.ModTime()) {
				return false
			}
			a, aOK := before.Sys().(*syscall.Stat_t)
			b, bOK := info.Sys().(*syscall.Stat_t)
			return aOK && bOK && a.Uid == b.Uid && a.Gid == b.Gid && a.Nlink == b.Nlink
		}
		if openErr != nil || pathErr != nil || !same(opened) || !same(current) {
			return errors.New("operator migration input changed during bounded canonical read")
		}
		return nil
	}
	if err := check(); err != nil {
		return state, err
	}
	limited := &io.LimitedReader{R: file, N: maximum + 1}
	inputStart := bufio.NewReaderSize(pqOperatorMigrationChunkReader{limited}, 64*1024)
	err = pqOperatorMigrationSkipLeadingSpace(inputStart)
	if err == nil {
		state, err = chain.ReadConsensusMigrationState(pqOperatorMigrationChunkReader{inputStart})
	}
	if identityErr := check(); identityErr != nil {
		return chain.ConsensusMigrationState{}, identityErr
	}
	if err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("decode complete migration JSON: %w", err)
	}
	if maximum+1-limited.N != before.Size() || limited.N <= 0 {
		return chain.ConsensusMigrationState{}, errors.New("operator migration input changed or exceeded its original bounds")
	}
	if hooks != nil && hooks.afterDecode != nil {
		if err := hooks.afterDecode(); err != nil {
			return chain.ConsensusMigrationState{}, err
		}
	}
	if err := check(); err != nil {
		return chain.ConsensusMigrationState{}, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return chain.ConsensusMigrationState{}, err
	}
	// Match the normal initializer's Compact -> strict Decode -> Marshal equality,
	// using the existing canonical writer and the very same original file.
	// The typed streaming decoder alone intentionally preserves json decoder
	// compatibility; this exact comparison also rejects duplicate/folded names,
	// noncanonical escapes/numbers/field order and omitted canonical fields.
	input := &io.LimitedReader{R: file, N: maximum + 1}
	comparator := pqOperatorMigrationCanonicalComparator{input: bufio.NewReaderSize(input, 64*1024)}
	if err := state.WriteCanonicalJSON(&comparator); err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("decode canonical complete migration: %w", err)
	}
	if err := comparator.finish(); err != nil {
		return chain.ConsensusMigrationState{}, err
	}
	if maximum+1-input.N != before.Size() || input.N <= 0 {
		return chain.ConsensusMigrationState{}, errors.New("canonical input changed or exceeded its original bounds")
	}
	if err := check(); err != nil {
		return chain.ConsensusMigrationState{}, err
	}
	return state, nil
}

// Decoder reads are capped independently of the size of its current field.
// This does not impose any new limit on a legitimate individual JSON record.
type pqOperatorMigrationChunkReader struct{ io.Reader }

func (r pqOperatorMigrationChunkReader) Read(p []byte) (int, error) {
	if len(p) > 64*1024 {
		p = p[:64*1024]
	}
	return r.Reader.Read(p)
}

type pqOperatorMigrationJSONSpace struct{ quoted, escaped bool }

func (s *pqOperatorMigrationJSONSpace) keep(b byte) bool {
	if s.quoted {
		if s.escaped {
			s.escaped = false
		} else if b == '\\' {
			s.escaped = true
		} else if b == '"' {
			s.quoted = false
		}
		return true
	}
	if b == ' ' || b == '\t' || b == '\r' || b == '\n' {
		return false
	}
	if b == '"' {
		s.quoted = true
	}
	return true
}

type pqOperatorMigrationCanonicalComparator struct {
	input             *bufio.Reader
	source, canonical pqOperatorMigrationJSONSpace
}

func (c *pqOperatorMigrationCanonicalComparator) next() (byte, error) {
	for {
		b, err := c.input.ReadByte()
		if err != nil {
			return 0, err
		}
		if c.source.keep(b) {
			return b, nil
		}
	}
}

func (c *pqOperatorMigrationCanonicalComparator) Write(p []byte) (int, error) {
	for i, b := range p {
		if !c.canonical.keep(b) {
			continue
		}
		actual, err := c.next()
		if err != nil || actual != b {
			return i, errors.New("public operator binding must be canonical JSON without duplicate fields")
		}
	}
	return len(p), nil
}

func (c *pqOperatorMigrationCanonicalComparator) finish() error {
	if _, err := c.next(); err != io.EOF || c.source.quoted || c.source.escaped || c.canonical.quoted || c.canonical.escaped {
		return errors.New("public operator binding must be one complete canonical JSON value")
	}
	return nil
}

// encoding/json.Decoder.Token retains a whitespace-only prefix while peeking.
// Consume only the four permitted document-leading JSON whitespace bytes with
// a fixed buffer. Interior bytes (including every token/string separator) and
// the complete original-byte bound/canonical second pass remain unchanged.
func pqOperatorMigrationSkipLeadingSpace(input *bufio.Reader) error {
	for {
		b, err := input.ReadByte()
		if err != nil {
			return err
		}
		switch b {
		case ' ', '\t', '\r', '\n':
			continue
		default:
			return input.UnreadByte()
		}
	}
}
