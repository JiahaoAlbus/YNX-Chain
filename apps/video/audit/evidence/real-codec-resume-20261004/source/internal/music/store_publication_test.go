package music

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// Original local state writer and software Current only; no real grant/provider.
func TestMusicStorePublicationCurrentBoundary(t *testing.T) {
	for _, phase := range []string{"before-publish", "after-publish"} {
		t.Run(phase, func(t *testing.T) {
			s := testService(t)
			actor := testAccount(t, 1)
			if _, err := s.UpsertProfile(actor, Profile{DisplayName: "Retained"}); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(s.cfg.StatePath)
			if err != nil {
				t.Fatal(err)
			}
			observed := false
			lease := testBusinessLease(actor, "publication_nonce_000001", s.cfg.Now)
			lease.grant.Current = func(context.Context) error {
				if phase == "before-publish" {
					names, _ := filepath.Glob(filepath.Join(filepath.Dir(s.cfg.StatePath), ".music-state-*"))
					for _, name := range names {
						if i, e := os.Stat(name); e == nil && i.Size() > 0 {
							observed = true
							return ErrUnauthorized
						}
					}
				}
				if phase == "after-publish" {
					if b, e := os.ReadFile(s.cfg.StatePath); e == nil && !bytes.Equal(b, before) {
						observed = true
						return ErrUnauthorized
					}
				}
				return nil
			}
			scoped := s.requestService(lease)
			_, err = scoped.UpsertProfile(actor, Profile{DisplayName: "Pending original"})
			if err == nil || !observed {
				t.Fatalf("actual %s writer boundary did not reject: observed=%v err=%v", phase, observed, err)
			}
			disk, e := os.ReadFile(s.cfg.StatePath)
			if e != nil {
				t.Fatal(e)
			}
			recovered, e := New(s.cfg)
			if e != nil {
				t.Fatal(e)
			}
			if phase == "after-publish" && !errors.Is(err, ErrMusicStatePublicationUnconfirmed) {
				t.Fatalf("published failure was not UNKNOWN: %v", err)
			}
			if phase == "before-publish" {
				if !bytes.Equal(before, disk) || lease.consumed || len(s.state.BusinessNonces) != 0 || s.state.Profiles[actor].DisplayName != "Retained" || recovered.state.Profiles[actor].DisplayName != "Retained" {
					t.Fatal("unpublished candidate changed original state/nonce")
				}
				names, _ := filepath.Glob(filepath.Join(filepath.Dir(s.cfg.StatePath), ".music-state-*"))
				if len(names) != 0 {
					t.Fatal("refused staged writer was not cleaned")
				}
			} else {
				if bytes.Equal(before, disk) || !lease.consumed || len(s.state.BusinessNonces) != 1 || s.state.Profiles[actor].DisplayName != "Pending original" || recovered.state.Profiles[actor].DisplayName != "Pending original" {
					t.Fatal("published unknown rolled back memory/disk or nonce")
				}
				replay := recovered.requestService(testBusinessLease(actor, lease.grant.Nonce, recovered.cfg.Now))
				if _, e = replay.UpsertProfile(actor, Profile{DisplayName: "Duplicate"}); e == nil {
					t.Fatal("published unknown request replayed")
				}
			}
		})
	}
}

func TestMusicPublishedUnknownRetainsMedia(t *testing.T) {
	s := testService(t)
	actor := testAccount(t, 1)
	if _, err := s.UpsertProfile(actor, Profile{DisplayName: "Original"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.OnboardCreator(actor, "Original", "Original source"); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(s.cfg.StatePath)
	lease := testBusinessLease(actor, "media_publication_nonce_0001", s.cfg.Now)
	lease.grant.Current = func(context.Context) error {
		b, e := os.ReadFile(s.cfg.StatePath)
		if e == nil && !bytes.Equal(b, before) {
			return ErrUnauthorized
		}
		return nil
	}
	req := TrackUpload{RequestKey: "original_upload_001", Title: "Original", ArtistName: "Original", Audio: Upload{Reader: bytes.NewReader(toneWAV(1000))}, AudioProvenance: "generated QA tone", RightsBasis: "owned", Territories: []string{"TEST"}, EvidenceRef: "QA original"}
	_, err := s.requestService(lease).UploadTrack(actor, req)
	if !errors.Is(err, ErrMusicStatePublicationUnconfirmed) {
		t.Fatalf("missing published UNKNOWN: %v", err)
	}
	if len(s.state.Tracks) != 1 {
		t.Fatal("published original metadata lost")
	}
	recovered, e := New(s.cfg)
	if e != nil {
		t.Fatalf("published original media was cleaned: %v", e)
	}
	if len(recovered.state.Tracks) != 1 || !lease.consumed {
		t.Fatal("original track/nonce not retained")
	}
}
