package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	cmttypes "github.com/cometbft/cometbft/types"
)

const (
	ProductionValidatorManifestVersion = 1
	ProductionCandidatePackageVersion  = 1
	ProductionValidatorManifestPurpose = "ynx-production-bft-candidate-public-keys-only"
	ProductionCandidateRoot            = "/var/lib/ynx-chain/consensus-candidate"
	ProductionCandidateRPCPort         = 27757
	ProductionCandidateABCIPort        = 27858
	ProductionCandidateMetricsPort     = 27660
)

var (
	productionRolePattern    = regexp.MustCompile(`^[a-z][a-z0-9-]{0,31}$`)
	productionNodeIDPattern  = regexp.MustCompile(`^[0-9a-f]{40}$`)
	productionRoles          = map[string]struct{}{"primary": {}, "singapore": {}, "silicon-valley": {}, "seoul": {}}
	productionValidatorRoles = map[string]string{
		"ynx_validator_primary":        "primary",
		"ynx_validator_singapore":      "singapore",
		"ynx_validator_silicon_valley": "silicon-valley",
		"ynx_validator_seoul":          "seoul",
	}
)

// ProductionValidatorManifest is intentionally public-key-only. Private key
// paths are fixed host-local contracts and private key material is never input.
type ProductionValidatorManifest struct {
	Version    int                       `json:"version"`
	Purpose    string                    `json:"purpose"`
	ChainID    string                    `json:"chainId"`
	Validators []ProductionValidatorNode `json:"validators"`
}

type ProductionValidatorNode struct {
	ValidatorAddress string `json:"validatorAddress"`
	Role             string `json:"role"`
	PrivateP2PHost   string `json:"privateP2PHost"`
	P2PPort          int    `json:"p2pPort"`
	NodeID           string `json:"nodeId"`
	ConsensusKeyType string `json:"consensusKeyType"`
	ConsensusPubKey  string `json:"consensusPubKey"`
	ConsensusAddress string `json:"consensusAddress"`
}

type ProductionCandidateRoleManifest struct {
	Version                 int                     `json:"version"`
	Purpose                 string                  `json:"purpose"`
	ChainID                 string                  `json:"chainId"`
	CandidateRoot           string                  `json:"candidateRoot"`
	GenesisHash             string                  `json:"genesisHash"`
	MigrationStateHash      string                  `json:"migrationStateHash"`
	Node                    ProductionValidatorNode `json:"node"`
	PrivateValidatorKeyPath string                  `json:"privateValidatorKeyPath"`
	NodeKeyPath             string                  `json:"nodeKeyPath"`
}

type ProductionCandidatePackageManifest struct {
	Version            int               `json:"version"`
	Purpose            string            `json:"purpose"`
	ChainID            string            `json:"chainId"`
	CandidateRoot      string            `json:"candidateRoot"`
	GenesisHash        string            `json:"genesisHash"`
	MigrationStateHash string            `json:"migrationStateHash"`
	GenesisTime        string            `json:"genesisTime"`
	Roles              []string          `json:"roles"`
	Files              map[string]string `json:"files"`
}

