package productsessionv2

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/sys/unix"
)

func backendKeyFixture(t *testing.T) (string, []byte, ed25519.PrivateKey) {
	t.Helper()
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	home, err = filepath.EvalSymlinks(home)
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(home, "ynx-backend-key-qa-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	_, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	data := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	return dir, data, key
}

func TestBackendKeyProtectedPKCS8(t *testing.T) {
	dir, data, expected := backendKeyFixture(t)
	file := filepath.Join(dir, "backend.pem")
	if err := os.WriteFile(file, data, 0600); err != nil {
		t.Fatal(err)
	}
	key, err := LoadBackendEd25519PrivateKey(file)
	if err != nil || !bytes.Equal(key, expected) {
		t.Fatal("protected key did not load")
	}
	message := []byte("synthetic-backend-proof")
	if !ed25519.Verify(key.Public().(ed25519.PublicKey), message, ed25519.Sign(key, message)) {
		t.Fatal("loaded key unusable")
	}
}

func TestBackendKeyRejectsUnsafeFilesWithoutDetails(t *testing.T) {
	for _, name := range []string{"relative", "missing", "symlink", "hardlink", "mode", "oversize", "malformed", "trailing", "prefix", "rsa", "fifo", "ancestor-symlink", "ancestor-writable"} {
		t.Run(name, func(t *testing.T) {
			dir, data, _ := backendKeyFixture(t)
			file := filepath.Join(dir, "backend.pem")
			if err := os.WriteFile(file, data, 0600); err != nil {
				t.Fatal(err)
			}
			switch name {
			case "relative":
				file = "relative.pem"
			case "missing":
				file = filepath.Join(dir, "missing.pem")
			case "symlink":
				alias := filepath.Join(dir, "alias.pem")
				if err := os.Symlink(file, alias); err != nil {
					t.Fatal(err)
				}
				file = alias
			case "hardlink":
				if err := os.Link(file, filepath.Join(dir, "other.pem")); err != nil {
					t.Fatal(err)
				}
			case "mode":
				if err := os.Chmod(file, 0644); err != nil {
					t.Fatal(err)
				}
			case "oversize":
				if err := os.WriteFile(file, bytes.Repeat([]byte("x"), 8193), 0600); err != nil {
					t.Fatal(err)
				}
			case "malformed":
				if err := os.WriteFile(file, []byte("invalid key material"), 0600); err != nil {
					t.Fatal(err)
				}
			case "trailing":
				if err := os.WriteFile(file, append(data, []byte("other secret text")...), 0600); err != nil {
					t.Fatal(err)
				}
			case "prefix":
				if err := os.WriteFile(file, append([]byte("unreviewed prefix\n"), data...), 0600); err != nil {
					t.Fatal(err)
				}
			case "rsa":
				k, err := rsa.GenerateKey(rand.Reader, 2048)
				if err != nil {
					t.Fatal(err)
				}
				der, err := x509.MarshalPKCS8PrivateKey(k)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
					t.Fatal(err)
				}
			case "fifo":
				file = filepath.Join(dir, "key-fifo")
				if err := unix.Mkfifo(file, 0600); err != nil {
					t.Fatal(err)
				}
			case "ancestor-symlink":
				alias := dir + "-alias"
				if err := os.Symlink(dir, alias); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { os.Remove(alias) })
				file = filepath.Join(alias, "backend.pem")
			case "ancestor-writable":
				if err := os.Chmod(dir, 0770); err != nil {
					t.Fatal(err)
				}
			}
			key, err := LoadBackendEd25519PrivateKey(file)
			var typed *Error
			if key != nil || !errors.As(err, &typed) || typed.Code != "INVALID_BACKEND_KEY_CONFIG" || typed.Status != 500 || strings.Contains(err.Error(), dir) {
				t.Fatal("unsafe key was accepted or configuration details leaked")
			}
		})
	}
}
