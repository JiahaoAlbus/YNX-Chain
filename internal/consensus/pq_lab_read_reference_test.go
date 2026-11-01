// Reference bodies from exact f27e07df6dd96114135aceace20a9413bba94649. Test only.
package consensus

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/chain"
	cmtmath "github.com/cometbft/cometbft/libs/math"
	"path/filepath"
	"strconv"
	"time"
)

func legacyPQLabSenderCheckpointF27(root, planPin, activationPin string, height int64, appHash string, metrics *PQLabMetrics, cache *PQLabStaticCache) (*PQLabSenderCheckpoint, error) {
	defer pqLabMeasure(metrics, "checkpoint.loadTotal")()
	var entry *pqLabStaticEntry
	var err error
	var p PQLabNetworkPlan
	var m chain.ConsensusMigrationState
	var b *ConsensusBootstrap
	if cache == nil {
		p, m, b, err = loadPQLabMeasured(root, planPin, metrics)
	} else {
		entry, err = cache.load(root, planPin, metrics)
		if err == nil {
			p, m, b = entry.plan, entry.witness.migration, entry.witness.bootstrap
		}
	}
	if err != nil {
		return nil, err
	}
	var engine *PQEngineAuthorization
	if activationPin != "" {
		raw, err := pqLabRead(filepath.Join(root, "activation", "activation.json"), 1<<20)
		if err != nil || pqLabFile("", raw).SHA256 != activationPin {
			return nil, errors.New("independent activation pin required")
		}
		var activation PQLabActivation
		if err = pqLabDecode(raw, &activation); err != nil {
			return nil, err
		}
		if activation.ScheduleFile != filepath.Join(root, "activation", "schedule.json") {
			return nil, errors.New("schedule escaped original lab")
		}
		schedule, err := pqLabRead(activation.ScheduleFile, 32<<10)
		if err != nil {
			return nil, err
		}
		engine, err = NewPQEngineAuthorization(schedule, activation.ScheduleHash)
		if err != nil {
			return nil, err
		}
	}
	read := func() (CommittedState, error) {
		var first CommittedState
		if entry != nil {
			done := pqLabMeasure(metrics, "checkpoint.staticOriginalReadback")
			e := entry.current()
			done()
			if e != nil {
				return first, e
			}
		}
		for i, n := range p.Nodes {
			endNode := pqLabMeasure(metrics, "checkpoint.nodeReadAndValidate")
			var state CommittedState
			var e error
			if entry == nil {
				state, e = readPQEngineCommittedState(n.StatePath, m, b, engine, nil)
			} else {
				state, e = readPQEngineCommittedStateOwned(n.StatePath, entry.witness, engine, nil, capturePQEngineState)
			}
			endNode()
			if e != nil {
				return CommittedState{}, e
			}
			if !state.Initialized || state.Height != height || state.AppHash != appHash || state.AccountPolicy == nil {
				return CommittedState{}, errors.New("actual four-node checkpoint differs from independently supplied H/AppHash")
			}
			if i == 0 {
				first = state
			}
		}
		if entry != nil {
			done := pqLabMeasure(metrics, "checkpoint.staticOriginalReadback")
			e := entry.current()
			done()
			if e != nil {
				return CommittedState{}, e
			}
		}
		return first, nil
	}
	endInitial := pqLabMeasure(metrics, "checkpoint.initialFourNodeRead")
	state, err := read()
	endInitial()
	if err != nil {
		return nil, err
	}
	network, err := hex.DecodeString(m.OriginalGenesisHash)
	if err != nil {
		return nil, err
	}
	return &PQLabSenderCheckpoint{state: state, network: network, migrationHash: m.StateHash, current: func() error {
		defer pqLabMeasure(metrics, "checkpoint.currentFourNodeRead")()
		_, err := read()
		return err
	}}, nil
}

