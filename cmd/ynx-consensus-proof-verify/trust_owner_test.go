//go:build unix

package main

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	cmtmath "github.com/cometbft/cometbft/libs/math"
)

func proofPreparationPUBLICContext(t *testing.T) trustContext {
	t.Helper()
	dir := filepath.Join("..", "..", "scripts", "loadtest", "fixtures", "finalize-1b-public")
	raw, err := os.ReadFile(filepath.Join(dir, "result.json"))
	if err != nil || !matchesSHA256(raw, "11ff25aba4aa4052f8a3062930bac41d223384ca218f460afb7c7847433fb0f6") {
		t.Fatal("fixed PUBLIC trace required", err)
	}
	var trace consensus.PQLabFinalizeTrace
	if json.Unmarshal(raw, &trace) != nil || !trace.SyntheticOnly || trace.AuthorityGranted || trace.NodeStarted || trace.PublicNetwork {
		t.Fatal("PUBLIC trace boundary")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	copyOriginal := func(f consensus.PQLabFinalizeTraceFile) string {
		t.Helper()
		b, err := os.ReadFile(filepath.Join(dir, f.Name))
		if err != nil || int64(len(b)) != f.Bytes || !matchesSHA256(b, f.SHA256) {
			t.Fatal("PUBLIC source mismatch", f.Name, err)
		}
		p := filepath.Join(root, f.Name)
		if err := os.WriteFile(p, b, 0600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	c := trustContext{Version: contextVersion, ChainID: trace.ChainID,
		MigrationFile: copyOriginal(trace.Migration), GenesisFile: copyOriginal(trace.Genesis), StateFile: copyOriginal(trace.FinalState), ScheduleFile: copyOriginal(trace.Schedule),
		ScheduleHash: trace.ScheduleHash, ConsensusGenesisSHA256: trace.Pins.CometGenesisSHA256, OriginalGenesisHash: trace.Pins.OriginalGenesisHash, MigrationStateHash: trace.Pins.MigrationStateHash,
		EngineHeight: strconv.FormatInt(trace.LastHeight, 10), EngineAppHash: trace.EngineAppHash, TrustingPeriodNanoseconds: "600000000000", MaxClockDriftNanoseconds: "1000000000", TrustLevelNumerator: "1", TrustLevelDenominator: "3"}
	stream, err := os.Open(copyOriginal(trace.Records))
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	decoder := json.NewDecoder(stream)
	var record consensus.PQLabFinalizeTraceRecord
	for {
		var next consensus.PQLabFinalizeTraceRecord
		if err := decoder.Decode(&next); err == io.EOF {
			break
		} else if err != nil {
			t.Fatal(err)
		}
		record = next
	}
	block, err := consensus.DecodePQTrustedLightBlock(record.LightBlock)
	if err != nil {
		t.Fatal(err)
	}
	blockRaw := record.LightBlock
	c.TrustedLightBlockFile = filepath.Join(root, "trusted.json")
	c.TrustedLightBlockSHA256 = hostTestSHA(blockRaw)
	if err := os.WriteFile(c.TrustedLightBlockFile, blockRaw, 0600); err != nil {
		t.Fatal(err)
	}
	c.ExpectedHeaderHeight, c.ExpectedStateHeight = strconv.FormatInt(block.Height, 10), strconv.FormatInt(block.Height-1, 10)
	c.ExpectedBlockHash, c.ExpectedStateAppHash = hex.EncodeToString(block.Hash()), hex.EncodeToString(block.AppHash)
	return c
}

func TestProofVerifierPreparedTrustPUBLICSameInvocationAndFirstCause(t *testing.T) {
	c := proofPreparationPUBLICContext(t)
	original, err := c.loadBeforePreparationTest()
	if err != nil {
		t.Fatal("original normal loader rejected PUBLIC source", err)
	}
	actual, err := c.load()
	if err != nil {
		t.Fatal("prepared normal loader rejected PUBLIC source", err)
	}
	oldPolicy, _ := original.Snapshot.Policy()
	newPolicy, _ := actual.Snapshot.Policy()
	if !reflect.DeepEqual(oldPolicy, newPolicy) || !reflect.DeepEqual(original.Snapshot.Anchor(), actual.Snapshot.Anchor()) || !reflect.DeepEqual(original.TrustedLightBlock, actual.TrustedLightBlock) || original.TrustingPeriod != actual.TrustingPeriod || original.MaxClockDrift != actual.MaxClockDrift || original.TrustLevel != actual.TrustLevel {
		t.Fatal("normal trust fields changed")
	}
	again, err := c.load()
	if err != nil || again.Snapshot == actual.Snapshot || again.TrustedLightBlock == actual.TrustedLightBlock {
		t.Fatal("separate invocation reused dynamic authority", err)
	}
	for _, kind := range []string{"bad-root-and-migration", "bad-root", "missing-runtime", "runtime-pin", "height", "apphash", "schedule-pin", "light-pin", "mutated-state"} {
		t.Run(kind, func(t *testing.T) {
			context := proofPreparationPUBLICContext(t)
			switch kind {
			case "bad-root-and-migration":
				context.ConsensusGenesisSHA256 = strings.Repeat("1", 64)
				if err := os.WriteFile(context.MigrationFile, []byte("{}"), 0600); err != nil {
					t.Fatal(err)
				}
			case "bad-root":
				context.ConsensusGenesisSHA256 = strings.Repeat("1", 64)
			case "missing-runtime", "runtime-pin":
				context.RuntimePlanFile, context.RuntimePlanHash = filepath.Join(filepath.Dir(context.StateFile), "runtime.json"), strings.Repeat("1", 64)
				if kind == "runtime-pin" {
					plan := consensus.RuntimeUpgradePlan{Format: consensus.RuntimeUpgradePlanFormat, ChainID: context.ChainID, NativeChainID: consensus.PQLabNativeChainID, CometGenesisSHA256: context.ConsensusGenesisSHA256, OriginalGenesisHash: context.OriginalGenesisHash, MigrationStateHash: context.MigrationStateHash, OldStateVersion: 13, OldApplicationVersion: 19, CheckpointHeight: 12, CheckpointAppHash: context.EngineAppHash, UpgradeHeight: 13, NewStateVersion: 18, NewApplicationVersion: 20}
					wire, err := plan.CanonicalJSON()
					if err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(context.RuntimePlanFile, wire, 0600); err != nil {
						t.Fatal(err)
					}
				}
			case "height":
				context.EngineHeight = "11"
			case "apphash":
				context.EngineAppHash = strings.Repeat("1", 64)
			case "schedule-pin":
				context.ScheduleHash = strings.Repeat("1", 64)
			case "light-pin":
				context.TrustedLightBlockSHA256 = strings.Repeat("1", 64)
			case "mutated-state":
				if err := os.WriteFile(context.StateFile, []byte("{}"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			_, before := context.loadBeforePreparationTest()
			_, after := context.load()
			if before == nil || after == nil || before.Error() != after.Error() {
				t.Fatal("normal first cause or acceptance changed", before, after)
			}
		})
	}
	// The returned retained snapshot cannot make a later invocation accept the
	// prior file after replacement. Existing caller pins and reads still run.
	if err := os.WriteFile(c.StateFile, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := c.load(); err == nil {
		t.Fatal("earlier request authority reused after committed file replacement")
	}
	if policy, err := actual.Snapshot.Policy(); err != nil || !reflect.DeepEqual(policy, newPolicy) {
		t.Fatal("later failure mutated prior detached authority", err)
	}
}

// loadBeforePreparationTest is the exact pre-change load body. It compares
// original ordering and complete semantics; it is never a production provider.
func (c trustContext) loadBeforePreparationTest() (consensus.PQLightProofTrust, error) {
	var trust consensus.PQLightProofTrust
	if err := c.validate(); err != nil {
		return trust, err
	}
	// All authority inputs come from the externally pinned context. Read the
	// original migration and genesis, preserving their established wire/hash.
	migration, err := readProofMigration(c.MigrationFile)
	if err != nil {
		return trust, err
	}
	genesisRaw, err := readPublicFile(c.GenesisFile, 64<<20)
	if err != nil {
		return trust, err
	}
	pins := consensus.ConsensusBootstrapPins{CometGenesisSHA256: c.ConsensusGenesisSHA256, OriginalGenesisHash: c.OriginalGenesisHash, MigrationStateHash: c.MigrationStateHash}
	bootstrap, err := consensus.NewConsensusBootstrap(genesisRaw, pins, migration)
	if err != nil {
		return trust, err
	}
	scheduleRaw, err := readPublicFile(c.ScheduleFile, 32<<10)
	if err != nil {
		return trust, err
	}
	engine, err := consensus.NewPQEngineAuthorization(scheduleRaw, c.ScheduleHash)
	if err != nil {
		return trust, err
	}
	var runtime *consensus.RuntimeUpgradeAuthorization
	if c.RuntimePlanFile != "" {
		raw, err := readPublicFile(c.RuntimePlanFile, consensus.MaxRuntimeUpgradePlanBytes)
		if err != nil {
			return trust, err
		}
		runtime, err = consensus.NewRuntimeUpgradeAuthorization(raw, c.RuntimePlanHash, bootstrap, migration)
		if err != nil {
			return trust, err
		}
	}
	resolvedState, err := filepath.EvalSymlinks(c.StateFile)
	if err != nil || resolvedState != c.StateFile {
		return trust, errors.New("committed state may not traverse symlinks")
	}
	source, err := consensus.NewPQEngineFileSourceWithRuntimeUpgrade(migration, c.StateFile, bootstrap, engine, runtime)
	if err != nil {
		return trust, err
	}
	height, _ := decimal(c.EngineHeight, math.MaxInt64-2, false)
	appHash, _ := hash32(c.EngineAppHash)
	authority, err := source.ConsensusAuthorityForState(c.ChainID, int64(height), appHash)
	if err != nil {
		return trust, err
	}
	var ok bool
	trust.Snapshot, ok = authority.(*consensus.PQEngineSnapshot)
	if !ok || trust.Snapshot == nil {
		return trust, errors.New("normal loader did not return immutable committed PQ authority")
	}
	trustedRaw, err := readPublicFile(c.TrustedLightBlockFile, consensus.MaxPQTrustedLightBlockBytes)
	if err != nil {
		return trust, err
	}
	if !matchesSHA256(trustedRaw, c.TrustedLightBlockSHA256) {
		return trust, errors.New("trusted LightBlock differs from independent exact-byte pin")
	}
	trust.TrustedLightBlock, err = consensus.DecodePQTrustedLightBlock(trustedRaw)
	if err != nil {
		return trust, err
	}
	period, _ := decimal(c.TrustingPeriodNanoseconds, math.MaxInt64, true)
	drift, _ := decimal(c.MaxClockDriftNanoseconds, math.MaxInt64, false)
	numerator, _ := decimal(c.TrustLevelNumerator, math.MaxInt64, true)
	denominator, _ := decimal(c.TrustLevelDenominator, math.MaxInt64, true)
	trust.TrustingPeriod, trust.MaxClockDrift = time.Duration(period), time.Duration(drift)
	trust.TrustLevel = cmtmath.Fraction{Numerator: numerator, Denominator: denominator}
	return trust, nil
}