func (m ProductionValidatorManifest) Validate(migration chain.ConsensusMigrationState) error {
	if err := migration.Validate(); err != nil {
		return fmt.Errorf("validate migration state: %w", err)
	}
	if m.Version != ProductionValidatorManifestVersion {
		return fmt.Errorf("unsupported production validator manifest version %d", m.Version)
	}
	if m.Purpose != ProductionValidatorManifestPurpose {
		return fmt.Errorf("production validator manifest purpose must be %q", ProductionValidatorManifestPurpose)
	}
	expectedChainID := fmt.Sprintf("ynx_%d-1", migration.Network.ChainID)
	if m.ChainID != expectedChainID {
		return fmt.Errorf("production validator manifest chain ID must be %s", expectedChainID)
	}
	if len(migration.Validators) != 4 || len(m.Validators) != 4 {
		return fmt.Errorf("production BFT candidate requires exactly 4 migration validators and 4 manifest validators")
	}
	expected := make(map[string]chain.ConsensusValidator, len(migration.Validators))
	for _, validator := range migration.Validators {
		if !validator.Active {
			return fmt.Errorf("production BFT validator %s must be active", validator.Address)
		}
		expected[validator.Address] = validator
	}
	roles := map[string]struct{}{}
	nodeIDs := map[string]struct{}{}
	consensusAddresses := map[string]struct{}{}
	hostPorts := map[string]struct{}{}
	bindings := make([]chain.ConsensusValidatorKeyBinding, 0, len(m.Validators))
	for _, node := range m.Validators {
		if node.ValidatorAddress != strings.TrimSpace(node.ValidatorAddress) || node.Role != strings.TrimSpace(node.Role) || node.PrivateP2PHost != strings.TrimSpace(node.PrivateP2PHost) || node.NodeID != strings.ToLower(strings.TrimSpace(node.NodeID)) || node.ConsensusAddress != strings.ToUpper(strings.TrimSpace(node.ConsensusAddress)) || node.ConsensusKeyType != strings.TrimSpace(node.ConsensusKeyType) || node.ConsensusPubKey != strings.TrimSpace(node.ConsensusPubKey) {
			return fmt.Errorf("production validator %q fields must use canonical whitespace and casing", node.ValidatorAddress)
		}
		if _, ok := expected[node.ValidatorAddress]; !ok {
			return fmt.Errorf("production validator %q is not an active migration validator", node.ValidatorAddress)
		}
		if !productionRolePattern.MatchString(node.Role) {
			return fmt.Errorf("production validator %s has invalid role %q", node.ValidatorAddress, node.Role)
		}
		if _, exists := roles[node.Role]; exists {
			return fmt.Errorf("duplicate production validator role %s", node.Role)
		}
		roles[node.Role] = struct{}{}
		if _, supported := productionRoles[node.Role]; !supported {
			return fmt.Errorf("production validator %s role %q is not one of the four approved server roles", node.ValidatorAddress, node.Role)
		}
		if expectedRole, ok := productionValidatorRoles[node.ValidatorAddress]; !ok || expectedRole != node.Role {
			return fmt.Errorf("production validator %s must use approved server role %q", node.ValidatorAddress, expectedRole)
		}
		ip := net.ParseIP(node.PrivateP2PHost)
		if ip == nil || ip.To4() == nil || !ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() {
			return fmt.Errorf("production validator %s P2P host must be an RFC1918 IPv4 address", node.ValidatorAddress)
		}
		if node.P2PPort < 1024 || node.P2PPort > 65535 || node.P2PPort == ProductionCandidateRPCPort || node.P2PPort == ProductionCandidateABCIPort || node.P2PPort == ProductionCandidateMetricsPort {
			return fmt.Errorf("production validator %s has invalid or overlapping P2P port %d", node.ValidatorAddress, node.P2PPort)
		}
		hostPort := net.JoinHostPort(node.PrivateP2PHost, strconv.Itoa(node.P2PPort))
		if _, exists := hostPorts[hostPort]; exists {
			return fmt.Errorf("duplicate production P2P endpoint %s", hostPort)
		}
		hostPorts[hostPort] = struct{}{}
		if !productionNodeIDPattern.MatchString(node.NodeID) {
			return fmt.Errorf("production validator %s has invalid CometBFT node ID", node.ValidatorAddress)
		}
		if _, exists := nodeIDs[node.NodeID]; exists {
			return fmt.Errorf("duplicate production CometBFT node ID %s", node.NodeID)
		}
		nodeIDs[node.NodeID] = struct{}{}
		if _, exists := consensusAddresses[node.ConsensusAddress]; exists {
			return fmt.Errorf("duplicate production consensus address %s", node.ConsensusAddress)
		}
		consensusAddresses[node.ConsensusAddress] = struct{}{}
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{
			ValidatorAddress: node.ValidatorAddress,
			KeyType:          strings.TrimSpace(node.ConsensusKeyType),
			PublicKey:        strings.TrimSpace(node.ConsensusPubKey),
			ConsensusAddress: node.ConsensusAddress,
		})
	}
	if len(expected) != len(roles) {
		return errors.New("production validator manifest does not bind every migration validator exactly once")
	}
	_, err := migration.BindConsensusValidatorKeys(bindings)
	return err
}

