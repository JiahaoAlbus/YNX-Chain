package video

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type testScanner struct{ err error }

func (s testScanner) Scan(context.Context, string) error { return s.err }

type testProcessor struct{ err error }

func (p testProcessor) Transcode(_ context.Context, _ string, out string) ([]MediaVariant, error) {
	if p.err != nil {
		return nil, p.err
	}
	if err := os.WriteFile(filepath.Join(out, "stream.m3u8"), []byte("#EXTM3U\n"), 0600); err != nil {
		return nil, err
	}
	return []MediaVariant{{Name: "adaptive-hls", ObjectKey: filepath.Base(out) + "/stream.m3u8", MIME: "application/vnd.apple.mpegurl"}}, nil
}

type testAI struct{ err error }

func (a testAI) Generate(context.Context, AIRequest) (AIResult, error) {
	return AIResult{Provider: "test-provider", Model: "test-model", Text: "review this summary", Units: 7}, a.err
}

type blockingAI struct{ started chan struct{} }

func (a blockingAI) Generate(ctx context.Context, _ AIRequest) (AIResult, error) {
	close(a.started)
	<-ctx.Done()
	return AIResult{}, ctx.Err()
}

type stagedAI struct{ emitted, release chan struct{} }

func (a stagedAI) Generate(context.Context, AIRequest) (AIResult, error) {
	return AIResult{}, errors.New("stream expected")
}
func (a stagedAI) Stream(ctx context.Context, _ AIRequest, emit func(string) error) (AIResult, error) {
	if err := emit("first"); err != nil {
		return AIResult{}, err
	}
	close(a.emitted)
	select {
	case <-a.release:
	case <-ctx.Done():
		return AIResult{}, ctx.Err()
	}
	if err := emit(" second"); err != nil {
		return AIResult{}, err
	}
	return AIResult{Provider: "provider", Model: "model", Text: "first second", Units: 2}, nil
}

type testPay struct{}

var testMP4 = []byte{0, 0, 0, 24, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 't', 'e', 's', 't'}

func (testPay) VerifyReceipt(_ context.Context, id, owner string, amount int64) error {
	if id != "receipt-1" || owner == "" || amount != 5 {
		return errors.New("invalid receipt")
	}
	return nil
}
func (testPay) CreatePayoutIntent(_ context.Context, owner string, amount int64, ref string) (string, error) {
	if owner == "" || amount <= 0 || ref == "" {
		return "", errors.New("invalid payout")
	}
	return "pay-intent-1", nil
}

