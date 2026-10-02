package social

// PreviewContact resolves only public profile information. A preview neither
// authenticates encryption keys nor creates a contact or a conversation.
func (s *Service) PreviewContact(actor Session, resolver DiscoveryResolver, source, value string) (PersonView, error) {
	if resolver == nil || s.cfg.Square == nil {
		return PersonView{}, ErrConflict
	}
	if !allowedSources[source] {
		return PersonView{}, ErrInvalid
	}
	target, err := resolver.ResolveDiscovery(source, value)
	if err != nil {
		return PersonView{}, err
	}
	if target == actor.Account {
		return PersonView{}, ErrInvalid
	}
	settings := s.currentSettings(target)
	if source == "handle" && !settings.DiscoverableByHandle || source == "recommendation" && !settings.AllowRecommendations {
		return PersonView{}, ErrNotFound
	}
	s.mu.Lock()
	blocked := s.blockedLocked(actor.Account, target)
	s.mu.Unlock()
	if blocked {
		return PersonView{}, ErrNotFound
	}
	return s.person(target)
}
