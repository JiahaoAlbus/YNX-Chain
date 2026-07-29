package datafabric

func (s *Store) RegisterBillingRatePlan(plan BillingRatePlan) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := plan.Validate(); err != nil {
		return err
	}
	for _, existing := range s.state.BillingRatePlans {
		if existing.PlanID == plan.PlanID && existing.Version == plan.Version {
			return Reject(CodeBillingRatePlanDuplicate, "Billing rate plan version is immutable and already registered", map[string]string{"planId": plan.PlanID, "version": plan.Version})
		}
	}
	next := cloneState(s.state)
	next.BillingRatePlans = append(next.BillingRatePlans, plan)
	return s.commit(next)
}

func (s *Store) BillingRatePlans() []BillingRatePlan {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]BillingRatePlan(nil), s.state.BillingRatePlans...)
}

func (s *Store) BillingSettlements() []BillingSettlement {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]BillingSettlement(nil), s.state.BillingSettlements...)
}

func (s *Store) BillingSettlement(id string) (BillingSettlement, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, settlement := range s.state.BillingSettlements {
		if settlement.SettlementID == id {
			return settlement, true
		}
	}
	return BillingSettlement{}, false
}

func (s *Store) SettleUsage(request BillingSettlementRequest) (BillingSettlement, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := request.Validate(); err != nil {
		return BillingSettlement{}, err
	}
	var event EventEnvelope
	eventFound := false
	for _, candidate := range s.state.Events {
		if candidate.EventID == request.UsageEventID {
			event, eventFound = candidate, true
			break
		}
	}
	if !eventFound {
		return BillingSettlement{}, Reject(CodeBillingUsageInvalid, "Billing references an unknown canonical usage event", map[string]string{"eventId": request.UsageEventID})
	}
	var plan BillingRatePlan
	planFound := false
	for _, candidate := range s.state.BillingRatePlans {
		if candidate.PlanID == request.RatePlanID && candidate.Version == request.RatePlanVersion {
			plan, planFound = candidate, true
			break
		}
	}
	if !planFound {
		return BillingSettlement{}, Reject(CodeBillingRatePlanNotFound, "Billing rate plan version is not registered", map[string]string{"planId": request.RatePlanID, "version": request.RatePlanVersion})
	}
	for _, existing := range s.state.BillingSettlements {
		if existing.SettlementID == request.SettlementID || existing.UsageEventID == request.UsageEventID {
			return BillingSettlement{}, Reject(CodeBillingAlreadySettled, "Canonical usage event is already settled", map[string]string{"settlementId": existing.SettlementID, "eventId": request.UsageEventID})
		}
	}
	settlement, entry, err := BuildBillingSettlement(plan, event, request)
	if err != nil {
		return BillingSettlement{}, err
	}
	if err := s.validateJournalLocked(entry); err != nil {
		return BillingSettlement{}, err
	}
	next := cloneState(s.state)
	next.Ledger = append(next.Ledger, entry)
	next.BillingSettlements = append(next.BillingSettlements, settlement)
	if err := s.commit(next); err != nil {
		return BillingSettlement{}, err
	}
	return settlement, nil
}
