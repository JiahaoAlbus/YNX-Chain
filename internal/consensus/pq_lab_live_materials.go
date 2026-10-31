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
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const PQLabLiveMaterialsPolicyVersion = "YNX-PQ-LAB-LIVE-MATERIALS-POLICY/v1"
const MaxPQLabLiveMaterialOperations = 10000

// The startup pin selects only an original private synthetic lab and bounded
// read-only DATA operations. It is not a Root, a peer assertion, or a grant to
// sign. The normal owning Node supplies checkpoint/header/registry evidence.
type PQLabLiveMaterialsPolicy struct {
	Version          string        `json:"version"`
	RootDir          string        `json:"rootDir"`
	PlanSHA256       string        `json:"planSHA256"`
	ActivationSHA256 string        `json:"activationSHA256"`
	AnchorSHA256     string        `json:"anchorSHA256"`
	NodeIndex        int           `json:"nodeIndex"`
	MaxOperations    uint32        `json:"maxOperations,string"`
	CaptureTimeout   time.Duration `json:"captureTimeoutNanoseconds,string"`
	TrustingPeriod   time.Duration `json:"trustingPeriodNanoseconds,string"`
	MaxClockDrift    time.Duration `json:"maxClockDriftNanoseconds,string"`
	TrustNumerator   uint64        `json:"trustNumerator,string"`
	TrustDenominator uint64        `json:"trustDenominator,string"`
}

type PQLabLiveMaterialsSetup struct {
	Version          string            `json:"version"`
	Policy           PQLabWorkloadFile `json:"policy"`
	NodeArguments    []string          `json:"nodeArguments"`
	SyntheticOnly    bool              `json:"syntheticOnly"`
	NodeStarted      bool              `json:"nodeStarted"`
	AuthorityGranted bool              `json:"authorityGranted"`
}

type PQLabLiveMaterialsRequest struct {
	Version           string `json:"version"`
	PolicySHA256      string `json:"policySHA256"`
	Sequence          uint32 `json:"sequence,string"`
	TransactionFile   string `json:"transactionFile"`
	TransactionSHA256 string `json:"transactionSHA256"`
	NativeWireHash    string `json:"nativeWireHash"`
}

type PQLabLiveMaterialsResult struct {
	Version                string            `json:"version"`
	PolicySHA256           string            `json:"policySHA256"`
	Sequence               uint32            `json:"sequence,string"`
	Outcome                string            `json:"outcome"`
	SourceKind             string            `json:"sourceKind"`
	OwningNodeIndex        int               `json:"owningNodeIndex"`
	EngineHeight           int64             `json:"engineHeight,string"`
	EngineAppHash          string            `json:"engineAppHash"`
	TransactionHash        string            `json:"transactionHash"`
	NativeWireHash         string            `json:"nativeWireHash"`
	Materials              PQLabWorkloadFile `json:"materials"`
	Proof                  PQLabWorkloadFile `json:"proof"`
	Checkpoint             PQLabWorkloadFile `json:"checkpoint"`
	Verified               PQLabProofExport  `json:"verified"`
	SyntheticOnly          bool              `json:"syntheticOnly"`
	SourceReadOnly         bool              `json:"sourceReadOnly"`
	AuthorityGranted       bool              `json:"authorityGranted"`
	FourNodeAgreementClaim bool              `json:"fourNodeAgreementClaim"`
}

type pqLabLiveMaterialsInputs struct {
	policy               PQLabLiveMaterialsPolicy
	path, pin, directory string
	plan                 PQLabNetworkPlan
	migration            chain.ConsensusMigrationState
	activation           PQLabActivation
	schedule             []byte
	anchor               PQLabLiveMaterialsAnchor
	originals            []*proofHostOriginal
}

func pqLabLiveMaterialsDirectory(p PQLabLiveMaterialsPolicy) string {
	return filepath.Join(p.RootDir, "live-materials", fmt.Sprintf("node-%d", p.NodeIndex))
}
func pqLabLiveRequestPath(dir string, seq uint32) string {
	return filepath.Join(dir, fmt.Sprintf("request-%06d.json", seq))
}
func pqLabLiveOutputPath(dir string, seq uint32) string {
	return filepath.Join(dir, fmt.Sprintf("operation-%06d", seq))
}

