package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

type inspectOperatorCheckpointFlags struct {
	genesis, migration, state, layout, data, signing       string
	genesisHash, originalGenesisHash, migrationHash        string
	schedule, scheduleHash, nextSchedule, nextScheduleHash string
	runtimePlan, runtimePlanHash                           string
	backupOutput                                           string
	backupLegacyKey, backupNodeKey, signingLockKind        string
	proposeActivationHeight                                string
	legacyStakingOwner                                     string
}

func newInspectOperatorCheckpointCommand() *cobra.Command {
	var options inspectOperatorCheckpointFlags
	command := &cobra.Command{
		Use: "inspect-operator-checkpoint", Short: "Read the actual stopped original Comet/application checkpoint without writes",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		// Never inherit Comet ParseConfig/EnsureRoot, a node constructor or a
		// genesis fallback. Every existing path and independent pin is explicit.
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			var proposedHeight int64
			if options.proposeActivationHeight != "" {
				var err error
				proposedHeight, err = strconv.ParseInt(options.proposeActivationHeight, 10, 64)
				if err != nil || proposedHeight <= 0 || strconv.FormatInt(proposedHeight, 10) != options.proposeActivationHeight {
					return errors.New("proposal activation height must be one canonical positive int64 decimal")
				}
			}
			genesis, err := readInitializationInput(options.genesis, 64<<20)
			if err != nil {
				return err
			}
			migrationRaw, err := readInitializationInput(options.migration, 1<<30)
			if err != nil {
				return err
			}
			var compact bytes.Buffer
			if err := json.Compact(&compact, migrationRaw); err != nil {
				return err
			}
			var migration chain.ConsensusMigrationState
			if err := decodeStrict(compact.Bytes(), &migration); err != nil {
				return err
			}
			pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: options.genesisHash, OriginalGenesisHash: options.originalGenesisHash, MigrationStateHash: options.migrationHash}
			bootstrap, err := consensus.NewConsensusBootstrap(genesis, pins, migration)
			if err != nil {
				return err
			}
			authorization, err := readInspectionSchedule(options.schedule, options.scheduleHash)
			if err != nil {
				return err
			}
			next, err := readInspectionSchedule(options.nextSchedule, options.nextScheduleHash)
			if err != nil {
				return err
			}
			var runtime *consensus.RuntimeUpgradeAuthorization
			if options.runtimePlan != "" || options.runtimePlanHash != "" {
				if options.runtimePlan == "" || options.runtimePlanHash == "" {
					return errors.New("runtime inspection requires the complete independently pinned plan pair")
				}
				raw, err := readInitializationInput(options.runtimePlan, consensus.MaxRuntimeUpgradePlanBytes)
				if err != nil {
					return err
				}
				runtime, err = consensus.NewRuntimeUpgradeAuthorization(raw, options.runtimePlanHash, bootstrap, migration)
				if err != nil {
					return err
				}
			}
			result, err := consensus.InspectOperatorCheckpoint(migration, genesis, pins, consensus.OperatorCheckpointOptions{StatePath: options.state, StateLayout: options.layout, CometDataDirectory: options.data, SigningStatePath: options.signing, SigningLockKind: options.signingLockKind, Authorization: authorization, NextAuthorization: next, RuntimeUpgrade: runtime, BackupOutput: options.backupOutput, BackupLegacyKeyPath: options.backupLegacyKey, BackupNodeKeyPath: options.backupNodeKey, ProposePQActivationHeight: proposedHeight, LegacyStakingOwner: options.legacyStakingOwner})
			if err != nil {
				return err
			}
			return json.NewEncoder(command.OutOrStdout()).Encode(result)
		},
	}
	for _, flag := range []struct {
		name, help string
		value      *string
		required   bool
	}{
		{"consensus-genesis", "exact existing original Comet genesis", &options.genesis, true},
		{"migration-state", "complete original bound migration", &options.migration, true},
		{"abci-state", "original committed application file", &options.state, true},
		{"abci-state-layout", "explicit original atomic-json, snapshot-journal or block-journal", &options.layout, true},
		{"comet-data-dir", "original stopped Comet data directory containing existing state.db", &options.data, true},
		{"signing-state", "original signing-state path whose existing writer lock must be idle; no body is read", &options.signing, true},
		{"signing-lock-kind", "original legacy-writer (default) or pq-signer lock suffix; never substitute legacy HRS for PQ signer state", &options.signingLockKind, false},
		{"consensus-genesis-sha256", "independent exact original Comet genesis hash", &options.genesisHash, true},
		{"original-genesis-hash", "independent original native genesis hash", &options.originalGenesisHash, true},
		{"bound-migration-state-hash", "independent complete migration hash", &options.migrationHash, true},
		{"pq-engine-schedule", "current independently pinned schedule; omit for unscheduled original checkpoint", &options.schedule, false},
		{"pq-engine-schedule-hash", "independent current schedule hash", &options.scheduleHash, false},
		{"next-pq-engine-schedule", "optional independently pinned candidate; cannot supply the actual checkpoint", &options.nextSchedule, false},
		{"next-pq-engine-schedule-hash", "independent next schedule hash", &options.nextScheduleHash, false},
		{"runtime-upgrade-plan", "original historical runtime plan", &options.runtimePlan, false},
		{"runtime-upgrade-plan-hash", "independent historical runtime plan hash", &options.runtimePlanHash, false},
		{"backup-output", "optional exclusive private retained archive while the original writer and DB locks remain held", &options.backupOutput, false},
		{"backup-legacy-key", "backup-only exact original legacy key path from the old independent plan; no private body is logged", &options.backupLegacyKey, false},
		{"backup-node-key", "backup-only exact original P2P key path from the old independent plan; no private body is logged", &options.backupNodeKey, false},
		{"propose-pq-activation-height", "optional canonical positive activation height for a candidate derived from this actual unscheduled four-member checkpoint; grants no authorization", &options.proposeActivationHeight, false},
		{"legacy-staking-owner", "optional exact owner whose successful original classic staking transactions are read from the same stopped checkpoint and block store; public evidence only", &options.legacyStakingOwner, false},
	} {
		command.Flags().Var(&initializationStringFlag{target: flag.value}, flag.name, flag.help)
		if flag.required {
			if err := command.MarkFlagRequired(flag.name); err != nil {
				panic(err)
			}
		}
	}
	return command
}

func readInspectionSchedule(path, pin string) (*consensus.PQEngineAuthorization, error) {
	if path == "" && pin == "" {
		return nil, nil
	}
	if path == "" || pin == "" {
		return nil, errors.New("schedule inspection requires both original public material and its independent hash")
	}
	raw, err := readInitializationInput(path, 32<<10)
	if err != nil {
		return nil, err
	}
	return consensus.NewPQEngineAuthorization(raw, pin)
}
