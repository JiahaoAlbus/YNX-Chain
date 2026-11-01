//go:build unix

package consensus

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
	"github.com/spf13/viper"
	"golang.org/x/sys/unix"
)

type PQLabDistributedLocal struct {
	plan                     PQLabDistributedPlan
	migration                chain.ConsensusMigrationState
	bootstrap                *ConsensusBootstrap
	node                     PQLabNetworkNode
	genesisRaw, migrationRaw []byte
	root, planSHA            string
	activation               *PQLabDistributedActivation
}

type PQLabDistributedLocalRecord struct {
	Version               string               `json:"version"`
	PlanSHA256            string               `json:"planSHA256"`
	IdentitySHA256        string               `json:"identitySHA256"`
	Host                  PQLabDistributedHost `json:"host"`
	Node                  PQLabNetworkNode     `json:"node"`
	NodeStarted           bool                 `json:"nodeStarted"`
	PhysicalHostAgreement bool                 `json:"physicalHostAgreement"`
}

func pqDistributedHostCurrent(h PQLabDistributedHost, r PQLabDistributedRequest) error {
	hostname, err := os.Hostname()
	if err != nil || hostname != h.Hostname || os.Geteuid() == 0 || uint32(os.Geteuid()) != h.UID || uint32(os.Getegid()) != h.GID {
		return errors.New("original host name and non-root UID/GID do not match independent request")
	}
	for _, v := range []struct{ path, pin string }{{h.CometBinary, r.CometBinarySHA256}, {h.LabBinary, r.LabBinarySHA256}} {
		if err := requireInspectionPath(v.path); err != nil {
			return err
		}
		original, err := readProofHostOriginal(v.path, v.pin, 128<<20)
		if err != nil {
			return err
		}
		err = errors.Join(original.unchanged(), original.file.Close())
		if err != nil {
			return err
		}
	}
	return nil
}

func pqDistributedOwnedDirectory(path string, h PQLabDistributedHost) error {
	if err := proofHostLivePrivateDirectory(path); err != nil {
		return err
	}
	var st unix.Stat_t
	if err := unix.Lstat(path, &st); err != nil {
		return err
	}
	if st.Uid != h.UID || st.Gid != h.GID {
		return errors.New("host-local directory owner differs from pinned QA UID/GID")
	}
	return nil
}

func pqDistributedNode(h PQLabDistributedHost, id PQLabDistributedIdentity, operation string) PQLabNetworkNode {
	home := filepath.Join(h.RootDir, "node")
	return PQLabNetworkNode{Index: h.Index, Home: home, StatePath: filepath.Join(home, "data", "application.json"),
		LegacyKeyFile: filepath.Join(home, "config", "priv_validator_key.json"), LegacyStateFile: filepath.Join(home, "data", "priv_validator_state.json"), NodeKeyFile: filepath.Join(home, "config", "node_key.json"),
		CandidateMaterialFile: filepath.Join(home, "custody", "candidate-material.json"), RecoveryCredentialFile: filepath.Join(home, "custody", "recovery.raw"), RecoveryFD: 3,
		HostBindingFile: filepath.Join(home, "custody", "host-binding.json"), VaultFile: filepath.Join(home, "custody", "host-key.vault"), SignerStateFile: filepath.Join(home, "custody", "pq-sign-state.json"),
		NodeID: id.NodeID, ValidatorAddress: bytes.Clone(id.ValidatorAddress), PublicA: bytes.Clone(id.PublicA), PublicB: bytes.Clone(id.PublicB),
		RPCAddress: fmt.Sprintf("http://127.0.0.1:%d", h.RPCPort), P2PAddress: fmt.Sprintf("tcp://127.0.0.1:%d", h.P2PPort), HaltControl: filepath.Join(home, "data", "operator-height-halt-"+operation+".json")}
}

