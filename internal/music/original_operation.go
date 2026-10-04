package music

import (
	"context"
	"sort"
	"strings"
)

// OriginalOperationMetadata is supplied by the fixed trusted producer after
// original Session/action/route verification and durable Node reservation.
// These fields authenticate nobody and are never read from an HTTP payload.
// NodeRequestDigest is the original Node effect commitment. Its algorithm
// is independent of ActionBodyDigest (SHA256 of original product body bytes).
// Neither is the recovery-read request body digest. Never infer one from the other.
type MusicOriginalOperationMetadata struct {
	OperationID       string `json:"operationId"`
	SessionBinding    string `json:"sessionBinding"`
	NodeRequestDigest string `json:"nodeRequestDigest"`
	ActionBodyDigest  string `json:"actionBodyDigest"`
	Method            string `json:"method"`
	Path              string `json:"path"`
	OwnedOperationID  string `json:"ownedOperationId,omitempty"`
}
type MusicOriginalOperationIdentity struct {
	Operation   MusicOriginalOperationMetadata `json:"operation"`
	Actor       string                         `json:"actor"`
	ProductID   string                         `json:"productId"`
	Scope       string                         `json:"scope,omitempty"`
	Nonce       string                         `json:"nonce"`
	BodyDigest  string                         `json:"bodyDigest"`
	BusinessKey string                         `json:"businessKey"`
}

// The original audit step links the product's actual object/kind/result key.
// It describes LOCAL publication; it supplies no provider final decision.
type MusicOriginalOperationStep struct {
	Sequence  uint64 `json:"sequence"`
	AuditHash string `json:"auditHash"`
	Kind      string `json:"kind"`
	ObjectID  string `json:"objectId"`
}
type MusicOriginalOperationRecord struct {
	Identity MusicOriginalOperationIdentity `json:"identity"`
	Steps    []MusicOriginalOperationStep   `json:"steps"`
}

func cloneMusicOperationMetadata(p *MusicOriginalOperationMetadata) *MusicOriginalOperationMetadata {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}
func sameMusicOperation(a, b *MusicOriginalOperationMetadata) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
func validMusicOperation(p MusicOriginalOperationMetadata) bool {
	return (p.OwnedOperationID == "" || len(p.OwnedOperationID) <= 512 && strings.TrimSpace(p.OwnedOperationID) == p.OwnedOperationID) && validMusicDigest(p.OperationID) && validMusicDigest(p.SessionBinding) && validMusicDigest(p.NodeRequestDigest) && validMusicDigest(p.ActionBodyDigest) && (p.Method == "GET" || p.Method == "HEAD" || p.Method == "POST" || p.Method == "PUT" || p.Method == "PATCH" || p.Method == "DELETE") && len(p.Path) > 0 && len(p.Path) <= 4096 && strings.HasPrefix(p.Path, "/") && !strings.ContainsAny(p.Path, "?#\r\n")
}

