package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

// The normal reference package need not retain a second history-sized raw
// document. Its complete original bytes remain on this held, identity-checked
// descriptor until all role comparisons and the package hash have finished.
// Noncanonical historical JSON deliberately retains the original Unmarshal
// path and raw bytes; the stricter streaming decoder is not a new grammar gate.
type productionMigrationSource struct {
	file  *os.File
	check func() error
	size  int64
	state chain.ConsensusMigrationState
	raw   []byte
}

func readProductionMigrationSource(path string, appState []byte) (source *productionMigrationSource, result error) {
	file, check, err := openProductionPackageFile(path)
	if err != nil {
		return nil, fmt.Errorf("read common production migration: %w", err)
	}
	source = &productionMigrationSource{file: file, check: check}
	defer func() {
		if result != nil {
			result = errors.Join(result, source.close())
			source = nil
		}
	}()
	info, err := file.Stat()
	if err != nil {
		return source, fmt.Errorf("read common production migration: %w", err)
	}
	source.size = info.Size()
	// This is only a fast-path selector. The unchanged bootstrap validator
	// below still authenticates every reference field against the whole state.
	var discriminator struct {
		Version json.RawMessage `json:"version"`
	}
	var version string
	reference := json.Unmarshal(appState, &discriminator) == nil &&
		json.Unmarshal(discriminator.Version, &version) == nil
	if productionPackageHeldStreaming && reference {
		state, decodeErr := chain.ReadConsensusMigrationState(source.reader())
		if err := check(); err != nil {
			return source, err // A changed source must never enter fallback.
		}
		if decodeErr == nil {
			comparison := newProductionCanonicalComparison(source.reader())
			canonicalErr := state.WriteCanonicalJSON(comparison)
			if canonicalErr == nil {
				canonicalErr = comparison.finish()
			}
			if err := check(); err != nil {
				return source, err
			}
			if canonicalErr == nil {
				source.state = state
				return source, nil
			}
		}
		// Even a successfully decoded duplicate/case-folded/escaped spelling
		// is not substituted for the historical decoder. Only exact canonical
		// bytes (with the original optional final LF) take the streaming path.
		state = chain.ConsensusMigrationState{}
	}
	// As in the old stat-sized ReadFile path, allocate the original buffer
	// once. A fallback must not add repeated ReadAll growth copies of large M.
	if source.size < 0 || int64(int(source.size)) != source.size {
		return source, errors.New("common production migration size is not addressable")
	}
	raw := make([]byte, int(source.size))
	_, err = io.ReadFull(source.reader(), raw)
	if err != nil {
		return source, fmt.Errorf("read common production migration: %w", err)
	}
	if err := check(); err != nil {
		return source, err
	}
	if err := json.Unmarshal(raw, &source.state); err != nil {
		return source, fmt.Errorf("decode common production migration: %w", err)
	}
	source.raw = raw
	return source, nil
}

func (s *productionMigrationSource) reader() io.Reader {
	return io.NewSectionReader(s.file, 0, s.size)
}

func (s *productionMigrationSource) compareRole(path string) error {
	if err := s.check(); err != nil {
		return err
	}
	var err error
	if s.raw != nil {
		err = compareProductionPackageFileBytes(path, s.raw)
	} else {
		err = readProductionPackageFile(path, func(role io.Reader) error {
			return compareProductionPackageReaders(role, s.reader())
		})
	}
	return errors.Join(err, s.check())
}

func (s *productionMigrationSource) hash() (string, error) {
	if err := s.check(); err != nil {
		return "", err
	}
	h := sha256.New()
	n, err := io.CopyBuffer(h, s.reader(), make([]byte, productionPackageIOBufferBytes))
	err = errors.Join(err, s.check())
	if err != nil {
		return "", err
	}
	if n != s.size {
		return "", errors.New("common production migration length changed")
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (s *productionMigrationSource) close() error {
	return errors.Join(s.check(), s.file.Close())
}

// Comparing the canonical writer against the held input prevents adopting the
// strict decoder's result for any historical alternate JSON spelling. Neither
// side is materialized here; in particular a large writer chunk is split into
// fixed-size reads without a chunk-sized allocation.
type productionCanonicalComparison struct {
	input   io.Reader
	scratch [productionPackageIOBufferBytes]byte
}

func newProductionCanonicalComparison(input io.Reader) *productionCanonicalComparison {
	return &productionCanonicalComparison{input: input}
}

func (w *productionCanonicalComparison) Write(p []byte) (int, error) {
	total := 0
	for len(p) != 0 {
		n := min(len(p), len(w.scratch))
		read, err := io.ReadFull(w.input, w.scratch[:n])
		if err != nil || read != n || !bytes.Equal(w.scratch[:n], p[:n]) {
			return total, errors.New("common production migration is not exact canonical JSON")
		}
		total += n
		p = p[n:]
	}
	return total, nil
}

func (w *productionCanonicalComparison) finish() error {
	var tail [2]byte
	n, err := io.ReadFull(w.input, tail[:])
	if (n == 0 && err == io.EOF) || (n == 1 && err == io.ErrUnexpectedEOF && tail[0] == '\n') {
		return nil
	}
	return errors.New("common production migration has noncanonical trailing bytes")
}
