//go:build unix

package consensus

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	abci "github.com/cometbft/cometbft/abci/types"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/cometbft/cometbft/light"
	cmttypes "github.com/cometbft/cometbft/types"
)

// Actual stopped ledger coordinates are discovered only in this host's original
// BlockStore. The supplied transaction bytes/hash remain a distinct pinned
// operation, and the normal capture verifies BOTH committed headers and results.
func pqDistributedProof(local *PQLabDistributedLocal, auth *PQEngineAuthorization, source *pqLabStoppedSource, state CommittedState, o PQLabDistributedReadbackOptions, now time.Time) ([]byte, []byte, error) {
	if auth == nil || local.activation == nil || o.TrustingPeriod <= 0 || o.MaxClockDrift <= 0 || o.TrustNumerator == 0 || o.TrustDenominator == 0 {
		return nil, nil, errors.New("original PQ activation and explicit light trust parameters required")
	}
	if _, err := proofHostHash(o.TransactionSHA256); err != nil {
		return nil, nil, err
	}
	if _, err := proofHostHash(o.NativeWireHash); err != nil {
		return nil, nil, err
	}
	workloadRel, err := filepath.Rel(filepath.Join(local.root, "workload"), o.TransactionFile)
	workloadAllowed := err == nil && pqLabPublicTransaction.MatchString(filepath.ToSlash(workloadRel))
	publicOriginal := filepath.Join(local.root, "public-transactions", o.TransactionSHA256+".abci")
	if !workloadAllowed && o.TransactionFile != publicOriginal {
		return nil, nil, errors.New("explicit host-local public original namespace required")
	}
	original, err := readProofHostOriginal(o.TransactionFile, o.TransactionSHA256, MaxPQContractTransactionBytes)
	if err != nil {
		return nil, nil, err
	}
	defer original.file.Close()
	envelope := original.raw
	kind, wire, err := pqTransactionWire(envelope)
	if err != nil {
		return nil, nil, err
	}
	if pqLabSHA(wire) != o.NativeWireHash {
		return nil, nil, errors.New("original native wire hash mismatch")
	}
	owner, err := pqLabExportOwner(kind, wire)
	if err != nil {
		return nil, nil, err
	}
	base, end := source.blocks.Base(), source.blocks.Height()
	if base <= 0 || end != state.Height || end-base >= 4096 {
		return nil, nil, errors.New("bounded complete retained lab history required")
	}
	height, index := int64(0), int64(-1)
	for h := base; h <= end; h++ {
		block := source.blocks.LoadBlock(h)
		if block == nil {
			return nil, nil, errors.New("original transaction history pruned")
		}
		for i, tx := range block.Txs {
			if bytes.Equal(tx, envelope) {
				if index >= 0 {
					return nil, nil, errors.New("ambiguous original transaction")
				}
				height, index = h, int64(i)
			}
		}
	}
	if index < 0 || height <= auth.schedule.ActivationHeight || height >= end {
		return nil, nil, errors.New("PQ predecessor and committed transaction successor required")
	}
	trusted, err := source.ledger.lightBlock(height - 1)
	if err != nil {
		return nil, nil, err
	}
	block, err := source.ledger.lightBlock(height)
	if err != nil {
		return nil, nil, err
	}
	next, err := source.ledger.lightBlock(height + 1)
	if err != nil {
		return nil, nil, err
	}
	expected := ProofHostExpectedTransaction{Block: pqLabExportHeader(block), Successor: pqLabExportHeader(next), TransactionType: kind, Envelope: base64.StdEncoding.EncodeToString(envelope), NativeWire: base64.StdEncoding.EncodeToString(wire), TransactionHash: o.TransactionSHA256, NativeWireHash: o.NativeWireHash, Index: strconv.FormatInt(index, 10)}
	plan := ProofHostSourcePlan{
		Version: ProofHostSourcePlanVersion, SourceID: "pq-distributed-" + o.PlanSHA256, Epoch: "1", OperationID: o.TransactionSHA256, Account: owner, NetworkID: local.plan.Pins.OriginalGenesisHash, OriginalHash: "0x" + o.NativeWireHash,
		MigrationFile: filepath.Join(local.root, "bound-migration.json"), MigrationSHA256: pqLabSHA(local.migrationRaw), GenesisFile: filepath.Join(local.root, "genesis.json"), ConsensusGenesisSHA256: local.plan.Pins.CometGenesisSHA256, OriginalGenesisHash: local.plan.Pins.OriginalGenesisHash, MigrationStateHash: local.plan.Pins.MigrationStateHash,
		StateFile: local.node.StatePath, StateLayout: "atomic-json", CometDataDirectory: filepath.Join(local.node.Home, "data"), SigningStatePath: local.node.SignerStateFile, SigningLockKind: "pq-signer", ScheduleFile: filepath.Join(local.root, "activation", "schedule.json"), ScheduleHash: local.activation.ScheduleHash, ScheduleSHA256: pqLabSHA(local.activation.Schedule),
		EngineHeight: strconv.FormatInt(state.Height, 10), EngineAppHash: state.AppHash, TrustedHeight: strconv.FormatInt(height-1, 10), TrustedBlockHash: hex.EncodeToString(trusted.Hash()), TrustingPeriodNanoseconds: strconv.FormatInt(int64(o.TrustingPeriod), 10), MaxClockDriftNanoseconds: strconv.FormatInt(int64(o.MaxClockDrift), 10), TrustLevelNumerator: strconv.FormatUint(o.TrustNumerator, 10), TrustLevelDenominator: strconv.FormatUint(o.TrustDenominator, 10), ExpectedTransaction: expected,
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return nil, nil, err
	}
	in, err := loadProofHostInputs(raw, pqLabSHA(raw))
	if err != nil {
		return nil, nil, err
	}
	capture, err := in.capture(source.ledger, filepath.Join(o.OutputDir, "captured-context"), now)
	err = errors.Join(err, in.close(), original.unchanged())
	if err != nil {
		return nil, nil, err
	}
	files := map[string][]byte{}
	for _, f := range capture.Files {
		files[f.Role] = f.Bytes
	}
	expectation, err := expected.expectation()
	if err != nil {
		return nil, nil, err
	}
	appHash, err := hex.DecodeString(state.AppHash)
	if err != nil {
		return nil, nil, err
	}
	materials := PQLabProofMaterials{Version: PQLabProofMaterialsVersion, Migration: files["migration"], Genesis: files["genesis"], CommittedState: files["state"], Schedule: files["schedule"], TrustedLightBlock: files["trustedLightBlock"], Pins: local.plan.Pins, ScheduleHash: local.activation.ScheduleHash, EngineHeight: state.Height, EngineAppHash: appHash, TrustingPeriod: o.TrustingPeriod, MaxClockDrift: o.MaxClockDrift, TrustNumerator: o.TrustNumerator, TrustDenominator: o.TrustDenominator, Expected: expectation}
	materialRaw, err := json.Marshal(materials)
	if err != nil {
		return nil, nil, err
	}
	if len(materialRaw) > MaxPQLabProofMaterialsBytes {
		return nil, nil, errors.New("complete original material exceeds unchanged lab transport limit")
	}
	return materialRaw, capture.Proof, nil
}

