package streambft

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"reflect"
	"testing"
	"time"
)

func TestProposalUsesCanonicalLanesAndIndependentLimits(t *testing.T) {
	policy := testPolicy()
	policy.Lanes[LaneGeneralEVM] = LanePolicy{Limit: resources(1), MinimumFee: 3}
	candidates := []Transaction{
		testTransaction("order", LaneTradingOrders, "bob", 1, nil, []string{"orders/bob"}, 5),
		testTransaction("recovery", LaneConsensusGovernance, "alice", 2, nil, []string{"recovery/alice"}, 5),
		testTransaction("evm-expensive", LaneGeneralEVM, "carol", 1, nil, []string{"evm/2"}, 4),
		testTransaction("cancel", LaneCancel, "alice", 1, nil, []string{"orders/alice"}, 5),
		testTransaction("evm-underpriced", LaneGeneralEVM, "dave", 1, nil, []string{"evm/1"}, 2),
	}
	proposal, err := BuildProposal(9, 3, "validator-d", "parent", candidates, policy)
	if err != nil {
		t.Fatal(err)
	}
	got := ids(proposal.Transactions)
	want := []string{"recovery", "cancel", "order", "evm-expensive"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical lane order: got %v want %v", got, want)
	}
	if err := proposal.Validate(policy); err != nil {
		t.Fatalf("canonical proposal rejected: %v", err)
	}
	tampered := proposal
	tampered.Transactions[0], tampered.Transactions[1] = tampered.Transactions[1], tampered.Transactions[0]
	if err := tampered.Validate(policy); err == nil {
		t.Fatal("non-canonical proposal accepted")
	}
	// Saturating one lane cannot consume the governance/recovery lane budget.
	if got[0] != "recovery" {
		t.Fatal("general EVM congestion displaced recovery traffic")
	}
}

func TestProposalRejectsResourceOverflow(t *testing.T) {
	policy := testPolicy()
	policy.GlobalLimit = Resources{Compute: math.MaxUint64, StorageRead: math.MaxUint64, StorageWrite: math.MaxUint64, Bandwidth: math.MaxUint64, StateGrowth: math.MaxUint64}
	policy.Lanes[LaneGeneralEVM] = LanePolicy{Limit: policy.GlobalLimit}
	first := testTransaction("first", LaneGeneralEVM, "alice", 1, nil, []string{"a"}, 1)
	first.Resources.Compute = math.MaxUint64
	second := testTransaction("second", LaneGeneralEVM, "bob", 1, nil, []string{"b"}, 1)
	proposal, err := BuildProposal(1, 0, "validator-a", "genesis", []Transaction{first, second}, policy)
	if err != nil {
		t.Fatal(err)
	}
	if got := ids(proposal.Transactions); !reflect.DeepEqual(got, []string{"first"}) {
		t.Fatalf("overflowing resource admission was not rejected: %v", got)
	}
}

func TestProposalRejectsUnmeteredTransactionsAndInvalidGovernancePolicy(t *testing.T) {
	policy := testPolicy()
	unmetered := testTransaction("unmetered", LaneGeneralEVM, "alice", 1, nil, []string{"evm/zero"}, 1)
	unmetered.Resources = Resources{}
	if _, err := BuildProposal(1, 0, "validator-a", "genesis", []Transaction{unmetered}, policy); err == nil {
		t.Fatal("zero-resource transaction bypassed proposal metering")
	}

	policy.Lanes[Lane("unknown")] = LanePolicy{Limit: resources(1), MinimumFee: 1}
	if err := policy.Validate(); err == nil {
		t.Fatal("proposal governance accepted an unknown lane")
	}
	delete(policy.Lanes, Lane("unknown"))
	policy.Lanes[LaneGeneralEVM] = LanePolicy{Limit: resources(1001), MinimumFee: 1}
	if err := policy.Validate(); err == nil {
		t.Fatal("proposal governance accepted a lane limit above the global limit")
	}
}

