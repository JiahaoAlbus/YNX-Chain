//go:build darwin || linux

package grantruntime

import (
	"bytes"
	"encoding/json"
	"io"
	"strconv"
)

// Private transport metadata only; does not encode any Source signature/body.
// Above JS MAX_SAFE_INTEGER a new original is decimal-string metadata. Existing
// exact safe numeric originals retain their byte spelling; nothing is rounded.
func (d receiverDirectory) MarshalJSON() ([]byte, error) {
	value := func(n uint64, original string) json.RawMessage {
		if original != "" {
			return json.RawMessage(original)
		}
		s := strconv.FormatUint(n, 10)
		if n > 9007199254740991 {
			s = strconv.Quote(s)
		}
		return json.RawMessage(s)
	}
	v := struct {
		Path           string
		Device, Inode  json.RawMessage
		UID, GID, Mode uint32
	}{d.Path, value(d.Device, d.deviceJSON), value(d.Inode, d.inodeJSON), d.UID, d.GID, d.Mode}
	return json.Marshal(v)
}
func (d *receiverDirectory) UnmarshalJSON(raw []byte) error {
	var v struct {
		Path           string
		Device, Inode  json.RawMessage
		UID, GID, Mode uint32
	}
	j := json.NewDecoder(bytes.NewReader(raw))
	j.DisallowUnknownFields()
	if j.Decode(&v) != nil || j.Decode(new(any)) != io.EOF {
		return ErrProof
	}
	read := func(b json.RawMessage) (uint64, string, error) {
		text := string(b)
		s := text
		if len(text) > 0 && text[0] == '"' {
			if json.Unmarshal(b, &s) != nil {
				return 0, "", ErrProof
			}
		}
		n, e := strconv.ParseUint(s, 10, 64)
		if e != nil || strconv.FormatUint(n, 10) != s {
			return 0, "", ErrProof
		}
		if len(text) == 0 || text[0] != '"' && n > 9007199254740991 {
			return 0, "", ErrProof
		}
		return n, text, nil
	}
	a, aj, e := read(v.Device)
	if e != nil {
		return e
	}
	b, bj, e := read(v.Inode)
	if e != nil {
		return e
	}
	*d = receiverDirectory{Path: v.Path, Device: a, Inode: b, UID: v.UID, GID: v.GID, Mode: v.Mode, deviceJSON: aj, inodeJSON: bj}
	return nil
}
