//go:build pay_pq

package payproduct

// BorrowOriginalNativePayStore is a normal in-process composition port, not a
// Source/Root grant. It returns the same service-owned Store and refuses a
// request-scoped service. The original service keeps ownership and lifecycle;
// no new Store, database, request permission or Root material is created.
func (s *Service) BorrowOriginalNativePayStore() (*Store, error) {
	if s == nil || s.store == nil || s.store.parent != nil {
		return nil, ErrNativePayUnavailable
	}
	return s.store, nil
}
