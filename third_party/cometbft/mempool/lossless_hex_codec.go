package mempool

import (
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"time"
)

const (
	losslessHexHeaderBytes = 48
	losslessHexChunkBytes  = 64 << 10
	losslessHexMaxOriginal = 64 << 20
	losslessHexHead        = `{"version":1,"type":"`
	losslessHexMiddle      = `","wireHex":"`
	losslessHexTail        = `"}`
)

var (
	ErrLosslessHexLimit     = errors.New("lossless hex: resource limit")
	ErrLosslessHexFormat    = errors.New("lossless hex: invalid frame or canonical hex")
	ErrLosslessHexIntegrity = errors.New("lossless hex: original-byte integrity mismatch")
	ErrLosslessHexWork      = errors.New("lossless hex: work deadline exceeded")
)

// The IDs are experimental transport constants, bound to the six kinds in
// consensus.EncodePQTransaction. They do not introduce a transaction format or
// authorize, admit, validate signatures, or change the original transaction hash.
var losslessHexKinds = [...]string{
	"pq_transfer", "account_migration", "account_revocation",
	"pq_whole", "pq_ethereum_value", "account_initial",
}

type LosslessHexLimits struct {
	MaxFrameBytes int
	MaxWork       time.Duration
}

// LosslessHexCodec is an opt-in, single-object transport transform. The caller
// owns legacy fallback and must select exactly one representation before send.
// Limits are immutable after construction; independent operations share no
// buffers, caches, authority, or mutable counters.
type LosslessHexCodec struct {
	maxOriginal int
	maxFrame    int
	maxWork     time.Duration
	now         func() time.Time // private deterministic clock for bounded tests
}

func NewLosslessHexCodec(maxOriginal int, limits LosslessHexLimits) (*LosslessHexCodec, error) {
	if maxOriginal <= 0 || maxOriginal > losslessHexMaxOriginal {
		return nil, ErrLosslessHexLimit
	}
	maxFrame := maxOriginal/2 + losslessHexHeaderBytes
	if limits.MaxFrameBytes == 0 {
		limits.MaxFrameBytes = maxFrame
	}
	if limits.MaxFrameBytes <= losslessHexHeaderBytes || limits.MaxFrameBytes > maxFrame {
		return nil, ErrLosslessHexLimit
	}
	if limits.MaxWork == 0 {
		limits.MaxWork = 100 * time.Millisecond
	}
	if limits.MaxWork < time.Millisecond || limits.MaxWork > time.Second {
		return nil, ErrLosslessHexLimit
	}
	return &LosslessHexCodec{maxOriginal: maxOriginal, maxFrame: limits.MaxFrameBytes, maxWork: limits.MaxWork, now: time.Now}, nil
}

func (c *LosslessHexCodec) MaxFrameBytes() int {
	if c == nil {
		return 0
	}
	return c.maxFrame
}

func (c *LosslessHexCodec) MaxOriginalBytes() int {
	if c == nil {
		return 0
	}
	return c.maxOriginal
}

func (c *LosslessHexCodec) deadline() (time.Time, error) {
	if c == nil || c.now == nil || c.maxOriginal <= 0 || c.maxFrame <= losslessHexHeaderBytes || c.maxWork <= 0 {
		return time.Time{}, ErrLosslessHexLimit
	}
	return c.now().Add(c.maxWork), nil
}

func (c *LosslessHexCodec) checkWork(deadline time.Time) error {
	if !c.now().Before(deadline) {
		return ErrLosslessHexWork
	}
	return nil
}

