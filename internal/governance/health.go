package governance

import "time"

type Health struct {
	OK                    bool   `json:"ok"`
	Service               string `json:"service"`
	Persistence           string `json:"persistence"`
	ExternalExecution     bool   `json:"externalExecution"`
	ProposalCount         int    `json:"proposalCount"`
	ActiveProposalCount   int    `json:"activeProposalCount"`
	ExecutedProposalCount int    `json:"executedProposalCount"`
	RejectedProposalCount int    `json:"rejectedProposalCount"`
	RoleCount             int    `json:"roleCount"`
	ActiveRoleCount       int    `json:"activeRoleCount"`
	EmergencyCount        int    `json:"emergencyCount"`
	ActiveEmergencyCount  int    `json:"activeEmergencyCount"`
	AppealCount           int    `json:"appealCount"`
	PendingAppealCount    int    `json:"pendingAppealCount"`
	DiscussionCount       int    `json:"discussionCount"`
	TruthfulStatus        string `json:"truthfulStatus"`
}

func (s *Service) Health(now time.Time) Health {
	s.mu.Lock()
	defer s.mu.Unlock()
	h := Health{OK: true, Service: "ynx-governanced", Persistence: "atomic-sha256-mode-0600", ExternalExecution: false, ProposalCount: len(s.proposals), RoleCount: len(s.roles), EmergencyCount: len(s.emergencies), AppealCount: len(s.appeals), DiscussionCount: len(s.discussions), TruthfulStatus: "local-governance-control-plane-not-publicly-deployed"}
	for _, p := range s.proposals {
		switch p.Status {
		case StatusExecuted:
			h.ExecutedProposalCount++
		case StatusRejected:
			h.RejectedProposalCount++
		case StatusDeposit, StatusDiscussion, StatusVoting, StatusTimelocked, StatusExecuting:
			h.ActiveProposalCount++
		}
	}
	for _, r := range s.roles {
		if r.Status == "active" && !now.UTC().Before(r.Input.TermStartsAt) && now.UTC().Before(r.Input.TermEndsAt) {
			h.ActiveRoleCount++
		}
	}
	for _, a := range s.emergencies {
		s.expireEmergency(a, now.UTC())
		if a.Status == "active" {
			h.ActiveEmergencyCount++
		}
	}
	for _, a := range s.appeals {
		if a.Status == "pending" {
			h.PendingAppealCount++
		}
	}
	return h
}
