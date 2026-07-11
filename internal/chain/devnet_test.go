package chain

import (
	"encoding/hex"
	"strings"
	"testing"
	"time"
)

func TestLegacyKeccak256Vector(t *testing.T) {
	got := hex.EncodeToString(legacyKeccak256(nil))
	want := "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
	if got != want {
		t.Fatalf("expected Ethereum legacy Keccak-256 empty hash %s, got %s", want, got)
	}
}

func TestValidatorSetConfigAndBlockRotation(t *testing.T) {
	validators, err := ParseValidatorSet("ynx_val_primary|primary|43.153.202.237|primary validator|peer-primary;ynx_val_sg|singapore|43.134.23.58|bonded validator|peer-sg;ynx_val_sv|silicon-valley|43.162.100.54|bonded validator|peer-sv")
	if err != nil {
		t.Fatal(err)
	}
	devnet := NewDevnetWithValidators(DefaultNetworkConfig("testnet"), validators)
	got := devnet.Validators()
	if len(got) != 3 {
		t.Fatalf("expected 3 validators, got %+v", got)
	}
	if got[0].Moniker != "primary" || got[0].Host != "43.153.202.237" || got[0].PeerID != "peer-primary" {
		t.Fatalf("validator metadata not preserved: %+v", got[0])
	}
	first := devnet.ProduceBlock()
	second := devnet.ProduceBlock()
	third := devnet.ProduceBlock()
	if first.Validator != "ynx_val_primary" || second.Validator != "ynx_val_sg" || third.Validator != "ynx_val_sv" {
		t.Fatalf("expected validator rotation, got %s %s %s", first.Validator, second.Validator, third.Validator)
	}
	got = devnet.Validators()
	for _, validator := range got {
		if !validator.PeerReady || validator.PeerStatus != "produced_block" || validator.LatestHeight == 0 || validator.LastSeenAt == nil || validator.UpdatedAt == nil {
			t.Fatalf("expected produced blocks to update peer readiness, got %+v", validator)
		}
	}
}

