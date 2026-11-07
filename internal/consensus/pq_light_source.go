//go:build unix

package consensus

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"time"

	dbm "github.com/cometbft/cometbft-db"
	cmtjson "github.com/cometbft/cometbft/libs/json"
	"github.com/cometbft/cometbft/light"
	sm "github.com/cometbft/cometbft/state"
	blockstore "github.com/cometbft/cometbft/store"
	"github.com/syndtr/goleveldb/leveldb/opt"
	"golang.org/x/sys/unix"
)

const PQLightSourcePlanVersion = "YNX-PQ-LIGHT-SOURCE-PLAN/v1"
const MaxPQLightSourcePlanBytes = 32 << 10

// This independent operator plan selects an existing committed header, not a
// transaction. Trust/engine hashes are required external pins, never RPC data.
// The target hash is derived from its stored, AND-verified complete header.
// Header H authenticates state H-1; both must be post-activation.
type PQLightSourcePlan struct {
	Version                   string `json:"version"`
	ChainID                   string `json:"chainId"`
	HeaderHeight              string `json:"headerHeight"`
	MigrationFile             string `json:"migrationFile"`
	MigrationSHA256           string `json:"migrationSHA256"`
	GenesisFile               string `json:"genesisFile"`
	ConsensusGenesisSHA256    string `json:"consensusGenesisSHA256"`
	OriginalGenesisHash       string `json:"originalGenesisHash"`
	MigrationStateHash        string `json:"migrationStateHash"`
	StateFile                 string `json:"stateFile"`
	StateLayout               string `json:"stateLayout"`
	CometDataDirectory        string `json:"cometDataDirectory"`
	SigningStatePath          string `json:"signingStatePath"`
	SigningLockKind           string `json:"signingLockKind"`
	ScheduleFile              string `json:"scheduleFile"`
	ScheduleHash              string `json:"scheduleHash"`
	ScheduleSHA256            string `json:"scheduleSHA256"`
	RuntimePlanFile           string `json:"runtimePlanFile"`
	RuntimePlanHash           string `json:"runtimePlanHash"`
	RuntimePlanSHA256         string `json:"runtimePlanSHA256"`
	EngineHeight              string `json:"engineHeight"`
	EngineAppHash             string `json:"engineAppHash"`
	TrustedHeight             string `json:"trustedHeight"`
	TrustedBlockHash          string `json:"trustedBlockHash"`
	TrustingPeriodNanoseconds string `json:"trustingPeriodNanoseconds"`
	MaxClockDriftNanoseconds  string `json:"maxClockDriftNanoseconds"`
	TrustLevelNumerator       string `json:"trustLevelNumerator"`
	TrustLevelDenominator     string `json:"trustLevelDenominator"`
}

func (p PQLightSourcePlan) originalInputs() ProofHostSourcePlan {
	return ProofHostSourcePlan{
		MigrationFile:             p.MigrationFile,
		MigrationSHA256:           p.MigrationSHA256,
		GenesisFile:               p.GenesisFile,
		ConsensusGenesisSHA256:    p.ConsensusGenesisSHA256,
		OriginalGenesisHash:       p.OriginalGenesisHash,
		MigrationStateHash:        p.MigrationStateHash,
		StateFile:                 p.StateFile,
		StateLayout:               p.StateLayout,
		CometDataDirectory:        p.CometDataDirectory,
		SigningStatePath:          p.SigningStatePath,
		SigningLockKind:           p.SigningLockKind,
		ScheduleFile:              p.ScheduleFile,
		ScheduleHash:              p.ScheduleHash,
		ScheduleSHA256:            p.ScheduleSHA256,
		RuntimePlanFile:           p.RuntimePlanFile,
		RuntimePlanHash:           p.RuntimePlanHash,
		RuntimePlanSHA256:         p.RuntimePlanSHA256,
		EngineHeight:              p.EngineHeight,
		EngineAppHash:             p.EngineAppHash,
		TrustedHeight:             p.TrustedHeight,
		TrustedBlockHash:          p.TrustedBlockHash,
		TrustingPeriodNanoseconds: p.TrustingPeriodNanoseconds,
		MaxClockDriftNanoseconds:  p.MaxClockDriftNanoseconds,
		TrustLevelNumerator:       p.TrustLevelNumerator,
		TrustLevelDenominator:     p.TrustLevelDenominator,
	}
}