func validatePQLabLivePolicy(p PQLabLiveMaterialsPolicy) error {
	if p.Version != PQLabLiveMaterialsPolicyVersion || p.NodeIndex < 0 || p.NodeIndex >= 4 || p.MaxOperations == 0 || p.MaxOperations > MaxPQLabLiveMaterialOperations || p.CaptureTimeout <= 0 || p.CaptureTimeout > 120*time.Second || p.TrustingPeriod <= 0 || p.TrustingPeriod > 24*time.Hour || p.MaxClockDrift <= 0 || p.MaxClockDrift > time.Minute || p.TrustNumerator == 0 || p.TrustDenominator == 0 || p.TrustNumerator > p.TrustDenominator || p.TrustDenominator > 1<<20 || p.TrustNumerator < p.TrustDenominator/3+(boolUint64(p.TrustDenominator%3 != 0)) {
		return errors.New("explicit bounded synthetic live DATA policy required")
	}
	for _, pin := range []string{p.PlanSHA256, p.ActivationSHA256} {
		if _, err := proofHostHash(pin); err != nil {
			return err
		}
	}
	return proofHostLivePrivateDirectory(p.RootDir)
}
func boolUint64(v bool) uint64 {
	if v {
		return 1
	}
	return 0
}

// IsPQLabLiveMaterialsPolicy dispatches only after checking the original exact
// policy SHA. Unknown versions continue through the old one-shot parser, which
// rejects them. No directory or request is created by detection.
func IsPQLabLiveMaterialsPolicy(path, pin string) (bool, error) {
	if _, err := proofHostHash(pin); err != nil {
		return false, err
	}
	r, err := readProofHostOriginal(path, pin, MaxProofHostLivePolicyBytes)
	if err != nil {
		return false, err
	}
	defer r.file.Close()
	var version struct {
		Version string `json:"version"`
	}
	if pqLightUniqueJSON(r.raw) != nil || json.Unmarshal(r.raw, &version) != nil {
		return false, errors.New("invalid pinned live policy JSON")
	}
	return version.Version == PQLabLiveMaterialsPolicyVersion, r.unchanged()
}

func loadPQLabLiveMaterialsPolicy(path, pin string) (in *pqLabLiveMaterialsInputs, err error) {
	if _, err = proofHostHash(pin); err != nil {
		return nil, err
	}
	r, err := readProofHostOriginal(path, pin, MaxProofHostLivePolicyBytes)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err != nil {
			err = errors.Join(err, r.file.Close())
			if in != nil {
				err = errors.Join(err, in.close())
			}
			in = nil
		}
	}()
	var p PQLabLiveMaterialsPolicy
	if err = pqLabDecode(r.raw, &p); err != nil {
		return nil, err
	}
	if _, err = proofHostHash(p.AnchorSHA256); err != nil {
		return nil, err
	}
	if path != filepath.Join(pqLabLiveMaterialsDirectory(p), "policy.json") {
		return nil, errors.New("live policy must remain in its original lab node directory")
	}
	in, err = loadPQLabLiveMaterialsConfig(p)
	if err != nil {
		return in, err
	}
	in.path, in.pin = path, pin
	ar, err := readProofHostOriginal(filepath.Join(in.directory, "anchor.json"), p.AnchorSHA256, 128<<20)
	if err != nil {
		return in, err
	}
	in.originals = append(in.originals, ar)
	if err = pqLabDecode(ar.raw, &in.anchor); err != nil {
		return in, err
	}
	if err = in.validateAnchor(); err != nil {
		return in, err
	}
	in.originals = append(in.originals, r)
	return in, nil
}

