//go:build unix

package main

import (
	"encoding/json"
	"errors"
	"flag"
	"io"
	"math"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func runPQLabLiveMaterials(args []string, out io.Writer) error {
	if len(args) == 0 || args[0] != "setup" && args[0] != "request" && args[0] != "result" {
		return errors.New("live-materials requires setup, request or result")
	}
	f := flag.NewFlagSet("ynx-consensus-pq-lab live-materials "+args[0], flag.ContinueOnError)
	f.SetOutput(io.Discard)
	synthetic := f.Bool("synthetic", false, "private independent loopback lab only; no Native/Root grant")
	var root, planPin, activationPin, policyPath, policyPin, txFile, txHash, nativeHash *string
	var nodeIndex *int
	var maxOps, sequence, num, den *uint64
	var period, drift, timeout *time.Duration
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
	var value any
	var err error
	switch args[0] {
	case "setup":
		if *maxOps > consensus.MaxPQLabLiveMaterialOperations {
			return errors.New("operation count exceeds fixed lab bound")
		}
		value, err = consensus.PreparePQLabLiveMaterials(consensus.PQLabLiveMaterialsPolicy{Version: consensus.PQLabLiveMaterialsPolicyVersion, RootDir: *root, PlanSHA256: *planPin, ActivationSHA256: *activationPin, NodeIndex: *nodeIndex, MaxOperations: uint32(*maxOps), CaptureTimeout: *timeout, TrustingPeriod: *period, MaxClockDrift: *drift, TrustNumerator: *num, TrustDenominator: *den})
	case "request":
		if *sequence == 0 || *sequence > math.MaxUint32 {
			return errors.New("invalid exact operation sequence")
		}
		request := consensus.PQLabLiveMaterialsRequest{Version: "YNX-PQ-LAB-LIVE-MATERIALS-REQUEST/v1", PolicySHA256: *policyPin, Sequence: uint32(*sequence), TransactionFile: *txFile, TransactionSHA256: *txHash, NativeWireHash: *nativeHash}
		var path string
		path, err = consensus.PublishPQLabLiveMaterialsRequest(*policyPath, *policyPin, request)
		value = struct {
			Version, Outcome, RequestPath   string
			SyntheticOnly, AuthorityGranted bool
		}{"YNX-PQ-LAB-LIVE-MATERIALS-PUBLICATION/v1", "request_published", path, true, false}
	case "result":
		if *sequence == 0 || *sequence > math.MaxUint32 {
			return errors.New("invalid exact operation sequence")
		}
		value, err = consensus.ReadPQLabLiveMaterialsResult(*policyPath, *policyPin, uint32(*sequence))
	}
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(value)
}