func fixture(t *testing.T, mutate func(*Config)) (*Service, *Channel) {
	t.Helper()
	now := time.Date(2026, 7, 15, 12, 0, 0, 0, time.UTC)
	cfg := Config{Root: t.TempDir(), IntegrityKey: []byte("test-video-integrity-key-32-bytes!!"), MaxObjectBytes: 64, AccountQuotaBytes: 96, Scanner: testScanner{}, Processor: testProcessor{}, AI: testAI{}, Pay: testPay{}, Now: func() time.Time { return now }, MinMonetizationWatchSeconds: 1, MinMonetizationSubscribers: 1}
	if mutate != nil {
		mutate(&cfg)
	}
	s, err := NewService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.EnsureChannel("ynx1owner", "owner", "Owner channel")
	if err != nil {
		t.Fatal(err)
	}
	return s, c
}
func upload(t *testing.T, s *Service, c *Channel, title string) *Video {
	t.Helper()
	data := testMP4
	v, err := s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: title, Filename: "owned.mp4", ContentType: "video/mp4", Size: int64(len(data)), OwnedDeclaration: true, Reader: bytes.NewReader(data)})
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestUploadPublishMetricsAndRestart(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Test clip")
	if v.Status != "ready" || len(v.Variants) != 2 {
		t.Fatalf("unexpected processing result: %+v", v)
	}
	if err := s.Publish(c.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordWatch("ynx1viewer", v.ID, 12, true); err != nil {
		t.Fatal(err)
	}
	if err := s.Subscribe("ynx1viewer", c.ID); err != nil {
		t.Fatal(err)
	}
	a, err := s.Analytics(c.Owner)
	if err != nil || a.Views != 1 || a.WatchSeconds != 12 || a.Subscribers != 1 || a.RevenueYNXT != 0 {
		t.Fatalf("metrics must derive from events: %+v %v", a, err)
	}
	s2, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	found, err := s2.Search("", "")
	if err != nil || len(found) != 1 {
		t.Fatalf("restart lost state: %v %+v", err, found)
	}
}
func TestBoundsAuthorizationAndFailClosedProcessing(t *testing.T) {
	s, c := fixture(t, nil)
	_, err := s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: "x", Filename: "x.mov", ContentType: "video/quicktime", Size: 2, OwnedDeclaration: true, Reader: bytes.NewReader([]byte("xx"))})
	if err == nil {
		t.Fatal("unsupported type accepted")
	}
	_, err = s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: "x", Filename: "x.mp4", ContentType: "video/mp4", Size: 2, Reader: bytes.NewReader([]byte("xx"))})
	if err == nil {
		t.Fatal("missing rights declaration accepted")
	}
	_, err = s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: "spoofed", Filename: "x.mp4", ContentType: "video/mp4", Size: 12, OwnedDeclaration: true, Reader: bytes.NewReader([]byte("not-an-mp4!"))})
	if err == nil {
		t.Fatal("spoofed MIME accepted")
	}
	v := upload(t, s, c, "Owned")
	if err = s.Publish("ynx1attacker", v.ID, VisibilityPublic); !errors.Is(err, ErrForbidden) {
		t.Fatalf("authorization not enforced: %v", err)
	}
	s3, c3 := fixture(t, func(cfg *Config) { cfg.Scanner = testScanner{err: errors.New("malware signature")} })
	v3, err := s3.Upload(context.Background(), c3.Owner, c3.ID, UploadInput{Title: "bad", Filename: "bad.mp4", ContentType: "video/mp4", Size: int64(len(testMP4)), OwnedDeclaration: true, Reader: bytes.NewReader(testMP4)})
	if err == nil || v3.Status != "failed" {
		t.Fatalf("scan failure did not fail closed: %+v %v", v3, err)
	}
}

