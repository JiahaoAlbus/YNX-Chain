package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
)

func main() {
	economicsInputPath := flag.String("economics-input", "", "path to a deterministic economics runtime replay JSON input")
	stakingInputPath := flag.String("staking-input", "", "path to a deterministic staking risk runtime replay JSON input")
	safetyInputPath := flag.String("safety-input", "", "optional path to a deterministic Safety Module runtime replay JSON input")
	sourceCommit := flag.String("source-commit", "", "40-character lowercase source commit represented by this integration bundle")
	summaryOnly := flag.Bool("summary", false, "emit only deterministic integration counts and hashes")
	flag.Parse()
	if *economicsInputPath == "" || *stakingInputPath == "" || *sourceCommit == "" {
		fail("-economics-input, -staking-input, and -source-commit are required")
	}

	var economicInput economics.RuntimeReplayInput
	decodeFile(*economicsInputPath, &economicInput)
	economicState, err := economics.ReplayEconomicRuntime(economicInput)
	if err != nil {
		fail(err.Error())
	}

	var stakingInput economics.StakingRiskReplayInput
	decodeFile(*stakingInputPath, &stakingInput)
	stakingState, err := economics.ReplayStakingRiskRuntime(stakingInput)
	if err != nil {
		fail(err.Error())
	}

	var safetyState *economics.SafetyModuleRuntimeState
	if *safetyInputPath != "" {
		var safetyInput economics.SafetyModuleRuntimeReplayInput
		decodeFile(*safetyInputPath, &safetyInput)
		replayed, replayErr := economics.ReplaySafetyModuleRuntime(safetyInput)
		if replayErr != nil {
			fail(replayErr.Error())
		}
		safetyState = &replayed
	}

	bundle, err := economics.BuildEconomicsIntegrationBundleWithSafety(*sourceCommit, economicState, stakingState, safetyState)
	if err != nil {
		fail(err.Error())
	}
	if err := economics.ValidateEconomicsIntegrationBundle(bundle); err != nil {
		fail(err.Error())
	}
	if *summaryOnly {
		summary := struct {
			ContractID        string                             `json:"contractId"`
			SourceCommit      string                             `json:"sourceCommit"`
			EconomicStateHash string                             `json:"economicStateHash"`
			StakingStateHash  string                             `json:"stakingStateHash"`
			SafetyStateHash   string                             `json:"safetyStateHash,omitempty"`
			EnvelopeCount     int                                `json:"envelopeCount"`
			BillingCount      int                                `json:"billingCount"`
			ExplorerCount     int                                `json:"explorerCount"`
			MonitorCount      int                                `json:"monitorCount"`
			ReleaseStates     economics.IntegrationReleaseStates `json:"releaseStates"`
			BundleHash        string                             `json:"bundleHash"`
		}{
			ContractID:        bundle.ContractID,
			SourceCommit:      bundle.SourceCommit,
			EconomicStateHash: bundle.EconomicStateHash,
			StakingStateHash:  bundle.StakingStateHash,
			SafetyStateHash:   bundle.SafetyStateHash,
			EnvelopeCount:     len(bundle.Envelopes),
			BillingCount:      len(bundle.BillingLedger),
			ExplorerCount:     len(bundle.Explorer),
			MonitorCount:      len(bundle.Monitor),
			ReleaseStates:     bundle.ReleaseStates,
			BundleHash:        bundle.BundleHash,
		}
		encoded, err := json.MarshalIndent(summary, "", "  ")
		if err != nil {
			fail(err.Error())
		}
		fmt.Println(string(encoded))
		return
	}
	encoded, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func decodeFile(path string, output any) {
	payload, err := os.ReadFile(path)
	if err != nil {
		fail(err.Error())
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		fail("decode input: " + err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		fail("input must contain exactly one JSON value")
	}
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(2)
}
