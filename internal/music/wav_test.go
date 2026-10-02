package music

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func riffFixture(chunks ...[]byte) []byte {
	data := []byte("RIFF\x00\x00\x00\x00WAVE")
	for _, chunk := range chunks {
		data = append(data, chunk...)
	}
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	return data
}
func wavChunk(kind string, content []byte) []byte {
	chunk := make([]byte, 8, len(content)+9)
	copy(chunk, kind)
	binary.LittleEndian.PutUint32(chunk[4:8], uint32(len(content)))
	chunk = append(chunk, content...)
	if len(content)%2 != 0 {
		chunk = append(chunk, 0)
	}
	return chunk
}
func TestWAVChunkedPCMUploadPreservesActualBytesAndDuration(t *testing.T) {
	original := toneWAV(1000)
	fmtChunk := append([]byte{}, original[12:36]...)
	dataChunk := append([]byte{}, original[36:]...)
	extended := append([]byte{}, original[20:36]...)
	extended = append(extended, 0, 0)
	extensible := append([]byte{}, original[20:36]...)
	binary.LittleEndian.PutUint16(extensible[:2], 0xfffe)
	extensible = append(extensible, 22, 0, 8, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71)
	for name, data := range map[string][]byte{
		"canonical":              original,
		"metadata-before-format": riffFixture(wavChunk("JUNK", []byte{1, 2, 3}), fmtChunk, dataChunk),
		"metadata-before-data":   riffFixture(fmtChunk, wavChunk("LIST", []byte("INFO")), dataChunk),
		"metadata-after-data":    riffFixture(fmtChunk, dataChunk, wavChunk("LIST", []byte("INFO"))),
		"extended-pcm-format":    riffFixture(wavChunk("fmt ", extended), dataChunk),
		"extensible-pcm-format":  riffFixture(wavChunk("fmt ", extensible), dataChunk),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "owned.wav")
			hash, duration, err := writeWAV(path, bytes.NewReader(data), int64(len(data)))
			if err != nil || duration != 1000 || len(hash) != 64 {
				t.Fatalf("actual PCM upload failed: duration=%d hash=%q err=%v", duration, hash, err)
			}
			stored, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(stored, data) {
				t.Fatal("upload changed or omitted original RIFF bytes")
			}
		})
	}
}

func TestWAVRejectsMalformedContainersAndPreservesExistingFile(t *testing.T) {
	original := toneWAV(1000)
	format := append([]byte{}, original[20:36]...)
	data := append([]byte{}, original[44:]...)
	badRate := append([]byte{}, format...)
	binary.LittleEndian.PutUint32(badRate[8:12], 1)
	badAlign := append([]byte{}, format...)
	binary.LittleEndian.PutUint16(badAlign[12:14], 2)
	badBits := append([]byte{}, format...)
	binary.LittleEndian.PutUint16(badBits[14:16], 7)
	truncated := append([]byte{}, original...)
	truncated = truncated[:len(truncated)-1]
	sizeLie := append([]byte{}, original...)
	binary.LittleEndian.PutUint32(sizeLie[40:44], 0xffffffff)
	badTags := append([]byte{}, original...)
	copy(badTags[12:16], "XXXX")
	copy(badTags[36:40], "XXXX")
	for name, invalid := range map[string][]byte{
		"wrong-riff-length":      truncated,
		"truncated-chunk":        sizeLie,
		"fixed-offset-fake-tags": badTags,
		"inconsistent-rate":      riffFixture(wavChunk("fmt ", badRate), wavChunk("data", data)),
		"inconsistent-alignment": riffFixture(wavChunk("fmt ", badAlign), wavChunk("data", data)),
		"invalid-sample-width":   riffFixture(wavChunk("fmt ", badBits), wavChunk("data", data)),
		"missing-format":         riffFixture(wavChunk("data", data)),
		"missing-data":           riffFixture(wavChunk("fmt ", format)),
		"duplicate-data":         riffFixture(wavChunk("fmt ", format), wavChunk("data", data), wavChunk("data", data)),
		"duplicate-format":       riffFixture(wavChunk("fmt ", format), wavChunk("fmt ", format), wavChunk("data", data)),
		"missing-odd-padding":    riffFixture(wavChunk("fmt ", format), wavChunk("data", data), []byte("JUNK\x01\x00\x00\x00x")),
		"empty-data":             riffFixture(wavChunk("fmt ", format), wavChunk("data", nil)),
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "retained.wav")
			if err := os.WriteFile(path, original, 0o600); err != nil {
				t.Fatal(err)
			}
			if _, _, err := writeWAV(path, bytes.NewReader(invalid), 1<<20); !errors.Is(err, ErrInvalid) {
				t.Fatalf("malformed upload accepted: %v", err)
			}
			retained, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(retained, original) {
				t.Fatal("rejected upload damaged an existing file")
			}
		})
	}
}

type countedWAVReader struct{ bytes int64 }

func (r *countedWAVReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	r.bytes += int64(len(p))
	return len(p), nil
}
func TestWAVUploadReadsOnlyConfiguredBound(t *testing.T) {
	r := &countedWAVReader{}
	path := filepath.Join(t.TempDir(), "oversized.wav")
	if _, _, err := writeWAV(path, r, 1024); !errors.Is(err, ErrInvalid) {
		t.Fatalf("oversized upload accepted: %v", err)
	}
	if r.bytes != 1025 {
		t.Fatalf("upload read beyond limit+1: %d", r.bytes)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("oversized input wrote media")
	}
	if _, _, err := writeWAV(path, io.MultiReader(bytes.NewReader([]byte("RIFF")), errorWAVReader{}), 1024); !errors.Is(err, io.ErrUnexpectedEOF) || !errors.Is(err, ErrInvalid) {
		t.Fatalf("input read error or validation boundary lost: %v", err)
	}
}

type errorWAVReader struct{}

func (errorWAVReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