func GenerateProductionCandidatePackage(migration chain.ConsensusMigrationState, validatorManifest ProductionValidatorManifest, output string, genesisTime time.Time) (manifest ProductionCandidatePackageManifest, err error) {
	if err := validatorManifest.Validate(migration); err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	if genesisTime.IsZero() || !genesisTime.Equal(genesisTime.UTC().Truncate(time.Second)) {
		return ProductionCandidatePackageManifest{}, errors.New("production genesis time must be an explicit whole-second UTC timestamp")
	}
	root := filepath.Clean(strings.TrimSpace(output))
	if root == "." || root == "" {
		return ProductionCandidatePackageManifest{}, errors.New("production candidate output directory is required")
	}
	if _, statErr := os.Stat(root); !errors.Is(statErr, os.ErrNotExist) {
		if statErr == nil {
			return ProductionCandidatePackageManifest{}, fmt.Errorf("production candidate output already exists: %s", root)
		}
		return ProductionCandidatePackageManifest{}, statErr
	}
	if err := os.MkdirAll(filepath.Dir(root), 0o700); err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	if err := os.Mkdir(root, 0o700); err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	completed := false
	defer func() {
		if !completed {
			_ = os.RemoveAll(root)
		}
	}()

	bindings := make([]chain.ConsensusValidatorKeyBinding, 0, len(validatorManifest.Validators))
	for _, node := range validatorManifest.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: node.ValidatorAddress, KeyType: node.ConsensusKeyType, PublicKey: node.ConsensusPubKey, ConsensusAddress: node.ConsensusAddress})
	}
	boundMigration, err := migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		return manifest, err
	}
	genesis, err := BuildCometGenesis(boundMigration, genesisTime)
	if err != nil {
		return manifest, err
	}
	commonDir := filepath.Join(root, "common")
	if err := os.Mkdir(commonDir, 0o700); err != nil {
		return manifest, err
	}
	migrationPayload, err := boundMigration.CanonicalJSON()
	if err != nil {
		return manifest, err
	}
	if err := writeModeFile(filepath.Join(commonDir, "bound-migration.json"), append(migrationPayload, '\n'), 0o600); err != nil {
		return manifest, err
	}
	commonGenesisPath := filepath.Join(commonDir, "genesis.json")
	if err := genesis.SaveAs(commonGenesisPath); err != nil {
		return manifest, err
	}
	genesisPayload, err := os.ReadFile(commonGenesisPath)
	if err != nil {
		return manifest, err
	}
	genesisSum := sha256.Sum256(genesisPayload)
	genesisHash := hex.EncodeToString(genesisSum[:])

	nodes := append([]ProductionValidatorNode(nil), validatorManifest.Validators...)
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Role < nodes[j].Role })
	roles := make([]string, 0, len(nodes))
	for _, node := range nodes {
		roles = append(roles, node.Role)
		roleDir := filepath.Join(root, "roles", node.Role)
		for _, directory := range []string{"config", "systemd", "scripts"} {
			if err := os.MkdirAll(filepath.Join(roleDir, directory), 0o700); err != nil {
				return manifest, err
			}
		}
		if err := writeModeFile(filepath.Join(roleDir, "config", "genesis.json"), genesisPayload, 0o600); err != nil {
			return manifest, err
		}
		if err := writeModeFile(filepath.Join(roleDir, "config", "bound-migration.json"), append(migrationPayload, '\n'), 0o600); err != nil {
			return manifest, err
		}
		peers := make([]string, 0, len(nodes)-1)
		for _, peer := range nodes {
			if peer.Role != node.Role {
				peers = append(peers, peer.NodeID+"@"+net.JoinHostPort(peer.PrivateP2PHost, strconv.Itoa(peer.P2PPort)))
			}
		}
		sort.Strings(peers)
		config := cmtconfig.DefaultConfig().SetRoot(ProductionCandidateRoot)
		config.Moniker = node.Role
		config.ProxyApp = fmt.Sprintf("tcp://127.0.0.1:%d", ProductionCandidateABCIPort)
		config.ABCI = "socket"
		config.PrivValidatorKey = productionPrivateValidatorKeyPath(node.Role)
		config.PrivValidatorState = filepath.Join(ProductionCandidateRoot, "data", "priv_validator_state.json")
		config.NodeKey = productionNodeKeyPath(node.Role)
		config.Genesis = filepath.Join(ProductionCandidateRoot, "config", "genesis.json")
		config.RPC.ListenAddress = fmt.Sprintf("tcp://127.0.0.1:%d", ProductionCandidateRPCPort)
		config.P2P.ListenAddress = fmt.Sprintf("tcp://0.0.0.0:%d", node.P2PPort)
		config.P2P.ExternalAddress = fmt.Sprintf("tcp://%s:%d", node.PrivateP2PHost, node.P2PPort)
		config.P2P.PersistentPeers = strings.Join(peers, ",")
		config.P2P.AllowDuplicateIP = false
		config.P2P.AddrBookStrict = true
		config.Instrumentation.Prometheus = true
		config.Instrumentation.PrometheusListenAddr = fmt.Sprintf("127.0.0.1:%d", ProductionCandidateMetricsPort)
		if err := config.ValidateBasic(); err != nil {
			return manifest, fmt.Errorf("validate production CometBFT config for %s: %w", node.Role, err)
		}
		if err := writeCometConfig(filepath.Join(roleDir, "config", "config.toml"), config); err != nil {
			return manifest, err
		}
		if err := os.Chmod(filepath.Join(roleDir, "config", "config.toml"), 0o600); err != nil {
			return manifest, err
		}
		roleManifest := ProductionCandidateRoleManifest{
			Version:                 ProductionCandidatePackageVersion,
			Purpose:                 ProductionValidatorManifestPurpose,
			ChainID:                 validatorManifest.ChainID,
			CandidateRoot:           ProductionCandidateRoot,
			GenesisHash:             genesisHash,
			MigrationStateHash:      boundMigration.StateHash,
			Node:                    node,
			PrivateValidatorKeyPath: productionPrivateValidatorKeyPath(node.Role),
			NodeKeyPath:             productionNodeKeyPath(node.Role),
		}
		if err := writeJSON(filepath.Join(roleDir, "role-manifest.json"), roleManifest, 0o600); err != nil {
			return manifest, err
		}
		if err := writeProductionServices(roleDir, node.Role); err != nil {
			return manifest, err
		}
		if err := writeProductionRoleScripts(roleDir, node.Role); err != nil {
			return manifest, err
		}
	}
	manifest = ProductionCandidatePackageManifest{
		Version:            ProductionCandidatePackageVersion,
		Purpose:            ProductionValidatorManifestPurpose,
		ChainID:            validatorManifest.ChainID,
		CandidateRoot:      ProductionCandidateRoot,
		GenesisHash:        genesisHash,
		MigrationStateHash: boundMigration.StateHash,
		GenesisTime:        genesisTime.Format(time.RFC3339),
		Roles:              roles,
		Files:              map[string]string{},
	}
	files, err := packageFileHashes(root)
	if err != nil {
		return manifest, err
	}
	manifest.Files = files
	if err := writeJSON(filepath.Join(root, "package-manifest.json"), manifest, 0o600); err != nil {
		return manifest, err
	}
	if err := VerifyProductionCandidatePackage(root); err != nil {
		return manifest, err
	}
	completed = true
	return manifest, nil
}

