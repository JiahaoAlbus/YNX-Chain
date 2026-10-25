package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/bftgateway"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxbatch"
)

// One canonical Whole enters the original gateway/ABCI. The gateway checks both
// PQ signatures and trusted original-height policy. Its RPC observation alone
// is deliberately not a locally authenticated consensus-finality proof.
type pqWholeCase struct {
	wire         []byte
	members      []string
	batch, outer string
	kind, native string
	transfer     *ynxauth.Transfer
	registration *ynxauth.RegistrationIntent
}

// Disjoint local monotonic durations. HTTP includes server wait and cannot
// identify validator execution, disk fsync or BFT formation time.
type pqCasePhases struct {
	InputPreparationNs            int64 `json:"inputPreparationNs,string"`
	IntentDurabilityNs            int64 `json:"intentDurabilityNs,string"`
	SubmissionHTTPNs              int64 `json:"submissionHTTPNs,string"`
	SubmissionValidationNs        int64 `json:"submissionValidationNs,string"`
	OriginalReadbackHTTPNs        int64 `json:"originalReadbackHTTPNs,string"`
	OriginalReadbackValidationNs  int64 `json:"originalReadbackValidationNs,string"`
	ProofCollectionHTTPNs         int64 `json:"proofCollectionHTTPNs,string"`
	CollectorIdentityValidationNs int64 `json:"collectorIdentityValidationNs,string"`
	ProofDurabilityNs             int64 `json:"proofDurabilityNs,string"`
}
type pqWholeCaseReport struct {
	ConsensusExecutionOutcome         string            `json:"consensusExecutionOutcome,omitempty"`
	FinalizedBusinessHashes           []string          `json:"finalizedBusinessHashes,omitempty"`
	RegistrationFinalized             bool              `json:"registrationFinalized"`
	VerifierProcessStarted            bool              `json:"verifierProcessStarted"`
	VerifierInterrupted               bool              `json:"verifierInterrupted"`
	VerifierExitCode                  *int              `json:"verifierExitCode,omitempty"`
	ProofVerifierSHA256               string            `json:"proofVerifierSha256,omitempty"`
	TrustContextSHA256                string            `json:"trustContextSha256,omitempty"`
	EffectiveBusinessFinalized        int               `json:"effectiveBusinessFinalized"`
	ActualOfferToFinalityMeasured     bool              `json:"actualOfferToFinalityMeasured"`
	VerifierPreparationNs             int64             `json:"verifierPreparationNs,string"`
	VerifierProcessNs                 int64             `json:"verifierProcessNs,string"`
	VerifierEvidenceDurabilityNs      int64             `json:"verifierEvidenceDurabilityNs,string"`
	VerifierResultValidationNs        int64             `json:"verifierResultValidationNs,string"`
	ProofVerificationNs               int64             `json:"proofVerificationNs,string"`
	ProofVerificationStatus           string            `json:"proofVerificationStatus,omitempty"`
	ProofVerificationError            string            `json:"proofVerificationError,omitempty"`
	VerifierEvidencePath              string            `json:"verifierEvidencePath,omitempty"`
	VerifierEvidenceSHA256            string            `json:"verifierEvidenceSha256,omitempty"`
	CometIndex                        *uint32           `json:"cometIndex,omitempty"`
	Phases                            pqCasePhases      `json:"clientPhases"`
	ProofCollectionStatus             string            `json:"proofCollectionStatus,omitempty"`
	ProofCollectionError              string            `json:"proofCollectionError,omitempty"`
	ProofEvidencePath                 string            `json:"proofEvidencePath,omitempty"`
	ProofEvidenceSHA256               string            `json:"proofEvidenceSha256,omitempty"`
	ProofEvidenceBytes                int               `json:"proofEvidenceBytes,omitempty"`
	RegistrationObserved              bool              `json:"registrationObserved"`
	AccountActivationHeight           uint64            `json:"accountActivationHeight,string,omitempty"`
	TransactionType                   string            `json:"transactionType"`
	NativeTransactionHash             string            `json:"nativeTransactionHash"`
	Protocol                          string            `json:"protocol"`
	Status                            string            `json:"status"`
	BatchHash                         string            `json:"batchHash,omitempty"`
	ABCITransactionHash               string            `json:"abciTransactionHash"`
	Members                           int               `json:"members"`
	SubmissionAttempts                int               `json:"submissionAttempts"`
	OriginalReadbackAttempts          int               `json:"originalReadbackAttempts"`
	InitialSubmissionUnknown          bool              `json:"initialSubmissionUnknown"`
	EffectiveBusinessIncludedObserved int               `json:"effectiveBusinessIncludedObserved"`
	RejectedMembers                   int               `json:"rejectedMembers"`
	ExecutionHeight                   uint64            `json:"executionHeight,string"`
	ObservationElapsedNs              int64             `json:"observationElapsedNs,string"`
	ConfiguredRPCObservationOnly      bool              `json:"configuredRPCObservationOnly"`
	IndependentFinalityVerified       bool              `json:"independentFinalityVerified"`
	SustainedTPSQualified             bool              `json:"sustainedTPSQualified"`
	Error                             string            `json:"error,omitempty"`
	GoVersion                         string            `json:"goVersion"`
	BuildSettings                     map[string]string `json:"buildSettings"`
}