func TestValidatorPeerReadinessPersistence(t *testing.T) {
	dir := t.TempDir()
	validators, err := ParseValidatorSet("ynx_val_primary|primary|43.153.202.237|primary validator|peer-primary;ynx_val_sg|singapore|43.134.23.58|bonded validator|peer-sg;ynx_val_sv|silicon-valley|43.162.100.54|bonded validator|peer-sv")
	if err != nil {
		t.Fatal(err)
	}
	peers, err := ParseValidatorPeers("ynx_val_primary|peer-primary|43.153.202.237|43.153.202.237:26656|primary validator;ynx_val_sg|peer-sg|43.134.23.58|43.134.23.58:26656|bonded validator;ynx_val_sv|peer-sv|43.162.100.54|43.162.100.54:26656|bonded validator")
	if err != nil {
		t.Fatal(err)
	}
	devnet, err := NewPersistentDevnetWithValidatorsAndPeers(DefaultNetworkConfig("testnet"), dir, validators, peers)
	if err != nil {
		t.Fatal(err)
	}
	if peer := peerByAddress(devnet.ValidatorPeers(), "ynx_val_sg"); peer == nil || !peer.Expected || peer.Observed || peer.P2PAddress != "43.134.23.58:26656" || peer.Source != "bootstrap_config" {
		t.Fatalf("expected bootstrap peer before observation, got %+v", peer)
	}
	ready := true
	validator, err := devnet.UpdateValidatorPeerState(ValidatorPeerHeartbeatInput{
		Address:      "ynx_val_sg",
		PeerID:       "peer-sg-live",
		Host:         "43.134.23.58:26656",
		Ready:        &ready,
		Status:       "reachable",
		LatestHeight: 7,
		Evidence:     "local-heartbeat-unit-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !validator.PeerReady || validator.PeerStatus != "reachable" || validator.LatestHeight != 7 || validator.PeerID != "peer-sg-live" || validator.LastSeenAt == nil {
		t.Fatalf("unexpected heartbeat validator state: %+v", validator)
	}
	observed := peerByAddress(devnet.ValidatorPeers(), "ynx_val_sg")
	if observed == nil || !observed.Expected || !observed.Observed || observed.Status != "reachable" || observed.LatestHeight != 7 || observed.Evidence != "local-heartbeat-unit-test" {
		t.Fatalf("expected heartbeat to update peer discovery state, got %+v", observed)
	}
	sync, err := devnet.RecordValidatorPeerSync(ValidatorPeerSyncInput{
		Source:       "ynx_val_primary",
		Target:       "ynx_val_sg",
		SourceHeight: 8,
		TargetHeight: 7,
		Evidence:     "local-sync-unit-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	if sync.Status != "synced" || sync.LagBlocks != 1 || sync.Source != "ynx_val_primary" || sync.Target != "ynx_val_sg" || sync.Evidence != "local-sync-unit-test" {
		t.Fatalf("unexpected peer sync state: %+v", sync)
	}

	reconfigured, err := ParseValidatorSet("ynx_val_primary|primary-updated|43.153.202.237|primary validator|peer-primary;ynx_val_sg|singapore-updated|43.134.23.58|bonded validator|peer-sg;ynx_val_sv|silicon-valley|43.162.100.54|bonded validator|peer-sv")
	if err != nil {
		t.Fatal(err)
	}
	restored, err := NewPersistentDevnetWithValidatorsAndPeers(DefaultNetworkConfig("testnet"), dir, reconfigured, peers)
	if err != nil {
		t.Fatal(err)
	}
	got := validatorByAddress(restored.Validators(), "ynx_val_sg")
	if got == nil {
		t.Fatalf("restored validator not found")
	}
	if got.Moniker != "singapore-updated" || !got.PeerReady || got.PeerStatus != "reachable" || got.LatestHeight != 7 || got.PeerEvidence != "local-heartbeat-unit-test" {
		t.Fatalf("expected config reload to preserve peer runtime state, got %+v", got)
	}
	restoredPeer := peerByAddress(restored.ValidatorPeers(), "ynx_val_sg")
	if restoredPeer == nil || !restoredPeer.Observed || restoredPeer.Status != "synced" || restoredPeer.LatestHeight != 7 || restoredPeer.Evidence != "local-sync-unit-test" {
		t.Fatalf("expected config reload to preserve peer discovery state, got %+v", restoredPeer)
	}
	restoredSyncs := restored.ValidatorPeerSyncs()
	if len(restoredSyncs) != 1 || restoredSyncs[0].Status != "synced" || restoredSyncs[0].LagBlocks != 1 || restoredSyncs[0].Evidence != "local-sync-unit-test" {
		t.Fatalf("expected config reload to preserve peer sync state, got %+v", restoredSyncs)
	}
	status := restored.Status()
	if status["readyValidatorCount"].(int) != 1 {
		t.Fatalf("expected ready validator count 1, got %v", status)
	}
	discovery := status["validatorPeerDiscovery"].(map[string]any)
	if discovery["expected"].(int) != 3 || discovery["observed"].(int) != 1 {
		t.Fatalf("expected peer discovery counts, got %v", status)
	}
	syncSummary := status["validatorPeerSync"].(map[string]any)
	if syncSummary["synced"].(int) != 1 || syncSummary["total"].(int) != 1 {
		t.Fatalf("expected peer sync counts, got %v", status)
	}
}

func TestNodeIdentityAndPeerSyncFreshness(t *testing.T) {
	validators, err := ParseValidatorSet("ynx_val_primary|primary|43.153.202.237|primary validator|peer-primary;ynx_val_sg|singapore|43.134.23.58|bonded validator|peer-sg;ynx_val_sv|silicon-valley|43.162.100.54|bonded validator|peer-sv")
	if err != nil {
		t.Fatal(err)
	}
	devnet := NewDevnetWithValidators(DefaultNetworkConfig("testnet"), validators)
	devnet.SetNodeIdentityConfig(NodeIdentityConfig{
		ValidatorAddress: "ynx_val_primary",
		PeerSyncTargets: []ValidatorPeerSyncTarget{
			{Address: "ynx_val_sg", URL: "http://127.0.0.1:6421"},
			{Address: "ynx_val_sv", URL: "http://127.0.0.1:6422"},
		},
		PeerSyncInterval: 5 * time.Second,
		Build:            BuildInfo{Commit: "abc123", Release: "ynx-chain-abc123", BuildTime: "2026-07-10T00:00:00Z"},
	})
	_, err = devnet.RecordValidatorPeerSync(ValidatorPeerSyncInput{
		Source:       "ynx_val_primary",
		Target:       "ynx_val_sg",
		SourceHeight: 9,
		TargetHeight: 9,
		Evidence:     "fresh-unit-test",
	})
	if err != nil {
		t.Fatal(err)
	}
	identity := devnet.NodeIdentity()
	if !identity.Configured || identity.ValidatorAddress != "ynx_val_primary" || identity.ValidatorRole != "primary validator" || identity.ExpectedValidatorCount != 3 || identity.PeerSyncTargetCount != 2 {
		t.Fatalf("unexpected node identity: %+v", identity)
	}
	if identity.PeerSyncFreshness.Status != "missing_peer_sync" || identity.PeerSyncFreshness.Synced != 1 || identity.PeerSyncFreshness.Missing != 1 || identity.PeerSyncFreshness.Fresh != 1 {
		t.Fatalf("expected one fresh sync and one missing sync, got %+v", identity.PeerSyncFreshness)
	}
	if identity.Build.Commit != "abc123" || identity.Build.Release != "ynx-chain-abc123" || identity.Build.BuildTime != "2026-07-10T00:00:00Z" {
		t.Fatalf("unexpected build identity: %+v", identity.Build)
	}
	status := devnet.Status()
	statusIdentity := status["nodeIdentity"].(NodeIdentity)
	if statusIdentity.ValidatorAddress != "ynx_val_primary" || statusIdentity.PeerSyncFreshness.Status != "missing_peer_sync" {
		t.Fatalf("status missing node identity freshness: %+v", statusIdentity)
	}
	statusBuild := status["build"].(BuildInfo)
	if statusBuild.Commit != "abc123" || statusBuild.Release != "ynx-chain-abc123" {
		t.Fatalf("status missing build identity: %+v", statusBuild)
	}
}

func TestNodeIdentityDefaultBuildInfo(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	identity := devnet.NodeIdentity()
	if identity.Build.Commit != "unknown" || identity.Build.Release != "local" || identity.Build.BuildTime != "unknown" {
		t.Fatalf("unexpected default build identity: %+v", identity.Build)
	}
	statusBuild := devnet.Status()["build"].(BuildInfo)
	if statusBuild.Commit != "unknown" || statusBuild.Release != "local" || statusBuild.BuildTime != "unknown" {
		t.Fatalf("unexpected default status build identity: %+v", statusBuild)
	}
}

func TestNodeIdentityPeerSyncFreshnessStaleRecord(t *testing.T) {
	validators, err := ParseValidatorSet("ynx_val_primary|primary|127.0.0.1|primary validator|peer-primary;ynx_val_sg|singapore|127.0.0.2|bonded validator|peer-sg")
	if err != nil {
		t.Fatal(err)
	}
	devnet := NewDevnetWithValidators(DefaultNetworkConfig("testnet"), validators)
	devnet.SetNodeIdentityConfig(NodeIdentityConfig{
		ValidatorAddress: "ynx_val_primary",
		PeerSyncTargets:  []ValidatorPeerSyncTarget{{Address: "ynx_val_sg", URL: "http://127.0.0.1:6421"}},
		PeerSyncInterval: 5 * time.Second,
		StaleAfter:       time.Nanosecond,
	})
	if _, err := devnet.RecordValidatorPeerSync(ValidatorPeerSyncInput{Source: "ynx_val_primary", Target: "ynx_val_sg", SourceHeight: 10, TargetHeight: 1, Evidence: "stale-unit-test"}); err != nil {
		t.Fatal(err)
	}
	devnet.mu.Lock()
	sync := devnet.validatorPeerSyncs[validatorPeerSyncKey("ynx_val_primary", "ynx_val_sg")]
	sync.UpdatedAt = time.Now().UTC().Add(-time.Minute)
	devnet.validatorPeerSyncs[validatorPeerSyncKey("ynx_val_primary", "ynx_val_sg")] = sync
	devnet.mu.Unlock()
	identity := devnet.NodeIdentity()
	if identity.PeerSyncFreshness.Status != "stale_peer_sync" || identity.PeerSyncFreshness.Stale != 1 || identity.PeerSyncFreshness.Lagging != 1 {
		t.Fatalf("expected stale lagging peer sync, got %+v", identity.PeerSyncFreshness)
	}
}

func validatorByAddress(validators []Validator, address string) *Validator {
	for i := range validators {
		if validators[i].Address == address {
			return &validators[i]
		}
	}
	return nil
}

func peerByAddress(peers []ValidatorPeer, address string) *ValidatorPeer {
	for i := range peers {
		if peers[i].Address == address {
			return &peers[i]
		}
	}
	return nil
}

func TestStakeIncreasesResources(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_staker", 500); err != nil {
		t.Fatal(err)
	}
	before, err := devnet.Resources("ynx_staker")
	if err != nil {
		t.Fatal(err)
	}
	_, after, err := devnet.Stake("ynx_staker", 200)
	if err != nil {
		t.Fatal(err)
	}
	if after.BandwidthLimit <= before.BandwidthLimit {
		t.Fatalf("expected bandwidth to increase")
	}
}

func TestResourceDelegationRentalIncomeAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	policy := devnet.ResourceMarketPolicy()
	if err := policy.Validate(); err != nil {
		t.Fatal(err)
	}
	if policy.Currency != "YNXT" || policy.PolicyHash == "" || policy.ProviderShareBps+policy.ProtocolFeeBps != 10000 {
		t.Fatalf("unexpected resource market policy: %+v", policy)
	}
	badPolicy := policy
	badPolicy.ProtocolFeeBps = 999
	if err := badPolicy.Validate(); err == nil {
		t.Fatal("expected invalid resource market policy shares to fail")
	}
	if _, err := devnet.Faucet("ynx_provider", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_renter", 1000); err != nil {
		t.Fatal(err)
	}
	delegation, tx, resources, err := devnet.DelegateResources("ynx_provider", "ynx_provider", 500)
	if err != nil {
		t.Fatal(err)
	}
	if delegation.Status != "active" || tx.Type != "resource_delegate" {
		t.Fatalf("unexpected delegation: %+v tx=%+v", delegation, tx)
	}
	if delegation.PolicyHash != policy.PolicyHash || delegation.PolicyVersion != policy.Version {
		t.Fatalf("expected delegation policy evidence: %+v policy=%+v", delegation, policy)
	}
	if resources.BandwidthLimit <= 1000 {
		t.Fatalf("expected delegated resources to increase provider capacity: %+v", resources)
	}
	quote, err := devnet.ResourceQuote("ynx_renter", 100, 5, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if quote.PriceYNXT != 7 || quote.PolicyHash != policy.PolicyHash || len(quote.PricingBreakdown) != 4 {
		t.Fatalf("unexpected resource quote policy evidence: %+v", quote)
	}
	rental, _, err := devnet.RentResources("ynx_renter", "ynx_provider", 100, 5, 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	if rental.Provider != "ynx_provider" || rental.ProviderIncomeYNXT <= 0 || rental.ProtocolFeeYNXT <= 0 {
		t.Fatalf("unexpected rental split: %+v", rental)
	}
	if rental.PolicyHash != policy.PolicyHash || rental.ProviderIncomeYNXT != 5 || rental.ProtocolFeeYNXT != 2 {
		t.Fatalf("expected policy-bound rental split: %+v", rental)
	}
	income := devnet.ResourceIncome("ynx_provider")
	if len(income) != 1 || income[0].Amount != rental.ProviderIncomeYNXT || income[0].PolicyHash != policy.PolicyHash {
		t.Fatalf("expected provider income record: %+v", income)
	}
	analytics := devnet.ResourceAnalytics()
	if analytics.ActiveDelegationCount != 1 || analytics.ResourceRentalCount != 1 || analytics.ProviderIncomeYNXT != rental.ProviderIncomeYNXT || analytics.PolicyHash != policy.PolicyHash {
		t.Fatalf("unexpected analytics: %+v", analytics)
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.ResourceDelegations("ynx_provider")) != 1 {
		t.Fatal("expected restored resource delegation")
	}
	if len(restored.ResourceIncome("ynx_provider")) != 1 {
		t.Fatal("expected restored resource income")
	}
	if restored.ResourceMarketPolicy().PolicyHash != policy.PolicyHash {
		t.Fatalf("expected restored resource policy hash")
	}
}

func TestTransferRequiresTraceableLots(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Transfer("ynx_empty", "ynx_receiver", 1); err == nil {
		t.Fatal("expected transfer to fail without balance")
	}
}

func TestPersistentDevnetRestoresBlocksAndAccounts(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_persist_alice", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Transfer("ynx_persist_alice", "ynx_persist_bob", 125); err != nil {
		t.Fatal(err)
	}
	block := devnet.ProduceBlock()
	if block.Height == 0 {
		t.Fatal("expected produced block")
	}
	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if restored.LatestBlock().Hash != block.Hash {
		t.Fatalf("expected restored latest block")
	}
	account, ok := restored.Account("ynx_persist_bob")
	if !ok {
		t.Fatal("expected restored account")
	}
	if account.Balance != 125 {
		t.Fatalf("expected balance 125, got %d", account.Balance)
	}
	trace, err := restored.TrustTrace("ynx_persist_bob")
	if err != nil {
		t.Fatal(err)
	}
	if len(trace.Lots) != 1 {
		t.Fatalf("expected restored trace lot")
	}
}

func TestEVMLogsPersistAndFilter(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_log_alice", 1000); err != nil {
		t.Fatal(err)
	}
	transfer, err := devnet.Transfer("ynx_log_alice", "ynx_log_bob", 125)
	if err != nil {
		t.Fatal(err)
	}
	block := devnet.ProduceBlock()
	if len(block.Transactions) != 2 || len(block.Transactions[1].Logs) != 1 {
		t.Fatalf("expected transfer log in block: %+v", block.Transactions)
	}
	log := block.Transactions[1].Logs[0]
	if log.TransactionHash != transfer.Hash || log.BlockNumber != block.Height || log.Data == "" || len(log.Topics) != 3 {
		t.Fatalf("unexpected EVM log: %+v", log)
	}
	filtered := devnet.EVMLogs(EVMLogFilter{FromBlock: &block.Height, ToBlock: &block.Height, Addresses: []string{log.Address}, Topics: [][]string{{log.Topics[0]}}})
	if len(filtered) != 1 || filtered[0].TransactionHash != transfer.Hash {
		t.Fatalf("expected filtered transfer log, got %+v", filtered)
	}

	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	restoredLogs := restored.EVMLogs(EVMLogFilter{Addresses: []string{log.Address}})
	if len(restoredLogs) != 1 || restoredLogs[0].TransactionHash != transfer.Hash {
		t.Fatalf("expected restored EVM log, got %+v", restoredLogs)
	}
}