func VerifyProductionCandidatePackage(root string) error {
	payload, err := os.ReadFile(filepath.Join(root, "package-manifest.json"))
	if err != nil {
		return fmt.Errorf("read production candidate package manifest: %w", err)
	}
	var manifest ProductionCandidatePackageManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return fmt.Errorf("decode production candidate package manifest: %w", err)
	}
	if manifest.Version != ProductionCandidatePackageVersion || manifest.Purpose != ProductionValidatorManifestPurpose || manifest.CandidateRoot != ProductionCandidateRoot || len(manifest.Roles) != 4 || len(manifest.Files) == 0 {
		return errors.New("production candidate package manifest is incomplete")
	}
	genesisTime, err := time.Parse(time.RFC3339, manifest.GenesisTime)
	if err != nil || !genesisTime.Equal(genesisTime.UTC().Truncate(time.Second)) {
		return errors.New("production candidate package genesis time is invalid")
	}
	commonGenesis, err := os.ReadFile(filepath.Join(root, "common", "genesis.json"))
	if err != nil {
		return fmt.Errorf("read common production genesis: %w", err)
	}
	genesisSum := sha256.Sum256(commonGenesis)
	if hex.EncodeToString(genesisSum[:]) != manifest.GenesisHash {
		return errors.New("production candidate common genesis hash does not match package manifest")
	}
	genesis, err := cmttypes.GenesisDocFromJSON(commonGenesis)
	if err != nil {
		return fmt.Errorf("decode common production genesis: %w", err)
	}
	if genesis.ChainID != manifest.ChainID || !genesis.GenesisTime.Equal(genesisTime) || len(genesis.Validators) != 4 {
		return errors.New("production candidate common genesis identity is inconsistent")
	}
	commonMigration, err := os.ReadFile(filepath.Join(root, "common", "bound-migration.json"))
	if err != nil {
		return fmt.Errorf("read common production migration: %w", err)
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(commonMigration, &migration); err != nil {
		return fmt.Errorf("decode common production migration: %w", err)
	}
	if err := migration.ValidateConsensusValidatorKeys(); err != nil {
		return fmt.Errorf("validate common production migration: %w", err)
	}
	appHash, err := hex.DecodeString(migration.StateHash)
	if err != nil || migration.StateHash != manifest.MigrationStateHash || !bytes.Equal(genesis.AppHash, appHash) {
		return errors.New("production candidate migration AppHash is inconsistent")
	}
	roleSet := map[string]struct{}{}
	nodes := make([]ProductionValidatorNode, 0, len(manifest.Roles))
	for _, role := range manifest.Roles {
		if _, supported := productionRoles[role]; !supported {
			return fmt.Errorf("production candidate package has unsupported role %q", role)
		}
		if _, duplicate := roleSet[role]; duplicate {
			return fmt.Errorf("production candidate package has duplicate role %q", role)
		}
		roleSet[role] = struct{}{}
		roleRoot := filepath.Join(root, "roles", role)
		rolePayload, err := os.ReadFile(filepath.Join(roleRoot, "role-manifest.json"))
		if err != nil {
			return err
		}
		var roleManifest ProductionCandidateRoleManifest
		if err := json.Unmarshal(rolePayload, &roleManifest); err != nil {
			return err
		}
		if roleManifest.Version != manifest.Version || roleManifest.Purpose != manifest.Purpose || roleManifest.ChainID != manifest.ChainID || roleManifest.CandidateRoot != manifest.CandidateRoot || roleManifest.GenesisHash != manifest.GenesisHash || roleManifest.MigrationStateHash != manifest.MigrationStateHash || roleManifest.Node.Role != role || roleManifest.PrivateValidatorKeyPath != productionPrivateValidatorKeyPath(role) || roleManifest.NodeKeyPath != productionNodeKeyPath(role) {
			return fmt.Errorf("production candidate role manifest for %s is inconsistent", role)
		}
		nodes = append(nodes, roleManifest.Node)
		roleGenesis, err := os.ReadFile(filepath.Join(roleRoot, "config", "genesis.json"))
		if err != nil || !bytes.Equal(roleGenesis, commonGenesis) {
			return fmt.Errorf("production candidate role %s genesis differs from common genesis", role)
		}
		roleMigration, err := os.ReadFile(filepath.Join(roleRoot, "config", "bound-migration.json"))
		if err != nil || !bytes.Equal(roleMigration, commonMigration) {
			return fmt.Errorf("production candidate role %s migration differs from common migration", role)
		}
		configPayload, err := os.ReadFile(filepath.Join(roleRoot, "config", "config.toml"))
		if err != nil {
			return err
		}
		configText := string(configPayload)
		for _, required := range []string{
			fmt.Sprintf(`proxy_app = "tcp://127.0.0.1:%d"`, ProductionCandidateABCIPort),
			fmt.Sprintf(`laddr = "tcp://127.0.0.1:%d"`, ProductionCandidateRPCPort),
			fmt.Sprintf(`laddr = "tcp://0.0.0.0:%d"`, roleManifest.Node.P2PPort),
			fmt.Sprintf(`external_address = "tcp://%s:%d"`, roleManifest.Node.PrivateP2PHost, roleManifest.Node.P2PPort),
			productionPrivateValidatorKeyPath(role),
			productionNodeKeyPath(role),
		} {
			if !strings.Contains(configText, required) {
				return fmt.Errorf("production candidate role %s config is missing required boundary %q", role, required)
			}
		}
		for _, peer := range nodesFromOtherRoles(manifest.Roles, role, root) {
			if !strings.Contains(configText, peer) {
				return fmt.Errorf("production candidate role %s config is missing peer %s", role, peer)
			}
		}
	}
	publicManifest := ProductionValidatorManifest{Version: ProductionValidatorManifestVersion, Purpose: ProductionValidatorManifestPurpose, ChainID: manifest.ChainID, Validators: nodes}
	if err := publicManifest.Validate(migration); err != nil {
		return fmt.Errorf("validate production candidate role set: %w", err)
	}
	for relativePath, expectedHash := range manifest.Files {
		clean := filepath.Clean(relativePath)
		if clean != relativePath || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) || strings.Contains(strings.ToLower(clean), "priv_validator_key") || strings.Contains(strings.ToLower(clean), "node_key.json") {
			return fmt.Errorf("unsafe production candidate package path %q", relativePath)
		}
		filePayload, err := os.ReadFile(filepath.Join(root, clean))
		if err != nil {
			return fmt.Errorf("read production candidate package file %s: %w", clean, err)
		}
		sum := sha256.Sum256(filePayload)
		if hex.EncodeToString(sum[:]) != expectedHash {
			return fmt.Errorf("production candidate package hash mismatch for %s", clean)
		}
	}
	seen := map[string]struct{}{}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry.IsDir() {
			return walkErr
		}
		relativePath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		if relativePath == "package-manifest.json" {
			return nil
		}
		if strings.Contains(strings.ToLower(relativePath), "priv_validator_key") || strings.Contains(strings.ToLower(relativePath), "node_key.json") {
			return fmt.Errorf("production candidate package contains forbidden private key path %s", relativePath)
		}
		if _, ok := manifest.Files[relativePath]; !ok {
			return fmt.Errorf("production candidate package contains unhashed file %s", relativePath)
		}
		seen[relativePath] = struct{}{}
		return nil
	})
	if err != nil {
		return err
	}
	if len(seen) != len(manifest.Files) {
		return errors.New("production candidate package file set does not match manifest")
	}
	return nil
}

