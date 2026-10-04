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

// Software Current callbacks observe actual disposable writer artifacts only;
// these are not registered producers, Wallet grants or installed storage tests.
func TestVideoStorePublicationCurrentBoundary(t *testing.T) {
	for _, phase := range []string{"before-publish", "after-publish"} {
		t.Run(phase, func(t *testing.T) {
			s, _ := fixture(t, nil)
			if _, err := s.CreatePlaylist("ynx1owner", "Retained"); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(s.store.statePath)
			if err != nil {
				t.Fatal(err)
			}
			observed := false
			g := videoTestGrant(s, "ynx1owner", "publication_nonce_000001", nil)
			g.Current = func(context.Context) error {
				if phase == "before-publish" {
					if info, e := os.Stat(s.store.statePath + ".tmp"); e == nil && info.Size() > 0 {
						observed = true
						return ErrUnauthorized
					}
				}
				if phase == "after-publish" {
					if b, e := os.ReadFile(s.store.statePath); e == nil && !bytes.Equal(b, before) {
						observed = true
						return ErrUnauthorized
					}
				}
				return nil
			}
			scoped := videoLease(t, s, context.Background(), g, false)
			_, err = scoped.CreatePlaylist(g.Actor, "Pending original")
			if err == nil || !observed {
				t.Fatalf("actual %s writer boundary did not reject: observed=%v err=%v", phase, observed, err)
			}
			disk, e := os.ReadFile(s.store.statePath)
			if e != nil {
				t.Fatal(e)
			}
			recovered, e := NewService(s.cfg)
			if e != nil {
				t.Fatal(e)
			}
			if phase == "after-publish" && !errors.Is(err, ErrVideoStatePublicationUnconfirmed) {
				t.Fatalf("published failure was not UNKNOWN: %v", err)
			}
			if phase == "before-publish" {
				if !bytes.Equal(before, disk) || scoped.store.business.consumed.Load() || len(s.store.state.BusinessNonces) != 0 || len(recovered.store.state.Playlists) != 1 {
					t.Fatal("unpublished candidate consumed nonce or changed original disk/state")
				}
				if _, e = os.Stat(s.store.statePath + ".tmp"); !os.IsNotExist(e) {
					t.Fatal("refused staged writer was not cleaned")
				}
			} else {
				if bytes.Equal(before, disk) || !scoped.store.business.consumed.Load() || len(s.store.state.Playlists) != 2 || len(recovered.store.state.Playlists) != 2 || len(s.store.state.BusinessNonces) != 1 {
					t.Fatal("published unknown rolled back memory/disk or nonce")
				}
				replay := videoLease(t, recovered, context.Background(), videoTestGrant(recovered, g.Actor, g.Nonce, nil), false)
				if _, e = replay.CreatePlaylist(g.Actor, "Duplicate"); e == nil {
					t.Fatal("published unknown request replayed")
				}
			}
		})
	}
}

func TestVideoPublishedUnknownRetainsMedia(t *testing.T) {
	for _, kind := range []string{"caption", "thumbnail"} {
		t.Run(kind, func(t *testing.T) {
			s, c := fixture(t, nil)
			v := uploadWithoutRights(t, s, c, "Publication source")
			before, _ := os.ReadFile(s.store.statePath)
			g := videoTestGrant(s, c.Owner, "media_publication_nonce_0001", nil)
			g.Current = func(context.Context) error {
				b, e := os.ReadFile(s.store.statePath)
				if e == nil && !bytes.Equal(b, before) {
					return ErrUnauthorized
				}
				return nil
			}
			scoped := videoLease(t, s, context.Background(), g, false)
			var err error
			if kind == "caption" {
				b := []byte("WEBVTT\n\n00:00.000 --> 00:01.000\nOriginal\n")
				_, err = scoped.AddCaptions(c.Owner, v.ID, "en", "Original", false, bytes.NewReader(b), int64(len(b)))
			} else {
				b := auditPNG()
				err = scoped.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(b), int64(len(b)))
			}
			if !errors.Is(err, ErrVideoStatePublicationUnconfirmed) {
				t.Fatalf("missing published UNKNOWN: %v", err)
			}
			recovered, e := NewService(s.cfg)
			if e != nil {
				t.Fatal(e)
			}
			saved := recovered.store.state.Videos[v.ID]
			key := saved.ThumbnailKey
			if kind == "caption" {
				if len(saved.Captions) != 1 {
					t.Fatal("lost original caption")
				}
				key = saved.Captions[0].ObjectKey
			}
			path, e := s.cfg.Objects.Resolve(key)
			if e != nil {
				t.Fatal(e)
			}
			if _, e = os.Stat(path); e != nil {
				t.Fatalf("published metadata lost original media %s: %v", kind, e)
			}
		})
	}
}

type publicationCountingProcessor struct {
	testProcessor
	calls *int
}

