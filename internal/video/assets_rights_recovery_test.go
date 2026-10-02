package video

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

type revokeWhileReadingAsset struct {
	reader  io.Reader
	revoke  func()
	revoked bool
}

func (r *revokeWhileReadingAsset) Read(p []byte) (int, error) {
	if !r.revoked {
		r.revoked = true
		r.revoke()
	}
	return r.reader.Read(p)
}
func auditPNG() []byte {
	return append([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, make([]byte, 24)...)
}

type interruptedAssetReader struct{}

func (interruptedAssetReader) Read([]byte) (int, error) {
	return 0, errors.New("asset read interrupted")
}

func storedAssetFiles(t *testing.T, s *Service, videoID string) map[string]string {
	t.Helper()
	dir, err := s.cfg.Objects.Resolve(videoID)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string]string{}
	for _, entry := range entries {
		body, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		files[entry.Name()] = string(body)
	}
	return files
}

func TestAssetFailurePreservesExistingThumbnail(t *testing.T) {
	for _, mode := range []string{"invalid-type", "short-read", "long-read", "read-error"} {
		t.Run(mode, func(t *testing.T) {
			s, c := fixture(t, nil)
			v := uploadWithoutRights(t, s, c, "Thumbnail source")
			original := auditPNG()
			if err := s.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(original), int64(len(original))); err != nil {
				t.Fatal(err)
			}
			saved, _ := s.Video(c.Owner, v.ID)
			before := storedAssetFiles(t, s, v.ID)
			var reader io.Reader = bytes.NewReader(bytes.Repeat([]byte{'x'}, 32))
			switch mode {
			case "short-read":
				reader = bytes.NewReader(original[:12])
			case "long-read":
				reader = bytes.NewReader(append(original, 'x'))
			case "read-error":
				reader = io.MultiReader(bytes.NewReader(original[:12]), interruptedAssetReader{})
			}
			if err := s.SetThumbnail(c.Owner, v.ID, "image/png", reader, 32); err == nil {
				t.Fatal("invalid thumbnail unexpectedly accepted")
			}
			if after := storedAssetFiles(t, s, v.ID); !reflect.DeepEqual(before, after) {
				t.Fatalf("failed replacement changed stored assets: before=%v after=%v", before, after)
			}
			current, err := s.Video(c.Owner, v.ID)
			if err != nil || current.ThumbnailKey != saved.ThumbnailKey {
				t.Fatalf("failed replacement changed the committed thumbnail: %+v %v", current, err)
			}
		})
	}
}

func TestAssetCommitRejectsRoleRevokedDuringIO(t *testing.T) {
	for _, kind := range []string{"captions", "thumbnail"} {
		t.Run(kind, func(t *testing.T) {
			s, c := fixture(t, nil)
			v := uploadWithoutRights(t, s, c, "Revocation source")
			acceptRole(t, s, c.Owner, c.ID, testEditorAccount, CreatorRoleUploader)
			before := storedAssetFiles(t, s, v.ID)
			data := auditPNG()
			if kind == "captions" {
				data = []byte("WEBVTT\n\n00:00.000 --> 00:01.000\nCaption\n")
			}
			reader := &revokeWhileReadingAsset{reader: bytes.NewReader(data), revoke: func() {
				if err := s.RevokeTeamMember(c.Owner, c.ID, testEditorAccount); err != nil {
					t.Fatal(err)
				}
			}}
			var err error
			if kind == "captions" {
				_, err = s.AddCaptions(testEditorAccount, v.ID, "en", "English", false, reader, int64(len(data)))
			} else {
				err = s.SetThumbnail(testEditorAccount, v.ID, "image/png", reader, int64(len(data)))
			}
			if !errors.Is(err, ErrForbidden) {
				t.Fatalf("revoked uploader committed %s after I/O: %v", kind, err)
			}
			if after := storedAssetFiles(t, s, v.ID); !reflect.DeepEqual(before, after) {
				t.Fatalf("revoked upload left uncommitted assets: before=%v after=%v", before, after)
			}
			current, err := s.Video(c.Owner, v.ID)
			if err != nil || current.ThumbnailKey != "" || len(current.Captions) != 0 {
				t.Fatalf("revoked upload changed committed metadata: %+v %v", current, err)
			}
		})
	}
}

func TestAssetStatePersistenceFailureCleansOnlyNewObjects(t *testing.T) {
	for _, kind := range []string{"captions", "thumbnail"} {
		t.Run(kind, func(t *testing.T) {
			s, c := fixture(t, func(cfg *Config) { cfg.AccountQuotaBytes = 512 })
			v := uploadWithoutRights(t, s, c, "Persisted source")
			png := auditPNG()
			if err := s.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(png), int64(len(png))); err != nil {
				t.Fatal(err)
			}
			before := storedAssetFiles(t, s, v.ID)
			stateBefore, err := os.ReadFile(s.store.statePath)
			if err != nil {
				t.Fatal(err)
			}
			// A directory at the store's staging-file path forces a real failed
			// state write without replacing or deleting the prior state file.
			if err := os.Mkdir(s.store.statePath+".tmp", 0700); err != nil {
				t.Fatal(err)
			}
			if kind == "captions" {
				data := []byte("WEBVTT\n\n00:00.000 --> 00:01.000\nCaption\n")
				track, writeErr := s.AddCaptions(c.Owner, v.ID, "en", "English", false, bytes.NewReader(data), int64(len(data)))
				err = writeErr
				if track != nil {
					t.Fatal("failed persistence returned an uncommitted caption")
				}
			} else {
				err = s.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(png), int64(len(png)))
			}
			if err == nil {
				t.Fatal("asset write succeeded with unavailable state persistence")
			}
			if err := os.Remove(s.store.statePath + ".tmp"); err != nil {
				t.Fatal(err)
			}
			if after := storedAssetFiles(t, s, v.ID); !reflect.DeepEqual(before, after) {
				t.Fatalf("failed state write damaged retained assets: before=%v after=%v", before, after)
			}
			stateAfter, err := os.ReadFile(s.store.statePath)
			if err != nil || !bytes.Equal(stateBefore, stateAfter) {
				t.Fatalf("failed state write changed prior persisted state: %v", err)
			}
			if _, err := NewService(s.cfg); err != nil {
				t.Fatalf("preserved state could not reopen: %v", err)
			}
		})
	}
}

