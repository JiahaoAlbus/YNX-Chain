//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cfg "github.com/cometbft/cometbft/config"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/node"
	"github.com/cometbft/cometbft/p2p"
	"github.com/cometbft/cometbft/privval"
)

const PQLabNetworkVersion = "YNX-PQ-LOOPBACK-NETWORK/v1"
const pqLabRegistrationReadyRule = "four-quiet-committed-apps-next-height;wait-for-prior-transaction-proof-successor"

// PQLabNetworkPlan describes four separate normal ynx-comet processes. The
// producer never starts them, submits transactions, or asserts a quorum. All
// generated keys belong exclusively to this new synthetic network.
type PQLabNetworkPlan struct {
	Version               string             `json:"version"`
	SyntheticOnly         bool               `json:"syntheticOnly"`
	PublicNetwork         bool               `json:"publicNetwork"`
	CreateEmptyBlocks     bool               `json:"createEmptyBlocks"`
	RegistrationReadyRule string             `json:"registrationReadyRule"`
	RootDir               string             `json:"rootDir"`
	ChainID               string             `json:"chainId"`
	NativeChainID         int64              `json:"nativeChainId,string"`
	InitialHeight         int64              `json:"initialHeight,string"`
	OriginalGenesisHash   string             `json:"originalGenesisHash"`
	MigrationStateHash    string             `json:"migrationStateHash"`
	CometGenesisSHA256    string             `json:"cometGenesisSHA256"`
	MigrationFile         string             `json:"migrationFile"`
	GenesisFile           string             `json:"genesisFile"`
	IdentityFile          string             `json:"identityFile"`
	IdentitySHA256        string             `json:"identitySHA256"`
	SessionID             string             `json:"sessionId"`
	Nodes                 []PQLabNetworkNode `json:"nodes"`
}

type PQLabNetworkNode struct {
	Index                  int      `json:"index"`
	Home                   string   `json:"home"`
	StatePath              string   `json:"statePath"`
	LegacyKeyFile          string   `json:"legacyKeyFile"`
	LegacyStateFile        string   `json:"legacyStateFile"`
	NodeKeyFile            string   `json:"nodeKeyFile"`
	NodeID                 string   `json:"nodeId"`
	ConfigSHA256           string   `json:"configSHA256"`
	ValidatorAddress       []byte   `json:"validatorAddress"`
	PublicA                []byte   `json:"publicA"`
	PublicB                []byte   `json:"publicB"`
	CandidateMaterialFile  string   `json:"candidateMaterialFile"`
	RecoveryCredentialFile string   `json:"recoveryCredentialFile"`
	RecoveryFD             int      `json:"recoveryFD"`
	HostBindingFile        string   `json:"hostBindingFile"`
	VaultFile              string   `json:"vaultFile"`
	SignerStateFile        string   `json:"signerStateFile"`
	RPCAddress             string   `json:"rpcAddress"`
	P2PAddress             string   `json:"p2pAddress"`
	HaltControl            string   `json:"haltControl"`
	BootstrapArgs          []string `json:"bootstrapArgs"`
}

type PQLabNetworkOptions struct {
	RootDir          string
	BaseP2P, BaseRPC int
}

