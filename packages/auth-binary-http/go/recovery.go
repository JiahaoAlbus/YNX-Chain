package binaryhttpsource

import (
	"bytes"
	"crypto/sha256"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
)

func readFrames(h *heldFile) ([][]byte, error) {
	if h == nil || h.file == nil {
		return nil, errRecovery
	}
	b, e := io.ReadAll(io.NewSectionReader(h.file, 0, maxJournalBytes+1))
	if e != nil || len(b) > maxJournalBytes {
		return nil, errRecovery
	}
	var frames [][]byte
	for len(b) > 0 {
		if len(b) < 4 {
			return frames, errUnknown
		}
		n := int(binary.BigEndian.Uint32(b[:4]))
		b = b[4:]
		if n < 1 || n > maxJournalFrame || n > len(b) {
			return frames, errUnknown
		}
		frames = append(frames, append([]byte(nil), b[:n]...))
		b = b[n:]
		if len(frames) > 2 {
			return frames, errUnknown
		}
	}
	return frames, nil
}
func exactJSON(b []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(out); e != nil {
		return errRecovery
	}
	if _, e := d.Token(); e != io.EOF {
		return errRecovery
	}
	canonical, e := json.Marshal(out)
	if e != nil || !bytes.Equal(canonical, b) {
		return errRecovery
	}
	return nil
}

// Recovery opens originals READ ONLY. It never creates files, reconstructs an
// http.Request, authenticates a principal, refreshes current, or grants borrow.
func RestoreCapturedDATAReadOnly(s *Store, id string) (c *Capture, e error) {
	if s == nil || !captureName.MatchString(id) {
		return nil, errRecovery
	}
	s.mu.Lock()
	if s.closeCalled || s.cause != nil || s.children >= 32 {
		s.mu.Unlock()
		return nil, errClosed
	}
	s.children++
	c = &Capture{store: s, id: id, recovered: true, active: true}
	c.self = c
	s.mu.Unlock()
	defer func() {
		c.mu.Lock()
		c.active = false
		if e != nil {
			e = c.fail(e)
		}
		c.mu.Unlock()
	}()
	c.journal, e = openOwned(s.directory, id+".journal", false)
	if e != nil {
		return c, e
	}
	c.body, e = openOwned(s.directory, id+".body", false)
	if e != nil {
		return c, e
	}
	frames, frameErr := readFrames(c.journal)
	if len(frames) == 0 {
		return c, errRecovery
	}
	var entered journalEntered
	if e = exactJSON(frames[0], &entered); e != nil {
		return c, e
	}
	if entered.Version != "YNX-LOCAL-BINARY-CAPTURE/v1" || entered.ID != id || entered.Length > MaxCaptureResourceBytes {
		return c, errRecovery
	}
	c.snapshot = requestSnapshot{RequestDATA: entered.Request, ProofHeader: entered.ProofHeader, Host: entered.Host, URI: entered.URI, Length: entered.Length, Transfer: entered.Transfer}
	var terminal journalComplete
	if frameErr != nil || len(frames) != 2 || exactJSON(frames[1], &terminal) != nil || terminal.State != "CAPTURED" || terminal.Bytes < 1 || terminal.Bytes > MaxCaptureResourceBytes || len(terminal.SHA256) != 64 || len(terminal.SHA3_512) != 128 || len(terminal.SHA512) != 128 {
		return c, errUnknown
	}
	decoded, e := hex.DecodeString(terminal.SHA256)
	if e != nil || len(decoded) != 32 {
		return c, errRecovery
	}
	c.size = terminal.Bytes
	copy(c.digest[:], decoded)
	d3, e := hex.DecodeString(terminal.SHA3_512)
	if e != nil || len(d3) != 64 {
		return c, errRecovery
	}
	copy(c.sha3Digest[:], d3)
	d512, e := hex.DecodeString(terminal.SHA512)
	if e != nil || len(d512) != 64 {
		return c, errRecovery
	}
	copy(c.sha512Digest[:], d512)
	if e = c.body.current(s.directory); e != nil {
		return c, e
	}
	h := sha256.New()
	h3, h512 := sha3.New512(), sha512.New()
	n, e := io.Copy(io.MultiWriter(h, h3, h512), io.NewSectionReader(c.body.file, 0, c.size+1))
	if e != nil || n != c.size || !bytes.Equal(h.Sum(nil), c.digest[:]) || !bytes.Equal(h3.Sum(nil), c.sha3Digest[:]) || !bytes.Equal(h512.Sum(nil), c.sha512Digest[:]) {
		return c, errChanged
	}
	c.complete = true
	return c, nil
}
