package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/governance"
	"github.com/JiahaoAlbus/YNX-Chain/internal/nativewallet"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

const (
	testnetVotingPeriod = 2 * time.Second
	testnetTimelock     = 5*time.Minute + 15*time.Second
	testnetCanaryWindow = 5 * time.Minute
)

type drillIdentity struct {
	Account    string `json:"account"`
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
}

type drillIdentities struct {
	Voter    drillIdentity `json:"voter"`
	Operator drillIdentity `json:"operator"`
	Verifier drillIdentity `json:"verifier"`
}

type drillResult struct {
	Version           int      `json:"version"`
	ProposalID        string   `json:"proposalId"`
	GovernanceStatus  string   `json:"governanceStatus"`
	ChainStatus       string   `json:"chainStatus"`
	BeginTxHash       string   `json:"beginTxHash"`
	VerifyTxHash      string   `json:"verifyTxHash"`
	VerificationBlock string   `json:"verificationBlockHash"`
	ValidatorRPCs     []string `json:"validatorRpcs"`
}

type sourceResponse[T any] struct {
	Data    T         `json:"data"`
	Source  string    `json:"source"`
	AsOf    time.Time `json:"asOf"`
	Version string    `json:"version"`
}

type gatewayClient struct {
	baseURL string
	key     []byte
	client  *http.Client
}