func pqWholeCaseSelected(o options) bool {
	return o.pqRegistrationWire != "" || o.pqMemberWire != "" || o.pqWholeWire != "" || o.pqGateway != "" || o.pqReadbackOnly || o.pqCollectProof || pqCaseVerifierSelected(o)
}
func validatePQWholeCaseOptions(o options) error {
	if err := validatePQCaseVerifierOptions(o); err != nil {
		return err
	}
	u, e := url.Parse(o.pqGateway)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("PQ case requires an explicit normal gateway base URL")
	}
	profiles := 0
	if o.pqCollectProof && (o.pqMemberWire == "" && o.pqRegistrationWire == "" || o.pqWholeWire != "") {
		return errors.New("original proof collection requires a canonical transfer or initial registration Member route")
	}
	for _, path := range []string{o.pqWholeWire, o.pqMemberWire, o.pqRegistrationWire} {
		if path != "" {
			profiles++
		}
	}
	if profiles != 1 || o.output == "" || o.timeout <= 0 || o.timeout > 30*time.Second {
		return errors.New("PQ case requires exactly one signed Whole, N1 Member or registration Member, new output and timeout in (0,30s]")
	}
	if o.manifest != "" || o.transactions != "" || o.rounds > 1 || o.offeredRate != 0 || o.terminalStream || o.segmentedIntents || o.reuseResultSlots || o.senderMode != "" && o.senderMode != "rounds" {
		return errors.New("PQ Whole case cannot mix the classic transaction fixture or scheduling path")
	}
	return nil
}
func preparePQWholeCase(wire []byte) (pqWholeCase, error) {
	var out pqWholeCase
	if len(wire) == 0 || len(wire) > bftgateway.MaxPQWholeIngressBytes {
		return out, errors.New("Whole outside canonical gateway transfer profile")
	}
	whole, err := ynxbatch.DecodeWhole(wire)
	if err != nil {
		return out, err
	}
	if whole.Certificate.Purpose != ynxauth.TransactionPurpose {
		return out, errors.New("Whole purpose must be TX-BATCH")
	}
	payload, err := consensus.EncodePQTransaction(consensus.PQWholeType, wire)
	if err != nil {
		return out, err
	}
	if len(payload) > bftgateway.MaxPQWholeEnvelopeBytes {
		return out, errors.New("Whole envelope outside gateway profile")
	}
	out = pqWholeCase{kind: consensus.PQWholeType, native: consensus.SignedTransactionHash(wire), wire: bytes.Clone(wire), batch: consensus.SignedTransactionHash(wire), outer: consensus.SignedTransactionHash(payload), members: make([]string, len(whole.Messages))}
	for i, message := range whole.Messages {
		t, e := ynxauth.DecodeTransfer(message)
		if e != nil || t.From != whole.Certificate.Owner || !bytes.Equal(t.ChainID, whole.Certificate.ChainID) || t.NativeChainID != 6423 || t.Fee != 1 {
			return pqWholeCase{}, errors.New("Whole member differs from canonical native transfer profile")
		}
		out.members[i], err = chain.PQBatchTransactionHash(out.batch, uint32(i))
		if err != nil {
			return pqWholeCase{}, err
		}
	}
	return out, nil
}
func (p pqWholeCase) validateCommitted(v bftgateway.PQWholeView) (int, int, error) {
	if v.Type != consensus.PQWholeType || v.Status != "committed" || !v.Committed || v.Provenance != "comet-rpc" || v.ABCITransactionHash != p.outer || v.BatchHash != p.batch || v.ExecutionHeight == 0 || v.CometIndex == nil || !bytes.Equal(v.Whole, p.wire) || v.ReadbackURL != "/transactions/pq/wholes/"+p.outer || len(v.Results) != len(p.members) || v.Error != "" {
		return 0, 0, errors.New("original committed Whole identity/readback differs")
	}
	admitted, rejected := 0, 0
	for i, row := range v.Results {
		if row.Index != uint32(i) {
			return 0, 0, errors.New("member index order differs")
		}
		switch row.Outcome {
		case "admitted":
			if row.TransactionHash != p.members[i] || row.Error != "" {
				return 0, 0, errors.New("admitted member effect identity differs")
			}
			admitted++
		case "rejected":
			if row.TransactionHash != "" || strings.TrimSpace(row.Error) == "" {
				return 0, 0, errors.New("rejected member contains effect identity or lacks reason")
			}
			rejected++
		default:
			return 0, 0, errors.New("unknown member outcome")
		}
	}
	if admitted == 0 || v.FeeYNXT != uint64(admitted) {
		return 0, 0, errors.New("admitted member fee coverage differs")
	}
	return admitted, rejected, nil
}
func pqCaseHTTP(ctx context.Context, client *http.Client, method, target string, wire []byte) ([]byte, error) {
	return pqCaseHTTPBound(ctx, client, method, target, wire, 1<<20)
}
func pqCaseHTTPBound(ctx context.Context, client *http.Client, method, target string, wire []byte, limit int64) ([]byte, error) {
	var body io.ReadCloser
	if method == http.MethodPost {
		body = io.NopCloser(bytes.NewReader(wire))
	}
	request, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}
	if method == http.MethodPost {
		request.Header.Set("Content-Type", "application/octet-stream")
		request.ContentLength = int64(len(wire))
		request.GetBody = nil
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, errors.New("PQ gateway response exceeded bound")
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted && response.StatusCode != http.StatusUnprocessableEntity {
		return nil, fmt.Errorf("PQ gateway HTTP %d", response.StatusCode)
	}
	return raw, nil
}
func (p pqWholeCase) committedResponse(raw []byte) (int, int, uint64, *uint32, error) {
	if p.kind == consensus.PQTransferType || p.kind == consensus.PQInitialRegistrationType {
		var v bftgateway.PQMemberView
		if err := strictJSON(raw, &v); err != nil {
			return 0, 0, 0, nil, err
		}
		var n int
		var e error
		if p.kind == consensus.PQInitialRegistrationType {
			e = p.validateInitialCommitted(v)
		} else {
			n, e = p.validateMemberCommitted(v)
		}
		return n, 0, v.ExecutionHeight, v.CometIndex, e
	}
	var v bftgateway.PQWholeView
	if err := strictJSON(raw, &v); err != nil {
		return 0, 0, 0, nil, err
	}
	n, rejected, e := p.validateCommitted(v)
	return n, rejected, v.ExecutionHeight, v.CometIndex, e
}
func runPQWholeCase(ctx context.Context, client *http.Client, p pqWholeCase, gateway string, readOnly bool) pqWholeCaseReport {
	started := time.Now()
	r := pqWholeCaseReport{TransactionType: p.kind, NativeTransactionHash: p.native, Protocol: ynxbatch.Version, Status: "submission_unknown", BatchHash: p.batch, ABCITransactionHash: p.outer, Members: len(p.members), ConfiguredRPCObservationOnly: true, GoVersion: runtime.Version(), BuildSettings: map[string]string{}}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, s := range info.Settings {
			if strings.HasPrefix(s.Key, "vcs.") {
				r.BuildSettings[s.Key] = s.Value
			}
		}
	}
	broadcast, readback := "/transactions/pq/batches/broadcast", "/transactions/pq/wholes/"+p.outer
	if p.kind == consensus.PQTransferType {
		broadcast = "/transactions/pq/broadcast"
		readback = "/transactions/pq/originals/" + p.native
	}
	if p.kind == consensus.PQInitialRegistrationType {
		broadcast = "/accounts/" + url.PathEscape(p.registration.Owner) + "/authorization/register"
		readback = "/transactions/pq/originals/" + p.native
	}
	if !readOnly {
		r.SubmissionAttempts = 1
		phaseStart := time.Now()
		v, e := pqCaseHTTP(ctx, client, http.MethodPost, strings.TrimRight(gateway, "/")+broadcast, p.wire)
		r.Phases.SubmissionHTTPNs = time.Since(phaseStart).Nanoseconds()
		phaseStart = time.Now()
		_, _, _, _, identityError := p.committedResponse(v)
		r.Phases.SubmissionValidationNs = time.Since(phaseStart).Nanoseconds()
		r.InitialSubmissionUnknown = e != nil || identityError != nil
	}
	// Always reconcile the original identity. Never rebroadcast after UNKNOWN.
	r.OriginalReadbackAttempts = 1
	phaseStart := time.Now()
	v, e := pqCaseHTTP(ctx, client, http.MethodGet, strings.TrimRight(gateway, "/")+readback, nil)
	r.Phases.OriginalReadbackHTTPNs = time.Since(phaseStart).Nanoseconds()
	if e != nil {
		r.Error = e.Error()
		r.ObservationElapsedNs = time.Since(started).Nanoseconds()
		return r
	}
	phaseStart = time.Now()
	admitted, rejected, height, index, e := p.committedResponse(v)
	r.Phases.OriginalReadbackValidationNs = time.Since(phaseStart).Nanoseconds()
	if e != nil {
		r.Error = e.Error()
		r.ObservationElapsedNs = time.Since(started).Nanoseconds()
		return r
	}
	r.CometIndex = index
	r.Status = "committed_observed"
	if p.kind == consensus.PQInitialRegistrationType {
		r.Status = "registration_observed"
		r.RegistrationObserved = true
		r.AccountActivationHeight = p.registration.ActivateAt
	}
	r.EffectiveBusinessIncludedObserved = admitted
	r.RejectedMembers = rejected
	r.ExecutionHeight = height
	r.ObservationElapsedNs = time.Since(started).Nanoseconds()
	return r
}
func executePQWholeCase(o options) (returned error) {
	if err := validatePQWholeCaseOptions(o); err != nil {
		return err
	}
	preparationStart := time.Now()
	path, limit := o.pqWholeWire, int64(bftgateway.MaxPQWholeIngressBytes)
	if o.pqMemberWire != "" {
		path = o.pqMemberWire
		limit = bftgateway.MaxPQMemberIngressBytes
	}
	if o.pqRegistrationWire != "" {
		path = o.pqRegistrationWire
		limit = ynxauth.MaxPQInitialRegistrationBytes
	}
	raw, err := readBounded(path, limit)
	if err != nil {
		return err
	}
	var p pqWholeCase
	if o.pqRegistrationWire != "" {
		p, err = preparePQInitialCase(raw)
	} else if o.pqMemberWire != "" {
		p, err = preparePQMemberCase(raw)
	} else {
		p, err = preparePQWholeCase(raw)
	}
	if err != nil {
		return err
	}
	inputPreparationNs := time.Since(preparationStart).Nanoseconds()
	durabilityStart := time.Now()
	output, err := os.OpenFile(o.output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer output.Close()
	// An immutable original signed intent survives an interrupted response/report.
	intent, err := os.OpenFile(o.output+".pq-intent.json", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	err = json.NewEncoder(intent).Encode(struct {
		Protocol, TransactionType, Gateway, BatchHash, NativeTransactionHash, ABCITransactionHash string
		Wire                                                                                      []byte
		ReadbackOnly                                                                              bool
	}{ynxbatch.Version, p.kind, o.pqGateway, p.batch, p.native, p.outer, p.wire, o.pqReadbackOnly})
	if err == nil {
		err = intent.Sync()
	}
	closeErr := intent.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(o.output))
	if err != nil {
		return err
	}
	err = dir.Sync()
	dir.Close()
	if err != nil {
		return err
	}
	intentDurabilityNs := time.Since(durabilityStart).Nanoseconds()
	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(signalContext, o.timeout)
	defer cancel()
	transport := &http.Transport{DisableKeepAlives: true, MaxConnsPerHost: 1}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	report := runPQWholeCase(ctx, client, p, o.pqGateway, o.pqReadbackOnly)
	report.Phases.InputPreparationNs = inputPreparationNs
	report.Phases.IntentDurabilityNs = intentDurabilityNs
	if o.pqCollectProof && (report.Status == "committed_observed" || report.Status == "registration_observed") {
		collectPQCaseProof(ctx, client, p, o.pqGateway, o.output+".pq-proof.json", &report)
	}
	if pqCaseVerifierSelected(o) && report.ProofCollectionStatus == "collected_unverified" {
		verifyPQCaseCollectedProof(ctx, o, p, &report)
	}
	if err = json.NewEncoder(output).Encode(report); err != nil {
		return err
	}
	if err = output.Sync(); err != nil {
		return err
	}
	if pqCaseVerifierSelected(o) && !report.IndependentFinalityVerified {
		return errors.New("original PQ proof did not verify; retain evidence and do not rebroadcast")
	}
	if report.IndependentFinalityVerified && report.ConsensusExecutionOutcome == "rejected" {
		return errors.New("original transaction finalized with rejected execution; zero effective business, never rebroadcast")
	}
	if o.pqCollectProof && report.ProofCollectionStatus != "collected_unverified" {
		return errors.New("original PQ proof unavailable; retain intent and use readback-only, never rebroadcast")
	}
	if report.Status != "committed_observed" && report.Status != "registration_observed" {
		return errors.New("original PQ outcome remains unknown; use readback-only and retain signed intent")
	}
	return nil
}