func DecodePQLightSourcePlan(raw []byte, pin string) (PQLightSourcePlan, error) {
	var p PQLightSourcePlan
	if _, err := proofHostHash(pin); err != nil {
		return p, err
	}
	if len(raw) == 0 || len(raw) > MaxPQLightSourcePlanBytes || proofHostSHA(raw) != pin || pqLightUniqueJSON(raw) != nil || json.Unmarshal(raw, &p) != nil {
		return p, errors.New("invalid independently pinned light source plan")
	}
	canonical, err := json.Marshal(p)
	if err != nil || !pqLightJSONEquivalent(raw, canonical) {
		return p, errors.New("exact complete light source plan fields required")
	}
	if p.Version != PQLightSourcePlanVersion || p.ChainID == "" || len(p.ChainID) > 50 {
		return p, errors.New("invalid light source identity")
	}
	for _, v := range []string{p.MigrationSHA256, p.ConsensusGenesisSHA256, p.OriginalGenesisHash, p.MigrationStateHash, p.ScheduleHash, p.ScheduleSHA256, p.EngineAppHash, p.TrustedBlockHash} {
		if _, err = proofHostHash(v); err != nil {
			return p, err
		}
	}
	height, err := proofHostUint(p.HeaderHeight, math.MaxInt64-2, false)
	if err != nil {
		return p, err
	}
	engine, err := proofHostUint(p.EngineHeight, math.MaxInt64-2, false)
	if err != nil {
		return p, err
	}
	trusted, err := proofHostUint(p.TrustedHeight, math.MaxInt64-2, false)
	if err != nil {
		return p, err
	}
	if trusted >= height || height > engine {
		return p, errors.New("earlier independent trust anchor and committed target required")
	}
	if _, err = proofHostUint(p.TrustingPeriodNanoseconds, math.MaxInt64, false); err != nil {
		return p, err
	}
	if _, err = proofHostUint(p.MaxClockDriftNanoseconds, math.MaxInt64, true); err != nil {
		return p, err
	}
	for _, v := range []string{p.TrustLevelNumerator, p.TrustLevelDenominator} {
		if _, err = proofHostUint(v, math.MaxInt64, false); err != nil {
			return p, err
		}
	}
	in := proofHostInputs{plan: p.originalInputs()}
	if _, err = pqLightTrustLevel(in.trust(nil).TrustLevel, 1); err != nil {
		return p, err
	}
	if p.StateLayout != "atomic-json" && p.StateLayout != "snapshot-journal" && p.StateLayout != "block-journal" {
		return p, errors.New("explicit original state layout required")
	}
	if p.SigningLockKind != "pq-signer" {
		return p, errors.New("original PQ signing lock identity required")
	}
	for _, v := range []string{p.MigrationFile, p.GenesisFile, p.StateFile, p.CometDataDirectory, p.SigningStatePath, p.ScheduleFile} {
		if !filepath.IsAbs(v) || filepath.Clean(v) != v {
			return p, errors.New("canonical absolute original source path required")
		}
	}
	if p.RuntimePlanFile != "" || p.RuntimePlanHash != "" || p.RuntimePlanSHA256 != "" {
		if !filepath.IsAbs(p.RuntimePlanFile) || filepath.Clean(p.RuntimePlanFile) != p.RuntimePlanFile {
			return p, errors.New("complete independent runtime plan required")
		}
		for _, v := range []string{p.RuntimePlanHash, p.RuntimePlanSHA256} {
			if _, err = proofHostHash(v); err != nil {
				return p, err
			}
		}
	}
	return p, nil
}

type pqLightSourceBundle struct {
	files  []ProofHostSourceFile
	result PQLightProofResult
}

