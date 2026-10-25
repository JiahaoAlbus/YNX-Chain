package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

const isolatedKeyRecoveryVersion = "YNX-CONSENSUS-KEYCHECK-ISOLATED-RECOVERY/v1"
const isolatedKeyRecoveryDeliveryUnknown = "ISOLATED_KEY_RECOVERY_PUBLIC_DELIVERY_UNKNOWN"

type keyRecoveryStageError struct{ Stage string }

func (e keyRecoveryStageError) Error() string { return "ISOLATED_KEY_RECOVERY_REFUSED:" + e.Stage }

// These are the only private basenames this operation can read/copy. Neither
// a caller-selected archive nor a service constructor can add another path.
var recoveryPrivateNames = []string{"priv_validator_key.json", "priv_validator_state.json", "node_key.json"}

type isolatedKeyRecoveryReceipt struct {
	Version                  string                                `json:"version"`
	Role                     string                                `json:"role"`
	ServiceUID               int                                   `json:"serviceUID"`
	RoleManifestSHA256       string                                `json:"roleManifestSHA256"`
	SourceDirectory          string                                `json:"sourceDirectory"`
	PrivateRecoveryDirectory string                                `json:"privateRecoveryDirectory"`
	PublicRecord             consensus.ProductionKeyCeremonyRecord `json:"publicRecord"`
	SourceReadOnly           bool                                  `json:"sourceReadOnly"`
	SourceFilesUnchanged     bool                                  `json:"sourceFilesUnchanged"`
	BackupBytesMatched       bool                                  `json:"backupBytesMatched"`
	RestoreBytesMatched      bool                                  `json:"restoreBytesMatched"`
	RestoredIdentityMatched  bool                                  `json:"restoredIdentityMatched"`
	RestoredHRSConsistency   bool                                  `json:"restoredHRSConsistency"`
	ManifestMatched          bool                                  `json:"manifestMatched"`
	IsolatedRecoveryVerified bool                                  `json:"isolatedRecoveryVerified"`
	SameHost                 bool                                  `json:"sameHost"`
	OffHostRecoveryVerified  bool                                  `json:"offHostRecoveryVerified"`
	HRSHistoryVerified       bool                                  `json:"hrsHistoryVerified"`
	IndependentReview        bool                                  `json:"independentReview"`
	AuthorityGranted         bool                                  `json:"authorityGranted"`
	SigningPerformed         bool                                  `json:"signingPerformed"`
	LiveRestorePerformed     bool                                  `json:"liveRestorePerformed"`
	ServiceChanged           bool                                  `json:"serviceChanged"`
	RotationVerified         bool                                  `json:"rotationVerified"`
}

// Internal failure seam only. The production CLI has no test/env/host override.
type keyRecoveryIO struct {
	writeExclusive func(string, []byte) error
}

func realKeyRecoveryIO() keyRecoveryIO {
	return keyRecoveryIO{writeExclusive: writeKeyRecoveryExclusive}
}

func syncKeyRecoveryDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}

func writeKeyRecoveryExclusive(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	if err = errors.Join(writeErr, f.Sync(), f.Close()); err != nil {
		return err
	}
	return syncKeyRecoveryDirectory(filepath.Dir(path))
}

func keyRecoveryBytes(input *keycheckCustodyInput) ([]byte, error) {
	if err := input.checkIdentity(); err != nil {
		return nil, err
	}
	if _, err := input.file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(input.file, (64<<10)+1))
	if err != nil || len(raw) != int(input.info.Size()) || sha256.Sum256(raw) != input.digest {
		clear(raw)
		return nil, errors.New("original protected bytes changed")
	}
	if err = input.checkIdentity(); err != nil {
		clear(raw)
		return nil, err
	}
	return raw, nil
}

