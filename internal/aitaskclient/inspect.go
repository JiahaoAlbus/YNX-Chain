package aitaskclient

import (
	"context"
	"crypto/sha256"
	"crypto/sha3"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
)

// FileInspection is an actual local OS read requested by the invoking human.
// It is never a task receipt or permission to disclose file contents to a model.
type FileInspection struct {
	Path           string `json:"path"`
	Bytes          int64  `json:"bytes"`
	SHA256         string `json:"sha256"`
	SHA3_512       string `json:"sha3_512"`
	Authority      string `json:"authority"`
	TaskGrant      bool   `json:"taskGrant"`
	ModelDisclosed bool   `json:"modelDisclosed"`
}

func InspectFile(ctx context.Context, path string) (FileInspection, error) {
	var out FileInspection
	if ctx == nil {
		return out, errors.New("context required")
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return out, errors.New("explicit absolute file path required")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return out, err
	}
	if !info.Mode().IsRegular() || info.Size() > 16<<20 {
		return out, errors.New("inspection requires a regular non-symlink file of at most 16 MiB")
	}
	f, err := os.Open(path)
	if err != nil {
		return out, err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return out, errors.New("file changed before opening")
	}
	a, b := sha256.New(), sha3.New512()
	buf := make([]byte, 32<<10)
	var size int64
	for {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		n, e := f.Read(buf)
		if n > 0 {
			size += int64(n)
			if size > 16<<20 {
				return out, errors.New("file grew beyond inspection bound")
			}
			_, _ = a.Write(buf[:n])
			_, _ = b.Write(buf[:n])
		}
		if e == io.EOF {
			break
		}
		if e != nil {
			return out, e
		}
	}
	after, err := f.Stat()
	named, nameErr := os.Lstat(path)
	if err != nil || nameErr != nil || !os.SameFile(opened, after) || !os.SameFile(opened, named) || size != info.Size() || after.Size() != info.Size() || !after.ModTime().Equal(info.ModTime()) || !named.ModTime().Equal(info.ModTime()) {
		return out, errors.New("file changed while inspecting; no stable result")
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	return FileInspection{Path: path, Bytes: size, SHA256: hex.EncodeToString(a.Sum(nil)), SHA3_512: hex.EncodeToString(b.Sum(nil)), Authority: "explicit local OS file read; not an AI task authorization"}, nil
}
