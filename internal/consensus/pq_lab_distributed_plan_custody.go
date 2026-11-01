//go:build unix

package consensus

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	cmted "github.com/cometbft/cometbft/crypto/ed25519"
	"github.com/cometbft/cometbft/node"
)

type PQLabDistributedActivation struct {
	Version                string                   `json:"version"`
	PlanSHA256             string                   `json:"planSHA256"`
	Schedule               []byte                   `json:"schedule"`
	ScheduleHash           string                   `json:"scheduleHash"`
	Checkpoint             OperatorCheckpointResult `json:"checkpoint"`
	Args                   []string                 `json:"args"`
	RecoveryFD             int                      `json:"recoveryFD"`
	RecoveryCredentialFile string                   `json:"recoveryCredentialFile"`
	NodeStarted            bool                     `json:"nodeStarted"`
	PhysicalHostAgreement  bool                     `json:"physicalHostAgreement"`
}

func pqDistributedActivationArgs(in *PQLabDistributedLocal, pin string) []string {
	n := in.node
	return append(pqDistributedNormalArgs(in.plan, n), "--pq-engine-schedule", filepath.Join(in.root, "activation", "schedule.json"), "--pq-engine-schedule-hash", pin, "--pq-host-key-binding", n.HostBindingFile, "--pq-host-key-vault", n.VaultFile, "--pq-recovery-fd", "3")
}

