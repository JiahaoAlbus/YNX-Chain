//go:build unix

package main

import (
	"archive/tar"
	"bytes"
	"errors"
	"io"
	"regexp"
	"time"
)

const capsuleContract = "YNX-CONSENSUS-PQ-RECOVERY-CAPSULE/v1"
const capsuleMaxArchive = 4 << 20

var capsuleHex = regexp.MustCompile(`^[a-f0-9]{64}$`)
var capsuleOperation = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,95}$`)

func capsuleNonzeroSHA256(value string) bool {
	return capsuleHex.MatchString(value) && value != "0000000000000000000000000000000000000000000000000000000000000000"
}

type capsuleProducer struct {
	Tool         string `json:"tool"`
	Contract     string `json:"contract"`
	BinarySHA256 string `json:"binarySHA256"`
}
type capsuleMember struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Bytes  int    `json:"bytes"`
	SHA256 string `json:"sha256"`
}
type capsuleEpoch struct {
	ChainID       string `json:"chainId"`
	Epoch         uint64 `json:"epoch"`
	GenesisSHA256 string `json:"genesisSHA256"`
}
type capsuleManifest struct {
	Schema      string          `json:"schema"`
	OperationID string          `json:"operationId"`
	Purpose     string          `json:"purpose"`
	Producer    capsuleProducer `json:"producer"`
	Epoch       capsuleEpoch    `json:"epoch"`
	Members     []capsuleMember `json:"members"`
}
type capsuleSpec struct {
	path, kind string
	maximum    int
}

var capsuleCatalog = []capsuleSpec{
	{"epoch/validator.encrypted", "normal-host-envelope", 32768},
	{"epoch/validator-binding.json", "public-binding", 256 << 10},
	{"epoch/original-sign-state.json", "signer-state-metadata", 2 << 20},
	{"epoch/new-epoch-public.json", "public-producer-receipt", 256 << 10},
	{"epoch/new-epoch-intent.json", "public-producer-receipt", 256 << 10},
	{"public/export-receipt.json", "public-producer-receipt", 256 << 10},
}

// A closed, canonical uncompressed USTAR encoding. Re-encoding on read rejects
// PAX, hidden members, aliases, links, padding tricks and nonzero trailing data.
func capsuleArchive(contents map[string][]byte) ([]byte, error) {
	if len(contents) != len(capsuleCatalog) {
		return nil, errors.New("closed capsule catalog required")
	}
	var b bytes.Buffer
	w := tar.NewWriter(&b)
	for _, spec := range capsuleCatalog {
		raw, ok := contents[spec.path]
		if !ok || len(raw) == 0 || len(raw) > spec.maximum {
			return nil, errors.New("bounded complete capsule member required")
		}
		h := &tar.Header{Name: spec.path, Mode: 0600, Size: int64(len(raw)), Typeflag: tar.TypeReg, ModTime: time.Unix(0, 0).UTC(), Format: tar.FormatUSTAR}
		if err := w.WriteHeader(h); err != nil {
			return nil, err
		}
		if _, err := w.Write(raw); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	if b.Len() > capsuleMaxArchive {
		return nil, errors.New("capsule archive exceeds bound")
	}
	return b.Bytes(), nil
}
func capsuleReadArchive(raw []byte, m capsuleManifest) (map[string][]byte, error) {
	if len(raw) == 0 || len(raw) > capsuleMaxArchive || m.Schema != "YNX_OFFHOST_RECOVERY_RECEIVE/v1" || !capsuleOperation.MatchString(m.OperationID) || m.Purpose != "NORMAL_ENCRYPTED_BACKUP_TRANSPORT" || m.Producer.Tool != "ynx-consensus-pq-key-init" || m.Producer.Contract != capsuleContract || !capsuleNonzeroSHA256(m.Producer.BinarySHA256) || m.Epoch.ChainID == "" || m.Epoch.Epoch == 0 || !capsuleNonzeroSHA256(m.Epoch.GenesisSHA256) || len(m.Members) != len(capsuleCatalog) {
		return nil, errors.New("capsule manifest differs from closed recovery contract")
	}
	contents := make(map[string][]byte, len(capsuleCatalog))
	r := tar.NewReader(bytes.NewReader(raw))
	for i, spec := range capsuleCatalog {
		member := m.Members[i]
		if member.Path != spec.path || member.Kind != spec.kind || member.Bytes <= 0 || member.Bytes > spec.maximum || !capsuleHex.MatchString(member.SHA256) {
			return nil, errors.New("capsule member contract differs")
		}
		h, err := r.Next()
		if err != nil || h.Name != spec.path || h.Size != int64(member.Bytes) || h.Typeflag != tar.TypeReg || h.Format != tar.FormatUSTAR || len(h.PAXRecords) != 0 || h.Linkname != "" {
			return nil, errors.New("capsule archive member differs")
		}
		data, err := io.ReadAll(io.LimitReader(r, int64(spec.maximum)+1))
		if err != nil || len(data) != member.Bytes || hash(data) != member.SHA256 {
			return nil, errors.New("capsule member hash differs")
		}
		contents[spec.path] = data
	}
	if _, err := r.Next(); err != io.EOF {
		return nil, errors.New("extra capsule archive member")
	}
	canonical, err := capsuleArchive(contents)
	if err != nil || !bytes.Equal(canonical, raw) {
		return nil, errors.New("capsule archive is not exact closed USTAR")
	}
	return contents, nil
}
