// Package productstore provides a small, fail-closed snapshot envelope for the
// two standalone ecosystem products. The checksum is an integrity signal, not
// an authentication secret; central Wallet/Gateway remains authoritative.
package productstore

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const envelopeVersion = 1

type envelope struct {
	EnvelopeVersion int             `json:"envelopeVersion"`
	Payload         json.RawMessage `json:"payload"`
	PayloadSHA256   string          `json:"payloadSha256"`
}

// Load decodes an integrity-protected snapshot. Legacy raw JSON snapshots are
// accepted only for the explicit one-way migration path and are rewritten on
// the next successful mutation.
func Load(path string, out any) (legacy bool, err error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read product store: %w", err)
	}
	var probe map[string]json.RawMessage
	if err := decodeExact(b, &probe); err != nil {
		return false, fmt.Errorf("decode product store: %w", err)
	}
	if _, ok := probe["envelopeVersion"]; !ok {
		if err := decodeExact(b, out); err != nil {
			return false, fmt.Errorf("decode legacy product store: %w", err)
		}
		return true, nil
	}
	var env envelope
	if err := decodeExact(b, &env); err != nil {
		return false, fmt.Errorf("decode product store envelope: %w", err)
	}
	if env.EnvelopeVersion != envelopeVersion || len(env.Payload) == 0 || len(env.PayloadSHA256) != 64 {
		return false, errors.New("product store envelope is incomplete or unsupported")
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, env.Payload); err != nil {
		return false, errors.New("product store payload is invalid JSON")
	}
	sum := sha256.Sum256(compact.Bytes())
	if hex.EncodeToString(sum[:]) != env.PayloadSHA256 {
		return false, errors.New("product store integrity check failed")
	}
	if err := decodeExact(env.Payload, out); err != nil {
		return false, fmt.Errorf("decode product store payload: %w", err)
	}
	return false, nil
}

func Save(path string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(payload)
	b, err := json.MarshalIndent(envelope{EnvelopeVersion: envelopeVersion, Payload: payload, PayloadSHA256: hex.EncodeToString(sum[:])}, "", "  ")
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if f, err := os.OpenFile(tmp, os.O_RDWR, 0); err != nil {
		return err
	} else if err := f.Sync(); err != nil {
		_ = f.Close()
		return err
	} else if err := f.Close(); err != nil {
		return err
	}
	if current, err := os.ReadFile(path); err == nil {
		if err := os.WriteFile(path+".bak", current, 0o600); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		defer d.Close()
		return d.Sync()
	}
	return nil
}

// RestoreBackup performs an explicit recovery from the last known snapshot.
// It validates the backup envelope before replacing the primary file and never
// silently converts a corrupted primary into a successful startup.
func RestoreBackup(path string, validateTarget any) error {
	backup := path + ".bak"
	if _, err := Load(backup, validateTarget); err != nil {
		return fmt.Errorf("validate product store backup: %w", err)
	}
	b, err := os.ReadFile(backup)
	if err != nil {
		return err
	}
	tmp := path + ".recover"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	return nil
}

func decodeExact(b []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if err := dec.Decode(out); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}
