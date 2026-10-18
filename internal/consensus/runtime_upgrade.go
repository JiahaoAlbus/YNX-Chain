package consensus

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const (
	RuntimeUpgradePlanFormat   = "YNX-ABCI-RUNTIME-UPGRADE/v1"
	MaxRuntimeUpgradePlanBytes = 4096
	// State schema and ABCI application version are separate identities. The
	// only reviewed old profiles are cb20b159 (12/18) and d47b0fb8 (13/19).
	runtimeUpgradeNewAppVersion   = uint64(20)
	runtimeUpgradeNewStateVersion = 18
)

// RuntimeUpgradePlan is operator configuration, never a transaction or restored
// state-file authority. Its independently pinned canonical hash must be the same
// on every node. Numeric heights/application versions use exact decimal strings.
// The Comet genesis SHA hashes its original raw bytes; OriginalGenesisHash is
// the distinct native source identity. Neither replaces the other.
type RuntimeUpgradePlan struct {
	Format                string `json:"format"`
	ChainID               string `json:"chainId"`
	NativeChainID         int64  `json:"nativeChainId,string"`
	CometGenesisSHA256    string `json:"cometGenesisSHA256"`
	OriginalGenesisHash   string `json:"originalGenesisHash"`
	MigrationStateHash    string `json:"migrationStateHash"`
	OldStateVersion       int    `json:"oldStateVersion"`
	OldApplicationVersion uint64 `json:"oldApplicationVersion,string"`
	CheckpointHeight      int64  `json:"checkpointHeight,string"`
	CheckpointAppHash     string `json:"checkpointAppHash"`
	UpgradeHeight         int64  `json:"upgradeHeight,string"`
	NewStateVersion       int    `json:"newStateVersion"`
	NewApplicationVersion uint64 `json:"newApplicationVersion,string"`
}

func (p RuntimeUpgradePlan) Validate() error {
	oldProfile := (p.OldStateVersion == 12 && p.OldApplicationVersion == 18) || (p.OldStateVersion == 13 && p.OldApplicationVersion == 19)
	if p.Format != RuntimeUpgradePlanFormat || p.NativeChainID <= 0 || p.ChainID != fmt.Sprintf("ynx_%d-1", p.NativeChainID) || !oldProfile || p.NewStateVersion != runtimeUpgradeNewStateVersion || p.NewApplicationVersion != runtimeUpgradeNewAppVersion || CommittedStateVersion != runtimeUpgradeNewStateVersion || ValidatorRegistryStateVersion != 19 || PQEngineScheduleStateVersion != 20 || ApplicationVersion != runtimeUpgradeNewAppVersion || p.CheckpointHeight <= 0 || p.CheckpointHeight == math.MaxInt64 || p.UpgradeHeight != p.CheckpointHeight+1 {
		return errors.New("unsupported or inconsistent runtime upgrade profile/height")
	}
	for _, hash := range []string{p.CometGenesisSHA256, p.OriginalGenesisHash, p.MigrationStateHash, p.CheckpointAppHash} {
		if _, err := canonicalBootstrapHash(hash); err != nil {
			return err
		}
	}
	return nil
}

func (p RuntimeUpgradePlan) CanonicalJSON() ([]byte, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	return json.Marshal(p)
}

func (p RuntimeUpgradePlan) Hash() (string, error) {
	wire, err := p.CanonicalJSON()
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(wire) // Format is the complete domain in this JSON.
	return hex.EncodeToString(digest[:]), nil
}

// RuntimeUpgradeAuthorization is immutable and conveys only a runtime-version
// boundary, not validator membership, PQ activation, or permission to sign.
// The constructor is for normal operator factories. No peer or state snapshot
// may supply expectedPlanHash or construct the independently pinned bootstrap.
type RuntimeUpgradeAuthorization struct {
	plan RuntimeUpgradePlan
	hash string
}

func NewRuntimeUpgradeAuthorization(rawCanonicalJSON []byte, expectedPlanHash string, bootstrap *ConsensusBootstrap, migration chain.ConsensusMigrationState) (*RuntimeUpgradeAuthorization, error) {
	if len(rawCanonicalJSON) == 0 || len(rawCanonicalJSON) > MaxRuntimeUpgradePlanBytes {
		return nil, errors.New("runtime upgrade plan exceeds canonical size bound")
	}
	if _, err := canonicalBootstrapHash(expectedPlanHash); err != nil {
		return nil, err
	}
	var p RuntimeUpgradePlan
	decoder := json.NewDecoder(bytes.NewReader(rawCanonicalJSON))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&p); err != nil {
		return nil, err
	}
	canonical, err := p.CanonicalJSON()
	if err != nil || !bytes.Equal(rawCanonicalJSON, canonical) {
		return nil, errors.New("runtime upgrade plan must be exact canonical JSON without unknown/duplicate/trailing fields")
	}
	hash, err := p.Hash()
	if err != nil || hash != expectedPlanHash {
		return nil, errors.New("runtime upgrade plan differs from independent operator pin")
	}
	// Do not turn account-only V1 source data into execution authority. An
	// independently pinned supplemental V2 document still needs a separate
	// dual-anchor restore adapter; replacing the original migration is invalid.
	if err := migration.Validate(); err != nil {
		return nil, err
	}
	if err := validateMigrationExecutionClosure(migration); err != nil {
		return nil, err
	}
	if err := bootstrap.matchesMigration(migration); err != nil {
		return nil, err
	}
	if p.ChainID != bootstrap.record.ChainID || p.NativeChainID != migration.Network.ChainID || p.CometGenesisSHA256 != bootstrap.record.CometGenesisSHA256 || p.OriginalGenesisHash != migration.OriginalGenesisHash || p.MigrationStateHash != migration.StateHash || migration.Height > uint64(p.CheckpointHeight) {
		return nil, errors.New("runtime upgrade differs from original genesis/migration/chain boundary")
	}
	return &RuntimeUpgradeAuthorization{plan: p, hash: hash}, nil
}

