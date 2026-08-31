package datafabric

import (
	"context"
	"errors"
)

const (
	ChainCoreDataCommitmentSource        = "ynx-consensus-abci"
	ChainCoreDataCommitmentVersion       = "abci-state-v14"
	ChainCoreDataCommitmentSourceCommit  = "0da66c319629a79613739df351b5000b85a1371a"
	ChainCoreDataCommitmentReleaseCommit = "b481a46f6d77644d0dff13e3917a51f8503e88f4"
)

// ChainCommitmentReference is the Data Fabric event context passed to the
// accepted Chain Core adapter. ChainCommitmentID is an external, deterministic
// Chain Core identifier; the remaining values are local audit context only.
// They do not redefine transaction, ownership, finality, or consensus state.
type ChainCommitmentReference struct {
	ChainCommitmentID  string
	EventID            string
	EventIntegrityHash string
	Product            string
	Service            string
	AggregateID        string
	SourceCommit       string
	SourceRelease      string
}

// ChainCommitmentVerifier is implemented by the accepted Chain Core adapter.
// It returns nil only after GET /data/commitments/{id} reports the same ID with
// source ynx-consensus-abci, version abci-state-v14, exact coverage and no
// failure. Data Fabric never creates a commitment or accepts an owner field;
// Chain Core derives mutation ownership from the transaction signer.
type ChainCommitmentVerifier interface {
	VerifyChainCommitment(context.Context, ChainCommitmentReference) error
}

func VerifyChainCommitmentReference(ctx context.Context, verifier ChainCommitmentVerifier, event EventEnvelope) error {
	if event.ChainCommitmentID == "" {
		return nil
	}
	if verifier == nil {
		return Reject(CodeChainCommitmentUnavailable, "Chain Core commitment verification is unavailable", map[string]string{"eventId": event.EventID, "chainCommitmentId": event.ChainCommitmentID})
	}
	reference := ChainCommitmentReference{
		ChainCommitmentID:  event.ChainCommitmentID,
		EventID:            event.EventID,
		EventIntegrityHash: event.Integrity.Digest,
		Product:            event.Product,
		Service:            event.Service,
		AggregateID:        event.AggregateID,
		SourceCommit:       event.SourceCommit,
		SourceRelease:      event.SourceRelease,
	}
	if err := verifier.VerifyChainCommitment(ctx, reference); err != nil {
		var rejection *RejectionError
		if errors.As(err, &rejection) && (rejection.Code == CodeChainCommitmentUnavailable || rejection.Code == CodeChainCommitmentRejected) {
			return err
		}
		return WrapReject(CodeChainCommitmentRejected, "Chain Core rejected the event commitment reference", err, map[string]string{"eventId": event.EventID, "chainCommitmentId": event.ChainCommitmentID})
	}
	return nil
}