func TestViewerPrivacyDeletionKeepsMinimalAudit(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Privacy")
	if err := s.Publish(c.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	viewer := "ynx1viewer"
	if err := s.RecordWatch(viewer, v.ID, 3, false); err != nil {
		t.Fatal(err)
	}
	if err := s.Subscribe(viewer, c.ID); err != nil {
		t.Fatal(err)
	}
	p, err := s.CreatePlaylist(viewer, "Private list")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.AddToPlaylist(viewer, p.ID, v.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AddComment(viewer, v.ID, "remove me"); err != nil {
		t.Fatal(err)
	}
	counts, err := s.DeleteViewerData(viewer)
	if err != nil || counts["history"] != 1 || counts["subscriptions"] != 1 || counts["playlists"] != 1 || counts["comments"] != 1 {
		t.Fatalf("privacy counts=%v err=%v", counts, err)
	}
	if history, _ := s.History(viewer); len(history) != 0 {
		t.Fatal("history retained")
	}
	if subscriptions, _ := s.Subscriptions(viewer); len(subscriptions) != 0 {
		t.Fatal("subscription retained")
	}
	if comments, _ := s.Comments(viewer, v.ID); len(comments) != 0 {
		t.Fatal("deleted comment visible")
	}
	if err = s.store.read(func(st State) error {
		last := st.Audit[len(st.Audit)-1]
		if last.Action != "privacy.viewer_data.delete" || last.Actor != viewer {
			t.Fatalf("minimal deletion audit missing: %+v", last)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestDerivedMediaCannotEscapeAccountQuota(t *testing.T) {
	s, c := fixture(t, func(cfg *Config) { cfg.AccountQuotaBytes = int64(len(testMP4)) + 4 })
	v, err := s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: "quota", Filename: "owned.mp4", ContentType: "video/mp4", Size: int64(len(testMP4)), OwnedDeclaration: true, Reader: bytes.NewReader(testMP4)})
	if !errors.Is(err, ErrQuota) || v.Status != "failed" {
		t.Fatalf("derived output escaped quota: %+v %v", v, err)
	}
	used, err := s.usageForOwner(c.Owner)
	if err != nil || used > s.cfg.AccountQuotaBytes {
		t.Fatalf("failed cleanup left quota exceeded: %d %v", used, err)
	}
}

func TestMetadataAssetsRetryStudioAndAICancel(t *testing.T) {
	s, c := fixture(t, func(cfg *Config) { cfg.Processor = testProcessor{err: errors.New("worker offline")} })
	v, err := s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: "Recover", Filename: "owned.mp4", ContentType: "video/mp4", Size: int64(len(testMP4)), OwnedDeclaration: true, Reader: bytes.NewReader(testMP4)})
	if err == nil || v.Status != "failed" {
		t.Fatalf("processing failure not persisted: %+v %v", v, err)
	}
	s.cfg.Processor = testProcessor{}
	v, err = s.RetryProcessing(context.Background(), c.Owner, v.ID)
	if err != nil || v.Status != "ready" {
		t.Fatalf("retry failed: %+v %v", v, err)
	}
	if err = s.UpdateMetadata(c.Owner, v.ID, "Recovered title", "Reviewed description"); err != nil {
		t.Fatal(err)
	}
	vtt := []byte("WEBVTT\n\n00:00.000 --> 00:01.000\nYNX\n")
	if _, err = s.AddCaptions(c.Owner, v.ID, "en", "English", false, bytes.NewReader(vtt), int64(len(vtt))); err != nil {
		t.Fatal(err)
	}
	png := append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 24)...)
	if err = s.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(png), int64(len(png))); err != nil {
		t.Fatal(err)
	}
	snap, err := s.Studio(c.Owner)
	if err != nil || len(snap.Videos) != 1 || snap.Videos[0].Title != "Recovered title" || len(snap.Videos[0].Captions) != 1 || snap.Videos[0].ThumbnailKey == "" {
		t.Fatalf("studio snapshot incomplete: %+v %v", snap, err)
	}
	started := make(chan struct{})
	s.cfg.AI = blockingAI{started: started}
	job, err := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, e := s.RunAI(context.Background(), c.Owner, job.ID); done <- e }()
	<-started
	cancelled, err := s.CancelAI(c.Owner, job.ID)
	if err != nil || cancelled.State != "cancelled" {
		t.Fatalf("cancel failed: %+v %v", cancelled, err)
	}
	if err = <-done; err != nil {
		t.Fatalf("cancelled run returned error: %v", err)
	}
}