func loadPQLabLiveMaterialsConfig(p PQLabLiveMaterialsPolicy) (in *pqLabLiveMaterialsInputs, err error) {
	if err = validatePQLabLivePolicy(p); err != nil {
		return nil, err
	}
	in = &pqLabLiveMaterialsInputs{policy: p, directory: pqLabLiveMaterialsDirectory(p)}
	defer func() {
		if err != nil {
			err = errors.Join(err, in.close())
			in = nil
		}
	}()
	if err = proofHostLivePrivateDirectory(in.directory); err != nil {
		return in, err
	}
	in.plan, in.migration, _, err = loadPQLab(in.policy.RootDir, in.policy.PlanSHA256)
	if err != nil {
		return in, err
	}
	hold := func(path, pin string, limit int64) ([]byte, error) {
		r, e := readProofHostOriginal(path, pin, limit)
		if e != nil {
			return nil, e
		}
		in.originals = append(in.originals, r)
		return r.raw, nil
	}
	if _, err = hold(filepath.Join(in.plan.RootDir, "network-plan.json"), in.policy.PlanSHA256, 4<<20); err != nil {
		return in, err
	}
	raw, err := hold(filepath.Join(in.plan.RootDir, "activation", "activation.json"), in.policy.ActivationSHA256, 4<<20)
	if err != nil {
		return in, err
	}
	if err = pqLabDecode(raw, &in.activation); err != nil {
		return in, err
	}
	a := in.activation
	plan := in.plan
	if a.Version != "YNX-PQ-LAB-ACTIVATION/v1" || !a.SyntheticOnly || a.NodeStarted || a.PQQuorumVerified || a.NetworkPlanSHA256 != in.policy.PlanSHA256 || a.ScheduleFile != filepath.Join(plan.RootDir, "activation", "schedule.json") || len(a.Nodes) != 4 {
		return in, errors.New("original independently pinned lab activation required")
	}
	in.schedule, err = hold(a.ScheduleFile, "", 32<<10)
	if err != nil {
		return in, err
	}
	auth, err := NewPQEngineAuthorization(in.schedule, a.ScheduleHash)
	if err != nil {
		return in, err
	}
	s := auth.schedule
	if a.RegistryHeight != s.RegistryHeight || a.RegistryRoot != s.RegistryRoot || a.ParamsHeight != s.ParamsUpdateHeight || a.ValidatorHeight != s.ValidatorUpdateHeight || a.ActivationHeight != s.ActivationHeight {
		return in, errors.New("activation schedule changed")
	}
	for i, n := range plan.Nodes {
		args := append(plan.normalArgs(n), "--pq-engine-schedule", a.ScheduleFile, "--pq-engine-schedule-hash", a.ScheduleHash, "--pq-host-key-binding", n.HostBindingFile, "--pq-host-key-vault", n.VaultFile, "--pq-recovery-fd", "3")
		if !reflect.DeepEqual(a.Nodes[i], PQLabActivationNode{Index: i, Args: args, RecoveryFD: 3, RecoveryCredentialFile: n.RecoveryCredentialFile}) {
			return in, errors.New("activation differs from original normal process arguments")
		}
	}
	return in, in.current()
}
func (in *pqLabLiveMaterialsInputs) close() error {
	var e error
	for _, r := range in.originals {
		e = errors.Join(e, r.file.Close())
	}
	in.originals = nil
	return e
}
func (in *pqLabLiveMaterialsInputs) current() error {
	for _, r := range in.originals {
		if e := r.unchanged(); e != nil {
			return e
		}
	}
	if e := proofHostLivePrivateDirectory(in.directory); e != nil {
		return e
	}
	_, _, _, e := loadPQLab(in.policy.RootDir, in.policy.PlanSHA256)
	return e
}

