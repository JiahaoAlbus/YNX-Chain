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
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 Moment
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

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
	id := "moment_" + objectDigest(struct{ A, D string }{actor.Account, digest})[:24]
	preparedDigest := objectDigest(struct{ Body, Device string }{digest, actor.DeviceID})
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return Moment{}, false, err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 Moment
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		s.mu.Unlock()
		return Moment{}, false, err
	}
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action == "moment_create" && previous.Digest == digest {
			record, exists := s.state.Moments[previous.ObjectID]
			s.mu.Unlock()
			if !exists || record.Author != actor.Account {
				return Moment{}, false, ErrConflict
			}
			return record, true, nil
		}
		if previous.Action != "moment_create_prepared" || previous.Digest != preparedDigest || previous.ObjectID != id {
			s.mu.Unlock()
			return Moment{}, false, ErrConflict
		}
	}
	for _, mediaID := range mediaIDs {
		media, ok := s.state.Media[mediaID]
		if !ok || media.Owner != actor.Account {
			s.mu.Unlock()
			return Moment{}, false, ErrUnauthorized
		}
	}
	for key, previous := range s.state.Idempotency {
		if key != stateKey && previous.Action == "moment_create_prepared" && previous.ObjectID == id {
			s.mu.Unlock()
			return Moment{}, false, ErrConflict
		}
	}
	if _, exists := s.state.Idempotency[stateKey]; !exists {
		before := cloneState(s.state)
		s.state.Idempotency[stateKey] = idempotencyRecord{Action: "moment_create_prepared", Digest: preparedDigest, ObjectID: id}
		if err := s.saveOrRollbackProductActorLocked(before, actor, "social.feed"); err != nil {
			s.mu.Unlock()
			return Moment{}, false, err
		}
	}
	s.mu.Unlock()
	now := s.cfg.Now().UTC()
	record := Moment{ID: id, Author: actor.Account, Text: text, MediaIDs: append([]string(nil), mediaIDs...), Visibility: visibility, Status: "active", CreatedAt: now, UpdatedAt: now}
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return Moment{}, false, err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 Moment
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return Moment{}, false, err
	}
	for _, mediaID := range mediaIDs {
		media, ok := s.state.Media[mediaID]
		if !ok || media.Owner != actor.Account {
			return Moment{}, false, ErrUnauthorized
		}
	}
	previous, exists := s.state.Idempotency[stateKey]
	if exists && previous.Action == "moment_create" && previous.Digest == digest {
		existing, ok := s.state.Moments[previous.ObjectID]
		if !ok || existing.Author != actor.Account {
			return Moment{}, false, ErrConflict
		}
		return existing, true, nil
	}
	if !exists || previous.Action != "moment_create_prepared" || previous.Digest != preparedDigest || previous.ObjectID != id {
		return Moment{}, false, ErrConflict
	}
	// Square is the original in-process store, not a remote await. Preserve the
	// prepared intent on any uncertain effect/persistence/cancellation outcome.
	if visibility == "public" && s.cfg.Square != nil && text != "" {
		result, err := s.cfg.Square.CreatePost(square.Device{ID: actor.DeviceID, Account: actor.Account}, square.CreatePostRequest{IdempotencyKey: idempotencyKey, Content: text, Tags: []string{"ynx-social-moment"}})
		if err != nil {
			return Moment{}, false, socialSquareError(err)
		}
		record.SquarePostID = result.Record.ID
	}
	before := cloneState(s.state)
	s.state.Moments[id] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "moment_create", Digest: digest, ObjectID: id}
	s.appendAuditLocked("moment_created", "moment", id, actor.Account, digest, now)
	s.notifyMentionsLocked(actor.Account, text, id, now)
	return record, false, s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}

func (s *Service) VisibleMoments(actor Session) []Moment {
	items, _ := s.CurrentVisibleMoments(actor)
	return items
}