// GeneratePQLabDistributedIdentity is invoked ON the selected host. No caller
// may supply or import private keys. Failed/UNKNOWN creation retains the exact
// exclusive directory and must be inspected; it cannot silently generate again.
func GeneratePQLabDistributedIdentity(requestRaw []byte, requestPin string, index int) (PQLabDistributedIdentity, error) {
	var id PQLabDistributedIdentity
	r, err := DecodePQLabDistributedRequest(requestRaw, requestPin)
	if err != nil {
		return id, err
	}
	if index < 0 || index >= 4 {
		return id, errors.New("original host index required")
	}
	h := r.Hosts[index]
	if err := pqDistributedHostCurrent(h, r); err != nil {
		return id, err
	}
	if err := pqLabNetworkFreshDirectory(h.RootDir); err != nil {
		return id, err
	}
	if err := pqDistributedOwnedDirectory(h.RootDir, h); err != nil {
		return id, err
	}
	if err := pqLabWrite(filepath.Join(h.RootDir, "request.json"), requestRaw); err != nil {
		return id, err
	}
	id = PQLabDistributedIdentity{Version: PQLabDistributedIdentityVersion, RequestSHA256: requestPin, Host: h}
	n := pqDistributedNode(h, id, r.OperationID)
	for _, dir := range []string{n.Home, filepath.Join(n.Home, "config"), filepath.Join(n.Home, "data"), filepath.Join(n.Home, "custody")} {
		if err := os.Mkdir(dir, 0700); err != nil {
			return id, err
		}
	}
	pv := privval.GenFilePV(n.LegacyKeyFile, n.LegacyStateFile)
	legacy := pv.Key.PrivKey.(cmted.PrivKey)
	defer clear(legacy)
	raw, err := cmtjson.Marshal(&pv.Key)
	if err != nil {
		return id, err
	}
	err = pqLabWrite(n.LegacyKeyFile, raw)
	clear(raw)
	if err != nil {
		return id, err
	}
	raw, err = cmtjson.Marshal(&pv.LastSignState)
	if err != nil {
		return id, err
	}
	if err = pqLabWrite(n.LegacyStateFile, raw); err != nil {
		return id, err
	}
	id.LegacyPublicKey, id.ValidatorAddress = bytes.Clone(pv.Key.PubKey.Bytes()), bytes.Clone(pv.Key.Address)
	nk := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
	defer clear(nk.PrivKey.(cmted.PrivKey))
	id.NodeID, id.NodePublicKey = string(nk.ID()), bytes.Clone(nk.PubKey().Bytes())
	raw, err = cmtjson.Marshal(nk)
	if err != nil {
		return id, err
	}
	err = pqLabWrite(n.NodeKeyFile, raw)
	clear(raw)
	if err != nil {
		return id, err
	}
	key, material, err := ynxconsensusauth.GenerateCandidateKeyMaterial()
	if err != nil {
		return id, err
	}
	defer key.Destroy()
	defer material.Clear()
	id.PublicA, id.PublicB = bytes.Clone(material.PublicA), bytes.Clone(material.PublicB)
	raw, err = json.Marshal(material)
	if err != nil {
		return id, err
	}
	err = pqLabWrite(n.CandidateMaterialFile, raw)
	clear(raw)
	if err != nil {
		return id, err
	}
	credential, err := ynxconsensusauth.GenerateHostRecoveryCredential()
	if err != nil {
		return id, err
	}
	defer clear(credential)
	if err = pqLabWrite(n.RecoveryCredentialFile, credential); err != nil {
		return id, err
	}
	if err = pqDistributedHostCurrent(h, r); err != nil {
		return id, err
	}
	if err = pqLabWriteJSON(filepath.Join(h.RootDir, "identity.json"), id); err != nil {
		return id, err
	}
	return id, nil
}

func pqDistributedConfig(p PQLabDistributedPlan, n PQLabNetworkNode) *cfg.Config {
	c := cfg.DefaultConfig().SetRoot(n.Home)
	c.Moniker = fmt.Sprintf("synthetic-pq-host-%d", n.Index)
	c.RPC.ListenAddress = strings.Replace(n.RPCAddress, "http://", "tcp://", 1)
	c.P2P.ListenAddress = n.P2PAddress
	c.P2P.AllowDuplicateIP = true
	c.P2P.AddrBookStrict = false
	var peers []string
	for i, id := range p.Identities {
		if i != n.Index {
			peers = append(peers, fmt.Sprintf("%s@127.0.0.1:%d", id.NodeID, id.Host.P2PPort))
		}
	}
	c.P2P.PersistentPeers = strings.Join(peers, ",")
	c.Consensus.CreateEmptyBlocks = false
	c.Consensus.TimeoutCommit = time.Second
	c.TxIndex.Indexer = "kv"
	return c
}

func pqDistributedConfigEqual(raw []byte, expected *cfg.Config) error {
	v := viper.New()
	v.SetConfigType("toml")
	if err := v.ReadConfig(bytes.NewReader(raw)); err != nil {
		return err
	}
	actual := cfg.DefaultConfig()
	if err := v.UnmarshalExact(actual); err != nil {
		return err
	}
	actual.SetRoot(expected.RootDir)
	// The maintained template emits rpc_servers="" for the default nil
	// StateSync slice; Viper decodes it as an empty slice. Only that exact
	// zero-element representation is equivalent. Any actual server still fails.
	if len(actual.StateSync.RPCServers) == 0 {
		actual.StateSync.RPCServers = nil
	}
	if !reflect.DeepEqual(actual, expected) {
		return errors.New("normal host config differs from independently pinned public plan")
	}
	return actual.ValidateBasic()
}