// PreparePQLabLiveMaterials creates the bounded startup policy BEFORE the
// normal node starts. No private material is read; no node is started here.
func PreparePQLabLiveMaterials(p PQLabLiveMaterialsPolicy) (out PQLabLiveMaterialsSetup, err error) {
	if p.AnchorSHA256 != "" {
		return out, errors.New("setup captures the actual original R anchor; caller-supplied anchor is forbidden")
	}
	if err = validatePQLabLivePolicy(p); err != nil {
		return out, err
	}
	if _, _, _, err = loadPQLab(p.RootDir, p.PlanSHA256); err != nil {
		return out, err
	}
	parent := filepath.Join(p.RootDir, "live-materials")
	if err = os.Mkdir(parent, 0700); err != nil && !os.IsExist(err) {
		return out, err
	}
	if err = proofHostLivePrivateDirectory(parent); err != nil {
		return out, err
	}
	dir := pqLabLiveMaterialsDirectory(p)
	if err = pqLabNetworkFreshDirectory(dir); err != nil {
		return out, err
	}
	in, err := loadPQLabLiveMaterialsConfig(p)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, in.close()) }()
	anchor, err := in.captureOriginalAnchor()
	if err != nil {
		return out, err
	}
	anchorRaw, err := json.Marshal(anchor)
	if err != nil {
		return out, err
	}
	if err = pqLabWrite(filepath.Join(dir, "anchor.json"), anchorRaw); err != nil {
		return out, err
	}
	p.AnchorSHA256 = pqLabSHA(anchorRaw)
	raw, err := json.Marshal(p)
	if err != nil {
		return out, err
	}
	path := filepath.Join(dir, "policy.json")
	if err = pqLabWrite(path, raw); err != nil {
		return out, err
	}
	if err = in.current(); err != nil {
		return out, err
	}
	out = PQLabLiveMaterialsSetup{Version: "YNX-PQ-LAB-LIVE-MATERIALS-SETUP/v1", Policy: pqLabFile(path, raw), SyntheticOnly: true}
	out.NodeArguments = append(append([]string(nil), in.activation.Nodes[p.NodeIndex].Args...), "--proof-host-live-policy", path, "--proof-host-live-policy-sha256", out.Policy.SHA256)
	return out, nil
}

func (in *pqLabLiveMaterialsInputs) transaction(r PQLabLiveMaterialsRequest) (*proofHostOriginal, string, []byte, error) {
	if r.Version != "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1" || r.PolicySHA256 != in.pin || r.Sequence == 0 || r.Sequence > in.policy.MaxOperations {
		return nil, "", nil, errors.New("live operation differs from bounded startup policy")
	}
	for _, h := range []string{r.TransactionSHA256, r.NativeWireHash} {
		if _, err := proofHostHash(h); err != nil {
			return nil, "", nil, err
		}
	}
	rel, err := filepath.Rel(filepath.Join(in.plan.RootDir, "workload"), r.TransactionFile)
	if err != nil || !pqLabPublicTransaction.MatchString(filepath.ToSlash(rel)) {
		return nil, "", nil, errors.New("only original public lab corpus/sender transaction paths allowed")
	}
	f, err := readProofHostOriginal(r.TransactionFile, r.TransactionSHA256, MaxPQContractTransactionBytes)
	if err != nil {
		return nil, "", nil, err
	}
	kind, wire, err := pqTransactionWire(f.raw)
	if err == nil && pqLabSHA(wire) != r.NativeWireHash {
		err = errors.New("original native transaction hash mismatch")
	}
	if err == nil {
		_, err = pqLabExportOwner(kind, wire)
	}
	if err != nil {
		_ = f.file.Close()
		return nil, "", nil, err
	}
	return f, kind, wire, nil
}

// Publish is one explicit request, not acquisition, retry or confirmation.
// Only one next operation can be queued; the preceding durable result is
// required. Existing request/output/partial files are never overwritten.
func PublishPQLabLiveMaterialsRequest(policyPath, pin string, r PQLabLiveMaterialsRequest) (path string, err error) {
	in, err := loadPQLabLiveMaterialsPolicy(policyPath, pin)
	if err != nil {
		return "", err
	}
	defer func() { err = errors.Join(err, in.close()) }()
	f, _, _, err := in.transaction(r)
	if err != nil {
		return "", err
	}
	defer func() { err = errors.Join(err, f.unchanged(), f.file.Close()) }()
	if r.Sequence > 1 {
		previous, e := readProofHostOriginal(filepath.Join(pqLabLiveOutputPath(in.directory, r.Sequence-1), "result.json"), "", 2<<20)
		if e != nil {
			return "", errors.New("preceding exact durable live result required before next request")
		}
		var result PQLabLiveMaterialsResult
		e = pqLabDecode(previous.raw, &result)
		e = errors.Join(e, previous.file.Close())
		if e != nil || result.Version != "YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1" || result.PolicySHA256 != pin || result.Sequence != r.Sequence-1 || result.Outcome != "verified_transaction_data" || !result.SyntheticOnly || result.AuthorityGranted {
			return "", errors.New("preceding live result is not exact completed DATA")
		}
	}
	path = pqLabLiveRequestPath(in.directory, r.Sequence)
	if err = proofHostLiveAbsent(path, path+".partial", pqLabLiveOutputPath(in.directory, r.Sequence)); err != nil {
		return "", err
	}
	if err = in.current(); err != nil {
		return "", err
	}
	raw, err := json.Marshal(r)
	if err != nil {
		return "", err
	}
	if err = publishProofHostLiveControl(path, raw); err != nil {
		return "", err
	}
	return path, in.current()
}

