package datafabricconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type KeyRegistry struct {
	Keys []KeyRegistration `json:"keys"`
}

type KeyRegistration struct {
	KeyID   string `json:"keyId"`
	Product string `json:"product"`
	KeyFile string `json:"keyFile"`
}

func LoadEventKeys(path string) (map[string][]byte, map[string]string, error) {
	if !filepath.IsAbs(path) {
		return nil, nil, errors.New("event key registry path must be absolute")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, nil, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return nil, nil, errors.New("event key registry must not be group/world accessible")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	var registry KeyRegistry
	if err := decoder.Decode(&registry); err != nil {
		return nil, nil, fmt.Errorf("decode event key registry: %w", err)
	}
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, nil, errors.New("event key registry contains trailing JSON")
	}
	if len(registry.Keys) == 0 {
		return nil, nil, errors.New("event key registry is empty")
	}
	keys := make(map[string][]byte, len(registry.Keys))
	products := make(map[string]string, len(registry.Keys))
	for _, registration := range registry.Keys {
		if registration.KeyID == "" || registration.Product == "" || !filepath.IsAbs(registration.KeyFile) {
			return nil, nil, errors.New("event key registration requires a keyId, product, and absolute keyFile")
		}
		if _, duplicate := keys[registration.KeyID]; duplicate {
			return nil, nil, fmt.Errorf("duplicate event keyId %s", registration.KeyID)
		}
		keyInfo, err := os.Stat(registration.KeyFile)
		if err != nil || keyInfo.Mode().Perm()&0o077 != 0 {
			return nil, nil, fmt.Errorf("event key file for %s is missing or has unsafe permissions", registration.KeyID)
		}
		key, err := os.ReadFile(registration.KeyFile)
		if err != nil {
			return nil, nil, err
		}
		key = []byte(strings.TrimSpace(string(key)))
		if len(key) < 32 {
			return nil, nil, fmt.Errorf("event key %s must contain at least 32 bytes", registration.KeyID)
		}
		keys[registration.KeyID] = key
		products[registration.KeyID] = registration.Product
	}
	return keys, products, nil
}

func LoadSecretFile(path, purpose string) ([]byte, error) {
	if !filepath.IsAbs(path) || purpose == "" {
		return nil, errors.New("secret file requires an absolute path and purpose")
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm()&0o077 != 0 {
		return nil, fmt.Errorf("%s secret file is missing or has unsafe permissions", purpose)
	}
	secret, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	secret = []byte(strings.TrimSpace(string(secret)))
	if len(secret) < 32 {
		return nil, fmt.Errorf("%s secret must contain at least 32 bytes", purpose)
	}
	return secret, nil
}

// ValidatePrivateFile validates a path that a downstream library must read
// itself (for example a NATS credentials or TLS private-key file).
func ValidatePrivateFile(path, purpose string) error {
	if !filepath.IsAbs(path) || purpose == "" {
		return errors.New("private file requires an absolute path and purpose")
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return fmt.Errorf("%s file is missing, not regular, or has unsafe permissions", purpose)
	}
	return nil
}