func pqDistributedNormalArgs(p PQLabDistributedPlan, n PQLabNetworkNode) []string {
	return []string{"start", "--home", n.Home, "--migration-state", filepath.Join(p.Request.Hosts[n.Index].RootDir, "bound-migration.json"), "--abci-state", n.StatePath, "--abci-state-layout", "atomic-json", "--consensus-genesis-sha256", p.Pins.CometGenesisSHA256, "--original-genesis-hash", p.Pins.OriginalGenesisHash, "--bound-migration-state-hash", p.Pins.MigrationStateHash}
}

// Import accepts only PUBLIC plan bytes plus an independent exact pin. Existing
// host-local keys are mathematically checked; none are imported from the plan.
func ImportPQLabDistributedPlan(raw []byte, pin string, index int) (PQLabDistributedLocalRecord, error) {
	var out PQLabDistributedLocalRecord
	p, _, _, err := DecodePQLabDistributedPlan(raw, pin)
	if err != nil {
		return out, err
	}
	if index < 0 || index >= 4 {
		return out, errors.New("original host index required")
	}
	h, id := p.Request.Hosts[index], p.Identities[index]
	if err = pqDistributedHostCurrent(h, p.Request); err != nil {
		return out, err
	}
	if err = pqDistributedOwnedDirectory(h.RootDir, h); err != nil {
		return out, err
	}
	requestRaw, err := pqLabRead(filepath.Join(h.RootDir, "request.json"), MaxPQLabDistributedRequestBytes)
	if err != nil {
		return out, err
	}
	if pqLabSHA(requestRaw) != p.RequestSHA256 {
		return out, errors.New("local original request differs from public plan")
	}
	identityRaw, err := pqLabRead(filepath.Join(h.RootDir, "identity.json"), MaxPQLabDistributedIdentityBytes)
	if err != nil {
		return out, err
	}
	if _, err = pqDistributedIdentity(identityRaw, p.IdentitySHA256[index], p.Request, p.RequestSHA256, index); err != nil {
		return out, err
	}
	n := pqDistributedNode(h, id, p.Request.OperationID)
	pv, err := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, p.ChainID)
	if err != nil {
		return out, err
	}
	defer clear(pv.Key.PrivKey.(cmted.PrivKey))
	if !bytes.Equal(pv.Key.PubKey.Bytes(), id.LegacyPublicKey) || !bytes.Equal(pv.Key.Address, id.ValidatorAddress) || pv.LastSignState.Height != 0 {
		return out, errors.New("original fresh local validator identity/HRS differs")
	}
	nkRaw, err := pqLabRead(n.NodeKeyFile, 16<<10)
	if err != nil {
		return out, err
	}
	defer clear(nkRaw)
	var nk p2p.NodeKey
	if err = cmtjson.Unmarshal(nkRaw, &nk); err != nil {
		return out, err
	}
	if secret, ok := nk.PrivKey.(cmted.PrivKey); ok {
		defer clear(secret)
	} else {
		return out, errors.New("original local Ed25519 node key required")
	}
	if !bytes.Equal(nk.PubKey().Bytes(), id.NodePublicKey) || string(nk.ID()) != id.NodeID {
		return out, errors.New("original local node identity differs")
	}
	key, material, err := loadPQLabCandidate(n)
	if err != nil {
		return out, err
	}
	defer key.Destroy()
	defer material.Clear()
	stage := filepath.Join(h.RootDir, "import")
	if err = pqLabNetworkFreshDirectory(stage); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "intent.json"), struct {
		PlanSHA256 string
		Index      int
	}{pin, index}); err != nil {
		return out, err
	}
	config := pqDistributedConfig(p, n)
	if err = config.ValidateBasic(); err != nil {
		return out, err
	}
	// Render with the original maintained Comet template into this new attempt;
	// destination writes are still O_EXCL and no failed original is removed.
	rendered := filepath.Join(stage, "config.toml")
	if err = writeCometConfig(rendered, config); err != nil {
		return out, err
	}
	if err = os.Chmod(rendered, 0600); err != nil {
		return out, err
	}
	configRaw, err := pqLabRead(rendered, 1<<20)
	if err != nil {
		return out, err
	}
	if err = pqDistributedConfigEqual(configRaw, config); err != nil {
		return out, err
	}
	n.ConfigSHA256 = pqLabSHA(configRaw)
	n.BootstrapArgs = append(pqDistributedNormalArgs(p, n), "--height-halt-control", n.HaltControl, "--operator-plan-sha256", pin, "--height-halt-session-id", p.Request.OperationID)
	for _, f := range []struct {
		path string
		raw  []byte
	}{{filepath.Join(h.RootDir, "plan.json"), raw}, {filepath.Join(h.RootDir, "bound-migration.json"), p.MigrationRaw}, {filepath.Join(h.RootDir, "genesis.json"), p.GenesisRaw}, {filepath.Join(n.Home, "config", "genesis.json"), p.GenesisRaw}, {filepath.Join(n.Home, "config", "config.toml"), configRaw}} {
		if err = pqLabWrite(f.path, f.raw); err != nil {
			return out, err
		}
	}
	out = PQLabDistributedLocalRecord{Version: "YNX-PQ-DISTRIBUTED-LAB-LOCAL/v1", PlanSHA256: pin, IdentitySHA256: p.IdentitySHA256[index], Host: h, Node: n}
	if err = pqLabWriteJSON(filepath.Join(h.RootDir, "local.json"), out); err != nil {
		return out, err
	}
	return out, nil
}

