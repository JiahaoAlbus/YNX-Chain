// Extracted unchanged from the selected 4fab parent storage primitives.
// See apps/cloud/IDE_DEPLOYMENT_SOURCE_INPUTS.json for exact supplier hashes.
// No Social business handlers or product-session permission logic is imported.
package cloud

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
)

type productWriteJournal struct{ root string }

var productWriteKey = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)

func newProductWriteJournal(root string) (*productWriteJournal, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("v2 idempotency directory must be private")
	}
	return &productWriteJournal{root: root}, nil
}

func productHash(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

func socialAtomicGuarded(file string, data []byte, guard func() error) error {
	if guard != nil {
		if err := guard(); err != nil {
			return err
		}
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".pending-")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	// No authority callback or network IO occurs at this final local fence.
	if guard != nil {
		if err = guard(); err != nil {
			return err
		}
	}
	if err = os.Rename(name, file); err != nil {
		return err
	}
	return socialSync(filepath.Dir(file))
}

func socialSync(dir string) error {
	f, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

func productReadFailure(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]string{"error": code, "code": code})
}
