package video

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

type Scanner interface {
	Scan(context.Context, string) error
}
type Processor interface {
	Transcode(context.Context, string, string) ([]MediaVariant, error)
}
type MediaProber interface {
	Probe(context.Context, string) (MediaProbe, error)
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
	if _, err := exec.LookPath(bin); err != nil {
		return err
	}
	_, err := exec.LookPath(p.ffprobeBinary())
	return err
}

func (p FFmpegProcessor) ffprobeBinary() string {
	if p.FFmpeg == "" || filepath.Base(p.FFmpeg) == p.FFmpeg {
		return "ffprobe"
	}
	return filepath.Join(filepath.Dir(p.FFmpeg), "ffprobe")
}

func (p FFmpegProcessor) Probe(ctx context.Context, input string) (MediaProbe, error) {
	type probeStream struct {
		CodecType    string `json:"codec_type"`
		CodecName    string `json:"codec_name"`
		Width        int    `json:"width"`
		Height       int    `json:"height"`
		AvgFrameRate string `json:"avg_frame_rate"`
	}
	type probeOutput struct {
		Streams []probeStream `json:"streams"`
		Format  struct {
			FormatName string `json:"format_name"`
			Duration   string `json:"duration"`
		} `json:"format"`
	}
	args := []string{"-v", "error", "-show_streams", "-show_format", "-of", "json", input}
	data, err := exec.CommandContext(ctx, p.ffprobeBinary(), args...).Output()
	if err != nil {
		return MediaProbe{}, fmt.Errorf("media probe failed: %w", err)
	}
	var raw probeOutput
	if err = json.Unmarshal(data, &raw); err != nil {
		return MediaProbe{}, fmt.Errorf("decode media probe: %w", err)
	}
	result := MediaProbe{Container: strings.TrimSpace(raw.Format.FormatName)}
	result.DurationSecond, err = strconv.ParseFloat(raw.Format.Duration, 64)
	if err != nil || result.DurationSecond <= 0 || result.DurationSecond > 12*60*60 {
		return MediaProbe{}, errors.New("media duration is missing or outside 12 hour bound")
	}
	for _, stream := range raw.Streams {
		switch stream.CodecType {
		case "video":
			if result.VideoCodec != "" {
				continue
			}
			result.VideoCodec = strings.ToLower(stream.CodecName)
			result.Width, result.Height = stream.Width, stream.Height
			result.FrameRate, err = parseFrameRate(stream.AvgFrameRate)
			if err != nil {
				return MediaProbe{}, err
			}
		case "audio":
			if result.AudioCodec == "" {
				result.AudioCodec = strings.ToLower(stream.CodecName)
			}
		}
	}
	if !allowedVideoCodec(result.VideoCodec) {
		return MediaProbe{}, fmt.Errorf("unsupported video codec %q", result.VideoCodec)
	}
	if result.Width <= 0 || result.Height <= 0 || result.Width > 7680 || result.Height > 4320 {
		return MediaProbe{}, errors.New("video dimensions are missing or outside 7680x4320 bound")
	}
	if result.FrameRate <= 0 || result.FrameRate > 240 {
		return MediaProbe{}, errors.New("video frame rate is missing or outside 240 fps bound")
	}
	if result.AudioCodec != "" && !allowedAudioCodec(result.AudioCodec) {
		return MediaProbe{}, fmt.Errorf("unsupported audio codec %q", result.AudioCodec)
	}
	return result, nil
}

func parseFrameRate(value string) (float64, error) {
	parts := strings.Split(value, "/")
	if len(parts) != 2 {
		return 0, errors.New("invalid video frame rate")
	}
	numerator, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, errors.New("invalid video frame rate")
	}
	denominator, err := strconv.ParseFloat(parts[1], 64)
	if err != nil || denominator == 0 {
		return 0, errors.New("invalid video frame rate")
	}
	return numerator / denominator, nil
}

func allowedVideoCodec(codec string) bool {
	switch codec {
	case "h264", "hevc", "vp8", "vp9", "av1", "mpeg4":
		return true
	default:
		return false
	}
}

func allowedAudioCodec(codec string) bool {
	switch codec {
	case "aac", "mp3", "opus", "vorbis", "flac":
		return true
	default:
		return false
	}
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
