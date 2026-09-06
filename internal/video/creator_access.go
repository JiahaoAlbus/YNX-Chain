package video

import (
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/accountaddress"
)

type RightsDeclarationInput struct {
	Basis             string             `json:"basis"`
	LicenseReference  string             `json:"license_reference"`
	Territories       []string           `json:"territories"`
	StartsAt          *time.Time         `json:"starts_at"`
	EndsAt            *time.Time         `json:"ends_at"`
	Exclusive         bool               `json:"exclusive"`
	ContributorSplits []ContributorSplit `json:"contributor_splits"`
	EvidenceSHA256    string             `json:"evidence_sha256"`
	SourceSHA256      string             `json:"source_sha256"`
}

func canonicalCreatorAccount(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if _, err := accountaddress.Decode(value); err != nil {
		return "", errors.New("canonical YNX Wallet account required")
	}
	return value, nil
}

func validCreatorRole(role CreatorRole) bool {
	switch role {
	case CreatorRoleEditor, CreatorRoleUploader, CreatorRoleAnalyst, CreatorRoleFinance, CreatorRoleModerator, CreatorRoleViewer:
		return true
	default:
		return false
	}
}

func teamMemberKey(channelID, account string) string { return channelID + "\x00" + account }

func creatorRoleFor(st State, channelID, actor string) (CreatorRole, bool) {
	channel := st.Channels[channelID]
	if channel == nil || actor == "" {
		return "", false
	}
	if channel.Owner == actor {
		return CreatorRoleOwner, true
	}
	member := st.TeamMembers[teamMemberKey(channelID, actor)]
	if member == nil || member.State != "active" || member.RevokedAt != nil {
		return "", false
	}
	return member.Role, true
}

func roleAllowed(role CreatorRole, allowed ...CreatorRole) bool {
	if role == CreatorRoleOwner {
		return true
	}
	if len(allowed) == 0 {
		return role != ""
	}
	for _, candidate := range allowed {
		if role == candidate {
			return true
		}
	}
	return false
}

func channelAuthorized(st State, channelID, actor string, allowed ...CreatorRole) bool {
	role, ok := creatorRoleFor(st, channelID, actor)
	return ok && roleAllowed(role, allowed...)
}

func videoAuthorized(st State, videoID, actor string, allowed ...CreatorRole) bool {
	video := st.Videos[videoID]
	return video != nil && channelAuthorized(st, video.ChannelID, actor, allowed...)
}

func actorChannels(st State, actor string) map[string]CreatorRole {
	out := map[string]CreatorRole{}
	for channelID := range st.Channels {
		if role, ok := creatorRoleFor(st, channelID, actor); ok {
			out[channelID] = role
		}
	}
	return out
}

func bumpChannelAuthVersion(channel *Channel) {
	if channel.AuthVersion == 0 {
		channel.AuthVersion = 1
	}
	channel.AuthVersion++
}

func (s *Service) InviteTeamMember(actor, channelID, account string, role CreatorRole, expiresAt time.Time) (*TeamInvite, error) {
	account, err := canonicalCreatorAccount(account)
	if err != nil {
		return nil, err
	}
	if !validCreatorRole(role) {
		return nil, errors.New("invalid creator role")
	}
	now := s.cfg.Now().UTC()
	if expiresAt.IsZero() {
		expiresAt = now.Add(7 * 24 * time.Hour)
	}
	expiresAt = expiresAt.UTC()
	if !expiresAt.After(now) || expiresAt.After(now.Add(30*24*time.Hour)) {
		return nil, errors.New("team invite expiry must be within 30 days")
	}
	var invite *TeamInvite
	err = s.store.update(func(st *State) error {
		channel := st.Channels[channelID]
		if channel == nil {
			return ErrNotFound
		}
		if channel.Owner != actor {
			return ErrForbidden
		}
		if channel.Owner == account {
			return errors.New("channel owner is already a team member")
		}
		if member := st.TeamMembers[teamMemberKey(channelID, account)]; member != nil && member.State == "active" {
			return errors.New("account is already an active team member")
		}
		for _, existing := range st.TeamInvites {
			if existing.ChannelID == channelID && existing.Account == account && existing.State == "pending" {
				existing.State = "revoked"
				revokedAt := now
				existing.RevokedAt = &revokedAt
			}
		}
		invite = &TeamInvite{ID: id("invite"), ChannelID: channelID, Account: account, InvitedBy: actor, State: "pending", Role: role, CreatedAt: now, ExpiresAt: expiresAt}
		st.TeamInvites[invite.ID] = invite
		s.audit(st, actor, "creator.team.invite", "channel", channelID, account+":"+string(role))
		return nil
	})
	if err != nil || invite == nil {
		return nil, err
	}
	copy := *invite
	return &copy, nil
}

