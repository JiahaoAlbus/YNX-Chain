//go:build unix

package consensus

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
	"regexp"
	"strconv"

	"golang.org/x/sys/unix"
)

const ProofHostDeliveryVersion = "YNX-CONSENSUS-PROOF-HOST-DELIVERY/v1"

// A delivery is public verification DATA. Its digest must arrive through the
// original operator's independently qualified private handoff. Neither this
// catalog nor a successful exclusive write establishes a Root or Host grant.
type ProofHostDeliveryBinding struct {
	OperationID     string `json:"operationId"`
	Account         string `json:"account"`
	NetworkID       string `json:"networkId"`
	OriginalHash    string `json:"originalHash"`
	NativeWireHash  string `json:"nativeWireHash"`
	TransactionHash string `json:"transactionHash"`
}

type ProofHostDeliveryFile struct {
	Role   string `json:"role"`
	Name   string `json:"name"`
	Bytes  string `json:"bytes"`
	SHA256 string `json:"sha256"`
}

type ProofHostDeliveryManifest struct {
	Version      string                   `json:"version"`
	SourceID     string                   `json:"sourceId"`
	Epoch        string                   `json:"epoch"`
	Binding      ProofHostDeliveryBinding `json:"binding"`
	SourceFile   string                   `json:"sourceFile"`
	SourceSHA256 string                   `json:"sourceSHA256"`
	Files        []ProofHostDeliveryFile  `json:"files"`
	TotalBytes   string                   `json:"totalBytes"`
}

type ProofHostDeliveryReceipt struct {
	Version              string `json:"version"`
	ManifestPath         string `json:"manifestPath"`
	ManifestSHA256       string `json:"manifestSHA256"`
	SourcePath           string `json:"sourcePath"`
	SourceSHA256         string `json:"sourceSHA256"`
	SourceID             string `json:"sourceId"`
	Epoch                string `json:"epoch"`
	PublicDataOnly       bool   `json:"publicDataOnly"`
	NativeRootAuthorized bool   `json:"nativeRootAuthorized"`
	DeploymentVerified   bool   `json:"deploymentVerified"`
}

type proofHostDeliveryRole struct {
	role, name string
	maximum    int64
}

// These are the unchanged normal Host reader bounds, not node admission limits.
// Runtime is optional, but its position is fixed when present.
var proofHostDeliveryRoles = [...]proofHostDeliveryRole{
	{"migration", "migration.json", 1 << 30},
	{"genesis", "genesis.json", 64 << 20},
	{"state", "committed-state.json", 1 << 30},
	{"schedule", "schedule.json", 32 << 10},
	{"runtime", "runtime-plan.json", 4096},
	{"trustedLightBlock", "trusted-light-block.json", 10 << 20},
	{"context", "trust-context.json", 44781228},
	{"lifecycle", "lifecycle.json", 4096},
	{"source", "host-source.json", 16384},
}

var (
	proofDeliveryHash      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	proofDeliveryAccount   = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
	proofDeliveryOperation = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
	proofDeliverySourceID  = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)
)

