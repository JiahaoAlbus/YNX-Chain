package video

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
)

// OriginalOperationMetadata is supplied by the fixed trusted producer after
// original Session/action/route verification and durable Node reservation.
// These fields authenticate nobody and are never read from an HTTP payload.
// NodeRequestDigest is the original Node effect commitment. Its algorithm
// is independent of ActionBodyDigest (SHA256 of original product body bytes).
// Neither is the recovery-read request body digest. Never infer one from the other.
type VideoOriginalOperationMetadata struct {
	OperationID       string `json:"operationId"`
	SessionBinding    string `json:"sessionBinding"`
	NodeRequestDigest string `json:"nodeRequestDigest"`
	ActionBodyDigest  string `json:"actionBodyDigest"`
	Method            string `json:"method"`
	Path              string `json:"path"`
}
type VideoOriginalOperationIdentity struct {
	Operation   VideoOriginalOperationMetadata `json:"operation"`
	Actor       string                         `json:"actor"`
	ProductID   string                         `json:"productId"`
	Scope       string                         `json:"scope,omitempty"`
	Nonce       string                         `json:"nonce"`
	BodyDigest  string                         `json:"bodyDigest"`
	BusinessKey string                         `json:"businessKey"`
}

// The original audit step links the product's actual object/kind/result key.
// It describes LOCAL publication; it supplies no provider final decision.
type VideoOriginalOperationStep struct {
	Sequence  uint64 `json:"sequence"`
	AuditHash string `json:"auditHash"`
	Kind      string `json:"kind"`
	ObjectID  string `json:"objectId"`
}
type VideoOriginalProviderAssociation struct {
	Kind       string                          `json:"kind"`
	ObjectID   string                          `json:"objectId"`
	Commitment VideoOriginalProviderCommitment `json:"commitment"`
}

type VideoOriginalOperationRecord struct {
	Providers []VideoOriginalProviderAssociation `json:"providers,omitempty"`
	Identity  VideoOriginalOperationIdentity     `json:"identity"`
	Steps     []VideoOriginalOperationStep       `json:"steps"`
}

func cloneVideoOperationMetadata(p *VideoOriginalOperationMetadata) *VideoOriginalOperationMetadata {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}
func sameVideoOperation(a, b *VideoOriginalOperationMetadata) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
func validVideoOperation(p VideoOriginalOperationMetadata) bool {
	return validVideoDigest(p.OperationID) && validVideoDigest(p.SessionBinding) && validVideoDigest(p.NodeRequestDigest) && validVideoDigest(p.ActionBodyDigest) && (p.Method == "GET" || p.Method == "HEAD" || p.Method == "POST" || p.Method == "PUT" || p.Method == "PATCH" || p.Method == "DELETE") && len(p.Path) > 0 && len(p.Path) <= 4096 && strings.HasPrefix(p.Path, "/") && !strings.ContainsAny(p.Path, "?#\r\n")
}

