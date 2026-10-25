package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

type ProductionKeyCeremonyRecord struct {
	Version          int    `json:"version"`
	Purpose          string `json:"purpose"`
	Role             string `json:"role"`
	ValidatorAddress string `json:"validatorAddress"`
	ConsensusKeyType string `json:"consensusKeyType"`
	ConsensusPubKey  string `json:"consensusPubKey"`
	ConsensusAddress string `json:"consensusAddress"`
	NodeID           string `json:"nodeId"`
	CustodyBoundary  string `json:"custodyBoundary"`
}

const productionKeyCeremonyIntentFile = "new-key-intent.json"

var errProductionKeyCeremonyRetained = errors.New("production key ceremony attempt retained; inspect the original directory and do not delete, reset or automatically generate again")

func InitializeProductionKeyFiles(role, keyDir, publicRecordPath string) (record ProductionKeyCeremonyRecord, err error) {
	if _, ok := productionRoles[role]; !ok {
		return record, fmt.Errorf("unsupported production validator role %q", role)
	}
	keyDir = filepath.Clean(strings.TrimSpace(keyDir))
	if !filepath.IsAbs(keyDir) || keyDir == "/" {
		return record, errors.New("production key directory must be an absolute non-root path")
	}
	if _, statErr := os.Lstat(keyDir); !errors.Is(statErr, os.ErrNotExist) {
		if statErr == nil {
			return record, fmt.Errorf("production key directory already exists: %s", keyDir)
		}
		return record, statErr
	}
	if strings.TrimSpace(publicRecordPath) == "" {
		return record, errors.New("public ceremony record path is required")
	}
	// Reject even a dangling symlink before reserving a new ceremony. An old
	// public record is evidence, never permission to recreate its private keys.
	if _, statErr := os.Lstat(publicRecordPath); !errors.Is(statErr, os.ErrNotExist) {
		if statErr == nil {
			return record, fmt.Errorf("production public ceremony record already exists: %s", publicRecordPath)
		}
		return record, statErr
	}
	if err := os.Mkdir(keyDir, 0o700); err != nil {
		return record, err
	}
	// Mkdir is the exclusive ownership barrier. Once it succeeds every failure
	// preserves this attempt, including incomplete writes and uncertain syncs.
	defer func() {
		if err != nil {
			err = fmt.Errorf("%w: %w", errProductionKeyCeremonyRetained, err)
		}
	}()
	if err = syncProductionKeyCeremonyDirectory(filepath.Dir(keyDir)); err != nil {
		return record, err
	}
	intent, err := json.Marshal(struct {
		Version          string `json:"version"`
		Role             string `json:"role"`
		KeyDirectory     string `json:"keyDirectory"`
		PublicRecordPath string `json:"publicRecordPath"`
	}{"YNX-PRODUCTION-KEY-CEREMONY-INTENT/v1", role, keyDir, publicRecordPath})
	if err != nil {
		return record, err
	}
	if err = writeProductionKeyCeremonyExclusive(filepath.Join(keyDir, productionKeyCeremonyIntentFile), intent); err != nil {
		return record, err
	}
	validatorKeyPath := filepath.Join(keyDir, "priv_validator_key.json")
	validatorStatePath := filepath.Join(keyDir, "priv_validator_state.json")
	privateValidator := privval.GenFilePV(validatorKeyPath, validatorStatePath)
	if err := savePrivateValidator(privateValidator); err != nil {
		return record, err
	}
	nodeKeyPath := filepath.Join(keyDir, "node_key.json")
	if _, err := p2p.LoadOrGenNodeKey(nodeKeyPath); err != nil {
		return record, err
	}
	for _, path := range []string{validatorKeyPath, validatorStatePath, nodeKeyPath} {
		if err := os.Chmod(path, 0o600); err != nil {
			return record, err
		}
		if err := syncProductionKeyCeremonyFile(path); err != nil {
			return record, err
		}
	}
	if err = syncProductionKeyCeremonyDirectory(keyDir); err != nil {
		return record, err
	}
	record, err = ReadProductionKeyRecord(role, keyDir)
	if err != nil {
		return record, err
	}
	payload, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return record, err
	}
	// Recheck through O_EXCL at the actual write, not only at preflight. A
	// concurrent public record must never be truncated or removed on failure.
	if err := writeProductionKeyCeremonyExclusive(publicRecordPath, append(payload, '\n')); err != nil {
		return record, err
	}
	return record, nil
}