func pqLabLiveCanonicalEqual(a, b any) bool {
	x, e := json.Marshal(a)
	y, f := json.Marshal(b)
	return e == nil && f == nil && bytes.Equal(x, y)
}

// Read returns the exact original public outcome, never a new acquisition or a
// nonce release. The normal sender Confirm still verifies these materials and
// its exact pending operation. Missing/UNKNOWN results are errors, not success.
func ReadPQLabLiveMaterialsResult(path, pin string, sequence uint32) (out PQLabLiveMaterialsResult, err error) {
	in, err := loadPQLabLiveMaterialsPolicy(path, pin)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, in.close()) }()
	if sequence == 0 || sequence > in.policy.MaxOperations {
		return out, errors.New("result outside fixed operation slots")
	}
	dir := pqLabLiveOutputPath(in.directory, sequence)
	if err = proofHostLivePrivateDirectory(dir); err != nil {
		return out, err
	}
	if _, e := os.Lstat(filepath.Join(dir, "failure.json")); !os.IsNotExist(e) {
		return out, errors.New("original live operation is UNKNOWN; preserve its request and output")
	}
	r, err := readProofHostOriginal(filepath.Join(dir, "result.json"), "", 2<<20)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, r.unchanged(), r.file.Close()) }()
	if err = pqLabDecode(r.raw, &out); err != nil {
		return out, err
	}
	if out.Version != "YNX-PQ-LAB-LIVE-MATERIALS-RESULT/v1" || out.PolicySHA256 != pin || out.Sequence != sequence || out.Outcome != "verified_transaction_data" || out.SourceKind != "original-node-owning-stores" || out.OwningNodeIndex != in.policy.NodeIndex || !out.SyntheticOnly || !out.SourceReadOnly || out.AuthorityGranted || out.FourNodeAgreementClaim {
		return out, errors.New("invalid original live result identity")
	}
	intent, err := readProofHostOriginal(filepath.Join(dir, "intent.json"), "", 16<<10)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, intent.unchanged(), intent.file.Close()) }()
	var request PQLabLiveMaterialsRequest
	if err = pqLabDecode(intent.raw, &request); err != nil {
		return out, err
	}
	if request.PolicySHA256 != pin || request.Sequence != sequence || request.TransactionSHA256 != out.TransactionHash || request.NativeWireHash != out.NativeWireHash {
		return out, errors.New("live result differs from original requested transaction")
	}
	tx, _, _, err := in.transaction(request)
	if err != nil {
		return out, err
	}
	defer func() { err = errors.Join(err, tx.unchanged(), tx.file.Close()) }()
	for _, f := range []struct {
		file  PQLabWorkloadFile
		name  string
		limit int64
	}{{out.Materials, "materials.json", MaxPQLabProofMaterialsBytes}, {out.Proof, "proof.json", MaxPQTransactionProofRequestBytes}, {out.Checkpoint, "committed-state.json", 128 << 20}} {
		if f.file.Path != filepath.Join(dir, f.name) {
			return out, errors.New("live result escaped original output directory")
		}
		original, e := readProofHostOriginal(f.file.Path, f.file.SHA256, f.limit)
		if e != nil {
			return out, e
		}
		if pqLabFile(f.file.Path, original.raw) != f.file {
			e = errors.New("live original length/hash mismatch")
		}
		e = errors.Join(e, original.file.Close())
		if e != nil {
			return out, e
		}
	}
	return out, in.current()
}
