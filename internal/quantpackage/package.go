package quantpackage

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
)

var ErrInvalidPackage = errors.New("invalid strategy package")

type Dependency struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	SHA256  string `json:"sha256"`
	License string `json:"license"`
}

type Permissions struct {
	HostFilesystem   bool `json:"hostFilesystem"`
	ArbitraryNetwork bool `json:"arbitraryNetwork"`
	WalletKey        bool `json:"walletKey"`
	ProviderSecret   bool `json:"providerSecret"`
}

type Limits struct {
	CPUMilliseconds  int64 `json:"cpuMilliseconds"`
	MemoryBytes      int64 `json:"memoryBytes"`
	WallMilliseconds int64 `json:"wallMilliseconds"`
	MaxInputBars     int   `json:"maxInputBars"`
}

type ScanEvidence struct {
	SecretScanPassed  bool   `json:"secretScanPassed"`
	MalwareScanPassed bool   `json:"malwareScanPassed"`
	ScannerVersion    string `json:"scannerVersion"`
	EvidenceSHA256    string `json:"evidenceSha256"`
}

type Manifest struct {
	Schema             int          `json:"schema"`
	PackageID          string       `json:"packageId"`
	Version            string       `json:"version"`
	Runtime            string       `json:"runtime"`
	SourceSHA256       string       `json:"sourceSha256"`
	ArtifactSHA256     string       `json:"artifactSha256"`
	Dependencies       []Dependency `json:"dependencies"`
	Permissions        Permissions  `json:"permissions"`
	Limits             Limits       `json:"limits"`
	DeterministicClock bool         `json:"deterministicClock"`
	CheckpointRecovery bool         `json:"checkpointRecovery"`
	Scan               ScanEvidence `json:"scan"`
	SignerKeyID        string       `json:"signerKeyId"`
	Signature          string       `json:"signature"`
}

type Verifier struct {
	TrustedSigners      map[string]ed25519.PublicKey
	DependencyAllowlist map[string]map[string]string
}

func LoadVerifier(keyringPath, allowlistPath string) (Verifier, error) {
	var keyring struct {
		Schema int               `json:"schema"`
		Keys   map[string]string `json:"keys"`
	}
	if err := decodeFile(keyringPath, &keyring); err != nil || keyring.Schema != 1 {
		return Verifier{}, ErrInvalidPackage
	}
	var allowlist struct {
		Schema       int                          `json:"schema"`
		Dependencies map[string]map[string]string `json:"dependencies"`
	}
	if err := decodeFile(allowlistPath, &allowlist); err != nil || allowlist.Schema != 1 {
		return Verifier{}, ErrInvalidPackage
	}
	verifier := Verifier{TrustedSigners: map[string]ed25519.PublicKey{}, DependencyAllowlist: allowlist.Dependencies}
	for id, encoded := range keyring.Keys {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if !validID(id) || err != nil || len(key) != ed25519.PublicKeySize {
			return Verifier{}, ErrInvalidPackage
		}
		verifier.TrustedSigners[id] = ed25519.PublicKey(key)
	}
	for _, versions := range verifier.DependencyAllowlist {
		for _, hash := range versions {
			if !digest(hash) {
				return Verifier{}, ErrInvalidPackage
			}
		}
	}
	return verifier, nil
}

func decodeFile(path string, target any) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return ErrInvalidPackage
	}
	return nil
}

func (v Verifier) Verify(manifest Manifest, artifactHash, sourceIdentity string, inputBars int) error {
	if manifest.Schema != 1 || !validID(manifest.PackageID) || strings.TrimSpace(manifest.Version) == "" || manifest.Runtime != "ynx-built-in-ma-v1" ||
		!manifest.DeterministicClock || !manifest.CheckpointRecovery || manifest.Permissions.HostFilesystem || manifest.Permissions.ArbitraryNetwork || manifest.Permissions.WalletKey || manifest.Permissions.ProviderSecret ||
		manifest.Limits.CPUMilliseconds <= 0 || manifest.Limits.CPUMilliseconds > 30_000 || manifest.Limits.MemoryBytes < 16<<20 || manifest.Limits.MemoryBytes > 512<<20 || manifest.Limits.WallMilliseconds <= 0 || manifest.Limits.WallMilliseconds > 60_000 || manifest.Limits.MaxInputBars <= 0 || inputBars > manifest.Limits.MaxInputBars ||
		!manifest.Scan.SecretScanPassed || !manifest.Scan.MalwareScanPassed || strings.TrimSpace(manifest.Scan.ScannerVersion) == "" || !digest(manifest.Scan.EvidenceSHA256) || !digest(manifest.SourceSHA256) || !digest(manifest.ArtifactSHA256) {
		return ErrInvalidPackage
	}
	if !strings.EqualFold(manifest.ArtifactSHA256, artifactHash) || !strings.EqualFold(manifest.SourceSHA256, hashString(sourceIdentity)) {
		return ErrInvalidPackage
	}
	for _, dependency := range manifest.Dependencies {
		versions, ok := v.DependencyAllowlist[dependency.Name]
		if !ok || versions[dependency.Version] == "" || !strings.EqualFold(versions[dependency.Version], dependency.SHA256) || strings.TrimSpace(dependency.License) == "" {
			return ErrInvalidPackage
		}
	}
	publicKey, ok := v.TrustedSigners[manifest.SignerKeyID]
	if !ok || len(publicKey) != ed25519.PublicKeySize {
		return ErrInvalidPackage
	}
	signature, err := base64.StdEncoding.DecodeString(manifest.Signature)
	if err != nil || !ed25519.Verify(publicKey, signingBytes(manifest), signature) {
		return ErrInvalidPackage
	}
	return nil
}

func Sign(manifest Manifest, privateKey ed25519.PrivateKey) Manifest {
	manifest.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(privateKey, signingBytes(manifest)))
	return manifest
}

func signingBytes(manifest Manifest) []byte {
	manifest.Signature = ""
	encoded, _ := json.Marshal(manifest)
	return encoded
}

func HashString(value string) string { return hashString(value) }
func hashString(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
func digest(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}
func validID(value string) bool {
	if len(value) < 3 || len(value) > 80 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' {
			return false
		}
	}
	return true
}