type PQLightSourceReceipt struct {
	Version              string             `json:"version"`
	PlanSHA256           string             `json:"planSHA256"`
	ManifestPath         string             `json:"manifestPath"`
	ManifestSHA256       string             `json:"manifestSHA256"`
	ContextPath          string             `json:"contextPath"`
	ContextSHA256        string             `json:"contextSHA256"`
	RequestPath          string             `json:"requestPath"`
	RequestSHA256        string             `json:"requestSHA256"`
	EngineHeight         string             `json:"engineHeight"`
	EngineAppHash        string             `json:"engineAppHash"`
	Verification         PQLightProofResult `json:"verification"`
	PublicDataOnly       bool               `json:"publicDataOnly"`
	SourceReadOnly       bool               `json:"sourceReadOnly"`
	NativeRootAuthorized bool               `json:"nativeRootAuthorized"`
	DeploymentVerified   bool               `json:"deploymentVerified"`
}

// ExportStoppedPQLightSource holds the original application/PQ-signer leases and
// existing readonly Comet stores. No secret body, RPC, signer or Node is opened.
// It releases and checks ALL inputs before exclusively publishing public bytes.
// Any partial delivery is retained for reconciliation; never replace/replay it.
func ExportStoppedPQLightSource(rawPlan []byte, pin, output string, now time.Time) (PQLightSourceReceipt, error) {
	var empty PQLightSourceReceipt
	p, err := DecodePQLightSourcePlan(rawPlan, pin)
	if err != nil {
		return empty, err
	}
	if now.IsZero() {
		return empty, errors.New("local verification clock required")
	}
	if err = proofHostDirectory(output); err != nil {
		return empty, err
	}
	captured, err := captureStoppedPQLightSource(p, now)
	if err != nil {
		return empty, err
	}
	return writePQLightSource(output, p, pin, captured)
}
func captureStoppedPQLightSource(plan PQLightSourcePlan, now time.Time) (out pqLightSourceBundle, err error) {
	in, err := loadProofHostOriginalInputs(plan.originalInputs(), plan.ChainID)
	if err != nil {
		return out, err
	}
	p := in.plan
	defer func() {
		err = errors.Join(err, in.unchanged(), in.close())
		if err != nil {
			out = pqLightSourceBundle{}
		}
	}()
	for _, path := range []string{p.StateFile, p.SigningStatePath, p.CometDataDirectory} {
		if err = requireInspectionPath(path); err != nil {
			return out, err
		}
	}
	signInfo, err := os.Lstat(p.SigningStatePath)
	if err != nil || !signInfo.Mode().IsRegular() || signInfo.Mode().Perm() != 0600 || signInfo.Size() == 0 {
		return out, errors.New("existing original private PQ HRS identity required; body is not read")
	}
	appInfo, err := os.Lstat(p.StateFile)
	if err != nil || os.SameFile(appInfo, signInfo) {
		return out, errors.New("application and signing identities must differ")
	}
	appLease, err := existingInspectionWriterLease(p.StateFile)
	if err != nil {
		return out, err
	}
	defer func() {
		err = errors.Join(err, appLease())
		if err != nil {
			out = pqLightSourceBundle{}
		}
	}()
	signLease, err := existingInspectionLockFile(p.SigningStatePath + ".lock")
	if err != nil {
		return out, err
	}
	defer func() {
		err = errors.Join(err, signLease())
		if err != nil {
			out = pqLightSourceBundle{}
		}
	}()
	for _, dir := range []string{filepath.Dir(p.StateFile), filepath.Dir(p.SigningStatePath)} {
		if err = rejectInspectionUnknown(dir); err != nil {
			return out, err
		}
	}
	dbs := make([]dbm.DB, 0, 2)
	for _, name := range []string{"state", "blockstore"} {
		dir := filepath.Join(p.CometDataDirectory, name+".db")
		before, e := inspectionDatabaseFiles(dir)
		if e != nil {
			return out, e
		}
		db, e := dbm.NewGoLevelDBWithOpts(name, p.CometDataDirectory, &opt.Options{ReadOnly: true, ErrorIfMissing: true, Strict: opt.StrictAll})
		if e != nil {
			return out, fmt.Errorf("open existing stopped %s database: %w", name, e)
		}
		dbs = append(dbs, db)
		defer func() {
			after, e := inspectionDatabaseFiles(dir)
			if e != nil || !sameInspectionDatabase(before, after) {
				err = errors.Join(err, errors.New("original database bytes/identity changed"))
			}
			err = errors.Join(err, db.Close())
			if err != nil {
				out = pqLightSourceBundle{}
			}
		}()
	}
	defer func() {
		if recover() != nil {
			out = pqLightSourceBundle{}
			err = errors.New("original stopped block store is corrupt")
		}
	}()
	r := proofHostReadDB{dbs[0]}
	l := proofHostLedger{load: r.load, validators: r.validators, blocks: blockstore.NewBlockStore(dbs[1])}
	out, err = in.captureLight(l, plan, now)
	if err != nil {
		return out, err
	}
	current, e := os.Lstat(p.SigningStatePath)
	if e != nil || !samePQStateFile(signInfo, current) {
		return pqLightSourceBundle{}, errors.New("original PQ HRS changed during publication")
	}
	return out, nil
}