func legacyPQLabWriteProofF27(directory string, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	var empty PQLabProofExport
	if m.Version != PQLabProofMaterialsVersion || len(m.Migration) == 0 || len(m.Migration) > 64<<20 || len(m.Genesis) == 0 || len(m.Genesis) > 64<<20 || len(m.CommittedState) == 0 || len(m.CommittedState) > 128<<20 || len(m.Schedule) == 0 || len(m.Schedule) > 1<<20 || len(m.TrustedLightBlock) == 0 || len(m.TrustedLightBlock) > MaxPQTrustedLightBlockBytes || m.EngineHeight < 1 || len(m.EngineAppHash) != 32 || now.IsZero() {
		return empty, errors.New("bounded actual lab checkpoint material required")
	}
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(m.Migration, &migration); err != nil {
		return empty, err
	}
	if migration.Network.ChainID != PQLabNativeChainID || migration.Network.IsPublicNet {
		return empty, errors.New("proof export is restricted to independent synthetic lab identity")
	}
	canonical, err := migration.CanonicalJSON()
	if err != nil || !bytes.Equal(canonical, m.Migration) {
		return empty, errors.New("noncanonical original migration")
	}
	bootstrap, err := NewConsensusBootstrap(m.Genesis, m.Pins, migration)
	if err != nil {
		return empty, err
	}
	_, err = NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		return empty, err
	}
	_, err = DecodePQTrustedLightBlock(m.TrustedLightBlock)
	if err != nil {
		return empty, err
	}
	if m.Expected.Block.ChainID != bootstrap.record.ChainID {
		return empty, errors.New("expected chain differs from original lab bootstrap")
	}
	if err = pqLabFreshDirectory(directory); err != nil {
		return empty, err
	}
	files := map[string][]byte{"migration.json": m.Migration, "genesis.json": m.Genesis, "committed-state.json": m.CommittedState, "schedule.json": m.Schedule, "trusted-light-block.json": m.TrustedLightBlock}
	for name, raw := range files {
		if err = pqLabWriteExclusive(filepath.Join(directory, name), raw); err != nil {
			return empty, err
		}
	}
	return legacyPQLabFinishProofF27(directory, m, proof, now)
}

// Exact continuation only: originals written before a crash/invalid proof are
// retained. Any different existing context/result refuses instead of replacing.