// Load is a public-source validator, not a private-key importer or a node
// starter. Only the selected host is opened. Cold callers still validate the
// complete original migration/bootstrap and all public plan bindings.
func LoadPQLabDistributedLocal(root, independentPlanSHA string) (*PQLabDistributedLocal, error) {
	raw, err := pqLabRead(filepath.Join(root, "plan.json"), MaxPQLabDistributedPlanBytes)
	if err != nil {
		return nil, err
	}
	p, m, b, err := DecodePQLabDistributedPlan(raw, independentPlanSHA)
	if err != nil {
		return nil, err
	}
	recordRaw, err := pqLabRead(filepath.Join(root, "local.json"), 64<<10)
	if err != nil {
		return nil, err
	}
	var record PQLabDistributedLocalRecord
	if err = pqLabDecode(recordRaw, &record); err != nil {
		return nil, err
	}
	i := record.Host.Index
	if i < 0 || i >= 4 || record.Version != "YNX-PQ-DISTRIBUTED-LAB-LOCAL/v1" || record.PlanSHA256 != independentPlanSHA || record.IdentitySHA256 != p.IdentitySHA256[i] || root != p.Request.Hosts[i].RootDir || !reflect.DeepEqual(record.Host, p.Request.Hosts[i]) || record.NodeStarted || record.PhysicalHostAgreement {
		return nil, errors.New("local original identity/plan mismatch")
	}
	h := record.Host
	if err = pqDistributedHostCurrent(h, p.Request); err != nil {
		return nil, err
	}
	if err = pqDistributedOwnedDirectory(root, h); err != nil {
		return nil, err
	}
	requestRaw, err := pqLabRead(filepath.Join(root, "request.json"), MaxPQLabDistributedRequestBytes)
	if err != nil || pqLabSHA(requestRaw) != p.RequestSHA256 {
		return nil, errors.New("original local request changed")
	}
	identityRaw, err := pqLabRead(filepath.Join(root, "identity.json"), MaxPQLabDistributedIdentityBytes)
	if err != nil {
		return nil, err
	}
	if _, err = pqDistributedIdentity(identityRaw, p.IdentitySHA256[i], p.Request, p.RequestSHA256, i); err != nil {
		return nil, err
	}
	n := pqDistributedNode(h, p.Identities[i], p.Request.OperationID)
	configRaw, err := pqLabRead(filepath.Join(n.Home, "config", "config.toml"), 1<<20)
	if err != nil {
		return nil, err
	}
	if err = pqDistributedConfigEqual(configRaw, pqDistributedConfig(p, n)); err != nil {
		return nil, err
	}
	n.ConfigSHA256 = pqLabSHA(configRaw)
	n.BootstrapArgs = append(pqDistributedNormalArgs(p, n), "--height-halt-control", n.HaltControl, "--operator-plan-sha256", independentPlanSHA, "--height-halt-session-id", p.Request.OperationID)
	if !reflect.DeepEqual(n, record.Node) {
		return nil, errors.New("local normal arguments differ from pinned public plan")
	}
	for _, f := range []struct {
		path string
		raw  []byte
	}{{filepath.Join(root, "bound-migration.json"), p.MigrationRaw}, {filepath.Join(root, "genesis.json"), p.GenesisRaw}, {filepath.Join(n.Home, "config", "genesis.json"), p.GenesisRaw}} {
		actual, e := pqLabRead(f.path, 64<<20)
		if e != nil || !bytes.Equal(actual, f.raw) {
			return nil, errors.New("original host public source changed")
		}
	}
	in := &PQLabDistributedLocal{plan: p, migration: m, bootstrap: b, node: n, genesisRaw: bytes.Clone(p.GenesisRaw), migrationRaw: bytes.Clone(p.MigrationRaw), root: root, planSHA: independentPlanSHA}
	if err = loadPQLabDistributedActivation(in); err != nil {
		return nil, err
	}
	return in, nil
}
