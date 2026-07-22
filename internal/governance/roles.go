package governance

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

const genesisRoleManifestVersion = "ynx-governance-genesis-roles/v1"

type GovernanceRole string

const (
	RoleTokenHolder      GovernanceRole = "token_holder_delegator"
	RoleValidator        GovernanceRole = "validator"
	RoleDelegate         GovernanceRole = "delegate"
	RoleTechnicalCouncil GovernanceRole = "technical_council"
	RoleSecurityCouncil  GovernanceRole = "security_council"
	RoleTreasuryCouncil  GovernanceRole = "treasury_council"
	RoleObserver         GovernanceRole = "appeal_transparency_observer"
)

type RoleAssignmentInput struct {
	Account            string         `json:"account"`
	Role               GovernanceRole `json:"role"`
	Scopes             []Scope        `json:"scopes"`
	TermStartsAt       time.Time      `json:"termStartsAt"`
	TermEndsAt         time.Time      `json:"termEndsAt"`
	DecisionThreshold  uint64         `json:"decisionThreshold"`
	ConflictDisclosure string         `json:"conflictDisclosure"`
	Evidence           []string       `json:"evidence"`
}

type RoleAssignment struct {
	ID                string              `json:"id"`
	Input             RoleAssignmentInput `json:"input"`
	Status            string              `json:"status"`
	ProposalID        string              `json:"proposalId"`
	RemovalProposalID string              `json:"removalProposalId,omitempty"`
	AuditHash         string              `json:"auditHash"`
	CreatedAt         time.Time           `json:"createdAt"`
	RemovedAt         time.Time           `json:"removedAt,omitempty"`
}

func GenesisRoleManifestHash(inputs []RoleAssignmentInput) (string, error) {
	normalized, err := normalizeGenesisRoles(inputs)
	if err != nil {
		return "", err
	}
	encoded, err := json.Marshal(struct {
		Version string                `json:"version"`
		Roles   []RoleAssignmentInput `json:"roles"`
	}{genesisRoleManifestVersion, normalized})
	if err != nil {
		return "", err
	}
	return hash(genesisRoleManifestVersion, string(encoded)), nil
}

func (s *Service) BootstrapRoles(inputs []RoleAssignmentInput, manifestHash string, now time.Time) ([]RoleAssignment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	if len(s.roles) != 0 || len(s.proposals) != 0 {
		return nil, ErrConflict
	}
	expected, err := GenesisRoleManifestHash(inputs)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(expected, s.policy.GenesisRoleManifestHash) || !strings.EqualFold(expected, manifestHash) {
		return nil, fmt.Errorf("%w: genesis role manifest hash mismatch", ErrForbidden)
	}
	normalized, _ := normalizeGenesisRoles(inputs)
	counts := map[GovernanceRole]uint64{}
	accounts := map[string]bool{}
	for _, input := range normalized {
		if err = validateRoleInput(input, now); err != nil {
			return nil, err
		}
		if accounts[input.Account] {
			return nil, fmt.Errorf("%w: genesis council account may hold one role", ErrConflict)
		}
		accounts[input.Account] = true
		counts[input.Role]++
	}
	if counts[RoleTechnicalCouncil] < 2 || counts[RoleSecurityCouncil] < s.policy.EmergencyThreshold || counts[RoleTreasuryCouncil] < 2 {
		return nil, fmt.Errorf("%w: genesis councils do not satisfy distributed thresholds", ErrForbidden)
	}
	out := make([]RoleAssignment, 0, len(normalized))
	for _, input := range normalized {
		if (input.Role == RoleTechnicalCouncil || input.Role == RoleSecurityCouncil || input.Role == RoleTreasuryCouncil) && (input.DecisionThreshold < 2 || input.DecisionThreshold > counts[input.Role]) {
			return nil, fmt.Errorf("%w: invalid genesis council threshold", ErrForbidden)
		}
		id := hash("role", input.Account, string(input.Role), expected, input.TermStartsAt.UTC().Format(time.RFC3339Nano), input.TermEndsAt.UTC().Format(time.RFC3339Nano))
		a := &RoleAssignment{ID: id, Input: input, Status: "active", ProposalID: "genesis:" + expected, CreatedAt: now}
		a.AuditHash = roleAudit(a)
		s.roles[id] = a
		out = append(out, cloneRole(a))
	}
	return out, nil
}

func normalizeGenesisRoles(inputs []RoleAssignmentInput) ([]RoleAssignmentInput, error) {
	if len(inputs) == 0 {
		return nil, ErrInvalid
	}
	out := append([]RoleAssignmentInput(nil), inputs...)
	for i := range out {
		out[i].Scopes = append([]Scope(nil), out[i].Scopes...)
		out[i].Evidence = append([]string(nil), out[i].Evidence...)
		sort.Slice(out[i].Scopes, func(a, b int) bool { return out[i].Scopes[a] < out[i].Scopes[b] })
		sort.Strings(out[i].Evidence)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Account == out[j].Account {
			return out[i].Role < out[j].Role
		}
		return out[i].Account < out[j].Account
	})
	return out, nil
}

