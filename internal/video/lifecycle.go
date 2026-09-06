package video

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

const maxScheduleHorizon = 365 * 24 * time.Hour

func normalizeWorkflowState(video *Video) {
	if video == nil {
		return
	}
	if video.WorkflowState == "" {
		if video.Status == "published" {
			video.WorkflowState = WorkflowPublished
		} else {
			video.WorkflowState = WorkflowDraft
		}
	}
	if video.Version == 0 {
		recordedAt := video.UpdatedAt.UTC()
		if recordedAt.IsZero() {
			recordedAt = video.CreatedAt.UTC()
		}
		if recordedAt.IsZero() {
			recordedAt = time.Unix(0, 0).UTC()
		}
		recordVideoVersion(video, "system", "workflow.migration", "", video.WorkflowState, recordedAt)
	}
}

func metadataSHA256(video *Video) string {
	payload := fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%s", video.Title, video.Description, video.Visibility, video.WorkflowState, video.SHA256)
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func cloneVideo(video *Video) *Video {
	if video == nil {
		return nil
	}
	copy := *video
	copy.Variants = append([]MediaVariant(nil), video.Variants...)
	copy.Captions = append([]CaptionTrack(nil), video.Captions...)
	copy.Versions = append([]VideoVersion(nil), video.Versions...)
	copy.ScheduledAt = cloneTime(video.ScheduledAt)
	copy.SubmittedAt = cloneTime(video.SubmittedAt)
	copy.ReviewedAt = cloneTime(video.ReviewedAt)
	copy.PublishedAt = cloneTime(video.PublishedAt)
	if video.Takedown != nil {
		takedown := *video.Takedown
		copy.Takedown = &takedown
	}
	return &copy
}

func audienceVideo(video *Video) *Video {
	copy := cloneVideo(video)
	if copy == nil {
		return nil
	}
	copy.Version = 0
	copy.Versions = nil
	copy.ScheduledAt = nil
	copy.ScheduledVisibility = ""
	copy.SubmittedAt = nil
	copy.SubmittedBy = ""
	copy.ReviewedAt = nil
	copy.ReviewedBy = ""
	copy.ReviewReason = ""
	copy.RightsDeclarationID = ""
	return copy
}

func recordVideoVersion(video *Video, actor, kind string, previous, next WorkflowState, now time.Time) {
	video.Version++
	video.Versions = append(video.Versions, VideoVersion{
		Sequence:       video.Version,
		Actor:          actor,
		Kind:           kind,
		PreviousState:  previous,
		NextState:      next,
		Title:          video.Title,
		Description:    video.Description,
		Visibility:     video.Visibility,
		ContentSHA256:  video.SHA256,
		MetadataSHA256: metadataSHA256(video),
		RecordedAt:     now.UTC(),
	})
}

func resetReview(video *Video) {
	video.SubmittedBy = ""
	video.SubmittedAt = nil
	video.ReviewedBy = ""
	video.ReviewedAt = nil
	video.ReviewReason = ""
	video.ScheduledAt = nil
	video.ScheduledVisibility = ""
}

func (s *Service) SubmitForReview(actor, videoID string) (*Video, error) {
	var out *Video
	err := s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		normalizeWorkflowState(video)
		if video.Status != "ready" {
			return errors.New("only ready videos can enter publication review")
		}
		if activeTakedown(video) {
			return errors.New("video is taken down")
		}
		switch video.WorkflowState {
		case WorkflowDraft, WorkflowRejected, WorkflowUnpublished:
		default:
			return errors.New("video workflow cannot enter review from current state")
		}
		now := s.cfg.Now().UTC()
		previous := video.WorkflowState
		video.WorkflowState = WorkflowInReview
		video.SubmittedBy = actor
		video.SubmittedAt = &now
		video.ReviewedBy = ""
		video.ReviewedAt = nil
		video.ReviewReason = ""
		video.ScheduledAt = nil
		video.ScheduledVisibility = ""
		video.UpdatedAt = now
		recordVideoVersion(video, actor, "workflow.submit_review", previous, video.WorkflowState, now)
		s.audit(st, actor, "video.workflow.submit_review", "video", videoID, "")
		out = cloneVideo(video)
		return nil
	})
	return out, err
}

