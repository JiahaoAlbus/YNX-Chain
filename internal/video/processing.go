package video

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

type Scanner interface {
	Scan(context.Context, string) error
}
type Processor interface {
	Transcode(context.Context, string, string) ([]MediaVariant, error)
}
type AIProvider interface {
	Generate(context.Context, AIRequest) (AIResult, error)
}
type AIStreamer interface {
	Stream(context.Context, AIRequest, func(string) error) (AIResult, error)
}
type PayVerifier interface {
	VerifyReceipt(context.Context, string, string, int64) error
	CreatePayoutIntent(context.Context, string, int64, string) (string, error)
}
type DependencyChecker interface{ Check() error }
type AIRequest struct {
	Kind, VideoID, ContextPreview, OutputLanguage string
	ContextClasses                                []string
}
type AIResult struct {
	Provider, Model, Text string
	Units                 int64
}

type CommandScanner struct {
	Command, Database string
}

func (s CommandScanner) Check() error {
	if s.Command == "" {
		return errors.New("malware scanner unavailable")
	}
	if _, err := exec.LookPath(s.Command); err != nil {
		return err
	}
	if s.Database != "" {
		if info, err := os.Stat(s.Database); err != nil || !info.IsDir() {
			return errors.New("malware signature database unavailable")
		}
	}
	return nil
}

func (s CommandScanner) Scan(ctx context.Context, path string) error {
	if s.Command == "" {
		return errors.New("malware scanner unavailable")
	}
	args := []string{"--no-summary"}
	if s.Database != "" {
		args = append(args, "--database="+s.Database)
	}
	args = append(args, path)
	if out, err := exec.CommandContext(ctx, s.Command, args...).CombinedOutput(); err != nil {
		return fmt.Errorf("malware scan failed: %w: %s", err, string(out))
	}
	return nil
}

type FFmpegProcessor struct{ FFmpeg string }

func (p FFmpegProcessor) Check() error {
	bin := p.FFmpeg
	if bin == "" {
		bin = "ffmpeg"
	}
	_, err := exec.LookPath(bin)
	return err
}

func (p FFmpegProcessor) Transcode(ctx context.Context, input, outputDir string) ([]MediaVariant, error) {
	bin := p.FFmpeg
	if bin == "" {
		bin = "ffmpeg"
	}
	out := filepath.Join(outputDir, "stream.m3u8")
	args := []string{"-nostdin", "-v", "error", "-i", input, "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod", "-hls_segment_filename", filepath.Join(outputDir, "segment-%04d.ts"), out}
	if data, err := exec.CommandContext(ctx, bin, args...).CombinedOutput(); err != nil {
		return nil, fmt.Errorf("transcode failed: %w: %s", err, string(data))
	}
	return []MediaVariant{{Name: "adaptive-hls", ObjectKey: filepath.Base(outputDir) + "/stream.m3u8", MIME: "application/vnd.apple.mpegurl"}}, nil
}
