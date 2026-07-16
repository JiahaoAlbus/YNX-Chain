package video

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// ObjectStorage exposes only bounded, product-relative keys. Media processors
// intentionally receive a local staging path; a remote implementation must
// download into its bounded staging volume and upload verified derivatives.
type ObjectStorage interface {
	Resolve(key string) (string, error)
	EnsurePrefix(prefix string) (string, error)
	RemovePrefix(prefix string) error
	Usage(prefix string) (int64, error)
}

type LocalObjectStorage struct{ root string }

func NewLocalObjectStorage(root string) (*LocalObjectStorage, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("object storage root is required")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	return &LocalObjectStorage{root: root}, nil
}

func (s *LocalObjectStorage) Resolve(key string) (string, error) {
	if filepath.IsAbs(key) {
		return "", errors.New("absolute object key is forbidden")
	}
	for _, part := range strings.FieldsFunc(key, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." {
			return "", errors.New("object key traversal is forbidden")
		}
	}
	clean := strings.TrimPrefix(filepath.Clean("/"+key), "/")
	if clean == "." || clean == "" || strings.ContainsRune(clean, 0) {
		return "", errors.New("invalid object key")
	}
	path := filepath.Join(s.root, clean)
	if path == s.root || !strings.HasPrefix(path, s.root+string(os.PathSeparator)) {
		return "", errors.New("object key escapes bounded storage")
	}
	return path, nil
}
func (s *LocalObjectStorage) EnsurePrefix(prefix string) (string, error) {
	path, err := s.Resolve(prefix)
	if err != nil {
		return "", err
	}
	if err = os.Mkdir(path, 0700); err != nil {
		return "", err
	}
	return path, nil
}
func (s *LocalObjectStorage) RemovePrefix(prefix string) error {
	path, err := s.Resolve(prefix)
	if err != nil {
		return err
	}
	return os.RemoveAll(path)
}
func (s *LocalObjectStorage) Usage(prefix string) (int64, error) {
	path, err := s.Resolve(prefix)
	if err != nil {
		return 0, err
	}
	var total int64
	err = filepath.Walk(path, func(_ string, info os.FileInfo, walkErr error) error {
		if os.IsNotExist(walkErr) {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if info.Mode().IsRegular() {
			total += info.Size()
		}
		return nil
	})
	return total, err
}
