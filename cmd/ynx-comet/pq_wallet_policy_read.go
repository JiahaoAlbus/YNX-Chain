package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/spf13/cobra"
)

// This normal operator-only command never enters Comet startup or opens a
// writer. Paths and independent pins are protected backend configuration, not
// renderer request fields. Its JSON is an observation, never a serialized
// sealed result or a replacement for Native/Auth Root qualification.
func newInspectWalletPolicyCommand() *cobra.Command {
	var f inspectOperatorCheckpointFlags
	var owner string
	c := &cobra.Command{
		Use: "inspect-wallet-policy", Short: "Read complete account policy at the actual stopped original engine checkpoint",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			genesis, err := readInitializationInput(f.genesis, 64<<20)
			if err != nil {
				return err
			}
			migration, err := readInitializationMigration(f.migration, 1<<30, nil)
			if err != nil {
				return err
			}
			pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: f.genesisHash, OriginalGenesisHash: f.originalGenesisHash, MigrationStateHash: f.migrationHash}
			bootstrap, err := consensus.NewConsensusBootstrap(genesis, pins, migration)
			if err != nil {
				return err
			}
			engine, err := readInspectionSchedule(f.schedule, f.scheduleHash)
			if err != nil {
				return err
			}
			var runtime *consensus.RuntimeUpgradeAuthorization
			if f.runtimePlan != "" || f.runtimePlanHash != "" {
				if f.runtimePlan == "" || f.runtimePlanHash == "" {
					return errors.New("Wallet policy inspection requires the complete independent runtime plan pair")
				}
				raw, err := readInitializationInput(f.runtimePlan, consensus.MaxRuntimeUpgradePlanBytes)
				if err != nil {
					return err
				}
				runtime, err = consensus.NewRuntimeUpgradeAuthorization(raw, f.runtimePlanHash, bootstrap, migration)
				if err != nil {
					return err
				}
			}
			verified, err := consensus.ReadPQWalletPolicyFromOperatorCheckpoint(migration, genesis, pins, consensus.OperatorCheckpointOptions{StatePath: f.state, StateLayout: f.layout, CometDataDirectory: f.data, SigningStatePath: f.signing, SigningLockKind: f.signingLockKind, Authorization: engine, RuntimeUpgrade: runtime}, owner)
			if err != nil {
				return err
			}
			cp, err := verified.Checkpoint()
			if err != nil {
				return err
			}
			v, err := verified.OwnerPolicy()
			if err != nil {
				return err
			}
			origin, err := verified.Origin()
			if err != nil {
				return err
			}
			out := walletPolicyInspection{Version: "YNX-WALLET-POLICY-CHECKPOINT/v1", Classification: "data", Source: "original-stopped-engine-and-application", ChainID: cp.ChainID, Owner: v.Owner, NetworkID: hex.EncodeToString(v.NetworkID[:]), NativeChainID: strconv.FormatInt(v.NativeChainID, 10), CommittedHeight: strconv.FormatInt(cp.Height, 10), CommittedAppHash: hex.EncodeToString(cp.AppHash[:]), ExecutionHeight: strconv.FormatUint(v.ExecutionHeight, 10), LedgerNonce: strconv.FormatUint(v.LedgerNonce, 10), Policy: json.RawMessage(v.PolicyOriginal), CommittedStatus: v.CommittedAuthorizationStatus, ExecutionStatus: v.AuthorizationStatus, CommittedPQSigningEnabled: v.CommittedPQSigningEnabled, ExecutionPQSigningEnabled: v.PQSigningEnabled, CheckpointOnly: true}
			out.CheckpointOrigin = origin
			return json.NewEncoder(command.OutOrStdout()).Encode(out)
		},
	}
	for _, flag := range []struct {
		name     string
		value    *string
		required bool
	}{
		{"owner", &owner, true}, {"consensus-genesis", &f.genesis, true}, {"migration-state", &f.migration, true}, {"abci-state", &f.state, true}, {"abci-state-layout", &f.layout, true}, {"comet-data-dir", &f.data, true}, {"signing-state", &f.signing, true}, {"signing-lock-kind", &f.signingLockKind, false}, {"consensus-genesis-sha256", &f.genesisHash, true}, {"original-genesis-hash", &f.originalGenesisHash, true}, {"bound-migration-state-hash", &f.migrationHash, true}, {"pq-engine-schedule", &f.schedule, false}, {"pq-engine-schedule-hash", &f.scheduleHash, false}, {"runtime-upgrade-plan", &f.runtimePlan, false}, {"runtime-upgrade-plan-hash", &f.runtimePlanHash, false},
	} {
		c.Flags().Var(&initializationStringFlag{target: flag.value}, flag.name, "original protected operator input; no inferred or peer authority")
		if flag.required {
			if err := c.MarkFlagRequired(flag.name); err != nil {
				panic(err)
			}
		}
	}
	return c
}

type walletPolicyInspection struct {
	CheckpointOrigin            consensus.PQWalletPolicyCheckpointOrigin `json:"checkpointOrigin"`
	IndependentFinalityVerified bool                                     `json:"independentFinalityVerified"`
	Version                     string                                   `json:"version"`
	Classification              string                                   `json:"classification"`
	Source                      string                                   `json:"source"`
	ChainID                     string                                   `json:"chainId"`
	Owner                       string                                   `json:"owner"`
	NetworkID                   string                                   `json:"networkId"`
	NativeChainID               string                                   `json:"nativeChainId"`
	CommittedHeight             string                                   `json:"committedHeight"`
	CommittedAppHash            string                                   `json:"committedAppHash"`
	ExecutionHeight             string                                   `json:"executionHeight"`
	LedgerNonce                 string                                   `json:"ledgerNonce"`
	Policy                      json.RawMessage                          `json:"policy"`
	CommittedStatus             string                                   `json:"committedAuthorizationStatus"`
	ExecutionStatus             string                                   `json:"authorizationStatus"`
	CommittedPQSigningEnabled   bool                                     `json:"committedPQSigningEnabled"`
	ExecutionPQSigningEnabled   bool                                     `json:"pqSigningEnabled"`
	CheckpointOnly              bool                                     `json:"checkpointOnly"`
	NativeGrant                 bool                                     `json:"nativeGrant"`
	LiveCurrentVerified         bool                                     `json:"liveCurrentVerified"`
}