func (s *Service) AcceptTeamInvite(actor, inviteID string) (*TeamMember, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	now := s.cfg.Now().UTC()
	var member *TeamMember
	expired := false
	err := s.store.update(func(st *State) error {
		invite := st.TeamInvites[inviteID]
		if invite == nil {
			return ErrNotFound
		}
		if invite.Account != actor {
			return ErrForbidden
		}
		if invite.State != "pending" || invite.RevokedAt != nil {
			return errors.New("team invite is not active")
		}
		if !now.Before(invite.ExpiresAt) {
			invite.State = "expired"
			expired = true
			s.audit(st, actor, "creator.team.expire", "channel", invite.ChannelID, invite.ID)
			return nil
		}
		channel := st.Channels[invite.ChannelID]
		if channel == nil {
			return ErrNotFound
		}
		acceptedAt := now
		invite.State = "accepted"
		invite.AcceptedAt = &acceptedAt
		member = &TeamMember{ChannelID: invite.ChannelID, Account: actor, GrantedBy: invite.InvitedBy, State: "active", Role: invite.Role, CreatedAt: now, UpdatedAt: now}
		st.TeamMembers[teamMemberKey(invite.ChannelID, actor)] = member
		bumpChannelAuthVersion(channel)
		s.audit(st, actor, "creator.team.accept", "channel", invite.ChannelID, string(invite.Role))
		return nil
	})
	if err == nil && expired {
		return nil, errors.New("team invite expired")
	}
	if err != nil || member == nil {
		return nil, err
	}
	copy := *member
	return &copy, nil
}

func (s *Service) SetTeamRole(actor, channelID, account string, role CreatorRole) (*TeamMember, error) {
	account, err := canonicalCreatorAccount(account)
	if err != nil {
		return nil, err
	}
	if !validCreatorRole(role) {
		return nil, errors.New("invalid creator role")
	}
	var out *TeamMember
	err = s.store.update(func(st *State) error {
		channel := st.Channels[channelID]
		if channel == nil {
			return ErrNotFound
		}
		if channel.Owner != actor {
			return ErrForbidden
		}
		member := st.TeamMembers[teamMemberKey(channelID, account)]
		if member == nil || member.State != "active" {
			return ErrNotFound
		}
		member.Role = role
		member.GrantedBy = actor
		member.UpdatedAt = s.cfg.Now().UTC()
		bumpChannelAuthVersion(channel)
		copy := *member
		out = &copy
		s.audit(st, actor, "creator.team.role", "channel", channelID, account+":"+string(role))
		return nil
	})
	return out, err
}

func (s *Service) RevokeTeamMember(actor, channelID, account string) error {
	account, err := canonicalCreatorAccount(account)
	if err != nil {
		return err
	}
	return s.store.update(func(st *State) error {
		channel := st.Channels[channelID]
		if channel == nil {
			return ErrNotFound
		}
		if channel.Owner != actor {
			return ErrForbidden
		}
		member := st.TeamMembers[teamMemberKey(channelID, account)]
		if member == nil || member.State != "active" {
			return ErrNotFound
		}
		now := s.cfg.Now().UTC()
		member.State = "revoked"
		member.UpdatedAt = now
		member.RevokedAt = &now
		bumpChannelAuthVersion(channel)
		s.audit(st, actor, "creator.team.revoke", "channel", channelID, account)
		return nil
	})
}