func (in *proofHostInputs) captureLight(l proofHostLedger, plan PQLightSourcePlan, now time.Time) (out pqLightSourceBundle, err error) {
	// BlockStore panics on corrupt persisted proto. This boundary returns only
	// a bounded failure, never database bytes or a partial success object.
	defer func() {
		if recover() != nil {
			out = pqLightSourceBundle{}
			err = errors.New("original block store is corrupt or unavailable")
		}
	}()
	p := in.plan
	if in.runtime == nil && (in.bootstrap.record.Params.Version == nil || in.bootstrap.record.Params.Version.App != ApplicationVersion) {
		return out, errors.New("historical runtime requires independent upgrade plan")
	}
	if err = in.contextErr(); err != nil {
		return out, err
	}
	height, _ := strconv.ParseInt(plan.HeaderHeight, 10, 64)
	actual, err := l.load()
	if err != nil {
		return out, err
	}
	if actual.ChainID != plan.ChainID || strconv.FormatInt(actual.LastBlockHeight, 10) != p.EngineHeight || hex.EncodeToString(actual.AppHash) != p.EngineAppHash || actual.InitialHeight != in.bootstrap.record.InitialHeight {
		return out, errors.New("actual engine checkpoint differs from independently pinned source plan")
	}
	if height > actual.LastBlockHeight {
		return out, errors.New("target header is not committed in the actual ledger")
	}
	captured, err := capturePQEngineState(p.StateFile)
	if err != nil {
		return out, err
	}
	if captured.layout != p.StateLayout {
		return out, errors.New("original state layout mismatch")
	}
	held, err := holdProofHostCapturedState(captured)
	if err != nil {
		return out, err
	}
	in.originals["originalState"] = held
	state, err := readPQEngineCommittedState(p.StateFile, in.migration, in.bootstrap, in.engine, in.runtime)
	if err != nil {
		return out, err
	}
	if state.Height != actual.LastBlockHeight || state.AppHash != p.EngineAppHash || !state.Initialized {
		return out, errors.New("original application is not the exact engine committed checkpoint")
	}
	if err = in.contextErr(); err != nil {
		return out, err
	}
	version, err := runtimeStateApplicationVersion(state, in.runtime)
	if err != nil || version != actual.Version.Consensus.App {
		return out, errors.New("original runtime differs from actual engine version")
	}
	if err = in.engine.ValidateCommittedSchedule(state.PQEngineSchedule, state.Height); err != nil {
		return out, err
	}
	snapshot, e := newPQEngineSnapshot(in.bootstrap, state.ValidatorRegistry, state.PQEngineSchedule, state.Height)
	snapshot, err = withRuntimeUpgradeSnapshot(snapshot, e, in.runtime)
	if err != nil {
		return out, err
	}
	policy, err := snapshot.Policy()
	if err != nil || height-1 < policy.ActivationHeight {
		return out, errors.New("source target must be in the independently activated PQ profile")
	}
	if _, err = sm.BindConsensusState(actual, snapshot); err != nil {
		return out, err
	}

	trustedH, _ := strconv.ParseInt(p.TrustedHeight, 10, 64)
	trusted, err := l.lightBlock(trustedH)
	if err != nil {
		return out, err
	}
	if hex.EncodeToString(trusted.Hash()) != p.TrustedBlockHash {
		return out, errors.New("ledger trusted header differs from independent pin")
	}
	trusted, err = light.BindLightBlock(snapshot, trusted)
	if err != nil {
		return out, err
	}
	params, err := snapshot.ParamsAt(trustedH)
	if err != nil || trusted.Version.App != params.Version.App {
		return out, errors.New("trusted header runtime mismatch")
	}
	if err = trusted.ValidatorSet.VerifyCommit(actual.ChainID, trusted.Commit.BlockID, trustedH, trusted.Commit); err != nil {
		return out, err
	}
	target, err := l.lightBlock(height)
	if err != nil {
		return out, err
	}
	expected := ProofHostExpectedHeader{ChainID: plan.ChainID, HeaderHeight: plan.HeaderHeight, BlockHash: hex.EncodeToString(target.Hash()), StateHeight: strconv.FormatInt(height-1, 10), StateAppHash: hex.EncodeToString(target.AppHash)}
	expect, err := expected.expectation()
	if err != nil {
		return out, err
	}
	proof, err := proofHostLightRequest(target)
	if err != nil {
		return out, err
	}
	trust := in.trust(snapshot)
	trust.TrustedLightBlock = trusted
	trust.Now = now
	result, err := VerifyPQLightProof(trust, expect, proof)
	if err != nil {
		return out, err
	}
	stateBytes, err := encodeCommittedStateJSON(state)
	if err != nil {
		return out, err
	}
	trustedBytes, err := cmtjson.Marshal(trusted)
	if err != nil {
		return out, err
	}
	if err = captured.unchanged(); err != nil {
		return out, err
	}
	after, err := l.load()
	if err != nil {
		return out, err
	}
	if err = proofHostCheckpointContinuation(l, snapshot, actual, after, false); err != nil {
		return out, err
	}
	if err = in.unchanged(); err != nil {
		return out, err
	}
	files := []ProofHostSourceFile{proofHostFile("migration", "migration.json", in.originals["migration"].raw), proofHostFile("genesis", "genesis.json", in.originals["genesis"].raw), proofHostFile("state", "committed-state.json", stateBytes), proofHostFile("schedule", "schedule.json", in.originals["schedule"].raw)}
	if r := in.originals["runtime"]; r != nil {
		files = append(files, proofHostFile("runtime", "runtime-plan.json", r.raw))
	}
	files = append(files, proofHostFile("trustedLightBlock", "trusted-light-block.json", trustedBytes))
	// Store typed DATA until output paths are fixed; these fields are never trust inputs.
	request, err := json.Marshal(struct {
		Version  string                  `json:"version"`
		Expected ProofHostExpectedHeader `json:"expected"`
		Proof    PQLightProofRequest     `json:"proof"`
	}{"YNX-CONSENSUS-PROOF-VERIFY-REQUEST/v1", expected, proof})
	if err != nil {
		return out, err
	}
	files = append(files, proofHostFile("request", "request.json", request))
	return pqLightSourceBundle{files: files, result: result}, nil
}

