//go:build unix

package main

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

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"golang.org/x/sys/unix"
)

var errRetained = errors.New("new-epoch ceremony has retained original files; inspect and reconcile that original result, never delete/reset or automatically generate again")

type ceremonyPaths struct {
	Directory    string `json:"directory"`
	Marker       string `json:"marker"`
	Vault        string `json:"vault"`
	Binding      string `json:"binding"`
	State        string `json:"state"`
	PublicRecord string `json:"publicRecord"`
}

func (p ceremonyPaths) all() []string {
	return []string{p.Marker, p.Vault, p.Binding, p.State, p.State + ".lock", p.PublicRecord}
}
func (p ceremonyPaths) requireAbsent() error {
	for _, path := range p.all() {
		if _, err := os.Lstat(path); !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%w: target already exists or cannot be checked: %s", errRetained, path)
		}
	}
	return nil
}

type intentMarker struct {
	Format      string        `json:"format"`
	RequestHash string        `json:"requestSha256"`
	GenesisHash string        `json:"genesisSha256"`
	Request     epochRequest  `json:"request"`
	Paths       ceremonyPaths `json:"paths"`
}

type publicRecord struct {
	Format      string                          `json:"format"`
	Status      string                          `json:"status"`
	Paths       ceremonyPaths                   `json:"paths"`
	Binding     ynxconsensusauth.HostKeyBinding `json:"binding"`
	IntentWire  []byte                          `json:"registrationIntentWire"`
	PossessionA []byte                          `json:"possessionMLDSA87"`
	PossessionB []byte                          `json:"possessionSLHDSASHA2256f"`
	FileSHA256  map[string]string               `json:"fileSha256"`
}

// Private I/O seam for deterministic failure tests. Production always uses the
// real exclusive writer and original CreateSigner; no exported callback exists.
type ceremonyIO struct {
	writeExclusive func(string, []byte) error
	createState    func(string, *ynxconsensusauth.CandidateKey, ynxconsensusauth.Policy, ynxconsensusauth.Registry, []byte, uint64) (*ynxconsensusauth.Signer, error)
}

func realCeremonyIO() ceremonyIO {
	return ceremonyIO{writeExclusive: writeExclusive, createState: ynxconsensusauth.CreateSigner}
}

