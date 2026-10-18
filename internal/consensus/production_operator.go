package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cmtconfig "github.com/cometbft/cometbft/config"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/spf13/viper"
)

const ProductionOperatorPlanVersion = "YNX-PRODUCTION-OPERATOR/v1"
const MaxProductionOperatorPlanBytes = 96 << 20

// ProductionOperatorPlan is public, independently pinned operator input. It
// carries the exact ORIGINAL genesis, including its original App version. No
// key, credential, ledger, HRS, or checkpoint is generated from this document.
// Empty optional pairs select bootstrap-only; runtime and PQ are independent.
type ProductionOperatorPlan struct {
	Version                 string                   `json:"version"`
	ChainID                 string                   `json:"chainId"`
	ValidatorManifestSHA256 string                   `json:"validatorManifestSHA256"`
	ConsensusGenesis        []byte                   `json:"consensusGenesis"`
	ConsensusGenesisSHA256  string                   `json:"consensusGenesisSHA256"`
	OriginalGenesisHash     string                   `json:"originalGenesisHash"`
	MigrationStateHash      string                   `json:"migrationStateHash"`
	StateLayout             string                   `json:"stateLayout"`
	RuntimePlan             []byte                   `json:"runtimePlan"`
	RuntimePlanHash         string                   `json:"runtimePlanHash"`
	PQSchedule              []byte                   `json:"pqSchedule"`
	PQScheduleHash          string                   `json:"pqScheduleHash"`
	Roles                   []ProductionOperatorRole `json:"roles"`
}

type ProductionOperatorRole struct {
	Role                string                           `json:"role"`
	Home                string                           `json:"home"`
	ABCIState           string                           `json:"abciState"`
	LegacyKeyPath       string                           `json:"legacyKeyPath"`
	LegacyStatePath     string                           `json:"legacyStatePath"`
	NodeKeyPath         string                           `json:"nodeKeyPath"`
	HostBinding         *ynxconsensusauth.HostKeyBinding `json:"hostBinding"`
	RemoteSigner        string                           `json:"remoteSigner"`
	TransportKeyPath    string                           `json:"transportKeyPath"`
	SignerPeerPublicKey string                           `json:"signerPeerPublicKey"`
	RemoteTimeout       string                           `json:"remoteTimeout"`
}

func (p *ProductionOperatorPlan) role(name string) ProductionOperatorRole {
	for _, role := range p.Roles {
		if role.Role == name {
			return role
		}
	}
	return ProductionOperatorRole{}
}

// DecodeProductionOperatorPlan authenticates exact canonical bytes against an
// external pin, not a hash asserted by the incoming plan/package. Semantic
// bootstrap, migration, schedule and per-host validation follows in generation.
func DecodeProductionOperatorPlan(raw []byte, independentHash string) (ProductionOperatorPlan, error) {
	var p ProductionOperatorPlan
	if len(raw) == 0 || len(raw) > MaxProductionOperatorPlanBytes {
		return p, errors.New("invalid production operator plan size")
	}
	if _, err := canonicalBootstrapHash(independentHash); err != nil {
		return p, err
	}
	if productionOperatorSHA(raw) != independentHash {
		return p, errors.New("production operator plan differs from independent pin")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return p, err
	}
	canonical, err := json.Marshal(p)
	if err != nil || !bytes.Equal(raw, canonical) {
		return p, errors.New("operator plan must be exact canonical JSON without missing, duplicate, unknown or trailing fields")
	}
	if p.Version != ProductionOperatorPlanVersion {
		return p, errors.New("unsupported production operator plan version")
	}
	return p, nil
}

func GenerateProductionCandidatePackageWithOperator(m chain.ConsensusMigrationState, validators ProductionValidatorManifest, output string, genesisTime time.Time, rawPlan []byte, independentPlanHash string) (ProductionCandidatePackageManifest, error) {
	p, err := DecodeProductionOperatorPlan(rawPlan, independentPlanHash)
	if err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	if err = validators.Validate(m); err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	bindings := make([]chain.ConsensusValidatorKeyBinding, 0, len(validators.Validators))
	for _, n := range validators.Validators {
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: n.ValidatorAddress, KeyType: n.ConsensusKeyType, PublicKey: n.ConsensusPubKey, ConsensusAddress: n.ConsensusAddress})
	}
	bound, err := m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	// Validate all independent authority BEFORE creating the output directory.
	if err = validateProductionOperatorPlan(p, bound, validators, genesisTime); err != nil {
		return ProductionCandidatePackageManifest{}, err
	}
	return generateProductionCandidatePackage(m, validators, output, genesisTime, &p, independentPlanHash)
}