// Typed product reader; callers must surface authority failures, not call an
// unavailable private feed a successful empty list.
func (s *Service) CurrentVisibleMoments(actor Session) ([]Moment, error) {
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return nil, err
	}
	out := []Moment{}
	for _, moment := range s.state.Moments {
		if s.canViewMomentLocked(actor.Account, moment) {
			out = append(out, moment)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *Service) Moment(actor Session, id string) (Moment, error) {
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return Moment{}, err
	}
	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return Moment{}, err
	}
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
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		return writeUnavailable
	}

	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		return writeUnavailable
	}

	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return err
	}
	moment, ok := s.state.Moments[id]
	if !ok {
		return ErrNotFound
	}
	if moment.Status == "deleted" {
		// A lost response must not strand the original author's exact delete
		// after restart. Authority was revalidated above; do not mutate the
		// tombstone, duplicate its audit, or disclose it to another account.
		if moment.Author == actor.Account {
			return nil
		}
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
	return s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}

func (s *Service) CreateMomentComment(actor Session, momentID, idempotencyKey, text string) (MomentComment, bool, error) {
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 MomentComment
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	text = strings.TrimSpace(text)
	if !identifierPattern.MatchString(idempotencyKey) || text == "" || len(text) > 1000 {
		return MomentComment{}, false, ErrInvalid
	}
	digest := objectDigest(struct{ M, T, A string }{momentID, text, actor.Account})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return MomentComment{}, false, err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 MomentComment
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return MomentComment{}, false, err
	}
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
	return record, false, s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}

func (s *Service) MomentComments(actor Session, momentID string) ([]MomentComment, error) {
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return nil, err
	}
	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return nil, err
	}
	moment, ok := s.state.Moments[momentID]
	if !ok || moment.Status == "deleted" {
		return nil, ErrNotFound
	}
	if !s.canViewMomentLocked(actor.Account, moment) {
		return nil, ErrUnauthorized
	}
	out := []MomentComment{}
	for _, comment := range s.state.MomentComments[momentID] {
		if comment.DeletedAt == nil {
			out = append(out, comment)
		}
	}
	return out, nil
}

func (s *Service) SetMomentReaction(actor Session, momentID, idempotencyKey, kind string, active bool) (MomentReaction, bool, error) {
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 MomentReaction
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	if !identifierPattern.MatchString(idempotencyKey) || !contains([]string{"like", "love", "insight", "support"}, kind) {
		return MomentReaction{}, false, ErrInvalid
	}
	digest := objectDigest(struct {
		M, K, A string
		Active  bool
	}{momentID, kind, actor.Account, active})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return MomentReaction{}, false, err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 MomentReaction
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return MomentReaction{}, false, err
	}
	moment, ok := s.state.Moments[momentID]
	if !ok || !s.canViewMomentLocked(actor.Account, moment) {
		return MomentReaction{}, false, ErrUnauthorized
	}
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		if previous.Action != "moment_reaction" || previous.Digest != digest {
			return MomentReaction{}, false, ErrConflict
		}
		original := previous.ReactionResult
		if original == nil || original.MomentID != momentID || original.Account != actor.Account || original.Kind != kind || original.Active != active || previous.ObjectID != momentID+"|"+actor.Account {
			// Retain legacy/invalid receipts. The latest display state cannot
			// establish the original result of an earlier operation.
			return MomentReaction{}, false, ErrConflict
		}
		return *original, true, nil
	}
	key := momentID + "|" + actor.Account
	now := s.cfg.Now().UTC()
	record := MomentReaction{MomentID: momentID, Account: actor.Account, Kind: kind, Active: active, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.MomentReactions[key] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "moment_reaction", Digest: digest, ObjectID: key, ReactionResult: &record}
	if active && moment.Author != actor.Account {
		s.notifyLocked(moment.Author, actor.Account, "reaction_"+kind, momentID, now)
	}
	s.appendAuditLocked("moment_reaction_set", "reaction", key, actor.Account, digest, now)
	return record, false, s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}