func (s *Service) AssignRole(input RoleAssignmentInput, proposalID string, now time.Time) (RoleAssignment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	p, ok := s.proposals[proposalID]
	if !ok || p.Status != StatusExecuted {
		return RoleAssignment{}, fmt.Errorf("%w: executed governance proposal required", ErrForbidden)
	}
	if err := validateRoleInput(input, now); err != nil {
		return RoleAssignment{}, err
	}
	for _, current := range s.roles {
		if current.Input.Account == input.Account && current.Input.Role == input.Role && current.Status == "active" && current.Input.TermEndsAt.After(now) {
			return RoleAssignment{}, ErrConflict
		}
	}
	scopes := append([]Scope(nil), input.Scopes...)
	sort.Slice(scopes, func(i, j int) bool { return scopes[i] < scopes[j] })
	input.Scopes = scopes
	id := hash("role", input.Account, string(input.Role), proposalID, input.TermStartsAt.UTC().Format(time.RFC3339Nano), input.TermEndsAt.UTC().Format(time.RFC3339Nano))
	a := &RoleAssignment{ID: id, Input: input, Status: "active", ProposalID: proposalID, CreatedAt: now}
	a.AuditHash = roleAudit(a)
	s.roles[id] = a
	return cloneRole(a), nil
}

func (s *Service) RemoveRole(id, proposalID string, now time.Time) (RoleAssignment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.roles[id]
	if !ok {
		return RoleAssignment{}, ErrNotFound
	}
	p, ok := s.proposals[proposalID]
	if !ok || p.Status != StatusExecuted || a.Status != "active" {
		return RoleAssignment{}, ErrForbidden
	}
	a.Status = "removed"
	a.RemovalProposalID = proposalID
	a.RemovedAt = now.UTC()
	a.AuditHash = roleAudit(a)
	return cloneRole(a), nil
}

func (s *Service) ActiveRoleNames(account string, asOf time.Time) map[string]bool {
	return s.ActiveEntitlements(account, asOf).Roles
}

type Entitlements struct {
	Roles  map[string]bool
	Scopes map[Scope]bool
}

func (s *Service) ActiveEntitlements(account string, asOf time.Time) Entitlements {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := Entitlements{Roles: map[string]bool{}, Scopes: map[Scope]bool{}}
	for _, a := range s.roles {
		if a.Input.Account == account && a.Status == "active" && !asOf.UTC().Before(a.Input.TermStartsAt) && asOf.UTC().Before(a.Input.TermEndsAt) {
			for _, permission := range permissionsForRole(a.Input.Role) {
				out.Roles[permission] = true
			}
			for _, scope := range a.Input.Scopes {
				out.Scopes[scope] = true
			}
		}
	}
	return out
}

func (s *Service) hasRoleAt(account string, role GovernanceRole, scope Scope, asOf time.Time) bool {
	for _, assignment := range s.roles {
		if assignment.Input.Account != account || assignment.Input.Role != role || assignment.Status != "active" || asOf.UTC().Before(assignment.Input.TermStartsAt) || !asOf.UTC().Before(assignment.Input.TermEndsAt) {
			continue
		}
		for _, allowed := range assignment.Input.Scopes {
			if allowed == scope {
				return true
			}
		}
	}
	return false
}
func (s *Service) ListRoles() []RoleAssignment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]RoleAssignment, 0, len(s.roles))
	for _, a := range s.roles {
		out = append(out, cloneRole(a))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

func validateRoleInput(input RoleAssignmentInput, now time.Time) error {
	valid := map[GovernanceRole]bool{RoleTokenHolder: true, RoleValidator: true, RoleDelegate: true, RoleTechnicalCouncil: true, RoleSecurityCouncil: true, RoleTreasuryCouncil: true, RoleObserver: true}
	if !valid[input.Role] || len(strings.TrimSpace(input.Account)) < 3 || len(input.Scopes) == 0 || input.TermStartsAt.Before(now.Add(-time.Minute)) || !input.TermEndsAt.After(input.TermStartsAt) || input.TermEndsAt.After(input.TermStartsAt.Add(2*365*24*time.Hour)) || input.DecisionThreshold == 0 || len(strings.TrimSpace(input.ConflictDisclosure)) < 8 || len(input.Evidence) == 0 {
		return ErrInvalid
	}
	seen := map[Scope]bool{}
	for _, scope := range input.Scopes {
		if scope == "" || seen[scope] {
			return ErrInvalid
		}
		seen[scope] = true
	}
	return nil
}
func permissionsForRole(role GovernanceRole) []string {
	switch role {
	case RoleTokenHolder:
		return []string{"proposer", "depositor", "participant", "voter"}
	case RoleValidator:
		return []string{"proposer", "depositor", "participant", "voter", "verifier"}
	case RoleDelegate:
		return []string{"proposer", "depositor", "participant", "voter"}
	case RoleTechnicalCouncil:
		return []string{"proposer", "participant", "technical_council", "verifier", "emergency_signer"}
	case RoleSecurityCouncil:
		return []string{"proposer", "participant", "verifier", "emergency_proposer", "emergency_signer", "emergency_operator"}
	case RoleTreasuryCouncil:
		return []string{"proposer", "participant", "voter", "executor"}
	case RoleObserver:
		return []string{"participant", "verifier", "appeal_resolver"}
	default:
		return nil
	}
}
func roleAudit(a *RoleAssignment) string {
	return hash(a.ID, a.Status, a.ProposalID, a.RemovalProposalID, a.Input.Account, string(a.Input.Role), a.Input.TermStartsAt.UTC().Format(time.RFC3339Nano), a.Input.TermEndsAt.UTC().Format(time.RFC3339Nano))
}
func cloneRole(a *RoleAssignment) RoleAssignment {
	out := *a
	out.Input.Scopes = append([]Scope(nil), a.Input.Scopes...)
	out.Input.Evidence = append([]string(nil), a.Input.Evidence...)
	return out
}
