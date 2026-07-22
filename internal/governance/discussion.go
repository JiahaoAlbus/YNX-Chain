package governance

import (
	"fmt"
	"sort"
	"strings"
	"time"
)

type DiscussionInput struct {
	Nonce      string   `json:"nonce"`
	ProposalID string   `json:"proposalId"`
	Author     string   `json:"author"`
	Kind       string   `json:"kind"`
	Statement  string   `json:"statement"`
	Evidence   []string `json:"evidence"`
	ReplyTo    string   `json:"replyTo,omitempty"`
}
type DiscussionEntry struct {
	ID        string          `json:"id"`
	Input     DiscussionInput `json:"input"`
	CreatedAt time.Time       `json:"createdAt"`
	AuditHash string          `json:"auditHash"`
}

func (s *Service) AddDiscussion(input DiscussionInput, now time.Time) (DiscussionEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now = now.UTC()
	proposal, ok := s.proposals[input.ProposalID]
	if !ok {
		return DiscussionEntry{}, ErrNotFound
	}
	if proposal.Status != StatusDiscussion && proposal.Status != StatusVoting && proposal.Status != StatusTimelocked {
		return DiscussionEntry{}, ErrNotReady
	}
	validKind := input.Kind == "comment" || input.Kind == "technical_review" || input.Kind == "economic_review" || input.Kind == "risk_disclosure"
	if len(strings.TrimSpace(input.Nonce)) < 8 || len(strings.TrimSpace(input.Author)) < 3 || !validKind || len(strings.TrimSpace(input.Statement)) < 16 {
		return DiscussionEntry{}, ErrInvalid
	}
	if _, ok = s.discussionNonces[input.Nonce]; ok {
		return DiscussionEntry{}, ErrReplay
	}
	if input.ReplyTo != "" {
		parent, ok := s.discussions[input.ReplyTo]
		if !ok || parent.Input.ProposalID != input.ProposalID {
			return DiscussionEntry{}, ErrInvalid
		}
	}
	id := hash("discussion", input.Nonce, input.ProposalID, input.Author, input.Kind)
	entry := &DiscussionEntry{ID: id, Input: input, CreatedAt: now}
	entry.AuditHash = discussionAudit(entry)
	s.discussions[id] = entry
	s.discussionNonces[input.Nonce] = struct{}{}
	return cloneDiscussion(entry), nil
}

func (s *Service) Discussion(id string) (DiscussionEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, ok := s.discussions[id]
	if !ok {
		return DiscussionEntry{}, ErrNotFound
	}
	return cloneDiscussion(entry), nil
}
func (s *Service) ListDiscussion(proposalID string) []DiscussionEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []DiscussionEntry{}
	for _, entry := range s.discussions {
		if entry.Input.ProposalID == proposalID {
			out = append(out, cloneDiscussion(entry))
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt.Equal(out[j].CreatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	return out
}
func discussionAudit(entry *DiscussionEntry) string {
	return hash(entry.ID, entry.Input.Nonce, entry.Input.ProposalID, entry.Input.Author, entry.Input.Kind, entry.Input.Statement, strings.Join(entry.Input.Evidence, "|"), entry.Input.ReplyTo, entry.CreatedAt.Format(time.RFC3339Nano))
}
func validateRestoredDiscussion(entry *DiscussionEntry) error {
	if entry.ID != hash("discussion", entry.Input.Nonce, entry.Input.ProposalID, entry.Input.Author, entry.Input.Kind) || entry.AuditHash != discussionAudit(entry) || entry.CreatedAt.IsZero() {
		return fmt.Errorf("%w: invalid discussion audit", ErrForbidden)
	}
	return nil
}
func cloneDiscussion(entry *DiscussionEntry) DiscussionEntry {
	out := *entry
	out.Input.Evidence = append([]string(nil), entry.Input.Evidence...)
	return out
}