func TestLaneSaturationCannotDisplaceRecoveryOrPay(t *testing.T) {
	policy := testPolicy()
	policy.GlobalLimit = resources(4)
	for _, lane := range orderedLanes {
		policy.Lanes[lane] = LanePolicy{Limit: resources(4), MinimumFee: 1}
	}
	candidates := []Transaction{
		testTransaction("pay", LanePayStableSettlement, "pay", 1, nil, []string{"pay/1"}, 1),
		testTransaction("recovery", LaneConsensusGovernance, "recovery", 1, nil, []string{"recovery/1"}, 1),
	}
	for index := 0; index < 64; index++ {
		id := string(rune('a'+index%26)) + string(rune('a'+index/26))
		candidates = append(candidates, testTransaction("evm-"+id, LaneGeneralEVM, "evm-"+id, 1, nil, []string{"evm/" + id}, 1))
	}
	proposal, err := BuildProposal(2, 0, "validator-a", "parent", candidates, policy)
	if err != nil {
		t.Fatal(err)
	}
	got := ids(proposal.Transactions)
	if len(got) != 4 || got[0] != "recovery" || got[1] != "pay" {
		t.Fatalf("lower-priority EVM saturation displaced protected lanes: %v", got)
	}
}

func TestAvailabilityAndQuorumRequireMoreThanTwoThirds(t *testing.T) {
	validators, privateKeys := testValidators(t, 4)
	batch, err := NewWorkerBatch(1, 7, "worker-2", []string{"parent-b", "parent-a"}, []string{"tx-2", "tx-1"})
	if err != nil {
		t.Fatal(err)
	}
	availability := AvailabilityCertificate{ChainID: ChainID, BatchDigest: batch.Digest}
	for index := 0; index < 3; index++ {
		availability.Votes = append(availability.Votes, Vote{ValidatorID: validators[index].ID, Signature: ed25519.Sign(privateKeys[index], AvailabilityMessage(batch.Digest))})
	}
	if err := availability.Validate(batch, validators); err != nil {
		t.Fatalf("3/4 availability rejected: %v", err)
	}
	availability.Votes = availability.Votes[:2]
	if err := availability.Validate(batch, validators); err == nil {
		t.Fatal("2/4 availability accepted")
	}

	qc := signedQC(validators, privateKeys, 12, "block-12", false, 3)
	if err := qc.Validate(validators); err != nil {
		t.Fatalf("3/4 QC rejected: %v", err)
	}
	qc.Votes = qc.Votes[:2]
	if err := qc.Validate(validators); err == nil {
		t.Fatal("2/4 QC accepted")
	}
}

func TestAvailabilityAndQuorumPowerArithmeticFailsClosed(t *testing.T) {
	validators, privateKeys := testValidators(t, 4)
	validators[0].Power = math.MaxUint64 - 1
	validators[1].Power = 2
	batch, err := NewWorkerBatch(1, 1, "worker", nil, []string{"tx"})
	if err != nil {
		t.Fatal(err)
	}
	availability := AvailabilityCertificate{
		ChainID:     ChainID,
		BatchDigest: batch.Digest,
		Votes: []Vote{{
			ValidatorID: validators[0].ID,
			Signature:   ed25519.Sign(privateKeys[0], AvailabilityMessage(batch.Digest)),
		}},
	}
	if err := availability.Validate(batch, validators); err == nil {
		t.Fatal("availability accepted overflowing validator power")
	}
	qc := QuorumCertificate{
		ChainID: ChainID,
		View:    1,
		BlockID: "block",
		Votes: []Vote{{
			ValidatorID: validators[0].ID,
			Signature:   ed25519.Sign(privateKeys[0], QuorumMessage(1, "block", false)),
		}},
	}
	if err := qc.Validate(validators); err == nil {
		t.Fatal("quorum accepted overflowing validator power")
	}

	duplicate := []Validator{validators[2], validators[2]}
	if err := availability.Validate(batch, duplicate); err == nil {
		t.Fatal("availability accepted duplicate validator identities")
	}
}

func TestTwoThirdsQuorumUsesExactOverflowSafeThreshold(t *testing.T) {
	cases := []struct {
		signed uint64
		total  uint64
		want   bool
	}{
		{signed: 2, total: 3, want: false},
		{signed: 3, total: 4, want: true},
		{signed: 6, total: 9, want: false},
		{signed: 7, total: 9, want: true},
		{signed: math.MaxUint64 - 1, total: math.MaxUint64, want: true},
		{signed: math.MaxUint64, total: math.MaxUint64, want: true},
	}
	for _, test := range cases {
		if got := hasTwoThirdsQuorum(test.signed, test.total); got != test.want {
			t.Fatalf("hasTwoThirdsQuorum(%d, %d)=%t want %t", test.signed, test.total, got, test.want)
		}
	}
}

