package video

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type uploadRecoveryProbe struct{ testProcessor }

func (uploadRecoveryProbe) Probe(context.Context, string) (MediaProbe, error) {
	return MediaProbe{}, errors.New("probe unavailable")
}

type uploadRecoveryScanner func(context.Context, string) error

func (scan uploadRecoveryScanner) Scan(ctx context.Context, path string) error {
	return scan(ctx, path)
}

func recoveryUploadBody(t *testing.T, channelID string) ([]byte, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	digest := sha256.Sum256(testMP4)
	for key, value := range map[string]string{
		"channel_id": channelID, "size": fmt.Sprint(len(testMP4)), "sha256": hex.EncodeToString(digest[:]),
		"title": "Recover this source", "owned_content_declaration": "true", "rights_basis": "owned",
		"rights_source": "owned test fixture", "rights_license": "owner-controlled", "rights_territories": "WORLDWIDE",
	} {
		if err := writer.WriteField(key, value); err != nil {
			t.Fatal(err)
		}
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="media"; filename="owned.mp4"`)
	header.Set("Content-Type", "video/mp4")
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(testMP4); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	return body.Bytes(), writer.FormDataContentType()
}

func recoveryRequest(handler http.Handler, path, key, contentType string, body []byte) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	r.Header.Set("Authorization", "Bearer actor-token")
	r.Header.Set("Idempotency-Key", key)
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestUploadFailureReturnsAuthorizedPersistedRecovery(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*Config)
		status int
	}{
		{"scan", func(cfg *Config) { cfg.Scanner = testScanner{err: errors.New("scanner offline")} }, 400},
		{"probe", func(cfg *Config) { cfg.Processor = uploadRecoveryProbe{} }, 400},
		{"transcode", func(cfg *Config) { cfg.Processor = testProcessor{err: errors.New("worker offline")} }, 400},
		{"derived-quota", func(cfg *Config) { cfg.AccountQuotaBytes = int64(len(testMP4)) + 4 }, 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, channel := fixture(t, tc.mutate)
			// A delegated uploader's source remains owned by the channel owner.
			acceptRole(t, s, channel.Owner, channel.ID, testEditorAccount, CreatorRoleUploader)
			auth := StaticTokenAuth{Tokens: map[string]string{"actor-token": testEditorAccount}}
			body, contentType := recoveryUploadBody(t, channel.ID)
			first := recoveryRequest(NewServer(s, auth).Handler(), "/v1/uploads", "recover-upload-request-0001", contentType, body)
			var envelope map[string]string
			if err := json.Unmarshal(first.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if first.Code != tc.status || envelope["error"] == "" || envelope["video_id"] == "" || envelope["status"] != "failed" || envelope["recovery"] != "retry-processing" {
				t.Fatalf("saved failure has no accurate recovery: %d %s", first.Code, first.Body.String())
			}
			videoID := envelope["video_id"]
			original := filepath.Join(s.cfg.Root, "objects", videoID, "original")
			assertOriginal := func() {
				t.Helper()
				data, err := os.ReadFile(original)
				if err != nil || !bytes.Equal(data, testMP4) {
					t.Fatalf("original was not retained: %q %v", data, err)
				}
			}
			assertOriginal()
			s.cfg.Scanner, s.cfg.Processor, s.cfg.AccountQuotaBytes = testScanner{}, testProcessor{}, 96
			restarted, err := NewService(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			handler := NewServer(restarted, auth).Handler()
			// An exact replay preserves both the original ID and the failure
			// receipt. Recovery is a new operation on that ID, not a re-upload.
			replayed := recoveryRequest(handler, "/v1/uploads", "recover-upload-request-0001", contentType, body)
			if replayed.Code != first.Code || replayed.Body.String() != first.Body.String() {
				t.Fatalf("saved failure receipt did not replay: %d %s", replayed.Code, replayed.Body.String())
			}
			retried := recoveryRequest(handler, "/v1/videos/"+videoID+"/retry-processing", "recover-processing-request-0001", "", nil)
			var recovered Video
			if err = json.Unmarshal(retried.Body.Bytes(), &recovered); err != nil {
				t.Fatal(err)
			}
			if retried.Code != http.StatusOK || recovered.ID != videoID || recovered.Status != "ready" || recovered.Owner != channel.Owner {
				t.Fatalf("retry did not recover the same owned source: %d %s", retried.Code, retried.Body.String())
			}
			assertOriginal()
			snapshot, err := restarted.Studio(testEditorAccount)
			if err != nil || len(snapshot.Videos) != 1 || snapshot.Videos[0].ID != videoID {
				t.Fatalf("retry duplicated the upload: %+v %v", snapshot.Videos, err)
			}
		})
	}
}

func TestUploadRecoveryDoesNotExposeUnownedOrUnpersistedRecords(t *testing.T) {
	s, channel := fixture(t, func(cfg *Config) { cfg.Processor = testProcessor{err: errors.New("worker offline")} })
	video, err := s.Upload(context.Background(), channel.Owner, channel.ID, ownedUploadInput("Failed source", "owned.mp4", "video/mp4", testMP4))
	if err == nil || video == nil {
		t.Fatal("fixture did not persist a failed upload")
	}
	server := NewServer(s, nil)
	for _, tc := range []struct {
		name, actor, channelID string
		out                    *Video
	}{
		{"unrelated-account", testAttackerAccount, channel.ID, video},
		{"different-channel", channel.Owner, "chn_missing", video},
		{"no-saved-record", channel.Owner, channel.ID, &Video{ID: "vid_missing", Status: "failed"}},
		{"no-returned-record", channel.Owner, channel.ID, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			server.respondUpload(w, tc.actor, tc.channelID, tc.out, ErrForbidden)
			var envelope map[string]string
			if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if w.Code != http.StatusForbidden || len(envelope) != 1 || envelope["error"] != ErrForbidden.Error() {
				t.Fatalf("unconfirmed ownership leaked recovery: %d %s", w.Code, w.Body.String())
			}
		})
	}
	acceptRole(t, s, channel.Owner, channel.ID, testEditorAccount, CreatorRoleUploader)
	if err = s.RevokeTeamMember(channel.Owner, channel.ID, testEditorAccount); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	server.respondUpload(w, testEditorAccount, channel.ID, video, errors.New("worker offline"))
	var envelope map[string]string
	_ = json.Unmarshal(w.Body.Bytes(), &envelope)
	if w.Code != http.StatusBadRequest || len(envelope) != 1 {
		t.Fatalf("revoked uploader retained recovery disclosure: %d %s", w.Code, w.Body.String())
	}
}

func TestCancelledQueuedUploadAndRetryDoNotChangePersistedSources(t *testing.T) {
	for _, retry := range []bool{false, true} {
		t.Run(fmt.Sprintf("retry=%t", retry), func(t *testing.T) {
			s, channel := fixture(t, func(cfg *Config) { cfg.Processor = testProcessor{err: errors.New("worker offline")} })
			var video *Video
			if retry {
				var err error
				video, err = s.Upload(context.Background(), channel.Owner, channel.ID, ownedUploadInput("Saved source", "owned.mp4", "video/mp4", testMP4))
				if err == nil || video == nil {
					t.Fatal("retry fixture did not fail")
				}
			}
			s.cfg.Processor = testProcessor{}
			before, err := os.ReadFile(s.store.statePath)
			if err != nil {
				t.Fatal(err)
			}
			s.quotaMu.Lock()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			started, done := make(chan struct{}), make(chan error, 1)
			go func() {
				close(started)
				var err error
				if retry {
					_, err = s.RetryProcessing(ctx, channel.Owner, video.ID)
				} else {
					_, err = s.Upload(ctx, channel.Owner, channel.ID, ownedUploadInput("Cancelled source", "owned.mp4", "video/mp4", testMP4))
				}
				done <- err
			}()
			<-started
			cancel()
			s.quotaMu.Unlock()
			select {
			case err = <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("queued cancellation was ignored: %v", err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("cancelled operation did not return after lock release")
			}
			after, err := os.ReadFile(s.store.statePath)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("cancelled queued operation changed persisted state: %v", err)
			}
			objects, err := os.ReadDir(filepath.Join(s.cfg.Root, "objects"))
			if err != nil || (!retry && len(objects) != 0) || (retry && len(objects) != 1) {
				t.Fatalf("cancelled operation changed source objects: %v %v", objects, err)
			}
			if retry {
				data, err := os.ReadFile(filepath.Join(s.cfg.Root, "objects", video.ID, "original"))
				if err != nil || !bytes.Equal(data, testMP4) {
					t.Fatalf("cancelled retry removed the saved original: %q %v", data, err)
				}
			}
		})
	}
}

type cancelUploadReader struct {
	reader io.Reader
	cancel context.CancelFunc
}

func (r cancelUploadReader) Read(p []byte) (int, error) {
	n, err := r.reader.Read(p)
	if n > 0 {
		r.cancel()
	}
	return n, err
}

func TestUploadCancelledBeforeFirstPersistRemovesOnlyItsStagedSource(t *testing.T) {
	s, channel := fixture(t, nil)
	existing := uploadWithoutRights(t, s, channel, "Existing source")
	before, err := os.ReadFile(s.store.statePath)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	in := ownedUploadInput("Cancelled source", "owned.mp4", "video/mp4", testMP4)
	in.Reader = cancelUploadReader{reader: in.Reader, cancel: cancel}
	video, err := s.Upload(ctx, channel.Owner, channel.ID, in)
	if video != nil || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled copy persisted a video: %+v %v", video, err)
	}
	after, err := os.ReadFile(s.store.statePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("cancelled copy changed persisted state: %v", err)
	}
	objects, err := os.ReadDir(filepath.Join(s.cfg.Root, "objects"))
	if err != nil || len(objects) != 1 || objects[0].Name() != existing.ID {
		t.Fatalf("staging cleanup affected existing sources: %v %v", objects, err)
	}
	data, err := os.ReadFile(filepath.Join(s.cfg.Root, "objects", existing.ID, "original"))
	if err != nil || !bytes.Equal(data, testMP4) {
		t.Fatalf("existing source changed: %q %v", data, err)
	}
}

func TestUploadCancelledAfterPersistRetainsRecoverableOriginal(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s, channel := fixture(t, func(cfg *Config) {
		cfg.Scanner = uploadRecoveryScanner(func(ctx context.Context, _ string) error {
			cancel()
			return ctx.Err()
		})
	})
	video, err := s.Upload(ctx, channel.Owner, channel.ID, ownedUploadInput("Saved then cancelled", "owned.mp4", "video/mp4", testMP4))
	if !errors.Is(err, context.Canceled) || video == nil || video.Status != "failed" {
		t.Fatalf("post-persist cancellation lost recovery state: %+v %v", video, err)
	}
	data, err := os.ReadFile(filepath.Join(s.cfg.Root, "objects", video.ID, "original"))
	if err != nil || !bytes.Equal(data, testMP4) {
		t.Fatalf("post-persist cancellation removed source: %q %v", data, err)
	}
	s.cfg.Scanner = testScanner{}
	retried, err := s.RetryProcessing(context.Background(), channel.Owner, video.ID)
	if err != nil || retried.ID != video.ID || retried.Status != "ready" {
		t.Fatalf("post-persist cancellation could not recover the same upload: %+v %v", retried, err)
	}
}