func nodesFromOtherRoles(roles []string, currentRole, root string) []string {
	peers := make([]string, 0, len(roles)-1)
	for _, role := range roles {
		if role == currentRole {
			continue
		}
		payload, err := os.ReadFile(filepath.Join(root, "roles", role, "role-manifest.json"))
		if err != nil {
			continue
		}
		var roleManifest ProductionCandidateRoleManifest
		if json.Unmarshal(payload, &roleManifest) == nil {
			peers = append(peers, roleManifest.Node.NodeID+"@"+net.JoinHostPort(roleManifest.Node.PrivateP2PHost, strconv.Itoa(roleManifest.Node.P2PPort)))
		}
	}
	return peers
}

func VerifyProductionKeyFiles(roleManifestPath, privateValidatorKeyPath, nodeKeyPath string) error {
	payload, err := os.ReadFile(roleManifestPath)
	if err != nil {
		return fmt.Errorf("read production role manifest: %w", err)
	}
	var role ProductionCandidateRoleManifest
	if err := json.Unmarshal(payload, &role); err != nil {
		return fmt.Errorf("decode production role manifest: %w", err)
	}
	if role.Version != ProductionCandidatePackageVersion || role.Purpose != ProductionValidatorManifestPurpose || role.ChainID == "" {
		return errors.New("production role manifest is incomplete")
	}
	for _, path := range []string{privateValidatorKeyPath, nodeKeyPath} {
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("stat production key file: %w", err)
		}
		if !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
			return fmt.Errorf("production key file must be regular and mode restricted: %s", path)
		}
	}
	keyPayload, err := os.ReadFile(privateValidatorKeyPath)
	if err != nil {
		return err
	}
	var validatorKey privval.FilePVKey
	if err := cmtjson.Unmarshal(keyPayload, &validatorKey); err != nil {
		return fmt.Errorf("decode production private validator key: %w", err)
	}
	if validatorKey.PrivKey == nil || validatorKey.PubKey == nil || !bytes.Equal(validatorKey.PrivKey.PubKey().Bytes(), validatorKey.PubKey.Bytes()) {
		return errors.New("production private validator key does not match its public key")
	}
	if !strings.EqualFold(hex.EncodeToString(validatorKey.Address), role.Node.ConsensusAddress) || base64.StdEncoding.EncodeToString(validatorKey.PubKey.Bytes()) != role.Node.ConsensusPubKey {
		return errors.New("production private validator key does not match the approved role manifest")
	}
	nodeKey, err := p2p.LoadNodeKey(nodeKeyPath)
	if err != nil {
		return fmt.Errorf("decode production node key: %w", err)
	}
	if string(nodeKey.ID()) != strings.ToLower(role.Node.NodeID) {
		return errors.New("production node key does not match the approved role manifest")
	}
	return nil
}