type PQLabDistributedPublicInput struct {
	Directory     string `json:"directory"`
	ReceiptSHA256 string `json:"receiptSHA256"`
}

type PQLabDistributedComparison struct {
	Version           string   `json:"version"`
	PlanSHA256        string   `json:"planSHA256"`
	Height            int64    `json:"height,string"`
	AppHash           string   `json:"appHash"`
	StateSHA256       string   `json:"stateSHA256"`
	FullHeightSHA256  string   `json:"fullHeightSHA256"`
	ReceiptSHA256     []string `json:"receiptSHA256"`
	FullStateEqual    bool     `json:"fullStateEqual"`
	FullHeightEqual   bool     `json:"fullHeightEqual"`
	AllStoppedAndCold bool     `json:"allStoppedAndCold"`
	SyntheticOnly     bool     `json:"syntheticOnly"`
	AuthorityGranted  bool     `json:"authorityGranted"`
	PublicNetwork     bool     `json:"publicNetwork"`
}

// ComparePQLabDistributedReadbacks accepts only four independently pinned PUBLIC
// directories. It never interprets a coordinator path as a node home/custody.
// Equality is exact complete-state/effect equality, not trust or activation.
func ComparePQLabDistributedReadbacks(planRaw []byte, planPin string, inputs []PQLabDistributedPublicInput, now time.Time) (out PQLabDistributedComparison, err error) {
	plan, migration, bootstrap, err := DecodePQLabDistributedPlan(planRaw, planPin)
	if err != nil {
		return out, err
	}
	if len(inputs) != 4 || now.IsZero() {
		return out, errors.New("four exact independently pinned public readbacks and local clock required")
	}
	seen := map[int]bool{}
	var referenceState, referenceHeights []byte
	var referenceExpected []byte
	var mode string
	out = PQLabDistributedComparison{Version: "YNX-PQ-LAB-DISTRIBUTED-COMPARISON/v1", PlanSHA256: planPin, SyntheticOnly: true, AllStoppedAndCold: true}
	for _, input := range inputs {
		if err = proofHostLivePrivateDirectory(input.Directory); err != nil {
			return PQLabDistributedComparison{}, err
		}
		if err = rejectInspectionUnknown(input.Directory); err != nil {
			return PQLabDistributedComparison{}, err
		}
		original, e := readProofHostOriginal(filepath.Join(input.Directory, "result.json"), input.ReceiptSHA256, 16<<20)
		if e != nil {
			return PQLabDistributedComparison{}, e
		}
		raw := original.raw
		var r PQLabDistributedReadback
		e = pqLabDecode(raw, &r)
		e = errors.Join(e, original.unchanged(), original.file.Close())
		if e != nil {
			return PQLabDistributedComparison{}, e
		}
		if r.Version != PQLabDistributedReadbackVersion || r.PlanSHA256 != planPin || r.ChainID != plan.ChainID || !r.SyntheticOnly || !r.SourceReadOnly || r.PublicNetwork || r.AuthorityGranted || r.NodeStarted || r.NodeIndex < 0 || r.NodeIndex >= 4 || seen[r.NodeIndex] {
			return PQLabDistributedComparison{}, errors.New("invalid or duplicated original public receipt identity")
		}
		seen[r.NodeIndex] = true
		if r.NodeID != plan.Identities[r.NodeIndex].NodeID {
			return PQLabDistributedComparison{}, errors.New("original node identity differs from pinned plan")
		}
		if r.Mode != "snapshot" && r.Mode != "quiet" && r.Mode != "stopped" && r.Mode != "proof" {
			return PQLabDistributedComparison{}, errors.New("unknown public readback mode")
		}
		stopped := r.Mode == "stopped" || r.Mode == "proof"
		if r.WriterExcluded != stopped || r.SigningWriterExcluded != stopped || r.ColdReopened != stopped || (r.Heights != nil) != stopped || (r.Materials != nil) != (r.Mode == "proof") || (r.Proof != nil) != (r.Mode == "proof") || r.Mode == "quiet" && len(r.QuietObservations) != 3 || r.Mode != "quiet" && len(r.QuietObservations) != 0 {
			return PQLabDistributedComparison{}, errors.New("public receipt evidence layer differs")
		}
		if mode == "" {
			mode = r.Mode
			out.Height = r.Height
			out.AppHash = r.AppHash
		} else if mode != r.Mode || out.Height != r.Height || out.AppHash != r.AppHash {
			return PQLabDistributedComparison{}, errors.New("four original checkpoints/modes differ")
		}
		read := func(file PQLabWorkloadFile, name string, limit int64) ([]byte, error) {
			if file.Path != name || strings.ContainsAny(file.Path, "/\\") {
				return nil, errors.New("public file is not a closed relative name")
			}
			x, e := readProofHostOriginal(filepath.Join(input.Directory, name), file.SHA256, limit)
			if e != nil {
				return nil, e
			}
			data := bytes.Clone(x.raw)
			e = errors.Join(x.unchanged(), x.file.Close())
			if file != pqLabFile(name, data) {
				e = errors.Join(e, errors.New("public complete file length differs"))
			}
			return data, e
		}
		stateRaw, e := read(r.State, "committed-state.json", 128<<20)
		if e != nil {
			return PQLabDistributedComparison{}, e
		}
		var state CommittedState
		if e = decodeStrictJSON(stateRaw, &state); e != nil {
			return PQLabDistributedComparison{}, e
		}
		state.bootstrap = bootstrap
		if e = state.Validate(migration); e != nil {
			return PQLabDistributedComparison{}, e
		}
		if !state.Initialized || state.Height != r.Height || state.AppHash != r.AppHash {
			return PQLabDistributedComparison{}, errors.New("full public state differs from receipt")
		}
		for _, observation := range r.QuietObservations {
			expected, e := pqDistributedQuietBytes(observation.Status, observation.ABCIInfo, r.ChainID, r.NodeID, state)
			if e != nil || !reflect.DeepEqual(expected, observation) {
				return PQLabDistributedComparison{}, errors.New("public quiet observation does not bind the complete state")
			}
		}
		if referenceState == nil {
			referenceState = stateRaw
			out.StateSHA256 = r.State.SHA256
		} else if !bytes.Equal(referenceState, stateRaw) {
			return PQLabDistributedComparison{}, errors.New("complete public state differs: no projection or truncation permitted")
		}
		if stopped {
			heights, e := read(*r.Heights, "heights.json", MaxPQLabProofMaterialsBytes)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			// Header/result equivalence excludes no business/error fields. A
			// different legitimate commit signer subset is not ledger divergence;
			// normalize ONLY separately verified commit bytes below.
			normalized, e := pqDistributedComparableHeights(heights, bootstrap, state, migration)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			if referenceHeights == nil {
				referenceHeights = normalized
				out.FullHeightSHA256 = pqLabSHA(normalized)
			} else if !bytes.Equal(referenceHeights, normalized) {
				return PQLabDistributedComparison{}, errors.New("full original per-height block/results differ")
			}
		} else {
			out.AllStoppedAndCold = false
		}
		if r.Mode == "proof" {
			materials, e := read(*r.Materials, "materials.json", MaxPQLabProofMaterialsBytes)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			proof, e := read(*r.Proof, "proof.json", MaxPQTransactionProofRequestBytes)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			m, e := DecodePQLabProofMaterials(materials, r.Materials.SHA256)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			p, e := DecodePQTransactionProofRequest(proof)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			if !bytes.Equal(m.Migration, plan.MigrationRaw) || !bytes.Equal(m.Genesis, plan.GenesisRaw) || !bytes.Equal(m.CommittedState, stateRaw) || m.EngineHeight != state.Height || hex.EncodeToString(m.EngineAppHash) != state.AppHash || m.Pins != plan.Pins {
				return PQLabDistributedComparison{}, errors.New("proof material differs from complete original checkpoint")
			}
			a, e := NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			if e = a.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); e != nil {
				return PQLabDistributedComparison{}, e
			}
			snapshot, e := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			trusted, e := DecodePQTrustedLightBlock(m.TrustedLightBlock)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			trust := PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: m.TrustingPeriod, MaxClockDrift: m.MaxClockDrift, TrustLevel: cmtmath.Fraction{Numerator: m.TrustNumerator, Denominator: m.TrustDenominator}, Now: now}
			if _, e = VerifyPQTransactionProof(trust, m.Expected, p); e != nil {
				return PQLabDistributedComparison{}, e
			}
			expected, e := json.Marshal(m.Expected)
			if e != nil {
				return PQLabDistributedComparison{}, e
			}
			if referenceExpected == nil {
				referenceExpected = expected
			} else if !bytes.Equal(referenceExpected, expected) {
				return PQLabDistributedComparison{}, errors.New("four public proofs target different original transactions")
			}
		}
		// A complete result file can survive a failed file/directory fsync.
		// Preserve and reject the producer's UNKNOWN/partial outcome even when
		// the separately pinned result bytes still decode and verify correctly.
		if err = rejectInspectionUnknown(input.Directory); err != nil {
			return PQLabDistributedComparison{}, err
		}
		out.ReceiptSHA256 = append(out.ReceiptSHA256, input.ReceiptSHA256)
	}
	out.FullStateEqual = true
	out.FullHeightEqual = referenceHeights != nil
	return out, nil
}