func (s *Service) Team(actor, channelID string) (TeamSnapshot, error) {
	var out TeamSnapshot
	err := s.store.read(func(st State) error {
		channel := st.Channels[channelID]
		if channel == nil {
			return ErrNotFound
		}
		role, ok := creatorRoleFor(st, channelID, actor)
		if !ok {
			return ErrForbidden
		}
		out.ChannelID = channelID
		out.AuthVersion = channel.AuthVersion
		out.Members = append(out.Members, TeamMember{ChannelID: channelID, Account: channel.Owner, GrantedBy: channel.Owner, State: "active", Role: CreatorRoleOwner, CreatedAt: channel.CreatedAt, UpdatedAt: channel.CreatedAt})
		for _, member := range st.TeamMembers {
			if member.ChannelID == channelID {
				out.Members = append(out.Members, *member)
			}
		}
		if role == CreatorRoleOwner {
			for _, invite := range st.TeamInvites {
				if invite.ChannelID == channelID {
					out.Invites = append(out.Invites, *invite)
				}
			}
		}
		return nil
	})
	sort.Slice(out.Members, func(i, j int) bool { return out.Members[i].Account < out.Members[j].Account })
	sort.Slice(out.Invites, func(i, j int) bool { return out.Invites[i].CreatedAt.After(out.Invites[j].CreatedAt) })
	return out, err
}

func normalizeSHA256(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) != 64 {
		return "", errors.New("SHA-256 must be 64 hexadecimal characters")
	}
	for _, ch := range value {
		if !strings.ContainsRune("0123456789abcdef", ch) {
			return "", errors.New("SHA-256 must be hexadecimal")
		}
	}
	return value, nil
}

func normalizeTerritories(values []string) ([]string, error) {
	if len(values) == 0 || len(values) > 64 {
		return nil, errors.New("at least one territory and at most 64 are required")
	}
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" || len(value) > 32 {
			return nil, errors.New("invalid territory")
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out, nil
}

func normalizeContributorSplits(values []ContributorSplit, defaultOwner string) ([]ContributorSplit, error) {
	if len(values) == 0 {
		return []ContributorSplit{{Account: defaultOwner, BasisPoints: 10000}}, nil
	}
	if len(values) > 64 {
		return nil, errors.New("too many contributor splits")
	}
	seen := map[string]bool{}
	var total int64
	out := make([]ContributorSplit, 0, len(values))
	for _, split := range values {
		account, err := canonicalCreatorAccount(split.Account)
		if err != nil || split.BasisPoints <= 0 || split.BasisPoints > 10000 || seen[account] {
			return nil, errors.New("invalid contributor split")
		}
		seen[account] = true
		total += split.BasisPoints
		out = append(out, ContributorSplit{Account: account, BasisPoints: split.BasisPoints})
	}
	if total != 10000 {
		return nil, errors.New("contributor splits must total 10000 basis points")
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Account < out[j].Account })
	return out, nil
}

func (s *Service) DeclareRights(actor, videoID string, input RightsDeclarationInput) (*RightsDeclaration, error) {
	basis := strings.ToLower(strings.TrimSpace(input.Basis))
	if basis != "owned" && basis != "licensed" && basis != "public_domain" {
		return nil, errors.New("rights basis must be owned, licensed, or public_domain")
	}
	if basis == "licensed" {
		var err error
		input.LicenseReference, err = cleanText(input.LicenseReference, 512)
		if err != nil {
			return nil, errors.New("licensed rights require a license reference")
		}
	} else {
		input.LicenseReference = strings.TrimSpace(input.LicenseReference)
		if len(input.LicenseReference) > 512 {
			return nil, errors.New("license reference too long")
		}
	}
	territories, err := normalizeTerritories(input.Territories)
	if err != nil {
		return nil, err
	}
	evidenceHash, err := normalizeSHA256(input.EvidenceSHA256)
	if err != nil {
		return nil, err
	}
	sourceHash, err := normalizeSHA256(input.SourceSHA256)
	if err != nil {
		return nil, err
	}
	now := s.cfg.Now().UTC()
	if input.StartsAt != nil {
		start := input.StartsAt.UTC()
		input.StartsAt = &start
	}
	if input.EndsAt != nil {
		end := input.EndsAt.UTC()
		input.EndsAt = &end
		if !end.After(now) {
			return nil, errors.New("rights duration is already expired")
		}
	}
	if input.StartsAt != nil && input.EndsAt != nil && !input.EndsAt.After(*input.StartsAt) {
		return nil, errors.New("rights end must be after start")
	}
	var declaration *RightsDeclaration
	err = s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		if sourceHash != strings.ToLower(video.SHA256) {
			return errors.New("rights source hash does not match uploaded media")
		}
		splits, splitErr := normalizeContributorSplits(input.ContributorSplits, video.Owner)
		if splitErr != nil {
			return splitErr
		}
		if previous := st.Rights[video.RightsDeclarationID]; previous != nil && previous.State != "rejected" {
			previous.State = "superseded"
			previous.UpdatedAt = now
		}
		declaration = &RightsDeclaration{ID: id("rights"), VideoID: videoID, DeclaredBy: actor, Basis: basis, LicenseReference: input.LicenseReference, Territories: territories, StartsAt: input.StartsAt, EndsAt: input.EndsAt, Exclusive: input.Exclusive, ContributorSplits: splits, EvidenceSHA256: evidenceHash, SourceSHA256: sourceHash, State: "declared", CreatedAt: now, UpdatedAt: now}
		st.Rights[declaration.ID] = declaration
		video.RightsDeclarationID = declaration.ID
		video.UpdatedAt = now
		s.audit(st, actor, "creator.rights.declare", "video", videoID, declaration.ID+":"+basis)
		return nil
	})
	if err != nil || declaration == nil {
		return nil, err
	}
	copy := *declaration
	copy.Territories = append([]string(nil), declaration.Territories...)
	copy.ContributorSplits = append([]ContributorSplit(nil), declaration.ContributorSplits...)
	return &copy, nil
}

