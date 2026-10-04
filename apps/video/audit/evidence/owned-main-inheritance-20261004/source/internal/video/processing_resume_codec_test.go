package video

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

type resumeCodecProcessor struct {
	FFmpegProcessor
	calls int
}

func (p *resumeCodecProcessor) Transcode(ctx context.Context, input, output string) ([]MediaVariant, error) {
	p.calls++
	return p.FFmpegProcessor.Transcode(ctx, input, output)
}

// Real local codecs and repository-owned media; scanner and authority remain
// disposable software fixtures. No installed renderer or real account is used.
func TestVideoResumePublishedUnknownWithRealCodec(t *testing.T) {
	const binary = "/opt/homebrew/bin/ffmpeg"
	if _, err := os.Stat(binary); err != nil {
		t.Skip("FFmpeg unavailable at the original integration-test path")
	}
	data, err := os.ReadFile("testdata/ynx-owned-test.mp4")
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	if hex.EncodeToString(digest[:]) != "be414db1d01558b11c7592b7d4dc69d0fee8da158997dc477e2fdaf6b9e3ee39" {
		t.Fatal("repository-owned clip identity changed")
	}
	for _, phase := range []string{"scanning", "transcoding"} {
		t.Run(phase, func(t *testing.T) {
			processor := &resumeCodecProcessor{FFmpegProcessor: FFmpegProcessor{FFmpeg: binary}}
			s, c := fixture(t, func(cfg *Config) {
				cfg.Processor = processor
				cfg.MaxObjectBytes = 1 << 20
				cfg.AccountQuotaBytes = 2 << 20
			})
			g := videoTestGrant(s, c.Owner, "real_codec_unknown_upload_0001", nil)
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
			_, err := videoLease(t, s, context.Background(), g, false).Upload(context.Background(), c.Owner, c.ID, ownedUploadInput("Original codec recovery", "ynx-owned-test.mp4", "video/mp4", data))
			if !errors.Is(err, ErrVideoStatePublicationUnconfirmed) || processor.calls != 0 {
				t.Fatalf("unconfirmed source started encoding: calls=%d err=%v", processor.calls, err)
			}
			var original *Video
			for _, v := range s.store.state.Videos {
				original = cloneVideo(v)
			}
			if original == nil || original.Status != phase {
				t.Fatal("interrupted original missing")
			}
			fresh := videoLease(t, s, context.Background(), videoTestGrant(s, c.Owner, "real_codec_explicit_resume_0001", nil), false)
			ready, err := fresh.RetryProcessing(context.Background(), c.Owner, original.ID)
			if err != nil {
				t.Fatal(err)
			}
			if ready.ID != original.ID || ready.ObjectKey != original.ObjectKey || ready.SHA256 != original.SHA256 || ready.Status != "ready" || processor.calls != 1 || len(ready.Variants) < 3 || ready.Probe == nil || ready.Probe.VideoCodec == "" || ready.Probe.AudioCodec == "" || ready.Probe.DurationSecond <= 0 {
				t.Fatalf("original codec recovery incomplete: %+v calls=%d", ready, processor.calls)
			}
			cold, err := NewService(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			saved := cold.snapshotVideo(original.ID)
			if saved.Status != "ready" || len(cold.store.state.Videos) != 1 || len(cold.store.state.BusinessNonces) != 2 {
				t.Fatal("cold recovery duplicated or lost original state")
			}
			for _, asset := range saved.Variants {
				path, e := s.cfg.Objects.Resolve(asset.ObjectKey)
				if e != nil {
					t.Fatal(e)
				}
				body, e := os.ReadFile(path)
				hash := sha256.Sum256(body)
				if e != nil || asset.Bytes != int64(len(body)) || asset.SHA256 != hex.EncodeToString(hash[:]) {
					t.Fatalf("cold asset no longer matches its integrity record: %s %v", asset.ObjectKey, e)
				}
				if asset.ObjectKey == saved.ObjectKey {
					if !bytes.Equal(body, data) || asset.Lineage != "original" {
						t.Fatal("recovery replaced source bytes")
					}
				} else if asset.Lineage != "derivative" || asset.SourceObjectKey != saved.ObjectKey || asset.SourceSHA256 != saved.SHA256 {
					t.Fatal("recovery lost derivative provenance")
				}
			}
			stream := filepath.Join(s.cfg.Root, "objects", saved.ID, "stream.m3u8")
			if output, e := exec.Command(binary, "-nostdin", "-v", "error", "-i", stream, "-t", "0.25", "-f", "null", "-").CombinedOutput(); e != nil {
				t.Fatalf("actual HLS decode failed: %v: %s", e, output)
			}
			if evidence := os.Getenv("YNX_VIDEO_CODEC_RECOVERY_EVIDENCE"); evidence != "" {
				dest := filepath.Join(evidence, phase)
				if e := os.MkdirAll(dest, 0700); e != nil {
					t.Fatal(e)
				}
				for _, asset := range saved.Variants {
					path, e := s.cfg.Objects.Resolve(asset.ObjectKey)
					if e != nil {
						t.Fatal(e)
					}
					body, e := os.ReadFile(path)
					if e != nil {
						t.Fatal(e)
					}
					if e = os.WriteFile(filepath.Join(dest, filepath.Base(asset.ObjectKey)), body, 0600); e != nil {
						t.Fatal(e)
					}
				}
				body, e := json.MarshalIndent(saved, "", "  ")
				if e != nil {
					t.Fatal(e)
				}
				if e = os.WriteFile(filepath.Join(dest, "video.json"), append(body, '\n'), 0600); e != nil {
					t.Fatal(e)
				}
			}
		})
	}
}