// Plan returns a value copy; callers cannot mutate installed authorization.
func (a *RuntimeUpgradeAuthorization) Plan() (RuntimeUpgradePlan, error) {
	if a == nil {
		return RuntimeUpgradePlan{}, errors.New("runtime upgrade authorization is absent")
	}
	hash, err := a.plan.Hash()
	if err != nil || hash != a.hash {
		return RuntimeUpgradePlan{}, errors.New("runtime upgrade authorization is invalid")
	}
	return a.plan, nil
}

// Only the actual engine/normal factory constructs these private checkpoints
// from its original genesis and committed H/AppHash/AppVersion. There is no
// JSON decoder, exported setter, request field, or peer boolean for this view.
type runtimeUpgradeCheckpoint struct {
	chainID, cometGenesisSHA256 string
	height                      int64
	appHash                     string
	appVersion                  uint64
}

type runtimeUpgradeMode struct {
	hashVersion int // old explicit domain, or zero for normal union execution
	appVersion  uint64
}

// runtimeUpgradeCursor is instance-local process coordination, not a second
// persistent history. Application.mu must serialize its use. A pending result
// or UNKNOWN write cannot advance it: confirmCommitted requires the actual
// committed engine checkpoint. Reopening requires another independent trusted
// checkpoint, never the state file's self-reported hash. This cursor does not
// install itself in Application or change ABCI Info/FinalizeBlock responses;
// the normal operator factory/engine consumer must perform that integration.
type runtimeUpgradeCursor struct {
	plan         RuntimeUpgradePlan
	height       int64
	appHash      string
	stateVersion int
}

func newRuntimeUpgradeCursor(a *RuntimeUpgradeAuthorization, migration chain.ConsensusMigrationState, committed CommittedState, trusted runtimeUpgradeCheckpoint) (*runtimeUpgradeCursor, error) {
	p, err := a.Plan()
	if err != nil {
		return nil, err
	}
	if migration.StateHash != p.MigrationStateHash || migration.OriginalGenesisHash != p.OriginalGenesisHash {
		return nil, errors.New("runtime upgrade cursor changed original migration")
	}
	if err := committed.Validate(migration); err != nil {
		return nil, err
	}
	c := &runtimeUpgradeCursor{plan: p}
	if err := c.validateCheckpoint(committed, trusted); err != nil {
		return nil, err
	}
	c.height, c.appHash, c.stateVersion = committed.Height, committed.AppHash, committed.Version
	return c, nil
}

func (c *runtimeUpgradeCursor) validateCheckpoint(s CommittedState, trusted runtimeUpgradeCheckpoint) error {
	if c == nil || c.plan.Validate() != nil || !s.Initialized || s.Height <= 0 || s.ChainID != c.plan.NativeChainID || s.MigrationStateHash != c.plan.MigrationStateHash || trusted.chainID != c.plan.ChainID || trusted.cometGenesisSHA256 != c.plan.CometGenesisSHA256 || trusted.height != s.Height || trusted.appHash != s.AppHash {
		return errors.New("runtime upgrade requires the exact original-chain trusted committed checkpoint")
	}
	if _, err := canonicalBootstrapHash(trusted.appHash); err != nil {
		return err
	}
	if s.Height <= c.plan.CheckpointHeight {
		if s.Version != c.plan.OldStateVersion || trusted.appVersion != c.plan.OldApplicationVersion {
			return errors.New("historical checkpoint does not match pinned old runtime")
		}
		if s.Height == c.plan.CheckpointHeight && s.AppHash != c.plan.CheckpointAppHash {
			return errors.New("runtime upgrade boundary differs from independently pinned checkpoint hash")
		}
	} else if (s.Version != 18 && s.Version != 19 && s.Version != 20) || trusted.appVersion != c.plan.NewApplicationVersion {
		return errors.New("post-upgrade checkpoint must use the authorized runtime and exact supported schema")
	}
	return nil
}