func TestPersistentDevnetRestoresProductState(t *testing.T) {
	dir := t.TempDir()
	cfg := DefaultNetworkConfig("devnet")
	devnet, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.Faucet("ynx_product", 1000); err != nil {
		t.Fatal(err)
	}
	intent, err := devnet.CreatePayIntent("merchant_product", 75, "")
	if err != nil {
		t.Fatal(err)
	}
	invoice, err := devnet.CreateInvoice(intent.ID, 24)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.AddRiskLabel("ynx_product", "reviewed", 100, "unit"); err != nil {
		t.Fatal(err)
	}
	evidence, err := devnet.EvidencePacket("ynx_product")
	if err != nil {
		t.Fatal(err)
	}
	source := "pragma solidity ^0.8.24; contract Persisted { event PersistedEvent(address indexed actor, uint256 amount); }"
	contract, _, err := devnet.DeployContract("ynx_product", "Persisted", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devnet.VerifyContract(contract.Address, source); err != nil {
		t.Fatal(err)
	}

	restored, err := NewPersistentDevnet(cfg, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.Invoice(invoice.ID); !ok {
		t.Fatal("expected restored invoice")
	}
	if _, ok := restored.StoredEvidencePacket(evidence.ID); !ok {
		t.Fatal("expected restored evidence packet")
	}
	if labels := restored.riskLabels["ynx_product"]; len(labels) != 1 || labels[0].SubjectType != "address" {
		t.Fatalf("expected restored address risk label subject type, got %+v", labels)
	}
	restoredContract, ok := restored.Contract(contract.Address)
	if !ok {
		t.Fatal("expected restored contract")
	}
	if !restoredContract.Verified {
		t.Fatal("expected restored contract verification")
	}
	if len(restoredContract.Events) != 1 || restoredContract.Events[0].Signature != "PersistedEvent(address,uint256)" {
		t.Fatalf("expected restored contract event metadata, got %+v", restoredContract.Events)
	}
}

func TestContractDeployEmitsContractSpecificLogs(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_contract_builder", 100); err != nil {
		t.Fatal(err)
	}
	source := "pragma solidity ^0.8.24; contract Events { event Transfer(address indexed from, address indexed to, uint256 value); event Audit(bytes32 indexed id); }"
	contract, tx, err := devnet.DeployContract("ynx_contract_builder", "Events", source)
	if err != nil {
		t.Fatal(err)
	}
	if len(contract.Events) != 2 {
		t.Fatalf("expected two contract events, got %+v", contract.Events)
	}
	block := devnet.ProduceBlock()
	var deployed Transaction
	for _, blockTx := range block.Transactions {
		if blockTx.Hash == tx.Hash {
			deployed = blockTx
			break
		}
	}
	if len(deployed.Logs) != 4 {
		t.Fatalf("expected generic deploy log plus contract-specific logs, got %+v", deployed.Logs)
	}
	eventTopic := contract.Events[0].Topic
	filtered := devnet.EVMLogs(EVMLogFilter{Addresses: []string{contract.Address}, Topics: [][]string{{eventTopic}}})
	if len(filtered) != 1 || filtered[0].Address != contract.Address || filtered[0].Topics[0] != eventTopic {
		t.Fatalf("expected contract event log by address/topic, got %+v", filtered)
	}
}

func TestContractArtifactRuntimeCall(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.Faucet("ynx_contract_runtime", 100); err != nil {
		t.Fatal(err)
	}
	source := "pragma solidity ^0.8.24; contract Runtime { function ping() public pure returns (uint256) { return 7; } function ok() public view returns (bool) { return true; } }"
	contract, _, err := devnet.DeployContract("ynx_contract_runtime", "Runtime", source)
	if err != nil {
		t.Fatal(err)
	}
	if contract.CompilerMode == "" || contract.RuntimeMode == "" || contract.ArtifactHash == "" || len(contract.Functions) != 2 || len(contract.ABI) != 2 {
		t.Fatalf("expected deterministic compile/runtime artifact, got %+v", contract)
	}
	if contract.ArtifactKind != "source-analyzer-artifact" || contract.Compiler.Version != "0.8.24" || !contract.Compiler.Pinned || contract.CompilerConfigHash != contract.Compiler.ConfigHash || contract.ReproducibleBuild {
		t.Fatalf("expected pinned compiler config and unverified analyzer artifact, got %+v", contract)
	}
	if contract.CompilerExecutionStatus != "hardhat_artifact_not_found_for_submitted_source" || contract.DeployedBytecodeHash == "" || contract.DeployedBytecodeComparisonStatus != "not_checked_no_pinned_solc_artifact" {
		t.Fatalf("expected analyzer bytecode status for ad hoc source, got %+v", contract)
	}
	verified, err := devnet.VerifyContract(contract.Address, source)
	if err != nil {
		t.Fatal(err)
	}
	if !verified.ReproducibleBuild || verified.VerifierStatus != "source_hash_and_pinned_compiler_config_matched_local_artifact" || verified.CompilerConfigHash != contract.CompilerConfigHash {
		t.Fatalf("expected verifier to record source and compiler config match, got %+v", verified)
	}
	result, err := devnet.CallContract(contract.Address, "ping")
	if err != nil {
		t.Fatal(err)
	}
	if result.ReturnValue != "7" || result.EncodedResult != "0x0000000000000000000000000000000000000000000000000000000000000007" {
		t.Fatalf("unexpected ping result: %+v", result)
	}
	selectorResult, err := devnet.CallContract(contract.Address, contract.Functions[1].Selector)
	if err != nil {
		t.Fatal(err)
	}
	if selectorResult.ReturnValue != "true" || selectorResult.EncodedResult != "0x0000000000000000000000000000000000000000000000000000000000000001" {
		t.Fatalf("unexpected bool result: %+v", selectorResult)
	}
}

func TestPayIdempotencyEventsAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	intent, err := devnet.CreatePayIntentWithIdempotency("merchant_pay", 75, "https://merchant.example/callback", "intent-key-1")
	if err != nil {
		t.Fatal(err)
	}
	duplicateIntent, err := devnet.CreatePayIntentWithIdempotency("merchant_pay", 99, "", "intent-key-1")
	if err != nil {
		t.Fatal(err)
	}
	if duplicateIntent.ID != intent.ID || duplicateIntent.Amount != 75 {
		t.Fatalf("expected idempotent intent replay, got %+v original %+v", duplicateIntent, intent)
	}
	invoice, err := devnet.CreateInvoiceWithIdempotency(intent.ID, 12, "invoice-key-1")
	if err != nil {
		t.Fatal(err)
	}
	duplicateInvoice, err := devnet.CreateInvoiceWithIdempotency(intent.ID, 48, "invoice-key-1")
	if err != nil {
		t.Fatal(err)
	}
	if duplicateInvoice.ID != invoice.ID || !duplicateInvoice.DueAt.Equal(invoice.DueAt) {
		t.Fatalf("expected idempotent invoice replay, got %+v original %+v", duplicateInvoice, invoice)
	}
	refund, err := devnet.CreateRefundWithIdempotency(intent.ID, 10, "unit", "refund-key-1")
	if err != nil {
		t.Fatal(err)
	}
	duplicateRefund, err := devnet.CreateRefundWithIdempotency(intent.ID, 20, "changed", "refund-key-1")
	if err != nil {
		t.Fatal(err)
	}
	if duplicateRefund.ID != refund.ID || duplicateRefund.Amount != 10 {
		t.Fatalf("expected idempotent refund replay, got %+v original %+v", duplicateRefund, refund)
	}
	webhook, err := devnet.SignWebhookWithIdempotency(intent.ID, "payment_intent.created", "unit-signing-key", "webhook-key-1")
	if err != nil {
		t.Fatal(err)
	}
	duplicateWebhook, err := devnet.SignWebhookWithIdempotency(intent.ID, "payment_intent.created", "different-key", "webhook-key-1")
	if err != nil {
		t.Fatal(err)
	}
	if duplicateWebhook.EventID != webhook.EventID || duplicateWebhook.Signature != webhook.Signature || !duplicateWebhook.ReplaySafe {
		t.Fatalf("expected idempotent webhook replay, got %+v original %+v", duplicateWebhook, webhook)
	}
	events := devnet.PayEvents(intent.ID)
	if len(events) != 4 {
		t.Fatalf("expected four pay audit events, got %+v", events)
	}
	for _, event := range events {
		if event.AuditHash == "" {
			t.Fatalf("expected audit hash in event: %+v", event)
		}
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if restoredWebhook, ok := restored.WebhookSignature(webhook.EventID); !ok || restoredWebhook.PayloadHash == "" {
		t.Fatalf("expected restored webhook signature, got %+v ok=%v", restoredWebhook, ok)
	}
	if len(restored.PayEvents(intent.ID)) != 4 {
		t.Fatalf("expected restored pay events")
	}
}

func TestAIPermissionsSensitiveActionsAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	proposal, err := devnet.ProposeAIAction(AIActionProposalInput{SessionID: "ai-session-1", Requester: "merchant_ops", Scope: "value_movement", ActionType: "transfer", Description: "Move value for a merchant settlement"})
	if err != nil {
		t.Fatal(err)
	}
	if !proposal.Sensitive || !proposal.RequiresApproval || proposal.Executable || proposal.Status != "pending_approval" || proposal.AuditHash == "" || proposal.TransparencyEntryID == "" {
		t.Fatalf("expected non-executable sensitive proposal with audit metadata: %+v", proposal)
	}
	if _, err := devnet.ApproveAIAction(proposal.ID, AIActionApprovalInput{Approver: "reviewer_1", PermissionID: "missing"}); err == nil {
		t.Fatal("expected approval without matching permission to fail")
	}
	grant, err := devnet.RequestAIPermission(AIPermissionInput{SessionID: "ai-session-1", Requester: "merchant_ops", Scope: "value_movement", Purpose: "merchant settlement approval", ExpiryHours: 2})
	if err != nil {
		t.Fatal(err)
	}
	if grant.AuditHash == "" || !grant.ExpiresAt.After(grant.CreatedAt) || grant.Status != "active" {
		t.Fatalf("expected active audited AI permission: %+v", grant)
	}
	approved, err := devnet.ApproveAIAction(proposal.ID, AIActionApprovalInput{Approver: "reviewer_1", PermissionID: grant.ID})
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != "approved" || !approved.Executable || approved.PermissionID != grant.ID || approved.ApprovedBy != "reviewer_1" || approved.AuditHash == proposal.AuditHash {
		t.Fatalf("expected approved executable AI action with refreshed audit hash: %+v", approved)
	}
	nonSensitive, err := devnet.ProposeAIAction(AIActionProposalInput{SessionID: "ai-session-1", Requester: "merchant_ops", Scope: "status_read", ActionType: "summarize", Description: "Summarize public chain status"})
	if err != nil {
		t.Fatal(err)
	}
	if nonSensitive.Sensitive || !nonSensitive.Executable || nonSensitive.Status != "logged" {
		t.Fatalf("expected non-sensitive action to be audit-logged and executable: %+v", nonSensitive)
	}
	if len(devnet.AIActions("ai-session-1")) != 2 {
		t.Fatalf("expected two AI action records")
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("devnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if restoredGrant, ok := restored.AIPermission(grant.ID); !ok || restoredGrant.AuditHash == "" {
		t.Fatalf("expected restored AI permission, got %+v ok=%v", restoredGrant, ok)
	}
	if restoredAction, ok := restored.AIAction(proposal.ID); !ok || !restoredAction.Executable || restoredAction.PermissionID != grant.ID {
		t.Fatalf("expected restored approved AI action, got %+v ok=%v", restoredAction, ok)
	}
}

func TestTrustEvidenceRiskSummaryExcludesLowConfidenceAndExpiredLabels(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	if _, err := devnet.AddRiskLabelFromInput(RiskLabelInput{Subject: "ynx_risk_subject", Label: "reviewed-risk", RiskWeightBps: 8000, ConfidenceBps: 8000, Source: "unit-active", EvidenceHash: "sha256:active", ExpiryHours: 24, ReviewRequired: true}); err != nil {
		t.Fatal(err)
	}
	low, err := devnet.AddRiskLabelFromInput(RiskLabelInput{Subject: "ynx_risk_subject", Label: "low-confidence-risk", RiskWeightBps: 9000, ConfidenceBps: 3000, Source: "unit-low", EvidenceHash: "sha256:low", ExpiryHours: 24})
	if err != nil {
		t.Fatal(err)
	}
	expiredAt := time.Now().UTC().Add(-time.Hour)
	expired := RiskLabel{ID: "expired_label", Subject: "ynx_risk_subject", Address: "ynx_risk_subject", Label: "expired-risk", LabelType: "risk", Severity: "high", RiskWeightBps: 9000, ConfidenceBps: 9000, Source: "unit-expired", EvidenceHash: "sha256:expired", CreatedAt: expiredAt.Add(-time.Hour), UpdatedAt: expiredAt.Add(-time.Hour), ExpiresAt: &expiredAt, AppealAvailable: true, DisputeStatus: "not_disputed", LegalStatusUnderYNXChainLaw: "advisory_label_only_not_criminal_determination", AssetEffect: "none_advisory_only"}
	devnet.mu.Lock()
	devnet.riskLabels["ynx_risk_subject"] = append(devnet.riskLabels["ynx_risk_subject"], expired)
	devnet.mu.Unlock()

	packet, err := devnet.EvidencePacket("ynx_risk_subject")
	if err != nil {
		t.Fatal(err)
	}
	summary := packet.RiskSummary
	if summary.ActiveLabelCount != 1 || summary.LowConfidenceLabelCount != 1 || summary.ExpiredLabelCount != 1 {
		t.Fatalf("expected active/low/expired counts, got %+v", summary)
	}
	if summary.EffectiveRiskWeightBps != 6400 || summary.Conclusion != "ADVISORY_RISK_REQUIRES_CONTEXT_REVIEW" {
		t.Fatalf("expected weighted advisory risk summary, got %+v", summary)
	}
	if !containsString(summary.NonConclusiveLabelIDs, low.ID) || !containsString(summary.NonConclusiveLabelIDs, expired.ID) {
		t.Fatalf("expected low-confidence and expired labels to be non-conclusive: %+v", summary)
	}
	if len(summary.ActiveEvidenceHashes) != 1 || summary.ActiveEvidenceHashes[0] != "sha256:active" {
		t.Fatalf("expected only active evidence hash, got %+v", summary.ActiveEvidenceHashes)
	}
	if summary.AssetEffect != "none_advisory_only" || summary.AppealPath != "/trust/appeals" || !summary.HasOpenReview {
		t.Fatalf("expected appealable advisory summary, got %+v", summary)
	}
}

func TestRiskLabelsDistinguishAddressAndKnownTransactionSubjects(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("devnet"))
	addressLabel, err := devnet.AddRiskLabelFromInput(RiskLabelInput{Subject: "ynx_risk_subject", Label: "address-review", RiskWeightBps: 100, Source: "unit-address", EvidenceHash: "sha256:address"})
	if err != nil {
		t.Fatal(err)
	}
	if addressLabel.SubjectType != "address" || addressLabel.Address != "ynx_risk_subject" {
		t.Fatalf("expected default address subject: %+v", addressLabel)
	}
	tx, err := devnet.Faucet("ynx_tx_risk_subject", 10)
	if err != nil {
		t.Fatal(err)
	}
	txLabel, err := devnet.AddRiskLabelFromInput(RiskLabelInput{Subject: tx.Hash, SubjectType: "transaction", Label: "transaction-review", RiskWeightBps: 250, Source: "unit-transaction", EvidenceHash: "sha256:transaction"})
	if err != nil {
		t.Fatal(err)
	}
	if txLabel.SubjectType != "transaction" || txLabel.Subject != tx.Hash || txLabel.Address != "" {
		t.Fatalf("expected transaction subject without address alias: %+v", txLabel)
	}
	if _, err := devnet.AddRiskLabelFromInput(RiskLabelInput{Subject: "0x" + strings.Repeat("0", 64), SubjectType: "transaction", Label: "unknown-transaction", Source: "unit-transaction", EvidenceHash: "sha256:missing"}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("expected unknown transaction to be rejected, got %v", err)
	}
	if _, err := devnet.AddRiskLabelFromInput(RiskLabelInput{Subject: "not-a-hash", SubjectType: "transaction", Label: "invalid-transaction", Source: "unit-transaction", EvidenceHash: "sha256:invalid"}); err == nil || !strings.Contains(err.Error(), "32-byte") {
		t.Fatalf("expected malformed transaction hash to be rejected, got %v", err)
	}
}

