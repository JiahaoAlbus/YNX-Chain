package bridgegateway

import (
	"sort"
	"strings"
	"time"
)

const (
	phaseQuote                           = "quote"
	phaseUserReview                      = "user_review"
	phaseSourceSubmitted                 = "source_submitted"
	phaseSourceAccepted                  = "source_accepted"
	phaseSourceFinalized                 = "source_finalized"
	phaseProofAttestationAvailable       = "proof_attestation_available"
	phaseProofVerified                   = "proof_verified"
	phaseDestinationActionSubmitted      = "destination_mint_release_submitted"
	phaseDestinationActionConfirmed      = "destination_mint_release_confirmed"
	phaseDestinationAvailable            = "destination_available"
	phaseFailed                          = "failed"
	phaseRetryable                       = "retryable"
	phaseRefundPending                   = "refund_pending"
	phaseRefunded                        = "refunded"
	phaseRecoveryRequired                = "recovery_required"
	phaseDisputed                        = "disputed"
	phaseCorrected                       = "corrected"
	phaseExpired                         = "expired"
	phasePaused                          = "paused"
	proofTypeThresholdRelayerAttestation = "threshold-relayer-attestation"
)

var canonicalPhases = map[string]bool{
	phaseQuote: true, phaseUserReview: true, phaseSourceSubmitted: true, phaseSourceAccepted: true,
	phaseSourceFinalized: true, phaseProofAttestationAvailable: true, phaseProofVerified: true,
	phaseDestinationActionSubmitted: true, phaseDestinationActionConfirmed: true, phaseDestinationAvailable: true,
	phaseFailed: true, phaseRetryable: true, phaseRefundPending: true, phaseRefunded: true,
	phaseRecoveryRequired: true, phaseDisputed: true, phaseCorrected: true, phaseExpired: true, phasePaused: true,
}

var legacyPhaseAliases = map[string]string{
	"proof_attestation":        phaseProofAttestationAvailable,
	"destination_mint_release": phaseDestinationActionSubmitted,
	"destination_confirmed":    phaseDestinationActionConfirmed,
	"refund_recovery":          phaseRefunded,
	"dispute":                  phaseDisputed,
	"retry":                    phaseRetryable,
}

func canonicalOutcome(value string) string {
	value = normalizeName(value)
	if canonical, ok := legacyPhaseAliases[value]; ok {
		return canonical
	}
	return value
}

func stateMachineDescriptor(now time.Time) StateMachineDescriptor {
	states := []StateDefinition{
		{ID: phaseQuote, Description: "Provider quote created; no asset has been submitted."},
		{ID: phaseUserReview, Description: "Wallet-bound review of route, amount, recipient, fees, digest, nonce, and expiry."},
		{ID: phaseSourceSubmitted, Description: "Source transaction or source event submitted; not yet accepted or final."},
		{ID: phaseSourceAccepted, Description: "Source event accepted by configured observers; not yet final."},
		{ID: phaseSourceFinalized, Description: "Configured source finality threshold reached."},
		{ID: phaseProofAttestationAvailable, Description: "Proof or attestation material is available but has not passed explicit verification."},
		{ID: phaseProofVerified, Description: "Configured proof or attestation verification algorithm completed successfully."},
		{ID: phaseDestinationActionSubmitted, Description: "Destination mint or release transaction submitted; destination asset is not yet available."},
		{ID: phaseDestinationActionConfirmed, Description: "Destination transaction confirmed under the route rule; availability still requires an explicit availability observation."},
		{ID: phaseDestinationAvailable, Terminal: true, DestinationAssetAvailable: true, Description: "Destination asset is confirmed available to the disclosed recipient."},
		{ID: phaseFailed, Description: "A non-retry classification failure was recorded with evidence."},
		{ID: phaseRetryable, Description: "Failure is eligible for bounded retry; retry has not executed."},
		{ID: phaseRefundPending, Description: "Refund is eligible or submitted but not confirmed."},
		{ID: phaseRefunded, Terminal: true, Description: "Refund is confirmed and the bridge exposure is resolved."},
		{ID: phaseRecoveryRequired, Description: "Automatic progress is blocked and audited manual recovery is required."},
		{ID: phaseDisputed, Description: "A dispute is open; prior settlement and exposure facts remain preserved."},
		{ID: phaseCorrected, Terminal: true, Description: "A disputed record was corrected with versioned evidence."},
		{ID: phaseExpired, Terminal: true, Description: "Quote or review expired before source submission."},
		{ID: phasePaused, Description: "Mutation is paused by the bridge safety boundary."},
	}
	transitions := []StateTransition{
		{From: phaseQuote, To: phaseUserReview, Condition: "quote digest and expiry are valid"},
		{From: phaseQuote, To: phaseExpired, Condition: "quote expires before review"},
		{From: phaseUserReview, To: phaseSourceSubmitted, Condition: "canonical wallet approves and signs the bound intent"},
		{From: phaseUserReview, To: phaseExpired, Condition: "review expires before source submission"},
		{From: phaseSourceSubmitted, To: phaseSourceAccepted, Condition: "source event is accepted by an authorized observer"},
		{From: phaseSourceAccepted, To: phaseSourceFinalized, Condition: "configured source finality threshold is reached"},
		{From: phaseSourceFinalized, To: phaseProofAttestationAvailable, Condition: "proof or threshold attestation bundle is assembled"},
		{From: phaseProofAttestationAvailable, To: phaseProofVerified, Condition: "domain-separated proof verification succeeds"},
		{From: phaseProofVerified, To: phaseDestinationActionSubmitted, Condition: "destination action evidence is recorded"},
		{From: phaseDestinationActionSubmitted, To: phaseDestinationActionConfirmed, Condition: "destination transaction satisfies the configured confirmation rule"},
		{From: phaseDestinationActionConfirmed, To: phaseDestinationAvailable, Condition: "recipient balance or contract availability is independently observed"},
		{From: phaseFailed, To: phaseRetryable, Condition: "failure is classified retryable"},
		{From: phaseRetryable, To: phaseRefundPending, Condition: "bounded retry is abandoned and refund is eligible"},
		{From: phaseFailed, To: phaseRefundPending, Condition: "failure is refund eligible"},
		{From: phaseRefundPending, To: phaseRefunded, Condition: "refund transaction is confirmed"},
		{From: phaseFailed, To: phaseRecoveryRequired, Condition: "automatic recovery is unavailable"},
		{From: phaseRetryable, To: phaseRecoveryRequired, Condition: "bounded retry budget is exhausted"},
		{From: phaseRefundPending, To: phaseRecoveryRequired, Condition: "refund cannot complete automatically"},
		{From: phaseDisputed, To: phaseCorrected, Condition: "correction evidence and audit identity are accepted"},
	}
	return StateMachineDescriptor{
		Version: StateMachineVersion, Source: "ynx-bridge-runtime", AsOf: now.UTC().Format(timeFormat),
		States: states, Transitions: transitions,
		LegacyAliases: map[string]string{
			"proof_attestation": phaseProofAttestationAvailable, "destination_mint_release": phaseDestinationActionSubmitted,
			"destination_confirmed": phaseDestinationActionConfirmed, "refund_recovery": phaseRefunded, "dispute": phaseDisputed,
			"retry": phaseRetryable,
		},
	}
}

