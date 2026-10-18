//go:build unix

package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"github.com/spf13/cobra"
)

type inspectProofHostTargetFlags struct {
	source                                                                      inspectOperatorCheckpointFlags
	account, transactionType, envelope, nativeWire, transactionHash, nativeHash string
	height, index, engineHeight, engineHash, trustedHeight, trustedHash         string
	period, drift, numerator, denominator                                       string
}

func proofTargetDecimal(s, name string, allowZero bool) (int64, error) {
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil || v < 0 || !allowZero && v == 0 || strconv.FormatInt(v, 10) != s {
		return 0, fmt.Errorf("%s requires an explicit canonical decimal", name)
	}
	return v, nil
}

func proofTargetHash(s, name string) ([]byte, error) {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 || hex.EncodeToString(b) != s || bytes.Equal(b, make([]byte, 32)) {
		return nil, fmt.Errorf("%s requires an independent nonzero lowercase 32-byte hash without prefix", name)
	}
	return b, nil
}

// This command produces observation DATA for an owner to pin in the existing
// complete SourcePlan. It does not accept a partial plan, proof RPC, a clock,
// an output grant, a signing key or a substitute application checkpoint.
func newInspectProofHostTargetCommand() *cobra.Command {
	var f inspectProofHostTargetFlags
	command := &cobra.Command{
		Use: "inspect-proof-host-target", Short: "Read an original stopped transaction target and successor for an independently pinned proof plan",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			target, err := f.target()
			if err != nil {
				return err
			}
			if (f.source.runtimePlan == "") != (f.source.runtimePlanHash == "") {
				return errors.New("runtime inspection requires the complete independently pinned plan pair")
			}
			target.Envelope, err = readInitializationInput(f.envelope, consensus.MaxPQContractTransactionBytes)
			if err != nil {
				return err
			}
			target.NativeWire, err = readInitializationInput(f.nativeWire, chain.MaxPQBatchBytes)
			if err != nil {
				return err
			}
			genesis, err := readInitializationInput(f.source.genesis, 64<<20)
			if err != nil {
				return err
			}
			migrationRaw, err := readInitializationInput(f.source.migration, 1<<30)
			if err != nil {
				return err
			}
			var compact bytes.Buffer
			if err = json.Compact(&compact, migrationRaw); err != nil {
				return err
			}
			var migration chain.ConsensusMigrationState
			if err = decodeStrict(compact.Bytes(), &migration); err != nil {
				return err
			}
			pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: f.source.genesisHash, OriginalGenesisHash: f.source.originalGenesisHash, MigrationStateHash: f.source.migrationHash}
			bootstrap, err := consensus.NewConsensusBootstrap(genesis, pins, migration)
			if err != nil {
				return err
			}
			authorization, err := readInspectionSchedule(f.source.schedule, f.source.scheduleHash)
			if err != nil {
				return err
			}
			if authorization == nil {
				return errors.New("proof target requires an independently pinned current PQ schedule")
			}
			var runtime *consensus.RuntimeUpgradeAuthorization
			if f.source.runtimePlan != "" {
				raw, err := readInitializationInput(f.source.runtimePlan, consensus.MaxRuntimeUpgradePlanBytes)
				if err != nil {
					return err
				}
				runtime, err = consensus.NewRuntimeUpgradeAuthorization(raw, f.source.runtimePlanHash, bootstrap, migration)
				if err != nil {
					return err
				}
			}
			result, err := consensus.InspectStoppedProofHostTarget(migration, genesis, pins, consensus.OperatorCheckpointOptions{StatePath: f.source.state, StateLayout: f.source.layout, CometDataDirectory: f.source.data, SigningStatePath: f.source.signing, SigningLockKind: f.source.signingLockKind, Authorization: authorization, RuntimeUpgrade: runtime}, target, time.Now().UTC())
			if err != nil {
				return err
			}
			return json.NewEncoder(command.OutOrStdout()).Encode(result)
		},
	}
	for _, flag := range []struct {
		name, help string
		value      *string
		optional   bool
	}{
		{"consensus-genesis", "existing exact original Comet genesis", &f.source.genesis, false},
		{"migration-state", "existing full original bound migration", &f.source.migration, false},
		{"abci-state", "original stopped application checkpoint", &f.source.state, false},
		{"abci-state-layout", "explicit atomic-json, snapshot-journal or block-journal", &f.source.layout, false},
		{"comet-data-dir", "original stopped state.db and blockstore.db directory", &f.source.data, false},
		{"signing-state", "original PQ HRS identity; body is never read", &f.source.signing, false},
		{"signing-lock-kind", "must be pq-signer", &f.source.signingLockKind, false},
		{"consensus-genesis-sha256", "independent raw Comet genesis SHA256", &f.source.genesisHash, false},
		{"original-genesis-hash", "independent original full native genesis hash", &f.source.originalGenesisHash, false},
		{"bound-migration-state-hash", "independent full migration hash", &f.source.migrationHash, false},
		{"pq-engine-schedule", "existing independent current schedule", &f.source.schedule, false},
		{"pq-engine-schedule-hash", "independent current schedule hash", &f.source.scheduleHash, false},
		{"runtime-upgrade-plan", "optional historical runtime plan", &f.source.runtimePlan, true},
		{"runtime-upgrade-plan-hash", "independent historical runtime plan hash", &f.source.runtimePlanHash, true},
		{"account", "canonical original operation owner", &f.account, false},
		{"transaction-type", "original supported PQ outer transaction type", &f.transactionType, false},
		{"envelope", "existing exact retained canonical ABCI transaction bytes", &f.envelope, false},
		{"native-wire", "existing exact retained native original bytes", &f.nativeWire, false},
		{"transaction-hash", "independent SHA256 of the exact envelope, without 0x", &f.transactionHash, false},
		{"native-wire-hash", "independent SHA256 of the exact native wire, without 0x", &f.nativeHash, false},
		{"lookup-height", "positive candidate location; never supplies trust", &f.height, false},
		{"lookup-index", "zero-based candidate Comet transaction index", &f.index, false},
		{"engine-height", "independent exact stopped checkpoint height", &f.engineHeight, false},
		{"engine-app-hash", "independent exact stopped checkpoint AppHash", &f.engineHash, false},
		{"trusted-height", "independent previously trusted light block height", &f.trustedHeight, false},
		{"trusted-block-hash", "independent previously trusted light block hash", &f.trustedHash, false},
		{"trusting-period-nanoseconds", "explicit approved trust period", &f.period, false},
		{"max-clock-drift-nanoseconds", "explicit approved maximum clock drift", &f.drift, false},
		{"trust-level-numerator", "explicit approved trust fraction numerator", &f.numerator, false},
		{"trust-level-denominator", "explicit approved trust fraction denominator", &f.denominator, false},
	} {
		command.Flags().Var(&initializationStringFlag{target: flag.value}, flag.name, flag.help)
		if !flag.optional {
			if err := command.MarkFlagRequired(flag.name); err != nil {
				panic(err)
			}
		}
	}
	return command
}