func productionPrivateValidatorKeyPath(role string) string {
	return filepath.Join("/etc/ynx/consensus-candidate", role, "priv_validator_key.json")
}

func productionNodeKeyPath(role string) string {
	return filepath.Join("/etc/ynx/consensus-candidate", role, "node_key.json")
}

func writeProductionServices(roleDir, role string) error {
	abci := `[Unit]
Description=YNX Chain candidate ABCI application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ynx
Group=ynx
ExecStart=/usr/local/bin/ynx-abci -listen tcp://127.0.0.1:27858 -transport socket -migration-state /var/lib/ynx-chain/consensus-candidate/config/bound-migration.json -state /var/lib/ynx-chain/consensus-candidate/data/ynx-abci-state.json
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/etc/ynx/consensus-candidate
ReadWritePaths=/var/lib/ynx-chain/consensus-candidate
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`
	comet := fmt.Sprintf(`[Unit]
Description=YNX Chain candidate CometBFT validator (%s)
After=network-online.target ynx-consensus-abci-candidate.service
Wants=network-online.target
Requires=ynx-consensus-abci-candidate.service

[Service]
Type=simple
User=ynx
Group=ynx
ExecStart=/usr/local/bin/cometbft start --home /var/lib/ynx-chain/consensus-candidate
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=/etc/ynx/consensus-candidate
ReadWritePaths=/var/lib/ynx-chain/consensus-candidate
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`, role)
	if err := writeModeFile(filepath.Join(roleDir, "systemd", "ynx-consensus-abci-candidate.service"), []byte(abci), 0o644); err != nil {
		return err
	}
	return writeModeFile(filepath.Join(roleDir, "systemd", "ynx-consensus-comet-candidate.service"), []byte(comet), 0o644)
}