// Independent >2/3 tip commits may contain distinct valid signer subsets.
// Preserve those originals in heights.json, verify every present signature,
// and compare the complete original block and ABCI response bytes plus the
// full validator set. Only the separately verified commit is not an equality
// requirement; no account, transaction, error, history or execution field is
// projected away.
func pqDistributedComparableHeights(raw []byte, bootstrap *ConsensusBootstrap, state CommittedState, migration chain.ConsensusMigrationState) ([]byte, error) {
	var rows []PQLabDistributedHeight
	if len(raw) == 0 || len(raw) > MaxPQLabProofMaterialsBytes || pqLabDecode(raw, &rows) != nil || len(rows) == 0 || len(rows) > 4096 {
		return nil, errors.New("invalid complete public height sequence")
	}
	snapshot, err := newPQEngineSnapshot(bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	if err != nil {
		return nil, err
	}
	type comparable struct {
		Height                                                int64
		Block, ValidatorSet, FinalizeResponse, CommittedState []byte
		ExecutionSuccessorBound                               bool
	}
	result := make([]comparable, 0, len(rows))
	var previous *cmttypes.Block
	var previousValidators *cmttypes.ValidatorSet
	var priorResult *abci.ResponseFinalizeBlock
	for i, row := range rows {
		if row.Height <= 0 || row.Height > state.Height || i > 0 && row.Height != rows[i-1].Height+1 || row.ExecutionSuccessorBound != (i < len(rows)-1) {
			return nil, errors.New("public height sequence incomplete")
		}
		var block cmttypes.Block
		var lb cmttypes.LightBlock
		var response abci.ResponseFinalizeBlock
		if err = cmtjson.Unmarshal(row.Block, &block); err != nil {
			return nil, err
		}
		// Comet's original protobuf-to-Block loader creates nonnil zero-length
		// arrays; its JSON decoder collapses those arrays to nil. Restore only
		// these typed empty collections before the exact field comparison. This
		// does not normalize unknown fields, missing fields or arbitrary nulls.
		var arrays struct {
			Data struct {
				Txs json.RawMessage `json:"txs"`
			} `json:"data"`
			Evidence struct {
				Evidence json.RawMessage `json:"evidence"`
			} `json:"evidence"`
			LastCommit struct {
				Signatures json.RawMessage `json:"signatures"`
			} `json:"last_commit"`
		}
		if err = json.Unmarshal(row.Block, &arrays); err != nil {
			return nil, err
		}
		if bytes.Equal(arrays.Data.Txs, []byte("[]")) && len(block.Txs) == 0 {
			block.Txs = make(cmttypes.Txs, 0)
		}
		if bytes.Equal(arrays.Evidence.Evidence, []byte("[]")) && len(block.Evidence.Evidence) == 0 {
			block.Evidence.Evidence = make(cmttypes.EvidenceList, 0)
		}
		if bytes.Equal(arrays.LastCommit.Signatures, []byte("[]")) && block.LastCommit != nil && len(block.LastCommit.Signatures) == 0 {
			block.LastCommit.Signatures = make([]cmttypes.CommitSig, 0)
		}
		if err = cmtjson.Unmarshal(row.LightBlock, &lb); err != nil {
			return nil, err
		}
		canonicalLight, e := cmtjson.Marshal(&lb)
		if e != nil || !bytes.Equal(canonicalLight, row.LightBlock) {
			return nil, errors.New("noncanonical public original light block")
		}
		if err = response.Unmarshal(row.FinalizeResponse); err != nil {
			return nil, err
		}
		if err = block.ValidateBasic(); err != nil {
			return nil, err
		}
		if block.Height != row.Height || block.ChainID != bootstrap.record.ChainID || lb.Header == nil || lb.Height != row.Height || !bytes.Equal(block.Hash(), lb.Hash()) || len(response.TxResults) != len(block.Txs) {
			return nil, errors.New("public block/commit/result identities differ")
		}
		bound, e := light.BindLightBlock(snapshot, &lb)
		if e != nil {
			return nil, e
		}
		params, e := snapshot.ParamsAt(row.Height)
		if e != nil {
			return nil, e
		}
		if block.Version.App != params.Version.App || !bytes.Equal(block.ConsensusHash, params.Hash()) {
			return nil, errors.New("public block authority parameters differ")
		}
		if e = bound.ValidatorSet.VerifyCommit(block.ChainID, bound.Commit.BlockID, block.Height, bound.Commit); e != nil {
			return nil, e
		}
		if previous != nil {
			parts, e := previous.MakePartSet(cmttypes.BlockPartSizeBytes)
			if e != nil {
				return nil, e
			}
			id := cmttypes.BlockID{Hash: previous.Hash(), PartSetHeader: parts.Header()}
			if !block.LastBlockID.Equals(id) || !bytes.Equal(previous.NextValidatorsHash, block.ValidatorsHash) || !bytes.Equal(block.LastResultsHash, cmttypes.NewResults(priorResult.TxResults).Hash()) || !bytes.Equal(block.AppHash, priorResult.AppHash) {
				return nil, errors.New("public original block/result successor link differs")
			}
			if e = previousValidators.VerifyCommit(block.ChainID, id, row.Height-1, block.LastCommit); e != nil {
				return nil, e
			}
		}
		if i == len(rows)-1 && (row.Height != state.Height || hex.EncodeToString(response.AppHash) != state.AppHash) {
			return nil, errors.New("public height sequence does not terminate at full checkpoint")
		}
		canonicalBlock, e := cmtjson.Marshal(&block)
		if e != nil || !bytes.Equal(canonicalBlock, row.Block) {
			return nil, errors.New("noncanonical public original block")
		}
		canonicalResponse, e := response.Marshal()
		if e != nil || !bytes.Equal(canonicalResponse, row.FinalizeResponse) {
			return nil, errors.New("noncanonical complete original execution response")
		}
		var historical CommittedState
		if e = decodeStrictJSON(row.CommittedState, &historical); e != nil {
			return nil, e
		}
		historical.bootstrap = bootstrap
		if e = historical.Validate(migration); e != nil {
			return nil, e
		}
		if !historical.Initialized || historical.Height != row.Height || historical.AppHash != hex.EncodeToString(response.AppHash) {
			return nil, errors.New("complete per-height state differs from execution commitment")
		}
		canonicalState, e := encodeCommittedStateJSON(historical)
		if e != nil || !bytes.Equal(canonicalState, row.CommittedState) {
			return nil, errors.New("noncanonical complete historical state")
		}
		validators, e := cmtjson.Marshal(bound.ValidatorSet)
		if e != nil {
			return nil, e
		}
		result = append(result, comparable{Height: row.Height, Block: row.Block, ValidatorSet: validators, FinalizeResponse: row.FinalizeResponse, CommittedState: row.CommittedState, ExecutionSuccessorBound: row.ExecutionSuccessorBound})
		previous = &block
		previousValidators = bound.ValidatorSet
		priorResult = &response
	}
	return json.Marshal(result)
}
