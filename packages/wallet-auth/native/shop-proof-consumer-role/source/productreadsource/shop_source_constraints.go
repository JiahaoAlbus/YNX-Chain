package productreadsource

// DATA projection reached ONLY after actual client.Current in the C getter.
// This function does not authenticate a Source or construct a ShopSession.
func originalShopConstraintAtObserved(d OriginalCaptureDATA, index uint32) (ReadScopeDATA, error) {
	if uint64(index) >= uint64(len(d.Selections)) || len(d.Selections) > 64 {
		return ReadScopeDATA{}, ErrDenied
	}
	s := d.Selections[int(index)]
	if s.ProductID != "shop.order" || s.Actor != d.Scope.Account || s.Epoch != d.Profile.Epoch || s.Realm != d.Profile.Realm || s.Tenant != d.Profile.Tenant || (s.Role != "buyer" && s.Role != "seller") || s.StoreID == "" || !scopeAllows(d.Scope, s.ProductID, s.SourceOrder) {
		return ReadScopeDATA{}, ErrDenied
	}
	return s, nil
}