// The original public-network generator's failure cleanup and key writers are
// intentionally not reused: no failed ceremony may delete or replace material.
func GeneratePQLabNetwork(migration chain.ConsensusMigrationState, options PQLabNetworkOptions) (plan PQLabNetworkPlan, err error) {
	if err = migration.Validate(); err != nil {
		return plan, err
	}
	if migration.Network.ChainID != PQLabNativeChainID || migration.Network.IsPublicNet || !strings.HasPrefix(migration.Network.Slug, "pq-lab-") || len(migration.Validators) != 4 {
		return plan, errors.New("PQ lab requires a fresh isolated four-member unbound synthetic migration")
	}
	ports := map[int]bool{}
	for _, base := range []int{options.BaseP2P, options.BaseRPC} {
		if base < 1024 || base > 65532 {
			return plan, errors.New("invalid loopback port range")
		}
		for i := 0; i < 4; i++ {
			if ports[base+i] {
				return plan, errors.New("overlapping loopback ports")
			}
			ports[base+i] = true
		}
	}
	for _, member := range migration.Validators {
		if !member.Active || member.VotingPower <= 0 || member.ConsensusKeyType != "" || member.ConsensusPubKey != "" || member.ConsensusAddress != "" {
			return plan, errors.New("all four original lab validators must be active")
		}
	}
	if err = pqLabNetworkFreshDirectory(options.RootDir); err != nil {
		return plan, err
	}
	plan = PQLabNetworkPlan{Version: PQLabNetworkVersion, SyntheticOnly: true, RegistrationReadyRule: pqLabRegistrationReadyRule, RootDir: options.RootDir, NativeChainID: migration.Network.ChainID,
		MigrationFile: filepath.Join(options.RootDir, "bound-migration.json"), GenesisFile: filepath.Join(options.RootDir, "genesis.json"), IdentityFile: filepath.Join(options.RootDir, "identity.json")}
	var session [32]byte
	if _, err = rand.Read(session[:]); err != nil {
		return plan, err
	}
	plan.SessionID = hex.EncodeToString(session[:])
	var bindings []chain.ConsensusValidatorKeyBinding
	for i, member := range migration.Validators {
		home := filepath.Join(plan.RootDir, fmt.Sprintf("validator-%d", i))
		for _, dir := range []string{home, filepath.Join(home, "config"), filepath.Join(home, "data"), filepath.Join(home, "custody")} {
			if err = os.Mkdir(dir, 0700); err != nil {
				return plan, err
			}
		}
		n := PQLabNetworkNode{Index: i, Home: home, StatePath: filepath.Join(home, "data", "application.json"), LegacyKeyFile: filepath.Join(home, "config", "priv_validator_key.json"), LegacyStateFile: filepath.Join(home, "data", "priv_validator_state.json"), NodeKeyFile: filepath.Join(home, "config", "node_key.json"),
			CandidateMaterialFile: filepath.Join(home, "custody", "candidate-material.json"), RecoveryCredentialFile: filepath.Join(home, "custody", "recovery.raw"), RecoveryFD: 3, HostBindingFile: filepath.Join(home, "custody", "host-binding.json"), VaultFile: filepath.Join(home, "custody", "host-key.vault"), SignerStateFile: filepath.Join(home, "custody", "pq-sign-state.json"), RPCAddress: fmt.Sprintf("http://127.0.0.1:%d", options.BaseRPC+i), P2PAddress: fmt.Sprintf("tcp://127.0.0.1:%d", options.BaseP2P+i)}
		n.HaltControl = filepath.Join(home, "data", "operator-height-halt-"+plan.SessionID+".json")
		pv := privval.GenFilePV(n.LegacyKeyFile, n.LegacyStateFile)
		keyRaw, marshalErr := cmtjson.Marshal(&pv.Key)
		if marshalErr != nil {
			return plan, marshalErr
		}
		err = pqLabWrite(n.LegacyKeyFile, keyRaw)
		clear(keyRaw)
		if err != nil {
			return plan, err
		}
		stateRaw, marshalErr := cmtjson.Marshal(&pv.LastSignState)
		if marshalErr != nil {
			return plan, marshalErr
		}
		if err = pqLabWrite(n.LegacyStateFile, stateRaw); err != nil {
			return plan, err
		}
		n.ValidatorAddress = bytes.Clone(pv.Key.Address)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: member.Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(pv.Key.PubKey.Bytes()), ConsensusAddress: strings.ToUpper(hex.EncodeToString(pv.Key.Address))})
		clear(pv.Key.PrivKey.(cmted.PrivKey))
		nodeKey := &p2p.NodeKey{PrivKey: cmted.GenPrivKey()}
		n.NodeID = string(nodeKey.ID())
		nodeRaw, marshalErr := cmtjson.Marshal(nodeKey)
		if marshalErr != nil {
			return plan, marshalErr
		}
		err = pqLabWrite(n.NodeKeyFile, nodeRaw)
		clear(nodeRaw)
		clear(nodeKey.PrivKey.(cmted.PrivKey))
		if err != nil {
			return plan, err
		}
		key, material, keyErr := ynxconsensusauth.GenerateCandidateKeyMaterial()
		if keyErr != nil {
			return plan, keyErr
		}
		key.Destroy()
		n.PublicA, n.PublicB = bytes.Clone(material.PublicA), bytes.Clone(material.PublicB)
		materialRaw, marshalErr := json.Marshal(material)
		material.Clear()
		if marshalErr != nil {
			return plan, marshalErr
		}
		err = pqLabWrite(n.CandidateMaterialFile, materialRaw)
		clear(materialRaw)
		if err != nil {
			return plan, err
		}
		credential, keyErr := ynxconsensusauth.GenerateHostRecoveryCredential()
		if keyErr != nil {
			return plan, keyErr
		}
		err = pqLabWrite(n.RecoveryCredentialFile, credential)
		clear(credential)
		if err != nil {
			return plan, err
		}
		plan.Nodes = append(plan.Nodes, n)
	}
	bound, err := migration.BindConsensusValidatorKeys(bindings)
	if err != nil {
		return plan, err
	}
	migrationRaw, err := bound.CanonicalJSON()
	if err != nil {
		return plan, err
	}
	if err = pqLabWrite(plan.MigrationFile, migrationRaw); err != nil {
		return plan, err
	}
	doc, err := BuildCometGenesis(bound, time.Now().UTC().Truncate(time.Second))
	if err != nil {
		return plan, err
	}
	genesis, err := cmtjson.Marshal(doc)
	if err != nil {
		return plan, err
	}
	plan.ChainID, plan.InitialHeight = doc.ChainID, doc.InitialHeight
	plan.OriginalGenesisHash, plan.MigrationStateHash, plan.CometGenesisSHA256 = bound.OriginalGenesisHash, bound.StateHash, pqLabSHA(genesis)
	if err = pqLabWrite(plan.GenesisFile, genesis); err != nil {
		return plan, err
	}
	if _, err = NewConsensusBootstrap(genesis, plan.pins(), bound); err != nil {
		return plan, err
	}
	// Freeze a distinct public identity document before command metadata. Its
	// actual bytes are the independent halt-session pin, not a circular plan hash.
	identity, err := json.Marshal(struct{ Version, ChainID, GenesisSHA256, MigrationHash, SessionID string }{PQLabNetworkVersion, plan.ChainID, plan.CometGenesisSHA256, plan.MigrationStateHash, plan.SessionID})
	if err != nil {
		return plan, err
	}
	plan.IdentitySHA256 = pqLabSHA(identity)
	if err = pqLabWrite(plan.IdentityFile, identity); err != nil {
		return plan, err
	}
	for i := range plan.Nodes {
		n := &plan.Nodes[i]
		config := cfg.DefaultConfig().SetRoot(n.Home)
		config.Moniker = fmt.Sprintf("synthetic-pq-%d", i)
		config.RPC.ListenAddress = strings.Replace(n.RPCAddress, "http://", "tcp://", 1)
		config.P2P.ListenAddress = n.P2PAddress
		config.P2P.AllowDuplicateIP = true
		config.P2P.AddrBookStrict = false
		var peers []string
		for j, peer := range plan.Nodes {
			if j != i {
				peers = append(peers, peer.NodeID+"@"+strings.TrimPrefix(peer.P2PAddress, "tcp://"))
			}
		}
		config.P2P.PersistentPeers = strings.Join(peers, ",")
		config.Consensus.CreateEmptyBlocks = false
		config.Consensus.TimeoutCommit = time.Second
		config.TxIndex.Indexer = "kv"
		if err = config.ValidateBasic(); err != nil {
			return plan, err
		}
		if err = writeCometConfig(filepath.Join(n.Home, "config", "config.toml"), config); err != nil {
			return plan, err
		}
		configPath := filepath.Join(n.Home, "config", "config.toml")
		if err = os.Chmod(configPath, 0600); err != nil {
			return plan, err
		}
		configRaw, readErr := pqLabRead(configPath, 1<<20)
		if readErr != nil {
			return plan, readErr
		}
		n.ConfigSHA256 = pqLabSHA(configRaw)
		if err = pqLabWrite(filepath.Join(n.Home, "config", "genesis.json"), genesis); err != nil {
			return plan, err
		}
		n.BootstrapArgs = append(plan.normalArgs(*n), "--height-halt-control", n.HaltControl, "--operator-plan-sha256", plan.IdentitySHA256, "--height-halt-session-id", plan.SessionID)
	}
	if err = pqLabWriteJSON(filepath.Join(plan.RootDir, "network-plan.json"), plan); err != nil {
		return plan, err
	}
	return plan, nil
}

