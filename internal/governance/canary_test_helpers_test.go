package governance

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/decred/dcrd/dcrec/secp256k1/v4"
)

func makeTestCanaryEnvelope(t *testing.T, service *Service, proposal Proposal, manifest string) SignedCanaryEnvelope {
	t.Helper()
	identity := testVoter("canary-operator-" + proposal.ID)
	startsAt := proposal.ExecuteAfter.Add(-service.policy.Timelock).Add(time.Minute)
	envelope := SignedCanaryEnvelope{
		Version: SignedCanaryVersion, Domain: canaryDomain(service.policy), ChainID: service.policy.ChainID,
		ProposalID: proposal.ID, ActionHash: proposal.ActionHash, ManifestHash: manifest,
		CanaryPlanHash: proposalCanaryPlanHash(&proposal), CohortManifestHash: strings.Repeat("7", 64),
		TargetBPS: 500, MinimumSamples: 100, MaxFailureBPS: 100,
		StartsAt: startsAt, EndsAt: startsAt.Add(10 * time.Minute),
		Nonce: "canary-nonce-" + proposal.ID, Operator: identity.ID, PublicKey: identity.PublicKey,
		Evidence: []string{"sha256:bounded-test-canary-cohort"},
	}
	envelope, err := SignCanaryEnvelope(envelope, identity.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}

func startTestCanary(t *testing.T, service *Service, proposal Proposal, manifest string) CanaryRecord {
	t.Helper()
	envelope := makeTestCanaryEnvelope(t, service, proposal, manifest)
	startsAt := envelope.StartsAt
	record, err := service.StartCanary(envelope, startsAt)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

func passTestCanary(t *testing.T, service *Service, proposal Proposal, manifest string) CanaryRecord {
	t.Helper()
	record := startTestCanary(t, service, proposal, manifest)
	envelope := makeTestCanaryResultEnvelope(t, service, proposal, record, 100, 0, record.Envelope.EndsAt)
	result, err := service.CompleteCanary(envelope, record.Envelope.EndsAt)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func submitTestChainExecution(t *testing.T, service *Service, proposal Proposal, manifest string, now time.Time) Proposal {
	t.Helper()
	intent, _, err := service.PrepareChainExecution(proposal.ID, manifest, now)
	if err != nil {
		t.Fatal(err)
	}
	key := secp256k1.PrivKeyFromBytes(bytes.Repeat([]byte{0x61}, 32))
	signer, err := consensus.NativeAddress(key.PubKey().SerializeCompressed())
	if err != nil {
		t.Fatal(err)
	}
	record := consensus.BFTGovernanceExecution{
		ProposalID: intent.ProposalID, ActionHash: intent.ActionHash, ManifestHash: intent.ManifestHash,
		GovernanceAuditHash: intent.GovernanceAuditHash, TimelockAuditHash: intent.TimelockAuditHash,
		CanaryAuditHash: intent.CanaryAuditHash, EvidenceHash: intent.EvidenceHash, Scope: intent.Scope,
		Signer: signer, Status: "submitted", EarliestExecution: intent.EarliestExecution,
		LatestExecution: intent.LatestExecution, SubmittedAt: now.UTC(), SubmittedHeight: 10,
		BeginTxHash: "0x" + strings.Repeat("a", 64), AuditHash: strings.Repeat("b", 64),
	}
	out, err := service.confirmChainExecution(proposal.ID, intent, record, now)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func makeTestCanaryResultEnvelope(t *testing.T, service *Service, proposal Proposal, record CanaryRecord, total, failed uint64, observedTo time.Time) SignedCanaryResultEnvelope {
	t.Helper()
	identity := testVoter("canary-verifier-" + proposal.ID)
	envelope := SignedCanaryResultEnvelope{
		Version: SignedCanaryResultVersion, Domain: canaryDomain(service.policy) + ".result", ChainID: service.policy.ChainID,
		ProposalID: proposal.ID, CanaryID: record.ID, ManifestHash: record.Envelope.ManifestHash,
		CohortManifestHash: record.Envelope.CohortManifestHash, TotalSamples: total, FailedSamples: failed,
		MetricsHash: strings.Repeat("8", 64), StateRoot: "0x" + strings.Repeat("9", 64),
		ObservedFrom: record.Envelope.StartsAt, ObservedTo: observedTo, Nonce: "canary-result-nonce-" + proposal.ID,
		Verifier: identity.ID, PublicKey: identity.PublicKey, Evidence: []string{"sha256:test-canary-health-window"},
	}
	envelope, err := SignCanaryResultEnvelope(envelope, identity.PrivateKey)
	if err != nil {
		t.Fatal(err)
	}
	return envelope
}
