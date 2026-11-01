package participation

import "errors"

// Cancel retires one local dispatch. It never claims to cancel a produced or
// submitted original, calls no Wallet method and does not revoke other entries.
// An attempted operation retains its original ID/state and can only reconcile.
func (s *Service) Cancel(id string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry, ok := s.data.Entries[id]
	if !ok {
		return Entry{}, ErrInvalid
	}
	if s.closed {
		return cloneEntry(entry), ErrRevoked
	}
	if s.persistErr != nil {
		return cloneEntry(entry), s.persistErr
	}
	if entry.CancelRequestedAt != "" {
		return cloneEntry(entry), resultError(entry)
	}
	switch entry.State {
	case Prepared, Unsupported:
		entry.State = Cancelled
	case Unknown, AwaitingWallet:
		// An external effect may already exist, including after response loss.
		// Do not make its semantic slot available for a replacement operation.
	case Revoked:
		return cloneEntry(entry), ErrRevoked
	default:
		return cloneEntry(entry), ErrConflict
	}
	entry.CancelRequestedAt = timestamp()
	entry.UpdatedAt = entry.CancelRequestedAt
	s.data.Entries[id] = entry
	err := s.save()
	if cancel := s.active[id]; cancel != nil {
		cancel()
	}
	if err != nil {
		return cloneEntry(entry), errors.Join(ErrUnavailable, err)
	}
	return cloneEntry(entry), resultError(entry)
}