func legacyPQLabFinishProofF27(directory string, m PQLabProofMaterials, proof PQTransactionProofRequest, now time.Time) (PQLabProofExport, error) {
	var empty PQLabProofExport
	var migration chain.ConsensusMigrationState
	if err := json.Unmarshal(m.Migration, &migration); err != nil {
		return empty, err
	}
	bootstrap, err := NewConsensusBootstrap(m.Genesis, m.Pins, migration)
	if err != nil {
		return empty, err
	}
	authorization, err := NewPQEngineAuthorization(m.Schedule, m.ScheduleHash)
	if err != nil {
		return empty, err
	}
	trusted, err := DecodePQTrustedLightBlock(m.TrustedLightBlock)
	if err != nil {
		return empty, err
	}
	source, err := NewPQEngineFileSource(migration, filepath.Join(directory, "committed-state.json"), bootstrap, authorization)
	if err != nil {
		return empty, err
	}
	authority, err := source.ConsensusAuthorityForState(bootstrap.record.ChainID, m.EngineHeight, m.EngineAppHash)
	if err != nil {
		return empty, err
	}
	snapshot, ok := authority.(*PQEngineSnapshot)
	if !ok {
		return empty, errors.New("normal file source returned unexpected authority")
	}
	trust := PQLightProofTrust{Snapshot: snapshot, TrustedLightBlock: trusted, TrustingPeriod: m.TrustingPeriod, MaxClockDrift: m.MaxClockDrift, TrustLevel: cmtmath.Fraction{Numerator: m.TrustNumerator, Denominator: m.TrustDenominator}, Now: now}
	result, err := VerifyPQTransactionProof(trust, m.Expected, proof)
	if err != nil {
		return empty, err
	}
	e := m.Expected
	statement := func(e PQLightProofExpectation) map[string]string {
		return map[string]string{"chainId": e.ChainID, "headerHeight": strconv.FormatInt(e.HeaderHeight, 10), "blockHash": hex.EncodeToString(e.BlockHash), "stateHeight": strconv.FormatInt(e.StateHeight, 10), "stateAppHash": hex.EncodeToString(e.StateAppHash)}
	}
	expected := map[string]any{"block": statement(e.Block), "successor": statement(e.Successor), "transactionType": e.TransactionType, "envelope": e.Envelope, "nativeWire": e.NativeWire, "transactionHash": hex.EncodeToString(e.TransactionHash), "nativeWireHash": hex.EncodeToString(e.NativeWireHash), "index": strconv.FormatInt(e.Index, 10)}
	light := map[string]string{"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": bootstrap.record.ChainID, "migrationFile": filepath.Join(directory, "migration.json"), "genesisFile": filepath.Join(directory, "genesis.json"), "stateFile": filepath.Join(directory, "committed-state.json"), "scheduleFile": filepath.Join(directory, "schedule.json"), "scheduleHash": m.ScheduleHash, "consensusGenesisSHA256": m.Pins.CometGenesisSHA256, "originalGenesisHash": m.Pins.OriginalGenesisHash, "migrationStateHash": m.Pins.MigrationStateHash, "runtimePlanFile": "", "runtimePlanHash": "", "engineHeight": strconv.FormatInt(m.EngineHeight, 10), "engineAppHash": hex.EncodeToString(m.EngineAppHash), "expectedHeaderHeight": strconv.FormatInt(e.Block.HeaderHeight, 10), "expectedBlockHash": hex.EncodeToString(e.Block.BlockHash), "expectedStateHeight": strconv.FormatInt(e.Block.StateHeight, 10), "expectedStateAppHash": hex.EncodeToString(e.Block.StateAppHash), "trustedLightBlockFile": filepath.Join(directory, "trusted-light-block.json"), "trustedLightBlockSHA256": pqLabFile("", m.TrustedLightBlock).SHA256, "trustingPeriodNanoseconds": strconv.FormatInt(int64(m.TrustingPeriod), 10), "maxClockDriftNanoseconds": strconv.FormatInt(int64(m.MaxClockDrift), 10), "trustLevelNumerator": strconv.FormatUint(m.TrustNumerator, 10), "trustLevelDenominator": strconv.FormatUint(m.TrustDenominator, 10)}
	contextRaw, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-TRUST/v1", "lightTrust": light, "expectedTransaction": expected})
	if err != nil {
		return empty, err
	}
	requestRaw, err := json.Marshal(map[string]any{"version": "YNX-CONSENSUS-TRANSACTION-PROOF-VERIFY-REQUEST/v1", "expected": expected, "proof": proof})
	if err != nil {
		return empty, err
	}
	out := PQLabProofExport{Version: "YNX-PQ-LOOPBACK-PROOF-EXPORT/v1", SyntheticOnly: true, Context: pqLabFile("trust-context.json", contextRaw), Request: pqLabFile("request.json", requestRaw), Result: result}
	out.VerifierArguments = []string{"--trust-context", filepath.Join(directory, out.Context.Path), "--trust-context-sha256", out.Context.SHA256}
	for name, raw := range map[string][]byte{out.Context.Path: contextRaw, out.Request.Path: requestRaw} {
		if err = pqLabWriteOrExact(filepath.Join(directory, name), raw); err != nil {
			return empty, err
		}
	}
	raw, err := json.Marshal(out)
	if err != nil {
		return empty, err
	}
	if err = pqLabWriteOrExact(filepath.Join(directory, "PUBLIC-PROOF-INPUTS.json"), raw); err != nil {
		return empty, err
	}
	return out, nil
}
