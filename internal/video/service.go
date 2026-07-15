package video

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
	MinMonetizationWatchSeconds       int64
	MinMonetizationSubscribers        int64
	Now                               func() time.Time
}
type Service struct {
	store *Store
	cfg   Config
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
	store, err := OpenStore(cfg.Root)
	if err != nil {
		return nil, err
	}
	s := &Service{store: store, cfg: cfg}
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
	var owner bool
	_ = s.store.read(func(st State) error {
		if v := st.Videos[videoID]; v != nil {
			owner = v.Owner == actor
		}
		return nil
	})
	if !owner {
		return nil, ErrForbidden
	}
	key := videoID + "/captions-" + id("track") + ".vtt"
	path := filepath.Join(s.cfg.Root, "objects", key)
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
func (s *Service) Comments(actor, videoID string) ([]Comment, error) {
	out := []Comment{}
	err := s.store.read(func(st State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if v.Owner != actor && (v.Visibility != VisibilityPublic || v.Takedown != nil) {
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
func (s *Service) SetThumbnail(actor, videoID, mime string, body io.Reader, size int64) error {
	if size <= 0 || size > 5<<20 {
		return errors.New("thumbnail size outside 5 MiB bound")
	}
	exts := map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
	ext, ok := exts[mime]
	if !ok {
		return errors.New("unsupported thumbnail type")
	}
	var allowed bool
	_ = s.store.read(func(st State) error {
		if v := st.Videos[videoID]; v != nil {
			allowed = v.Owner == actor
		}
		return nil
	})
	if !allowed {
		return ErrForbidden
	}
	key := videoID + "/thumbnail." + ext
	path := filepath.Join(s.cfg.Root, "objects", key)
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

func (s *Service) RequestMonetization(owner, videoID string) (*Monetization, error) {
	a, err := s.Analytics(owner)
	if err != nil {
		return nil, err
	}
	var out *Monetization
	err = s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if v.Owner != owner {
			return ErrForbidden
		}
		now := s.cfg.Now().UTC()
		state, reason := "pending_review", "derived thresholds met; human review required"
		if a.WatchSeconds < s.cfg.MinMonetizationWatchSeconds || a.Subscribers < s.cfg.MinMonetizationSubscribers {
			state = "ineligible"
			reason = fmt.Sprintf("requires %d watch seconds and %d subscribers; current %d/%d", s.cfg.MinMonetizationWatchSeconds, s.cfg.MinMonetizationSubscribers, a.WatchSeconds, a.Subscribers)
		}
		out = &Monetization{VideoID: videoID, Owner: owner, State: state, Reason: reason, RequestedAt: &now}
		st.Monetization[videoID] = out
		s.audit(st, owner, "monetization.request", "video", videoID, state)
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
		now := s.cfg.Now().UTC()
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
		owner = v.Owner
		for _, u := range usageIDs {
			e, ok := st.WatchEvents[u]
			if !ok || e.VideoID != videoID {
				return errors.New("usage evidence mismatch")
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
	rec := &RevenueRecord{ID: id("rev"), VideoID: videoID, Owner: owner, PayReceiptID: receiptID, AmountYNXT: amount, UsageEventIDs: usageIDs, CreatedAt: s.cfg.Now().UTC()}
	err = s.store.update(func(st *State) error {
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
	a, err := s.Analytics(owner)
	if err != nil {
		return nil, err
	}
	var reserved int64
	_ = s.store.read(func(st State) error {
		for _, p := range st.PayoutIntents {
			if p.Owner == owner && p.State != "cancelled" {
				reserved += p.AmountYNXT
			}
		}
		return nil
	})
	if a.RevenueYNXT-reserved < amount {
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
func (s *Service) DisputeRevenue(owner, recordID, reason string) (*Dispute, error) {
	reason, err := cleanText(reason, 2000)
	if err != nil {
		return nil, err
	}
	var d *Dispute
	err = s.store.update(func(st *State) error {
		r := st.Revenue[recordID]
		if r == nil {
			return ErrNotFound
		}
		if r.Owner != owner {
			return ErrForbidden
		}
		now := s.cfg.Now().UTC()
		d = &Dispute{ID: id("dsp"), Owner: owner, RevenueRecordID: recordID, Reason: reason, State: "submitted", CreatedAt: now, UpdatedAt: now}
		st.Disputes[d.ID] = d
		s.audit(st, owner, "revenue.dispute", "dispute", d.ID, "")
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
	st.Audit = append(st.Audit, AuditEvent{ID: id("audit"), Actor: actor, Action: action, ObjectType: typ, ObjectID: oid, Detail: detail, At: s.cfg.Now().UTC()})
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
		result = &Channel{ID: id("chn"), Owner: actor, Handle: handle, Name: name, CreatedAt: now}
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
	var used int64
	err = s.store.read(func(st State) error {
		c, ok := st.Channels[channelID]
		if !ok {
			return ErrNotFound
		}
		if c.Owner != actor {
			return ErrForbidden
		}
		for _, v := range st.Videos {
			if v.Owner == actor {
				used += v.Bytes
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if used+in.Size > s.cfg.AccountQuotaBytes {
		return nil, ErrQuota
	}
	vid := id("vid")
	objDir := filepath.Join(s.cfg.Root, "objects", vid)
	if err = os.Mkdir(objDir, 0700); err != nil {
		return nil, err
	}
	original := filepath.Join(objDir, "original")
	f, err := os.OpenFile(original, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	h := sha256.New()
	n, copyErr := io.CopyN(io.MultiWriter(f, h), in.Reader, in.Size+1)
	closeErr := f.Close()
	if copyErr != nil && copyErr != io.EOF {
		os.RemoveAll(objDir)
		return nil, copyErr
	}
	if closeErr != nil {
		os.RemoveAll(objDir)
		return nil, closeErr
	}
	if n != in.Size {
		os.RemoveAll(objDir)
		return nil, errors.New("declared size does not match upload")
	}
	now := s.cfg.Now().UTC()
	v := &Video{ID: vid, Owner: actor, ChannelID: channelID, Title: title, Description: strings.TrimSpace(in.Description), OwnedDeclaration: true, Visibility: VisibilityPrivate, Status: "scanning", OriginalName: filepath.Base(in.Filename), ContentType: in.ContentType, Bytes: n, SHA256: hex.EncodeToString(h.Sum(nil)), ObjectKey: vid + "/original", CreatedAt: now, UpdatedAt: now}
	if err = s.store.update(func(st *State) error {
		st.Videos[vid] = v
		s.audit(st, actor, "video.upload", "video", vid, v.SHA256)
		return nil
	}); err != nil {
		os.RemoveAll(objDir)
		return nil, err
	}
	if err = s.cfg.Scanner.Scan(ctx, original); err != nil {
		s.failVideo(vid, "scan_failed: "+err.Error())
		return v, err
	}
	s.setStatus(vid, "transcoding", "")
	variants, err := s.cfg.Processor.Transcode(ctx, original, objDir)
	if err != nil {
		s.failVideo(vid, "transcode_failed: "+err.Error())
		return v, err
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
func (s *Service) failVideo(videoID, failure string) { s.setStatus(videoID, "failed", failure) }
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
		if v.Owner != actor {
			return ErrForbidden
		}
		if v.Status != "ready" && v.Status != "published" {
			return errors.New("video is not ready")
		}
		if v.Takedown != nil && v.Takedown.State == "active" {
			return errors.New("video is taken down")
		}
		now := s.cfg.Now().UTC()
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
		for _, v := range st.Videos {
			allowed := v.Visibility == VisibilityPublic && v.Status == "published" && v.Takedown == nil
			if actor == v.Owner {
				allowed = true
			}
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
		if v.Owner != actor && (v.Visibility != VisibilityPublic || v.Status != "published" || v.Takedown != nil) {
			return ErrForbidden
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	path := filepath.Join(s.cfg.Root, "objects", objectKey)
	root := filepath.Join(s.cfg.Root, "objects") + string(os.PathSeparator)
	if !strings.HasPrefix(path, root) {
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
		if v == nil || v.Visibility != VisibilityPublic || v.Status != "published" {
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
		if v == nil || v.Visibility != VisibilityPublic || v.Status != "published" {
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
		if st.Videos[vid] == nil {
			return ErrNotFound
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
		now := s.cfg.Now().UTC()
		a = &Appeal{ID: id("apl"), ReportID: reportID, VideoID: v.ID, Appellant: actor, Reason: reason, State: "submitted", CreatedAt: now, UpdatedAt: now}
		st.Appeals[a.ID] = a
		s.audit(st, actor, "appeal.submit", "appeal", a.ID, "")
		return nil
	})
	return a, err
}
func (s *Service) Analytics(owner string) (Analytics, error) {
	var a Analytics
	err := s.store.read(func(st State) error {
		owned := map[string]bool{}
		channels := map[string]bool{}
		for _, v := range st.Videos {
			if v.Owner == owner {
				owned[v.ID] = true
			}
		}
		for _, c := range st.Channels {
			if c.Owner == owner {
				channels[c.ID] = true
			}
		}
		for _, e := range st.WatchEvents {
			if owned[e.VideoID] {
				a.Views++
				a.WatchSeconds += e.Seconds
			}
		}
		for _, x := range st.Subscriptions {
			if channels[x.ChannelID] {
				a.Subscribers++
			}
		}
		for _, r := range st.Revenue {
			if r.Owner == owner {
				a.RevenueYNXT += r.AmountYNXT
			}
		}
		return nil
	})
	return a, err
}

func (s *Service) PrepareAI(actor, videoID, kind string, classes []string) (*AIJob, error) {
	allowed := map[string]bool{"summary": true, "chapters": true, "captions": true, "metadata": true, "search_assistance": true, "moderation_explanation": true}
	if !allowed[kind] {
		return nil, errors.New("unsupported AI workflow")
	}
	var job *AIJob
	err := s.store.update(func(st *State) error {
		v := st.Videos[videoID]
		if v == nil {
			return ErrNotFound
		}
		if v.Owner != actor && kind != "search_assistance" {
			return ErrForbidden
		}
		preview := "title and description"
		for _, c := range classes {
			if c != "metadata" && c != "captions" {
				return errors.New("context class not permitted")
			}
		}
		now := s.cfg.Now().UTC()
		job = &AIJob{ID: id("ai"), Owner: actor, VideoID: videoID, Kind: kind, State: "awaiting_permission", ContextClasses: classes, ContextPreview: preview, EstimatedUnits: 1000, CreatedAt: now}
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
	result, runErr := s.cfg.AI.Generate(ctx, AIRequest{Kind: snapshot.Kind, VideoID: snapshot.VideoID, ContextPreview: snapshot.ContextPreview, ContextClasses: snapshot.ContextClasses})
	err = s.store.update(func(st *State) error {
		j := st.AIJobs[jobID]
		if runErr != nil {
			j.State = "failed"
			j.Failure = runErr.Error()
		} else {
			j.State = "review_required"
			j.Provider = result.Provider
			j.Model = result.Model
			j.Result = result.Text
			j.EstimatedUnits = result.Units
		}
		return nil
	})
	if runErr != nil {
		return nil, runErr
	}
	if err != nil {
		return nil, err
	}
	return s.GetAI(actor, jobID)
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
		j.Applied = apply
		if apply {
			if j.Kind == "metadata" {
				return errors.New("metadata AI output must be copied into a separate human edit; direct apply is disabled")
			}
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