func TestSuccessfulThumbnailReplacementRetainsPriorObject(t *testing.T) {
	s, c := fixture(t, nil)
	v := uploadWithoutRights(t, s, c, "Replacement source")
	png := auditPNG()
	if err := s.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(png), int64(len(png))); err != nil {
		t.Fatal(err)
	}
	first, _ := s.Video(c.Owner, v.ID)
	png[31] = 1
	if err := s.SetThumbnail(c.Owner, v.ID, "image/png", bytes.NewReader(png), int64(len(png))); err != nil {
		t.Fatal(err)
	}
	second, _ := s.Video(c.Owner, v.ID)
	if first.ThumbnailKey == second.ThumbnailKey {
		t.Fatal("successful replacement reused the old object key")
	}
	oldPath, _ := s.cfg.Objects.Resolve(first.ThumbnailKey)
	old, err := os.ReadFile(oldPath)
	if err != nil || !bytes.Equal(old, auditPNG()) {
		t.Fatalf("successful replacement changed the previous object: %x %v", old, err)
	}
	restarted, err := NewService(s.cfg)
	if err != nil {
		t.Fatal(err)
	}
	current, err := restarted.Video(c.Owner, v.ID)
	if err != nil || current.ThumbnailKey != second.ThumbnailKey {
		t.Fatalf("new thumbnail reference did not survive restart: %+v %v", current, err)
	}
}

func TestUploadRightsExpiryGuardsEveryPublicationPath(t *testing.T) {
	for _, mode := range []string{"audience", "unlisted-audience", "schedule", "due"} {
		t.Run(mode, func(t *testing.T) {
			now := time.Date(2026, 10, 3, 0, 0, 0, 0, time.UTC)
			s, c := fixture(t, func(cfg *Config) { cfg.Now = func() time.Time { return now } })
			expiry := now.Add(time.Hour)
			in := ownedUploadInput("Expiring source", "owned.mp4", "video/mp4", testMP4)
			in.RightsExpiresAt = &expiry
			v, err := s.Upload(context.Background(), c.Owner, c.ID, in)
			if err != nil {
				t.Fatal(err)
			}
			declareTestRights(t, s, c.Owner, v)
			approveTestPublication(t, s, c.Owner, v.ID)
			switch mode {
			case "audience", "unlisted-audience":
				visibility := VisibilityPublic
				if mode == "unlisted-audience" {
					visibility = VisibilityUnlisted
				}
				if err = s.Publish(c.Owner, v.ID, visibility); err != nil {
					t.Fatal(err)
				}
				if _, err = s.MediaPath("", v.ObjectKey); err != nil {
					t.Fatalf("unexpired source was not available: %v", err)
				}
				now = expiry
				if _, err = s.Video("", v.ID); !errors.Is(err, ErrForbidden) {
					t.Fatalf("public metadata remains readable after original upload rights expiry: %v", err)
				}
				if _, err = s.MediaPath("", v.ObjectKey); !errors.Is(err, ErrForbidden) {
					t.Fatalf("public source remains readable after original upload rights expiry: %v", err)
				}
				results, err := s.Search("", "")
				if err != nil || len(results) != 0 {
					t.Fatalf("expired source remains discoverable: %+v %v", results, err)
				}
				if _, err = s.Video(c.Owner, v.ID); err != nil {
					t.Fatalf("rights expiry removed the owner's workspace access: %v", err)
				}
				if _, err = s.MediaPath(c.Owner, v.ObjectKey); err != nil {
					t.Fatalf("rights expiry removed the owned original: %v", err)
				}
				restarted, err := NewService(s.cfg)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = restarted.MediaPath("", v.ObjectKey); !errors.Is(err, ErrForbidden) {
					t.Fatalf("restart restored expired public rights: %v", err)
				}
			case "schedule":
				if _, err = s.SchedulePublication(c.Owner, v.ID, VisibilityPublic, now.Add(2*time.Hour)); err == nil {
					t.Fatal("scheduled beyond original upload rights expiry")
				}
			case "due":
				if _, err = s.SchedulePublication(c.Owner, v.ID, VisibilityPublic, now.Add(30*time.Minute)); err != nil {
					t.Fatal(err)
				}
				now = now.Add(2 * time.Hour)
				if _, err = s.PublishDue(c.Owner, v.ID); err == nil {
					t.Fatal("published due after original upload rights expiry")
				}
			}
		})
	}
}
