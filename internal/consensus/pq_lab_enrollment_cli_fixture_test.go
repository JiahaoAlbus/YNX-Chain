package consensus

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"

	cmtjson "github.com/cometbft/cometbft/libs/json"
)

// Real four-validator synthetic BlockExecutor fixture only. No custody, keys,
// authorizations or live network state are exported.
func TestPQLabEnrollmentCLIPublicFixture(t *testing.T) {
	trust, pins, funding, migration, _, fixture := pqEnrollmentProofFixture(t)
	writePQLabEnrollmentCLIProofFixture(t, fixture.light, trust, pins, funding, migration)
}

func TestPQLabEnrollmentLegacyCLIPublicFixture(t *testing.T) {
	testPQLabEnrollmentLegacyFunding(t, true)
}

func writePQLabEnrollmentCLIProofFixture(t *testing.T, l *pqLightProofFixture, trust PQLightProofTrust, pins PQLabEnrollmentPins, funding, migration PQLabEnrollmentOriginal) {
	t.Helper()
	if _, err := VerifyPQLabEnrollmentOriginals(trust, pins, funding, migration); err != nil {
		t.Fatal(err)
	}
	migrationRaw, err := l.harness.f.migration.CanonicalJSON()
	if err != nil {
		t.Fatal(err)
	}
	stateRaw, err := os.ReadFile(l.harness.path)
	if err != nil {
		t.Fatal(err)
	}
	scheduleRaw, err := json.Marshal(l.schedule)
	if err != nil {
		t.Fatal(err)
	}
	scheduleHash, err := l.schedule.Hash()
	if err != nil {
		t.Fatal(err)
	}
	trustedRaw, err := cmtjson.Marshal(trust.TrustedLightBlock)
	if err != nil {
		t.Fatal(err)
	}
	engine, err := l.harness.raw.Load()
	if err != nil {
		t.Fatal(err)
	}
	materials := map[string][]byte{"migration.json": migrationRaw, "genesis.json": l.harness.f.raw, "state.json": stateRaw, "schedule.json": scheduleRaw, "trusted.json": trustedRaw, "funding.tx": funding.Expected.Envelope, "migration.tx": migration.Expected.Envelope}
	if funding.Expected.TransactionType == PQLabLegacyFundingType {
		original, err := DecodeSignedTransaction(funding.Expected.Envelope)
		if err != nil {
			t.Fatal(err)
		}
		syntheticKey := deterministicPrivateKey(212)
		t.Cleanup(syntheticKey.Zero)
		alternate, err := NewSignedTransfer(syntheticKey, original.ChainID, original.To, original.Amount, original.Nonce+1)
		if err != nil || alternate.From != original.From || alternate.To != original.To || alternate.Amount != original.Amount {
			t.Fatal("synthetic alternate identity", err)
		}
		materials["same-owner-alternate.tx"], err = EncodeSignedTransaction(alternate)
		if err != nil {
			t.Fatal(err)
		}
	}
	e := funding.Expected.Block
	parameters := map[string]string{"version": "YNX-CONSENSUS-PROOF-TRUST/v1", "chainId": engine.ChainID, "scheduleHash": scheduleHash, "consensusGenesisSHA256": l.harness.f.pins.CometGenesisSHA256, "originalGenesisHash": l.harness.f.pins.OriginalGenesisHash, "migrationStateHash": l.harness.f.pins.MigrationStateHash, "runtimePlanFile": "", "runtimePlanHash": "", "engineHeight": strconv.FormatInt(engine.LastBlockHeight, 10), "engineAppHash": hex.EncodeToString(engine.AppHash), "trustedLightBlockSHA256": pqLabSHA(trustedRaw), "expectedHeaderHeight": strconv.FormatInt(e.HeaderHeight, 10), "expectedBlockHash": hex.EncodeToString(e.BlockHash), "expectedStateHeight": strconv.FormatInt(e.StateHeight, 10), "expectedStateAppHash": hex.EncodeToString(e.StateAppHash), "trustingPeriodNanoseconds": strconv.FormatInt(int64(trust.TrustingPeriod), 10), "maxClockDriftNanoseconds": strconv.FormatInt(int64(trust.MaxClockDrift), 10), "trustLevelNumerator": strconv.FormatUint(trust.TrustLevel.Numerator, 10), "trustLevelDenominator": strconv.FormatUint(trust.TrustLevel.Denominator, 10)}
	keys := map[string]string{"originalGenesis": hex.EncodeToString(pins.OriginalGenesis), "nativeChainId": strconv.FormatUint(pins.NativeChainID, 10), "fundingSource": pins.FundingSource, "owner": pins.Owner, "fundingAmount": strconv.FormatUint(pins.FundingAmount, 10), "pka": base64.StdEncoding.EncodeToString(pins.PKA), "pkb": base64.StdEncoding.EncodeToString(pins.PKB), "activationHeight": strconv.FormatUint(pins.ActivationHeight, 10)}
	data, err := json.Marshal(map[string]any{"version": "YNX-PQ-ENROLLMENT-PUBLIC-FIXTURE/v1", "syntheticOnly": true, "materials": materials, "trust": parameters, "pins": keys, "fundingExpected": pqTransactionPublicExpected(t, funding.Expected), "migrationExpected": pqTransactionPublicExpected(t, migration.Expected), "fundingProof": funding.Proof, "migrationProof": migration.Proof})
	if err != nil {
		t.Fatal(err)
	}
	path := os.Getenv("YNX_ENROLLMENT_FIXTURE_OUT")
	if path != "" {
		if err = writePQLightPublicFixture(path, data); err != nil {
			t.Fatal(err)
		}
	}
}