func validVideoDigest(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && s == strings.ToLower(s)
}
func (b *videoBusinessLease) checkOperationSource() error {
	p := b.grant.Operation
	if b.grant.RequireOperationAssociation || p != nil {
		if p == nil || b.grant.Current == nil || b.grant.CaptureTransaction == nil {
			return ErrVideoTransactionUnavailable
		}
		if !validVideoOperation(*p) || p.SessionBinding != b.grant.SessionBinding || p.ActionBodyDigest != b.grant.BodyDigest || b.grant.ProductID == "" {
			return ErrUnauthorized
		}
	}
	return nil
}
func (b *videoBusinessLease) recordOriginalOperation(next *State, before State) error {
	p := b.grant.Operation
	if p == nil {
		return nil
	}
	identity := VideoOriginalOperationIdentity{Operation: *p, Actor: b.grant.Actor, ProductID: b.grant.ProductID, Scope: b.grant.Scope, Nonce: b.grant.Nonce, BodyDigest: b.grant.BodyDigest, BusinessKey: videoBusinessNonceKey(b.grant.SessionBinding, b.grant.Nonce)}
	r, exists := next.OriginalOperations[p.OperationID]
	if exists && (!b.consumed.Load() || r.Identity != identity) {
		return ErrUnauthorized
	}
	if !exists {
		if b.consumed.Load() {
			return ErrVideoTransactionUnavailable
		}
		if len(next.OriginalOperations) >= 4096 {
			return errors.New("Video original operation capacity reached")
		}
		r.Identity = identity
	}
	for _, a := range next.Audit[len(before.Audit):] {
		var commitment *VideoOriginalProviderCommitment
		if a.ObjectType == "payout" {
			if p := next.PayoutIntents[a.ObjectID]; p != nil {
				commitment = p.originalProviderCommitment
			}
		}
		if a.ObjectType == "ai_job" {
			if j := next.AIJobs[a.ObjectID]; j != nil {
				commitment = j.originalProviderCommitment
			}
		}
		if commitment != nil {
			ref := VideoOriginalProviderAssociation{Kind: a.ObjectType, ObjectID: a.ObjectID, Commitment: *commitment}
			found := false
			for _, old := range r.Providers {
				if old.Kind == ref.Kind && old.ObjectID == ref.ObjectID {
					if old != ref {
						return ErrUnauthorized
					}
					found = true
				}
			}
			if !found {
				r.Providers = append(r.Providers, ref)
			}
		}
		r.Steps = append(r.Steps, VideoOriginalOperationStep{Sequence: a.Sequence, AuditHash: a.Hash, Kind: a.ObjectType, ObjectID: a.ObjectID})
	}
	if next.OriginalOperations == nil {
		next.OriginalOperations = map[string]VideoOriginalOperationRecord{}
	}
	next.OriginalOperations[p.OperationID] = r
	return validateVideoOriginalOperations(*next)
}
func validateVideoOriginalOperations(st State) error {
	if len(st.OriginalOperations) > 4096 {
		return ErrUnauthorized
	}
	for key, r := range st.OriginalOperations {
		i := r.Identity
		p := i.Operation
		if key != p.OperationID || !validVideoOperation(p) || i.Actor == "" || i.ProductID == "" || i.BodyDigest != p.ActionBodyDigest || i.BusinessKey != videoBusinessNonceKey(p.SessionBinding, i.Nonce) || len(i.Nonce) < 16 {
			return ErrUnauthorized
		}
		var previousSequence uint64
		for _, ref := range r.Providers {
			if !validVideoProviderCommitment(&ref.Commitment) || (ref.Kind != "payout" && ref.Kind != "ai_job") || ref.Kind == "payout" && ref.Commitment.ProviderRequestKey != ref.ObjectID || ref.Kind == "ai_job" && ref.Commitment.ProviderRequestKey != "" {
				return ErrUnauthorized
			}
			found := false
			for _, step := range r.Steps {
				if step.Kind == ref.Kind && step.ObjectID == ref.ObjectID {
					found = true
				}
			}
			if !found {
				return ErrUnauthorized
			}
		}
		for _, step := range r.Steps {
			if step.Sequence <= previousSequence || step.Sequence > uint64(len(st.Audit)) {
				return ErrUnauthorized
			}
			previousSequence = step.Sequence
			a := st.Audit[step.Sequence-1]
			if a.Hash != step.AuditHash || a.Actor != i.Actor || a.ObjectType != step.Kind || a.ObjectID != step.ObjectID {
				return ErrUnauthorized
			}
		}
		if n, ok := st.BusinessNonces[i.BusinessKey]; ok {
			if n.Actor != i.Actor || n.Nonce != i.Nonce || n.BodyDigest != i.BodyDigest || !sameVideoOperation(n.Operation, &p) {
				return ErrUnauthorized
			}
		}
	}
	for _, n := range st.BusinessNonces {
		if n.Operation != nil {
			r, ok := st.OriginalOperations[n.Operation.OperationID]
			if !ok || r.Identity.Actor != n.Actor || r.Identity.Nonce != n.Nonce || !sameVideoOperation(&r.Identity.Operation, n.Operation) {
				return ErrUnauthorized
			}
		}
	}
	return nil
}

