package governance

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type AppealInput struct {
	Nonce       string   `json:"nonce"`
	ProposalID  string   `json:"proposalId"`
	Submitter   string   `json:"submitter"`
	Kind        string   `json:"kind"`
	Explanation string   `json:"explanation"`
	Evidence    []string `json:"evidence"`
}
type AppealResolution struct {
	Outcome              string    `json:"outcome"`
	Explanation          string    `json:"explanation"`
	Evidence             []string  `json:"evidence"`
	ResolutionProposalID string    `json:"resolutionProposalId"`
	Resolver             string    `json:"resolver"`
	ResolvedAt           time.Time `json:"resolvedAt"`
	AuditHash            string    `json:"auditHash"`
}
type Appeal struct {
	ID         string            `json:"id"`
	Input      AppealInput       `json:"input"`
	Status     string            `json:"status"`
	Resolution *AppealResolution `json:"resolution,omitempty"`
	CreatedAt  time.Time         `json:"createdAt"`
	AuditHash  string            `json:"auditHash"`
}

func (s *Service) SubmitAppeal(input AppealInput, now time.Time) (Appeal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	if len(strings.TrimSpace(input.Nonce)) < 8 || len(strings.TrimSpace(input.Submitter)) < 3 || (input.Kind != "appeal" && input.Kind != "correction") || len(strings.TrimSpace(input.Explanation)) < 16 || len(input.Evidence) == 0 {
		return Appeal{}, ErrInvalid
	}
	if _, ok := s.proposals[input.ProposalID]; !ok {
		return Appeal{}, ErrNotFound
	}
	if _, ok := s.appealNonces[input.Nonce]; ok {
		return Appeal{}, ErrReplay
	}
	for _, current := range s.appeals {
		if current.Input.ProposalID == input.ProposalID && current.Input.Submitter == input.Submitter && current.Input.Kind == input.Kind && current.Status == "pending" {
			return Appeal{}, ErrConflict
		}
	}
	id := hash("appeal", input.Nonce, input.ProposalID, input.Submitter, input.Kind)
	a := &Appeal{ID: id, Input: input, Status: "pending", CreatedAt: now}
	a.AuditHash = appealAudit(a)
	s.appeals[id] = a
	s.appealNonces[input.Nonce] = struct{}{}
	return cloneAppeal(a), nil
}

func (s *Service) ResolveAppeal(id, resolutionProposalID, resolver, outcome, explanation string, evidence []string, now time.Time) (Appeal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.appeals[id]
	if !ok {
		return Appeal{}, ErrNotFound
	}
	p, ok := s.proposals[resolutionProposalID]
	if !ok || p.Status != StatusExecuted || a.Status != "pending" || resolutionProposalID == a.Input.ProposalID {
		return Appeal{}, ErrForbidden
	}
	if outcome != "accepted" && outcome != "rejected" {
		return Appeal{}, ErrInvalid
	}
	if len(strings.TrimSpace(resolver)) < 3 || len(strings.TrimSpace(explanation)) < 16 || len(evidence) == 0 {
		return Appeal{}, ErrInvalid
	}
	r := &AppealResolution{Outcome: outcome, Explanation: strings.TrimSpace(explanation), Evidence: append([]string(nil), evidence...), ResolutionProposalID: resolutionProposalID, Resolver: resolver, ResolvedAt: now.UTC()}
	r.AuditHash = hash(id, r.Outcome, r.Explanation, strings.Join(r.Evidence, "|"), r.ResolutionProposalID, r.Resolver, r.ResolvedAt.Format(time.RFC3339Nano))
	a.Resolution = r
	a.Status = "resolved_" + outcome
	a.AuditHash = appealAudit(a)
	return cloneAppeal(a), nil
}

func (s *Service) Appeal(id string) (Appeal, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	a, ok := s.appeals[id]
	if !ok {
		return Appeal{}, ErrNotFound
	}
	return cloneAppeal(a), nil
}
func (s *Service) ListAppeals() []Appeal {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Appeal, 0, len(s.appeals))
	for _, a := range s.appeals {
		out = append(out, cloneAppeal(a))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.After(out[j].CreatedAt)
	})
	return out
}
func appealAudit(a *Appeal) string {
	resolution := ""
	if a.Resolution != nil {
		resolution = a.Resolution.AuditHash
	}
	return hash(a.ID, a.Input.Nonce, a.Input.ProposalID, a.Input.Submitter, a.Input.Kind, a.Input.Explanation, strings.Join(a.Input.Evidence, "|"), a.Status, a.CreatedAt.Format(time.RFC3339Nano), resolution)
}
func validateRestoredAppeal(a *Appeal) error {
	if a.ID != hash("appeal", a.Input.Nonce, a.Input.ProposalID, a.Input.Submitter, a.Input.Kind) || a.AuditHash != appealAudit(a) || a.CreatedAt.IsZero() {
		return fmt.Errorf("%w: invalid appeal audit", ErrForbidden)
	}
	if a.Status == "pending" {
		if a.Resolution != nil {
			return ErrForbidden
		}
		return nil
	}
	if a.Status != "resolved_accepted" && a.Status != "resolved_rejected" || a.Resolution == nil {
		return ErrForbidden
	}
	r := a.Resolution
	expected := hash(a.ID, r.Outcome, r.Explanation, strings.Join(r.Evidence, "|"), r.ResolutionProposalID, r.Resolver, r.ResolvedAt.Format(time.RFC3339Nano))
	if r.AuditHash != expected {
		return fmt.Errorf("%w: invalid appeal resolution audit", ErrForbidden)
	}
	return nil
}
func cloneAppeal(a *Appeal) Appeal {
	out := *a
	out.Input.Evidence = append([]string(nil), a.Input.Evidence...)
	if a.Resolution != nil {
		r := *a.Resolution
		r.Evidence = append([]string(nil), a.Resolution.Evidence...)
		out.Resolution = &r
	}
	return out
}