func VerifyProductionOperatorCandidatePackage(root, independentPlanHash string) error {
	if _, err := canonicalBootstrapHash(independentPlanHash); err != nil {
		return err
	}
	return verifyProductionCandidatePackage(root, independentPlanHash)
}

// VerifyProductionNodeKeyFile verifies only an existing local P2P identity. A
// remote signer owns its original Ed key/HRS; no copy is required on the client.
// Consensus authority still requires the normal bootstrap and remote dual proof.
func VerifyProductionNodeKeyFile(roleManifestPath, nodeKeyPath string) error {
	roleRaw, err := os.ReadFile(roleManifestPath)
	if err != nil {
		return err
	}
	var role ProductionCandidateRoleManifest
	if err = json.Unmarshal(roleRaw, &role); err != nil {
		return err
	}
	if role.Version != ProductionCandidatePackageVersion || role.Purpose != ProductionValidatorManifestPurpose || role.ChainID == "" || !productionNodeIDPattern.MatchString(role.Node.NodeID) {
		return errors.New("production role lacks approved original node identity")
	}
	before, err := os.Lstat(nodeKeyPath)
	if err != nil {
		return err
	}
	if !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Size() <= 0 || before.Size() > 64<<10 {
		return errors.New("node key must be an existing bounded private regular 0600 file")
	}
	f, err := os.Open(nodeKeyPath)
	if err != nil {
		return err
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(before, opened) {
		return errors.New("original node key identity changed before read")
	}
	raw, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	if err != nil {
		return err
	}
	defer clear(raw)
	after, err := f.Stat()
	pathAfter, pathErr := os.Lstat(nodeKeyPath)
	if err != nil || pathErr != nil || len(raw) > 64<<10 || !os.SameFile(before, after) || !os.SameFile(before, pathAfter) || after.Size() != before.Size() || pathAfter.Size() != before.Size() || after.ModTime() != before.ModTime() || pathAfter.ModTime() != before.ModTime() || after.Mode() != before.Mode() || pathAfter.Mode() != before.Mode() {
		return errors.New("original node key changed during read")
	}
	var node p2p.NodeKey
	if err = cmtjson.Unmarshal(raw, &node); err != nil || node.PrivKey == nil {
		return errors.New("invalid original node key")
	}
	private := node.PrivKey.Bytes()
	defer clear(private)
	if node.PrivKey.Type() != "ed25519" || len(private) != ed25519.PrivateKeySize {
		return errors.New("original node identity must be complete Ed25519")
	}
	derived := ed25519.NewKeyFromSeed(private[:ed25519.SeedSize])
	defer clear(derived)
	if !bytes.Equal(private, derived) || string(node.ID()) != role.Node.NodeID {
		return errors.New("original node private/public identity differs from approved role")
	}
	return nil
}

var productionOperatorPath = regexp.MustCompile(`^/[A-Za-z0-9_./-]+$`)

func safeProductionOperatorPath(path string) bool {
	return len(path) <= 4096 && path != "/" && productionOperatorPath.MatchString(path) && filepath.Clean(path) == path
}

func validateProductionOperatorPlan(p ProductionOperatorPlan, m chain.ConsensusMigrationState, validators ProductionValidatorManifest, genesisTime time.Time) error {
	if p.Version != ProductionOperatorPlanVersion || p.ChainID != validators.ChainID || len(p.Roles) != 4 || len(p.ConsensusGenesis) == 0 || len(p.ConsensusGenesis) > 64<<20 {
		return errors.New("operator identity or original genesis is incomplete")
	}
	manifestHash, err := ProductionValidatorManifestHash(validators)
	if err != nil || manifestHash != p.ValidatorManifestSHA256 {
		return errors.New("operator peer topology and original role identities differ from independent public manifest pin")
	}
	if p.StateLayout != "atomic-json" && p.StateLayout != "snapshot-journal" && p.StateLayout != "block-journal" {
		return errors.New("unsupported operator state layout")
	}
	b, err := NewConsensusBootstrap(p.ConsensusGenesis, ConsensusBootstrapPins{p.ConsensusGenesisSHA256, p.OriginalGenesisHash, p.MigrationStateHash}, m)
	if err != nil {
		return err
	}
	if err = validateMigrationPreservationClosure(m); err != nil {
		return err
	}
	if !b.record.GenesisTime.Equal(genesisTime) {
		return errors.New("operator genesis time differs from original pinned genesis")
	}
	if (len(p.RuntimePlan) == 0) != (p.RuntimePlanHash == "") || (len(p.PQSchedule) == 0) != (p.PQScheduleHash == "") {
		return errors.New("operator runtime and schedule require complete independent pairs")
	}
	if len(p.RuntimePlan) > 0 {
		runtime, runtimeErr := NewRuntimeUpgradeAuthorization(p.RuntimePlan, p.RuntimePlanHash, b, m)
		if runtimeErr != nil {
			return runtimeErr
		}
		plan, err := runtime.Plan()
		if err != nil || plan.OldApplicationVersion != b.record.Params.Version.App {
			return errors.New("operator runtime plan differs from the original genesis App version")
		}
	} else if b.record.Params.Version.App != ApplicationVersion {
		return errors.New("old original App version requires explicit runtime upgrade authority")
	}
	var pq *PQEngineAuthorization
	if len(p.PQSchedule) > 0 {
		pq, err = NewPQEngineAuthorization(p.PQSchedule, p.PQScheduleHash)
		if err != nil {
			return err
		}
		s := pq.schedule
		if s.ChainID != p.ChainID || !bytes.Equal(s.GenesisID, b.genesisID) || s.OriginalValidatorSetHash != b.record.ValidatorSetHash {
			return errors.New("operator schedule differs from original pinned membership")
		}
	}
	seen := make(map[string]bool)
	for _, r := range p.Roles {
		if seen[r.Role] || !productionRolePattern.MatchString(r.Role) {
			return errors.New("duplicate or invalid operator role")
		}
		seen[r.Role] = true
		var n *ProductionValidatorNode
		for i := range validators.Validators {
			if validators.Validators[i].Role == r.Role {
				n = &validators.Validators[i]
				break
			}
		}
		if n == nil {
			return errors.New("operator role is not original approved member")
		}
		paths := []string{r.Home, r.ABCIState, r.LegacyKeyPath, r.LegacyStatePath, r.NodeKeyPath}
		for _, path := range paths {
			if !safeProductionOperatorPath(path) || path == ProductionCandidateRoot || strings.HasPrefix(path, ProductionCandidateRoot+"/") {
				return errors.New("operator requires explicit original paths outside the fresh candidate installation")
			}
		}
		if r.ABCIState == r.LegacyStatePath || r.LegacyKeyPath == r.NodeKeyPath || r.ABCIState == r.LegacyKeyPath || r.ABCIState == r.NodeKeyPath || r.LegacyStatePath == r.LegacyKeyPath || r.LegacyStatePath == r.NodeKeyPath {
			return errors.New("operator state and custody paths must be distinct")
		}
		if pq == nil {
			if r.HostBinding != nil || r.RemoteSigner != "" || r.TransportKeyPath != "" || r.SignerPeerPublicKey != "" || r.RemoteTimeout != "" {
				return errors.New("bootstrap/runtime-only operator must not contain partial PQ custody")
			}
			continue
		}
		if r.HostBinding == nil {
			return errors.New("PQ remote operator requires complete original host binding")
		}
		binding := r.HostBinding
		if err := binding.Validate(); err != nil {
			return err
		}
		address, err := hex.DecodeString(n.ConsensusAddress)
		if err != nil || !bytes.Equal(binding.ValidatorAddress, address) || binding.Policy.ChainID != p.ChainID || !bytes.Equal(binding.Policy.GenesisID, b.genesisID) || binding.Policy.ActivationHeight != pq.schedule.ActivationHeight {
			return errors.New("operator host binding differs from role/genesis/schedule")
		}
		if !safeProductionOperatorPath(binding.SignerStatePath) || !safeProductionOperatorPath(r.TransportKeyPath) || r.TransportKeyPath == r.LegacyKeyPath || r.TransportKeyPath == r.NodeKeyPath || r.TransportKeyPath == r.ABCIState || r.TransportKeyPath == r.LegacyStatePath || binding.SignerStatePath == r.LegacyStatePath {
			return errors.New("remote transport and original signing histories must remain distinct canonical paths")
		}
		for _, path := range []string{binding.SignerStatePath, r.TransportKeyPath} {
			if path == ProductionCandidateRoot || strings.HasPrefix(path, ProductionCandidateRoot+"/") {
				return errors.New("original remote custody cannot be placed in the fresh candidate tree")
			}
		}
		peer, err := hex.DecodeString(r.SignerPeerPublicKey)
		if err != nil || len(peer) != 32 || hex.EncodeToString(peer) != r.SignerPeerPublicKey || bytes.Equal(peer, make([]byte, 32)) {
			return errors.New("operator requires full independent remote peer public key")
		}
		timeout, err := time.ParseDuration(r.RemoteTimeout)
		if err != nil || timeout <= 0 || timeout > time.Minute || timeout.String() != r.RemoteTimeout {
			return errors.New("invalid canonical remote timeout")
		}
		if !strings.HasPrefix(r.RemoteSigner, "tcp://") {
			return errors.New("remote operator requires explicit TCP SecretConnection endpoint")
		}
		host, port, err := net.SplitHostPort(strings.TrimPrefix(r.RemoteSigner, "tcp://"))
		ip := net.ParseIP(host)
		number, numErr := strconv.Atoi(port)
		if err != nil || numErr != nil || number < 1 || number > 65535 || strconv.Itoa(number) != port || ip == nil || (!ip.IsPrivate() && !ip.IsLoopback()) || ip.String() != host {
			return errors.New("remote operator requires canonical private/loopback IP and port")
		}
	}
	return nil
}

func productionOperatorSHA(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// ProductionValidatorManifestHash binds the complete public membership and
// peer topology, independent of input ordering. It contains no host key bytes.
func ProductionValidatorManifestHash(m ProductionValidatorManifest) (string, error) {
	m.Validators = append([]ProductionValidatorNode(nil), m.Validators...)
	sort.Slice(m.Validators, func(i, j int) bool { return m.Validators[i].Role < m.Validators[j].Role })
	raw, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	return productionOperatorSHA(raw), nil
}

// These public launch files bind existing custody and existing config. They do
// not provision/recover a signer service, its encrypted credential, its original
// HRS or its checkpoint publisher. Remote signing uses the normal SecretConnection
// client and the separately provisioned ynx-consensus-pq-remote-signer service.
func productionOperatorRoleFiles(p *ProductionOperatorPlan, r ProductionOperatorRole, config, roleManifest []byte) (map[string][]byte, error) {
	files := map[string][]byte{}
	args := []string{"start", "--home", r.Home, "--migration-state", ProductionCandidateRoot + "/config/bound-migration.json", "--abci-state", r.ABCIState, "--abci-state-layout", p.StateLayout, "--consensus-genesis-sha256", p.ConsensusGenesisSHA256, "--original-genesis-hash", p.OriginalGenesisHash, "--bound-migration-state-hash", p.MigrationStateHash}
	if len(p.RuntimePlan) > 0 {
		files["config/runtime-plan.json"] = p.RuntimePlan
		args = append(args, "--runtime-upgrade-plan", ProductionCandidateRoot+"/config/runtime-plan.json", "--runtime-upgrade-plan-hash", p.RuntimePlanHash)
	}
	if len(p.PQSchedule) > 0 {
		binding, err := json.Marshal(r.HostBinding)
		if err != nil {
			return nil, err
		}
		files["config/pq-host-binding.json"] = binding
		files["config/pq-engine-schedule.json"] = p.PQSchedule
		files["config/pq-signer-peer-pin"] = []byte(r.SignerPeerPublicKey + "\n")
		args = append(args, "--pq-engine-schedule", ProductionCandidateRoot+"/config/pq-engine-schedule.json", "--pq-engine-schedule-hash", p.PQScheduleHash, "--pq-host-key-binding", ProductionCandidateRoot+"/config/pq-host-binding.json", "--pq-remote-signer", r.RemoteSigner, "--pq-transport-key", r.TransportKeyPath, "--pq-signer-peer-pin", ProductionCandidateRoot+"/config/pq-signer-peer-pin", "--pq-remote-timeout", r.RemoteTimeout)
	}
	var launch strings.Builder
	launch.WriteString("#!/usr/bin/env bash\nset -euo pipefail\ntest \"$#\" = 0\n")
	// An original Home is never populated by the installer. Refuse config drift
	// before constructing App/PV or acquiring a writer lease.
	fmt.Fprintf(&launch, "printf '%%s  %%s\\n' '%s' '%s/config/config.toml' '%s' '%s/config/genesis.json' | sha256sum --strict -c - >/dev/null\n", productionOperatorSHA(config), r.Home, p.ConsensusGenesisSHA256, r.Home)
	fmt.Fprintf(&launch, "printf '%%s  %%s\\n' '%s' '%s/role-manifest.json' | sha256sum --strict -c - >/dev/null\n", productionOperatorSHA(roleManifest), ProductionCandidateRoot)
	var publicFiles []string
	for name := range files {
		publicFiles = append(publicFiles, name)
	}
	sort.Strings(publicFiles)
	for _, name := range publicFiles {
		fmt.Fprintf(&launch, "printf '%%s  %%s\\n' '%s' '%s/%s' | sha256sum --strict -c - >/dev/null\n", productionOperatorSHA(files[name]), ProductionCandidateRoot, name)
	}
	keyArgs := fmt.Sprintf("-role-manifest '%s/role-manifest.json' -private-validator-key '%s' -node-key '%s'", ProductionCandidateRoot, r.LegacyKeyPath, r.NodeKeyPath)
	installCheck := fmt.Sprintf("\"$binary_dir/ynx-consensus-keycheck\" -role-manifest \"$role_dir/role-manifest.json\" -private-validator-key '%s' -node-key '%s'\ntest -s '%s'\n", r.LegacyKeyPath, r.NodeKeyPath, r.LegacyStatePath)
	readOnly := ProductionCandidateRoot + " " + r.NodeKeyPath + " " + r.LegacyKeyPath
	readWrite := r.Home + " " + filepath.Dir(r.ABCIState) + " " + filepath.Dir(r.LegacyStatePath)
	backupPaths := fmt.Sprintf("'%s' '%s' '%s' '%s'", ProductionCandidateRoot, r.Home, filepath.Dir(r.ABCIState), filepath.Dir(r.LegacyStatePath))
	if len(p.PQSchedule) > 0 {
		keyArgs = fmt.Sprintf("-node-only -role-manifest '%s/role-manifest.json' -node-key '%s'", ProductionCandidateRoot, r.NodeKeyPath)
		installCheck = fmt.Sprintf("\"$binary_dir/ynx-consensus-keycheck\" -node-only -role-manifest \"$role_dir/role-manifest.json\" -node-key '%s'\n", r.NodeKeyPath)
		readOnly = ProductionCandidateRoot + " " + r.NodeKeyPath + " " + r.TransportKeyPath
		readWrite = r.Home + " " + filepath.Dir(r.ABCIState)
		backupPaths = fmt.Sprintf("'%s' '%s' '%s'", ProductionCandidateRoot, r.Home, filepath.Dir(r.ABCIState))
	} else {
		fmt.Fprintf(&launch, "test -s '%s'\n", r.LegacyStatePath)
	}
	fmt.Fprintf(&launch, "'%s/bin/ynx-consensus-keycheck' %s\ntest -s '%s'\n", ProductionCandidateRoot, keyArgs, r.ABCIState)
	// Comet honors CMTHOME/TMHOME and CMT_* environment overrides. Only the
	// pinned argv/config may select the original home or authority here.
	fmt.Fprintf(&launch, "exec env -i PATH=/usr/bin:/bin '%s/bin/ynx-comet'", ProductionCandidateRoot)
	for _, arg := range args {
		fmt.Fprintf(&launch, " '%s'", arg)
	}
	launch.WriteString("\n")
	files["scripts/start-operator.sh"] = []byte(launch.String())
	unit := fmt.Sprintf(`[Unit]
Description=YNX original-state single-App consensus operator (%s)
After=network-online.target
Wants=network-online.target
Conflicts=ynx-consensus-abci-candidate.service ynx-consensus-comet-candidate.service

[Service]
Type=simple
User=ynx
Group=ynx
UMask=0077
ExecStart=%s/scripts/start-operator.sh
Restart=no
KillMode=control-group
TimeoutStopSec=15
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadOnlyPaths=%s
ReadWritePaths=%s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`, r.Role, ProductionCandidateRoot, readOnly, readWrite)
	files["systemd/ynx-consensus-operator-candidate.service"] = []byte(unit)
	files["scripts/install-candidate.sh"] = []byte(fmt.Sprintf(`#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
test "$#" = 0
role_dir="$(cd "$(dirname "$0")/.." && pwd)"
binary_dir="$(cd "$role_dir/../bin" && pwd)"
umask 077
test -x "$binary_dir/ynx-comet"
test -x "$binary_dir/ynx-consensus-keycheck"
%s
test -s '%s'
# The original home/config, ledger, private keys, HRS and UNKNOWN are untouched.
# Refuse existing/partial/competing candidate trees; preserve every failure.
mkdir -p /var/lib/ynx-chain
mkdir -m 0700 %s
install -d -m 0755 %s/bin %s/scripts
install -d -m 0700 -o ynx -g ynx %s/config
install -m 0755 "$binary_dir/ynx-comet" %s/bin/ynx-comet
install -m 0755 "$binary_dir/ynx-consensus-keycheck" %s/bin/ynx-consensus-keycheck
install -m 0755 "$role_dir/scripts/start-operator.sh" %s/scripts/start-operator.sh
install -m 0600 -o ynx -g ynx "$role_dir/role-manifest.json" %s/role-manifest.json
for input in "$role_dir"/config/*; do install -m 0600 -o ynx -g ynx "$input" %s/config/; done
chmod 0755 %s
# Provision only the single-App unit. Starting it is a separate activation step;
# do not silently stop/replace any existing writer or original signer service.
test ! -e /etc/systemd/system/ynx-consensus-operator-candidate.service
test ! -L /etc/systemd/system/ynx-consensus-operator-candidate.service
dd if="$role_dir/systemd/ynx-consensus-operator-candidate.service" of=/etc/systemd/system/ynx-consensus-operator-candidate.service conv=excl status=none
chmod 0644 /etc/systemd/system/ynx-consensus-operator-candidate.service
echo "single-App operator candidate preserved; not started, deployed authority and PQ activation not established"
`, installCheck, r.ABCIState, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot, ProductionCandidateRoot))
	files["scripts/verify-candidate.sh"] = []byte("#!/usr/bin/env bash\nset -euo pipefail\ntest \"$#\" = 0\nsystemctl is-active --quiet ynx-consensus-operator-candidate.service\n! systemctl is-active --quiet ynx-consensus-abci-candidate.service\n! systemctl is-active --quiet ynx-consensus-comet-candidate.service\ncurl -fsS http://127.0.0.1:27757/status >/dev/null\necho 'single-App process observed; this is not independent finality or PQ activation proof'\n")
	files["scripts/stop-candidate.sh"] = []byte("#!/usr/bin/env bash\nset -euo pipefail\ntest \"$#\" = 0\nsystemctl stop ynx-consensus-operator-candidate.service\necho 'operator stopped; original state and signing history preserved'\n")
	files["scripts/backup-candidate.sh"] = []byte(fmt.Sprintf(`#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
output="${1:?new archive path required}"
test "$#" = 1
umask 077
mkdir -p "$(dirname "$output")"
if test -e "$output" || test -L "$output"; then exit 1; fi
partial="$output.partial"
tar -czf - %s | dd of="$partial" conv=excl status=none
tar -tzf "$partial" >/dev/null
ln -T -- "$partial" "$output"
echo 'archive and partial preserved; online consistency is not established; automatic HRS restoration forbidden'
`, backupPaths))
	return files, nil
}

func writeProductionOperatorRole(dir string, p *ProductionOperatorPlan, r ProductionOperatorRole) error {
	config, err := os.ReadFile(filepath.Join(dir, "config", "config.toml"))
	if err != nil {
		return err
	}
	roleManifest, err := os.ReadFile(filepath.Join(dir, "role-manifest.json"))
	if err != nil {
		return err
	}
	files, err := productionOperatorRoleFiles(p, r, config, roleManifest)
	if err != nil {
		return err
	}
	for name, raw := range files {
		mode := os.FileMode(0600)
		if strings.HasPrefix(name, "scripts/") {
			mode = 0755
		}
		if strings.HasPrefix(name, "systemd/") {
			mode = 0644
		}
		if err = writeModeFile(filepath.Join(dir, name), raw, mode); err != nil {
			return err
		}
	}
	return nil
}

func verifyProductionOperatorFiles(root string, p *ProductionOperatorPlan) error {
	var nodes []ProductionValidatorNode
	for _, r := range p.Roles {
		raw, err := os.ReadFile(filepath.Join(root, "roles", r.Role, "role-manifest.json"))
		if err != nil {
			return err
		}
		var role ProductionCandidateRoleManifest
		if err = json.Unmarshal(raw, &role); err != nil {
			return err
		}
		nodes = append(nodes, role.Node)
	}
	for _, r := range p.Roles {
		dir := filepath.Join(root, "roles", r.Role)
		units, err := os.ReadDir(filepath.Join(dir, "systemd"))
		if err != nil || len(units) != 1 || units[0].Name() != "ynx-consensus-operator-candidate.service" || units[0].IsDir() {
			return errors.New("operator package must contain exactly one single-App service")
		}
		for _, old := range []string{"ynx-consensus-abci-candidate.service", "ynx-consensus-comet-candidate.service"} {
			if _, err := os.Lstat(filepath.Join(dir, "systemd", old)); !errors.Is(err, os.ErrNotExist) {
				return errors.New("operator package must not contain standalone ABCI or stock Comet service")
			}
		}
		config, err := os.ReadFile(filepath.Join(dir, "config", "config.toml"))
		if err != nil {
			return err
		}
		// Use the same normal Comet config decoder; checking only substrings
		// would allow a self-rehashed duplicate/altered config to redirect HRS.
		v := viper.New()
		v.SetConfigType("toml")
		if err = v.ReadConfig(bytes.NewReader(config)); err != nil {
			return err
		}
		actual := cmtconfig.DefaultConfig()
		if err = v.UnmarshalExact(actual); err != nil {
			return err
		}
		actual.SetRoot(r.Home)
		var node ProductionValidatorNode
		for _, n := range nodes {
			if n.Role == r.Role {
				node = n
			}
		}
		wantConfig := productionOperatorCometConfig(node, nodes, r)
		if !reflect.DeepEqual(actual, wantConfig) {
			return errors.New("operator config differs from pinned single-App/original-path template")
		}
		for _, required := range []string{fmt.Sprintf("priv_validator_state_file = %q", r.LegacyStatePath), fmt.Sprintf("genesis_file = %q", filepath.Join(r.Home, "config", "genesis.json"))} {
			if !bytes.Contains(config, []byte(required)) {
				return errors.New("operator config changed original custody or genesis path")
			}
		}
		roleManifest, err := os.ReadFile(filepath.Join(dir, "role-manifest.json"))
		if err != nil {
			return err
		}
		expected, err := productionOperatorRoleFiles(p, r, config, roleManifest)
		if err != nil {
			return err
		}
		for name, want := range expected {
			got, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil || !bytes.Equal(got, want) {
				return fmt.Errorf("operator public launch file differs from independently pinned plan: %s", name)
			}
		}
	}
	return nil
}

func productionOperatorCometConfig(node ProductionValidatorNode, nodes []ProductionValidatorNode, r ProductionOperatorRole) *cmtconfig.Config {
	c := cmtconfig.DefaultConfig().SetRoot(r.Home)
	c.Moniker = node.Role
	c.ProxyApp = fmt.Sprintf("tcp://127.0.0.1:%d", ProductionCandidateABCIPort)
	c.ABCI = "socket"
	c.PrivValidatorKey = r.LegacyKeyPath
	c.PrivValidatorState = r.LegacyStatePath
	c.NodeKey = r.NodeKeyPath
	c.Genesis = filepath.Join(r.Home, "config", "genesis.json")
	c.RPC.ListenAddress = fmt.Sprintf("tcp://127.0.0.1:%d", ProductionCandidateRPCPort)
	c.P2P.ListenAddress = fmt.Sprintf("tcp://0.0.0.0:%d", node.P2PPort)
	c.P2P.ExternalAddress = fmt.Sprintf("tcp://%s:%d", node.PrivateP2PHost, node.P2PPort)
	var peers []string
	for _, peer := range nodes {
		if peer.Role != node.Role {
			peers = append(peers, peer.NodeID+"@"+net.JoinHostPort(peer.PrivateP2PHost, strconv.Itoa(peer.P2PPort)))
		}
	}
	sort.Strings(peers)
	c.P2P.PersistentPeers = strings.Join(peers, ",")
	c.P2P.AllowDuplicateIP = false
	c.P2P.AddrBookStrict = true
	c.Instrumentation.Prometheus = true
	c.Instrumentation.PrometheusListenAddr = fmt.Sprintf("127.0.0.1:%d", ProductionCandidateMetricsPort)
	return c
}