func (p PQLabNetworkPlan) pins() ConsensusBootstrapPins {
	return ConsensusBootstrapPins{CometGenesisSHA256: p.CometGenesisSHA256, OriginalGenesisHash: p.OriginalGenesisHash, MigrationStateHash: p.MigrationStateHash}
}
func (p PQLabNetworkPlan) normalArgs(n PQLabNetworkNode) []string {
	return []string{"start", "--home", n.Home, "--migration-state", p.MigrationFile, "--abci-state", n.StatePath, "--abci-state-layout", "atomic-json", "--consensus-genesis-sha256", p.CometGenesisSHA256, "--original-genesis-hash", p.OriginalGenesisHash, "--bound-migration-state-hash", p.MigrationStateHash}
}

type PQLabValidatorRegistration struct {
	Version           string `json:"version"`
	SyntheticOnly     bool   `json:"syntheticOnly"`
	NodeIndex         int    `json:"nodeIndex"`
	ApprovedAt        int64  `json:"approvedAt,string"`
	Transaction       []byte `json:"transaction"`
	TransactionHash   string `json:"transactionHash"`
	BroadcastExecuted bool   `json:"broadcastExecuted"`
}

// Each node can issue this original once. The runner supplies an observed quiet
// next height, posts exactly these bytes once, and reconciles by the same hash.
// A missed height or unknown response cannot re-enter this signing ceremony.
func PreparePQLabValidatorRegistration(root, planSHA string, index int, approvedAt int64) (PQLabValidatorRegistration, error) {
	p, m, b, err := loadPQLab(root, planSHA)
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	if index < 0 || index >= 4 || approvedAt < p.InitialHeight || approvedAt > math.MaxInt64-2 {
		return PQLabValidatorRegistration{}, errors.New("invalid lab registration node or height")
	}
	// Do not pre-sign next-height approvals during create. All four normal
	// applications must already have committed the same actual checkpoint.
	// This observation supplies no consensus authority; the original executor
	// still requires exact ApprovedAt. The runner must wait for quiet RPCs and
	// the preceding transaction's proof successor before invoking this stage.
	checkpoint, err := pqLabRegistrationCheckpoint(p, m, b, approvedAt)
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	n := p.Nodes[index]
	stage := filepath.Join(n.Home, "registration")
	if err = pqLabNetworkFreshDirectory(stage); err != nil {
		return PQLabValidatorRegistration{}, err
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "intent.json"), struct {
		PlanSHA string
		Height  int64
	}{planSHA, approvedAt}); err != nil {
		return PQLabValidatorRegistration{}, err
	}
	key, material, err := loadPQLabCandidate(n)
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	defer key.Destroy()
	defer material.Clear()
	pv, err := LoadPQOriginalLegacyValidator(n.LegacyKeyFile, n.LegacyStateFile, p.ChainID)
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	legacy := pv.Key.PrivKey.(cmted.PrivKey)
	defer clear(legacy)
	if !bytes.Equal(pv.Key.Address, n.ValidatorAddress) {
		return PQLabValidatorRegistration{}, errors.New("original lab validator key changed")
	}
	intent := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(b.genesisID), ChainID: p.ChainID, ValidatorAddress: bytes.Clone(n.ValidatorAddress), Sequence: 1, Epoch: 1, ApprovedAt: approvedAt, EffectiveAt: approvedAt + 2, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(pv.Key.PubKey.Bytes()), MLDSA87PublicKey: bytes.Clone(n.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(n.PublicB)}
	message, err := intent.AuthoritySigningBytes()
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	a, bsig, err := key.RegistrationPossession(intent)
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	wire, err := (ynxconsensusauth.Registration{Intent: intent, LegacyApproval: ed25519.Sign(ed25519.PrivateKey(legacy), message), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: bsig}).MarshalBinary()
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	tx, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		return PQLabValidatorRegistration{}, err
	}
	after, err := pqLabRegistrationCheckpoint(p, m, b, approvedAt)
	if err != nil || after != checkpoint {
		return PQLabValidatorRegistration{}, errors.New("lab checkpoint advanced during one-shot registration; preserve intent and do not re-sign")
	}
	result := PQLabValidatorRegistration{Version: "YNX-PQ-LAB-REGISTRATION/v1", SyntheticOnly: true, NodeIndex: index, ApprovedAt: approvedAt, Transaction: tx, TransactionHash: pqLabSHA(tx)}
	if err = pqLabWriteJSON(filepath.Join(stage, "registration.json"), result); err != nil {
		return PQLabValidatorRegistration{}, err
	}
	return result, nil
}

