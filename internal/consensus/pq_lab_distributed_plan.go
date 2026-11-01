//go:build unix

package consensus

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	cmtjson "github.com/cometbft/cometbft/libs/json"
)

const (
	PQLabDistributedRequestVersion   = "YNX-PQ-DISTRIBUTED-LAB-REQUEST/v1"
	PQLabDistributedIdentityVersion  = "YNX-PQ-DISTRIBUTED-LAB-IDENTITY/v1"
	PQLabDistributedPlanVersion      = "YNX-PQ-DISTRIBUTED-LAB-PLAN/v1"
	MaxPQLabDistributedRequestBytes  = 64 << 10
	MaxPQLabDistributedIdentityBytes = 32 << 10
	MaxPQLabDistributedPlanBytes     = 256 << 20
)

// Host labels and paths are independently pinned operation inputs. They are
// not proof of four physical fault domains, resource approval, or SSH routing.
// Each host checks its actual hostname/UID/GID and opens only its own paths.
type PQLabDistributedHost struct {
	Index       int    `json:"index"`
	HostID      string `json:"hostId"`
	Hostname    string `json:"hostname"`
	UID         uint32 `json:"uid"`
	GID         uint32 `json:"gid"`
	RootDir     string `json:"rootDir"`
	CometBinary string `json:"cometBinary"`
	LabBinary   string `json:"labBinary"`
	P2PPort     int    `json:"p2pPort"`
	RPCPort     int    `json:"rpcPort"`
}

type PQLabDistributedRequest struct {
	Version                   string                 `json:"version"`
	OperationID               string                 `json:"operationId"`
	SourceCommit              string                 `json:"sourceCommit"`
	SourceTree                string                 `json:"sourceTree"`
	CometBinarySHA256         string                 `json:"cometBinarySHA256"`
	LabBinarySHA256           string                 `json:"labBinarySHA256"`
	NativeChainID             int64                  `json:"nativeChainId,string"`
	OriginalGenesisHash       string                 `json:"originalGenesisHash"`
	UnboundMigrationStateHash string                 `json:"unboundMigrationStateHash"`
	UnboundMigrationSHA256    string                 `json:"unboundMigrationSHA256"`
	GenesisTime               string                 `json:"genesisTime"`
	Hosts                     []PQLabDistributedHost `json:"hosts"`
}

type PQLabDistributedIdentity struct {
	Version          string               `json:"version"`
	RequestSHA256    string               `json:"requestSHA256"`
	Host             PQLabDistributedHost `json:"host"`
	LegacyPublicKey  []byte               `json:"legacyPublicKey"`
	ValidatorAddress []byte               `json:"validatorAddress"`
	NodePublicKey    []byte               `json:"nodePublicKey"`
	NodeID           string               `json:"nodeId"`
	PublicA          []byte               `json:"publicA"`
	PublicB          []byte               `json:"publicB"`
}

// Coordinator inputs and output are PUBLIC only. Identity hashes are supplied
// independently; the coordinator has no API that opens host custody paths.
type PQLabDistributedPlan struct {
	Version        string                     `json:"version"`
	Request        PQLabDistributedRequest    `json:"request"`
	RequestSHA256  string                     `json:"requestSHA256"`
	Identities     []PQLabDistributedIdentity `json:"identities"`
	IdentitySHA256 []string                   `json:"identitySHA256"`
	MigrationRaw   []byte                     `json:"migrationRaw"`
	GenesisRaw     []byte                     `json:"genesisRaw"`
	Pins           ConsensusBootstrapPins     `json:"pins"`
	ChainID        string                     `json:"chainId"`
	InitialHeight  int64                      `json:"initialHeight,string"`
}

var pqDistributedLabel = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
var pqDistributedGitHash = regexp.MustCompile(`^[0-9a-f]{40}$`)