func validMusicDigest(s string) bool { return validSHA256Hex(s) }
func (l *musicBusinessLease) checkOperationSource() error {
	if l == nil {
		return ErrUnauthorized
	}
	p := l.grant.Operation
	if l.grant.RequireOperationAssociation || p != nil {
		if p == nil || l.grant.Current == nil || l.grant.CaptureTransaction == nil {
			return ErrMusicAuthorityUnavailable
		}
		if !validMusicOperation(*p) || p.SessionBinding != l.grant.SessionBinding || p.ActionBodyDigest != l.grant.BodyDigest || l.grant.ProductID == "" {
			return ErrUnauthorized
		}
	}
	return nil
}
func (l *musicBusinessLease) recordOriginalOperation(next *persistentState, before persistentState) error {
	p := l.grant.Operation
	if p == nil {
		return nil
	}
	i := MusicOriginalOperationIdentity{Operation: *p, Actor: l.grant.Actor, ProductID: l.grant.ProductID, Scope: l.grant.Scope, Nonce: l.grant.Nonce, BodyDigest: l.grant.BodyDigest, BusinessKey: l.grant.SessionBinding + ":" + l.grant.Nonce}
	r, exists := next.OriginalOperations[p.OperationID]
	if exists && (!l.consumed || r.Identity != i) {
		return ErrUnauthorized
	}
	if !exists {
		if l.consumed {
			return ErrMusicAuthorityUnavailable
		}
		if len(next.OriginalOperations) >= 4096 {
			return ErrConflict
		}
		r.Identity = i
	}
	for _, a := range next.Audit[len(before.Audit):] {
		r.Steps = append(r.Steps, MusicOriginalOperationStep{Sequence: a.Sequence, AuditHash: a.Hash, Kind: a.Type, ObjectID: a.ObjectID})
	}
	if next.OriginalOperations == nil {
		next.OriginalOperations = map[string]MusicOriginalOperationRecord{}
	}
	next.OriginalOperations[p.OperationID] = r
	// Attach only NEW original provider admissions. An older UNKNOWN/ACK is
	// never rebound to a fresh operation/nonce; its original key is retained.
	for key, e := range next.BusinessEffects {
		if _, old := before.BusinessEffects[key]; !old {
			copyID := i
			e.Operation = &copyID
			next.BusinessEffects[key] = e
		}
	}
	return validateMusicOriginalOperations(*next)
}
func validateMusicOriginalOperations(st persistentState) error {
	if len(st.OriginalOperations) > 4096 {
		return ErrUnauthorized
	}
	for key, r := range st.OriginalOperations {
		i := r.Identity
		p := i.Operation
		if key != p.OperationID || !validMusicOperation(p) || i.Actor == "" || i.ProductID == "" || i.BodyDigest != p.ActionBodyDigest || i.BusinessKey != p.SessionBinding+":"+i.Nonce || !musicProofNonce.MatchString(i.Nonce) {
			return ErrUnauthorized
		}
		var previousSequence uint64
		for _, step := range r.Steps {
			if step.Sequence <= previousSequence || step.Sequence > uint64(len(st.Audit)) {
				return ErrUnauthorized
			}
			previousSequence = step.Sequence
			a := st.Audit[step.Sequence-1]
			if a.Hash != step.AuditHash || a.Actor != i.Actor || a.Type != step.Kind || a.ObjectID != step.ObjectID {
				return ErrUnauthorized
			}
		}
		if n, ok := st.BusinessNonces[i.BusinessKey]; ok {
			if n.Actor != i.Actor || n.BodyDigest != i.BodyDigest || !sameMusicOperation(n.Operation, &p) {
				return ErrUnauthorized
			}
		}
	}
	for _, n := range st.BusinessNonces {
		if n.Operation != nil {
			r, ok := st.OriginalOperations[n.Operation.OperationID]
			if !ok || r.Identity.Actor != n.Actor || r.Identity.BodyDigest != n.BodyDigest || !sameMusicOperation(&r.Identity.Operation, n.Operation) {
				return ErrUnauthorized
			}
		}
	}
	for key, e := range st.BusinessEffects {
		if e.Operation != nil {
			r, ok := st.OriginalOperations[e.Operation.Operation.OperationID]
			if !ok || r.Identity != *e.Operation || e.Actor != r.Identity.Actor || key != effectKey(e.Actor, e.Kind, e.ObjectID) || !validSHA256Hex(e.WireDigest) || !validSHA256Hex(e.EndpointDigest) {
				return ErrUnauthorized
			}
		}
	}
	return nil
}

// Only local association and original submission journal are returned. No
// TERMINAL/providerfinal label exists: Trust ACK {id} is submission-only.
type MusicOriginalEffectReadback struct {
	EffectKey string
	Effect    MusicBusinessEffect
}

type MusicOriginalOperationReadback struct {
	Record  MusicOriginalOperationRecord
	Effects []MusicOriginalEffectReadback
}

func (s *Service) ReadOriginalBusinessOperation(ctx context.Context, expected MusicOriginalOperationIdentity) (MusicOriginalOperationReadback, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return MusicOriginalOperationReadback{}, err
	}
	r, ok := disk.OriginalOperations[expected.Operation.OperationID]
	if !ok {
		return MusicOriginalOperationReadback{}, ErrMusicAuthorityUnavailable
	}
	if r.Identity != expected {
		return MusicOriginalOperationReadback{}, ErrUnauthorized
	}
	r.Steps = append([]MusicOriginalOperationStep(nil), r.Steps...)
	out := MusicOriginalOperationReadback{Record: r}
	keys := make([]string, 0, len(disk.BusinessEffects))
	for key := range disk.BusinessEffects {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		e := disk.BusinessEffects[key]
		if e.Operation != nil && *e.Operation == expected {
			copyID := *e.Operation
			e.Operation = &copyID
			e.Receipt = append([]byte(nil), e.Receipt...)
			out.Effects = append(out.Effects, MusicOriginalEffectReadback{EffectKey: key, Effect: e})
		}
	}
	return out, nil
}

func (l *musicBusinessLease) checkOriginalOperationState(st persistentState) error {
	p := l.grant.Operation
	if p == nil {
		return nil
	}
	r, exists := st.OriginalOperations[p.OperationID]
	if exists && (!l.consumed || r.Identity.Operation != *p || r.Identity.Actor != l.grant.Actor || r.Identity.Nonce != l.grant.Nonce || r.Identity.ProductID != l.grant.ProductID || r.Identity.Scope != l.grant.Scope) {
		return ErrUnauthorized
	}
	if l.consumed && !exists {
		return ErrMusicAuthorityUnavailable
	}
	return nil
}
func (l *musicBusinessLease) checkOriginalEffectAssociation(e MusicBusinessEffect) error {
	if l.grant.Operation == nil {
		return nil
	}
	if e.Operation == nil {
		return ErrMusicAuthorityUnavailable
	}
	i := e.Operation
	if i.Operation != *l.grant.Operation || i.Actor != l.grant.Actor || i.Nonce != l.grant.Nonce || i.ProductID != l.grant.ProductID || i.Scope != l.grant.Scope {
		return ErrUnauthorized
	}
	return nil
}