func pqLabRegistrationCheckpoint(p PQLabNetworkPlan, m chain.ConsensusMigrationState, b *ConsensusBootstrap, next int64) (string, error) {
	var hash string
	for _, n := range p.Nodes {
		state, err := readPQEngineCommittedState(n.StatePath, m, b, nil, nil)
		if err != nil {
			return "", err
		}
		if !state.Initialized || state.Height <= 0 || state.Height >= math.MaxInt64 || state.Height+1 != next || state.PQEngineSchedule != nil {
			return "", errors.New("registration requires the actual common bootstrap next execution height")
		}
		if hash != "" && hash != state.AppHash {
			return "", errors.New("four live lab application checkpoints differ")
		}
		hash = state.AppHash
	}
	return hash, nil
}

// PublishPQLabHeightHalt uses the normal single-use publisher. It does not infer
// that nodes have stopped. A partial publication is retained and cannot retry.
func PublishPQLabHeightHalt(root, planSHA string, height int64) ([]HeightHaltPublicationResult, error) {
	p, _, _, err := loadPQLab(root, planSHA)
	if err != nil {
		return nil, err
	}
	if height < p.InitialHeight || height > math.MaxInt64-4 {
		return nil, errors.New("invalid lab halt height")
	}
	if err = pqLabNetworkFreshDirectory(filepath.Join(root, "halt-attempt")); err != nil {
		return nil, err
	}
	var results []HeightHaltPublicationResult
	for _, n := range p.Nodes {
		control := node.HeightHaltControl{Path: n.HaltControl, ChainID: p.ChainID, GenesisSHA256: p.CometGenesisSHA256, OperatorPlanSHA256: p.IdentitySHA256, SessionID: p.SessionID}
		raw, err := json.Marshal(node.HeightHaltRequest{Version: "YNX-OPERATOR-HEIGHT-HALT/v1", TargetHeight: strconv.FormatInt(height, 10), ChainID: control.ChainID, GenesisSHA256: control.GenesisSHA256, OperatorPlanSHA256: control.OperatorPlanSHA256, SessionID: control.SessionID})
		if err != nil {
			return nil, err
		}
		result, err := PublishHeightHaltRequest(raw, pqLabSHA(raw), HeightHaltPublicationOptions{ApplicationStatePath: n.StatePath, Control: control})
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if err = pqLabWriteJSON(filepath.Join(root, "halt-attempt", "result.json"), results); err != nil {
		return nil, err
	}
	return results, nil
}

type PQLabActivation struct {
	Version           string                `json:"version"`
	SyntheticOnly     bool                  `json:"syntheticOnly"`
	NetworkPlanSHA256 string                `json:"networkPlanSHA256"`
	RegistryHeight    int64                 `json:"registryHeight,string"`
	AppHash           string                `json:"appHash"`
	RegistryRoot      string                `json:"registryRoot"`
	ScheduleFile      string                `json:"scheduleFile"`
	ScheduleHash      string                `json:"scheduleHash"`
	ParamsHeight      int64                 `json:"paramsHeight,string"`
	ValidatorHeight   int64                 `json:"validatorHeight,string"`
	ActivationHeight  int64                 `json:"activationHeight,string"`
	Nodes             []PQLabActivationNode `json:"nodes"`
	NodeStarted       bool                  `json:"nodeStarted"`
	PQQuorumVerified  bool                  `json:"pqQuorumVerified"`
}
type PQLabActivationNode struct {
	Index                  int      `json:"index"`
	Args                   []string `json:"args"`
	RecoveryFD             int      `json:"recoveryFD"`
	RecoveryCredentialFile string   `json:"recoveryCredentialFile"`
}

// Activation prepares the existing normal CLI; it never starts it. Inspect uses
// real stopped DB + App + original signing leases. A second exact observation
// and the normal startup R admission fence reject concurrent advancement.
func ActivatePQLabNetwork(root, planSHA string) (PQLabActivation, error) {
	p, m, b, err := loadPQLab(root, planSHA)
	if err != nil {
		return PQLabActivation{}, err
	}
	stage := filepath.Join(root, "activation")
	if err = pqLabNetworkFreshDirectory(stage); err != nil {
		return PQLabActivation{}, err
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "intent.json"), struct{ PlanSHA string }{planSHA}); err != nil {
		return PQLabActivation{}, err
	}
	genesis, err := pqLabRead(p.GenesisFile, 64<<20)
	if err != nil {
		return PQLabActivation{}, err
	}
	inspect := func(n PQLabNetworkNode, activation int64) (OperatorCheckpointResult, error) {
		return InspectOperatorCheckpoint(m, genesis, p.pins(), OperatorCheckpointOptions{StatePath: n.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(n.Home, "data"), SigningStatePath: n.LegacyStateFile, ProposePQActivationHeight: activation})
	}
	checkpoints := make([]OperatorCheckpointResult, 4)
	var schedule *PQEngineSchedule
	var scheduleRaw []byte
	for i, n := range p.Nodes {
		cp, e := inspect(n, 0)
		if e != nil {
			return PQLabActivation{}, e
		}
		if cp.Height > math.MaxInt64-4 || cp.RegistryEventCount != 4 || cp.CommittedScheduleHash != nil {
			return PQLabActivation{}, errors.New("lab activation requires complete unscheduled original four-member registry")
		}
		if i > 0 && (cp.Height != checkpoints[0].Height || cp.AppHash != checkpoints[0].AppHash || cp.RegistryRoot != checkpoints[0].RegistryRoot) {
			return PQLabActivation{}, errors.New("four original lab engine checkpoints differ")
		}
		checkpoints[i] = cp
		candidate, e := inspect(n, cp.Height+4)
		if e != nil {
			return PQLabActivation{}, e
		}
		if candidate.ScheduleCandidate == nil {
			return PQLabActivation{}, errors.New("actual checkpoint did not produce a schedule candidate")
		}
		raw, e := base64.StdEncoding.DecodeString(candidate.ScheduleCandidate.CanonicalScheduleBase64)
		if e != nil {
			return PQLabActivation{}, e
		}
		if i == 0 {
			scheduleRaw = raw
			var decoded PQEngineSchedule
			if e = json.Unmarshal(raw, &decoded); e != nil {
				return PQLabActivation{}, e
			}
			schedule = &decoded
		} else if !bytes.Equal(raw, scheduleRaw) {
			return PQLabActivation{}, errors.New("four actual registry schedule candidates differ")
		}
	}
	pin, err := schedule.Hash()
	if err != nil {
		return PQLabActivation{}, err
	}
	auth, err := NewPQEngineAuthorization(scheduleRaw, pin)
	if err != nil {
		return PQLabActivation{}, err
	}
	result := PQLabActivation{Version: "YNX-PQ-LAB-ACTIVATION/v1", SyntheticOnly: true, NetworkPlanSHA256: planSHA, RegistryHeight: schedule.RegistryHeight, AppHash: checkpoints[0].AppHash, RegistryRoot: schedule.RegistryRoot, ScheduleFile: filepath.Join(stage, "schedule.json"), ScheduleHash: pin, ParamsHeight: schedule.ParamsUpdateHeight, ValidatorHeight: schedule.ValidatorUpdateHeight, ActivationHeight: schedule.ActivationHeight}
	if err = pqLabWrite(result.ScheduleFile, scheduleRaw); err != nil {
		return PQLabActivation{}, err
	}
	for _, n := range p.Nodes {
		if err = preparePQLabCustody(p, n, m, b, auth, checkpoints[n.Index]); err != nil {
			return PQLabActivation{}, err
		}
		args := append(p.normalArgs(n), "--pq-engine-schedule", result.ScheduleFile, "--pq-engine-schedule-hash", pin, "--pq-host-key-binding", n.HostBindingFile, "--pq-host-key-vault", n.VaultFile, "--pq-recovery-fd", "3")
		result.Nodes = append(result.Nodes, PQLabActivationNode{Index: n.Index, Args: args, RecoveryFD: 3, RecoveryCredentialFile: n.RecoveryCredentialFile})
	}
	for i, n := range p.Nodes {
		after, e := inspect(n, 0)
		if e != nil || !reflect.DeepEqual(after, checkpoints[i]) {
			return PQLabActivation{}, fmt.Errorf("original lab checkpoint changed before activation metadata: %w", e)
		}
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "activation.json"), result); err != nil {
		return PQLabActivation{}, err
	}
	return result, nil
}