func (r PQLabDistributedRequest) validate() error {
	if r.Version != PQLabDistributedRequestVersion || r.NativeChainID != PQLabNativeChainID || len(r.Hosts) != 4 || !pqDistributedGitHash.MatchString(r.SourceCommit) || !pqDistributedGitHash.MatchString(r.SourceTree) {
		return errors.New("exact isolated lab request and source pins required")
	}
	for _, pin := range []string{r.OperationID, r.CometBinarySHA256, r.LabBinarySHA256, r.UnboundMigrationStateHash, r.UnboundMigrationSHA256} {
		if _, err := proofHostHash(pin); err != nil {
			return err
		}
	}
	if _, err := proofHostHash(strings.TrimPrefix(r.OriginalGenesisHash, "0x")); err != nil {
		return err
	}
	stamp, err := time.Parse(time.RFC3339, r.GenesisTime)
	if err != nil || stamp.Location() != time.UTC || stamp.Format(time.RFC3339) != r.GenesisTime || stamp.Year() < 2020 {
		return errors.New("exact UTC genesis time required")
	}
	hosts, roots, ports := map[string]bool{}, map[string]bool{}, map[int]bool{}
	for i, h := range r.Hosts {
		if h.Index != i || !pqDistributedLabel.MatchString(h.HostID) || !pqDistributedLabel.MatchString(h.Hostname) || h.UID == 0 || h.GID == 0 || hosts[h.HostID] {
			return errors.New("four fixed non-root host identities required")
		}
		hosts[h.HostID] = true
		for _, path := range []string{h.RootDir, h.CometBinary, h.LabBinary} {
			if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" || len(path) > 4096 {
				return errors.New("canonical host-local paths required")
			}
		}
		rootKey := h.Hostname + "\x00" + h.RootDir
		if roots[rootKey] {
			return errors.New("two identities target the same host-local root")
		}
		roots[rootKey] = true
		for _, port := range []int{h.P2PPort, h.RPCPort} {
			if port < 1024 || port > 65535 || ports[port] {
				return errors.New("eight distinct loopback ports required")
			}
			ports[port] = true
		}
	}
	return nil
}

func pqDistributedMigration(m chain.ConsensusMigrationState, unbound bool) error {
	if err := m.Validate(); err != nil {
		return err
	}
	if m.Network.ChainID != PQLabNativeChainID || m.Network.IsPublicNet || !strings.HasPrefix(m.Network.Slug, "pq-lab-") || len(m.Validators) != 4 || m.Height >= math.MaxInt64-8 {
		return errors.New("fresh non-public four-validator lab migration required")
	}
	for _, v := range m.Validators {
		if !v.Active || v.VotingPower <= 0 || (unbound && (v.ConsensusKeyType != "" || v.ConsensusPubKey != "" || v.ConsensusAddress != "")) {
			return errors.New("invalid original lab validator membership")
		}
	}
	return nil
}

// NewPQLabDistributedRequest binds an already independently generated synthetic
// migration. It neither generates validator keys nor changes any original file.
func NewPQLabDistributedRequest(m chain.ConsensusMigrationState, r PQLabDistributedRequest) (PQLabDistributedRequest, error) {
	if err := pqDistributedMigration(m, true); err != nil {
		return PQLabDistributedRequest{}, err
	}
	raw, err := m.CanonicalJSON()
	if err != nil {
		return PQLabDistributedRequest{}, err
	}
	r.Version, r.NativeChainID = PQLabDistributedRequestVersion, PQLabNativeChainID
	r.OriginalGenesisHash, r.UnboundMigrationStateHash, r.UnboundMigrationSHA256 = m.OriginalGenesisHash, m.StateHash, pqLabSHA(raw)
	if err := r.validate(); err != nil {
		return PQLabDistributedRequest{}, err
	}
	return r, nil
}

func DecodePQLabDistributedRequest(raw []byte, pin string) (PQLabDistributedRequest, error) {
	var r PQLabDistributedRequest
	if len(raw) == 0 || len(raw) > MaxPQLabDistributedRequestBytes || pqLabSHA(raw) != pin {
		return r, errors.New("independently pinned bounded distributed request required")
	}
	if err := pqLabDecode(raw, &r); err != nil {
		return r, err
	}
	return r, r.validate()
}

