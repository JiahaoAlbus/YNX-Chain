package binaryhttpsource

import (
	"encoding/binary"
	"encoding/hex"
	"net/http"
	"strconv"
)

// Exact sole SDK tuple, independently recomputed from actual complete bytes.
// These are DATA integrity facts only, NOT PS/Source authority or verification.
type BodyBindingDATA struct {
	Bytes    string `json:"bytes"`
	SHA3_512 string `json:"sha3_512"`
	SHA512   string `json:"sha512"`
}

func (c *Capture) OriginalBodyBindingDATA(r *http.Request) (BodyBindingDATA, []byte, error) {
	if c == nil {
		return BodyBindingDATA{}, nil, errRequest
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.checkOriginalLocked(r); e != nil {
		return BodyBindingDATA{}, nil, c.fail(e)
	}
	raw := make([]byte, 136)
	binary.BigEndian.PutUint64(raw[:8], uint64(c.size))
	copy(raw[8:72], c.sha3Digest[:])
	copy(raw[72:], c.sha512Digest[:])
	return BodyBindingDATA{strconv.FormatInt(c.size, 10), hex.EncodeToString(c.sha3Digest[:]), hex.EncodeToString(c.sha512Digest[:])}, raw, nil
}