func (s *Service) ReviewPublication(reviewer, videoID string, approved bool, reason string) (*Video, error) {
	reason = strings.TrimSpace(reason)
	if len(reason) > 2000 {
		return nil, errors.New("review reason too long")
	}
	if !approved && reason == "" {
		return nil, errors.New("rejection reason is required")
	}
	var out *Video
	err := s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, reviewer, CreatorRoleModerator) {
			return ErrForbidden
		}
		normalizeWorkflowState(video)
		if video.WorkflowState != WorkflowInReview {
			return errors.New("video is not awaiting publication review")
		}
		if reviewer == video.SubmittedBy {
			return errors.New("publication reviewer must be independent from submitter")
		}
		if activeTakedown(video) {
			return errors.New("video is taken down")
		}
		now := s.cfg.Now().UTC()
		previous := video.WorkflowState
		if approved {
			video.WorkflowState = WorkflowApproved
		} else {
			video.WorkflowState = WorkflowRejected
		}
		video.ReviewedBy = reviewer
		video.ReviewedAt = &now
		video.ReviewReason = reason
		video.UpdatedAt = now
		kind := "workflow.review.approve"
		if !approved {
			kind = "workflow.review.reject"
		}
		recordVideoVersion(video, reviewer, kind, previous, video.WorkflowState, now)
		s.audit(st, reviewer, "video."+kind, "video", videoID, reason)
		out = cloneVideo(video)
		return nil
	})
	return out, err
}

func (s *Service) SchedulePublication(actor, videoID string, visibility Visibility, scheduledAt time.Time) (*Video, error) {
	if visibility != VisibilityPublic && visibility != VisibilityUnlisted {
		return nil, errors.New("scheduled publication visibility must be public or unlisted")
	}
	scheduledAt = scheduledAt.UTC()
	var out *Video
	err := s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		normalizeWorkflowState(video)
		if video.WorkflowState != WorkflowApproved || video.Status != "ready" {
			return errors.New("video must be approved and ready before scheduling")
		}
		if activeTakedown(video) {
			return errors.New("video is taken down")
		}
		now := s.cfg.Now().UTC()
		if !scheduledAt.After(now) || scheduledAt.After(now.Add(maxScheduleHorizon)) {
			return errors.New("publication schedule must be in the future and within 365 days")
		}
		if err := rightsActive(*st, video, scheduledAt, false); err != nil {
			return err
		}
		previous := video.WorkflowState
		video.WorkflowState = WorkflowScheduled
		video.ScheduledAt = &scheduledAt
		video.ScheduledVisibility = visibility
		video.UpdatedAt = now
		recordVideoVersion(video, actor, "workflow.schedule", previous, video.WorkflowState, now)
		s.audit(st, actor, "video.workflow.schedule", "video", videoID, scheduledAt.Format(time.RFC3339)+":"+string(visibility))
		out = cloneVideo(video)
		return nil
	})
	return out, err
}

func (s *Service) PublishDue(actor, videoID string) (*Video, error) {
	var out *Video
	err := s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		normalizeWorkflowState(video)
		if video.WorkflowState != WorkflowScheduled || video.ScheduledAt == nil || video.Status != "ready" {
			return errors.New("video is not scheduled for publication")
		}
		now := s.cfg.Now().UTC()
		if now.Before(video.ScheduledAt.UTC()) {
			return errors.New("scheduled publication time has not arrived")
		}
		if activeTakedown(video) {
			return errors.New("video is taken down")
		}
		if err := rightsActive(*st, video, now, false); err != nil {
			return err
		}
		previous := video.WorkflowState
		video.Visibility = video.ScheduledVisibility
		video.Status = "published"
		video.WorkflowState = WorkflowPublished
		video.ScheduledAt = nil
		video.ScheduledVisibility = ""
		video.UpdatedAt = now
		if video.PublishedAt == nil {
			video.PublishedAt = &now
		}
		recordVideoVersion(video, actor, "workflow.publish_due", previous, video.WorkflowState, now)
		s.audit(st, actor, "video.workflow.publish_due", "video", videoID, string(video.Visibility))
		out = cloneVideo(video)
		return nil
	})
	return out, err
}

func (s *Service) Unpublish(actor, videoID string) (*Video, error) {
	var out *Video
	err := s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		normalizeWorkflowState(video)
		if video.Status != "published" || video.WorkflowState != WorkflowPublished {
			return errors.New("video is not published")
		}
		now := s.cfg.Now().UTC()
		previous := video.WorkflowState
		video.Status = "ready"
		video.Visibility = VisibilityPrivate
		video.WorkflowState = WorkflowUnpublished
		video.UpdatedAt = now
		video.ScheduledAt = nil
		video.ScheduledVisibility = ""
		recordVideoVersion(video, actor, "workflow.unpublish", previous, video.WorkflowState, now)
		s.audit(st, actor, "video.workflow.unpublish", "video", videoID, "")
		out = cloneVideo(video)
		return nil
	})
	return out, err
}
