package video

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPublicationLifecycleAndImmutableVersions(t *testing.T) {
	now := time.Date(2026, 7, 29, 3, 0, 0, 0, time.UTC)
	s, channel := fixture(t, func(cfg *Config) {
		cfg.Now = func() time.Time { return now }
	})
	acceptRole(t, s, channel.Owner, channel.ID, testEditorAccount, CreatorRoleEditor)
	acceptRole(t, s, channel.Owner, channel.ID, testModeratorAccount, CreatorRoleModerator)

	video := uploadWithoutRights(t, s, channel, "Lifecycle clip")
	if video.WorkflowState != WorkflowDraft || video.Version != 1 || len(video.Versions) != 1 || video.Versions[0].Kind != "workflow.create" {
		t.Fatalf("upload did not create the initial immutable version: %+v", video)
	}
	video.Versions[0].Kind = "caller-tampered"
	storedAfterCallerMutation, err := s.Video(channel.Owner, video.ID)
	if err != nil || storedAfterCallerMutation.Versions[0].Kind != "workflow.create" {
		t.Fatalf("returned version history aliased authoritative state: %+v %v", storedAfterCallerMutation, err)
	}
	declaration := declareTestRights(t, s, channel.Owner, video)
	if _, err := s.ReviewRights(testModeratorAccount, declaration.ID, true, "source evidence verified"); err != nil {
		t.Fatal(err)
	}

	inReview, err := s.SubmitForReview(channel.Owner, video.ID)
	if err != nil || inReview.WorkflowState != WorkflowInReview || inReview.SubmittedBy != channel.Owner || inReview.Version != 2 {
		t.Fatalf("publication review submission failed: %+v %v", inReview, err)
	}
	if _, err = s.ReviewPublication(channel.Owner, video.ID, true, "self review"); err == nil || !strings.Contains(err.Error(), "independent") {
		t.Fatalf("submitter self-reviewed publication: %v", err)
	}
	if err = s.Publish(channel.Owner, video.ID, VisibilityPublic); err == nil || !strings.Contains(err.Error(), "active review") {
		t.Fatalf("legacy publish bypassed active review: %v", err)
	}
	approved, err := s.ReviewPublication(testModeratorAccount, video.ID, true, "editorial review passed")
	if err != nil || approved.WorkflowState != WorkflowApproved || approved.ReviewedBy != testModeratorAccount || approved.Version != 3 {
		t.Fatalf("publication review approval failed: %+v %v", approved, err)
	}

	if err = s.UpdateMetadata(testEditorAccount, video.ID, "Lifecycle clip v2", "review-invalidating edit"); err != nil {
		t.Fatal(err)
	}
	edited, err := s.Video(testEditorAccount, video.ID)
	if err != nil || edited.WorkflowState != WorkflowDraft || edited.ReviewedBy != "" || edited.SubmittedBy != "" || edited.Version != 4 {
		t.Fatalf("metadata edit did not invalidate prior review: %+v %v", edited, err)
	}
	if edited.Versions[3].Kind != "metadata.update" || edited.Versions[3].PreviousState != WorkflowApproved || edited.Versions[3].NextState != WorkflowDraft {
		t.Fatalf("metadata edit version did not preserve transition evidence: %+v", edited.Versions[3])
	}

	if _, err = s.SubmitForReview(testEditorAccount, video.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReviewPublication(testModeratorAccount, video.ID, true, "approved after edit"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.SchedulePublication(testAttackerAccount, video.ID, VisibilityPublic, now.Add(time.Hour)); !errors.Is(err, ErrForbidden) {
		t.Fatalf("unauthorized actor scheduled publication: %v", err)
	}
	if _, err = s.SchedulePublication(testEditorAccount, video.ID, VisibilityPrivate, now.Add(time.Hour)); err == nil {
		t.Fatal("private visibility was accepted as a publication schedule")
	}
	scheduledAt := now.Add(time.Hour)
	scheduled, err := s.SchedulePublication(testEditorAccount, video.ID, VisibilityPublic, scheduledAt)
	if err != nil || scheduled.WorkflowState != WorkflowScheduled || scheduled.ScheduledAt == nil || !scheduled.ScheduledAt.Equal(scheduledAt) {
		t.Fatalf("publication scheduling failed: %+v %v", scheduled, err)
	}
	if _, err = s.PublishDue(testEditorAccount, video.ID); err == nil || !strings.Contains(err.Error(), "has not arrived") {
		t.Fatalf("scheduled publication executed early: %v", err)
	}
	if _, err = s.SchedulePublication(testEditorAccount, video.ID, VisibilityPublic, scheduledAt.Add(time.Hour)); err == nil {
		t.Fatal("schedule replay replaced an active schedule")
	}
	if err = s.RevokeTeamMember(channel.Owner, channel.ID, testEditorAccount); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	if _, err = s.PublishDue(testEditorAccount, video.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("revoked editor executed scheduled publication: %v", err)
	}
	published, err := s.PublishDue(channel.Owner, video.ID)
	if err != nil || published.WorkflowState != WorkflowPublished || published.Status != "published" || published.Visibility != VisibilityPublic || published.PublishedAt == nil {
		t.Fatalf("due publication failed: %+v %v", published, err)
	}
	publicVideo, err := s.Video("", video.ID)
	if err != nil || publicVideo.Version != 0 || len(publicVideo.Versions) != 0 || publicVideo.SubmittedBy != "" || publicVideo.ReviewedBy != "" || publicVideo.RightsDeclarationID != "" {
		t.Fatalf("public video leaked creator workflow evidence: %+v %v", publicVideo, err)
	}
	publicSearch, err := s.Search("", "Lifecycle clip v2")
	if err != nil || len(publicSearch) != 1 || publicSearch[0].Version != 0 || len(publicSearch[0].Versions) != 0 {
		t.Fatalf("public search leaked creator workflow history: %+v %v", publicSearch, err)
	}
	if _, err = s.PublishDue(channel.Owner, video.ID); err == nil {
		t.Fatal("scheduled publication replay succeeded")
	}
	unpublished, err := s.Unpublish(channel.Owner, video.ID)
	if err != nil || unpublished.WorkflowState != WorkflowUnpublished || unpublished.Status != "ready" || unpublished.Visibility != VisibilityPrivate {
		t.Fatalf("unpublish failed closed incorrectly: %+v %v", unpublished, err)
	}
	if _, err = s.Unpublish(channel.Owner, video.ID); err == nil {
		t.Fatal("unpublish replay succeeded")
	}

	for index, version := range unpublished.Versions {
		if version.Sequence != uint64(index+1) {
			t.Fatalf("version sequence is not contiguous at %d: %+v", index, version)
		}
		if version.ContentSHA256 != video.SHA256 || version.MetadataSHA256 == "" || version.RecordedAt.IsZero() {
			t.Fatalf("version evidence is incomplete at %d: %+v", index, version)
		}
	}
	if unpublished.Version != uint64(len(unpublished.Versions)) || len(unpublished.Versions) != 9 {
		t.Fatalf("unexpected lifecycle version count: version=%d records=%d %+v", unpublished.Version, len(unpublished.Versions), unpublished.Versions)
	}
}

func TestPublicationReviewRejectRequiresReasonAndCanResubmit(t *testing.T) {
	s, channel := fixture(t, nil)
	acceptRole(t, s, channel.Owner, channel.ID, testEditorAccount, CreatorRoleEditor)
	acceptRole(t, s, channel.Owner, channel.ID, testModeratorAccount, CreatorRoleModerator)
	video := uploadWithoutRights(t, s, channel, "Rejected review")
	if _, err := s.SubmitForReview(testEditorAccount, video.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReviewPublication(testModeratorAccount, video.ID, false, ""); err == nil || !strings.Contains(err.Error(), "reason") {
		t.Fatalf("publication rejection without reason succeeded: %v", err)
	}
	rejected, err := s.ReviewPublication(testModeratorAccount, video.ID, false, "metadata needs correction")
	if err != nil || rejected.WorkflowState != WorkflowRejected || rejected.ReviewReason == "" {
		t.Fatalf("publication rejection failed: %+v %v", rejected, err)
	}
	if _, err = s.SubmitForReview(testEditorAccount, video.ID); err != nil {
		t.Fatalf("rejected content could not be resubmitted: %v", err)
	}
}
