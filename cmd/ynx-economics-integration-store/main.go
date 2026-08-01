package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
)

func main() {
	statePath := flag.String("state", "", "path to the local economics integration store JSON file")
	economicsInputPath := flag.String("economics-input", "", "path to a deterministic economics runtime replay JSON input")
	stakingInputPath := flag.String("staking-input", "", "path to a deterministic staking risk runtime replay JSON input")
	safetyInputPath := flag.String("safety-input", "", "optional path to a deterministic Safety Module runtime replay JSON input")
	sourceCommit := flag.String("source-commit", "", "40-character lowercase source commit represented by this integration bundle")
	ingestedAtValue := flag.String("ingested-at", "", "RFC3339 timestamp for deterministic local ingestion")
	createdAtValue := flag.String("created-at", "", "optional RFC3339 creation timestamp for a new store; defaults to bundle generatedAt")
	summaryOnly := flag.Bool("summary", false, "emit a compact deterministic ingest and store summary")
	flag.Parse()

	if *statePath == "" || *economicsInputPath == "" || *stakingInputPath == "" || *sourceCommit == "" || *ingestedAtValue == "" {
		fail("-state, -economics-input, -staking-input, -source-commit, and -ingested-at are required")
	}
	ingestedAt := parseTime("ingested-at", *ingestedAtValue)

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

	store, existed := loadOrCreateStore(*statePath, *createdAtValue, bundle.GeneratedAt)
	next, receipt, err := economics.ApplyEconomicsIntegrationBundle(store, bundle, ingestedAt)
	if err != nil {
		fail(err.Error())
	}
	if receipt.Applied || !existed {
		if err := economics.SaveEconomicsIntegrationStore(*statePath, next); err != nil {
			fail(err.Error())
		}
	}

	if *summaryOnly {
		summary := struct {
			ContractID       string                                     `json:"contractId"`
			SourceCommit     string                                     `json:"sourceCommit"`
			BundleHash       string                                     `json:"bundleHash"`
			SafetyStateHash  string                                     `json:"safetyStateHash,omitempty"`
			Applied          bool                                       `json:"applied"`
			Idempotent       bool                                       `json:"idempotent"`
			Revision         int64                                      `json:"revision"`
			AcceptedBundles  int                                        `json:"acceptedBundles"`
			RecordCounts     economics.EconomicsIntegrationRecordCounts `json:"recordCounts"`
			StoreStateHash   string                                     `json:"storeStateHash"`
			ReceiptAuditHash string                                     `json:"receiptAuditHash"`
		}{
			ContractID:      next.ContractID,
			SourceCommit:    receipt.SourceCommit,
			BundleHash:      receipt.BundleHash,
			SafetyStateHash: bundle.SafetyStateHash,
			Applied:         receipt.Applied,
			Idempotent:      receipt.Idempotent,
			Revision:        next.Revision,
			AcceptedBundles: len(next.AcceptedBundles),
			RecordCounts: economics.EconomicsIntegrationRecordCounts{
				Envelopes:     len(next.Envelopes),
				BillingLedger: len(next.BillingLedger),
				Explorer:      len(next.Explorer),
				Monitor:       len(next.Monitor),
			},
			StoreStateHash:   next.StateHash,
			ReceiptAuditHash: receipt.AuditHash,
		}
		emit(summary)
		return
	}
	emit(struct {
		Receipt economics.EconomicsIntegrationIngestReceipt `json:"receipt"`
		Store   economics.EconomicsIntegrationStore         `json:"store"`
	}{Receipt: receipt, Store: next})
}

func loadOrCreateStore(path, createdAtValue string, fallback time.Time) (economics.EconomicsIntegrationStore, bool) {
	info, err := os.Lstat(path)
	if err == nil {
		if info.Mode()&os.ModeSymlink != 0 {
			fail("integration store path must not be a symlink")
		}
		store, err := economics.LoadEconomicsIntegrationStore(path)
		if err != nil {
			fail(err.Error())
		}
		return store, true
	}
	if !errors.Is(err, os.ErrNotExist) {
		fail(err.Error())
	}
	createdAt := fallback.UTC()
	if createdAtValue != "" {
		createdAt = parseTime("created-at", createdAtValue)
	}
	store, err := economics.NewEconomicsIntegrationStore(createdAt)
	if err != nil {
		fail(err.Error())
	}
	return store, false
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

func parseTime(name, value string) time.Time {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		fail(fmt.Sprintf("%s must be RFC3339: %v", name, err))
	}
	return parsed.UTC()
}

func emit(value any) {
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(2)
}