func verifyIsolatedKeyRecovery(role, source, output, manifestPath, manifestPin string, disk keyRecoveryIO) (receipt isolatedKeyRecoveryReceipt, resultErr error) {
	stage := "VALIDATE_INPUTS"
	// Only fixed stage names cross this boundary. In particular no private JSON
	// decoder, path-dependent IO diagnostic or injected failure text is public.
	defer func() {
		if resultErr != nil {
			receipt = isolatedKeyRecoveryReceipt{}
			resultErr = keyRecoveryStageError{Stage: stage}
		}
	}()
	if !validKeycheckInspectionRole(role) || !validKeycheckCustodyPath(source) || !validKeycheckCustodyPath(output) || !validKeycheckCustodyPath(manifestPath) || os.Getuid() != os.Geteuid() || disk.writeExclusive == nil {
		return receipt, errors.New("explicit original owner and isolated paths required")
	}
	pin, err := hex.DecodeString(manifestPin)
	if err != nil || len(pin) != 32 || hex.EncodeToString(pin) != manifestPin || bytes.Equal(pin, make([]byte, 32)) {
		return receipt, errors.New("independent exact public role manifest SHA256 required")
	}
	contains := func(parent, child string) bool {
		return parent == child || strings.HasPrefix(child, parent+string(filepath.Separator))
	}
	if contains(source, output) || contains(output, source) || contains(output, manifestPath) {
		return receipt, errors.New("isolated recovery cannot contain or change original custody")
	}
	if resolved, err := filepath.EvalSymlinks(source); err != nil || resolved != source {
		return receipt, errors.New("original custody path is not canonical")
	}
	if resolved, err := filepath.EvalSymlinks(manifestPath); err != nil || resolved != manifestPath {
		return receipt, errors.New("original public manifest path is not canonical")
	}
	parent := filepath.Dir(output)
	if resolved, err := filepath.EvalSymlinks(parent); err != nil || resolved != parent {
		return receipt, errors.New("existing canonical private recovery parent required")
	}
	// The normal privileged caller provisions this new private parent for the
	// SAME UID. The CLI never changes an existing owner, permissions or live path.
	parentInput, err := openKeycheckCustody(parent, true)
	if err != nil {
		return receipt, err
	}
	defer parentInput.file.Close()
	if _, err = os.Lstat(output); !errors.Is(err, os.ErrNotExist) {
		return receipt, errors.New("original recovery/UNKNOWN already exists")
	}
	var held []*keycheckCustodyInput
	defer func() {
		for _, input := range held {
			resultErr = errors.Join(resultErr, input.file.Close())
		}
	}()
	stage = "VALIDATE_MANIFEST"
	manifest, err := openKeycheckCustody(manifestPath, false)
	if err != nil {
		return receipt, err
	}
	held = append(held, manifest)
	rawManifest, err := keyRecoveryBytes(manifest)
	if err != nil {
		return receipt, err
	}
	defer clear(rawManifest)
	if manifest.digest != sha256.Sum256(rawManifest) || hex.EncodeToString(manifest.digest[:]) != manifestPin {
		return receipt, errors.New("public role manifest differs from independent pin")
	}
	var expected consensus.ProductionCandidateRoleManifest
	if json.Unmarshal(rawManifest, &expected) != nil || expected.Version != consensus.ProductionCandidatePackageVersion || expected.Purpose != consensus.ProductionValidatorManifestPurpose || expected.ChainID != "ynx_6423-1" || expected.Node.Role != role {
		return receipt, errors.New("original role manifest identity differs")
	}
	stage = "READ_ORIGINAL"
	directory, err := openKeycheckCustody(source, true)
	if err != nil {
		return receipt, err
	}
	held = append(held, directory)
	var originals []*keycheckCustodyInput
	for _, name := range recoveryPrivateNames {
		input, err := openKeycheckCustody(filepath.Join(source, name), false)
		if err != nil {
			return receipt, err
		}
		held = append(held, input)
		originals = append(originals, input)
	}
	stage = "VERIFY_ORIGINAL_TUPLE"
	public, err := inspectKeycheckPublicIdentity(role, source)
	if err != nil {
		return receipt, err
	}
	if err = consensus.VerifyProductionKeyFiles(manifestPath, filepath.Join(source, recoveryPrivateNames[0]), filepath.Join(source, recoveryPrivateNames[2])); err != nil {
		return receipt, errors.New("original key tuple differs from pinned role manifest")
	}
	if expected.Node.ValidatorAddress != public.PublicRecord.ValidatorAddress || expected.Node.ConsensusKeyType != public.PublicRecord.ConsensusKeyType {
		return receipt, errors.New("original logical validator or algorithm differs")
	}
	for _, input := range held {
		if err = input.unchanged(); err != nil {
			return receipt, err
		}
	}
	stage = "RESERVE_PRIVATE_CASE"
	if err = os.Mkdir(output, 0700); err != nil {
		return receipt, err
	}
	if err = syncKeyRecoveryDirectory(parent); err != nil {
		return receipt, err
	}
	// From here every failure retains its private original attempt. No cleanup,
	// implicit resume, live restore, new key, signing call or service call exists.
	intent, err := json.Marshal(struct {
		Version            string `json:"version"`
		Role               string `json:"role"`
		RoleManifestSHA256 string `json:"roleManifestSHA256"`
		Status             string `json:"status"`
		AutomaticRetry     bool   `json:"automaticRetry"`
	}{isolatedKeyRecoveryVersion, role, manifestPin, "unknown", false})
	if err != nil {
		return receipt, err
	}
	if err = disk.writeExclusive(filepath.Join(output, "intent.json"), intent); err != nil {
		return receipt, err
	}
	backup, restored := filepath.Join(output, "backup"), filepath.Join(output, "restored")
	for _, path := range []string{backup, restored} {
		if err = os.Mkdir(path, 0700); err != nil {
			return receipt, err
		}
	}
	if err = syncKeyRecoveryDirectory(output); err != nil {
		return receipt, err
	}
	stage = "BACKUP_RESTORE"
	for index, original := range originals {
		raw, err := keyRecoveryBytes(original)
		if err != nil {
			return receipt, err
		}
		name := recoveryPrivateNames[index]
		err = disk.writeExclusive(filepath.Join(backup, name), raw)
		clear(raw)
		if err != nil {
			return receipt, err
		}
		// Restore from the actual BACKUP file, never a second live-source copy.
		copy, err := openKeycheckCustody(filepath.Join(backup, name), false)
		if err != nil {
			return receipt, err
		}
		held = append(held, copy)
		if os.SameFile(copy.info, original.info) || copy.digest != original.digest {
			return receipt, errors.New("backup is aliased or differs from original bytes")
		}
		raw, err = keyRecoveryBytes(copy)
		if err != nil {
			return receipt, err
		}
		err = disk.writeExclusive(filepath.Join(restored, name), raw)
		clear(raw)
		if err != nil {
			return receipt, err
		}
		result, err := openKeycheckCustody(filepath.Join(restored, name), false)
		if err != nil {
			return receipt, err
		}
		held = append(held, result)
		if os.SameFile(result.info, copy.info) || os.SameFile(result.info, original.info) || result.digest != original.digest {
			return receipt, errors.New("restored file is aliased or differs from actual backup")
		}
	}
	stage = "VERIFY_RESTORED_TUPLE"
	if err = consensus.VerifyProductionKeyFiles(manifestPath, filepath.Join(restored, recoveryPrivateNames[0]), filepath.Join(restored, recoveryPrivateNames[2])); err != nil {
		return receipt, errors.New("restored normal keycheck rejected original key tuple")
	}
	restoredPublic, err := inspectKeycheckPublicIdentity(role, restored)
	if err != nil || restoredPublic.PublicRecord != public.PublicRecord {
		return receipt, errors.New("restored public identity differs")
	}
	stage = "VERIFY_RESTORED_HRS"
	pv, err := consensus.LoadPQOriginalLegacyValidator(filepath.Join(restored, recoveryPrivateNames[0]), filepath.Join(restored, recoveryPrivateNames[1]), expected.ChainID)
	if err != nil {
		return receipt, errors.New("restored legacy state is not internally consistent")
	}
	defer clear(pv.Key.PrivKey.Bytes())
	// This checks only this restored state's own key/signature/coordinates.
	// It cannot prove that any supplied HRS is the canonical live-chain history.
	stage = "RECHECK_ORIGINALS"
	for _, input := range held {
		if err = input.unchanged(); err != nil {
			return receipt, err
		}
	}
	stage = "PUBLISH_PRIVATE_RECEIPT"
	receipt = isolatedKeyRecoveryReceipt{Version: isolatedKeyRecoveryVersion, Role: role, ServiceUID: os.Geteuid(), RoleManifestSHA256: manifestPin, SourceDirectory: source, PrivateRecoveryDirectory: output, PublicRecord: public.PublicRecord, SourceReadOnly: true, SourceFilesUnchanged: true, BackupBytesMatched: true, RestoreBytesMatched: true, RestoredIdentityMatched: true, RestoredHRSConsistency: true, ManifestMatched: true, IsolatedRecoveryVerified: true, SameHost: true}
	rawReceipt, err := json.Marshal(receipt)
	if err != nil || len(rawReceipt) > 8191 {
		return isolatedKeyRecoveryReceipt{}, errors.New("bounded public recovery receipt required")
	}
	if err = disk.writeExclusive(filepath.Join(output, "receipt.public.json"), rawReceipt); err != nil {
		return isolatedKeyRecoveryReceipt{}, err
	}
	for _, input := range held {
		if err = input.unchanged(); err != nil {
			return isolatedKeyRecoveryReceipt{}, err
		}
	}
	return receipt, nil
}
