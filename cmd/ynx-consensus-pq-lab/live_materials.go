//go:build unix

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func runPQLabLiveMaterials(args []string, out io.Writer) error {
	return runPQLabLiveMaterialsDiagnostic(args, out, os.Stderr)
}

func runPQLabLiveMaterialsDiagnostic(args []string, out io.Writer, diagnostic *os.File) error {
	if len(args) == 0 || args[0] != "setup" && args[0] != "request" && args[0] != "result" {
		return errors.New("live-materials requires setup, request or result")
	}
	f := flag.NewFlagSet("ynx-consensus-pq-lab live-materials "+args[0], flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "private independent loopback lab only; no Native/Root grant")
	timings := f.Bool("timings", false, "actual nested callee elapsed stages; no qualification or latency inference")
	var root, planPin, activationPin, policyPath, policyPin, txFile, txHash, nativeHash *string
	var nodeIndex *int
	var maxOps, sequence, num, den *uint64
	var period, drift, timeout *time.Duration
	var observe *bool
	if args[0] == "setup" {
		root = f.String("root", "", "original independent lab root")
		planPin = f.String("plan-sha256", "", "independent original full network plan pin")
		activationPin = f.String("activation-sha256", "", "independent original activation receipt pin")
		nodeIndex = f.Int("node", -1, "actual owning node 0..3")
		maxOps = f.Uint64("max-operations", 0, "explicit fixed operation bound 1..10000")
		period = f.Duration("trusting-period", 0, "explicit approved original-anchor trusting period")
		drift = f.Duration("max-clock-drift", 0, "explicit approved maximum clock drift")
		timeout = f.Duration("capture-timeout", 0, "explicit read-only operation timeout, at most 120s")
		num = f.Uint64("trust-numerator", 0, "approved normal light trust numerator")
		den = f.Uint64("trust-denominator", 0, "approved normal light trust denominator")
	} else {
		policyPath = f.String("policy", "", "original startup policy file")
		policyPin = f.String("policy-sha256", "", "independent startup policy pin")
		sequence = f.Uint64("sequence", 0, "next original serial operation slot")
		if args[0] == "request" {
			observe = f.Bool("observe-stages", false, "bounded closed stage observations on the original regular stderr log; no completion or authority claim")
			txFile = f.String("transaction", "", "original public corpus/sender .abci file")
			txHash = f.String("transaction-sha256", "", "exact original ABCI envelope hash")
			nativeHash = f.String("native-wire-hash", "", "exact original native wire hash without 0x")
		}
	}
	if err := parsePQLabFlags(f, args[1:]); err != nil {
		return err
	}
	if !*synthetic {
		return errors.New("explicit synthetic scope required, never a substitute for original source pins")
	}
	calleeStarted := time.Now()
	var metrics *consensus.PQLabMetrics
	if *timings {
		metrics = &consensus.PQLabMetrics{}
	}
	if observe != nil && *observe {
		var observation *consensus.PQLabLiveRequestObservation
		var err error
		metrics, observation, err = consensus.NewPQLabLiveRequestObservation(diagnostic)
		if err != nil {
			return err
		}
		defer observation.Finish()
		stopSignals := pqLabObserveRequestSignals(observation)
		defer stopSignals()
	}
	var value any
	var err error
	switch args[0] {
	case "setup":
		if *maxOps > consensus.MaxPQLabLiveMaterialOperations {
			return errors.New("operation count exceeds fixed lab bound")
		}
		value, err = consensus.PreparePQLabLiveMaterialsMeasured(consensus.PQLabLiveMaterialsPolicy{Version: consensus.PQLabLiveMaterialsPolicyVersion, RootDir: *root, PlanSHA256: *planPin, ActivationSHA256: *activationPin, NodeIndex: *nodeIndex, MaxOperations: uint32(*maxOps), CaptureTimeout: *timeout, TrustingPeriod: *period, MaxClockDrift: *drift, TrustNumerator: *num, TrustDenominator: *den}, metrics)
	case "request":
		if *sequence == 0 || *sequence > math.MaxUint32 {
			return errors.New("invalid exact operation sequence")
		}
		request := consensus.PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: *policyPin, Sequence: uint32(*sequence), TransactionFile: *txFile, TransactionSHA256: *txHash, NativeWireHash: *nativeHash}
		var path string
		path, err = consensus.PublishPQLabLiveMaterialsRequestMeasured(*policyPath, *policyPin, request, metrics)
		value = struct {
			Version, Outcome, RequestPath   string
			SyntheticOnly, AuthorityGranted bool
		}{"YNX-PQ-LAB-LIVE-MATERIALS-PUBLICATION/v1", "request_published", path, true, false}
	case "result":
		if *sequence == 0 || *sequence > math.MaxUint32 {
			return errors.New("invalid exact operation sequence")
		}
		value, err = consensus.ReadPQLabLiveMaterialsResultMeasured(*policyPath, *policyPin, uint32(*sequence), metrics)
	}
	if err != nil {
		if *timings {
			measured, _ := json.Marshal(struct {
				Version, Outcome string
				CalleeElapsedNS  int64
				Timings          consensus.PQLabMetricsSnapshot
			}{"YNX-PQ-LAB-CALLEE-FAILURE/v1", "REFUSED_OR_UNKNOWN_NO_RETRY", time.Since(calleeStarted).Nanoseconds(), metrics.Snapshot()})
			return fmt.Errorf("%w; elapsed=%s", err, measured)
		}
		return err
	}
	if *timings {
		raw, e := json.Marshal(value)
		if e != nil {
			return e
		}
		var reply map[string]json.RawMessage
		if e = json.Unmarshal(raw, &reply); e != nil {
			return e
		}
		reply["calleeElapsedNs"], e = json.Marshal(time.Since(calleeStarted).Nanoseconds())
		if e != nil {
			return e
		}
		reply["timings"], e = json.Marshal(metrics.Snapshot())
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(reply)
	}
	return json.NewEncoder(out).Encode(value)
}
