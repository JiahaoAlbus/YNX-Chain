package main

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// Only tests supply hooks. Every production read owns one descriptor from the
// initial identity check through decoding, canonical comparison and EOF.
type initializationMigrationReadHooks struct {
	afterDecode func() error
}

func readInitializationMigration(path string, maximum int64, hooks *initializationMigrationReadHooks) (state chain.ConsensusMigrationState, result error) {
	if path == "" || !filepath.IsAbs(path) || filepath.Clean(path) != path || maximum <= 0 || maximum > 1<<30 {
		return state, errors.New("initialization inputs require exact absolute file paths and a positive bound")
	}
	before, err := os.Lstat(path)
	if err != nil || !before.Mode().IsRegular() || before.Size() <= 0 || before.Size() > maximum {
		return state, errors.New("initialization input must be an existing bounded regular file without a symlink")
	}
	file, err := os.Open(path)
	if err != nil {
		return state, err
	}
	defer func() { result = errors.Join(result, file.Close()) }()
	check := func() error {
		opened, openErr := file.Stat()
		current, pathErr := os.Lstat(path)
		same := func(info os.FileInfo) bool {
			return info != nil && info.Mode() == before.Mode() && os.SameFile(before, info) &&
				info.Size() == before.Size() && info.ModTime().Equal(before.ModTime())
		}
		if openErr != nil || pathErr != nil || !same(opened) || !same(current) {
			return errors.New("initialization input changed during bounded canonical read")
		}
		return nil
	}
	if err := check(); err != nil {
		return state, err
	}
	limited := &io.LimitedReader{R: file, N: maximum + 1}
	state, err = chain.ReadConsensusMigrationState(initializationChunkReader{limited})
	if identityErr := check(); identityErr != nil {
		return chain.ConsensusMigrationState{}, identityErr
	}
	if err != nil {
		return chain.ConsensusMigrationState{}, fmt.Errorf("decode complete migration JSON: %w", err)
	}
	if maximum+1-limited.N != before.Size() || limited.N <= 0 {
		return chain.ConsensusMigrationState{}, errors.New("initialization input changed or exceeded its original bounds")
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
	// This is the previous Compact -> strict Decode -> Marshal byte equality,
	// using the existing canonical writer and the very same original file.
	// The typed streaming decoder alone intentionally preserves json decoder
	// compatibility; this exact comparison also rejects duplicate/folded names,
	// noncanonical escapes/numbers/field order and omitted canonical fields.
	input := &io.LimitedReader{R: file, N: maximum + 1}
	comparator := initializationCanonicalComparator{input: bufio.NewReaderSize(input, 64*1024)}
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
type initializationChunkReader struct{ io.Reader }

func (r initializationChunkReader) Read(p []byte) (int, error) {
	if len(p) > 64*1024 {
		p = p[:64*1024]
	}
	return r.Reader.Read(p)
}

type initializationJSONSpace struct{ quoted, escaped bool }

func (s *initializationJSONSpace) keep(b byte) bool {
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

type initializationCanonicalComparator struct {
	input             *bufio.Reader
	source, canonical initializationJSONSpace
}

func (c *initializationCanonicalComparator) next() (byte, error) {
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

func (c *initializationCanonicalComparator) Write(p []byte) (int, error) {
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

func (c *initializationCanonicalComparator) finish() error {
	if _, err := c.next(); err != io.EOF || c.source.quoted || c.source.escaped || c.canonical.quoted || c.canonical.escaped {
		return errors.New("public operator binding must be one complete canonical JSON value")
	}
	return nil
}