func TestGovernanceRequestClassificationAppealTransparencyAndPersistence(t *testing.T) {
	dir := t.TempDir()
	devnet, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	illegal, err := devnet.CreateGovernanceRequest(GovernanceRequestInput{
		Requester:   "agency_case_1",
		Subject:     "ynx_subject",
		Action:      "freeze native YNXT without evidence",
		AssetType:   "YNXT",
		Scope:       "ynx_subject",
		Description: "Freeze native YNXT directly from protocol controls.",
	})
	if err != nil {
		t.Fatal(err)
	}
	if illegal.Classification != RequestIllegalOrAbusive || illegal.Status != "rejected" {
		t.Fatalf("expected illegal rejected request: %+v", illegal)
	}
	if !illegal.NativeYNXTProtected || illegal.TransparencyEntryID == "" {
		t.Fatalf("expected native YNXT protection and transparency entry: %+v", illegal)
	}
	if !containsString(illegal.RuleIDs, "native-ynxt-no-direct-freeze") {
		t.Fatalf("expected native YNXT rule id: %+v", illegal)
	}
	report := devnet.TransparencyReport()
	if report.EntryCount != 1 || report.RejectedCount != 1 {
		t.Fatalf("expected rejected transparency entry: %+v", report)
	}

	review, err := devnet.CreateGovernanceRequest(GovernanceRequestInput{
		Requester:   "merchant_risk",
		Subject:     "ynx_subject",
		Action:      "risk label review",
		AssetType:   "stablecoin",
		Scope:       "single transfer",
		Description: "Review a scoped risk label with attached case evidence.",
		Evidence:    []string{"case:42", "tx:0xabc"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if review.Classification != RequestRequiresReview || !review.RequiresUserNotice {
		t.Fatalf("expected governance review classification: %+v", review)
	}
	if !containsString(review.RuleIDs, "governance-review-user-rights") {
		t.Fatalf("expected governance review rule id: %+v", review)
	}
	if _, err := devnet.CreateTrustAppeal(TrustAppealInput{RequestID: "missing_request", Subject: "ynx_subject", Appellant: "ynx_subject", Reason: "missing request should not open appeal"}); err == nil {
		t.Fatal("expected appeal with missing governance request to fail")
	}
	if _, err := devnet.CreateTrustAppeal(TrustAppealInput{LabelID: "missing_label", Subject: "ynx_subject", Appellant: "ynx_subject", Reason: "missing label should not open appeal"}); err == nil {
		t.Fatal("expected appeal with missing Trust label to fail")
	}
	appeal, err := devnet.CreateTrustAppeal(TrustAppealInput{RequestID: review.ID, Subject: "ynx_subject", Appellant: "ynx_subject", Reason: "label is a false positive", Evidence: []string{"wallet ownership proof"}})
	if err != nil {
		t.Fatal(err)
	}
	if appeal.Status != "SUBMITTED" || appeal.TransparencyEntryID == "" {
		t.Fatalf("expected open appeal with transparency entry: %+v", appeal)
	}
	resolved, err := devnet.ResolveTrustAppeal(appeal.ID, TrustAppealDecisionInput{Reviewer: "reviewer_1", Decision: "LABEL_REMOVED", ResolutionReason: "evidence proved false positive"})
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Status != "LABEL_REMOVED" || resolved.Reviewer != "reviewer_1" || resolved.ResolutionReason == "" {
		t.Fatalf("expected resolved appeal: %+v", resolved)
	}
	labels := devnet.riskLabels["ynx_subject"]
	if len(labels) == 0 || labels[len(labels)-1].Label != "false-positive-corrected" || labels[len(labels)-1].RiskWeightBps != 0 {
		t.Fatalf("expected false-positive correction label: %+v", labels)
	}
	correction := labels[len(labels)-1]
	if correction.ID == "" || correction.Source != "appeal:"+appeal.ID || correction.EvidenceHash == "" || !correction.AppealAvailable || correction.AssetEffect != "none_advisory_only" || correction.LegalStatusUnderYNXChainLaw == "" {
		t.Fatalf("expected rich correction label metadata: %+v", correction)
	}
	tracking, err := devnet.CreateTrackingPolicyReview(TrackingPolicyReviewInput{Requester: "merchant_risk", Subject: "ynx_subject", Purpose: "single transaction screening", QueryType: "trace", Scope: "single transfer", Description: "purpose limited check", Evidence: []string{"case:42"}, MinimumNecessary: true, ConfidenceBps: 7500, ExpiryHours: 24})
	if err != nil {
		t.Fatal(err)
	}
	if tracking.Classification != RequestValidUnderYNXChainLaw || tracking.Status != "logged" || tracking.LabelExpiresAt == nil || tracking.AppealPath == "" {
		t.Fatalf("expected valid tracking review: %+v", tracking)
	}
	if !containsString(tracking.RuleIDs, "tracking-purpose-limited-valid") {
		t.Fatalf("expected tracking rule id: %+v", tracking)
	}
	overbroad, err := devnet.CreateTrackingPolicyReview(TrackingPolicyReviewInput{Requester: "merchant_risk", Subject: "ynx_subject", Purpose: "bulk profile all wallets", QueryType: "batch", Scope: "all wallets", Description: "mass tracking", Evidence: []string{"case:bulk"}, MinimumNecessary: false})
	if err != nil {
		t.Fatal(err)
	}
	if overbroad.Classification != RequestOverbroad || overbroad.Status != "rejected" {
		t.Fatalf("expected overbroad tracking rejection: %+v", overbroad)
	}

	restored, err := NewPersistentDevnet(DefaultNetworkConfig("testnet"), dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := restored.GovernanceRequest(illegal.ID); !ok {
		t.Fatal("expected restored governance request")
	}
	if _, ok := restored.TrustAppeal(appeal.ID); !ok {
		t.Fatal("expected restored trust appeal")
	}
	if restoredAppeal, ok := restored.TrustAppeal(appeal.ID); !ok || restoredAppeal.Status != "LABEL_REMOVED" {
		t.Fatalf("expected restored resolved appeal, got %+v ok=%v", restoredAppeal, ok)
	}
	if _, ok := restored.TrackingPolicyReview(tracking.ID); !ok {
		t.Fatal("expected restored tracking review")
	}
	report = restored.TransparencyReport()
	if report.AppealCount != 1 || report.ReviewCount == 0 {
		t.Fatalf("expected restored appeal and review counts: %+v", report)
	}
}

func TestGovernanceRequestClassificationMatrix(t *testing.T) {
	devnet := NewDevnet(DefaultNetworkConfig("testnet"))
	cases := []struct {
		name           string
		input          GovernanceRequestInput
		classification RequestValidityStatus
		status         string
		ruleID         string
		notice         bool
	}{
		{
			name: "seed phrase request",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "export seed phrase",
				AssetType:   "wallet",
				Scope:       "single wallet",
				Description: "send seed phrase and mnemonic for custody bypass",
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "protect-private-secrets",
			notice:         true,
		},
		{
			name: "signature bypass",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "bypass user signatures",
				AssetType:   "token",
				Scope:       "single transfer",
				Description: "skip signature checks for a transfer",
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "no-signature-bypass",
			notice:         true,
		},
		{
			name: "hide request records",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "hide request records",
				AssetType:   "evidence",
				Scope:       "single case",
				Description: "delete audit logs and hide request records",
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "preserve-audit-transparency",
			notice:         true,
		},
		{
			name: "fake risk label",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "create fake risk label",
				AssetType:   "risk_label",
				Scope:       "single address",
				Description: "fabricate risk label without support",
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "no-evidence-free-risk",
			notice:         true,
		},
		{
			name: "unsupported trust conclusion",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "ask Trust to output unsupported conclusions",
				AssetType:   "trust_label",
				Scope:       "single address",
				Description: "unsupported conclusion that declares guilt",
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "no-evidence-free-risk",
			notice:         true,
		},
		{
			name: "ai automatic punishment",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "ask AI to automatically punish users",
				AssetType:   "trust_label",
				Scope:       "single address",
				Description: "AI automatically punish the account",
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "no-ai-punishment",
			notice:         true,
		},
		{
			name: "overbroad tracking",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "trace all wallets",
				AssetType:   "stablecoin",
				Scope:       "all wallets",
				Description: "mass tracking everyone",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestOverbroad,
			status:         "rejected",
			ruleID:         "targeted-scope-required",
			notice:         true,
		},
		{
			name: "native ynxt direct freeze",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "freeze native YNXT",
				AssetType:   "YNXT",
				Scope:       "single account",
				Description: "directly freeze user native YNXT",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "native-ynxt-no-direct-freeze",
			notice:         true,
		},
		{
			name: "native ynxt direct transfer",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "direct transfer user native YNXT",
				AssetType:   "native",
				Scope:       "single account",
				Description: "transfer user native YNXT without user signature",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "native-ynxt-no-direct-freeze",
			notice:         true,
		},
		{
			name: "native ynxt seize",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "seize native YNXT",
				AssetType:   "native_ynxt",
				Scope:       "single account",
				Description: "confiscate user native YNXT by request",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "native-ynxt-no-direct-freeze",
			notice:         true,
		},
		{
			name: "native ynxt blacklist",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "blacklist native YNXT account",
				AssetType:   "YNXT",
				Scope:       "single account",
				Description: "blacklist native YNXT balance by protocol request",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestIllegalOrAbusive,
			status:         "rejected",
			ruleID:         "native-ynxt-no-direct-freeze",
			notice:         true,
		},
		{
			name: "unsupported asset boundary",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "review off-chain bank account",
				AssetType:   "bank_account",
				Scope:       "single external account",
				Description: "off-chain asset request should stay outside YNX Chain asset controls",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestOutOfScope,
			status:         "rejected",
			ruleID:         "asset-type-boundary",
			notice:         true,
		},
		{
			name: "user notice only",
			input: GovernanceRequestInput{
				Requester:   "matrix_agency",
				Subject:     "ynx_matrix_subject",
				Action:      "notify user about appeal notice",
				AssetType:   "trust_label",
				Scope:       "single address",
				Description: "create transparency notice for a disputed label",
				Evidence:    []string{"case:matrix"},
			},
			classification: RequestRequiresUserNotice,
			status:         "notice_required",
			ruleID:         "user-notice-required",
			notice:         true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request, err := devnet.CreateGovernanceRequest(tc.input)
			if err != nil {
				t.Fatal(err)
			}
			if request.Classification != tc.classification || request.Status != tc.status {
				t.Fatalf("expected %s/%s, got %+v", tc.classification, tc.status, request)
			}
			if !containsString(request.RuleIDs, tc.ruleID) {
				t.Fatalf("expected rule id %s, got %+v", tc.ruleID, request.RuleIDs)
			}
			if request.RequiresUserNotice != tc.notice {
				t.Fatalf("expected requiresUserNotice=%v, got %+v", tc.notice, request)
			}
			if request.TransparencyEntryID == "" {
				t.Fatalf("expected transparency entry: %+v", request)
			}
		})
	}
	report := devnet.TransparencyReport()
	if report.EntryCount != len(cases) || report.RejectedCount != len(cases)-1 {
		t.Fatalf("expected transparency counts for matrix, got %+v", report)
	}
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
