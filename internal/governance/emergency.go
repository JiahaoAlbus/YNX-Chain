package governance

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type EmergencyScope string

const (
	EmergencyBridge   EmergencyScope = "bridge"
	EmergencyOracle   EmergencyScope = "oracle_route"
	EmergencyMarket   EmergencyScope = "market"
	EmergencyVault    EmergencyScope = "vault"
	EmergencyProvider EmergencyScope = "provider"
	EmergencyUpgrade  EmergencyScope = "upgrade"
)

type EmergencyInput struct {
	Nonce      string         `json:"nonce"`
	Scope      EmergencyScope `json:"scope"`
	Target     string         `json:"target"`
	Reason     string         `json:"reason"`
	Evidence   []string       `json:"evidence"`
	Notice     string         `json:"notice"`
	Duration   time.Duration  `json:"duration"`
	FollowUpBy time.Time      `json:"followUpBy"`
}

type EmergencyApproval struct {
	Signer    string    `json:"signer"`
	Role      string    `json:"role"`
	SignedAt  time.Time `json:"signedAt"`
	AuditHash string    `json:"auditHash"`
}

type EmergencyAction struct {
	ID                 string                       `json:"id"`
	Input              EmergencyInput               `json:"input"`
	Status             string                       `json:"status"`
	Approvals          map[string]EmergencyApproval `json:"approvals"`
	ActivatedAt        time.Time                    `json:"activatedAt,omitempty"`
	ExpiresAt          time.Time                    `json:"expiresAt,omitempty"`
	ClosedAt           time.Time                    `json:"closedAt,omitempty"`
	FollowUpProposalID string                       `json:"followUpProposalId,omitempty"`
	CreatedAt          time.Time                    `json:"createdAt"`
	UpdatedAt          time.Time                    `json:"updatedAt"`
}

func (s *Service) CreateEmergency(input EmergencyInput, proposer string, now time.Time) (EmergencyAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	if err := s.validateEmergency(input, proposer, now); err != nil {
		return EmergencyAction{}, err
	}
	if _, ok := s.emergencyNonces[input.Nonce]; ok {
		return EmergencyAction{}, ErrReplay
	}
	for _, action := range s.emergencies {
		if action.Input.Scope == input.Scope && action.Input.Target == input.Target && (action.Status == "pending_approval" || action.Status == "active") {
			return EmergencyAction{}, fmt.Errorf("%w: emergency target already pending or paused", ErrConflict)
		}
	}
	id := hash("emergency", input.Nonce, string(input.Scope), input.Target)
	a := &EmergencyAction{ID: id, Input: input, Status: "pending_approval", Approvals: map[string]EmergencyApproval{}, CreatedAt: now, UpdatedAt: now}
	s.emergencies[id], s.emergencyNonces[input.Nonce] = a, struct{}{}
	return cloneEmergency(a), nil
}

func (s *Service) ApproveEmergency(id, signer, role string, now time.Time) (EmergencyAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.emergencies[id]
	if !ok {
		return EmergencyAction{}, ErrNotFound
	}
	now = now.UTC()
	s.expireEmergency(a, now)
	if a.Status != "pending_approval" || strings.TrimSpace(signer) == "" || (role != "security_council" && role != "technical_council") {
		return EmergencyAction{}, ErrForbidden
	}
	if _, ok := a.Approvals[signer]; ok {
		return EmergencyAction{}, ErrReplay
	}
	a.Approvals[signer] = EmergencyApproval{Signer: signer, Role: role, SignedAt: now, AuditHash: hash(id, signer, role)}
	a.UpdatedAt = now
	if uint64(len(a.Approvals)) >= s.policy.EmergencyThreshold {
		a.Status = "active"
		a.ActivatedAt = now
		a.ExpiresAt = now.Add(a.Input.Duration)
	}
	return cloneEmergency(a), nil
}

func (s *Service) CloseEmergency(id, followUpProposalID string, now time.Time) (EmergencyAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.emergencies[id]
	if !ok {
		return EmergencyAction{}, ErrNotFound
	}
	now = now.UTC()
	s.expireEmergency(a, now)
	if a.Status != "active" && a.Status != "expired" {
		return EmergencyAction{}, ErrNotReady
	}
	p, ok := s.proposals[followUpProposalID]
	if !ok || p.CreatedAt.After(a.Input.FollowUpBy) {
		return EmergencyAction{}, fmt.Errorf("%w: public follow-up proposal required", ErrNotReady)
	}
	a.Status, a.ClosedAt, a.FollowUpProposalID, a.UpdatedAt = "closed", now, followUpProposalID, now
	return cloneEmergency(a), nil
}

func (s *Service) Emergency(id string, now time.Time) (EmergencyAction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.emergencies[id]
	if !ok {
		return EmergencyAction{}, ErrNotFound
	}
	s.expireEmergency(a, now.UTC())
	return cloneEmergency(a), nil
}

func (s *Service) ListEmergencies(now time.Time) []EmergencyAction {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]EmergencyAction, 0, len(s.emergencies))
	for _, action := range s.emergencies {
		s.expireEmergency(action, now.UTC())
		items = append(items, cloneEmergency(action))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].CreatedAt.Equal(items[j].CreatedAt) {
			return items[i].ID < items[j].ID
		}
		return items[i].CreatedAt.After(items[j].CreatedAt)
	})
	return items
}

func (s *Service) ActiveEmergency(scope EmergencyScope, target string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, a := range s.emergencies {
		s.expireEmergency(a, now.UTC())
		if a.Status == "active" && a.Input.Scope == scope && a.Input.Target == target {
			return true
		}
	}
	return false
}

func (s *Service) validateEmergency(input EmergencyInput, proposer string, now time.Time) error {
	valid := map[EmergencyScope]bool{EmergencyBridge: true, EmergencyOracle: true, EmergencyMarket: true, EmergencyVault: true, EmergencyProvider: true, EmergencyUpgrade: true}
	if !valid[input.Scope] || len(strings.TrimSpace(input.Nonce)) < 8 || len(strings.TrimSpace(proposer)) < 3 || len(strings.TrimSpace(input.Target)) < 3 || len(strings.TrimSpace(input.Reason)) < 16 || len(strings.TrimSpace(input.Notice)) < 16 || len(input.Evidence) == 0 || input.Duration <= 0 || input.Duration > s.policy.EmergencyMaxDuration || input.FollowUpBy.Before(now.Add(input.Duration)) || input.FollowUpBy.After(now.Add(7*24*time.Hour)) {
		return ErrInvalid
	}
	for _, text := range []string{input.Target, input.Reason, input.Notice} {
		lowered := strings.ToLower(text)
		for _, forbidden := range []string{"transfer user asset", "transfer_user_asset", "mint", "burn", "owner change", "restore mandate", "permanent parameter"} {
			if strings.Contains(lowered, forbidden) {
				return fmt.Errorf("%w: emergency council may only pause", ErrForbidden)
			}
		}
	}
	return nil
}

func (s *Service) expireEmergency(a *EmergencyAction, now time.Time) {
	if a.Status == "active" && !now.Before(a.ExpiresAt) {
		a.Status, a.UpdatedAt = "expired", now
	}
}
func cloneEmergency(a *EmergencyAction) EmergencyAction {
	out := *a
	out.Input.Evidence = append([]string(nil), a.Input.Evidence...)
	out.Approvals = map[string]EmergencyApproval{}
	for k, v := range a.Approvals {
		out.Approvals[k] = v
	}
	return out
}
