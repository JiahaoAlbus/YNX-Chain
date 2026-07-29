package video

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrForbidden    = errors.New("forbidden")
	ErrNotFound     = errors.New("not found")
	ErrQuota        = errors.New("storage quota exceeded")
)

type Config struct {
	Root                              string
	MaxObjectBytes, AccountQuotaBytes int64
	Scanner                           Scanner
	Processor                         Processor
	AI                                AIProvider
	Pay                               PayVerifier
	Objects                           ObjectStorage
	IntegrityKey                      []byte
	MinMonetizationWatchSeconds       int64
	MinMonetizationSubscribers        int64
	Now                               func() time.Time
}
type Service struct {
	store     *Store
	cfg       Config
	aiMu      sync.Mutex
	aiCancels map[string]context.CancelFunc
	quotaMu   sync.Mutex
}
type UploadInput struct {
	Title, Description, Filename, ContentType string
	Size                                      int64
	OwnedDeclaration                          bool
	Reader                                    io.Reader
}

func NewService(cfg Config) (*Service, error) {
	if cfg.MaxObjectBytes <= 0 {
		cfg.MaxObjectBytes = 512 << 20
	}
	if cfg.AccountQuotaBytes <= 0 {
		cfg.AccountQuotaBytes = 5 << 30
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.MinMonetizationWatchSeconds <= 0 {
		cfg.MinMonetizationWatchSeconds = 3600
	}
	if cfg.MinMonetizationSubscribers <= 0 {
		cfg.MinMonetizationSubscribers = 10
	}
	if cfg.Scanner == nil || cfg.Processor == nil {
		return nil, errors.New("scanner and processor are required (fail closed)")
	}
	if cfg.Objects == nil {
		objects, err := NewLocalObjectStorage(filepath.Join(cfg.Root, "objects"))
		if err != nil {
			return nil, err
		}
		cfg.Objects = objects
	}
	store, err := OpenStore(cfg.Root, cfg.IntegrityKey)
	if err != nil {
		return nil, err
	}
	s := &Service{store: store, cfg: cfg, aiCancels: map[string]context.CancelFunc{}}
	if err = s.recoverInterrupted(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Service) AddCaptions(actor, videoID, language, label string, aiProposed bool, body io.Reader, size int64) (*CaptionTrack, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	if size <= 0 || size > 1<<20 {
		return nil, errors.New("caption file size outside 1 MiB bound")
	}
	language, err := cleanText(language, 16)
	if err != nil {
		return nil, err
	}
	label, err = cleanText(label, 80)
	if err != nil {
		return nil, err
	}
	var quotaOwner string
	_ = s.store.read(func(st State) error {
		if v := st.Videos[videoID]; v != nil && videoAuthorized(st, videoID, actor, CreatorRoleEditor, CreatorRoleUploader) {
			quotaOwner = v.Owner
		}
		return nil
	})
	if quotaOwner == "" {
		return nil, ErrForbidden
	}
	s.quotaMu.Lock()
	defer s.quotaMu.Unlock()
	if used, usageErr := s.usageForOwner(quotaOwner); usageErr != nil {
		return nil, usageErr
	} else if used+size > s.cfg.AccountQuotaBytes {
		return nil, ErrQuota
	}
	key := videoID + "/captions-" + id("track") + ".vtt"
	path, err := s.cfg.Objects.Resolve(key)
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	n, copyErr := io.CopyN(f, body, size+1)
	closeErr := f.Close()
	if copyErr != nil && copyErr != io.EOF {
		return nil, copyErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if n != size {
		os.Remove(path)
		return nil, errors.New("declared caption size mismatch")
	}
	content, readErr := os.ReadFile(path)
	if readErr != nil {
		return nil, readErr
	}
	if !bytes.HasPrefix(bytes.TrimPrefix(content, []byte{0xef, 0xbb, 0xbf}), []byte("WEBVTT")) {
		os.Remove(path)
		return nil, errors.New("captions must be valid WebVTT text")
	}
	track := CaptionTrack{Language: language, Label: label, ObjectKey: key, AIProposed: aiProposed, HumanApproved: !aiProposed}
	err = s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		v.Captions = append(v.Captions, track)
		s.audit(st, actor, "captions.add", "video", videoID, language)
		return nil
	})
	return &track, err
}

func (s *Service) History(actor string) ([]WatchEvent, error) {
	out := []WatchEvent{}
	err := s.store.read(func(st State) error {
		for _, e := range st.WatchEvents {
			if e.Account == actor {
				out = append(out, e)
			}
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, err
}
func (s *Service) Subscriptions(actor string) ([]Channel, error) {
	out := []Channel{}
	err := s.store.read(func(st State) error {
		for _, x := range st.Subscriptions {
			if x.Account == actor {
				if c := st.Channels[x.ChannelID]; c != nil {
					out = append(out, *c)
				}
			}
		}
		return nil
	})
	return out, err
}
func (s *Service) Playlists(actor string) ([]Playlist, error) {
	out := []Playlist{}
	err := s.store.read(func(st State) error {
		for _, p := range st.Playlists {
			if p.Owner == actor {
				out = append(out, *p)
			}
		}
		return nil
	})
	return out, err
}

func (s *Service) DeleteViewerData(actor string) (map[string]int, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	counts := map[string]int{"history": 0, "subscriptions": 0, "playlists": 0, "comments": 0}
	err := s.store.update(func(st *State) error {
		for key, event := range st.WatchEvents {
			if event.Account == actor {
				delete(st.WatchEvents, key)
				counts["history"]++
			}
		}
		for key, item := range st.Subscriptions {
			if item.Account == actor {
				delete(st.Subscriptions, key)
				counts["subscriptions"]++
			}
		}
		for key, item := range st.Playlists {
			if item.Owner == actor {
				delete(st.Playlists, key)
				counts["playlists"]++
			}
		}
		for _, item := range st.Comments {
			if item.Author == actor {
				item.Body = "[deleted by author]"
				item.State = "deleted"
				counts["comments"]++
			}
		}
		s.audit(st, actor, "privacy.viewer_data.delete", "account", actor, fmt.Sprintf("history=%d subscriptions=%d playlists=%d comments=%d", counts["history"], counts["subscriptions"], counts["playlists"], counts["comments"]))
		return nil
	})
	return counts, err
}
func (s *Service) Comments(actor, videoID string) ([]Comment, error) {
	out := []Comment{}
	err := s.store.read(func(st State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(st, videoID, actor) && !audienceAvailable(st, v, s.cfg.Now().UTC()) {
			return ErrForbidden
		}
		for _, c := range st.Comments {
			if c.VideoID == videoID && c.State == "visible" {
				out = append(out, *c)
			}
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, err
}
func (s *Service) Video(actor, videoID string) (*Video, error) {
	var out *Video
	err := s.store.read(func(st State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(st, videoID, actor) && !audienceAvailable(st, v, s.cfg.Now().UTC()) {
			return ErrForbidden
		}
		copy := *v
		out = &copy
		return nil
	})
	return out, err
}
func (s *Service) Channel(actor, channelID string) (ChannelView, error) {
	var out ChannelView
	err := s.store.read(func(st State) error {
		c := st.Channels[channelID]
		if c == nil {
			return ErrNotFound
		}
		out.Channel = *c
		teamAccess := channelAuthorized(st, channelID, actor)
		for _, v := range st.Videos {
			if v.ChannelID == channelID && (teamAccess || discoverable(st, v, s.cfg.Now().UTC())) {
				out.Videos = append(out.Videos, *v)
			}
		}
		for _, x := range st.Subscriptions {
			if x.ChannelID == channelID {
				out.Subscribers++
			}
		}
		return nil
	})
	sort.Slice(out.Videos, func(i, j int) bool { return out.Videos[i].CreatedAt.After(out.Videos[j].CreatedAt) })
	return out, err
}

func (s *Service) Studio(actor string) (StudioSnapshot, error) {
	var out StudioSnapshot
	err := s.store.read(func(st State) error {
		channels := actorChannels(st, actor)
		accessibleVideos := map[string]CreatorRole{}
		financialOwners := map[string]bool{}
		for channelID, role := range channels {
			channel := st.Channels[channelID]
			if channel == nil {
				continue
			}
			if role == CreatorRoleOwner {
				financialOwners[channel.Owner] = true
			}
			team := TeamSnapshot{ChannelID: channelID, AuthVersion: channel.AuthVersion}
			team.Members = append(team.Members, TeamMember{ChannelID: channelID, Account: channel.Owner, GrantedBy: channel.Owner, State: "active", Role: CreatorRoleOwner, CreatedAt: channel.CreatedAt, UpdatedAt: channel.CreatedAt})
			for _, member := range st.TeamMembers {
				if member.ChannelID == channelID {
					team.Members = append(team.Members, *member)
				}
			}
			if role == CreatorRoleOwner {
				for _, invite := range st.TeamInvites {
					if invite.ChannelID == channelID {
						team.Invites = append(team.Invites, *invite)
					}
				}
			}
			sort.Slice(team.Members, func(i, j int) bool { return team.Members[i].Account < team.Members[j].Account })
			sort.Slice(team.Invites, func(i, j int) bool { return team.Invites[i].CreatedAt.After(team.Invites[j].CreatedAt) })
			out.Team = append(out.Team, team)
		}
		for _, video := range st.Videos {
			if role, ok := channels[video.ChannelID]; ok {
				out.Videos = append(out.Videos, *video)
				accessibleVideos[video.ID] = role
			}
		}
		for _, declaration := range st.Rights {
			if _, ok := accessibleVideos[declaration.VideoID]; ok {
				out.Rights = append(out.Rights, *declaration)
			}
		}
		for _, report := range st.Reports {
			if role, ok := accessibleVideos[report.VideoID]; ok && roleAllowed(role, CreatorRoleEditor, CreatorRoleModerator) {
				out.Reports = append(out.Reports, *report)
			}
		}
		for videoID, monetization := range st.Monetization {
			if role, ok := accessibleVideos[videoID]; ok && roleAllowed(role, CreatorRoleFinance) {
				out.Monetization = append(out.Monetization, *monetization)
			}
		}
		accessibleRevenue := map[string]bool{}
		for _, revenue := range st.Revenue {
			if role, ok := accessibleVideos[revenue.VideoID]; ok && roleAllowed(role, CreatorRoleFinance) {
				out.Revenue = append(out.Revenue, *revenue)
				accessibleRevenue[revenue.ID] = true
			}
		}
		for _, payout := range st.PayoutIntents {
			if financialOwners[payout.Owner] {
				out.PayoutIntents = append(out.PayoutIntents, *payout)
			}
		}
		for _, dispute := range st.Disputes {
			if accessibleRevenue[dispute.RevenueRecordID] {
				out.Disputes = append(out.Disputes, *dispute)
			}
		}
		for _, appeal := range st.Appeals {
			if role, ok := accessibleVideos[appeal.VideoID]; ok && roleAllowed(role, CreatorRoleEditor, CreatorRoleModerator) {
				out.Appeals = append(out.Appeals, *appeal)
			}
		}
		for _, job := range st.AIJobs {
			role, ok := accessibleVideos[job.VideoID]
			if job.Owner == actor || (ok && roleAllowed(role, CreatorRoleEditor, CreatorRoleUploader)) {
				out.AIJobs = append(out.AIJobs, *job)
			}
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	out.Analytics, err = s.Analytics(actor)
	sort.Slice(out.Videos, func(i, j int) bool { return out.Videos[i].CreatedAt.After(out.Videos[j].CreatedAt) })
	sort.Slice(out.Team, func(i, j int) bool { return out.Team[i].ChannelID < out.Team[j].ChannelID })
	sort.Slice(out.Rights, func(i, j int) bool { return out.Rights[i].CreatedAt.After(out.Rights[j].CreatedAt) })
	return out, err
}

func (s *Service) UpdateMetadata(actor, videoID, title, description string) error {
	title, err := cleanText(title, 140)
	if err != nil {
		return err
	}
	if len(description) > 5000 {
		return errors.New("description too long")
	}
	return s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		v.Title = title
		v.Description = strings.TrimSpace(description)
		v.UpdatedAt = s.cfg.Now().UTC()
		s.audit(st, actor, "video.metadata.update", "video", videoID, "")
		return nil
	})
}

func (s *Service) RetryProcessing(ctx context.Context, actor, videoID string) (*Video, error) {
	s.quotaMu.Lock()
	defer s.quotaMu.Unlock()
	var original, quotaOwner string
	err := s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor, CreatorRoleUploader) {
			return ErrForbidden
		}
		quotaOwner = v.Owner
		if v.Status != "failed" {
			return errors.New("only failed processing can be retried")
		}
		v.Status = "scanning"
		v.Failure = ""
		v.UpdatedAt = s.cfg.Now().UTC()
		resolved, resolveErr := s.cfg.Objects.Resolve(v.ObjectKey)
		if resolveErr != nil {
			return resolveErr
		}
		original = resolved
		s.audit(st, actor, "video.processing.retry", "video", videoID, "")
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err = s.cfg.Scanner.Scan(ctx, original); err != nil {
		s.failVideo(videoID, "scan_failed: "+err.Error())
		return nil, err
	}
	s.setStatus(videoID, "transcoding", "")
	if err = cleanProcessingOutputs(filepath.Dir(original)); err != nil {
		s.failVideo(videoID, "processing cleanup failed: "+err.Error())
		return nil, err
	}
	variants, err := s.cfg.Processor.Transcode(ctx, original, filepath.Dir(original))
	if err != nil {
		s.failVideo(videoID, "transcode_failed: "+err.Error())
		return nil, err
	}
	var contentType string
	_ = s.store.read(func(st State) error { contentType = st.Videos[videoID].ContentType; return nil })
	variants = append(variants, MediaVariant{Name: "original-fallback", ObjectKey: videoID + "/original", MIME: contentType})
	if used, usageErr := s.usageForOwner(quotaOwner); usageErr != nil {
		return nil, usageErr
	} else if used > s.cfg.AccountQuotaBytes {
		_ = cleanProcessingOutputs(filepath.Dir(original))
		s.failVideo(videoID, "processed media exceeds account quota")
		return nil, ErrQuota
	}
	var out *Video
	err = s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		v.Status = "ready"
		v.Variants = variants
		v.Failure = ""
		v.UpdatedAt = s.cfg.Now().UTC()
		copy := *v
		out = &copy
		s.audit(st, actor, "video.processing.ready", "video", videoID, "retry")
		return nil
	})
	return out, err
}
func (s *Service) SetThumbnail(actor, videoID, mime string, body io.Reader, size int64) error {
	if size <= 0 || size > 5<<20 {
		return errors.New("thumbnail size outside 5 MiB bound")
	}
	exts := map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
	ext, ok := exts[mime]
	if !ok {
		return errors.New("unsupported thumbnail type")
	}
	var quotaOwner string
	_ = s.store.read(func(st State) error {
		if v := st.Videos[videoID]; v != nil && videoAuthorized(st, videoID, actor, CreatorRoleEditor, CreatorRoleUploader) {
			quotaOwner = v.Owner
		}
		return nil
	})
	if quotaOwner == "" {
		return ErrForbidden
	}
	s.quotaMu.Lock()
	defer s.quotaMu.Unlock()
	if used, usageErr := s.usageForOwner(quotaOwner); usageErr != nil {
		return usageErr
	} else if used+size > s.cfg.AccountQuotaBytes {
		return ErrQuota
	}
	key := videoID + "/thumbnail." + ext
	path, err := s.cfg.Objects.Resolve(key)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	n, copyErr := io.CopyN(f, body, size+1)
	closeErr := f.Close()
	if copyErr != nil && copyErr != io.EOF {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if n != size {
		os.Remove(path)
		return errors.New("declared thumbnail size mismatch")
	}
	prefix, readErr := os.ReadFile(path)
	if readErr != nil {
		return readErr
	}
	detected := http.DetectContentType(prefix)
	if detected != mime {
		os.Remove(path)
		return errors.New("thumbnail content does not match declared type")
	}
	return s.store.update(func(st *State) error {
		st.Videos[videoID].ThumbnailKey = key
		s.audit(st, actor, "thumbnail.set", "video", videoID, mime)
		return nil
	})
}

func (s *Service) ModerateReport(reviewer, reportID, decision, explanation string) error {
	if decision != "dismissed" && decision != "takedown" {
		return errors.New("invalid moderation decision")
	}
	if _, err := cleanText(explanation, 2000); err != nil {
		return err
	}
	return s.store.update(func(st *State) error {
		r := st.Reports[reportID]
		if r == nil {
			return ErrNotFound
		}
		if r.State != "submitted" {
			return errors.New("report already reviewed")
		}
		v := st.Videos[r.VideoID]
		now := s.cfg.Now().UTC()
		r.State = decision
		r.UpdatedAt = now
		if decision == "takedown" {
			v.Takedown = &Takedown{State: "active", Reason: explanation, Reviewer: reviewer, At: now}
			v.Visibility = VisibilityPrivate
		}
		s.audit(st, reviewer, "moderation."+decision, "report", reportID, explanation)
		return nil
	})
}
func (s *Service) ReviewAppeal(reviewer, appealID string, accepted bool, explanation string) error {
	if _, err := cleanText(explanation, 2000); err != nil {
		return err
	}
	return s.store.update(func(st *State) error {
		a := st.Appeals[appealID]
		if a == nil {
			return ErrNotFound
		}
		if a.State != "submitted" {
			return errors.New("appeal already reviewed")
		}
		v := st.Videos[a.VideoID]
		r := st.Reports[a.ReportID]
		now := s.cfg.Now().UTC()
		if accepted {
			a.State = "accepted"
			r.State = "appeal_accepted"
			if v.Takedown != nil {
				v.Takedown.State = "reversed"
			}
			v.Status = "ready"
			v.Visibility = VisibilityPrivate
		} else {
			a.State = "denied"
			r.State = "appeal_denied"
		}
		a.UpdatedAt = now
		r.UpdatedAt = now
		s.audit(st, reviewer, "appeal.review", "appeal", appealID, fmt.Sprintf("accepted=%t; %s", accepted, explanation))
		return nil
	})
}

func (s *Service) RequestMonetization(actor, videoID string) (*Monetization, error) {
	a, err := s.Analytics(actor)
	if err != nil {
		return nil, err
	}
	var out *Monetization
	err = s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleFinance) {
			return ErrForbidden
		}
		now := s.cfg.Now().UTC()
		state, reason := "pending_review", "derived thresholds and verified rights met; human review required"
		if v.Status != "published" || (v.Visibility != VisibilityPublic && v.Visibility != VisibilityUnlisted) || activeTakedown(v) {
			state = "ineligible"
			reason = "video must be published and free of an active takedown"
		} else if rightsErr := rightsActive(*st, v, now, true); rightsErr != nil {
			state = "ineligible"
			reason = rightsErr.Error()
		} else if a.WatchSeconds < s.cfg.MinMonetizationWatchSeconds || a.Subscribers < s.cfg.MinMonetizationSubscribers {
			state = "ineligible"
			reason = fmt.Sprintf("requires %d watch seconds and %d subscribers; current %d/%d", s.cfg.MinMonetizationWatchSeconds, s.cfg.MinMonetizationSubscribers, a.WatchSeconds, a.Subscribers)
		}
		out = &Monetization{VideoID: videoID, Owner: v.Owner, State: state, Reason: reason, RequestedAt: &now}
		st.Monetization[videoID] = out
		s.audit(st, actor, "monetization.request", "video", videoID, state)
		return nil
	})
	return out, err
}
func (s *Service) ReviewMonetization(reviewer, videoID string, approved bool, reason string) error {
	if _, err := cleanText(reason, 1000); err != nil {
		return err
	}
	return s.store.update(func(st *State) error {
		m := st.Monetization[videoID]
		if m == nil {
			return ErrNotFound
		}
		if m.State != "pending_review" {
			return errors.New("monetization is not pending review")
		}
		v := st.Videos[videoID]
		now := s.cfg.Now().UTC()
		if approved {
			if v == nil || v.Status != "published" || (v.Visibility != VisibilityPublic && v.Visibility != VisibilityUnlisted) || activeTakedown(v) {
				return errors.New("video is no longer eligible for monetization review")
			}
			if err := rightsActive(*st, v, now, true); err != nil {
				return err
			}
		}
		if approved {
			m.State = "eligible"
		} else {
			m.State = "denied"
		}
		m.Reason = reason
		m.ReviewedAt = &now
		s.audit(st, reviewer, "monetization.review", "video", videoID, m.State)
		return nil
	})
}
func (s *Service) RecordRevenue(ctx context.Context, reviewer, videoID, receiptID string, amount int64, usageIDs []string) (*RevenueRecord, error) {
	if s.cfg.Pay == nil {
		return nil, errors.New("Pay verifier unavailable")
	}
	if amount <= 0 || len(usageIDs) == 0 {
		return nil, errors.New("positive amount and usage evidence required")
	}
	var owner string
	err := s.store.read(func(st State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if monetization := st.Monetization[videoID]; monetization == nil || monetization.State != "eligible" {
			return errors.New("video is not approved for monetization")
		}
		if err := rightsActive(st, v, s.cfg.Now().UTC(), true); err != nil {
			return err
		}
		owner = v.Owner
		for _, u := range usageIDs {
			e, ok := st.WatchEvents[u]
			if !ok || e.VideoID != videoID {
				return errors.New("usage evidence mismatch")
			}
			for _, existing := range st.Revenue {
				for _, usedID := range existing.UsageEventIDs {
					if usedID == u {
						return errors.New("usage evidence already allocated")
					}
				}
			}
		}
		for _, x := range st.Revenue {
			if x.PayReceiptID == receiptID {
				return errors.New("receipt replay")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err = s.cfg.Pay.VerifyReceipt(ctx, receiptID, owner, amount); err != nil {
		return nil, err
	}
	rec := &RevenueRecord{ID: id("rev"), VideoID: videoID, Owner: owner, PayReceiptID: receiptID, AmountYNXT: amount, UsageEventIDs: append([]string(nil), usageIDs...), CreatedAt: s.cfg.Now().UTC()}
	err = s.store.update(func(st *State) error {
		video := st.Videos[videoID]
		if video == nil || video.Owner != owner {
			return errors.New("revenue owner changed during verification")
		}
		if monetization := st.Monetization[videoID]; monetization == nil || monetization.State != "eligible" {
			return errors.New("video is no longer approved for monetization")
		}
		if rightsErr := rightsActive(*st, video, s.cfg.Now().UTC(), true); rightsErr != nil {
			return rightsErr
		}
		for _, existing := range st.Revenue {
			if existing.PayReceiptID == receiptID {
				return errors.New("receipt replay")
			}
			for _, usedID := range existing.UsageEventIDs {
				for _, requestedID := range usageIDs {
					if usedID == requestedID {
						return errors.New("usage evidence already allocated")
					}
				}
			}
		}
		for _, usageID := range usageIDs {
			event, ok := st.WatchEvents[usageID]
			if !ok || event.VideoID != videoID {
				return errors.New("usage evidence mismatch")
			}
		}
		st.Revenue[rec.ID] = rec
		s.audit(st, reviewer, "revenue.record", "revenue", rec.ID, receiptID)
		return nil
	})
	return rec, err
}
func (s *Service) CreatePayoutIntent(ctx context.Context, owner string, amount int64) (*PayoutIntent, error) {
	if s.cfg.Pay == nil {
		return nil, errors.New("Pay service unavailable")
	}
	if amount <= 0 {
		return nil, errors.New("positive payout amount required")
	}
	var audited, reserved int64
	err := s.store.read(func(st State) error {
		ownsChannel := false
		for _, channel := range st.Channels {
			if channel.Owner == owner {
				ownsChannel = true
				break
			}
		}
		if !ownsChannel {
			return ErrForbidden
		}
		for _, revenue := range st.Revenue {
			if revenue.Owner == owner {
				audited += revenue.AmountYNXT
			}
		}
		for _, payout := range st.PayoutIntents {
			if payout.Owner == owner && payout.State != "cancelled" {
				reserved += payout.AmountYNXT
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if audited-reserved < amount {
		return nil, errors.New("insufficient audited revenue")
	}
	localID := id("payout")
	payID, err := s.cfg.Pay.CreatePayoutIntent(ctx, owner, amount, localID)
	if err != nil {
		return nil, err
	}
	p := &PayoutIntent{ID: localID, Owner: owner, PayIntentID: payID, State: "awaiting_wallet_confirmation", AmountYNXT: amount, CreatedAt: s.cfg.Now().UTC()}
	err = s.store.update(func(st *State) error {
		st.PayoutIntents[p.ID] = p
		s.audit(st, owner, "payout.intent.create", "payout", p.ID, payID)
		return nil
	})
	return p, err
}
func (s *Service) DisputeRevenue(actor, recordID, reason string) (*Dispute, error) {
	reason, err := cleanText(reason, 2000)
	if err != nil {
		return nil, err
	}
	var d *Dispute
	err = s.store.update(func(st *State) error {
		revenue := st.Revenue[recordID]
		if revenue == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, revenue.VideoID, actor, CreatorRoleFinance) {
			return ErrForbidden
		}
		for _, existing := range st.Disputes {
			if existing.RevenueRecordID == recordID && existing.State == "submitted" {
				return errors.New("revenue dispute already submitted")
			}
		}
		now := s.cfg.Now().UTC()
		d = &Dispute{ID: id("dsp"), Owner: revenue.Owner, RevenueRecordID: recordID, Reason: reason, State: "submitted", CreatedAt: now, UpdatedAt: now}
		st.Disputes[d.ID] = d
		s.audit(st, actor, "revenue.dispute", "dispute", d.ID, "")
		return nil
	})
	return d, err
}

func id(prefix string) string {
	b := make([]byte, 12)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return prefix + "_" + hex.EncodeToString(b)
}
func cleanText(v string, max int) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > max {
		return "", fmt.Errorf("text must be 1..%d bytes", max)
	}
	return v, nil
}
func (s *Service) audit(st *State, actor, action, typ, oid, detail string) {
	payload := sha256.Sum256([]byte(strings.Join([]string{actor, action, typ, oid, detail}, "\n")))
	previous := ""
	if len(st.Audit) > 0 {
		previous = st.Audit[len(st.Audit)-1].Hash
	}
	event := AuditEvent{ID: id("audit"), Actor: actor, Action: action, ObjectType: typ, ObjectID: oid, Detail: detail, At: s.cfg.Now().UTC(), Sequence: uint64(len(st.Audit) + 1), PayloadHash: hex.EncodeToString(payload[:]), PreviousHash: previous}
	event.Hash = auditEventHash(event)
	st.Audit = append(st.Audit, event)
}

func (s *Service) EnsureChannel(actor, handle, name string) (*Channel, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	var result *Channel
	err := s.store.update(func(st *State) error {
		for _, c := range st.Channels {
			if c.Owner == actor {
				result = c
				return nil
			}
			if strings.EqualFold(c.Handle, handle) {
				return errors.New("handle already used")
			}
		}
		var err error
		if handle, err = cleanText(handle, 40); err != nil {
			return err
		}
		if name, err = cleanText(name, 80); err != nil {
			return err
		}
		now := s.cfg.Now().UTC()
		result = &Channel{ID: id("chn"), Owner: actor, Handle: handle, Name: name, CreatedAt: now, AuthVersion: 1}
		st.Channels[result.ID] = result
		s.audit(st, actor, "channel.create", "channel", result.ID, "")
		return nil
	})
	return result, err
}

func (s *Service) Upload(ctx context.Context, actor, channelID string, in UploadInput) (*Video, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	s.quotaMu.Lock()
	defer s.quotaMu.Unlock()
	if !in.OwnedDeclaration {
		return nil, errors.New("owned-content declaration is required")
	}
	if in.Size <= 0 || in.Size > s.cfg.MaxObjectBytes {
		return nil, errors.New("object size outside configured bound")
	}
	allowed := map[string]bool{"video/mp4": true, "video/webm": true}
	if !allowed[in.ContentType] {
		return nil, errors.New("unsupported video type")
	}
	title, err := cleanText(in.Title, 140)
	if err != nil {
		return nil, err
	}
	if len(in.Description) > 5000 {
		return nil, errors.New("description too long")
	}
	var channelOwner string
	err = s.store.read(func(st State) error {
		c, ok := st.Channels[channelID]
		if !ok {
			return ErrNotFound
		}
		if !channelAuthorized(st, channelID, actor, CreatorRoleEditor, CreatorRoleUploader) {
			return ErrForbidden
		}
		channelOwner = c.Owner
		return nil
	})
	if err != nil {
		return nil, err
	}
	used, usageErr := s.usageForOwner(channelOwner)
	if usageErr != nil {
		return nil, usageErr
	}
	if used+in.Size > s.cfg.AccountQuotaBytes {
		return nil, ErrQuota
	}
	vid := id("vid")
	objDir, err := s.cfg.Objects.EnsurePrefix(vid)
	if err != nil {
		return nil, err
	}
	original, err := s.cfg.Objects.Resolve(vid + "/original")
	if err != nil {
		return nil, err
	}
	f, err := os.OpenFile(original, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	n, copyErr := io.CopyN(io.MultiWriter(f, h), in.Reader, in.Size+1)
	closeErr := f.Close()
	if copyErr != nil && copyErr != io.EOF {
		_ = s.cfg.Objects.RemovePrefix(vid)
		return nil, copyErr
	}
	if closeErr != nil {
		_ = s.cfg.Objects.RemovePrefix(vid)
		return nil, closeErr
	}
	if n != in.Size {
		_ = s.cfg.Objects.RemovePrefix(vid)
		return nil, errors.New("declared size does not match upload")
	}
	if err = verifyVideoSignature(original, in.ContentType); err != nil {
		_ = s.cfg.Objects.RemovePrefix(vid)
		return nil, err
	}
	now := s.cfg.Now().UTC()
	v := &Video{ID: vid, Owner: channelOwner, ChannelID: channelID, Title: title, Description: strings.TrimSpace(in.Description), OwnedDeclaration: true, Visibility: VisibilityPrivate, Status: "scanning", OriginalName: filepath.Base(in.Filename), ContentType: in.ContentType, Bytes: n, SHA256: hex.EncodeToString(h.Sum(nil)), ObjectKey: vid + "/original", CreatedAt: now, UpdatedAt: now}
	if err = s.store.update(func(st *State) error {
		st.Videos[vid] = v
		s.audit(st, actor, "video.upload", "video", vid, v.SHA256)
		return nil
	}); err != nil {
		_ = s.cfg.Objects.RemovePrefix(vid)
		return nil, err
	}
	if err = s.cfg.Scanner.Scan(ctx, original); err != nil {
		s.failVideo(vid, "scan_failed: "+err.Error())
		return s.snapshotVideo(vid), err
	}
	s.setStatus(vid, "transcoding", "")
	variants, err := s.cfg.Processor.Transcode(ctx, original, objDir)
	if err != nil {
		s.failVideo(vid, "transcode_failed: "+err.Error())
		return s.snapshotVideo(vid), err
	}
	variants = append(variants, MediaVariant{Name: "original-fallback", ObjectKey: vid + "/original", MIME: in.ContentType})
	if used, usageErr := s.usageForOwner(channelOwner); usageErr != nil {
		return v, usageErr
	} else if used > s.cfg.AccountQuotaBytes {
		_ = cleanProcessingOutputs(objDir)
		s.failVideo(vid, "processed media exceeds account quota")
		return s.snapshotVideo(vid), ErrQuota
	}
	err = s.store.update(func(st *State) error {
		x := st.Videos[vid]
		x.Status = "ready"
		x.Failure = ""
		x.Variants = variants
		x.UpdatedAt = s.cfg.Now().UTC()
		s.audit(st, actor, "video.processing.ready", "video", vid, "")
		v = x
		return nil
	})
	return v, err
}
func verifyVideoSignature(path, mime string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	data := make([]byte, 12)
	n, err := io.ReadFull(f, data)
	if err != nil && err != io.ErrUnexpectedEOF {
		return err
	}
	data = data[:n]
	switch mime {
	case "video/mp4":
		if len(data) < 12 || !bytes.Equal(data[4:8], []byte("ftyp")) {
			return errors.New("MP4 content signature mismatch")
		}
	case "video/webm":
		if len(data) < 4 || !bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}) {
			return errors.New("WebM content signature mismatch")
		}
	default:
		return errors.New("unsupported video type")
	}
	return nil
}
func cleanProcessingOutputs(dir string) error {
	matches, err := filepath.Glob(filepath.Join(dir, "segment-*.ts"))
	if err != nil {
		return err
	}
	matches = append(matches, filepath.Join(dir, "stream.m3u8"))
	for _, path := range matches {
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
func (s *Service) usageForOwner(owner string) (int64, error) {
	ids := []string{}
	if err := s.store.read(func(st State) error {
		for _, v := range st.Videos {
			if v.Owner == owner {
				ids = append(ids, v.ID)
			}
		}
		return nil
	}); err != nil {
		return 0, err
	}
	var total int64
	for _, id := range ids {
		usage, err := s.cfg.Objects.Usage(id)
		if err != nil {
			return 0, err
		}
		total += usage
	}
	return total, nil
}
func (s *Service) setStatus(videoID, status, failure string) {
	_ = s.store.update(func(st *State) error {
		if v := st.Videos[videoID]; v != nil {
			v.Status = status
			v.Failure = failure
			v.UpdatedAt = s.cfg.Now().UTC()
		}
		return nil
	})
}

func (s *Service) snapshotVideo(videoID string) *Video {
	var out *Video
	_ = s.store.read(func(st State) error {
		if video := st.Videos[videoID]; video != nil {
			copy := *video
			out = &copy
		}
		return nil
	})
	return out
}

func (s *Service) failVideo(videoID, failure string) { s.setStatus(videoID, "failed", failure) }
func activeTakedown(v *Video) bool {
	return v != nil && v.Takedown != nil && v.Takedown.State == "active"
}
func (s *Service) recoverInterrupted() error {
	return s.store.update(func(st *State) error {
		for _, v := range st.Videos {
			if v.Status == "scanning" || v.Status == "transcoding" {
				v.Status = "failed"
				v.Failure = "processing interrupted by restart; retry upload"
				v.UpdatedAt = s.cfg.Now().UTC()
				s.audit(st, "system", "video.processing.recovered", "video", v.ID, v.Failure)
			}
		}
		return nil
	})
}

func (s *Service) Publish(actor, videoID string, visibility Visibility) error {
	if visibility != VisibilityPublic && visibility != VisibilityPrivate && visibility != VisibilityUnlisted {
		return errors.New("invalid visibility")
	}
	return s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor) {
			return ErrForbidden
		}
		if v.Status != "ready" && v.Status != "published" {
			return errors.New("video is not ready")
		}
		if v.Takedown != nil && v.Takedown.State == "active" {
			return errors.New("video is taken down")
		}
		now := s.cfg.Now().UTC()
		if visibility == VisibilityPublic || visibility == VisibilityUnlisted {
			if err := rightsActive(*st, v, now, false); err != nil {
				return err
			}
		}
		v.Visibility = visibility
		v.Status = "published"
		v.UpdatedAt = now
		if visibility == VisibilityPublic && v.PublishedAt == nil {
			v.PublishedAt = &now
		}
		s.audit(st, actor, "video.publish.reviewed", "video", videoID, string(visibility))
		return nil
	})
}
func (s *Service) Search(actor, query string) ([]Video, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	out := []Video{}
	err := s.store.read(func(st State) error {
		now := s.cfg.Now().UTC()
		for _, v := range st.Videos {
			allowed := discoverable(st, v, now) || channelAuthorized(st, v.ChannelID, actor)
			if allowed && (query == "" || strings.Contains(strings.ToLower(v.Title+" "+v.Description), query)) {
				out = append(out, *v)
			}
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, err
}
func (s *Service) MediaPath(actor, objectKey string) (string, error) {
	objectKey = strings.TrimPrefix(filepath.Clean("/"+objectKey), "/")
	parts := strings.Split(objectKey, "/")
	if len(parts) < 2 || !strings.HasPrefix(parts[0], "vid_") {
		return "", ErrNotFound
	}
	err := s.store.read(func(st State) error {
		v := st.Videos[parts[0]]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(st, v.ID, actor) && !audienceAvailable(st, v, s.cfg.Now().UTC()) {
			return ErrForbidden
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	path, resolveErr := s.cfg.Objects.Resolve(objectKey)
	if resolveErr != nil {
		return "", ErrForbidden
	}
	if _, err := os.Stat(path); err != nil {
		return "", ErrNotFound
	}
	return path, nil
}
func (s *Service) RecordWatch(actor, videoID string, seconds int64, completed bool) error {
	if actor == "" {
		return ErrUnauthorized
	}
	if seconds < 0 || seconds > 86400 {
		return errors.New("invalid watch duration")
	}
	return s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if !audienceAvailable(*st, v, s.cfg.Now().UTC()) {
			return ErrNotFound
		}
		e := WatchEvent{ID: id("watch"), VideoID: videoID, Account: actor, Seconds: seconds, Completed: completed, CreatedAt: s.cfg.Now().UTC()}
		st.WatchEvents[e.ID] = e
		s.audit(st, actor, "watch.record", "video", videoID, fmt.Sprint(seconds))
		return nil
	})
}
func (s *Service) AddComment(actor, videoID, body string) (*Comment, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	body, err := cleanText(body, 2000)
	if err != nil {
		return nil, err
	}
	var c *Comment
	err = s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if !audienceAvailable(*st, v, s.cfg.Now().UTC()) {
			return ErrNotFound
		}
		now := s.cfg.Now().UTC()
		c = &Comment{ID: id("cmt"), VideoID: videoID, Author: actor, Body: body, State: "visible", CreatedAt: now}
		st.Comments[c.ID] = c
		s.audit(st, actor, "comment.create", "comment", c.ID, "")
		return nil
	})
	return c, err
}
func (s *Service) Subscribe(actor, channelID string) error {
	if actor == "" {
		return ErrUnauthorized
	}
	return s.store.update(func(st *State) error {
		if st.Channels[channelID] == nil {
			return ErrNotFound
		}
		key := actor + ":" + channelID
		if _, ok := st.Subscriptions[key]; ok {
			delete(st.Subscriptions, key)
			s.audit(st, actor, "subscription.remove", "channel", channelID, "")
		} else {
			st.Subscriptions[key] = Subscription{Account: actor, ChannelID: channelID, CreatedAt: s.cfg.Now().UTC()}
			s.audit(st, actor, "subscription.add", "channel", channelID, "")
		}
		return nil
	})
}
func (s *Service) CreatePlaylist(actor, name string) (*Playlist, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	name, err := cleanText(name, 100)
	if err != nil {
		return nil, err
	}
	p := &Playlist{ID: id("pl"), Owner: actor, Name: name, CreatedAt: s.cfg.Now().UTC(), UpdatedAt: s.cfg.Now().UTC()}
	err = s.store.update(func(st *State) error {
		st.Playlists[p.ID] = p
		s.audit(st, actor, "playlist.create", "playlist", p.ID, "")
		return nil
	})
	return p, err
}
func (s *Service) AddToPlaylist(actor, pid, vid string) error {
	return s.store.update(func(st *State) error {
		p := st.Playlists[pid]
		if p == nil {
			return ErrNotFound
		}
		if p.Owner != actor {
			return ErrForbidden
		}
		if st.Videos[vid] == nil {
			return ErrNotFound
		}
		for _, x := range p.VideoIDs {
			if x == vid {
				return nil
			}
		}
		p.VideoIDs = append(p.VideoIDs, vid)
		p.UpdatedAt = s.cfg.Now().UTC()
		s.audit(st, actor, "playlist.add", "playlist", pid, vid)
		return nil
	})
}
func (s *Service) Report(actor, vid, reason, details string) (*Report, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	reason, err := cleanText(reason, 80)
	if err != nil {
		return nil, err
	}
	if len(details) > 2000 {
		return nil, errors.New("details too long")
	}
	var r *Report
	err = s.store.update(func(st *State) error {
		v := st.Videos[vid]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, vid, actor) && !audienceAvailable(*st, v, s.cfg.Now().UTC()) {
			return ErrForbidden
		}
		now := s.cfg.Now().UTC()
		r = &Report{ID: id("rpt"), VideoID: vid, Reporter: actor, Reason: reason, Details: details, State: "submitted", CreatedAt: now, UpdatedAt: now}
		st.Reports[r.ID] = r
		s.audit(st, actor, "report.submit", "report", r.ID, "")
		return nil
	})
	return r, err
}
func (s *Service) Appeal(actor, reportID, reason string) (*Appeal, error) {
	if actor == "" {
		return nil, ErrUnauthorized
	}
	reason, err := cleanText(reason, 2000)
	if err != nil {
		return nil, err
	}
	var a *Appeal
	err = s.store.update(func(st *State) error {
		r := st.Reports[reportID]
		if r == nil {
			return ErrNotFound
		}
		v := st.Videos[r.VideoID]
		if v.Owner != actor {
			return ErrForbidden
		}
		if r.State != "takedown" {
			return errors.New("only an active takedown can be appealed")
		}
		for _, existing := range st.Appeals {
			if existing.ReportID == reportID && existing.State == "submitted" {
				return errors.New("appeal already submitted")
			}
		}
		now := s.cfg.Now().UTC()
		a = &Appeal{ID: id("apl"), ReportID: reportID, VideoID: v.ID, Appellant: actor, Reason: reason, State: "submitted", CreatedAt: now, UpdatedAt: now}
		st.Appeals[a.ID] = a
		s.audit(st, actor, "appeal.submit", "appeal", a.ID, "")
		return nil
	})
	return a, err
}
func (s *Service) Analytics(actor string) (Analytics, error) {
	a := Analytics{
		Source:  "ynx.creator-studio.persisted-events",
		AsOf:    s.cfg.Now().UTC(),
		Version: "analytics.v1",
		Coverage: AnalyticsCoverage{
			Scope: "actor-authorized channels and videos",
		},
	}
	err := s.store.read(func(st State) error {
		channels := actorChannels(st, actor)
		metricChannels := map[string]bool{}
		videos := map[string]bool{}
		financialVideos := map[string]bool{}
		uniqueUsers := map[string]bool{}
		for channelID, role := range channels {
			if roleAllowed(role, CreatorRoleAnalyst, CreatorRoleFinance) {
				metricChannels[channelID] = true
				a.Coverage.ChannelCount++
			}
		}
		for _, video := range st.Videos {
			if role, ok := channels[video.ChannelID]; ok {
				if roleAllowed(role, CreatorRoleAnalyst, CreatorRoleFinance) {
					videos[video.ID] = true
					a.Coverage.VideoCount++
				}
				if roleAllowed(role, CreatorRoleFinance) {
					financialVideos[video.ID] = true
				}
			}
		}
		for _, event := range st.WatchEvents {
			if videos[event.VideoID] {
				a.Coverage.WatchEventCount++
				a.Views++
				a.WatchSeconds += event.Seconds
				if event.Completed {
					a.CompletedViews++
				}
				uniqueUsers[event.Account] = true
			}
		}
		a.UniqueUsers = int64(len(uniqueUsers))
		for _, subscription := range st.Subscriptions {
			if metricChannels[subscription.ChannelID] {
				a.Coverage.SubscriptionEventCount++
				a.Subscribers++
			}
		}
		for _, revenue := range st.Revenue {
			if financialVideos[revenue.VideoID] {
				a.Coverage.RevenueEventCount++
				a.RevenueYNXT += revenue.AmountYNXT
			}
		}
		a.Coverage.RevenueIncluded = len(financialVideos) > 0
		return nil
	})
	return a, err
}

func (s *Service) PrepareAI(actor, videoID, kind string, classes []string) (*AIJob, error) {
	return s.PrepareAIInLanguage(actor, videoID, kind, classes, "en")
}

func (s *Service) PrepareAIInLanguage(actor, videoID, kind string, classes []string, outputLanguage string) (*AIJob, error) {
	allowed := map[string]bool{"summary": true, "chapters": true, "captions": true, "metadata": true, "search_assistance": true, "moderation_explanation": true}
	if !allowed[kind] {
		return nil, errors.New("unsupported AI workflow")
	}
	languages := map[string]bool{"en": true, "zh-CN": true, "zh-TW": true, "ja": true, "ko": true, "es": true, "fr": true, "de": true, "pt": true, "ru": true, "ar": true, "id": true}
	if !languages[outputLanguage] {
		return nil, errors.New("unsupported AI output language")
	}
	var job *AIJob
	err := s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if !videoAuthorized(*st, videoID, actor, CreatorRoleEditor, CreatorRoleUploader) {
			if kind != "search_assistance" || !discoverable(*st, v, s.cfg.Now().UTC()) {
				return ErrForbidden
			}
		}
		preview := "title and description"
		for _, c := range classes {
			if c != "metadata" && c != "captions" {
				return errors.New("context class not permitted")
			}
		}
		now := s.cfg.Now().UTC()
		job = &AIJob{ID: id("ai"), Owner: actor, VideoID: videoID, Kind: kind, State: "awaiting_permission", ContextClasses: classes, ContextPreview: preview, OutputLanguage: outputLanguage, EstimatedUnits: 1000, CreatedAt: now}
		st.AIJobs[job.ID] = job
		s.audit(st, actor, "ai.prepare", "ai_job", job.ID, kind)
		return nil
	})
	return job, err
}
func (s *Service) RunAI(ctx context.Context, actor, jobID string) (*AIJob, error) {
	if s.cfg.AI == nil {
		return nil, errors.New("AI provider unavailable")
	}
	var snapshot AIJob
	err := s.store.update(func(st *State) error {
		j := st.AIJobs[jobID]
		if j == nil {
			return ErrNotFound
		}
		if j.Owner != actor {
			return ErrForbidden
		}
		if j.State != "awaiting_permission" && j.State != "failed" {
			return errors.New("AI job cannot run")
		}
		j.State = "running"
		j.PermissionAt = s.cfg.Now().UTC()
		snapshot = *j
		s.audit(st, actor, "ai.permission.grant", "ai_job", jobID, strings.Join(j.ContextClasses, ","))
		return nil
	})
	if err != nil {
		return nil, err
	}
	runCtx, cancel := context.WithCancel(ctx)
	s.aiMu.Lock()
	s.aiCancels[jobID] = cancel
	s.aiMu.Unlock()
	defer func() { cancel(); s.aiMu.Lock(); delete(s.aiCancels, jobID); s.aiMu.Unlock() }()
	request := AIRequest{Kind: snapshot.Kind, VideoID: snapshot.VideoID, ContextPreview: snapshot.ContextPreview, ContextClasses: snapshot.ContextClasses, OutputLanguage: snapshot.OutputLanguage}
	var result AIResult
	var runErr error
	if streamer, ok := s.cfg.AI.(AIStreamer); ok {
		result, runErr = streamer.Stream(runCtx, request, func(delta string) error {
			if delta == "" {
				return nil
			}
			return s.store.update(func(st *State) error {
				j := st.AIJobs[jobID]
				if j == nil {
					return ErrNotFound
				}
				if j.State == "cancelled" {
					return context.Canceled
				}
				if len(j.Partial)+len(delta) > 200_000 {
					return errors.New("AI result exceeds bound")
				}
				j.Partial += delta
				return nil
			})
		})
	} else {
		result, runErr = s.cfg.AI.Generate(runCtx, request)
	}
	err = s.store.update(func(st *State) error {
		j := st.AIJobs[jobID]
		if j.State == "cancelled" {
			return nil
		}
		if runErr != nil {
			j.State = "failed"
			j.Failure = runErr.Error()
		} else {
			j.State = "review_required"
			j.Provider = result.Provider
			j.Model = result.Model
			j.Result = result.Text
			j.Partial = ""
			j.EstimatedUnits = result.Units
		}
		return nil
	})
	if current, _ := s.GetAI(actor, jobID); current != nil && current.State == "cancelled" {
		return current, nil
	}
	if runErr != nil {
		return nil, runErr
	}
	if err != nil {
		return nil, err
	}
	return s.GetAI(actor, jobID)
}
func (s *Service) CancelAI(actor, jobID string) (*AIJob, error) {
	var out *AIJob
	err := s.store.update(func(st *State) error {
		j := st.AIJobs[jobID]
		if j == nil {
			return ErrNotFound
		}
		if j.Owner != actor {
			return ErrForbidden
		}
		if j.State != "running" && j.State != "awaiting_permission" {
			return errors.New("AI job cannot be cancelled")
		}
		j.State = "cancelled"
		j.Failure = "cancelled by user"
		copy := *j
		out = &copy
		s.audit(st, actor, "ai.cancel", "ai_job", jobID, "")
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.aiMu.Lock()
	cancel := s.aiCancels[jobID]
	s.aiMu.Unlock()
	if cancel != nil {
		cancel()
	}
	return out, nil
}
func (s *Service) GetAI(actor, id string) (*AIJob, error) {
	var out *AIJob
	err := s.store.read(func(st State) error {
		j := st.AIJobs[id]
		if j == nil {
			return ErrNotFound
		}
		if j.Owner != actor {
			return ErrForbidden
		}
		copy := *j
		out = &copy
		return nil
	})
	return out, err
}
func (s *Service) ReviewAI(actor, id string, apply bool) (*AIJob, error) {
	var out *AIJob
	err := s.store.update(func(st *State) error {
		j := st.AIJobs[id]
		if j == nil {
			return ErrNotFound
		}
		if j.Owner != actor {
			return ErrForbidden
		}
		if j.State != "review_required" {
			return errors.New("AI result is not ready for review")
		}
		now := s.cfg.Now().UTC()
		j.ReviewedBy = actor
		j.ReviewedAt = &now
		j.Accepted = apply
		if apply {
			j.State = "accepted_suggestion"
		} else {
			j.State = "rejected"
		}
		s.audit(st, actor, "ai.review", "ai_job", id, fmt.Sprint(apply))
		copy := *j
		out = &copy
		return nil
	})
	return out, err
}
func (s *Service) DeleteAI(actor, id string) error {
	return s.store.update(func(st *State) error {
		j := st.AIJobs[id]
		if j == nil {
			return ErrNotFound
		}
		if j.Owner != actor {
			return ErrForbidden
		}
		if j.State == "running" {
			return errors.New("cancel a running AI job before deletion")
		}
		delete(st.AIJobs, id)
		s.audit(st, actor, "ai.delete", "ai_job", id, "result and context deleted")
		return nil
	})
}
