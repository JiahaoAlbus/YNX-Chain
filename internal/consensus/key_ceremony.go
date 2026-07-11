package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
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

func InitializeProductionKeyFiles(role, keyDir, publicRecordPath string) (record ProductionKeyCeremonyRecord, err error) {
	if _, ok := productionRoles[role]; !ok {
		return record, fmt.Errorf("unsupported production validator role %q", role)
	}
	keyDir = filepath.Clean(strings.TrimSpace(keyDir))
	if !filepath.IsAbs(keyDir) || keyDir == "/" {
		return record, errors.New("production key directory must be an absolute non-root path")
	}
	if _, statErr := os.Stat(keyDir); !errors.Is(statErr, os.ErrNotExist) {
		if statErr == nil {
			return record, fmt.Errorf("production key directory already exists: %s", keyDir)
		}
		return record, statErr
	}
	if strings.TrimSpace(publicRecordPath) == "" {
		return record, errors.New("public ceremony record path is required")
	}
	if err := os.Mkdir(keyDir, 0o700); err != nil {
		return record, err
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.RemoveAll(keyDir)
			_ = os.Remove(publicRecordPath)
		}
	}()
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
	}
	record, err = ReadProductionKeyRecord(role, keyDir)
	if err != nil {
		return record, err
	}
	if err := writeJSON(publicRecordPath, record, 0o600); err != nil {
		return record, err
	}
	completed = true
	return record, nil
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