func directOutcomeTransitionAllowed(from, to string) bool {
	switch to {
	case phaseDestinationActionSubmitted:
		return from == phaseProofVerified
	case phaseDestinationActionConfirmed:
		return from == phaseDestinationActionSubmitted
	case phaseDestinationAvailable:
		return from == phaseDestinationActionConfirmed
	case phaseFailed:
		return from != phaseDestinationAvailable && from != phaseRefunded && from != phaseCorrected && from != phaseExpired && from != phaseDisputed
	case phaseRetryable:
		return from == phaseFailed
	case phaseRefundPending:
		return from == phaseFailed || from == phaseRetryable || from == phaseRecoveryRequired
	case phaseRefunded:
		return from == phaseRefundPending
	case phaseRecoveryRequired:
		return from == phaseFailed || from == phaseRetryable || from == phaseRefundPending || from == phaseDisputed
	case phaseDisputed:
		return from != phaseExpired && from != phaseCorrected && from != phaseDisputed
	case phaseCorrected:
		return from == phaseDisputed
	default:
		return false
	}
}

func proofDigestForTransfer(transfer Transfer) string {
	relayers := make([]string, 0, len(transfer.Attestations))
	for relayer := range transfer.Attestations {
		relayers = append(relayers, relayer)
	}
	sort.Strings(relayers)
	type proofAttestation struct {
		Relayer       string `json:"relayer"`
		PayloadHash   string `json:"payloadHash"`
		Signature     string `json:"signature"`
		Confirmations uint64 `json:"confirmations"`
	}
	items := make([]proofAttestation, 0, len(relayers))
	for _, relayer := range relayers {
		attestation := transfer.Attestations[relayer]
		items = append(items, proofAttestation{Relayer: relayer, PayloadHash: attestation.PayloadHash, Signature: attestation.Signature, Confirmations: attestation.Confirmations})
	}
	return digestJSON(struct {
		Domain          string             `json:"domain"`
		TransferID      string             `json:"transferId"`
		MessageID       string             `json:"messageId"`
		IntentDigest    string             `json:"intentDigest"`
		SourceBlockHash string             `json:"sourceBlockHash"`
		Attestations    []proofAttestation `json:"attestations"`
	}{
		Domain: "ynx-bridge-proof-v1", TransferID: transfer.ID, MessageID: transfer.MessageID,
		IntentDigest: transfer.IntentDigest, SourceBlockHash: strings.ToLower(strings.TrimSpace(transfer.SourceBlockHash)), Attestations: items,
	})
}