func TestSafetyStateRejectsEquivocationAndLockedBranch(t *testing.T) {
	validators, privateKeys := testValidators(t, 4)
	leader, _ := DeterministicLeader(validators, 3)
	parentQC := signedQC(validators, privateKeys, 2, "parent", false, 3)
	proposal, err := BuildProposal(3, 3, leader, "parent", nil, testPolicy())
	if err != nil {
		t.Fatal(err)
	}
	state, err := (SafetyState{}).CanVote(proposal, parentQC, validators)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := state.CanVote(proposal, parentQC, validators); err == nil {
		t.Fatal("second vote in the same view accepted")
	}
	otherQC := signedQC(validators, privateKeys, 1, "other", false, 3)
	leader, _ = DeterministicLeader(validators, 4)
	other, _ := BuildProposal(4, 4, leader, "other", nil, testPolicy())
	if _, err := state.CanVote(other, otherQC, validators); err == nil {
		t.Fatal("proposal below locked QC on another branch accepted")
	}
}

func TestDeterministicParallelExecutionMatchesSequentialFallback(t *testing.T) {
	initial := State{"balance/alice": []byte("10"), "balance/bob": []byte("0"), "oracle": []byte("100")}
	transactions := []Transaction{
		testTransactionWithWrites("oracle", LaneOracleBridgeRisk, "oracle", 1, []string{"oracle"}, []string{"oracle"}, map[string][]byte{"oracle": []byte("101")}),
		testTransactionWithWrites("pay", LanePayStableSettlement, "alice", 1, []string{"balance/alice", "balance/bob"}, []string{"balance/alice", "balance/bob"}, map[string][]byte{"balance/alice": []byte("8"), "balance/bob": []byte("2")}),
		testTransactionWithWrites("audit", LaneServiceSettlement, "service", 1, []string{"oracle"}, []string{"audit/1"}, map[string][]byte{"audit/1": []byte("oracle=101")}),
	}
	parallelState, parallel, err := (Executor{Workers: 8}).Execute(initial, transactions)
	if err != nil {
		t.Fatal(err)
	}
	sequentialState, sequential, err := (Executor{Workers: 1}).ExecuteSequential(initial, transactions)
	if err != nil {
		t.Fatal(err)
	}
	if !EqualState(parallelState, sequentialState) || parallel.StateRoot != sequential.StateRoot {
		t.Fatalf("parallel root %s differs from sequential root %s", parallel.StateRoot, sequential.StateRoot)
	}
	for workers := 1; workers <= 16; workers++ {
		state, result, err := (Executor{Workers: workers}).Execute(initial, transactions)
		if err != nil || !EqualState(state, parallelState) || result.StateRoot != parallel.StateRoot {
			t.Fatalf("worker count %d changed deterministic execution: state=%v result=%+v err=%v", workers, state, result, err)
		}
	}
}

func TestStateRootAndExecutionAreDeterministicAcrossInputOrder(t *testing.T) {
	initialA := State{"z": []byte("3"), "a": []byte("1"), "m": []byte("2")}
	initialB := State{}
	initialB["m"] = []byte("2")
	initialB["z"] = []byte("3")
	initialB["a"] = []byte("1")
	if StateRoot(initialA) != StateRoot(initialB) {
		t.Fatal("state root depends on map insertion order")
	}
	transactions := []Transaction{
		testTransactionWithWrites("bulk", LaneBulkDataCommitment, "carol", 1, nil, []string{"bulk/1"}, map[string][]byte{"bulk/1": []byte("c")}),
		testTransactionWithWrites("governance", LaneConsensusGovernance, "alice", 1, nil, []string{"gov/1"}, map[string][]byte{"gov/1": []byte("a")}),
		testTransactionWithWrites("pay", LanePayStableSettlement, "bob", 1, nil, []string{"pay/1"}, map[string][]byte{"pay/1": []byte("b")}),
	}
	reversed := []Transaction{transactions[2], transactions[0], transactions[1]}
	stateA, resultA, err := (Executor{Workers: 8}).Execute(initialA, transactions)
	if err != nil {
		t.Fatal(err)
	}
	stateB, resultB, err := (Executor{Workers: 2}).Execute(initialB, reversed)
	if err != nil {
		t.Fatal(err)
	}
	if !EqualState(stateA, stateB) || resultA.StateRoot != resultB.StateRoot || !reflect.DeepEqual(resultA.Applied, resultB.Applied) {
		t.Fatalf("input order changed deterministic execution: first=%+v second=%+v", resultA, resultB)
	}
}

