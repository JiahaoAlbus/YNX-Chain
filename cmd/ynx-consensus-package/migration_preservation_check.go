package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"sort"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxauth"
	abci "github.com/cometbft/cometbft/abci/types"
)

const migrationPreservationVersion = "YNX-MIGRATION-PRESERVATION-CHECK/v1"

// This receipt describes an uninitialized, memory-only Application import.
// Original source authority gaps remain visible; no bootstrap, InitChain,
// persistence, transaction execution or consensus identity is supplied here.
type migrationPreservationResult struct {
	Version               string                             `json:"version"`
	Classification        string                             `json:"classification"`
	Scope                 string                             `json:"scope"`
	SourceSHA256          string                             `json:"sourceSHA256"`
	SourceBytes           string                             `json:"sourceBytes"`
	Height                string                             `json:"height"`
	LastBlockHash         string                             `json:"lastBlockHash"`
	StateHash             string                             `json:"stateHash"`
	ApplicationImport     string                             `json:"applicationImport"`
	InfoInitialized       bool                               `json:"infoInitialized"`
	AccountsChecked       string                             `json:"accountsChecked"`
	ContractsChecked      string                             `json:"contractsChecked"`
	HistoryBlocksChecked  string                             `json:"historyBlocksChecked"`
	HistoryTxsChecked     string                             `json:"historyTransactionsChecked"`
	AccountPolicyChecked  bool                               `json:"accountPolicyChecked"`
	PersistedColdRestore  string                             `json:"persistedColdRestore"`
	ValidatorBinding      string                             `json:"validatorBinding"`
	ExecutionCapabilities string                             `json:"executionCapabilities"`
	Blockers              []consensus.MigrationModuleBlocker `json:"blockers"`
	Deployment            string                             `json:"deployment"`
	InitChain             string                             `json:"initChain"`
	PQActivation          string                             `json:"pqActivation"`
}

type migrationPreservationReader interface {
	Info(context.Context, *abci.RequestInfo) (*abci.ResponseInfo, error)
	Query(context.Context, *abci.RequestQuery) (*abci.ResponseQuery, error)
}

// No state path or output path is ever passed to the normal constructor.
func verifyMigrationPreservation(path string, output io.Writer) error {
	encoded, err := withVerifiedMigrationInput(path, func(migration chain.ConsensusMigrationState, sourceSHA256, sourceBytes string) ([]byte, error) {
		application, err := consensus.NewPersistentApplication(migration, "")
		if err != nil {
			return nil, fmt.Errorf("unbound application import: %w", err)
		}
		result, err := checkMigrationPreservationApplication(migration, application)
		if err != nil {
			return nil, err
		}
		result.SourceSHA256, result.SourceBytes = sourceSHA256, sourceBytes
		encoded, err := json.Marshal(result)
		if err != nil || len(encoded)+1 > 64<<10 {
			return nil, errors.New("migration preservation result exceeds its bounded public receipt")
		}
		return encoded, nil
	})
	if err != nil {
		return err
	}
	return writeMigrationCheckOutput(output, encoded)
}

