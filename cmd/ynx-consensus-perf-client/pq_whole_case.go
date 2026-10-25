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
}
type pqWholeCaseReport struct {
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
	return o.pqMemberWire != "" || o.pqWholeWire != "" || o.pqGateway != "" || o.pqReadbackOnly
}
func validatePQWholeCaseOptions(o options) error {
	u, e := url.Parse(o.pqGateway)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("PQ case requires an explicit normal gateway base URL")
	}
	if (o.pqWholeWire == "") == (o.pqMemberWire == "") || o.output == "" || o.timeout <= 0 || o.timeout > 30*time.Second {
		return errors.New("PQ case requires exactly one signed Whole or N1 Member, new output and timeout in (0,30s]")
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
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 1<<20 {
		return nil, errors.New("PQ gateway response exceeded bound")
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted && response.StatusCode != http.StatusUnprocessableEntity {
		return nil, fmt.Errorf("PQ gateway HTTP %d", response.StatusCode)
	}
	return raw, nil
}
func (p pqWholeCase) committedResponse(raw []byte) (int, int, uint64, error) {
	if p.kind == consensus.PQTransferType {
		var v bftgateway.PQMemberView
		if err := strictJSON(raw, &v); err != nil {
			return 0, 0, 0, err
		}
		n, e := p.validateMemberCommitted(v)
		return n, 0, v.ExecutionHeight, e
	}
	var v bftgateway.PQWholeView
	if err := strictJSON(raw, &v); err != nil {
		return 0, 0, 0, err
	}
	n, rejected, e := p.validateCommitted(v)
	return n, rejected, v.ExecutionHeight, e
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
	if !readOnly {
		r.SubmissionAttempts = 1
		v, e := pqCaseHTTP(ctx, client, http.MethodPost, strings.TrimRight(gateway, "/")+broadcast, p.wire)
		_, _, _, identityError := p.committedResponse(v)
		r.InitialSubmissionUnknown = e != nil || identityError != nil
	}
	// Always reconcile the original identity. Never rebroadcast after UNKNOWN.
	r.OriginalReadbackAttempts = 1
	v, e := pqCaseHTTP(ctx, client, http.MethodGet, strings.TrimRight(gateway, "/")+readback, nil)
	r.ObservationElapsedNs = time.Since(started).Nanoseconds()
	if e != nil {
		r.Error = e.Error()
		return r
	}
	admitted, rejected, height, e := p.committedResponse(v)
	if e != nil {
		r.Error = e.Error()
		return r
	}
	r.Status = "committed_observed"
	r.EffectiveBusinessIncludedObserved = admitted
	r.RejectedMembers = rejected
	r.ExecutionHeight = height
	return r
}
func executePQWholeCase(o options) (returned error) {
	if err := validatePQWholeCaseOptions(o); err != nil {
		return err
	}
	path, limit := o.pqWholeWire, int64(bftgateway.MaxPQWholeIngressBytes)
	if o.pqMemberWire != "" {
		path = o.pqMemberWire
		limit = bftgateway.MaxPQMemberIngressBytes
	}
	raw, err := readBounded(path, limit)
	if err != nil {
		return err
	}
	var p pqWholeCase
	if o.pqMemberWire != "" {
		p, err = preparePQMemberCase(raw)
	} else {
		p, err = preparePQWholeCase(raw)
	}
	if err != nil {
		return err
	}
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
	signalContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(signalContext, o.timeout)
	defer cancel()
	transport := &http.Transport{DisableKeepAlives: true, MaxConnsPerHost: 1}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	report := runPQWholeCase(ctx, client, p, o.pqGateway, o.pqReadbackOnly)
	if err = json.NewEncoder(output).Encode(report); err != nil {
		return err
	}
	if err = output.Sync(); err != nil {
		return err
	}
	if report.Status != "committed_observed" {
		return errors.New("original PQ outcome remains unknown; use readback-only and retain signed intent")
	}
	return nil
}