func TestAIStreamingPersistsBoundedPartialThenRequiresReview(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Streamed AI")
	emitted, release := make(chan struct{}), make(chan struct{})
	s.cfg.AI = stagedAI{emitted: emitted, release: release}
	job, err := s.PrepareAI(c.Owner, v.ID, "chapters", []string{"metadata"})
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, e := s.RunAI(context.Background(), c.Owner, job.ID); done <- e }()
	<-emitted
	partial, err := s.GetAI(c.Owner, job.ID)
	if err != nil || partial.State != "running" || partial.Partial != "first" {
		t.Fatalf("partial not persisted: %+v %v", partial, err)
	}
	close(release)
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	final, err := s.GetAI(c.Owner, job.ID)
	if err != nil || final.State != "review_required" || final.Result != "first second" || final.Partial != "" {
		t.Fatalf("final stream boundary wrong: %+v %v", final, err)
	}
	if err = s.DeleteAI(c.Owner, job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.GetAI(c.Owner, job.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AI deletion failed: %v", err)
	}
}
func TestModerationAppealAIAndRevenueRequireHumanBoundaries(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Workflow")
	if err := s.Publish(c.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordWatch("viewer", v.ID, 3, true); err != nil {
		t.Fatal(err)
	}
	var watchID string
	_ = s.store.read(func(st State) error {
		for id := range st.WatchEvents {
			watchID = id
		}
		return nil
	})
	if err := s.Subscribe("viewer", c.ID); err != nil {
		t.Fatal(err)
	}
	r, err := s.Report("viewer", v.ID, "safety", "review this")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ModerateReport("moderator", r.ID, "takedown", "policy explanation"); err != nil {
		t.Fatal(err)
	}
	appeal, err := s.Appeal(c.Owner, r.ID, "context and evidence")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ReviewAppeal("moderator", appeal.ID, true, "evidence accepted"); err != nil {
		t.Fatal(err)
	}
	if err = s.Publish(c.Owner, v.ID, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	m, err := s.RequestMonetization(c.Owner, v.ID)
	if err != nil || m.State != "pending_review" {
		t.Fatalf("eligibility must await review: %+v %v", m, err)
	}
	if err = s.ReviewMonetization("moderator", v.ID, true, "verified evidence"); err != nil {
		t.Fatal(err)
	}
	rec, err := s.RecordRevenue(context.Background(), "moderator", v.ID, "receipt-1", 5, []string{watchID})
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.CreatePayoutIntent(context.Background(), c.Owner, 5)
	if err != nil || p.State != "awaiting_wallet_confirmation" {
		t.Fatalf("payout intent not bounded: %+v %v", p, err)
	}
	job, err := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if err != nil || job.State != "awaiting_permission" {
		t.Fatal(err)
	}
	job, err = s.RunAI(context.Background(), c.Owner, job.ID)
	if err != nil || job.State != "review_required" {
		t.Fatalf("AI bypassed review: %+v %v", job, err)
	}
	job, err = s.ReviewAI(c.Owner, job.ID, true)
	if err != nil || job.State != "accepted_suggestion" {
		t.Fatal(err)
	}
	if _, err = s.DisputeRevenue(c.Owner, rec.ID, "amount evidence mismatch"); err != nil {
		t.Fatal(err)
	}
}
func TestRestartMarksInterruptedWorkRecoverable(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Interrupted")
	if err := s.store.update(func(st *State) error { st.Videos[v.ID].Status = "transcoding"; return nil }); err != nil {
		t.Fatal(err)
	}
	s2, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	found, err := s2.Search(c.Owner, "")
	if err != nil || len(found) != 1 || found[0].Status != "failed" || found[0].Failure == "" {
		t.Fatalf("interrupted state not recovered: %+v %v", found, err)
	}
}

func TestRepositoryOwnedMediaTranscodesWithFFmpeg(t *testing.T) {
	if _, err := os.Stat("/opt/homebrew/bin/ffmpeg"); err != nil {
		t.Skip("FFmpeg is not installed at the integration-test path")
	}
	data, err := os.ReadFile("testdata/ynx-owned-test.mp4")
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewService(Config{Root: t.TempDir(), IntegrityKey: []byte("test-video-integrity-key-32-bytes!!"), MaxObjectBytes: 1 << 20, AccountQuotaBytes: 2 << 20, Scanner: testScanner{}, Processor: FFmpegProcessor{FFmpeg: "/opt/homebrew/bin/ffmpeg"}})
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.EnsureChannel("ynx1owner", "ffmpeg-test", "FFmpeg test")
	if err != nil {
		t.Fatal(err)
	}
	v, err := s.Upload(context.Background(), c.Owner, c.ID, UploadInput{Title: "Repository-owned generated clip", Filename: "ynx-owned-test.mp4", ContentType: "video/mp4", Size: int64(len(data)), OwnedDeclaration: true, Reader: bytes.NewReader(data)})
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Variants) != 2 || v.Variants[0].MIME != "application/vnd.apple.mpegurl" || v.Variants[1].MIME != "video/mp4" {
		t.Fatalf("adaptive output missing: %+v", v.Variants)
	}
	if _, err = os.Stat(filepath.Join(s.cfg.Root, "objects", v.ID, "stream.m3u8")); err != nil {
		t.Fatal(err)
	}
}
