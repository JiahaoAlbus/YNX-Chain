package video

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
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

const backupManifestName = "backup-manifest.json"

type BackupManifest struct {
	Format    string            `json:"format"`
	CreatedAt time.Time         `json:"created_at"`
	Files     map[string]string `json:"files_sha256"`
}

// CreateBackup writes a verified, portable snapshot of state and objects. It
// rejects links and special files so a backup cannot silently escape the data
// boundary when restored.
func CreateBackup(root string, integrityKey []byte, destination io.Writer, now time.Time) error {
	if destination == nil {
		return errors.New("backup destination is required")
	}
	if _, err := OpenStore(root, integrityKey); err != nil {
		return fmt.Errorf("verify source state: %w", err)
	}
	statePath := filepath.Join(root, "state.json")
	if _, err := os.Stat(statePath); err != nil {
		return fmt.Errorf("state snapshot is unavailable: %w", err)
	}
	paths := []string{"state.json"}
	objectsRoot := filepath.Join(root, "objects")
	err := filepath.WalkDir(objectsRoot, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == objectsRoot || entry.IsDir() {
			return nil
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("backup rejects non-regular object %q", path)
		}
		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			return relErr
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	sort.Strings(paths)
	manifest := BackupManifest{Format: "ynx-video-backup-v1", CreatedAt: now.UTC(), Files: map[string]string{}}
	gzipWriter := gzip.NewWriter(destination)
	tarWriter := tar.NewWriter(gzipWriter)
	closeWriters := func() error {
		if err := tarWriter.Close(); err != nil {
			_ = gzipWriter.Close()
			return err
		}
		return gzipWriter.Close()
	}
	for _, rel := range paths {
		body, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil {
			return err
		}
		digest := sha256.Sum256(body)
		manifest.Files[rel] = hex.EncodeToString(digest[:])
		header := &tar.Header{Name: rel, Mode: 0600, Size: int64(len(body)), ModTime: now.UTC(), Typeflag: tar.TypeReg}
		if err = tarWriter.WriteHeader(header); err != nil {
			return err
		}
		if _, err = tarWriter.Write(body); err != nil {
			return err
		}
	}
	manifestBody, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err = tarWriter.WriteHeader(&tar.Header{Name: backupManifestName, Mode: 0600, Size: int64(len(manifestBody)), ModTime: now.UTC(), Typeflag: tar.TypeReg}); err != nil {
		return err
	}
	if _, err = tarWriter.Write(manifestBody); err != nil {
		return err
	}
	return closeWriters()
}

// RestoreBackup verifies every archived byte and the application's signed
// state before atomically placing a snapshot into an absent or empty target.
func RestoreBackup(destination string, integrityKey []byte, source io.Reader) error {
	if source == nil {
		return errors.New("backup source is required")
	}
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	if entries, err := os.ReadDir(destination); err == nil && len(entries) != 0 {
		return errors.New("restore destination must be absent or empty")
	} else if err != nil && !os.IsNotExist(err) {
		return err
	}
	temp, err := os.MkdirTemp(parent, ".ynx-video-restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	gzipReader, err := gzip.NewReader(io.LimitReader(source, 16<<30))
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	actual := map[string]string{}
	var manifest BackupManifest
	manifestSeen := false
	for {
		header, nextErr := tarReader.Next()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			return nextErr
		}
		name := filepath.ToSlash(filepath.Clean(header.Name))
		if header.Typeflag != tar.TypeReg || name == "." || strings.HasPrefix(name, "../") || filepath.IsAbs(header.Name) {
			return fmt.Errorf("unsafe backup entry %q", header.Name)
		}
		if name != backupManifestName && name != "state.json" && !strings.HasPrefix(name, "objects/") {
			return fmt.Errorf("unexpected backup entry %q", name)
		}
		if header.Size < 0 || header.Size > 8<<30 {
			return fmt.Errorf("backup entry size is outside bound: %q", name)
		}
		body, readErr := io.ReadAll(io.LimitReader(tarReader, header.Size+1))
		if readErr != nil || int64(len(body)) != header.Size {
			return fmt.Errorf("read backup entry %q: %w", name, readErr)
		}
		if name == backupManifestName {
			if manifestSeen || json.Unmarshal(body, &manifest) != nil {
				return errors.New("backup manifest is duplicate or invalid")
			}
			manifestSeen = true
			continue
		}
		if _, duplicate := actual[name]; duplicate {
			return fmt.Errorf("duplicate backup entry %q", name)
		}
		digest := sha256.Sum256(body)
		actual[name] = hex.EncodeToString(digest[:])
		target := filepath.Join(temp, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err = os.WriteFile(target, body, 0600); err != nil {
			return err
		}
	}
	if !manifestSeen || manifest.Format != "ynx-video-backup-v1" || !equalHashes(actual, manifest.Files) {
		return errors.New("backup manifest verification failed")
	}
	if _, err = OpenStore(temp, integrityKey); err != nil {
		return fmt.Errorf("restored state verification failed: %w", err)
	}
	if err = os.Remove(destination); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(temp, destination)
}

func equalHashes(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}
