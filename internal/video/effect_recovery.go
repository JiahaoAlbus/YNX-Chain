package video

// Record only the uncertain dispatch status after cancellation/revocation. This
// internal recovery write cannot attach an external result, release a reserved
// balance, issue a new effect or authorize an old caller's business operation.
func (s *Service) markPayoutUnknown(owner, id string) {
	recovery := &Store{videoStateStore: s.store.videoStateStore}
	_ = recovery.update(func(st *State) error {
		p := st.PayoutIntents[id]
		if p == nil || p.Owner != owner || p.State != "dispatching" {
			return ErrUnauthorized
		}
		p.State = "recovery_required"
		s.audit(st, owner, "payout.intent.unconfirmed", "payout", id, "")
		return nil
	})
}

func (s *Service) markAIUnknown(actor, id string) {
	recovery := &Store{videoStateStore: s.store.videoStateStore}
	_ = recovery.update(func(st *State) error {
		j := st.AIJobs[id]
		if j == nil || j.Owner != actor || j.State != "running" {
			return ErrUnauthorized
		}
		j.State = "recovery_required"
		j.Failure = "provider result unconfirmed; check this saved request before any new operation"
		s.audit(st, actor, "ai.result.unconfirmed", "ai_job", id, "")
		return nil
	})
}