func createEpoch(request epochRequest, o options, p ceremonyPaths, credential []byte, disk ceremonyIO) (publicRecord, error) {
	var result publicRecord
	if disk.writeExclusive == nil || disk.createState == nil {
		return result, errors.New("missing ceremony filesystem")
	}
	marker := intentMarker{Format: "YNX-CONSENSUS-PQ-CEREMONY-INTENT/v1", RequestHash: o.requestHash, GenesisHash: o.genesisHash, Request: request, Paths: p}
	markerWire, err := json.Marshal(marker)
	if err != nil {
		return result, err
	}
	// First and permanent exclusion barrier. Even failed/partial key generation
	// leaves this marker. No catch path removes it or retries generation.
	if err = disk.writeExclusive(p.Marker, markerWire); err != nil {
		return result, fmt.Errorf("%w: intent marker: %w", errRetained, err)
	}
	fail := func(stage string, cause error) (publicRecord, error) {
		return publicRecord{}, fmt.Errorf("%w: %s: %w", errRetained, stage, cause)
	}
	key, material, err := ynxconsensusauth.GenerateCandidateKeyMaterial()
	if err != nil {
		return fail("independent key generation", err)
	}
	defer key.Destroy()
	defer material.Clear()
	i := request.Registration
	i.MLDSA87PublicKey, i.SLHDSASHA2256fPublicKey = bytes.Clone(material.PublicA), bytes.Clone(material.PublicB)
	intentWire, err := i.MarshalBinary()
	if err != nil {
		return fail("complete registration intent", err)
	}
	a, b, err := key.RegistrationPossession(i)
	if err != nil {
		return fail("new-pair possession proof", err)
	}
	binding := ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(i.GenesisID), ChainID: request.ChainID, ActivationHeight: request.ActivationHeight}, ValidatorAddress: bytes.Clone(request.ValidatorAddress), Epoch: request.Epoch, MLDSA87PublicKey: bytes.Clone(material.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(material.PublicB), SignerStatePath: p.State}
	if err = binding.Validate(); err != nil {
		return fail("complete host binding", err)
	}
	vault, err := ynxconsensusauth.SealHostKeyEnvelope(material, binding, credential)
	if err != nil {
		return fail("encrypted host envelope", err)
	}
	bindingWire, err := json.Marshal(binding)
	if err != nil {
		return fail("public binding encoding", err)
	}
	if err = disk.writeExclusive(p.Binding, bindingWire); err != nil {
		return fail("public binding", err)
	}
	if err = disk.writeExclusive(p.Vault, vault); err != nil {
		return fail("encrypted vault", err)
	}
	// Reserve even the lock file with O_EXCL. The original signer then locks this
	// same inode. Its HRS file itself is still created by original O_EXCL logic.
	if err = disk.writeExclusive(p.State+".lock", nil); err != nil {
		return fail("original lock reservation", err)
	}
	empty, err := ynxconsensusauth.NewKeyHistory(ynxconsensusauth.RegistryAnchor{GenesisID: bytes.Clone(i.GenesisID), ChainID: request.ChainID})
	if err != nil {
		return fail("genesis-only empty history", err)
	}
	signer, err := disk.createState(p.State, key, binding.Policy, empty, binding.ValidatorAddress, binding.Epoch)
	if signer != nil {
		err = errors.Join(err, signer.Close())
	}
	if err != nil {
		return fail("original new-epoch HRS creation", err)
	}
	stateWire, err := readRegular(p.State, 2<<20)
	if err != nil {
		return fail("original HRS readback", err)
	}
	result = publicRecord{Format: "YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1", Status: "new_epoch_files_durable_registration_not_authorized", Paths: p, Binding: binding, IntentWire: intentWire, PossessionA: a, PossessionB: b, FileSHA256: map[string]string{p.Marker: hash(markerWire), p.Vault: hash(vault), p.Binding: hash(bindingWire), p.State: hash(stateWire), p.State + ".lock": hash(nil)}}
	recordWire, err := json.Marshal(result)
	if err != nil || len(recordWire) > maxPublicRecordBytes {
		return fail("public record encoding", errors.New("invalid bounded public record"))
	}
	if err = disk.writeExclusive(p.PublicRecord, recordWire); err != nil {
		return fail("public record", err)
	}
	return result, nil
}

func hash(raw []byte) string { h := sha256.Sum256(raw); return hex.EncodeToString(h[:]) }

func writeExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	// O_EXCL is the only create mode; files are never removed on later failure.
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	err = errors.Join(writeErr, f.Sync(), f.Close())
	if err == nil {
		var dir *os.File
		dir, err = os.Open(filepath.Dir(path))
		if err == nil {
			err = errors.Join(dir.Sync(), dir.Close())
		}
	}
	if err != nil {
		return fmt.Errorf("%w: exclusive file may be visible: %v", ynxconsensusauth.ErrSignerDurabilityUncertain, err)
	}
	return nil
}

func readRegular(path string, maximum int64) ([]byte, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > maximum {
		return nil, errors.New("expected bounded regular file")
	}
	raw, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if err != nil || int64(len(raw)) > maximum {
		return nil, errors.New("bounded file read failed")
	}
	return raw, nil
}

type fileObservation struct {
	Path    string `json:"path"`
	Present bool   `json:"present"`
	Size    int    `json:"bytes"`
	SHA256  string `json:"sha256,omitempty"`
	Problem string `json:"problem,omitempty"`
}
type inspection struct {
	Status                 string            `json:"status"`
	ReadOnly               bool              `json:"readOnly"`
	PrivateMaterialOpened  bool              `json:"privateMaterialOpened"`
	RegistrationAuthorized bool              `json:"registrationAuthorized"`
	Files                  []fileObservation `json:"files"`
}