func (p publicationCountingProcessor) Transcode(c context.Context, in, out string) ([]MediaVariant, error) {
	*p.calls++
	return p.testProcessor.Transcode(c, in, out)
}
func TestVideoPublishedUnknownStopsProcessing(t *testing.T) {
	s, c := fixture(t, nil)
	v := uploadWithoutRights(t, s, c, "Original processing")
	s.setStatus(v.ID, "failed", "retry fixture")
	before := storedAssetFiles(t, s, v.ID)
	calls := 0
	s.cfg.Processor = publicationCountingProcessor{calls: &calls}
	g := videoTestGrant(s, c.Owner, "processing_publication_nonce_001", nil)
	g.Current = func(context.Context) error {
		b, e := os.ReadFile(s.store.statePath)
		var st State
		if e == nil && json.Unmarshal(b, &st) == nil && st.Videos[v.ID].Status == "transcoding" {
			return ErrUnauthorized
		}
		return nil
	}
	_, err := videoLease(t, s, context.Background(), g, false).RetryProcessing(context.Background(), c.Owner, v.ID)
	if !errors.Is(err, ErrVideoStatePublicationUnconfirmed) || calls != 0 {
		t.Fatalf("unconfirmed status continued processing: calls=%d err=%v", calls, err)
	}
	after := storedAssetFiles(t, s, v.ID)
	for name, body := range before {
		if after[name] != body {
			t.Fatalf("unconfirmed processing changed original asset %s", name)
		}
	}
}

func TestVideoFirstUploadPublicationRetainsOriginal(t *testing.T) {
	for _, phase := range []string{"before-publish", "after-publish"} {
		t.Run(phase, func(t *testing.T) {
			s, c := fixture(t, nil)
			old := uploadWithoutRights(t, s, c, "Retained source")
			originalFiles := storedAssetFiles(t, s, old.ID)
			scans, processing := 0, 0
			s.cfg.Scanner = uploadRecoveryScanner(func(context.Context, string) error { scans++; return nil })
			s.cfg.Processor = publicationCountingProcessor{calls: &processing}
			g := videoTestGrant(s, c.Owner, "first_upload_publication_0001", nil)
			g.Current = func(context.Context) error {
				if phase == "before-publish" {
					if i, e := os.Stat(s.store.statePath + ".tmp"); e == nil && i.Size() > 0 {
						return ErrUnauthorized
					}
				}
				if phase == "after-publish" {
					b, e := os.ReadFile(s.store.statePath)
					var st State
					if e == nil && json.Unmarshal(b, &st) == nil && len(st.Videos) > 1 {
						return ErrUnauthorized
					}
				}
				return nil
			}
			scoped := videoLease(t, s, context.Background(), g, false)
			_, err := scoped.Upload(context.Background(), c.Owner, c.ID, ownedUploadInput("Unknown original", "original.mp4", "video/mp4", testMP4))
			if err == nil || scans != 0 || processing != 0 {
				t.Fatalf("unconfirmed upload continued work: scans=%d processing=%d err=%v", scans, processing, err)
			}
			for name, body := range originalFiles {
				if storedAssetFiles(t, s, old.ID)[name] != body {
					t.Fatalf("changed pre-existing media %s", name)
				}
			}
			dirs, e := os.ReadDir(filepath.Join(s.cfg.Root, "objects"))
			if e != nil {
				t.Fatal(e)
			}
			if phase == "before-publish" {
				if !errors.Is(err, ErrUnauthorized) || len(s.store.state.Videos) != 1 || len(dirs) != 1 || scoped.store.business.consumed.Load() {
					t.Fatal("unpublished upload retained staged data or consumed nonce")
				}
			} else {
				if !errors.Is(err, ErrVideoStatePublicationUnconfirmed) || len(s.store.state.Videos) != 2 || !scoped.store.business.consumed.Load() {
					t.Fatal("published upload lost original state/nonce")
				}
				recovered, e := NewService(s.cfg)
				if e != nil {
					t.Fatal(e)
				}
				for id, v := range recovered.store.state.Videos {
					if id != old.ID {
						path, e := s.cfg.Objects.Resolve(v.ObjectKey)
						if e != nil {
							t.Fatal(e)
						}
						b, e := os.ReadFile(path)
						if e != nil || !bytes.Equal(b, testMP4) {
							t.Fatalf("published first upload source was removed: %v", e)
						}
					}
				}
				replay := videoLease(t, recovered, context.Background(), videoTestGrant(recovered, g.Actor, g.Nonce, nil), false)
				if _, e = replay.Upload(context.Background(), c.Owner, c.ID, ownedUploadInput("Duplicate", "duplicate.mp4", "video/mp4", testMP4)); e == nil {
					t.Fatal("published first upload nonce replayed")
				}
			}
		})
	}
}