// Pack recognizes only byte-exact C envelopes emitted by the existing encoder:
// {"version":1,"type":"<fixed kind>","wireHex":"<nonempty lowercase hex>"}.
// Unknown/legacy shapes return eligible=false without rewriting their bytes.
// A recognized shape with invalid hex, or a resource/deadline failure, returns
// no frame and an error. Neither outcome performs a send or triggers a retry.
func (c *LosslessHexCodec) Pack(original []byte) ([]byte, bool, error) {
	deadline, err := c.deadline()
	if err != nil {
		return nil, false, err
	}
	if len(original) > c.maxOriginal {
		return nil, false, ErrLosslessHexLimit
	}
	if err := c.checkWork(deadline); err != nil {
		return nil, false, err
	}
	if !bytes.HasPrefix(original, []byte(losslessHexHead)) || !bytes.HasSuffix(original, []byte(losslessHexTail)) {
		return nil, false, nil
	}
	var kindID byte
	var start int
	for i, kind := range losslessHexKinds {
		prefix := losslessHexHead + kind + losslessHexMiddle
		if bytes.HasPrefix(original, []byte(prefix)) {
			kindID, start = byte(i+1), len(prefix)
			break
		}
	}
	if kindID == 0 {
		return nil, false, nil
	}
	end := len(original) - len(losslessHexTail)
	if start >= end {
		return nil, false, ErrLosslessHexFormat
	}
	// Check canonical syntax before allocating a frame. A quoted/escaped value
	// or additional JSON fields is a different legacy shape, never rewritten.
	for offset := start; offset < end; {
		if err := c.checkWork(deadline); err != nil {
			return nil, false, err
		}
		next := offset + losslessHexChunkBytes
		if next > end {
			next = end
		}
		for _, b := range original[offset:next] {
			if b == '"' || b == '\\' {
				return nil, false, nil
			}
			if _, ok := lowerHexNibble(b); !ok {
				return nil, false, ErrLosslessHexFormat
			}
		}
		offset = next
	}
	if (end-start)%2 != 0 {
		return nil, false, ErrLosslessHexFormat
	}
	rawLen := (end - start) / 2
	frameLen := losslessHexHeaderBytes + rawLen
	if frameLen > c.maxFrame || uint64(len(original)) > 2*uint64(frameLen) {
		return nil, false, ErrLosslessHexLimit
	}
	if err := c.checkWork(deadline); err != nil {
		return nil, false, err
	}
	frame := make([]byte, frameLen)
	copy(frame[:4], "YNXP")
	frame[4], frame[5], frame[6] = 1, 1, kindID
	// Byte 7 is reserved and remains zero; both lengths are fixed big endian.
	binary.BigEndian.PutUint32(frame[8:12], uint32(len(original)))
	binary.BigEndian.PutUint32(frame[12:16], uint32(rawLen))
	for offset := start; offset < end; {
		if err := c.checkWork(deadline); err != nil {
			return nil, false, err
		}
		next := offset + losslessHexChunkBytes
		if next > end {
			next = end
		}
		out := losslessHexHeaderBytes + (offset-start)/2
		if _, err := hex.Decode(frame[out:out+(next-offset)/2], original[offset:next]); err != nil {
			return nil, false, ErrLosslessHexFormat
		}
		offset = next
	}
	sum, err := c.originalHash(original, deadline)
	if err != nil {
		return nil, false, err
	}
	copy(frame[16:48], sum[:])
	if err := c.checkWork(deadline); err != nil {
		return nil, false, err
	}
	return frame, true, nil
}

func lowerHexNibble(b byte) (byte, bool) {
	if b >= '0' && b <= '9' {
		return b - '0', true
	}
	if b >= 'a' && b <= 'f' {
		return b - 'a' + 10, true
	}
	return 0, false
}

// Restore validates the complete fixed header, one-object count, both lengths,
// exact canonical expansion size and ratio before allocating the output. The
// SHA-256 binds the original C bytes only; it is never proof of authority. The
// returned owned bytes must still enter the original admission and verifier.
func (c *LosslessHexCodec) Restore(frame []byte) ([]byte, error) {
	deadline, err := c.deadline()
	if err != nil {
		return nil, err
	}
	if len(frame) < losslessHexHeaderBytes || len(frame) > c.maxFrame {
		return nil, ErrLosslessHexLimit
	}
	if !bytes.Equal(frame[:4], []byte("YNXP")) || frame[4] != 1 || frame[5] != 1 || frame[6] == 0 || int(frame[6]) > len(losslessHexKinds) || frame[7] != 0 {
		return nil, ErrLosslessHexFormat
	}
	originalLen := uint64(binary.BigEndian.Uint32(frame[8:12]))
	rawLen := uint64(binary.BigEndian.Uint32(frame[12:16]))
	kind := losslessHexKinds[int(frame[6])-1]
	prefix := losslessHexHead + kind + losslessHexMiddle
	canonicalLen := uint64(len(prefix)+len(losslessHexTail)) + 2*rawLen
	if rawLen == 0 || originalLen == 0 || rawLen+losslessHexHeaderBytes != uint64(len(frame)) ||
		originalLen != canonicalLen || originalLen > uint64(c.maxOriginal) || originalLen > 2*uint64(len(frame)) {
		return nil, ErrLosslessHexFormat
	}
	if err := c.checkWork(deadline); err != nil {
		return nil, err
	}
	original := make([]byte, int(originalLen))
	copy(original, prefix)
	copy(original[len(original)-len(losslessHexTail):], losslessHexTail)
	// Each chunk writes at most 64KiB restored bytes, including the hex expansion.
	for offset := losslessHexHeaderBytes; offset < len(frame); {
		if err := c.checkWork(deadline); err != nil {
			return nil, err
		}
		next := offset + losslessHexChunkBytes/2
		if next > len(frame) {
			next = len(frame)
		}
		out := len(prefix) + 2*(offset-losslessHexHeaderBytes)
		hex.Encode(original[out:out+2*(next-offset)], frame[offset:next])
		offset = next
	}
	sum, err := c.originalHash(original, deadline)
	if err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare(sum[:], frame[16:48]) != 1 {
		return nil, ErrLosslessHexIntegrity
	}
	if err := c.checkWork(deadline); err != nil {
		return nil, err
	}
	return original, nil
}

func (c *LosslessHexCodec) originalHash(original []byte, deadline time.Time) ([32]byte, error) {
	h := sha256.New()
	for offset := 0; offset < len(original); {
		if err := c.checkWork(deadline); err != nil {
			return [32]byte{}, err
		}
		next := offset + losslessHexChunkBytes
		if next > len(original) {
			next = len(original)
		}
		_, _ = h.Write(original[offset:next])
		offset = next
	}
	var sum [32]byte
	h.Sum(sum[:0])
	return sum, c.checkWork(deadline)
}
