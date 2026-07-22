package cloud

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const maxRecoveryBytes int64 = 2 << 30

type RecoveryFile struct {
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type RecoveryManifest struct {
	Schema          string         `json:"schema"`
	CreatedAt       string         `json:"createdAt"`
	StorageBoundary string         `json:"storageBoundary"`
	Files           []RecoveryFile `json:"files"`
}

func CreateRecoveryBackup(source, destination, boundary string, now time.Time) (RecoveryManifest, error) {
	source, destination = filepath.Clean(source), filepath.Clean(destination)
	if source == destination || strings.HasPrefix(destination+string(filepath.Separator), source+string(filepath.Separator)) {
		return RecoveryManifest{}, errors.New("backup destination must be outside the live data directory")
	}
	if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		return RecoveryManifest{}, errors.New("backup destination must not already exist")
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return RecoveryManifest{}, err
	}
	failed := true
	defer func() {
		if failed {
			_ = os.RemoveAll(destination)
		}
	}()
	manifest := RecoveryManifest{Schema: "ynx-cloud-recovery/v1", CreatedAt: now.UTC().Format(time.RFC3339), StorageBoundary: boundary, Files: []RecoveryFile{}}
	var total int64
	err := filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("backup rejects symlink %s", relative)
		}
		if entry.IsDir() {
			return os.MkdirAll(filepath.Join(destination, relative), 0o700)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("backup rejects non-regular file %s", relative)
		}
		total += info.Size()
		if total > maxRecoveryBytes {
			return errors.New("backup exceeds recovery size policy")
		}
		body, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := writeRecoveryFile(filepath.Join(destination, relative), body); err != nil {
			return err
		}
		manifest.Files = append(manifest.Files, RecoveryFile{Path: filepath.ToSlash(relative), Bytes: int64(len(body)), SHA256: hashBytes(body)})
		return nil
	})
	if err != nil {
		return RecoveryManifest{}, err
	}
	sort.Slice(manifest.Files, func(i, j int) bool { return manifest.Files[i].Path < manifest.Files[j].Path })
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return RecoveryManifest{}, err
	}
	if err := writeRecoveryFile(filepath.Join(destination, "recovery-manifest.json"), append(body, '\n')); err != nil {
		return RecoveryManifest{}, err
	}
	failed = false
	return manifest, nil
}

func RestoreRecoveryBackup(source, destination string) (RecoveryManifest, error) {
	manifest, err := VerifyRecoveryBackup(source)
	if err != nil {
		return RecoveryManifest{}, err
	}
	if _, err := os.Stat(destination); !errors.Is(err, os.ErrNotExist) {
		return RecoveryManifest{}, errors.New("restore destination must not already exist")
	}
	temporary := destination + ".restore-" + newID("tmp")
	if err := os.MkdirAll(temporary, 0o700); err != nil {
		return RecoveryManifest{}, err
	}
	defer os.RemoveAll(temporary)
	for _, file := range manifest.Files {
		body, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(file.Path)))
		if err != nil {
			return RecoveryManifest{}, err
		}
		if err := writeRecoveryFile(filepath.Join(temporary, filepath.FromSlash(file.Path)), body); err != nil {
			return RecoveryManifest{}, err
		}
	}
	if err := os.Rename(temporary, destination); err != nil {
		return RecoveryManifest{}, err
	}
	return manifest, nil
}

func VerifyRecoveryBackup(source string) (RecoveryManifest, error) {
	f, err := os.Open(filepath.Join(source, "recovery-manifest.json"))
	if err != nil {
		return RecoveryManifest{}, err
	}
	defer f.Close()
	decoder := json.NewDecoder(io.LimitReader(f, 4<<20))
	decoder.DisallowUnknownFields()
	var manifest RecoveryManifest
	if err := decoder.Decode(&manifest); err != nil || decoder.Decode(&struct{}{}) != io.EOF || manifest.Schema != "ynx-cloud-recovery/v1" || manifest.CreatedAt == "" || manifest.StorageBoundary == "" || len(manifest.Files) == 0 {
		return RecoveryManifest{}, errors.New("invalid recovery manifest")
	}
	seen := map[string]bool{}
	var total int64
	for _, file := range manifest.Files {
		clean := filepath.ToSlash(filepath.Clean(file.Path))
		if clean != file.Path || strings.HasPrefix(clean, "../") || filepath.IsAbs(file.Path) || seen[file.Path] || file.Bytes < 0 || len(file.SHA256) != 64 {
			return RecoveryManifest{}, errors.New("unsafe recovery manifest entry")
		}
		seen[file.Path] = true
		total += file.Bytes
		if total > maxRecoveryBytes {
			return RecoveryManifest{}, errors.New("recovery manifest exceeds size policy")
		}
		body, err := os.ReadFile(filepath.Join(source, filepath.FromSlash(file.Path)))
		if err != nil || int64(len(body)) != file.Bytes || hashBytes(body) != file.SHA256 {
			return RecoveryManifest{}, fmt.Errorf("recovery integrity mismatch for %s", file.Path)
		}
	}
	return manifest, nil
}

func writeRecoveryFile(path string, body []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err = f.Write(body); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