func main() {
	mode := flag.String("mode", "", "prepare, run, or check")
	work := flag.String("work", "", "absolute ephemeral work directory")
	httpAddress := flag.String("http-address", "", "loopback governanced listen address")
	rpcURLs := flag.String("rpc-urls", "", "comma-separated loopback CometBFT RPC URLs")
	executionSigner := flag.String("execution-signer", "", "canonical Chain Core execution signer")
	executionKey := flag.String("execution-key", "", "ephemeral Chain Core execution signer key")
	executionNonce := flag.Uint64("execution-nonce", 1, "next Chain Core execution signer nonce")
	sourceCommit := flag.String("source-commit", "", "source commit bound into the testnet proposal")
	flag.Parse()

	var err error
	switch *mode {
	case "prepare":
		err = prepare(*work, *httpAddress, firstRPC(*rpcURLs), *executionSigner)
	case "run":
		err = run(*work, *rpcURLs, *executionKey, *sourceCommit, *executionNonce)
	case "chain-check":
		err = chainCheck(*rpcURLs, *executionKey, *executionNonce)
	case "check":
		err = check(*work)
	default:
		err = errors.New("-mode must be prepare, chain-check, run, or check")
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func prepare(work, httpAddress, rpcURL, executionSigner string) error {
	if !filepath.IsAbs(work) || strings.TrimSpace(httpAddress) == "" || strings.TrimSpace(rpcURL) == "" ||
		!consensus.IsNativeAddress(strings.TrimSpace(executionSigner)) {
		return errors.New("prepare requires an absolute work directory, loopback endpoints, and canonical execution signer")
	}
	if err := os.MkdirAll(work, 0o700); err != nil {
		return err
	}
	identities, err := newDrillIdentities()
	if err != nil {
		return err
	}
	gatewayKey := make([]byte, 32)
	if _, err = rand.Read(gatewayKey); err != nil {
		return err
	}
	now := time.Now().UTC()
	role := func(account string, governanceRole governance.GovernanceRole, threshold uint64) governance.RoleAssignmentInput {
		return governance.RoleAssignmentInput{
			Account: account, Role: governanceRole, Scopes: []governance.Scope{governance.ScopeBridge},
			TermStartsAt: now.Add(-30 * time.Second), TermEndsAt: now.Add(24 * time.Hour),
			DecisionThreshold: threshold, ConflictDisclosure: "No ownership or compensation conflict is disclosed.",
			Evidence: []string{"sha256:ephemeral-testnet-role-ceremony"},
		}
	}
	roles := []governance.RoleAssignmentInput{
		role("technical-council-1", governance.RoleTechnicalCouncil, 2),
		role("technical-council-2", governance.RoleTechnicalCouncil, 2),
		role("security-council-1", governance.RoleSecurityCouncil, 2),
		role("security-council-2", governance.RoleSecurityCouncil, 2),
		role("treasury-council-1", governance.RoleTreasuryCouncil, 2),
		role("treasury-council-2", governance.RoleTreasuryCouncil, 2),
		role("emergency-council-1", governance.RoleEmergencyCouncil, 3),
		role("emergency-council-2", governance.RoleEmergencyCouncil, 3),
		role("emergency-council-3", governance.RoleEmergencyCouncil, 3),
		role(identities.Voter.Account, governance.RoleTokenHolder, 1),
		role(identities.Operator.Account, governance.RoleExecutionOperator, 1),
		role(identities.Verifier.Account, governance.RoleAuditor, 1),
	}
	manifestHash, err := governance.GenesisRoleManifestHash(roles)
	if err != nil {
		return err
	}
	config := governance.RuntimeConfig{
		SchemaVersion:  "ynx-governanced-config/v4",
		HTTPAddress:    httpAddress,
		StatePath:      filepath.Join(work, "governance-state.json"),
		GatewayKeyPath: filepath.Join(work, "gateway.key"),
		Policy: governance.RuntimePolicyConfig{
			ChainID: "ynx-governance-testnet-1", VoteDomain: "ynx-governance.vote.v1",
			VoteReplacementPolicy: "replace_before_deadline", VoteWithdrawalPolicy: "withdraw_before_deadline",
			VoteMaxClockSkew: "2m", MinimumDeposit: 100, QuorumBPS: 5000, ThresholdBPS: 6667,
			VotingPeriod: testnetVotingPeriod.String(), Timelock: testnetTimelock.String(), TimelockGrace: "5m",
			MaxLifetime: "30m", EmergencyThreshold: 3, EmergencyMaxDuration: "10m",
			ParameterRules: map[string]governance.ParameterRule{
				"/bridge/dailyLimit": {Scope: governance.ScopeBridge, Numeric: true, Minimum: 10, Maximum: 1000},
			},
			GenesisRoleManifestHash: manifestHash, ElectorateApprovalThreshold: 2,
		},
		GenesisRoles: roles,
		ChainCore: &governance.RuntimeChainCoreConfig{
			RPCURL: rpcURL, ChainID: 6423, ExecutionSigner: strings.ToLower(executionSigner), RequestTimeout: "20s",
		},
	}
	if err = writeRestrictedJSON(filepath.Join(work, "identities.json"), identities); err != nil {
		return err
	}
	if err = os.WriteFile(config.GatewayKeyPath, []byte(hex.EncodeToString(gatewayKey)+"\n"), 0o600); err != nil {
		return err
	}
	if err = os.Chmod(config.GatewayKeyPath, 0o600); err != nil {
		return err
	}
	if err = writeRestrictedJSON(filepath.Join(work, "governanced.json"), config); err != nil {
		return err
	}
	_, _, err = governance.ValidateRuntimeConfig(config)
	return err
}

func run(work, rpcValues, executionKeyPath, sourceCommit string, executionNonce uint64) error {
	config, identities, gatewayKey, err := loadDrill(work)
	if err != nil {
		return err
	}
	rpcURLs := splitRPCs(rpcValues)
	if len(rpcURLs) < 3 || !validSourceCommit(sourceCommit) {
		return errors.New("run requires at least three validator RPCs and a canonical source commit")
	}
	executionKeyBytes, err := os.ReadFile(executionKeyPath)
	if err != nil || len(executionKeyBytes) != 32 {
		return errors.New("read canonical ephemeral execution key")
	}
	executionKey := secp256k1.PrivKeyFromBytes(executionKeyBytes)
	if !bytes.Equal(executionKey.Serialize(), executionKeyBytes) {
		return errors.New("ephemeral execution key is not a canonical scalar")
	}
	client := &gatewayClient{
		baseURL: "http://" + config.HTTPAddress, key: gatewayKey,
		client: &http.Client{Timeout: 30 * time.Second},
	}
	voterKey, err := identities.Voter.privateKey()
	if err != nil {
		return err
	}
	operatorKey, err := identities.Operator.privateKey()
	if err != nil {
		return err
	}
	verifierKey, err := identities.Verifier.privateKey()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	numeric := int64(200)
	proposalInput := governance.ProposalInput{
		Nonce: "testnet-proposal-" + randomHex(12), ProposalType: "bridge_limit_change",
		Scope: governance.ScopeBridge, Owner: "bridge-protocol-owner",
		Summary:            "Raise the bounded bridge daily limit after public review.",
		Motivation:         "Exercise the complete distributed governance lifecycle on Testnet.",
		TechnicalImpact:    "Changes one bounded bridge parameter after signed approval.",
		EconomicImpact:     "No fee or issuance rule changes are included in this proposal.",
		SecurityRisk:       "Higher flow is bounded by the configured authoritative maximum.",
		UserImpact:         "Testnet users receive a public and reversible parameter update.",
		ProviderImpact:     "Bridge providers must observe the newly verified daily limit.",
		Migration:          "Apply the exact machine diff only after the timelock and canary.",
		Rollback:           "Restore the previous daily limit using the bound rollback action.",
		CanaryPlan:         "Observe the signed Testnet cohort for five complete minutes.",
		VerificationPlan:   "Verify CometBFT receipt, state root, block, and audit hashes.",
		ConflictDisclosure: "No provider ownership or compensation conflict is disclosed.",
		Dependencies:       []string{"Chain Core", "CometBFT", "Gateway assertion"},
		Evidence:           []string{"sha256:governance-testnet-multiprocess-drill"},
		Changes: []governance.ParameterChange{{
			Path: "/bridge/dailyLimit", Before: "100", After: "200", Minimum: 10, Maximum: 1000, Numeric: &numeric,
		}},
		SourceCommit: strings.ToLower(sourceCommit), Release: "governance-testnet-drill",
		ExpiresAt: now.Add(25 * time.Minute),
	}
	proposal, err := postJSON[governance.Proposal](client, "/governance/proposals", identities.Voter.Account, proposalInput)
	if err != nil {
		return fmt.Errorf("create proposal: %w", err)
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/deposit"), identities.Voter.Account, map[string]uint64{"amount": 100})
	if err != nil {
		return fmt.Errorf("deposit: %w", err)
	}
	simulation := governance.Simulation{
		TechnicalEvidence:  "sha256:testnet-technical-simulation",
		EconomicEvidence:   "sha256:testnet-economic-simulation",
		SecurityEvidence:   "sha256:testnet-security-simulation",
		UserImpactEvidence: "sha256:testnet-user-impact-simulation",
		Passed:             true,
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/simulation"), "technical-council-1", simulation)
	if err != nil {
		return fmt.Errorf("simulation: %w", err)
	}
	electorateHash := strings.Repeat("1", 64)
	electorate := map[string]any{
		"snapshot": governance.VotingSnapshot{
			BasePower: map[string]uint64{identities.Voter.Account: 100}, Delegations: map[string]string{},
		},
		"evidenceHash": electorateHash, "sourceVersion": "testnet-electorate/v1", "snapshotAsOf": time.Now().UTC(),
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/electorate"), "technical-council-1", electorate)
	if err != nil {
		return fmt.Errorf("submit electorate: %w", err)
	}
	for _, approver := range []string{"technical-council-1", "technical-council-2"} {
		proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/electorate/approve"), approver, map[string]any{})
		if err != nil {
			return fmt.Errorf("approve electorate as %s: %w", approver, err)
		}
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/voting"), "technical-council-1", map[string]any{})
	if err != nil {
		return fmt.Errorf("open voting: %w", err)
	}
	vote := governance.SignedVoteEnvelope{
		Version: governance.SignedVoteVersion, Domain: config.Policy.VoteDomain, ChainID: config.Policy.ChainID,
		ProposalID: proposal.ID, Voter: identities.Voter.Account, Choice: "yes", Operation: governance.VoteOperationCast,
		Revision: 1, Nonce: "testnet-vote-" + randomHex(12), PublicKey: identities.Voter.PublicKey,
		ElectorateEvidenceHash: electorateHash, SignedAt: time.Now().UTC(), ExpiresAt: proposal.VotingEndsAt,
	}
	vote, err = governance.SignVoteEnvelope(vote, voterKey)
	if err != nil {
		return err
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/votes"), identities.Voter.Account, vote)
	if err != nil {
		return fmt.Errorf("cast signed vote: %w", err)
	}
	sleepUntil(proposal.VotingEndsAt.Add(150 * time.Millisecond))
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/finalize"), "technical-council-1", map[string]any{})
	if err != nil {
		return fmt.Errorf("finalize vote: %w", err)
	}
	if proposal.Status != governance.StatusTimelockActive {
		return fmt.Errorf("unexpected finalized proposal status %s", proposal.Status)
	}
	canaries, err := getJSON[struct {
		Canaries []governance.CanaryRecord `json:"canaries"`
	}](client, "/governance/canaries")
	if err != nil || len(canaries.Canaries) != 1 {
		return errors.New("canonical canary record is unavailable")
	}
	canary := canaries.Canaries[0]
	manifestHash := strings.Repeat("a", 64)
	startsAt := time.Now().UTC()
	canaryEnvelope := governance.SignedCanaryEnvelope{
		Version: governance.SignedCanaryVersion, Domain: config.Policy.VoteDomain + ".canary", ChainID: config.Policy.ChainID,
		ProposalID: proposal.ID, ActionHash: proposal.ActionHash, ManifestHash: manifestHash,
		CanaryPlanHash: canary.CanaryPlanHash, CohortManifestHash: strings.Repeat("7", 64),
		TargetBPS: 500, MinimumSamples: 100, MaxFailureBPS: 100,
		StartsAt: startsAt, EndsAt: startsAt.Add(testnetCanaryWindow),
		Nonce: "testnet-canary-" + randomHex(12), Operator: identities.Operator.Account,
		PublicKey: identities.Operator.PublicKey, Evidence: []string{"sha256:testnet-bounded-canary-cohort"},
	}
	canaryEnvelope, err = governance.SignCanaryEnvelope(canaryEnvelope, operatorKey)
	if err != nil {
		return err
	}
	canary, err = postJSON[governance.CanaryRecord](client, proposalPath(proposal.ID, "/canary/start"), identities.Operator.Account, canaryEnvelope)
	if err != nil {
		return fmt.Errorf("start signed canary: %w", err)
	}
	fmt.Printf("governance testnet canary running: proposal=%s wait=%s\n", proposal.ID, time.Until(canary.Envelope.EndsAt).Round(time.Second))
	sleepUntil(canary.Envelope.EndsAt.Add(150 * time.Millisecond))
	observedTo := time.Now().UTC()
	canaryResult := governance.SignedCanaryResultEnvelope{
		Version: governance.SignedCanaryResultVersion, Domain: config.Policy.VoteDomain + ".canary.result", ChainID: config.Policy.ChainID,
		ProposalID: proposal.ID, CanaryID: canary.ID, ManifestHash: manifestHash,
		CohortManifestHash: canary.Envelope.CohortManifestHash, TotalSamples: 100, FailedSamples: 0,
		MetricsHash: strings.Repeat("8", 64), StateRoot: "0x" + strings.Repeat("9", 64),
		ObservedFrom: canary.Envelope.StartsAt, ObservedTo: observedTo,
		Nonce: "testnet-canary-result-" + randomHex(12), Verifier: identities.Verifier.Account,
		PublicKey: identities.Verifier.PublicKey, Evidence: []string{"sha256:testnet-canary-health-window"},
	}
	canaryResult, err = governance.SignCanaryResultEnvelope(canaryResult, verifierKey)
	if err != nil {
		return err
	}
	canary, err = postJSON[governance.CanaryRecord](client, proposalPath(proposal.ID, "/canary/complete"), identities.Verifier.Account, canaryResult)
	if err != nil || canary.Status != governance.CanaryPassed {
		return fmt.Errorf("complete signed canary: status=%s err=%v", canary.Status, err)
	}
	sleepUntil(proposal.ExecuteAfter.Add(150 * time.Millisecond))
	prepared, err := postJSON[struct {
		Proposal governance.Proposal                       `json:"proposal"`
		Intent   consensus.GovernanceExecutionBeginPayload `json:"intent"`
	}](client, proposalPath(proposal.ID, "/execute/prepare"), identities.Operator.Account, map[string]string{"manifestHash": manifestHash})
	if err != nil {
		return fmt.Errorf("prepare chain execution: %w", err)
	}
	beginTx, err := consensus.NewSignedApplicationAction(executionKey, config.ChainCore.ChainID, consensus.ActionGovernanceExecutionBegin, prepared.Intent, executionNonce)
	if err != nil {
		return err
	}
	beginRaw, err := consensus.EncodeSignedApplicationAction(beginTx)
	if err != nil {
		return err
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/execute"), identities.Operator.Account, map[string]any{
		"manifestHash": manifestHash, "signedAction": json.RawMessage(beginRaw),
	})
	if err != nil || proposal.Status != governance.StatusExecutionSubmitted {
		return fmt.Errorf("commit chain execution: status=%s err=%v", proposal.Status, err)
	}
	stateRoot, evidenceHash := strings.Repeat("b", 64), strings.Repeat("c", 64)
	verification, err := postJSON[struct {
		Intent consensus.GovernanceExecutionVerifyPayload `json:"intent"`
	}](client, proposalPath(proposal.ID, "/verify/prepare"), identities.Verifier.Account, map[string]string{
		"outcome": "verified", "stateRoot": stateRoot, "evidenceHash": evidenceHash,
	})
	if err != nil {
		return fmt.Errorf("prepare chain verification: %w", err)
	}
	verifyTx, err := consensus.NewSignedApplicationAction(executionKey, config.ChainCore.ChainID, consensus.ActionGovernanceExecutionVerify, verification.Intent, executionNonce+1)
	if err != nil {
		return err
	}
	verifyRaw, err := consensus.EncodeSignedApplicationAction(verifyTx)
	if err != nil {
		return err
	}
	proposal, err = postJSON[governance.Proposal](client, proposalPath(proposal.ID, "/verify"), identities.Verifier.Account, map[string]any{
		"outcome": "verified", "stateRoot": stateRoot, "evidenceHash": evidenceHash, "signedAction": json.RawMessage(verifyRaw),
	})
	if err != nil || proposal.Status != governance.StatusVerified || proposal.ExecutionReceipt == nil {
		return fmt.Errorf("verify canonical execution: status=%s err=%v", proposal.Status, err)
	}
	var canonical consensus.BFTGovernanceExecution
	for index, rpcURL := range rpcURLs {
		rpc, rpcErr := governance.NewCometChainExecutionClient(rpcURL, config.ChainCore.ChainID, 10*time.Second, nil)
		if rpcErr != nil {
			return rpcErr
		}
		expectedAudit := ""
		if index > 0 {
			expectedAudit = canonical.AuditHash
		}
		record, rpcErr := waitGovernanceExecution(rpc, proposal.ID, "verified", expectedAudit)
		if rpcErr != nil {
			return fmt.Errorf("validator %d lacks canonical governance execution: %w", index, rpcErr)
		}
		blockHash, rpcErr := rpc.GovernanceBlockHash(context.Background(), record.VerifiedHeight)
		if rpcErr != nil || blockHash != proposal.ExecutionReceipt.BlockHash {
			return fmt.Errorf("validator %d verification block mismatch: %s err=%v", index, blockHash, rpcErr)
		}
		if index == 0 {
			canonical = record
		} else if record.AuditHash != canonical.AuditHash || record.VerifyTxHash != canonical.VerifyTxHash {
			return fmt.Errorf("validator %d committed divergent governance evidence", index)
		}
	}
	result := drillResult{
		Version: 1, ProposalID: proposal.ID, GovernanceStatus: string(proposal.Status), ChainStatus: canonical.Status,
		BeginTxHash: canonical.BeginTxHash, VerifyTxHash: canonical.VerifyTxHash,
		VerificationBlock: proposal.ExecutionReceipt.BlockHash, ValidatorRPCs: rpcURLs,
	}
	if err = writeRestrictedJSON(filepath.Join(work, "result.json"), result); err != nil {
		return err
	}
	fmt.Printf("governance testnet lifecycle committed: proposal=%s begin=%s verify=%s block=%s validators=%d\n",
		result.ProposalID, result.BeginTxHash, result.VerifyTxHash, result.VerificationBlock, len(result.ValidatorRPCs))
	return nil
}

func chainCheck(rpcValues, executionKeyPath string, executionNonce uint64) error {
	rpcURLs := splitRPCs(rpcValues)
	if len(rpcURLs) < 3 || executionNonce == 0 {
		return errors.New("chain-check requires at least three validator RPCs and a positive nonce")
	}
	keyBytes, err := os.ReadFile(executionKeyPath)
	if err != nil || len(keyBytes) != 32 {
		return errors.New("read canonical ephemeral execution key")
	}
	key := secp256k1.PrivKeyFromBytes(keyBytes)
	signer, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		return err
	}
	rpc, err := governance.NewCometChainExecutionClient(rpcURLs[0], 6423, 20*time.Second, nil)
	if err != nil {
		return err
	}
	owner, err := governance.NewCanonicalChainExecutionAdapter(6423, signer, rpc)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	intent := consensus.GovernanceExecutionBeginPayload{
		ProposalID: randomHex(32), ActionHash: strings.Repeat("1", 64), ManifestHash: strings.Repeat("2", 64),
		GovernanceAuditHash: strings.Repeat("3", 64), TimelockAuditHash: strings.Repeat("4", 64),
		CanaryAuditHash: strings.Repeat("5", 64), EvidenceHash: strings.Repeat("6", 64),
		Scope: "bridge_provider_limits", EarliestExecution: now.Add(-time.Second), LatestExecution: now.Add(time.Hour),
	}
	beginTx, err := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionGovernanceExecutionBegin, intent, executionNonce)
	if err != nil {
		return err
	}
	beginRaw, err := consensus.EncodeSignedApplicationAction(beginTx)
	if err != nil {
		return err
	}
	record, err := owner.Submit(context.Background(), intent, beginRaw)
	if err != nil {
		return fmt.Errorf("canonical chain-check begin: %w", err)
	}
	verifyIntent := consensus.GovernanceExecutionVerifyPayload{
		ProposalID: intent.ProposalID, BeginTxHash: record.BeginTxHash, ActionHash: intent.ActionHash,
		ManifestHash: intent.ManifestHash, Outcome: "verified", StateRoot: strings.Repeat("7", 64),
		EvidenceHash: strings.Repeat("8", 64),
	}
	verifyTx, err := consensus.NewSignedApplicationAction(key, 6423, consensus.ActionGovernanceExecutionVerify, verifyIntent, executionNonce+1)
	if err != nil {
		return err
	}
	verifyRaw, err := consensus.EncodeSignedApplicationAction(verifyTx)
	if err != nil {
		return err
	}
	record, blockHash, err := owner.Verify(context.Background(), verifyIntent, verifyRaw)
	if err != nil {
		return fmt.Errorf("canonical chain-check verify: %w", err)
	}
	for index, rpcURL := range rpcURLs {
		validator, clientErr := governance.NewCometChainExecutionClient(rpcURL, 6423, 10*time.Second, nil)
		if clientErr != nil {
			return clientErr
		}
		if _, clientErr = waitGovernanceExecution(validator, intent.ProposalID, "verified", record.AuditHash); clientErr != nil {
			return fmt.Errorf("canonical chain-check validator %d diverged: %w", index, clientErr)
		}
	}
	fmt.Printf("governance canonical chain preflight passed: proposal=%s begin=%s verify=%s block=%s validators=%d\n",
		record.ProposalID, record.BeginTxHash, record.VerifyTxHash, blockHash, len(rpcURLs))
	return nil
}

func waitGovernanceExecution(client *governance.CometChainExecutionClient, proposalID, status, auditHash string) (consensus.BFTGovernanceExecution, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	var last consensus.BFTGovernanceExecution
	var lastErr error
	for {
		record, found, err := client.GovernanceExecution(ctx, proposalID)
		if err == nil && found {
			last = record
			if record.Status == status && (auditHash == "" || record.AuditHash == auditHash) {
				return record, nil
			}
		} else if err != nil {
			lastErr = err
		}
		select {
		case <-ctx.Done():
			return consensus.BFTGovernanceExecution{}, fmt.Errorf("%w: lastStatus=%s lastAudit=%s lastError=%v", ctx.Err(), last.Status, last.AuditHash, lastErr)
		case <-ticker.C:
		}
	}
}

func check(work string) error {
	config, _, gatewayKey, err := loadDrill(work)
	if err != nil {
		return err
	}
	var result drillResult
	if err = readJSON(filepath.Join(work, "result.json"), &result); err != nil {
		return err
	}
	client := &gatewayClient{baseURL: "http://" + config.HTTPAddress, key: gatewayKey, client: &http.Client{Timeout: 10 * time.Second}}
	proposal, err := getJSON[governance.Proposal](client, "/governance/proposals/"+result.ProposalID)
	if err != nil {
		return err
	}
	if proposal.Status != governance.StatusVerified || proposal.ExecutionReceipt == nil ||
		proposal.ExecutionReceipt.TxHash != result.VerifyTxHash || proposal.ExecutionReceipt.BlockHash != result.VerificationBlock {
		return errors.New("restarted governanced did not restore the verified canonical receipt")
	}
	fmt.Printf("governance restart check passed: proposal=%s status=%s receipt=%s\n", proposal.ID, proposal.Status, proposal.ExecutionReceipt.AuditHash)
	return nil
}

func newDrillIdentities() (drillIdentities, error) {
	newIdentity := func() (drillIdentity, error) {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return drillIdentity{}, err
		}
		encodedPublic := nativewallet.EncodePublicKey(publicKey)
		account, err := governance.GovernanceVoterID(encodedPublic)
		if err != nil {
			return drillIdentity{}, err
		}
		return drillIdentity{
			Account: account, PublicKey: encodedPublic, PrivateKey: base64.StdEncoding.EncodeToString(privateKey),
		}, nil
	}
	voter, err := newIdentity()
	if err != nil {
		return drillIdentities{}, err
	}
	operator, err := newIdentity()
	if err != nil {
		return drillIdentities{}, err
	}
	verifier, err := newIdentity()
	return drillIdentities{Voter: voter, Operator: operator, Verifier: verifier}, err
}

func (i drillIdentity) privateKey() (ed25519.PrivateKey, error) {
	value, err := base64.StdEncoding.DecodeString(i.PrivateKey)
	if err != nil || len(value) != ed25519.PrivateKeySize {
		return nil, errors.New("invalid ephemeral governance signing key")
	}
	return ed25519.PrivateKey(value), nil
}

func postJSON[T any](client *gatewayClient, path, account string, input any) (T, error) {
	var zero T
	body, err := json.Marshal(input)
	if err != nil {
		return zero, err
	}
	request, err := http.NewRequest(http.MethodPost, client.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return zero, err
	}
	at := time.Now().UTC()
	nonce := randomHex(16)
	identity := governance.SessionIdentity{Account: account, DeviceID: "testnet-device", SessionID: "testnet-session"}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-YNX-Verified-Account", account)
	request.Header.Set("X-YNX-Verified-Device-ID", identity.DeviceID)
	request.Header.Set("X-YNX-Verified-Session-ID", identity.SessionID)
	request.Header.Set("X-YNX-Verified-Product", "governance")
	request.Header.Set("X-YNX-Gateway-Timestamp", fmt.Sprint(at.Unix()))
	request.Header.Set("X-YNX-Gateway-Nonce", nonce)
	request.Header.Set("X-YNX-Gateway-Signature", governance.SignGatewayAssertion(client.key, http.MethodPost, path, body, identity, "governance", at, nonce))
	return executeJSON[T](client.client, request)
}

func getJSON[T any](client *gatewayClient, path string) (T, error) {
	request, err := http.NewRequest(http.MethodGet, client.baseURL+path, nil)
	if err != nil {
		var zero T
		return zero, err
	}
	return executeJSON[T](client.client, request)
}

func executeJSON[T any](client *http.Client, request *http.Request) (T, error) {
	var zero T
	response, err := client.Do(request)
	if err != nil {
		return zero, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return zero, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return zero, fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	var envelope sourceResponse[T]
	if err = json.Unmarshal(body, &envelope); err != nil {
		return zero, err
	}
	if envelope.Source != "ynx-governance-authoritative-state" || envelope.Version != "ynx-governance-api/v1" || envelope.AsOf.IsZero() {
		return zero, errors.New("response lacks authoritative source metadata")
	}
	return envelope.Data, nil
}

func loadDrill(work string) (governance.RuntimeConfig, drillIdentities, []byte, error) {
	var config governance.RuntimeConfig
	var identities drillIdentities
	if err := readJSON(filepath.Join(work, "governanced.json"), &config); err != nil {
		return config, identities, nil, err
	}
	if err := readJSON(filepath.Join(work, "identities.json"), &identities); err != nil {
		return config, identities, nil, err
	}
	raw, err := os.ReadFile(config.GatewayKeyPath)
	if err != nil {
		return config, identities, nil, err
	}
	key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil || len(key) != 32 {
		return config, identities, nil, errors.New("invalid ephemeral gateway assertion key")
	}
	return config, identities, key, nil
}

func readJSON(path string, output any) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(output); err != nil {
		return err
	}
	var trailing any
	if err = decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return errors.New("JSON contains trailing data")
	}
	return nil
}

func writeRestrictedJSON(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err = os.WriteFile(path, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Chmod(path, 0o600)
}

func proposalPath(id, suffix string) string {
	return "/governance/proposals/" + id + suffix
}

func randomHex(size int) string {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		panic(err)
	}
	return hex.EncodeToString(raw)
}

func sleepUntil(target time.Time) {
	if delay := time.Until(target); delay > 0 {
		time.Sleep(delay)
	}
}

func firstRPC(value string) string {
	values := splitRPCs(value)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func splitRPCs(value string) []string {
	var output []string
	for _, item := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			output = append(output, trimmed)
		}
	}
	return output
}

func validHash(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func validSourceCommit(value string) bool {
	if len(value) != 40 && len(value) != 64 {
		return false
	}
	return validHex(value)
}

func validHex(value string) bool {
	if strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}