func syncProductionKeyCeremonyDirectory(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}

func syncProductionKeyCeremonyFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	return errors.Join(f.Sync(), f.Close())
}

func writeProductionKeyCeremonyExclusive(path string, payload []byte) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(payload)
	if writeErr == nil && n != len(payload) {
		writeErr = io.ErrShortWrite
	}
	if err := errors.Join(writeErr, f.Sync(), f.Close()); err != nil {
		return err
	}
	return syncProductionKeyCeremonyDirectory(filepath.Dir(path))
}

func ReadProductionKeyRecord(role, keyDir string) (ProductionKeyCeremonyRecord, error) {
	validatorAddress := ""
	for address, expectedRole := range productionValidatorRoles {
		if expectedRole == role {
			validatorAddress = address
			break
		}
	}
	if validatorAddress == "" {
		return ProductionKeyCeremonyRecord{}, fmt.Errorf("unsupported production validator role %q", role)
	}
	validatorKeyPath := filepath.Join(keyDir, "priv_validator_key.json")
	nodeKeyPath := filepath.Join(keyDir, "node_key.json")
	for _, path := range []string{validatorKeyPath, filepath.Join(keyDir, "priv_validator_state.json"), nodeKeyPath} {
		info, err := os.Stat(path)
		if err != nil {
			return ProductionKeyCeremonyRecord{}, err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return ProductionKeyCeremonyRecord{}, fmt.Errorf("production key ceremony file must be mode restricted: %s", path)
		}
	}
	keyPayload, err := os.ReadFile(validatorKeyPath)
	if err != nil {
		return ProductionKeyCeremonyRecord{}, err
	}
	var validatorKey privval.FilePVKey
	if err := cmtjson.Unmarshal(keyPayload, &validatorKey); err != nil {
		return ProductionKeyCeremonyRecord{}, err
	}
	if validatorKey.PrivKey == nil || validatorKey.PubKey == nil || !bytes.Equal(validatorKey.PrivKey.PubKey().Bytes(), validatorKey.PubKey.Bytes()) {
		return ProductionKeyCeremonyRecord{}, errors.New("production private validator key does not match its public key")
	}
	publicBytes := validatorKey.PubKey.Bytes()
	if len(publicBytes) != 32 {
		return ProductionKeyCeremonyRecord{}, errors.New("production validator public key is invalid")
	}
	derived := sha256Address(publicBytes)
	if !strings.EqualFold(hex.EncodeToString(validatorKey.Address), derived) {
		return ProductionKeyCeremonyRecord{}, errors.New("production validator public key does not match its address")
	}
	nodeKey, err := p2p.LoadNodeKey(nodeKeyPath)
	if err != nil {
		return ProductionKeyCeremonyRecord{}, err
	}
	return ProductionKeyCeremonyRecord{
		Version:          1,
		Purpose:          ProductionValidatorManifestPurpose,
		Role:             role,
		ValidatorAddress: validatorAddress,
		ConsensusKeyType: chain.ConsensusPubKeyTypeEd25519,
		ConsensusPubKey:  base64.StdEncoding.EncodeToString(publicBytes),
		ConsensusAddress: derived,
		NodeID:           string(nodeKey.ID()),
		CustodyBoundary:  "owner-controlled-host-local",
	}, nil
}

func sha256Address(publicKey []byte) string {
	sum := sha256.Sum256(publicKey)
	return strings.ToUpper(hex.EncodeToString(sum[:20]))
}
