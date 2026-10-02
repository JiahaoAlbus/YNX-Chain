package productsessionv2

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackendKeyPEMSingleBlock(t *testing.T) {
	for _, name := range []string{"malformed-first-then-valid", "empty-first-then-valid", "mismatched-end-first-then-valid", "two-valid-blocks", "pem-headers", "whitespace-only-prefix-and-suffix", "nonclean-path"} {
		t.Run(name, func(t *testing.T) {
			dir, data, original := backendKeyFixture(t)
			file := filepath.Join(dir, "private-qa-only.pem")
			want := false
			switch name {
			case "malformed-first-then-valid":
				data = append([]byte("-----BEGIN PRIVATE KEY-----\nnot base64 secret placeholder\n-----END PRIVATE KEY-----\n"), data...)
			case "empty-first-then-valid":
				data = append([]byte("-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----\n"), data...)
			case "mismatched-end-first-then-valid":
				data = append([]byte("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PUBLIC KEY-----\n"), data...)
			case "two-valid-blocks":
				data = append(append([]byte(nil), data...), data...)
			case "pem-headers":
				der, e := x509.MarshalPKCS8PrivateKey(original)
				if e != nil {
					t.Fatal("fixture serialization failed")
				}
				data = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Headers: map[string]string{"Comment": "synthetic"}, Bytes: der})
			case "whitespace-only-prefix-and-suffix":
				data = append([]byte(" \n\t"), data...)
				data = append(data, []byte("\n \t")...)
				want = true
			case "nonclean-path":
				file = dir + "/./private-qa-only.pem"
			}
			if e := os.WriteFile(file, data, 0600); e != nil {
				t.Fatal("fixture write failed")
			}
			key, e := LoadBackendEd25519PrivateKey(file)
			if want {
				if e != nil || !bytes.Equal(key, original) {
					t.Fatal("normal protected PEM compatibility rejected")
				}
				if !ed25519.Verify(key.Public().(ed25519.PublicKey), []byte("qa"), ed25519.Sign(key, []byte("qa"))) {
					t.Fatal("loaded key did not sign")
				}
				return
			}
			var typed *Error
			if key != nil || !errors.As(e, &typed) || typed.Code != "INVALID_BACKEND_KEY_CONFIG" || typed.Status != 500 {
				t.Fatal("unreviewed prefix or multi-block key input accepted")
			}
			if strings.Contains(e.Error(), dir) || strings.Contains(e.Error(), "placeholder") {
				t.Fatal("sensitive config details in error")
			}
		})
	}
}
