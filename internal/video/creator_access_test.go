package video

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func acceptRole(t *testing.T, s *Service, owner, channelID, account string, role CreatorRole) *TeamMember {
	t.Helper()
	invite, err := s.InviteTeamMember(owner, channelID, account, role, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	member, err := s.AcceptTeamInvite(account, invite.ID)
	if err != nil {
		t.Fatal(err)
	}
	return member
}

func TestCreatorTeamRBACAndImmediateRevocation(t *testing.T) {
	s, channel := fixture(t, nil)
	if _, err := s.InviteTeamMember(channel.Owner, channel.ID, "ynx1not-canonical", CreatorRoleEditor, time.Time{}); err == nil || !strings.Contains(err.Error(), "canonical YNX Wallet") {
		t.Fatalf("non-canonical team account accepted: %v", err)
	}
	if _, err := s.InviteTeamMember(channel.Owner, channel.ID, testEditorAccount, CreatorRoleOwner, time.Time{}); err == nil {
		t.Fatal("owner role must not be delegated")
	}
	invite, err := s.InviteTeamMember(channel.Owner, channel.ID, testEditorAccount, CreatorRoleEditor, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	invite.Role = CreatorRoleViewer
	if _, err = s.AcceptTeamInvite(testAttackerAccount, invite.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("wrong invite account accepted: %v", err)
	}
	member, err := s.AcceptTeamInvite(testEditorAccount, invite.ID)
	if err != nil || member.Role != CreatorRoleEditor || member.State != "active" {
		t.Fatalf("editor invite failed: %+v %v", member, err)
	}
	if _, err = s.AcceptTeamInvite(testEditorAccount, invite.ID); err == nil {
		t.Fatal("invite replay accepted")
	}

	video, err := s.Upload(context.Background(), testEditorAccount, channel.ID, UploadInput{
		Title:            "Team upload",
		Filename:         "team.mp4",
		ContentType:      "video/mp4",
		Size:             int64(len(testMP4)),
		OwnedDeclaration: true,
		Reader:           bytes.NewReader(testMP4),
	})
	if err != nil || video.Owner != channel.Owner {
		t.Fatalf("editor upload did not remain channel-owned: %+v %v", video, err)
	}
	declaration, err := s.DeclareRights(testEditorAccount, video.ID, RightsDeclarationInput{
		Basis:             "owned",
		Territories:       []string{"worldwide"},
		EvidenceSHA256:    strings.Repeat("b", 64),
		SourceSHA256:      video.SHA256,
		ContributorSplits: []ContributorSplit{{Account: channel.Owner, BasisPoints: 10000}},
	})
	if err != nil || declaration.DeclaredBy != testEditorAccount {
		t.Fatalf("editor rights declaration failed: %+v %v", declaration, err)
	}
	if err = s.Publish(testEditorAccount, video.ID, VisibilityPublic); err != nil {
		t.Fatalf("editor publish failed: %v", err)
	}
	if err = s.RecordWatch("ynx1viewer", video.ID, 9, true); err != nil {
		t.Fatal(err)
	}
	if err = s.Subscribe("ynx1viewer", channel.ID); err != nil {
		t.Fatal(err)
	}

	editorAnalytics, err := s.Analytics(testEditorAccount)
	if err != nil || editorAnalytics.Views != 0 || editorAnalytics.WatchSeconds != 0 || editorAnalytics.Subscribers != 0 || editorAnalytics.RevenueYNXT != 0 {
		t.Fatalf("editor received analyst or finance data: %+v %v", editorAnalytics, err)
	}
	acceptRole(t, s, channel.Owner, channel.ID, testAnalystAccount, CreatorRoleAnalyst)
	analytics, err := s.Analytics(testAnalystAccount)
	if err != nil || analytics.Views != 1 || analytics.WatchSeconds != 9 || analytics.Subscribers != 1 || analytics.RevenueYNXT != 0 {
		t.Fatalf("analyst received wrong evidence view: %+v %v", analytics, err)
	}
	if err = s.UpdateMetadata(testAnalystAccount, video.ID, "forbidden", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("analyst mutated content: %v", err)
	}

	before, err := s.Team(channel.Owner, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SetTeamRole(channel.Owner, channel.ID, testEditorAccount, CreatorRoleViewer); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateMetadata(testEditorAccount, video.ID, "forbidden", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("viewer retained editor authority: %v", err)
	}
	if _, err = s.SetTeamRole(channel.Owner, channel.ID, testEditorAccount, CreatorRoleEditor); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateMetadata(testEditorAccount, video.ID, "Editor approved title", "reviewed"); err != nil {
		t.Fatal(err)
	}
	if err = s.RevokeTeamMember(channel.Owner, channel.ID, testEditorAccount); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateMetadata(testEditorAccount, video.ID, "revoked", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("revoked member retained authority: %v", err)
	}
	after, err := s.Team(channel.Owner, channel.ID)
	if err != nil || after.AuthVersion <= before.AuthVersion {
		t.Fatalf("session invalidation version did not advance: before=%d after=%d err=%v", before.AuthVersion, after.AuthVersion, err)
	}
	for _, item := range after.Members {
		if item.Account == testEditorAccount && (item.State != "revoked" || item.RevokedAt == nil) {
			t.Fatalf("revocation was not persisted: %+v", item)
		}
	}
}

func TestCreatorRightsFailClosedAndCommercialVerification(t *testing.T) {
	s, channel := fixture(t, nil)
	video := uploadWithoutRights(t, s, channel, "Rights gate")
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err == nil || !strings.Contains(err.Error(), "rights declaration") {
		t.Fatalf("public publication bypassed rights gate: %v", err)
	}
	if _, err := s.DeclareRights(channel.Owner, video.ID, RightsDeclarationInput{
		Basis:             "owned",
		Territories:       []string{"worldwide"},
		EvidenceSHA256:    strings.Repeat("c", 64),
		SourceSHA256:      strings.Repeat("d", 64),
		ContributorSplits: []ContributorSplit{{Account: channel.Owner, BasisPoints: 10000}},
	}); err == nil || !strings.Contains(err.Error(), "source hash") {
		t.Fatalf("mismatched source lineage accepted: %v", err)
	}
	if _, err := s.DeclareRights(channel.Owner, video.ID, RightsDeclarationInput{
		Basis:             "owned",
		Territories:       []string{"worldwide"},
		EvidenceSHA256:    strings.Repeat("c", 64),
		SourceSHA256:      video.SHA256,
		ContributorSplits: []ContributorSplit{{Account: "ynx1not-canonical", BasisPoints: 10000}},
	}); err == nil || !strings.Contains(err.Error(), "contributor split") {
		t.Fatalf("non-canonical contributor account accepted: %v", err)
	}
	if _, err := s.DeclareRights(channel.Owner, video.ID, RightsDeclarationInput{
		Basis:             "licensed",
		Territories:       []string{"worldwide"},
		EvidenceSHA256:    strings.Repeat("c", 64),
		SourceSHA256:      video.SHA256,
		ContributorSplits: []ContributorSplit{{Account: channel.Owner, BasisPoints: 9000}},
	}); err == nil {
		t.Fatal("incomplete license or contributor split accepted")
	}
	declaration := declareTestRights(t, s, channel.Owner, video)
	if err := s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	monetization, err := s.RequestMonetization(channel.Owner, video.ID)
	if err != nil || monetization.State != "ineligible" || !strings.Contains(monetization.Reason, "verified commercial rights") {
		t.Fatalf("unverified rights reached commercial review: %+v %v", monetization, err)
	}
	if _, err = s.ReviewRights("moderator", declaration.ID, true, "source and license evidence verified"); err != nil {
		t.Fatal(err)
	}
	if err = s.RecordWatch("viewer", video.ID, 3, true); err != nil {
		t.Fatal(err)
	}
	if err = s.Subscribe("viewer", channel.ID); err != nil {
		t.Fatal(err)
	}
	monetization, err = s.RequestMonetization(channel.Owner, video.ID)
	if err != nil || monetization.State != "pending_review" {
		t.Fatalf("verified rights did not reach human review: %+v %v", monetization, err)
	}

	replacement, err := s.DeclareRights(channel.Owner, video.ID, RightsDeclarationInput{
		Basis:             "licensed",
		LicenseReference:  "license:ynx:test:2026-07",
		Territories:       []string{"pt", "hk"},
		EvidenceSHA256:    strings.Repeat("e", 64),
		SourceSHA256:      video.SHA256,
		ContributorSplits: []ContributorSplit{{Account: channel.Owner, BasisPoints: 7000}, {Account: testContributorAccount, BasisPoints: 3000}},
	})
	if err != nil || replacement.State != "declared" {
		t.Fatalf("replacement declaration failed: %+v %v", replacement, err)
	}
	var previousState string
	_ = s.store.read(func(st State) error {
		if previous := st.Rights[declaration.ID]; previous != nil {
			previousState = previous.State
		}
		return nil
	})
	if previousState != "superseded" {
		t.Fatalf("previous rights declaration remained active: %s", previousState)
	}
	monetization, err = s.RequestMonetization(channel.Owner, video.ID)
	if err != nil || monetization.State != "ineligible" {
		t.Fatalf("superseded verification remained commercially active: %+v %v", monetization, err)
	}
}

func TestRightsExpiryAndRejectedReviewRemoveAudienceAccess(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	s, channel := fixture(t, func(cfg *Config) {
		cfg.Now = func() time.Time { return now }
	})
	video := uploadWithoutRights(t, s, channel, "Expiring rights")
	endsAt := now.Add(time.Hour)
	declaration, err := s.DeclareRights(channel.Owner, video.ID, RightsDeclarationInput{
		Basis:             "owned",
		Territories:       []string{"worldwide"},
		EndsAt:            &endsAt,
		EvidenceSHA256:    strings.Repeat("1", 64),
		SourceSHA256:      video.SHA256,
		ContributorSplits: []ContributorSplit{{Account: channel.Owner, BasisPoints: 10000}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReviewRights(channel.Owner, declaration.ID, true, "self review"); err == nil || !strings.Contains(err.Error(), "independent") {
		t.Fatalf("creator self-verified rights: %v", err)
	}
	if err = s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if found, searchErr := s.Search("", ""); searchErr != nil || len(found) != 1 {
		t.Fatalf("active rights were not discoverable: %+v %v", found, searchErr)
	}

	now = now.Add(2 * time.Hour)
	if found, searchErr := s.Search("", ""); searchErr != nil || len(found) != 0 {
		t.Fatalf("expired rights remained discoverable: %+v %v", found, searchErr)
	}
	if _, mediaErr := s.MediaPath("", video.ObjectKey); !errors.Is(mediaErr, ErrForbidden) {
		t.Fatalf("expired rights media remained public: %v", mediaErr)
	}
	if watchErr := s.RecordWatch("viewer", video.ID, 1, false); !errors.Is(watchErr, ErrNotFound) {
		t.Fatalf("expired rights accepted audience event: %v", watchErr)
	}
	if _, ownerErr := s.Video(channel.Owner, video.ID); ownerErr != nil {
		t.Fatalf("rights expiry hid recovery access from owner: %v", ownerErr)
	}

	replacement := declareTestRights(t, s, channel.Owner, video)
	if err = s.Publish(channel.Owner, video.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if _, err = s.ReviewRights(testModeratorAccount, replacement.ID, false, "evidence rejected"); err != nil {
		t.Fatal(err)
	}
	stored, err := s.Video(channel.Owner, video.ID)
	if err != nil || stored.Visibility != VisibilityPrivate || stored.Status != "ready" {
		t.Fatalf("rejected rights did not fail closed: %+v %v", stored, err)
	}
	if found, searchErr := s.Search("", ""); searchErr != nil || len(found) != 0 {
		t.Fatalf("rejected rights remained discoverable: %+v %v", found, searchErr)
	}
}

func TestExpiredTeamInvitePersistsTerminalState(t *testing.T) {
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	s, channel := fixture(t, func(cfg *Config) {
		cfg.Now = func() time.Time { return now }
	})
	expiresAt := now.Add(time.Hour)
	invite, err := s.InviteTeamMember(channel.Owner, channel.ID, testLateAccount, CreatorRoleViewer, expiresAt)
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	if _, err = s.AcceptTeamInvite(testLateAccount, invite.ID); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("expired team invite accepted: %v", err)
	}
	team, err := s.Team(channel.Owner, channel.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range team.Invites {
		if item.ID == invite.ID {
			if item.State != "expired" {
				t.Fatalf("expired invite remained pending: %+v", item)
			}
			return
		}
	}
	t.Fatal("expired invite disappeared from owner audit view")
}