func (c *runtimeUpgradeCursor) modeForNext(committed CommittedState, height int64) (runtimeUpgradeMode, error) {
	if c == nil || c.plan.Validate() != nil || committed.Height != c.height || committed.AppHash != c.appHash || committed.Version != c.stateVersion || committed.ChainID != c.plan.NativeChainID || committed.MigrationStateHash != c.plan.MigrationStateHash || c.height == math.MaxInt64 || height != c.height+1 {
		return runtimeUpgradeMode{}, errors.New("runtime upgrade execution is not the next authenticated committed height")
	}
	if height < c.plan.UpgradeHeight {
		return runtimeUpgradeMode{hashVersion: c.plan.OldStateVersion, appVersion: c.plan.OldApplicationVersion}, nil
	}
	if height == c.plan.UpgradeHeight && (c.height != c.plan.CheckpointHeight || c.appHash != c.plan.CheckpointAppHash || c.stateVersion != c.plan.OldStateVersion) {
		return runtimeUpgradeMode{}, errors.New("runtime upgrade missed its original pinned boundary")
	}
	return runtimeUpgradeMode{appVersion: c.plan.NewApplicationVersion}, nil
}

func (c *runtimeUpgradeCursor) confirmCommitted(migration chain.ConsensusMigrationState, committed CommittedState, trusted runtimeUpgradeCheckpoint) error {
	if err := c.validateCheckpoint(committed, trusted); err != nil {
		return err
	}
	if migration.StateHash != c.plan.MigrationStateHash || migration.OriginalGenesisHash != c.plan.OriginalGenesisHash {
		return errors.New("runtime upgrade confirmation changed original migration")
	}
	// Schema 19/20 still require the original bootstrap and real complete
	// registry/schedule validation. The runtime plan is not PQ authorization.
	// The caller separately enforces PQEngineAuthorization and continuation.
	if err := committed.Validate(migration); err != nil {
		return err
	}
	if committed.Version < c.stateVersion {
		return errors.New("runtime upgrade cannot regress an observed state schema")
	}
	if committed.Height == c.height {
		if committed.AppHash != c.appHash || committed.Version != c.stateVersion {
			return errors.New("runtime upgrade cannot rewrite an observed committed height")
		}
		return nil
	}
	if c.height == math.MaxInt64 || committed.Height != c.height+1 {
		return errors.New("runtime upgrade cannot regress or skip committed checkpoints")
	}
	c.height, c.appHash, c.stateVersion = committed.Height, committed.AppHash, committed.Version
	return nil
}

// RuntimeSourceSupplementPins must come from independent operator evidence.
// These two migration documents remain different, immutable anchors.
type RuntimeSourceSupplementPins struct {
	OriginalMigrationStateHash   string
	SupplementMigrationStateHash string
	OriginalGenesisHash          string
}

// VerifyRuntimeSourceSupplement checks only the claims actually present in the
// two inputs. It grants NO execution/upgrade authority and does not create a
// joined migration. Full-source Validate covers source history/genesis/tip;
// the exact V1 projection also binds account nonces/lots, validator identity,
// resource policy, DEX state and supply to the original account-only anchor.
//
// Still required before a V1 restore can execute: independently authenticated
// original raw Comet genesis whose AppState is that unchanged V1 document;
// authenticated original Comet checkpoints/blocks to the upgrade H; the exact
// source artifact behind the supplemental independent pin; and a dual-anchor
// restore adapter retaining V1 for old AppHashes while carrying that supplemental
// source separately. Existing Bootstrap/Application constructors do not do this.
func VerifyRuntimeSourceSupplement(original, supplement chain.ConsensusMigrationState, pins RuntimeSourceSupplementPins) error {
	for _, hash := range []string{pins.OriginalMigrationStateHash, pins.SupplementMigrationStateHash, pins.OriginalGenesisHash} {
		if _, err := canonicalBootstrapHash(hash); err != nil {
			return err
		}
	}
	if err := original.Validate(); err != nil {
		return err
	}
	if err := supplement.Validate(); err != nil {
		return err
	}
	if original.Version != chain.LegacyConsensusMigrationVersion || original.Runtime != nil || supplement.Version != chain.ConsensusMigrationVersion || supplement.Runtime == nil || original.StateHash != pins.OriginalMigrationStateHash || supplement.StateHash != pins.SupplementMigrationStateHash || supplement.OriginalGenesisHash != pins.OriginalGenesisHash {
		return errors.New("source supplement must retain both exact independently pinned migration anchors")
	}
	projected := supplement
	projected.Version, projected.SourceFormat = chain.LegacyConsensusMigrationVersion, "ynx-devnet-state-v1"
	projected.Runtime, projected.AccountPolicy, projected.ContractMaterials = nil, nil, nil
	projected.OriginalGenesisHash, projected.StateHash = "", ""
	expected := original
	expected.StateHash = ""
	left, err := json.Marshal(expected)
	if err != nil {
		return err
	}
	right, err := json.Marshal(projected)
	if err != nil || !bytes.Equal(left, right) {
		return errors.New("supplement differs from original source projection, accounts/nonces/history tip or validator authority")
	}
	return nil
}
