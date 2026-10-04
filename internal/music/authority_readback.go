package music

import (
	"context"
	"encoding/json"
	"os"
)

// Readback is for the original trusted writer AFTER its local commit returns.
// It takes the original Store lock; never use it as a coordinator source read.
// Matching bytes and integrity are local readback, not proof of prior fsync
// success, authority provenance, approval or finality. A prior unconfirmed
// commit error remains authoritative even if this readback succeeds.
func (s *Service) originalConfirmedFileStateLocked(ctx context.Context) (persistentState, error) {
	if ctx == nil || ctx.Err() != nil {
		return persistentState{}, ErrMusicAuthorityUnavailable
	}
	raw, err := os.ReadFile(s.cfg.StatePath)
	if err != nil {
		return persistentState{}, err
	}
	disk, err := decodePersistedState(raw)
	if err != nil {
		return persistentState{}, err
	}
	integrity, err := stateIntegrity(disk)
	if err != nil || integrity != disk.IntegrityHash {
		return persistentState{}, ErrMusicStatePublicationUnconfirmed
	}
	if err = verifyAuditChain(disk.Audit); err != nil {
		return persistentState{}, err
	}
	a, err := json.Marshal(s.state)
	if err != nil {
		return persistentState{}, err
	}
	b, err := json.Marshal(disk)
	if err != nil {
		return persistentState{}, err
	}
	if string(a) != string(b) {
		return persistentState{}, ErrMusicStatePublicationUnconfirmed
	}
	if ctx.Err() != nil {
		return persistentState{}, ctx.Err()
	}
	return disk, nil
}
func (s *Service) ReadOriginalBusinessNonce(ctx context.Context, binding, nonce string) (MusicBusinessNonce, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return MusicBusinessNonce{}, err
	}
	record, ok := disk.BusinessNonces[binding+":"+nonce]
	if !ok {
		return MusicBusinessNonce{}, ErrNotFound
	}
	return record, nil
}

// Copies the original dispatch/receipt journal, including UNKNOWN/admitted
// records. No readback invokes a provider, promotes an ACK or retries a POST.
func (s *Service) ReadOriginalBusinessEffect(ctx context.Context, actor, kind, id string) (MusicBusinessEffect, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	disk, err := s.originalConfirmedFileStateLocked(ctx)
	if err != nil {
		return MusicBusinessEffect{}, err
	}
	record, ok := disk.BusinessEffects[effectKey(actor, kind, id)]
	if !ok || record.Actor != actor || record.Kind != kind || record.ObjectID != id {
		return MusicBusinessEffect{}, ErrNotFound
	}
	record.Receipt = append(json.RawMessage(nil), record.Receipt...)
	return record, nil
}
