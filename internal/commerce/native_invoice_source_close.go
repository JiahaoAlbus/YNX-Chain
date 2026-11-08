package commerce

// A retained operation error is independent of actual closure. Only the
// original opaque owner may witness completion; no caller-supplied done flag.
type originalShopClosedWitness interface {
	assertOriginalClosed() error
}

func originalShopCloseComplete(owner any, closeErr error) bool {
	if closeErr == nil {
		return true
	}
	witness, ok := owner.(originalShopClosedWitness)
	return ok && witness.assertOriginalClosed() == nil
}

func (p *originalAuthShopProductPermission) assertOriginalClosed() error {
	if p == nil || p.owner == nil {
		return nil
	}
	return p.owner.AssertOriginalClosed()
}

func (s *originalAuthShopProductReadSource) assertOriginalClosed() error {
	if s == nil || s.owner == nil {
		return nil
	}
	return s.owner.AssertOriginalClosed()
}

func (a *originalShopProductReadAuthority) assertOriginalClosed() error {
	if a == nil || a.source == nil {
		return nil
	}
	if witness, ok := a.source.(originalShopClosedWitness); ok {
		return witness.assertOriginalClosed()
	}
	return ErrConflict
}

func (h *originalShopProductReadHold) assertOriginalClosed() error {
	if h == nil {
		return nil
	}
	if witness, ok := h.permission.(originalShopClosedWitness); ok {
		if err := witness.assertOriginalClosed(); err != nil {
			return err
		}
		h.closed.Store(true)
		return nil
	}
	if !h.closed.Load() {
		return ErrConflict
	}
	// This flag is set only after the original Close succeeds or its original
	// physical witness proves completion despite a retained first error.
	return nil
}
