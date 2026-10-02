package music

import (
	"bytes"
	"encoding/binary"
	"fmt"
)

// PCM WAV is a RIFF container, not a fixed 44-byte header. Metadata (LIST,
// JUNK, bext, etc.) and extended fmt chunks are retained byte-for-byte; only
// validated PCM sample data contributes to the reported playback duration.
func pcmWAVDuration(data []byte) (int64, error) {
	invalid := func(reason string) (int64, error) {
		return 0, fmt.Errorf("%w: %s", ErrInvalid, reason)
	}
	if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return invalid("only PCM RIFF/WAVE is accepted")
	}
	end := uint64(binary.LittleEndian.Uint32(data[4:8])) + 8
	if end != uint64(len(data)) {
		return invalid("WAV RIFF length does not match the upload")
	}
	var byteRate, blockAlign uint64
	var audioSize uint64
	var hasFormat, hasData bool
	for offset := uint64(12); offset < end; {
		if end-offset < 8 {
			return invalid("truncated WAV chunk header")
		}
		kind := string(data[offset : offset+4])
		size := uint64(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		start := offset + 8
		if size > end-start {
			return invalid("truncated WAV chunk payload")
		}
		next := start + size
		if size%2 != 0 {
			if next == end {
				return invalid("missing WAV chunk padding")
			}
			next++
		}
		switch kind {
		case "fmt ":
			if hasFormat || hasData || size < 16 {
				return invalid("missing, duplicate or out-of-order WAV format")
			}
			format := data[start : start+size]
			encoding := binary.LittleEndian.Uint16(format[:2])
			channels := uint64(binary.LittleEndian.Uint16(format[2:4]))
			sampleRate := uint64(binary.LittleEndian.Uint32(format[4:8]))
			byteRate = uint64(binary.LittleEndian.Uint32(format[8:12]))
			blockAlign = uint64(binary.LittleEndian.Uint16(format[12:14]))
			bits := uint64(binary.LittleEndian.Uint16(format[14:16]))
			if encoding == 0xfffe {
				pcmGUID := []byte{1, 0, 0, 0, 0, 0, 0x10, 0, 0x80, 0, 0, 0xaa, 0, 0x38, 0x9b, 0x71}
				if size < 40 || binary.LittleEndian.Uint16(format[16:18]) < 22 || uint64(binary.LittleEndian.Uint16(format[16:18])) > size-18 || !bytes.Equal(format[24:40], pcmGUID) {
					return invalid("unsupported WAV extensible encoding")
				}
				validBits := uint64(binary.LittleEndian.Uint16(format[18:20]))
				if validBits == 0 || validBits > bits {
					return invalid("invalid WAV extensible sample width")
				}
			} else if encoding != 1 {
				return invalid("only integer PCM WAV is accepted")
			} else if size != 16 && (size < 18 || uint64(binary.LittleEndian.Uint16(format[16:18])) > size-18) {
				return invalid("truncated PCM format extension")
			}
			if channels == 0 || sampleRate == 0 || (bits != 8 && bits != 16 && bits != 24 && bits != 32) || blockAlign != channels*(bits/8) || byteRate != sampleRate*blockAlign {
				return invalid("inconsistent WAV sample format")
			}
			hasFormat = true
		case "data":
			if !hasFormat || hasData || size == 0 || size%blockAlign != 0 {
				return invalid("missing, duplicate or partial WAV sample data")
			}
			audioSize = size
			hasData = true
		}
		offset = next
	}
	if !hasFormat || !hasData {
		return invalid("WAV requires format and sample data chunks")
	}
	duration := int64(audioSize * 1000 / byteRate)
	if duration < 250 || duration > 2*60*60*1000 {
		return invalid("audio duration outside policy")
	}
	return duration, nil
}