func pqDistributedIdentity(raw []byte, pin string, r PQLabDistributedRequest, requestPin string, index int) (PQLabDistributedIdentity, error) {
	var id PQLabDistributedIdentity
	if len(raw) == 0 || len(raw) > MaxPQLabDistributedIdentityBytes || pqLabSHA(raw) != pin {
		return id, errors.New("independently pinned bounded host identity required")
	}
	if err := pqLabDecode(raw, &id); err != nil {
		return id, err
	}
	if id.Version != PQLabDistributedIdentityVersion || id.RequestSHA256 != requestPin || index < 0 || index >= 4 || !reflect.DeepEqual(id.Host, r.Hosts[index]) || len(id.LegacyPublicKey) != cmted.PubKeySize || len(id.NodePublicKey) != cmted.PubKeySize || !bytes.Equal(cmted.PubKey(id.LegacyPublicKey).Address(), id.ValidatorAddress) || id.NodeID != strings.ToLower(hex.EncodeToString(cmted.PubKey(id.NodePublicKey).Address())) {
		return id, errors.New("host public identity does not bind original request and keys")
	}
	// This is public shape validation, not possession or registry eligibility.
	// Normal original Ed approval + both fresh PoPs are mandatory at actual H.
	if len(id.PublicA) != ynxconsensusauth.MLDSA87PublicKeySize || len(id.PublicB) != ynxconsensusauth.SLHDSASHA2256fPublicKeySize {
		return id, errors.New("complete fixed-suite public key pair required")
	}
	return id, nil
}

func BuildPQLabDistributedPlan(m chain.ConsensusMigrationState, requestRaw []byte, requestPin string, identities [][]byte, identityPins []string) (PQLabDistributedPlan, error) {
	var p PQLabDistributedPlan
	r, err := DecodePQLabDistributedRequest(requestRaw, requestPin)
	if err != nil {
		return p, err
	}
	if err = pqDistributedMigration(m, true); err != nil {
		return p, err
	}
	raw, err := m.CanonicalJSON()
	if err != nil {
		return p, err
	}
	if r.UnboundMigrationSHA256 != pqLabSHA(raw) || r.UnboundMigrationStateHash != m.StateHash || r.OriginalGenesisHash != m.OriginalGenesisHash || len(identities) != 4 || len(identityPins) != 4 {
		return p, errors.New("public coordinator inputs differ from independently pinned request")
	}
	p.Version, p.Request, p.RequestSHA256 = PQLabDistributedPlanVersion, r, requestPin
	p.IdentitySHA256 = append([]string(nil), identityPins...)
	var bindings []chain.ConsensusValidatorKeyBinding
	seen := map[string]bool{}
	for i, rawID := range identities {
		id, err := pqDistributedIdentity(rawID, identityPins[i], r, requestPin, i)
		if err != nil {
			return p, err
		}
		for _, key := range [][]byte{id.LegacyPublicKey, id.NodePublicKey, id.PublicA, id.PublicB} {
			hash := pqLabSHA(key)
			if seen[hash] {
				return p, errors.New("distributed hosts reused a public key")
			}
			seen[hash] = true
		}
		p.Identities = append(p.Identities, id)
		bindings = append(bindings, chain.ConsensusValidatorKeyBinding{ValidatorAddress: m.Validators[i].Address, KeyType: chain.ConsensusPubKeyTypeEd25519, PublicKey: base64.StdEncoding.EncodeToString(id.LegacyPublicKey), ConsensusAddress: strings.ToUpper(hex.EncodeToString(id.ValidatorAddress))})
	}
	bound, err := m.BindConsensusValidatorKeys(bindings)
	if err != nil {
		return p, err
	}
	p.MigrationRaw, err = bound.CanonicalJSON()
	if err != nil {
		return p, err
	}
	stamp, _ := time.Parse(time.RFC3339, r.GenesisTime)
	doc, err := BuildCometGenesis(bound, stamp)
	if err != nil {
		return p, err
	}
	p.GenesisRaw, err = cmtjson.Marshal(doc)
	if err != nil {
		return p, err
	}
	p.ChainID, p.InitialHeight = doc.ChainID, doc.InitialHeight
	p.Pins = ConsensusBootstrapPins{CometGenesisSHA256: pqLabSHA(p.GenesisRaw), OriginalGenesisHash: bound.OriginalGenesisHash, MigrationStateHash: bound.StateHash}
	_, err = NewConsensusBootstrap(p.GenesisRaw, p.Pins, bound)
	return p, err
}

