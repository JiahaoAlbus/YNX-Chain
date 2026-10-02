package music

import "time"

func defaultProfile(actor string, now time.Time) Profile {
	return Profile{Account: actor, PrivateHistory: true, CreatorStatus: "listener", CreatedAt: now, UpdatedAt: now}
}

func emptyListener(actor string, now time.Time) ListenerState {
	return normalizeListenerCollections(ListenerState{Account: actor, UpdatedAt: now})
}

func normalizeListenerCollections(listener ListenerState) ListenerState {
	if listener.Favorites == nil {
		listener.Favorites = []string{}
	}
	if listener.Queue == nil {
		listener.Queue = []string{}
	}
	if listener.History == nil {
		listener.History = []HistoryEntry{}
	}
	if listener.Downloads == nil {
		listener.Downloads = map[string]string{}
	}
	if listener.Positions == nil {
		listener.Positions = map[string]int64{}
	}
	return listener
}

// Snapshot is reached only after the server has introspected the product
// session. Its actor is authoritative; no account name from a request body or
// client cache is used to create the first private workspace.
func (s *Service) ensureAccount(actor string) error {
	s.mu.RLock()
	profile, hasProfile := s.state.Profiles[actor]
	listener, hasListener := s.state.Listeners[actor]
	s.mu.RUnlock()
	if hasProfile && hasListener && profile.Account == actor && listener.Account == actor {
		return nil
	}
	err := s.mutate(actor, "account_initialized", actor, map[string]string{"account": actor}, func(st *persistentState) error {
		profile, hasProfile := st.Profiles[actor]
		listener, hasListener := st.Listeners[actor]
		if (hasProfile && profile.Account != actor) || (hasListener && listener.Account != actor) {
			return ErrConflict
		}
		if hasProfile && hasListener {
			return errIdempotentReplay
		}
		now := s.cfg.Now().UTC()
		if !hasProfile {
			st.Profiles[actor] = defaultProfile(actor, now)
		}
		if !hasListener {
			st.Listeners[actor] = emptyListener(actor, now)
		}
		return nil
	})
	if err == errIdempotentReplay {
		return nil
	}
	return err
}
