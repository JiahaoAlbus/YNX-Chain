package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
)

const migrationSchedulePreservationVersion = "YNX-MIGRATION-PQ-SCHEDULE-PRESERVATION/v1"

// This is a comparison of two complete source exports. It does not start a
// runtime, authorize a validator, establish durability or grant activation.
type migrationSchedulePreservationResult struct {
	Version             string `json:"version"`
	Classification      string `json:"classification"`
	Scope               string `json:"scope"`
	BeforeSHA256        string `json:"beforeSHA256"`
	BeforeBytes         string `json:"beforeBytes"`
	AfterSHA256         string `json:"afterSHA256"`
	AfterBytes          string `json:"afterBytes"`
	Height              string `json:"height"`
	LastBlockHash       string `json:"lastBlockHash"`
	OriginalGenesisHash string `json:"originalGenesisHash"`
	EnableAt            string `json:"enableAt"`
	BeforeStateHash     string `json:"beforeStateHash"`
	AfterStateHash      string `json:"afterStateHash"`
	Preservation        string `json:"preservation"`
	ValidatorBinding    string `json:"validatorBinding"`
	Deployment          string `json:"deployment"`
	PQActivation        string `json:"pqActivation"`
}

func parseMigrationScheduleHeight(text string) (uint64, error) {
	height, err := strconv.ParseUint(text, 10, 64)
	if err != nil || height == 0 || strconv.FormatUint(height, 10) != text {
		return 0, errors.New("PQ schedule preservation requires an explicit positive canonical decimal -pq-admission-height")
	}
	return height, nil
}

func verifyMigrationSchedulePreservation(beforePath, afterPath, heightText string, output io.Writer) error {
	height, err := parseMigrationScheduleHeight(heightText)
	if err != nil {
		return err
	}
	// Keep the original before FD held while reading and comparing the entire
	// after document. Both normal readers check complete SHA256, bounded typed
	// decoding and original path/FD identity through their inspection callback.
	encoded, err := withVerifiedMigrationInput(beforePath, func(before chain.ConsensusMigrationState, beforeSHA, beforeBytes string) ([]byte, error) {
		return withVerifiedMigrationInput(afterPath, func(after chain.ConsensusMigrationState, afterSHA, afterBytes string) ([]byte, error) {
			if err := chain.VerifyConsensusPQSchedulePreservation(before, after, height); err != nil {
				return nil, fmt.Errorf("PQ schedule preservation: %w", err)
			}
			result := migrationSchedulePreservationResult{
				Version: migrationSchedulePreservationVersion, Classification: "data", Scope: "isolated-pq-schedule-comparison",
				BeforeSHA256: beforeSHA, BeforeBytes: beforeBytes, AfterSHA256: afterSHA, AfterBytes: afterBytes,
				Height: strconv.FormatUint(before.Height, 10), LastBlockHash: before.LastBlockHash,
				OriginalGenesisHash: before.OriginalGenesisHash, EnableAt: heightText,
				BeforeStateHash: before.StateHash, AfterStateHash: after.StateHash, Preservation: "verified",
				ValidatorBinding: "unchecked", Deployment: "not-performed", PQActivation: "not-performed",
			}
			encoded, err := json.Marshal(result)
			if err != nil {
				return nil, err
			}
			if len(encoded)+1 > 4096 {
				return nil, errors.New("PQ schedule preservation receipt exceeds its fixed output bound")
			}
			return encoded, nil
		})
	})
	if err != nil {
		return err
	}
	return writeMigrationCheckOutput(output, encoded)
}