func (s *Service) CreateSocialReport(actor Session, idempotencyKey, targetType, targetID, category, detail string, evidence []string) (SocialReport, bool, error) {
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 SocialReport
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	detail = strings.TrimSpace(detail)
	if !identifierPattern.MatchString(idempotencyKey) || !contains([]string{"moment", "comment", "profile", "message"}, targetType) || !contains([]string{"spam", "harassment", "hate", "violence", "sexual", "misinformation", "other"}, category) || len(detail) > 2000 || len(evidence) > 10 {
		return SocialReport{}, false, ErrInvalid
	}
	evidence = append([]string(nil), evidence...)
	for _, hash := range evidence {
		if !evidenceHashPattern.MatchString(hash) {
			return SocialReport{}, false, ErrInvalid
		}
	}
	digest := reportIntentDigest(actor.Account, idempotencyKey, targetType, targetID, category, detail, evidence)
	legacyDigest := objectDigest(struct{ T, I, C, D, A string }{targetType, targetID, category, detail, actor.Account})
	stateKey := idempotencyStateKey(actor.Account, idempotencyKey)
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return SocialReport{}, false, err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 SocialReport
		var unavailableResult1 bool
		return unavailableResult0, unavailableResult1, writeUnavailable
	}

	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return SocialReport{}, false, err
	}
	if targetType == "moment" {
		if moment, ok := s.state.Moments[targetID]; !ok || !s.canViewMomentLocked(actor.Account, moment) {
			return SocialReport{}, false, ErrUnauthorized
		}
	}
	if previous, ok := s.state.Idempotency[stateKey]; ok {
		validDigest := previous.Action == "social_report_v2" && previous.Digest == digest
		validLegacy := previous.Action == "social_report" && previous.Digest == legacyDigest
		record, exists := s.state.Reports[previous.ObjectID]
		if (!validDigest && !validLegacy) || !exists || !originalReportMatches(record, previous.ObjectID, actor.Account, targetType, targetID, category, detail, evidence) {
			return SocialReport{}, false, ErrConflict
		}
		return copyReportResult(record), true, nil
	}
	now := s.cfg.Now().UTC()
	record := SocialReport{ID: "report_" + digest[:24], Reporter: actor.Account, TargetType: targetType, TargetID: targetID, Category: category, Detail: detail, EvidenceHashes: append([]string(nil), evidence...), Status: "submitted", Outcome: "pending", Explanation: "Trust review is pending. No penalty is applied automatically.", CreatedAt: now, UpdatedAt: now}
	before := cloneState(s.state)
	s.state.Reports[record.ID] = record
	s.state.Idempotency[stateKey] = idempotencyRecord{Action: "social_report_v2", Digest: digest, ObjectID: record.ID}
	s.appendAuditLocked("social_report_submitted", "report", record.ID, actor.Account, digest, now)
	return copyReportResult(record), false, s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
}

func (s *Service) SocialReport(actor Session, id string) (SocialReport, error) {
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return SocialReport{}, err
	}
	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return SocialReport{}, err
	}
	record, ok := s.state.Reports[id]
	if !ok {
		return SocialReport{}, ErrNotFound
	}
	if record.Reporter != actor.Account {
		return SocialReport{}, ErrUnauthorized
	}
	return copyReportResult(record), nil
}

func (s *Service) AppealSocialReport(actor Session, id, correction string) (SocialReport, error) {
	if writeUnavailable := s.writeAvailability(); writeUnavailable != nil {
		var unavailableResult0 SocialReport
		return unavailableResult0, writeUnavailable
	}

	correction = strings.TrimSpace(correction)
	if correction == "" || len(correction) > 2000 {
		return SocialReport{}, ErrInvalid
	}
	if err := s.lockAfterProductRevalidation(actor, "social.feed"); err != nil {
		return SocialReport{}, err
	}
	if writeUnavailable := s.stateWriteError; writeUnavailable != nil {
		s.mu.Unlock()
		var unavailableResult0 SocialReport
		return unavailableResult0, writeUnavailable
	}

	defer s.mu.Unlock()
	if err := s.requireCurrentProductActorLocked(actor, "social.feed"); err != nil {
		return SocialReport{}, err
	}
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
	return copyReportResult(record), s.saveOrRollbackProductActorLocked(before, actor, "social.feed")
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
