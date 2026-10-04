package video

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// Disposable software grants and files exercise the original service only.
// This does not establish registered producers, Wallet authorization or codecs.
func TestVideoResumePublishedUnknownOriginal(t *testing.T) {
	for _, phase := range []string{"scanning", "transcoding"} {
		t.Run(phase, func(t *testing.T) {
			s, c := fixture(t, nil)
			calls := 0
			s.cfg.Processor = publicationCountingProcessor{calls: &calls}
			g := videoTestGrant(s, c.Owner, "resume_original_upload_0001", nil)
			g.Current = func(context.Context) error {
				b, e := os.ReadFile(s.store.statePath)
				var st State
				if e == nil && json.Unmarshal(b, &st) == nil {
					for _, v := range st.Videos {
						if v.Status == phase {
							return ErrUnauthorized
						}
					}
				}
				return nil
			}
			_, err := videoLease(t, s, context.Background(), g, false).Upload(context.Background(), c.Owner, c.ID, ownedUploadInput("Resume original", "saved.mp4", "video/mp4", testMP4))
			if !errors.Is(err, ErrVideoStatePublicationUnconfirmed) || calls != 0 {
				t.Fatalf("expected stopped published original: %v calls=%d", err, calls)
			}
			var original *Video
			for _, v := range s.store.state.Videos {
				original = cloneVideo(v)
			}
			if original == nil || original.Status != phase {
				t.Fatal("original interrupted record missing")
			}
			fresh := videoLease(t, s, context.Background(), videoTestGrant(s, c.Owner, "resume_original_processing_0001", nil), false)
			resumed, err := fresh.RetryProcessing(context.Background(), c.Owner, original.ID)
			if err != nil {
				t.Fatal(err)
			}
			if resumed.ID != original.ID || resumed.ObjectKey != original.ObjectKey || resumed.SHA256 != original.SHA256 || resumed.Status != "ready" || calls != 1 || len(s.store.state.Videos) != 1 || len(s.store.state.BusinessNonces) != 2 {
				t.Fatal("resume duplicated or replaced original")
			}
			cold, err := NewService(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			saved := cold.snapshotVideo(original.ID)
			path, err := s.cfg.Objects.Resolve(saved.ObjectKey)
			if err != nil {
				t.Fatal(err)
			}
			b, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(b, testMP4) || saved.Status != "ready" {
				t.Fatalf("cold original changed: %v", err)
			}
		})
	}
}

func TestVideoResumeRefusesChangedOriginalBeforeProcessing(t *testing.T) {
	for _, phase := range []string{"failed", "scanning", "transcoding"} {
		for _, damage := range []string{"missing", "changed"} {
			t.Run(phase+"/"+damage, func(t *testing.T) {
				s, c := fixture(t, nil)
				v := uploadWithoutRights(t, s, c, "Keep original")
				if err := s.setStatus(v.ID, phase, ""); err != nil {
					t.Fatal(err)
				}
				path, err := s.cfg.Objects.Resolve(v.ObjectKey)
				if err != nil {
					t.Fatal(err)
				}
				if damage == "missing" {
					err = os.Remove(path)
				} else {
					err = os.WriteFile(path, []byte("changed source"), 0600)
				}
				if err != nil {
					t.Fatal(err)
				}
				before, err := os.ReadFile(s.store.statePath)
				if err != nil {
					t.Fatal(err)
				}
				derived := filepath.Join(filepath.Dir(path), "stream.m3u8")
				derivedBefore, err := os.ReadFile(derived)
				if err != nil {
					t.Fatal(err)
				}
				scans, calls := 0, 0
				s.cfg.Scanner = uploadRecoveryScanner(func(context.Context, string) error { scans++; return nil })
				s.cfg.Processor = publicationCountingProcessor{calls: &calls}
				if _, err = s.RetryProcessing(context.Background(), c.Owner, v.ID); err == nil {
					t.Fatal("changed original accepted")
				}
				after, err := os.ReadFile(s.store.statePath)
				if err != nil || !bytes.Equal(before, after) || scans != 0 || calls != 0 {
					t.Fatalf("refused original changed state or started work: scans=%d calls=%d err=%v", scans, calls, err)
				}
				derivedAfter, err := os.ReadFile(derived)
				if err != nil || !bytes.Equal(derivedBefore, derivedAfter) {
					t.Fatal("refusal removed retained derivative")
				}
			})
		}
	}
}

func TestVideoResumeQueuedBehindActiveUploadDoesNotRepeatProcessing(t *testing.T) {
	s, c := fixture(t, nil)
	entered, release := make(chan struct{}), make(chan struct{})
	s.cfg.Scanner = uploadRecoveryScanner(func(context.Context, string) error { close(entered); <-release; return nil })
	calls := 0
	s.cfg.Processor = publicationCountingProcessor{calls: &calls}
	uploadDone := make(chan error, 1)
	go func() {
		_, err := s.Upload(context.Background(), c.Owner, c.ID, ownedUploadInput("Active source", "active.mp4", "video/mp4", testMP4))
		uploadDone <- err
	}()
	<-entered
	var original *Video
	if err := s.store.read(func(st State) error {
		for _, v := range st.Videos {
			original = cloneVideo(v)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	retryStarted, retryDone := make(chan struct{}), make(chan error, 1)
	go func() {
		close(retryStarted)
		_, err := s.RetryProcessing(context.Background(), c.Owner, original.ID)
		retryDone <- err
	}()
	<-retryStarted
	close(release)
	if err := <-uploadDone; err != nil {
		t.Fatal(err)
	}
	if err := <-retryDone; err == nil {
		t.Fatal("queued retry repeated completed processing")
	}
	if calls != 1 || s.snapshotVideo(original.ID).Status != "ready" || len(s.store.state.Videos) != 1 {
		t.Fatal("active original duplicated or damaged")
	}
}

func TestVideoResumeRequiresCurrentAuthorizedActor(t *testing.T) {
	for _, phase := range []string{"failed", "scanning", "transcoding"} {
		for _, refusal := range []string{"other-actor", "revoked-current"} {
			t.Run(phase+"/"+refusal, func(t *testing.T) {
				s, c := fixture(t, nil)
				v := uploadWithoutRights(t, s, c, "Owner source")
				if err := s.setStatus(v.ID, phase, ""); err != nil {
					t.Fatal(err)
				}
				before, err := os.ReadFile(s.store.statePath)
				if err != nil {
					t.Fatal(err)
				}
				scans, calls := 0, 0
				s.cfg.Scanner = uploadRecoveryScanner(func(context.Context, string) error { scans++; return nil })
				s.cfg.Processor = publicationCountingProcessor{calls: &calls}
				scoped, actor, expected := s, testAttackerAccount, ErrForbidden
				if refusal == "revoked-current" {
					actor, expected = c.Owner, ErrUnauthorized
					revoked := false
					g := videoTestGrant(s, actor, "resume_refused_current_0001", nil)
					g.Current = func(context.Context) error {
						if revoked {
							return ErrUnauthorized
						}
						return nil
					}
					scoped = videoLease(t, s, context.Background(), g, false)
					revoked = true
				}
				if _, err = scoped.RetryProcessing(context.Background(), actor, v.ID); !errors.Is(err, expected) {
					t.Fatalf("wrong refusal: %v", err)
				}
				after, err := os.ReadFile(s.store.statePath)
				if err != nil || !bytes.Equal(before, after) || scans != 0 || calls != 0 {
					t.Fatal("refused actor changed original or started processing")
				}
			})
		}
	}
}