func inspectCeremony(directory string) (inspection, error) {
	report := inspection{Status: "incomplete_or_uncertain_original_result", ReadOnly: true}
	p, err := newPaths(directory)
	if err != nil {
		return report, err
	}
	contents := make(map[string][]byte)
	for _, path := range p.all() {
		x := fileObservation{Path: path}
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			report.Files = append(report.Files, x)
			continue
		}
		x.Present = true
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
			x.Problem = "not a private regular original file"
		} else {
			raw, readErr := readRegular(path, 2<<20)
			if readErr != nil {
				x.Problem = "original file cannot be safely read"
			} else {
				x.Size = len(raw)
				x.SHA256 = hash(raw)
				contents[path] = raw
			}
		}
		report.Files = append(report.Files, x)
	}
	var marker intentMarker
	var record publicRecord
	if decodeCanonical(contents[p.Marker], &marker) != nil || decodeCanonical(contents[p.PublicRecord], &record) != nil || marker.Format != "YNX-CONSENSUS-PQ-CEREMONY-INTENT/v1" || record.Format != "YNX-CONSENSUS-PQ-CEREMONY-PUBLIC/v1" || marker.Paths != p || record.Paths != p || len(record.FileSHA256) != 5 {
		return report, nil
	}
	requestWire, err := json.Marshal(marker.Request)
	if err != nil || !pinMatches(requestWire, marker.RequestHash) || marker.GenesisHash != hex.EncodeToString(marker.Request.Registration.GenesisID) || marker.Request.Format != requestFormat || marker.Request.ChainID != marker.Request.Registration.ChainID || marker.Request.Epoch != marker.Request.Registration.Epoch || !bytes.Equal(marker.Request.ValidatorAddress, marker.Request.Registration.ValidatorAddress) || record.Status != "new_epoch_files_durable_registration_not_authorized" {
		return report, nil
	}
	for _, path := range []string{p.Marker, p.Vault, p.Binding, p.State, p.State + ".lock"} {
		raw, ok := contents[path]
		if !ok || record.FileSHA256[path] != hash(raw) {
			return report, nil
		}
	}
	bindingWire, err := json.Marshal(record.Binding)
	if err != nil || !bytes.Equal(bindingWire, contents[p.Binding]) || record.Binding.Validate() != nil {
		return report, nil
	}
	i, err := ynxconsensusauth.DecodeRegistrationIntent(record.IntentWire)
	if err != nil {
		return report, nil
	}
	expected := marker.Request.Registration
	expected.MLDSA87PublicKey = record.Binding.MLDSA87PublicKey
	expected.SLHDSASHA2256fPublicKey = record.Binding.SLHDSASHA2256fPublicKey
	expectedWire, err := expected.MarshalBinary()
	if err != nil || !bytes.Equal(expectedWire, record.IntentWire) || !bytes.Equal(i.GenesisID, record.Binding.Policy.GenesisID) || i.ChainID != record.Binding.Policy.ChainID || i.Epoch != record.Binding.Epoch || !bytes.Equal(i.ValidatorAddress, record.Binding.ValidatorAddress) || record.Binding.SignerStatePath != p.State || record.Binding.Policy.ActivationHeight != marker.Request.ActivationHeight {
		return report, nil
	}
	message, err := i.PossessionSigningBytes()
	if err != nil {
		return report, nil
	}
	provider := ynxconsensusauth.CIRCLProvider{}
	errA := provider.VerifyMLDSA87(i.MLDSA87PublicKey, message, record.PossessionA)
	errB := provider.VerifySLHDSASHA2256f(i.SLHDSASHA2256fPublicKey, message, record.PossessionB)
	if errors.Join(errA, errB) != nil {
		return report, nil
	}
	// Readback is not a fresh fsync, decryption, membership proof or permission
	// to recreate anything. A running signer's later HRS will not match this
	// initial record; preserve it and reconcile via the normal resumed runtime.
	report.Status = "complete_original_public_hashes_and_possession_observed"
	return report, nil
}