func (f inspectProofHostTargetFlags) target() (consensus.ProofHostTargetInput, error) {
	t := consensus.ProofHostTargetInput{Account: f.account, TransactionType: f.transactionType}
	for _, item := range []struct {
		raw, name string
		out       *int64
		zero      bool
	}{
		{f.height, "lookup-height", &t.Height, false}, {f.index, "lookup-index", &t.Index, true},
		{f.engineHeight, "engine-height", &t.EngineHeight, false}, {f.trustedHeight, "trusted-height", &t.TrustedHeight, false},
	} {
		v, err := proofTargetDecimal(item.raw, item.name, item.zero)
		if err != nil {
			return t, err
		}
		*item.out = v
	}
	if t.Height >= math.MaxInt64-2 || t.EngineHeight >= math.MaxInt64-2 || t.EngineHeight < t.Height+1 || t.TrustedHeight >= t.Height || t.Index > math.MaxInt32 {
		return t, errors.New("lookup and independent heights/index are out of range")
	}
	for _, item := range []struct {
		raw, name string
		out       *[]byte
	}{
		{f.transactionHash, "transaction-hash", &t.TransactionHash}, {f.nativeHash, "native-wire-hash", &t.NativeWireHash},
		{f.engineHash, "engine-app-hash", &t.EngineAppHash}, {f.trustedHash, "trusted-block-hash", &t.TrustedBlockHash},
	} {
		v, err := proofTargetHash(item.raw, item.name)
		if err != nil {
			return t, err
		}
		*item.out = v
	}
	period, err := proofTargetDecimal(f.period, "trusting-period-nanoseconds", false)
	if err != nil {
		return t, err
	}
	drift, err := proofTargetDecimal(f.drift, "max-clock-drift-nanoseconds", true)
	if err != nil {
		return t, err
	}
	n, err := proofTargetDecimal(f.numerator, "trust-level-numerator", false)
	if err != nil {
		return t, err
	}
	d, err := proofTargetDecimal(f.denominator, "trust-level-denominator", false)
	if err != nil {
		return t, err
	}
	t.TrustingPeriod, t.MaxClockDrift = time.Duration(period), time.Duration(drift)
	t.TrustLevel = cmtmath.Fraction{Numerator: uint64(n), Denominator: uint64(d)}
	return t, nil
}