func loadPQLabDistributedActivation(in *PQLabDistributedLocal) error {
	path := filepath.Join(in.root, "activation", "activation.json")
	_, err := os.Lstat(filepath.Join(in.root, "activation"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	// An existing partial attempt is UNKNOWN, never silently bootstrap-ready.
	raw, err := pqLabRead(path, 128<<10)
	if err != nil {
		return err
	}
	var a PQLabDistributedActivation
	if err = pqLabDecode(raw, &a); err != nil {
		return err
	}
	if a.Version != "YNX-PQ-DISTRIBUTED-LAB-ACTIVATION/v1" || a.PlanSHA256 != in.planSHA || a.RecoveryFD != 3 || a.RecoveryCredentialFile != in.node.RecoveryCredentialFile || a.NodeStarted || a.PhysicalHostAgreement || len(a.Schedule) > 32<<10 {
		return errors.New("invalid original local activation metadata")
	}
	auth, err := NewPQEngineAuthorization(a.Schedule, a.ScheduleHash)
	if err != nil {
		return err
	}
	actual, err := pqLabRead(filepath.Join(in.root, "activation", "schedule.json"), 32<<10)
	if err != nil || !bytes.Equal(actual, a.Schedule) {
		return errors.New("original local schedule changed")
	}
	if !reflect.DeepEqual(a.Args, pqDistributedActivationArgs(in, a.ScheduleHash)) || a.Checkpoint.Height != auth.schedule.RegistryHeight || a.Checkpoint.RegistryRoot != auth.schedule.RegistryRoot || a.Checkpoint.ChainID != in.plan.ChainID || a.Checkpoint.ConsensusGenesisSHA256 != in.plan.Pins.CometGenesisSHA256 || a.Checkpoint.OriginalGenesisHash != in.plan.Pins.OriginalGenesisHash || a.Checkpoint.MigrationStateHash != in.plan.Pins.MigrationStateHash {
		return errors.New("local activation differs from original public bindings")
	}
	raw, err = pqLabRead(in.node.HostBindingFile, 64<<10)
	if err != nil {
		return err
	}
	var binding ynxconsensusauth.HostKeyBinding
	if err = pqLabDecode(raw, &binding); err != nil {
		return err
	}
	expected := ynxconsensusauth.HostKeyBinding{Policy: ynxconsensusauth.Policy{Version: ynxconsensusauth.ConsensusGenesisVersion, GenesisID: bytes.Clone(in.bootstrap.genesisID), ChainID: in.plan.ChainID, ActivationHeight: auth.schedule.ActivationHeight}, ValidatorAddress: bytes.Clone(in.node.ValidatorAddress), Epoch: 1, MLDSA87PublicKey: bytes.Clone(in.node.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(in.node.PublicB), SignerStatePath: in.node.SignerStateFile}
	if !reflect.DeepEqual(binding, expected) {
		return errors.New("host binding changed original local epoch or full pair")
	}
	in.activation = &a
	return nil
}

// Registration signs only the original registry domain, once, using this
// host's old Ed authority and new complete double-PQ possession. The expected
// checkpoint is independently supplied; remote agreement is not inferred here.
func PreparePQLabDistributedRegistration(root, planSHA string, expectedHeight int64, expectedAppHash string) (PQLabValidatorRegistration, error) {
	var result PQLabValidatorRegistration
	in, err := LoadPQLabDistributedLocal(root, planSHA)
	if err != nil {
		return result, err
	}
	if in.activation != nil || expectedHeight <= 0 || expectedHeight > math.MaxInt64-3 {
		return result, errors.New("original bootstrap checkpoint required")
	}
	if _, err = proofHostHash(expectedAppHash); err != nil {
		return result, err
	}
	current := func() error {
		state, e := readPQEngineCommittedState(in.node.StatePath, in.migration, in.bootstrap, nil, nil)
		if e != nil {
			return e
		}
		if !state.Initialized || state.Height != expectedHeight || state.AppHash != expectedAppHash || state.PQEngineSchedule != nil {
			return errors.New("actual local committed checkpoint differs from independent expected checkpoint")
		}
		return nil
	}
	if err = current(); err != nil {
		return result, err
	}
	stage := filepath.Join(root, "registration")
	if err = pqLabNetworkFreshDirectory(stage); err != nil {
		return result, err
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "intent.json"), struct {
		PlanSHA256, AppHash string
		Height              int64
	}{planSHA, expectedAppHash, expectedHeight}); err != nil {
		return result, err
	}
	key, material, err := loadPQLabCandidate(in.node)
	if err != nil {
		return result, err
	}
	defer key.Destroy()
	defer material.Clear()
	pv, err := LoadPQOriginalLegacyValidator(in.node.LegacyKeyFile, in.node.LegacyStateFile, in.plan.ChainID)
	if err != nil {
		return result, err
	}
	secret := pv.Key.PrivKey.(cmted.PrivKey)
	defer clear(secret)
	if !bytes.Equal(pv.Key.Address, in.node.ValidatorAddress) || !bytes.Equal(pv.Key.PubKey.Bytes(), in.plan.Identities[in.node.Index].LegacyPublicKey) {
		return result, errors.New("original local Ed authority changed")
	}
	i := ynxconsensusauth.RegistrationIntent{Kind: ynxconsensusauth.RegisterValidator, GenesisID: bytes.Clone(in.bootstrap.genesisID), ChainID: in.plan.ChainID, ValidatorAddress: bytes.Clone(in.node.ValidatorAddress), Sequence: 1, Epoch: 1, ApprovedAt: expectedHeight + 1, EffectiveAt: expectedHeight + 3, PreviousEventHash: make([]byte, 32), LegacyEd25519PublicKey: bytes.Clone(pv.Key.PubKey.Bytes()), MLDSA87PublicKey: bytes.Clone(in.node.PublicA), SLHDSASHA2256fPublicKey: bytes.Clone(in.node.PublicB)}
	message, err := i.AuthoritySigningBytes()
	if err != nil {
		return result, err
	}
	a, b, err := key.RegistrationPossession(i)
	if err != nil {
		return result, err
	}
	wire, err := (ynxconsensusauth.Registration{Intent: i, LegacyApproval: ed25519.Sign(ed25519.PrivateKey(secret), message), PossessionMLDSA87: a, PossessionSLHDSASHA2256f: b}).MarshalBinary()
	if err != nil {
		return result, err
	}
	tx, err := EncodeValidatorRegistryTransaction(wire)
	if err != nil {
		return result, err
	}
	if err = current(); err != nil {
		return result, errors.Join(errors.New("original checkpoint changed; preserve attempt and never re-sign"), err)
	}
	result = PQLabValidatorRegistration{Version: "YNX-PQ-LAB-REGISTRATION/v1", SyntheticOnly: true, NodeIndex: in.node.Index, ApprovedAt: expectedHeight + 1, Transaction: tx, TransactionHash: pqLabSHA(tx)}
	if err = pqLabWriteJSON(filepath.Join(stage, "registration.json"), result); err != nil {
		return result, err
	}
	return result, nil
}

func PublishPQLabDistributedHeightHalt(root, planSHA string, height int64) (HeightHaltPublicationResult, error) {
	var result HeightHaltPublicationResult
	in, err := LoadPQLabDistributedLocal(root, planSHA)
	if err != nil {
		return result, err
	}
	if in.activation != nil || height < in.plan.InitialHeight || height > math.MaxInt64-4 {
		return result, errors.New("bounded bootstrap halt height required")
	}
	stage := filepath.Join(root, "halt-attempt")
	if err = pqLabNetworkFreshDirectory(stage); err != nil {
		return result, err
	}
	control := node.HeightHaltControl{Path: in.node.HaltControl, ChainID: in.plan.ChainID, GenesisSHA256: in.plan.Pins.CometGenesisSHA256, OperatorPlanSHA256: planSHA, SessionID: in.plan.Request.OperationID}
	raw, err := json.Marshal(node.HeightHaltRequest{Version: "YNX-OPERATOR-HEIGHT-HALT/v1", TargetHeight: strconv.FormatInt(height, 10), ChainID: control.ChainID, GenesisSHA256: control.GenesisSHA256, OperatorPlanSHA256: control.OperatorPlanSHA256, SessionID: control.SessionID})
	if err != nil {
		return result, err
	}
	if err = pqLabWrite(filepath.Join(stage, "intent.json"), raw); err != nil {
		return result, err
	}
	result, err = PublishHeightHaltRequest(raw, pqLabSHA(raw), HeightHaltPublicationOptions{ApplicationStatePath: in.node.StatePath, Control: control})
	if err != nil {
		return result, err
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "result.json"), result); err != nil {
		return result, err
	}
	return result, nil
}

// Activation is host-local only. The normal stopped inspector supplies actual
// DB/App/HRS facts and the normal registry authorizes creation of this one new
// epoch. The independently approved schedule must equal its actual candidate.
// No peer private path is opened and no node/transport is started.
func ActivatePQLabDistributedLocal(root, planSHA string, schedule []byte, scheduleHash string) (PQLabDistributedActivation, error) {
	var out PQLabDistributedActivation
	in, err := LoadPQLabDistributedLocal(root, planSHA)
	if err != nil {
		return out, err
	}
	if in.activation != nil {
		return out, errors.New("original activation exists; reconcile it without reset")
	}
	auth, err := NewPQEngineAuthorization(schedule, scheduleHash)
	if err != nil {
		return out, err
	}
	inspect := func() (OperatorCheckpointResult, error) {
		return InspectOperatorCheckpoint(in.migration, in.genesisRaw, in.plan.Pins, OperatorCheckpointOptions{StatePath: in.node.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(in.node.Home, "data"), SigningStatePath: in.node.LegacyStateFile, ProposePQActivationHeight: auth.schedule.ActivationHeight})
	}
	cp, err := inspect()
	if err != nil {
		return out, err
	}
	if cp.RegistryEventCount != 4 || cp.Height != auth.schedule.RegistryHeight || cp.RegistryRoot != auth.schedule.RegistryRoot || cp.CommittedScheduleHash != nil || cp.ScheduleCandidate == nil {
		return out, errors.New("actual local original four-member registry checkpoint required")
	}
	candidate, err := base64.StdEncoding.DecodeString(cp.ScheduleCandidate.CanonicalScheduleBase64)
	if err != nil || !bytes.Equal(candidate, schedule) {
		return out, errors.New("independent schedule differs from actual local registry candidate")
	}
	stage := filepath.Join(root, "activation")
	if err = pqLabNetworkFreshDirectory(stage); err != nil {
		return out, err
	}
	if err = pqLabWriteJSON(filepath.Join(stage, "intent.json"), struct {
		PlanSHA256, ScheduleHash string
		Checkpoint               OperatorCheckpointResult
	}{planSHA, scheduleHash, cp}); err != nil {
		return out, err
	}
	if err = pqLabWrite(filepath.Join(stage, "schedule.json"), schedule); err != nil {
		return out, err
	}
	if err = preparePQLabCustody(PQLabNetworkPlan{ChainID: in.plan.ChainID}, in.node, in.migration, in.bootstrap, auth, cp); err != nil {
		return out, err
	}
	after, err := inspect()
	if err != nil || !reflect.DeepEqual(after, cp) {
		return out, errors.Join(errors.New("original local checkpoint changed during custody; preserve UNKNOWN attempt"), err)
	}
	out = PQLabDistributedActivation{Version: "YNX-PQ-DISTRIBUTED-LAB-ACTIVATION/v1", PlanSHA256: planSHA, Schedule: bytes.Clone(schedule), ScheduleHash: scheduleHash, Checkpoint: cp, Args: pqDistributedActivationArgs(in, scheduleHash), RecoveryFD: 3, RecoveryCredentialFile: in.node.RecoveryCredentialFile}
	if err = pqLabWriteJSON(filepath.Join(stage, "activation.json"), out); err != nil {
		return out, err
	}
	return out, nil
}