func (s *Service) ReviewRights(reviewer, declarationID string, accepted bool, reason string) (*RightsDeclaration, error) {
	reason, err := cleanText(reason, 2000)
	if err != nil {
		return nil, err
	}
	var out *RightsDeclaration
	err = s.store.update(func(st *State) error {
		declaration := st.Rights[declarationID]
		if declaration == nil {
			return ErrNotFound
		}
		if declaration.State != "declared" {
			return errors.New("rights declaration is not pending review")
		}
		video := st.Videos[declaration.VideoID]
		if video == nil || !strings.EqualFold(video.SHA256, declaration.SourceSHA256) {
			return errors.New("rights source lineage no longer matches media")
		}
		if reviewer == declaration.DeclaredBy || reviewer == video.Owner {
			return errors.New("rights declarations require independent review")
		}
		now := s.cfg.Now().UTC()
		if accepted {
			declaration.State = "verified"
		} else {
			declaration.State = "rejected"
			normalizeWorkflowState(video)
			previous := video.WorkflowState
			video.Visibility = VisibilityPrivate
			video.Status = "ready"
			video.WorkflowState = WorkflowUnpublished
			resetReview(video)
			video.UpdatedAt = now
			recordVideoVersion(video, reviewer, "rights.rejected", previous, video.WorkflowState, now)
		}
		declaration.Reviewer = reviewer
		declaration.ReviewReason = reason
		declaration.UpdatedAt = now
		copy := *declaration
		copy.Territories = append([]string(nil), declaration.Territories...)
		copy.ContributorSplits = append([]ContributorSplit(nil), declaration.ContributorSplits...)
		out = &copy
		s.audit(st, reviewer, "creator.rights.review", "rights", declarationID, declaration.State+":"+reason)
		return nil
	})
	return out, err
}

func rightsActive(st State, video *Video, at time.Time, requireVerified bool) error {
	if video == nil || video.RightsDeclarationID == "" {
		return errors.New("rights declaration required")
	}
	declaration := st.Rights[video.RightsDeclarationID]
	if declaration == nil || declaration.VideoID != video.ID || !strings.EqualFold(declaration.SourceSHA256, video.SHA256) {
		return errors.New("rights declaration lineage mismatch")
	}
	if declaration.State != "declared" && declaration.State != "verified" {
		return errors.New("rights declaration is not active")
	}
	if requireVerified && declaration.State != "verified" {
		return errors.New("verified commercial rights are required")
	}
	if declaration.StartsAt != nil && at.Before(declaration.StartsAt.UTC()) {
		return errors.New("rights duration has not started")
	}
	if declaration.EndsAt != nil && !at.Before(declaration.EndsAt.UTC()) {
		return errors.New("rights duration expired")
	}
	return nil
}

func audienceAvailable(st State, video *Video, at time.Time) bool {
	if video == nil || (video.Visibility != VisibilityPublic && video.Visibility != VisibilityUnlisted) || video.Status != "published" || activeTakedown(video) {
		return false
	}
	return rightsActive(st, video, at, false) == nil
}

func discoverable(st State, video *Video, at time.Time) bool {
	return video != nil && video.Visibility == VisibilityPublic && audienceAvailable(st, video, at)
}