func proofHostDeliveryHash(raw []byte) string {
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

func validProofDeliveryHash(value string) bool {
	return proofDeliveryHash.MatchString(value) && value != string(bytes.Repeat([]byte{'0'}, 64))
}

// Validate everything that can fail before reserving a new destination. This
// function deliberately does not parse a JSON claim as operator authority.
func proofHostDeliveryManifest(destination string, captured ProofHostSourceExport) (ProofHostDeliveryManifest, []byte, error) {
	var manifest ProofHostDeliveryManifest
	if !filepath.IsAbs(destination) || filepath.Clean(destination) != destination || captured.SourcePath != filepath.Join(destination, "host-source.json") {
		return manifest, nil, errors.New("original canonical publication destination required")
	}
	epoch, err := strconv.ParseUint(captured.Epoch, 10, 64)
	if err != nil || epoch == 0 || strconv.FormatUint(epoch, 10) != captured.Epoch || !proofDeliverySourceID.MatchString(captured.SourceID) || !proofDeliveryOperation.MatchString(captured.OperationID) || !proofDeliveryAccount.MatchString(captured.Account) {
		return manifest, nil, errors.New("invalid original source or operation binding")
	}
	for _, hash := range []string{captured.SourceSHA256, captured.NetworkID, captured.NativeWireHash, captured.TransactionHash} {
		if !validProofDeliveryHash(hash) {
			return manifest, nil, errors.New("complete independently bound public digests required")
		}
	}
	if captured.OriginalHash != "0x"+captured.NativeWireHash || captured.Version != "YNX-PROOF-HOST-SOURCE-EXPORT/v1" || !captured.SourceReadOnly || !captured.LedgerProofVerified || captured.NativeRootAuthorized || captured.DeploymentVerified {
		return manifest, nil, errors.New("delivery requires the readonly ledger capture and cannot confer authority")
	}
	if len(captured.Files) != 8 && len(captured.Files) != 9 {
		return manifest, nil, errors.New("exact public source file set required")
	}
	manifest = ProofHostDeliveryManifest{Version: ProofHostDeliveryVersion, SourceID: captured.SourceID, Epoch: captured.Epoch,
		Binding: ProofHostDeliveryBinding{OperationID: captured.OperationID, Account: captured.Account, NetworkID: captured.NetworkID,
			OriginalHash: captured.OriginalHash, NativeWireHash: captured.NativeWireHash, TransactionHash: captured.TransactionHash},
		SourceFile: "host-source.json", SourceSHA256: captured.SourceSHA256, Files: make([]ProofHostDeliveryFile, 0, len(captured.Files))}
	var total uint64
	index := 0
	for _, role := range proofHostDeliveryRoles {
		if role.role == "runtime" && len(captured.Files) == 8 {
			continue
		}
		file := captured.Files[index]
		if file.Role != role.role || file.Name != role.name || len(file.Bytes) == 0 || int64(len(file.Bytes)) > role.maximum || !validProofDeliveryHash(file.SHA256) || proofHostDeliveryHash(file.Bytes) != file.SHA256 {
			return ProofHostDeliveryManifest{}, nil, fmt.Errorf("public source role or byte pin differs: %s", role.role)
		}
		if role.role == "source" && file.SHA256 != captured.SourceSHA256 {
			return ProofHostDeliveryManifest{}, nil, errors.New("source bytes differ from captured source pin")
		}
		total += uint64(len(file.Bytes))
		manifest.Files = append(manifest.Files, ProofHostDeliveryFile{Role: role.role, Name: role.name, Bytes: strconv.Itoa(len(file.Bytes)), SHA256: file.SHA256})
		index++
	}
	manifest.TotalBytes = strconv.FormatUint(total, 10)
	raw, err := json.Marshal(manifest)
	if err != nil || len(raw)+1 > 16384 {
		return ProofHostDeliveryManifest{}, nil, errors.New("public delivery catalog exceeds normal bound")
	}
	return manifest, append(raw, '\n'), nil
}

func syncProofDeliveryDirectory(directory string) error {
	f, err := os.Open(directory)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}

// Keep an incomplete file on any error. An operator must reconcile the original
// attempt; neither a partial file nor an existing directory authorizes retry.
func writeProofDeliveryExclusive(directory, name string, raw []byte, expectedSHA256 string) (err error) {
	path := filepath.Join(directory, name)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := f.Close(); err == nil {
			err = closeErr
		}
	}()
	before, err := f.Stat()
	if err != nil {
		return err
	}
	n, err := io.Copy(f, bytes.NewReader(raw))
	if err != nil || n != int64(len(raw)) {
		return errors.New("incomplete public delivery write; original attempt retained")
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	h := sha256.New()
	n, err = io.Copy(h, io.LimitReader(f, int64(len(raw))+1))
	after, statErr := f.Stat()
	pathInfo, pathErr := os.Lstat(path)
	var stat unix.Stat_t
	if err != nil || statErr != nil || pathErr != nil || unix.Fstat(int(f.Fd()), &stat) != nil || stat.Nlink != 1 || !os.SameFile(before, after) || !os.SameFile(after, pathInfo) || !after.Mode().IsRegular() || after.Mode().Perm() != 0600 || after.Size() != int64(len(raw)) || n != int64(len(raw)) || hex.EncodeToString(h.Sum(nil)) != expectedSHA256 {
		return errors.New("public delivery readback differs; original attempt retained")
	}
	return syncProofDeliveryDirectory(directory)
}

// WriteProofHostDelivery is the normal operator publisher for an already
// verified capture. It never opens keys, signs, starts a node or changes ledger
// state. The caller separately qualifies the original operator and delivery SHA.
// delivery.json is published LAST after all public files have been fsynced and
// read back. A missing manifest denotes an incomplete retained attempt.
func WriteProofHostDelivery(destination string, captured ProofHostSourceExport) (ProofHostDeliveryReceipt, error) {
	var receipt ProofHostDeliveryReceipt
	manifest, raw, err := proofHostDeliveryManifest(destination, captured)
	if err != nil {
		return receipt, err
	}
	parent := filepath.Dir(destination)
	resolved, err := filepath.EvalSymlinks(parent)
	info, statErr := os.Lstat(parent)
	var parentStat unix.Stat_t
	if err != nil || statErr != nil || resolved != parent || !info.IsDir() || info.Mode().Perm() != 0700 || info.Mode()&(os.ModeSticky|os.ModeSetuid|os.ModeSetgid) != 0 || unix.Lstat(parent, &parentStat) != nil || parentStat.Uid != uint32(os.Geteuid()) {
		return receipt, errors.New("original canonical private publication parent required")
	}
	if err = os.Mkdir(destination, 0700); err != nil {
		return receipt, err
	}
	if err = syncProofDeliveryDirectory(parent); err != nil {
		return receipt, err
	}
	for index, entry := range manifest.Files {
		file := captured.Files[index]
		if file.Role != entry.Role || file.Name != entry.Name || strconv.Itoa(len(file.Bytes)) != entry.Bytes {
			return receipt, errors.New("public capture changed after validation; original attempt retained")
		}
		if err = writeProofDeliveryExclusive(destination, entry.Name, file.Bytes, entry.SHA256); err != nil {
			return receipt, err
		}
	}
	if err = writeProofDeliveryExclusive(destination, "delivery.json", raw, proofHostDeliveryHash(raw)); err != nil {
		return receipt, err
	}
	return ProofHostDeliveryReceipt{Version: "YNX-CONSENSUS-PROOF-HOST-DELIVERY-RECEIPT/v1", ManifestPath: filepath.Join(destination, "delivery.json"),
		ManifestSHA256: proofHostDeliveryHash(raw), SourcePath: captured.SourcePath, SourceSHA256: manifest.SourceSHA256,
		SourceID: manifest.SourceID, Epoch: manifest.Epoch, PublicDataOnly: true, NativeRootAuthorized: false, DeploymentVerified: false}, nil
}
