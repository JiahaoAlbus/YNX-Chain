package consensus

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

func TestGenerateProductionCandidatePackageAndVerifyHostKeys(t *testing.T) {
	migration := fourValidatorMigration(t)
	validatorManifest, keyPaths := productionValidatorFixture(t, migration)
	root := filepath.Join(t.TempDir(), "candidate-package")
	genesisTime := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	manifest, err := GenerateProductionCandidatePackage(migration, validatorManifest, root, genesisTime)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.ChainID != "ynx_6423-1" || manifest.CandidateRoot != ProductionCandidateRoot || len(manifest.Roles) != 4 || len(manifest.Files) < 25 {
		t.Fatalf("unexpected production candidate package manifest: %+v", manifest)
	}
	if err := VerifyProductionCandidatePackage(root); err != nil {
		t.Fatal(err)
	}
	for _, node := range validatorManifest.Validators {
		roleDir := filepath.Join(root, "roles", node.Role)
		for _, path := range []string{
			filepath.Join(roleDir, "config", "config.toml"),
			filepath.Join(roleDir, "config", "genesis.json"),
			filepath.Join(roleDir, "config", "bound-migration.json"),
			filepath.Join(roleDir, "systemd", "ynx-consensus-abci-candidate.service"),
			filepath.Join(roleDir, "systemd", "ynx-consensus-comet-candidate.service"),
			filepath.Join(roleDir, "scripts", "install-candidate.sh"),
			filepath.Join(roleDir, "scripts", "backup-candidate.sh"),
			filepath.Join(roleDir, "scripts", "rollback-candidate.sh"),
			filepath.Join(roleDir, "scripts", "verify-candidate.sh"),
		} {
			if _, err := os.Stat(path); err != nil {
				t.Fatalf("missing production role artifact %s: %v", path, err)
			}
		}
		configPayload, err := os.ReadFile(filepath.Join(roleDir, "config", "config.toml"))
		if err != nil {
			t.Fatal(err)
		}
		configText := string(configPayload)
		if !strings.Contains(configText, "tcp://127.0.0.1:27757") || !strings.Contains(configText, "tcp://127.0.0.1:27858") || !strings.Contains(configText, "tcp://0.0.0.0:27656") || strings.Count(configText, "@10.42.0.") != 3 {
			t.Fatalf("role %s config does not enforce candidate listener and peer boundaries", node.Role)
		}
		servicePayload, err := os.ReadFile(filepath.Join(roleDir, "systemd", "ynx-consensus-comet-candidate.service"))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(servicePayload), ProductionCandidateRoot) || strings.Contains(string(servicePayload), "ynx-chaind") {
			t.Fatalf("role %s service does not preserve authoritative runtime boundary", node.Role)
		}
		installPayload, err := os.ReadFile(filepath.Join(roleDir, "scripts", "install-candidate.sh"))
		if err != nil || !strings.Contains(string(installPayload), "priv_validator_state.json") {
			t.Fatalf("role %s installer does not initialize CometBFT double-sign state", node.Role)
		}
	}
	first := validatorManifest.Validators[0]
	if err := VerifyProductionKeyFiles(filepath.Join(root, "roles", first.Role, "role-manifest.json"), keyPaths[first.Role][0], keyPaths[first.Role][1]); err != nil {
		t.Fatal(err)
	}
	other := validatorManifest.Validators[1]
	if err := VerifyProductionKeyFiles(filepath.Join(root, "roles", first.Role, "role-manifest.json"), keyPaths[other.Role][0], keyPaths[first.Role][1]); err == nil {
		t.Fatal("mismatched production validator key was accepted")
	}
	if err := os.Chmod(keyPaths[first.Role][1], 0o644); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionKeyFiles(filepath.Join(root, "roles", first.Role, "role-manifest.json"), keyPaths[first.Role][0], keyPaths[first.Role][1]); err == nil {
		t.Fatal("permissive production node key was accepted")
	}

	tampered := filepath.Join(root, "roles", first.Role, "config", "genesis.json")
	originalGenesis, err := os.ReadFile(tampered)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tampered, []byte("tampered\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionCandidatePackage(root); err == nil {
		t.Fatal("tampered production package was accepted")
	}
	if err := os.WriteFile(tampered, originalGenesis, 0o600); err != nil {
		t.Fatal(err)
	}
	roleManifestPath := filepath.Join(root, "roles", first.Role, "role-manifest.json")
	rolePayload, err := os.ReadFile(roleManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var roleManifest ProductionCandidateRoleManifest
	if err := json.Unmarshal(rolePayload, &roleManifest); err != nil {
		t.Fatal(err)
	}
	roleManifest.Node.PrivateP2PHost = "8.8.8.8"
	if err := writeJSON(roleManifestPath, roleManifest, 0o600); err != nil {
		t.Fatal(err)
	}
	rolePayload, err = os.ReadFile(roleManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	packageManifestPath := filepath.Join(root, "package-manifest.json")
	packagePayload, err := os.ReadFile(packageManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	var packageManifest ProductionCandidatePackageManifest
	if err := json.Unmarshal(packagePayload, &packageManifest); err != nil {
		t.Fatal(err)
	}
	roleRelative := filepath.Join("roles", first.Role, "role-manifest.json")
	roleSum := sha256.Sum256(rolePayload)
	packageManifest.Files[roleRelative] = hex.EncodeToString(roleSum[:])
	if err := writeJSON(packageManifestPath, packageManifest, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionCandidatePackage(root); err == nil {
		t.Fatal("semantically unsafe production package with self-consistent hashes was accepted")
	}
}

func TestProductionValidatorManifestRejectsUnsafeInputs(t *testing.T) {
	migration := fourValidatorMigration(t)
	manifest, _ := productionValidatorFixture(t, migration)
	if err := manifest.Validate(migration); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name   string
		mutate func(*ProductionValidatorManifest)
	}{
		{name: "public p2p host", mutate: func(value *ProductionValidatorManifest) { value.Validators[0].PrivateP2PHost = "8.8.8.8" }},
		{name: "noncanonical role", mutate: func(value *ProductionValidatorManifest) { value.Validators[0].Role = " primary" }},
		{name: "duplicate role", mutate: func(value *ProductionValidatorManifest) { value.Validators[1].Role = value.Validators[0].Role }},
		{name: "duplicate node ID", mutate: func(value *ProductionValidatorManifest) { value.Validators[1].NodeID = value.Validators[0].NodeID }},
		{name: "wrong consensus address", mutate: func(value *ProductionValidatorManifest) {
			value.Validators[0].ConsensusAddress = strings.Repeat("A", 40)
		}},
		{name: "missing validator", mutate: func(value *ProductionValidatorManifest) { value.Validators = value.Validators[:3] }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			candidate := manifest
			candidate.Validators = append([]ProductionValidatorNode(nil), manifest.Validators...)
			test.mutate(&candidate)
			if err := candidate.Validate(migration); err == nil {
				t.Fatalf("unsafe production validator manifest was accepted: %s", test.name)
			}
		})
	}
}

func TestProductionPackageRefusesExistingOutputAndUnhashedPrivateFile(t *testing.T) {
	migration := fourValidatorMigration(t)
	validatorManifest, _ := productionValidatorFixture(t, migration)
	root := filepath.Join(t.TempDir(), "existing")
	if err := os.Mkdir(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := GenerateProductionCandidatePackage(migration, validatorManifest, root, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)); err == nil {
		t.Fatal("existing production candidate output was overwritten")
	}
	root = filepath.Join(t.TempDir(), "candidate")
	if _, err := GenerateProductionCandidatePackage(migration, validatorManifest, root, time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_key.json"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := VerifyProductionCandidatePackage(root); err == nil {
		t.Fatal("unhashed private key path in production package was accepted")
	}
}

func TestProductionKeyCeremonyCreatesHostLocalKeysAndPublicRecord(t *testing.T) {
	root := t.TempDir()
	keyDir := filepath.Join(root, "keys")
	publicRecordPath := filepath.Join(root, "public-record.json")
	record, err := InitializeProductionKeyFiles("seoul", keyDir, publicRecordPath)
	if err != nil {
		t.Fatal(err)
	}
	if record.Role != "seoul" || record.ValidatorAddress != "ynx_validator_seoul" || record.CustodyBoundary != "owner-controlled-host-local" || !productionNodeIDPattern.MatchString(record.NodeID) || len(record.ConsensusAddress) != 40 {
		t.Fatalf("unexpected key ceremony public record: %+v", record)
	}
	for _, path := range []string{filepath.Join(keyDir, "priv_validator_key.json"), filepath.Join(keyDir, "priv_validator_state.json"), filepath.Join(keyDir, "node_key.json"), publicRecordPath} {
		info, err := os.Stat(path)
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			t.Fatalf("key ceremony file is missing or permissive: path=%s info=%v err=%v", path, info, err)
		}
	}
	publicPayload, err := os.ReadFile(publicRecordPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(string(publicPayload)), "priv_key") || strings.Contains(strings.ToLower(string(publicPayload)), "privatekey") || strings.Contains(strings.ToLower(string(publicPayload)), "mnemonic") {
		t.Fatal("key ceremony public record contains private material")
	}
	inspected, err := ReadProductionKeyRecord("seoul", keyDir)
	if err != nil || inspected != record {
		t.Fatalf("existing host keys did not reproduce the same public record: record=%+v err=%v", inspected, err)
	}
	if _, err := InitializeProductionKeyFiles("seoul", keyDir, filepath.Join(root, "second.json")); err == nil {
		t.Fatal("key ceremony overwrote an existing key directory")
	}
	if err := os.Chmod(filepath.Join(keyDir, "node_key.json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadProductionKeyRecord("seoul", keyDir); err == nil {
		t.Fatal("key ceremony inspection accepted a permissive private key file")
	}
}

func productionValidatorFixture(t *testing.T, migration chain.ConsensusMigrationState) (ProductionValidatorManifest, map[string][2]string) {
	t.Helper()
	manifest := ProductionValidatorManifest{Version: ProductionValidatorManifestVersion, Purpose: ProductionValidatorManifestPurpose, ChainID: "ynx_6423-1"}
	keyPaths := map[string][2]string{}
	for index, validator := range migration.Validators {
		role := productionValidatorRoles[validator.Address]
		keyDir := filepath.Join(t.TempDir(), role)
		if err := os.MkdirAll(filepath.Join(keyDir, "data"), 0o700); err != nil {
			t.Fatal(err)
		}
		privateValidatorKeyPath := filepath.Join(keyDir, "priv_validator_key.json")
		privateValidatorStatePath := filepath.Join(keyDir, "data", "priv_validator_state.json")
		privateValidator := privval.GenFilePV(privateValidatorKeyPath, privateValidatorStatePath)
		if err := savePrivateValidator(privateValidator); err != nil {
			t.Fatal(err)
		}
		nodeKeyPath := filepath.Join(keyDir, "node_key.json")
		nodeKey, err := p2p.LoadOrGenNodeKey(nodeKeyPath)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(nodeKeyPath, 0o600); err != nil {
			t.Fatal(err)
		}
		manifest.Validators = append(manifest.Validators, ProductionValidatorNode{
			ValidatorAddress: validator.Address,
			Role:             role,
			PrivateP2PHost:   "10.42.0." + string(rune('1'+index)),
			P2PPort:          27656,
			NodeID:           string(nodeKey.ID()),
			ConsensusKeyType: chain.ConsensusPubKeyTypeEd25519,
			ConsensusPubKey:  base64.StdEncoding.EncodeToString(privateValidator.Key.PubKey.Bytes()),
			ConsensusAddress: strings.ToUpper(hex.EncodeToString(privateValidator.Key.Address)),
		})
		keyPaths[role] = [2]string{privateValidatorKeyPath, nodeKeyPath}
	}
	payload, err := json.Marshal(manifest)
	if err != nil || strings.Contains(strings.ToLower(string(payload)), "priv_key") {
		t.Fatal("production validator fixture unexpectedly contains private key material")
	}
	return manifest, keyPaths
}