func preparePQLabCustody(p PQLabNetworkPlan, n PQLabNetworkNode, m chain.ConsensusMigrationState, b *ConsensusBootstrap, a *PQEngineAuthorization, cp OperatorCheckpointResult) error {
	source, err := NewPQEngineFileSource(m, n.StatePath, b, a)
	if err != nil {
		return err
	}
	hash, err := hex.DecodeString(cp.AppHash)
	if err != nil {
		return err
	}
	if _, err = source.ConsensusAuthorityForState(p.ChainID, cp.Height, hash); err != nil {
		return err
	}
	registry, err := NewPQCommittedSignerRegistry(source, b)
	if err != nil {
		return err
	}
	key, material, err := loadPQLabCandidate(n)
	if err != nil {
		return err
	}
	defer key.Destroy()
	defer material.Clear()
	binding := ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(b.genesisID), ChainID: p.ChainID, ActivationHeight: a.schedule.ActivationHeight}, ValidatorAddress: bytes.Clone(n.ValidatorAddress), Epoch: 1, MLDSA87PublicKey: bytes.Clone(n.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(n.PublicB), SignerStatePath: n.SignerStateFile}
	// This is the only creation of a new epoch's HRS. Reentry is blocked by the
	// exclusive activation directory before any custody operation occurs.
	signer, err := ynxconsensusauth.CreateSigner(binding.SignerStatePath, key, binding.Policy, registry, binding.ValidatorAddress, 1)
	if err != nil {
		return err
	}
	if err = signer.Close(); err != nil {
		return err
	}
	credential, err := pqLabRead(n.RecoveryCredentialFile, 32)
	if err != nil {
		return err
	}
	defer clear(credential)
	vault, err := ynxconsensusauth.SealHostKeyEnvelope(material, binding, credential)
	if err != nil {
		return err
	}
	if err = pqLabWrite(n.VaultFile, vault); err != nil {
		return err
	}
	return pqLabWriteJSON(n.HostBindingFile, binding)
}