// Exact internal getter over the SAME original Store. Absent old association
// is unavailable, never not_executed. This does not resolve a prior uncertain
// fsync or attest external payout/AI finality; those original records stay intact.
func (s *Store) ReadOriginalBusinessOperation(ctx context.Context, expected VideoOriginalOperationIdentity) (VideoOriginalOperationRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return VideoOriginalOperationRecord{}, err
	}
	r, ok := disk.OriginalOperations[expected.Operation.OperationID]
	if !ok {
		return VideoOriginalOperationRecord{}, ErrVideoTransactionUnavailable
	}
	if r.Identity != expected {
		return VideoOriginalOperationRecord{}, ErrUnauthorized
	}
	r.Steps = append([]VideoOriginalOperationStep(nil), r.Steps...)
	r.Providers = append([]VideoOriginalProviderAssociation(nil), r.Providers...)
	return r, nil
}
func (s *Service) ReadOriginalBusinessOperation(ctx context.Context, expected VideoOriginalOperationIdentity) (VideoOriginalOperationRecord, error) {
	return s.store.ReadOriginalBusinessOperation(ctx, expected)
}

func (b *videoBusinessLease) checkOriginalOperationState(st State) error {
	p := b.grant.Operation
	if p == nil {
		return nil
	}
	r, exists := st.OriginalOperations[p.OperationID]
	if exists && (!b.consumed.Load() || r.Identity.Operation != *p || r.Identity.Actor != b.grant.Actor || r.Identity.Nonce != b.grant.Nonce || r.Identity.ProductID != b.grant.ProductID || r.Identity.Scope != b.grant.Scope) {
		return ErrUnauthorized
	}
	if b.consumed.Load() && !exists {
		return ErrVideoTransactionUnavailable
	}
	return nil
}

// Exact original local results from the SAME integrity-checked read. Payout
// awaiting_wallet_confirmation and AI results retain their original semantics;
// no provider-final label or negative/retry evidence is manufactured here.
type VideoOriginalOperationResultReadback struct {
	Record  VideoOriginalOperationRecord
	Payouts []PayoutIntent
	AIJobs  []AIJob
}

func (s *Store) ReadOriginalBusinessOperationResults(ctx context.Context, expected VideoOriginalOperationIdentity) (VideoOriginalOperationResultReadback, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return VideoOriginalOperationResultReadback{}, err
	}
	r, ok := disk.OriginalOperations[expected.Operation.OperationID]
	if !ok {
		return VideoOriginalOperationResultReadback{}, ErrVideoTransactionUnavailable
	}
	if r.Identity != expected {
		return VideoOriginalOperationResultReadback{}, ErrUnauthorized
	}
	r.Steps = append([]VideoOriginalOperationStep(nil), r.Steps...)
	r.Providers = append([]VideoOriginalProviderAssociation(nil), r.Providers...)
	out := VideoOriginalOperationResultReadback{Record: r}
	seen := map[string]bool{}
	for _, step := range r.Steps {
		k := step.Kind + ":" + step.ObjectID
		if seen[k] {
			continue
		}
		seen[k] = true
		if step.Kind == "payout" {
			if p := disk.PayoutIntents[step.ObjectID]; p != nil && p.Owner == expected.Actor {
				v := *p
				v.UsageEventIDs = append([]string(nil), p.UsageEventIDs...)

				out.Payouts = append(out.Payouts, v)
			}
		}
		if step.Kind == "ai_job" {
			if j := disk.AIJobs[step.ObjectID]; j != nil && j.Owner == expected.Actor {
				v := *j
				v.ContextClasses = append([]string(nil), j.ContextClasses...)

				out.AIJobs = append(out.AIJobs, v)
			}
		}
	}
	return out, nil
}
func (s *Service) ReadOriginalBusinessOperationResults(ctx context.Context, expected VideoOriginalOperationIdentity) (VideoOriginalOperationResultReadback, error) {
	return s.store.ReadOriginalBusinessOperationResults(ctx, expected)
}