func TestPacemakerUsesDeterministicBoundedP95(t *testing.T) {
	config := PacemakerConfig{Minimum: 500 * time.Millisecond, Maximum: 5 * time.Second, Factor: 2}
	timeout, err := AdaptiveTimeout(config, []time.Duration{100 * time.Millisecond, 2 * time.Second, 250 * time.Millisecond, 300 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	if timeout != 4*time.Second {
		t.Fatalf("unexpected timeout %s", timeout)
	}
	clamped, err := AdaptiveTimeout(config, []time.Duration{10 * time.Second})
	if err != nil || clamped != 5*time.Second {
		t.Fatalf("maximum clamp: %s %v", clamped, err)
	}
	overflowClamped, err := AdaptiveTimeout(
		PacemakerConfig{Minimum: time.Nanosecond, Maximum: time.Duration(math.MaxInt64), Factor: math.MaxUint64},
		[]time.Duration{2},
	)
	if err != nil || overflowClamped != time.Duration(math.MaxInt64) {
		t.Fatalf("overflow clamp: %s %v", overflowClamped, err)
	}
}

func TestLaneFeeMarketsAreIndependent(t *testing.T) {
	config := FeeMarketConfig{MinimumBaseFee: 10, MaximumBaseFee: 10_000, ChangeDenominator: 8, Target: map[Lane]Resources{}, Prices: ResourcePrices{Compute: 1, StorageRead: 2, StorageWrite: 4, Bandwidth: 1, StateGrowth: 20}}
	state := FeeMarketState{BaseFee: map[Lane]uint64{}}
	for _, lane := range orderedLanes {
		config.Target[lane] = Resources{Compute: 100}
		state.BaseFee[lane] = 100
	}
	next, err := state.Next(config, map[Lane]Resources{LaneGeneralEVM: {Compute: 1_000}, LaneConsensusGovernance: {Compute: 100}})
	if err != nil {
		t.Fatal(err)
	}
	if next.BaseFee[LaneGeneralEVM] <= state.BaseFee[LaneGeneralEVM] {
		t.Fatal("congested EVM base fee did not increase")
	}
	if next.BaseFee[LaneConsensusGovernance] != state.BaseFee[LaneConsensusGovernance] {
		t.Fatal("EVM congestion changed recovery/governance base fee")
	}
	fee, err := ResourceFee(Resources{Compute: 3, StateGrowth: 2}, config.Prices)
	if err != nil || fee != 43 {
		t.Fatalf("multi-resource fee: %d %v", fee, err)
	}
}

func TestFeeMarketGovernanceAndInputsFailClosed(t *testing.T) {
	config := testFeeMarketConfig()
	invalidTarget := config
	invalidTarget.Target = cloneTargets(config.Target)
	invalidTarget.Target[LaneGeneralEVM] = Resources{StorageRead: 1}
	if err := invalidTarget.Validate(); err == nil {
		t.Fatal("fee governance accepted a zero compute target")
	}

	unknownTarget := config
	unknownTarget.Target = cloneTargets(config.Target)
	unknownTarget.Target[Lane("unknown")] = resources(1)
	if err := unknownTarget.Validate(); err == nil {
		t.Fatal("fee governance accepted an unknown lane")
	}

	zeroPrice := config
	zeroPrice.Prices.StateGrowth = 0
	if err := zeroPrice.Validate(); err == nil {
		t.Fatal("fee governance accepted an unpriced resource dimension")
	}

	state := FeeMarketState{BaseFee: map[Lane]uint64{LaneGeneralEVM: config.MaximumBaseFee + 1}}
	if _, err := state.Next(config, nil); err == nil {
		t.Fatal("fee transition accepted a base fee above the governance maximum")
	}
	state = FeeMarketState{BaseFee: map[Lane]uint64{Lane("unknown"): config.MinimumBaseFee}}
	if _, err := state.Next(config, nil); err == nil {
		t.Fatal("fee transition accepted unknown state")
	}
	if _, err := (FeeMarketState{}).Next(config, map[Lane]Resources{Lane("unknown"): resources(1)}); err == nil {
		t.Fatal("fee transition accepted unknown usage")
	}
}

func TestExecutionResourceAccountingRejectsOverflow(t *testing.T) {
	first := testTransaction("first", LaneGeneralEVM, "alice", 1, nil, []string{"a"}, 1)
	first.Resources.Compute = math.MaxUint64
	second := testTransaction("second", LaneGeneralEVM, "bob", 1, nil, []string{"b"}, 1)
	for _, workers := range []int{1, 2} {
		if _, _, err := (Executor{Workers: workers}).Execute(nil, []Transaction{first, second}); err == nil {
			t.Fatalf("workers=%d accepted overflowing resource accounting", workers)
		}
	}
	if _, _, err := (Executor{Workers: 1}).ExecuteSequential(nil, []Transaction{first, second}); err == nil {
		t.Fatal("sequential execution accepted overflowing resource accounting")
	}
}

func TestCanaryFailsClosedWithoutCompleteEvidence(t *testing.T) {
	mode, err := ResolveMode(ModeCanary, PromotionEvidence{})
	if err == nil || mode != ModeShadow {
		t.Fatalf("incomplete canary evidence did not fail closed: mode=%s err=%v", mode, err)
	}
	evidence := PromotionEvidence{FormalSafetyVerified: true, DifferentialReplayMatched: true, StateRootsMatched: true, ValidatorCounts: map[int]bool{4: true, 7: true, 13: true, 21: true}, WANRegions: 3, ByzantineFaultsPassed: true, PartitionAndLossPassed: true, StateSyncAndRestorePassed: true, LongSoakPassed: true, RollbackPassed: true, CometBFTCompositeWin: true}
	mode, err = ResolveMode(ModeCanary, evidence)
	if err != nil || mode != ModeCanary {
		t.Fatalf("complete canary evidence rejected: mode=%s err=%v", mode, err)
	}
}

func testPolicy() ProposalPolicy {
	lanes := make(map[Lane]LanePolicy, len(orderedLanes))
	for _, lane := range orderedLanes {
		lanes[lane] = LanePolicy{Limit: resources(100), MinimumFee: 1}
	}
	return ProposalPolicy{GlobalLimit: resources(1000), Lanes: lanes}
}

func testFeeMarketConfig() FeeMarketConfig {
	config := FeeMarketConfig{MinimumBaseFee: 10, MaximumBaseFee: 10_000, ChangeDenominator: 8, Target: map[Lane]Resources{}, Prices: ResourcePrices{Compute: 1, StorageRead: 2, StorageWrite: 4, Bandwidth: 1, StateGrowth: 20}}
	for _, lane := range orderedLanes {
		config.Target[lane] = Resources{Compute: 100}
	}
	return config
}

func cloneTargets(source map[Lane]Resources) map[Lane]Resources {
	clone := make(map[Lane]Resources, len(source))
	for lane, target := range source {
		clone[lane] = target
	}
	return clone
}

func resources(value uint64) Resources {
	return Resources{Compute: value, StorageRead: value, StorageWrite: value, Bandwidth: value, StateGrowth: value}
}

func testTransaction(id string, lane Lane, sender string, nonce uint64, reads, writes []string, fee uint64) Transaction {
	transaction := testTransactionWithWrites(id, lane, sender, nonce, reads, writes, nil)
	transaction.FeeCap = fee
	return transaction
}

func testTransactionWithWrites(id string, lane Lane, sender string, nonce uint64, reads, writes []string, values map[string][]byte) Transaction {
	sum := sha256.Sum256([]byte("payload/" + id))
	return Transaction{ID: id, Sender: sender, Nonce: nonce, Lane: lane, Access: AccessSet{Reads: uniqueSorted(reads), Writes: uniqueSorted(writes)}, Resources: resources(1), FeeCap: 5, PayloadHash: hex.EncodeToString(sum[:]), Writes: values}
}

func ids(transactions []Transaction) []string {
	result := make([]string, len(transactions))
	for index, transaction := range transactions {
		result[index] = transaction.ID
	}
	return result
}

func testValidators(t *testing.T, count int) ([]Validator, []ed25519.PrivateKey) {
	t.Helper()
	validators := make([]Validator, count)
	privateKeys := make([]ed25519.PrivateKey, count)
	for index := 0; index < count; index++ {
		publicKey, privateKey, err := ed25519.GenerateKey(nil)
		if err != nil {
			t.Fatal(err)
		}
		validators[index] = Validator{ID: string(rune('a' + index)), PublicKey: publicKey, Power: 1}
		privateKeys[index] = privateKey
	}
	return validators, privateKeys
}

func signedQC(validators []Validator, privateKeys []ed25519.PrivateKey, view uint64, blockID string, fallback bool, votes int) QuorumCertificate {
	qc := QuorumCertificate{ChainID: ChainID, View: view, BlockID: blockID, Fallback: fallback}
	for index := 0; index < votes; index++ {
		qc.Votes = append(qc.Votes, Vote{ValidatorID: validators[index].ID, Signature: ed25519.Sign(privateKeys[index], QuorumMessage(view, blockID, fallback))})
	}
	return qc
}