func DecodePQLabDistributedPlan(raw []byte, pin string) (PQLabDistributedPlan, chain.ConsensusMigrationState, *ConsensusBootstrap, error) {
	var p PQLabDistributedPlan
	var m chain.ConsensusMigrationState
	if len(raw) == 0 || len(raw) > MaxPQLabDistributedPlanBytes || pqLabSHA(raw) != pin {
		return p, m, nil, errors.New("independent exact distributed plan pin required")
	}
	if err := pqLabDecode(raw, &p); err != nil {
		return p, m, nil, err
	}
	requestRaw, err := json.Marshal(p.Request)
	if err != nil || p.Version != PQLabDistributedPlanVersion || len(p.Identities) != 4 || len(p.IdentitySHA256) != 4 || len(p.MigrationRaw) > 64<<20 || len(p.GenesisRaw) > 64<<20 {
		return p, m, nil, errors.New("bounded complete public distributed plan required")
	}
	if _, err := DecodePQLabDistributedRequest(requestRaw, p.RequestSHA256); err != nil {
		return p, m, nil, err
	}
	if err := json.Unmarshal(p.MigrationRaw, &m); err != nil {
		return p, m, nil, err
	}
	canonical, err := m.CanonicalJSON()
	if err != nil || !bytes.Equal(canonical, p.MigrationRaw) {
		return p, m, nil, errors.New("original bound migration must remain canonical")
	}
	if err := pqDistributedMigration(m, false); err != nil {
		return p, m, nil, err
	}
	seen := map[string]bool{}
	for i, id := range p.Identities {
		rawID, _ := json.Marshal(id)
		if _, err := pqDistributedIdentity(rawID, p.IdentitySHA256[i], p.Request, p.RequestSHA256, i); err != nil {
			return p, m, nil, err
		}
		v := m.Validators[i]
		if v.ConsensusKeyType != chain.ConsensusPubKeyTypeEd25519 || v.ConsensusPubKey != base64.StdEncoding.EncodeToString(id.LegacyPublicKey) || v.ConsensusAddress != strings.ToUpper(hex.EncodeToString(id.ValidatorAddress)) {
			return p, m, nil, errors.New("bound migration differs from public host identities")
		}
		for _, key := range [][]byte{id.LegacyPublicKey, id.NodePublicKey, id.PublicA, id.PublicB} {
			hash := pqLabSHA(key)
			if seen[hash] {
				return p, m, nil, errors.New("duplicate host key")
			}
			seen[hash] = true
		}
	}
	// Reconstruct the unbound public source and require its original canonical
	// hash. No record, account, nonce, initial PoP or original history may change.
	unbound := m
	unbound.Validators = append([]chain.ConsensusValidator(nil), m.Validators...)
	for i := range unbound.Validators {
		unbound.Validators[i].ConsensusKeyType = ""
		unbound.Validators[i].ConsensusPubKey = ""
		unbound.Validators[i].ConsensusAddress = ""
	}
	unbound.StateHash = p.Request.UnboundMigrationStateHash
	original, err := unbound.CanonicalJSON()
	if err != nil || pqLabSHA(original) != p.Request.UnboundMigrationSHA256 || m.OriginalGenesisHash != p.Request.OriginalGenesisHash {
		return p, m, nil, errors.New("bound plan changed original migration source")
	}
	stamp, _ := time.Parse(time.RFC3339, p.Request.GenesisTime)
	doc, err := BuildCometGenesis(m, stamp)
	if err != nil {
		return p, m, nil, err
	}
	genesis, err := cmtjson.Marshal(doc)
	if err != nil || !bytes.Equal(genesis, p.GenesisRaw) || p.ChainID != doc.ChainID || p.InitialHeight != doc.InitialHeight {
		return p, m, nil, fmt.Errorf("distributed genesis differs from complete original inputs")
	}
	b, err := NewConsensusBootstrap(p.GenesisRaw, p.Pins, m)
	return p, m, b, err
}
