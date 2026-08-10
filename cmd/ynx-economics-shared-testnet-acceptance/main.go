package main

import (
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
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	return runWithClock(args, stdout, stderr, time.Now)
}

func runWithClock(args []string, stdout, stderr io.Writer, now func() time.Time) int {
	flags := flag.NewFlagSet("ynx-economics-shared-testnet-acceptance", flag.ContinueOnError)
	flags.SetOutput(stderr)
	policyPath := flags.String("policy", "", "path to the operator-supplied shared Testnet acceptance policy JSON")
	evidencePath := flags.String("evidence", "", "path to the owner-attested shared Testnet evidence JSON")
	statePath := flags.String("state", "", "path to the 0600 verified acceptance Store JSON")
	restoreFrom := flags.String("restore-from", "", "path to a 0600 acceptance Store backup to restore")
	summaryOnly := flags.Bool("summary", false, "emit a compact truth-preserving summary")
	version := flags.Bool("version", false, "print CLI and schema version metadata")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		return fail(stderr, "positional arguments are not supported")
	}
	if *version {
		if *policyPath != "" || *evidencePath != "" || *statePath != "" || *restoreFrom != "" {
			return fail(stderr, "-version cannot be combined with acceptance or restore inputs")
		}
		return emit(stdout, stderr, struct {
			CLISchemaVersion      int    `json:"cliSchemaVersion"`
			StoreSchemaVersion    int    `json:"storeSchemaVersion"`
			EvidenceSchemaVersion int    `json:"evidenceSchemaVersion"`
			ContractID            string `json:"contractId"`
			ReleaseClass          string `json:"releaseClass"`
			PublicDeployment      bool   `json:"publicDeployment"`
			Production            bool   `json:"production"`
		}{
			CLISchemaVersion:      1,
			StoreSchemaVersion:    economics.EconomicsSharedTestnetAcceptanceStoreSchemaVersion,
			EvidenceSchemaVersion: economics.EconomicsSharedTestnetEvidenceSchemaVersion,
			ContractID:            economics.EconomicsIntegrationContractID,
			ReleaseClass:          "shared-testnet-acceptance-validator",
			PublicDeployment:      false,
			Production:            false,
		})
	}

	if *restoreFrom != "" {
		if *statePath == "" {
			return fail(stderr, "-state is required with -restore-from")
		}
		if *policyPath != "" || *evidencePath != "" {
			return fail(stderr, "-restore-from cannot be combined with -policy or -evidence")
		}
		store, err := economics.RestoreEconomicsSharedTestnetAcceptanceStore(*restoreFrom, *statePath)
		if err != nil {
			return fail(stderr, err.Error())
		}
		return emitStore(stdout, stderr, store, true, *summaryOnly)
	}

	if *policyPath == "" || *evidencePath == "" || *statePath == "" {
		return fail(stderr, "-policy, -evidence, and -state are required")
	}
	if now == nil {
		return fail(stderr, "system clock is unavailable")
	}
	acceptedAt := now().UTC()
	if acceptedAt.IsZero() {
		return fail(stderr, "system clock returned an invalid acceptance time")
	}
	policy, err := economics.LoadEconomicsSharedTestnetAcceptancePolicy(*policyPath)
	if err != nil {
		return fail(stderr, err.Error())
	}
	evidence, err := economics.LoadEconomicsSharedTestnetEvidence(*evidencePath)
	if err != nil {
		return fail(stderr, err.Error())
	}

	var store economics.EconomicsSharedTestnetAcceptanceStore
	if _, err := os.Lstat(*statePath); err == nil {
		store, err = economics.LoadEconomicsSharedTestnetAcceptanceStore(*statePath)
		if err != nil {
			return fail(stderr, err.Error())
		}
	} else if errors.Is(err, os.ErrNotExist) {
		store, err = economics.NewEconomicsSharedTestnetAcceptanceStore(acceptedAt)
		if err != nil {
			return fail(stderr, err.Error())
		}
	} else {
		return fail(stderr, err.Error())
	}

	next, receipt, err := economics.ApplyEconomicsSharedTestnetAcceptance(store, policy, evidence, acceptedAt)
	if err != nil {
		return fail(stderr, err.Error())
	}
	if receipt.Applied {
		if err := economics.SaveEconomicsSharedTestnetAcceptanceStore(*statePath, next); err != nil {
			return fail(stderr, err.Error())
		}
	}
	if !*summaryOnly {
		return emit(stdout, stderr, receipt)
	}
	return emit(stdout, stderr, struct {
		Applied            bool              `json:"applied"`
		Idempotent         bool              `json:"idempotent"`
		Revision           int64             `json:"revision"`
		RecordID           string            `json:"recordId"`
		PolicyHash         string            `json:"policyHash"`
		EvidenceHash       string            `json:"evidenceHash"`
		StoreStateHash     string            `json:"storeStateHash"`
		SourceCommit       string            `json:"sourceCommit"`
		TransactionHash    string            `json:"transactionHash"`
		OwnerSourceCommits map[string]string `json:"ownerSourceCommits"`
		SharedTestnet      bool              `json:"sharedTestnet"`
		PublicDeployment   bool              `json:"publicDeployment"`
		Production         bool              `json:"production"`
	}{
		Applied:            receipt.Applied,
		Idempotent:         receipt.Idempotent,
		Revision:           receipt.Revision,
		RecordID:           receipt.RecordID,
		PolicyHash:         receipt.PolicyHash,
		EvidenceHash:       receipt.EvidenceHash,
		StoreStateHash:     receipt.StoreStateHash,
		SourceCommit:       receipt.Summary.SourceCommit,
		TransactionHash:    receipt.Summary.TransactionHash,
		OwnerSourceCommits: receipt.Summary.OwnerSourceCommits,
		SharedTestnet:      receipt.Summary.SharedTestnet,
		PublicDeployment:   receipt.Summary.PublicDeployment,
		Production:         receipt.Summary.Production,
	})
}

func emitStore(stdout, stderr io.Writer, store economics.EconomicsSharedTestnetAcceptanceStore, restored, summaryOnly bool) int {
	if !summaryOnly {
		return emit(stdout, stderr, store)
	}
	return emit(stdout, stderr, struct {
		Restored       bool   `json:"restored"`
		SchemaVersion  int    `json:"schemaVersion"`
		ContractID     string `json:"contractId"`
		Revision       int64  `json:"revision"`
		AcceptedCount  int    `json:"acceptedCount"`
		StoreStateHash string `json:"storeStateHash"`
	}{
		Restored:       restored,
		SchemaVersion:  store.SchemaVersion,
		ContractID:     store.ContractID,
		Revision:       store.Revision,
		AcceptedCount:  len(store.Accepted),
		StoreStateHash: store.StateHash,
	})
}

func emit(stdout, stderr io.Writer, value any) int {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return fail(stderr, err.Error())
	}
	if _, err := fmt.Fprintln(stdout, string(payload)); err != nil {
		return fail(stderr, err.Error())
	}
	return 0
}

func fail(stderr io.Writer, message string) int {
	_, _ = fmt.Fprintln(stderr, message)
	return 2
}
