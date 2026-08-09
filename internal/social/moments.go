package social

import (
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/square"
)

var evidenceHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func (s *Service) CreateMoment(actor Session, idempotencyKey, text, visibility string, mediaIDs []string) (Moment, bool, error) {
	text = strings.TrimSpace(text)
	if !identifierPattern.MatchString(idempotencyKey) || len(text) > 2000 || (text == "" && len(mediaIDs) == 0) || len(mediaIDs) > 4 || !contains([]string{"public", "contacts", "private"}, visibility) {
		return Moment{}, false, ErrInvalid
	}
	document := struct {
		Text, Visibility string
		Media            []string
	}{text, visibility, append([]string(nil), mediaIDs...)}
	digest := objectDigest(document)
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	s.mu.Lock()
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		record := s.state.Moments[previous.ObjectID]
		s.mu.Unlock()
		if previous.Action != "moment_create" || previous.Digest != digest {
			return Moment{}, false, ErrConflict
		}
		return record, true, nil
	}
	for _, mediaID := range mediaIDs {
		media, ok := s.state.Media[mediaID]
		if !ok || media.Owner != actor.Account {
			s.mu.Unlock()
			return Moment{}, false, ErrUnauthorized
		}
	}
	s.mu.Unlock()
	squarePostID := ""
	if visibility == "public" && s.cfg.Square != nil && text != "" {
		result, err := s.cfg.Square.CreatePost(square.Device{ID: actor.DeviceID, Account: actor.Account}, square.CreatePostRequest{IdempotencyKey: idempotencyKey, Content: text, Tags: []string{"ynx-social-moment"}})
		if err != nil {
			return Moment{}, false, socialSquareError(err)
		}
		squarePostID = result.Record.ID
	}
	now := s.cfg.Now().UTC()
	id := "moment_" + objectDigest(struct{ A, D string }{actor.Account, digest})[:24]
	record := Moment{ID: id, SquarePostID: squarePostID, Author: actor.Account, Text: text, MediaIDs: append([]string(nil), mediaIDs...), Visibility: visibility, Status: "active", CreatedAt: now, UpdatedAt: now}
	s.mu.Lock()
	defer s.mu.Unlock()
	before := cloneState(s.state)
	s.state.Moments[id] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "moment_create", Digest: digest, ObjectID: id}
	s.appendAuditLocked("moment_created", "moment", id, actor.Account, digest, now)
	s.notifyMentionsLocked(actor.Account, text, id, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) VisibleMoments(actor Session) []Moment {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []Moment{}
	for _, moment := range s.state.Moments {
		if s.canViewMomentLocked(actor.Account, moment) {
			out = append(out, moment)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (s *Service) Moment(actor Session, id string) (Moment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	moment, ok := s.state.Moments[id]
	if !ok || moment.Status == "deleted" {
		return Moment{}, ErrNotFound
	}
	if !s.canViewMomentLocked(actor.Account, moment) {
		return Moment{}, ErrUnauthorized
	}
	return moment, nil
}

func (s *Service) DeleteMoment(actor Session, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	moment, ok := s.state.Moments[id]
	if !ok || moment.Status == "deleted" {
		return ErrNotFound
	}
	if moment.Author != actor.Account {
		return ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	moment.Status, moment.DeletedAt, moment.UpdatedAt = "deleted", &now, now
	s.state.Moments[id] = moment
	s.appendAuditLocked("moment_deleted", "moment", id, actor.Account, objectDigest(moment), now)
	return s.saveOrRollbackLocked(before)
}

func (s *Service) CreateMomentComment(actor Session, momentID, idempotencyKey, text string) (MomentComment, bool, error) {
	text = strings.TrimSpace(text)
	if !identifierPattern.MatchString(idempotencyKey) || text == "" || len(text) > 1000 {
		return MomentComment{}, false, ErrInvalid
	}
	digest := objectDigest(struct{ M, T, A string }{momentID, text, actor.Account})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	moment, ok := s.state.Moments[momentID]
	if !ok || !s.canViewMomentLocked(actor.Account, moment) {
		return MomentComment{}, false, ErrUnauthorized
	}
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "moment_comment" || previous.Digest != digest {
			return MomentComment{}, false, ErrConflict
		}
		for _, comment := range s.state.MomentComments[momentID] {
			if comment.ID == previous.ObjectID {
				return comment, true, nil
			}
		}
	}
	now := s.cfg.Now().UTC()
	record := MomentComment{ID: "comment_" + digest[:24], MomentID: momentID, Author: actor.Account, Text: text, CreatedAt: now}
	before := cloneState(s.state)
	s.state.MomentComments[momentID] = append(s.state.MomentComments[momentID], record)
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "moment_comment", Digest: digest, ObjectID: record.ID}
	if moment.Author != actor.Account {
		s.notifyLocked(moment.Author, actor.Account, "comment", momentID, now)
	}
	s.notifyMentionsLocked(actor.Account, text, record.ID, now)
	s.appendAuditLocked("moment_commented", "comment", record.ID, actor.Account, digest, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) MomentComments(actor Session, momentID string) ([]MomentComment, error) {
	if _, err := s.Moment(actor, momentID); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []MomentComment{}
	for _, comment := range s.state.MomentComments[momentID] {
		if comment.DeletedAt == nil {
			out = append(out, comment)
		}
	}
	return out, nil
}

func (s *Service) SetMomentReaction(actor Session, momentID, idempotencyKey, kind string, active bool) (MomentReaction, bool, error) {
	if !identifierPattern.MatchString(idempotencyKey) || !contains([]string{"like", "love", "insight", "support"}, kind) {
		return MomentReaction{}, false, ErrInvalid
	}
	digest := objectDigest(struct {
		M, K, A string
		Active  bool
	}{momentID, kind, actor.Account, active})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	moment, ok := s.state.Moments[momentID]
	if !ok || !s.canViewMomentLocked(actor.Account, moment) {
		return MomentReaction{}, false, ErrUnauthorized
	}
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "moment_reaction" || previous.Digest != digest {
			return MomentReaction{}, false, ErrConflict
		}
		return s.state.MomentReactions[previous.ObjectID], true, nil
	}
	key := momentID + "|" + actor.Account
	now := s.cfg.Now().UTC()
	record := MomentReaction{MomentID: momentID, Account: actor.Account, Kind: kind, Active: active, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.MomentReactions[key] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "moment_reaction", Digest: digest, ObjectID: key}
	if active && moment.Author != actor.Account {
		s.notifyLocked(moment.Author, actor.Account, "reaction_"+kind, momentID, now)
	}
	s.appendAuditLocked("moment_reaction_set", "reaction", key, actor.Account, digest, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) CreateSocialReport(actor Session, idempotencyKey, targetType, targetID, category, detail string, evidence []string) (SocialReport, bool, error) {
	detail = strings.TrimSpace(detail)
	if !identifierPattern.MatchString(idempotencyKey) || !contains([]string{"moment", "comment", "profile", "message"}, targetType) || !contains([]string{"spam", "harassment", "hate", "violence", "sexual", "misinformation", "other"}, category) || len(detail) > 2000 || len(evidence) > 10 {
		return SocialReport{}, false, ErrInvalid
	}
	for _, hash := range evidence {
		if !evidenceHashPattern.MatchString(hash) {
			return SocialReport{}, false, ErrInvalid
		}
	}
	digest := objectDigest(struct{ T, I, C, D, A string }{targetType, targetID, category, detail, actor.Account})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	if targetType == "moment" {
		if moment, ok := s.state.Moments[targetID]; !ok || !s.canViewMomentLocked(actor.Account, moment) {
			return SocialReport{}, false, ErrUnauthorized
		}
	}
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "social_report" || previous.Digest != digest {
			return SocialReport{}, false, ErrConflict
		}
		return s.state.Reports[previous.ObjectID], true, nil
	}
	now := s.cfg.Now().UTC()
	record := SocialReport{ID: "report_" + digest[:24], Reporter: actor.Account, TargetType: targetType, TargetID: targetID, Category: category, Detail: detail, EvidenceHashes: append([]string(nil), evidence...), Status: "submitted", Outcome: "pending", Explanation: "Trust review is pending. No penalty is applied automatically.", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Reports[record.ID] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "social_report", Digest: digest, ObjectID: record.ID}
	s.appendAuditLocked("social_report_submitted", "report", record.ID, actor.Account, digest, now)
	return record, false, s.saveOrRollbackLocked(before)
}

func (s *Service) SocialReport(actor Session, id string) (SocialReport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Reports[id]
	if !ok {
		return SocialReport{}, ErrNotFound
	}
	if record.Reporter != actor.Account {
		return SocialReport{}, ErrUnauthorized
	}
	return record, nil
}

func (s *Service) AppealSocialReport(actor Session, id, correction string) (SocialReport, error) {
	correction = strings.TrimSpace(correction)
	if correction == "" || len(correction) > 2000 {
		return SocialReport{}, ErrInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	record, ok := s.state.Reports[id]
	if !ok {
		return SocialReport{}, ErrNotFound
	}
	if record.Reporter != actor.Account {
		return SocialReport{}, ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	before := cloneState(s.state)
	record.Appeal, record.Status, record.UpdatedAt = correction, "appealed", now
	s.state.Reports[id] = record
	s.appendAuditLocked("social_report_appealed", "report", id, actor.Account, objectDigest(record), now)
	return record, s.saveOrRollbackLocked(before)
}

func (s *Service) canViewMomentLocked(account string, moment Moment) bool {
	if moment.Status != "active" || s.blockedLocked(account, moment.Author) {
		return false
	}
	if moment.Author == account || moment.Visibility == "public" {
		return true
	}
	return moment.Visibility == "contacts" && s.contactLocked(account, moment.Author)
}

func (s *Service) notifyMentionsLocked(actor, text, objectID string, now time.Time) {
	if s.cfg.Square == nil {
		return
	}
	seen := map[string]bool{}
	for _, field := range strings.Fields(text) {
		handle := strings.Trim(strings.TrimPrefix(field, "@"), ".,!?;:()[]{}")
		if !strings.HasPrefix(field, "@") || handle == "" || seen[handle] {
			continue
		}
		seen[handle] = true
		profile, err := s.cfg.Square.ProfileByHandle(handle)
		if err == nil && profile.Account != actor {
			s.notifyLocked(profile.Account, actor, "mention", objectID, now)
		}
	}
}

func activeReactionCount(reactions map[string]MomentReaction, momentID string) int {
	count := 0
	for _, reaction := range reactions {
		if reaction.MomentID == momentID && reaction.Active {
			count++
		}
	}
	return count
}

func activeCommentCount(comments []MomentComment) int {
	count := 0
	for _, comment := range comments {
		if comment.DeletedAt == nil {
			count++
		}
	}
	return count
}