func loadPQLabCandidate(n PQLabNetworkNode) (*ynxconsensusauth.CandidateKey, ynxconsensusauth.CandidateKeyMaterial, error) {
	var m ynxconsensusauth.CandidateKeyMaterial
	raw, err := pqLabRead(n.CandidateMaterialFile, 64<<10)
	if err != nil {
		return nil, m, err
	}
	defer clear(raw)
	if err = pqLabDecode(raw, &m); err != nil {
		return nil, m, err
	}
	key, err := ynxconsensusauth.ImportCandidateKeyMaterial(m, n.PublicA, n.PublicB)
	if err != nil {
		m.Clear()
	}
	return key, m, err
}

func loadPQLab(root, pin string) (p PQLabNetworkPlan, m chain.ConsensusMigrationState, b *ConsensusBootstrap, err error) {
	if err = requireInspectionPath(root); err != nil {
		return
	}
	raw, err := pqLabRead(filepath.Join(root, "network-plan.json"), 1<<20)
	if err != nil {
		return p, m, nil, err
	}
	if pqLabSHA(raw) != pin {
		return p, m, nil, errors.New("lab plan differs from external exact SHA256")
	}
	if err = pqLabDecode(raw, &p); err != nil {
		return
	}
	if p.Version != PQLabNetworkVersion || !p.SyntheticOnly || p.PublicNetwork || p.CreateEmptyBlocks || p.RegistrationReadyRule != pqLabRegistrationReadyRule || p.NativeChainID != PQLabNativeChainID || p.RootDir != root || len(p.Nodes) != 4 || p.MigrationFile != filepath.Join(root, "bound-migration.json") || p.GenesisFile != filepath.Join(root, "genesis.json") || p.IdentityFile != filepath.Join(root, "identity.json") {
		return p, m, nil, errors.New("invalid isolated lab plan")
	}
	for i, n := range p.Nodes {
		home := filepath.Join(root, fmt.Sprintf("validator-%d", i))
		want := [][2]string{{n.Home, home}, {n.StatePath, filepath.Join(home, "data", "application.json")}, {n.LegacyKeyFile, filepath.Join(home, "config", "priv_validator_key.json")}, {n.LegacyStateFile, filepath.Join(home, "data", "priv_validator_state.json")}, {n.NodeKeyFile, filepath.Join(home, "config", "node_key.json")}, {n.CandidateMaterialFile, filepath.Join(home, "custody", "candidate-material.json")}, {n.RecoveryCredentialFile, filepath.Join(home, "custody", "recovery.raw")}, {n.HostBindingFile, filepath.Join(home, "custody", "host-binding.json")}, {n.VaultFile, filepath.Join(home, "custody", "host-key.vault")}, {n.SignerStateFile, filepath.Join(home, "custody", "pq-sign-state.json")}, {n.HaltControl, filepath.Join(home, "data", "operator-height-halt-"+p.SessionID+".json")}}
		if n.Index != i || n.RecoveryFD != 3 || len(n.PublicA) != ynxconsensusauth.MLDSA87PublicKeySize || len(n.PublicB) != ynxconsensusauth.SLHDSASHA2256fPublicKeySize {
			return p, m, nil, errors.New("invalid lab node identity")
		}
		for _, pair := range want {
			if pair[0] != pair[1] {
				return p, m, nil, errors.New("lab file path escaped its original node")
			}
		}
		for _, path := range []string{home, filepath.Join(home, "data"), filepath.Join(home, "custody"), filepath.Join(home, "config")} {
			if err = requireInspectionPath(path); err != nil {
				return
			}
		}
		if !strings.HasPrefix(n.RPCAddress, "http://127.0.0.1:") || !strings.HasPrefix(n.P2PAddress, "tcp://127.0.0.1:") {
			return p, m, nil, errors.New("lab endpoints must remain loopback")
		}
		expected := append(p.normalArgs(n), "--height-halt-control", n.HaltControl, "--operator-plan-sha256", p.IdentitySHA256, "--height-halt-session-id", p.SessionID)
		if !reflect.DeepEqual(expected, n.BootstrapArgs) {
			return p, m, nil, errors.New("lab normal command metadata changed")
		}
		config, readErr := pqLabRead(filepath.Join(home, "config", "config.toml"), 1<<20)
		if readErr != nil || pqLabSHA(config) != n.ConfigSHA256 {
			return p, m, nil, errors.New("original loopback configuration changed")
		}
	}
	identity, err := pqLabRead(p.IdentityFile, 1<<20)
	if err != nil {
		return p, m, nil, err
	}
	if pqLabSHA(identity) != p.IdentitySHA256 {
		return p, m, nil, errors.New("lab independent identity bytes changed")
	}
	migrationRaw, err := pqLabRead(p.MigrationFile, 1<<30)
	if err != nil {
		return p, m, nil, err
	}
	if err = json.Unmarshal(migrationRaw, &m); err != nil {
		return
	}
	if m.Network.ChainID != PQLabNativeChainID || m.Network.IsPublicNet {
		return p, m, nil, errors.New("public migration cannot enter lab custody")
	}
	genesis, err := pqLabRead(p.GenesisFile, 64<<20)
	if err != nil {
		return p, m, nil, err
	}
	b, err = NewConsensusBootstrap(genesis, p.pins(), m)
	if err != nil {
		return
	}
	if b.record.ChainID != p.ChainID || b.record.InitialHeight != p.InitialHeight || len(b.record.Members) != 4 {
		return p, m, nil, errors.New("lab genesis membership changed")
	}
	for _, n := range p.Nodes {
		if _, ok := b.members[string(n.ValidatorAddress)]; !ok {
			return p, m, nil, errors.New("lab node is not an original genesis member")
		}
		local, readErr := pqLabRead(filepath.Join(n.Home, "config", "genesis.json"), 64<<20)
		if readErr != nil || !bytes.Equal(local, genesis) {
			return p, m, nil, errors.New("node genesis differs from original common bytes")
		}
	}
	return
}

func pqLabSHA(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }
func pqLabDecode(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("trailing lab JSON")
	}
	canonical, err := json.Marshal(out)
	if err != nil || !bytes.Equal(canonical, raw) {
		return errors.New("noncanonical lab JSON")
	}
	return nil
}
func pqLabRead(path string, limit int64) ([]byte, error) {
	if err := requireInspectionPath(path); err != nil {
		return nil, err
	}
	return readPQOperatorFile(path, limit, true)
}
func pqLabNetworkFreshDirectory(path string) error {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return errors.New("lab output requires a canonical absolute fresh directory")
	}
	parent := filepath.Dir(path)
	if err := requireInspectionPath(parent); err != nil {
		return err
	}
	info, err := os.Lstat(parent)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
		return errors.New("lab output parent must be an existing non-writable-by-others directory")
	}
	return os.Mkdir(path, 0700)
}
func pqLabWriteJSON(path string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return pqLabWrite(path, raw)
}
func pqLabWrite(path string, raw []byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, writeErr := f.Write(raw)
	if writeErr == nil && n != len(raw) {
		writeErr = io.ErrShortWrite
	}
	err = errors.Join(writeErr, f.Sync(), f.Close())
	if err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	return errors.Join(d.Sync(), d.Close())
}
