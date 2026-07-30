package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
)

func main() {
	storePath := flag.String("store", "", "path to the accepted economics integration store JSON file")
	sourceCommit := flag.String("source-commit", "", "40-character lowercase source commit accepted by the store")
	generatedAtValue := flag.String("generated-at", "", "RFC3339 timestamp for deterministic local evidence")
	heightValue := flag.String("height", "", "positive local simulated block height")
	nonceValue := flag.String("nonce", "", "positive local simulated transaction nonce")
	outputPath := flag.String("out", "", "path for the 0600 local evidence JSON file")
	summaryOnly := flag.Bool("summary", false, "emit a compact truth-preserving summary")
	flag.Parse()

	if *storePath == "" || *sourceCommit == "" || *generatedAtValue == "" || *heightValue == "" || *nonceValue == "" || *outputPath == "" {
		fail("-store, -source-commit, -generated-at, -height, -nonce, and -out are required")
	}
	generatedAt, err := time.Parse(time.RFC3339Nano, *generatedAtValue)
	if err != nil {
		fail("generated-at must be RFC3339: " + err.Error())
	}
	height, err := strconv.ParseInt(*heightValue, 10, 64)
	if err != nil || height < 1 {
		fail("height must be a positive integer")
	}
	nonce, err := strconv.ParseUint(*nonceValue, 10, 64)
	if err != nil || nonce < 1 {
		fail("nonce must be a positive integer")
	}

	store, err := economics.LoadEconomicsIntegrationStore(*storePath)
	if err != nil {
		fail(err.Error())
	}
	evidence, err := economics.BuildEconomicsLocalTestnetEvidence(store, *sourceCommit, generatedAt.UTC(), height, nonce)
	if err != nil {
		fail(err.Error())
	}
	if err := economics.SaveEconomicsLocalTestnetEvidence(*outputPath, evidence, store); err != nil {
		fail(err.Error())
	}

	if *summaryOnly {
		emit(struct {
			EvidenceClass    string                                     `json:"evidenceClass"`
			SourceCommit     string                                     `json:"sourceCommit"`
			StoreStateHash   string                                     `json:"storeStateHash"`
			AcceptedBundleID string                                     `json:"acceptedBundleId"`
			TransactionID    string                                     `json:"transactionId"`
			BlockHeight      int64                                      `json:"blockHeight"`
			BlockHash        string                                     `json:"blockHash"`
			ReceiptStatus    string                                     `json:"receiptStatus"`
			RecordCounts     economics.EconomicsIntegrationRecordCounts `json:"recordCounts"`
			ExplorerProofs   int                                        `json:"explorerProofs"`
			MonitorProofs    int                                        `json:"monitorProofs"`
			SharedTestnet    bool                                       `json:"sharedTestnet"`
			PublicDeployment bool                                       `json:"publicDeployment"`
			Production       bool                                       `json:"production"`
			EvidenceHash     string                                     `json:"evidenceHash"`
		}{
			EvidenceClass:    evidence.EvidenceClass,
			SourceCommit:     evidence.SourceCommit,
			StoreStateHash:   evidence.StoreStateHash,
			AcceptedBundleID: evidence.AcceptedBundleID,
			TransactionID:    evidence.Transaction.ID,
			BlockHeight:      evidence.Block.Height,
			BlockHash:        evidence.Block.Hash,
			ReceiptStatus:    evidence.Receipt.Status,
			RecordCounts:     evidence.API.RecordCounts,
			ExplorerProofs:   len(evidence.Explorer),
			MonitorProofs:    len(evidence.Monitor),
			SharedTestnet:    evidence.SharedTestnet,
			PublicDeployment: evidence.PublicDeployment,
			Production:       evidence.Production,
			EvidenceHash:     evidence.EvidenceHash,
		})
		return
	}
	emit(evidence)
}

func emit(value any) {
	payload, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(payload))
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(2)
}