func writeProductionRoleScripts(roleDir, role string) error {
	scripts := map[string]string{
		"install-candidate.sh": fmt.Sprintf(`#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0 || { echo "candidate install requires root" >&2; exit 1; }
role_dir="$(cd "$(dirname "$0")/.." && pwd)"
key_dir=/etc/ynx/consensus-candidate/%s
command -v ynx-abci >/dev/null
command -v ynx-consensus-keycheck >/dev/null
command -v cometbft >/dev/null
test -s "$key_dir/priv_validator_key.json"
test -s "$key_dir/node_key.json"
ynx-consensus-keycheck -role-manifest "$role_dir/role-manifest.json" -private-validator-key "$key_dir/priv_validator_key.json" -node-key "$key_dir/node_key.json"
install -d -m 0700 -o ynx -g ynx /var/lib/ynx-chain/consensus-candidate/config /var/lib/ynx-chain/consensus-candidate/data
install -m 0600 -o ynx -g ynx "$role_dir/config/config.toml" /var/lib/ynx-chain/consensus-candidate/config/config.toml
install -m 0600 -o ynx -g ynx "$role_dir/config/genesis.json" /var/lib/ynx-chain/consensus-candidate/config/genesis.json
install -m 0600 -o ynx -g ynx "$role_dir/config/bound-migration.json" /var/lib/ynx-chain/consensus-candidate/config/bound-migration.json
install -m 0644 "$role_dir/systemd/ynx-consensus-abci-candidate.service" /etc/systemd/system/ynx-consensus-abci-candidate.service
install -m 0644 "$role_dir/systemd/ynx-consensus-comet-candidate.service" /etc/systemd/system/ynx-consensus-comet-candidate.service
systemctl daemon-reload
systemctl enable --now ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service
echo "candidate installed on parallel ports; authoritative ynx-chaind was not modified"
`, role),
		"backup-candidate.sh": `#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0 || { echo "candidate backup requires root" >&2; exit 1; }
output="${1:?candidate snapshot archive is required}"
test -d /var/lib/ynx-chain/consensus-candidate
mkdir -p "$(dirname "$output")"
partial="$output.partial"
rm -f "$partial"
tar -czf "$partial" /var/lib/ynx-chain/consensus-candidate /etc/systemd/system/ynx-consensus-abci-candidate.service /etc/systemd/system/ynx-consensus-comet-candidate.service
tar -tzf "$partial" >/dev/null
mv "$partial" "$output"
chmod 0600 "$output"
echo "candidate state snapshot created; validator private keys require separate owner-controlled backup"
`,
		"verify-candidate.sh": `#!/usr/bin/env bash
set -euo pipefail
for _attempt in $(seq 1 30); do
  if systemctl is-active --quiet ynx-consensus-abci-candidate.service && systemctl is-active --quiet ynx-consensus-comet-candidate.service && curl -fsS http://127.0.0.1:27757/status >/dev/null && curl -fsS http://127.0.0.1:27757/net_info >/dev/null; then
    echo "candidate services are active on loopback RPC"
    exit 0
  fi
  sleep 2
done
systemctl --no-pager --full status ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service >&2 || true
exit 1
`,
		"stop-candidate.sh": `#!/usr/bin/env bash
set -euo pipefail
systemctl stop ynx-consensus-comet-candidate.service ynx-consensus-abci-candidate.service
echo "candidate stopped; authoritative ynx-chaind was not modified"
`,
		"rollback-candidate.sh": `#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0 || { echo "candidate rollback requires root" >&2; exit 1; }
snapshot="${1:?candidate snapshot archive is required}"
test -s "$snapshot"
while IFS= read -r entry; do
  case "$entry" in
    var/lib/ynx-chain/consensus-candidate|var/lib/ynx-chain/consensus-candidate/*|etc/systemd/system/ynx-consensus-abci-candidate.service|etc/systemd/system/ynx-consensus-comet-candidate.service) ;;
    *) echo "unsafe candidate snapshot entry: $entry" >&2; exit 1 ;;
  esac
done < <(tar -tzf "$snapshot")
systemctl stop ynx-consensus-comet-candidate.service ynx-consensus-abci-candidate.service || true
rm -rf /var/lib/ynx-chain/consensus-candidate
tar -xzf "$snapshot" -C /
systemctl daemon-reload
echo "candidate state restored; authoritative ynx-chaind was not modified"
`,
	}
	for name, body := range scripts {
		if err := writeModeFile(filepath.Join(roleDir, "scripts", name), []byte(body), 0o755); err != nil {
			return err
		}
	}
	return nil
}

func packageFileHashes(root string) (map[string]string, error) {
	files := map[string]string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		payload, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(payload)
		files[relative] = hex.EncodeToString(sum[:])
		return nil
	})
	return files, err
}

func writeJSON(path string, value any, mode os.FileMode) error {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeModeFile(path, append(payload, '\n'), mode)
}

func writeModeFile(path string, payload []byte, mode os.FileMode) error {
	if err := os.WriteFile(path, payload, mode); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}