func writePQLightSource(output string, p PQLightSourcePlan, pin string, b pqLightSourceBundle) (PQLightSourceReceipt, error) {
	var empty PQLightSourceReceipt
	if err := proofHostDirectory(output); err != nil {
		return empty, err
	}
	parent := filepath.Dir(output)
	resolved, err := filepath.EvalSymlinks(parent)
	info, statErr := os.Lstat(parent)
	var st unix.Stat_t
	if err != nil || statErr != nil || resolved != parent || !info.IsDir() || info.Mode().Perm() != 0700 || info.Mode()&(os.ModeSticky|os.ModeSetuid|os.ModeSetgid) != 0 || unix.Lstat(parent, &st) != nil || st.Uid != uint32(os.Geteuid()) {
		return empty, errors.New("original canonical private publication parent required")
	}
	trustedSHA, requestSHA := "", ""
	for _, f := range b.files {
		if f.Role == "trustedLightBlock" {
			trustedSHA = f.SHA256
		}
		if f.Role == "request" {
			requestSHA = f.SHA256
		}
	}
	runtimePath := ""
	if p.RuntimePlanFile != "" {
		runtimePath = filepath.Join(output, "runtime-plan.json")
	}
	light := map[string]string{"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": p.ChainID, "migrationFile": filepath.Join(output, "migration.json"), "genesisFile": filepath.Join(output, "genesis.json"), "stateFile": filepath.Join(output, "committed-state.json"), "scheduleFile": filepath.Join(output, "schedule.json"), "scheduleHash": p.ScheduleHash, "consensusGenesisSHA256": p.ConsensusGenesisSHA256, "originalGenesisHash": p.OriginalGenesisHash, "migrationStateHash": p.MigrationStateHash, "runtimePlanFile": runtimePath, "runtimePlanHash": p.RuntimePlanHash, "engineHeight": p.EngineHeight, "engineAppHash": p.EngineAppHash, "expectedHeaderHeight": strconv.FormatInt(b.result.HeaderHeight, 10), "expectedBlockHash": b.result.BlockHash, "expectedStateHeight": strconv.FormatInt(b.result.StateHeight, 10), "expectedStateAppHash": b.result.StateAppHash, "trustedLightBlockFile": filepath.Join(output, "trusted-light-block.json"), "trustedLightBlockSHA256": trustedSHA, "trustingPeriodNanoseconds": p.TrustingPeriodNanoseconds, "maxClockDriftNanoseconds": p.MaxClockDriftNanoseconds, "trustLevelNumerator": p.TrustLevelNumerator, "trustLevelDenominator": p.TrustLevelDenominator}
	context, err := json.Marshal(light)
	if err != nil {
		return empty, err
	}
	b.files = append(b.files, proofHostFile("context", "trust-context.json", context))
	entries := make([]ProofHostDeliveryFile, 0, len(b.files))
	for _, f := range b.files {
		entries = append(entries, ProofHostDeliveryFile{Role: f.Role, Name: f.Name, Bytes: strconv.Itoa(len(f.Bytes)), SHA256: f.SHA256})
	}
	manifest, err := json.Marshal(struct {
		Version        string                  `json:"version"`
		PlanSHA256     string                  `json:"planSHA256"`
		EngineHeight   string                  `json:"engineHeight"`
		EngineAppHash  string                  `json:"engineAppHash"`
		Verification   PQLightProofResult      `json:"verification"`
		Files          []ProofHostDeliveryFile `json:"files"`
		PublicDataOnly bool                    `json:"publicDataOnly"`
	}{"YNX-PQ-LIGHT-SOURCE-DELIVERY/v1", pin, p.EngineHeight, p.EngineAppHash, b.result, entries, true})
	if err != nil {
		return empty, err
	}
	// No pre-existing output can be adopted or cleared. Partial files remain.
	if err = os.Mkdir(output, 0700); err != nil {
		return empty, err
	}
	if err = syncProofDeliveryDirectory(parent); err != nil {
		return empty, err
	}
	for _, f := range b.files {
		if err = writeProofDeliveryExclusive(output, f.Name, f.Bytes, f.SHA256); err != nil {
			return empty, err
		}
	}
	if err = writeProofDeliveryExclusive(output, "delivery.json", manifest, proofHostSHA(manifest)); err != nil {
		return empty, err
	}
	return PQLightSourceReceipt{Version: "YNX-PQ-LIGHT-SOURCE-EXPORT/v1", PlanSHA256: pin, ManifestPath: filepath.Join(output, "delivery.json"), ManifestSHA256: proofHostSHA(manifest), ContextPath: filepath.Join(output, "trust-context.json"), ContextSHA256: proofHostSHA(context), RequestPath: filepath.Join(output, "request.json"), RequestSHA256: requestSHA, EngineHeight: p.EngineHeight, EngineAppHash: p.EngineAppHash, Verification: b.result, PublicDataOnly: true, SourceReadOnly: true}, nil
}