func checkMigrationPreservationApplication(migration chain.ConsensusMigrationState, application migrationPreservationReader) (migrationPreservationResult, error) {
	var result migrationPreservationResult
	if migration.Runtime == nil {
		return result, errors.New("application preservation requires complete original runtime history")
	}
	ctx := context.Background()
	info, err := application.Info(ctx, &abci.RequestInfo{})
	if err != nil || info == nil || info.Data != consensus.ApplicationName || info.LastBlockHeight != 0 || len(info.LastBlockAppHash) != 0 {
		return result, errors.New("unbound application Info must remain uninitialized with no committed Comet height or AppHash")
	}
	query := func(path string, target any) error {
		response, err := application.Query(ctx, &abci.RequestQuery{Path: path})
		if err != nil {
			return fmt.Errorf("application preservation query failed: %w", err)
		}
		if response == nil || response.Code != 0 || response.Height != int64(migration.Height) {
			return errors.New("application preservation query rejected or changed the original migration height")
		}
		if err := json.Unmarshal(response.Value, target); err != nil {
			return fmt.Errorf("decode application preservation query: %w", err)
		}
		return nil
	}
	for _, original := range migration.Accounts {
		var actual chain.ConsensusAccount
		if err := query("/accounts/"+original.Address, &actual); err != nil {
			return result, err
		}
		// Typed uint64 nonce and int64 balances, not float64 JSON projection.
		if !reflect.DeepEqual(actual, original) {
			return result, errors.New("imported account differs from complete original balance/nonce/resource/lot state")
		}
	}
	addresses := make([]string, 0, len(migration.Runtime.Contracts))
	for address := range migration.Runtime.Contracts {
		addresses = append(addresses, address)
	}
	sort.Strings(addresses)
	for _, address := range addresses {
		var actual struct {
			chain.ContractArtifact
			SourceAnchor string `json:"sourceAnchor"`
		}
		if err := query("/ide/source/"+address, &actual); err != nil {
			return result, err
		}
		if actual.SourceAnchor != migration.StateHash || !reflect.DeepEqual(actual.ContractArtifact, migration.Runtime.Contracts[address]) {
			return result, errors.New("imported original contract or source anchor differs")
		}
	}
	anchor := consensus.MigrationHistoryAnchor{Version: consensus.MigrationHistoryVersion, Source: "source_import", SourceAnchor: migration.StateHash,
		OriginalGenesisHash: migration.OriginalGenesisHash, MigrationBlockHash: migration.LastBlockHash, NativeChainID: migration.Network.ChainID, MigrationHeight: migration.Height}
	var transactions uint64
	for _, original := range migration.Runtime.Blocks {
		var actual consensus.MigrationHistoryBlockView
		if err := query(consensus.MigrationHistoryBlockPath+strconv.FormatUint(original.Height, 10), &actual); err != nil {
			return result, err
		}
		if actual.MigrationHistoryAnchor != anchor || !actual.Found || actual.Block == nil || !reflect.DeepEqual(*actual.Block, original) {
			return result, errors.New("imported original history block/transactions/logs or source anchor differs")
		}
		transactions += uint64(len(original.Transactions))
	}
	var policy *ynxauth.State
	if err := query("/account-policy", &policy); err != nil {
		return result, err
	}
	if !reflect.DeepEqual(policy, migration.AccountPolicy) {
		return result, errors.New("imported account authorization policy differs from original migration")
	}
	var registry json.RawMessage
	if err := query("/validator-registry", &registry); err != nil {
		return result, err
	}
	if !bytes.Equal(bytes.TrimSpace(registry), []byte("null")) {
		return result, errors.New("unbound application import unexpectedly supplied validator registry authority")
	}
	var blockers []consensus.MigrationModuleBlocker
	if err := query("/migration/compatibility", &blockers); err != nil {
		return result, err
	}
	if !reflect.DeepEqual(blockers, consensus.MigrationExecutionBlockers(migration)) {
		return result, errors.New("application import changed unresolved migration execution capabilities")
	}
	capabilities := "unresolved"
	if len(blockers) == 0 {
		capabilities = "no-listed-blockers"
		blockers = []consensus.MigrationModuleBlocker{}
	}
	return migrationPreservationResult{Version: migrationPreservationVersion, Classification: "data", Scope: "unbound-application-import",
		Height: strconv.FormatUint(migration.Height, 10), LastBlockHash: migration.LastBlockHash, StateHash: migration.StateHash,
		ApplicationImport: "verified", InfoInitialized: false, AccountsChecked: strconv.Itoa(len(migration.Accounts)), ContractsChecked: strconv.Itoa(len(addresses)),
		HistoryBlocksChecked: strconv.Itoa(len(migration.Runtime.Blocks)), HistoryTxsChecked: strconv.FormatUint(transactions, 10), AccountPolicyChecked: true,
		PersistedColdRestore: "unchecked", ValidatorBinding: "unchecked", ExecutionCapabilities: capabilities, Blockers: blockers,
		Deployment: "not-performed", InitChain: "not-performed", PQActivation: "not-performed"}, nil
}
