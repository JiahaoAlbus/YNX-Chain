// Sole SDK shared DATA codec; Auth imports this package, not a second parser.
package socialprincipalstdio

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"unicode/utf8"
)

const MaxFrameBytes = 3149824
const maxSafe int64 = 9007199254740991

var ErrFrame = errors.New("SOCIAL_STDIO_FRAME_INVALID")

type Request struct {
	Version         int    `json:"version"`
	Sequence        string `json:"sequence"`
	Command         string `json:"command"`
	RequestOriginal string `json:"requestOriginal"`
	ReplayKey       string `json:"replayKey"`
	ProofExpiresMS  int64  `json:"proofExpiresMS"`
}
type ErrorDATA struct {
	Tag  string `json:"tag"`
	Code int32  `json:"code"`
}
type Response struct {
	Version      int       `json:"version"`
	Sequence     string    `json:"sequence"`
	Original     *string   `json:"original"`
	ErrorPresent bool      `json:"errorPresent"`
	Error        ErrorDATA `json:"error"`
	PhysicalDone bool      `json:"physicalDone"`
}

func sequence(s string) bool {
	n, e := strconv.ParseUint(s, 10, 64)
	return e == nil && strconv.FormatUint(n, 10) == s
}
func NextSequence(s string) (string, error) {
	if !sequence(s) || s == "18446744073709551615" {
		return "", ErrFrame
	}
	n, _ := strconv.ParseUint(s, 10, 64)
	return strconv.FormatUint(n+1, 10), nil
}
func text(s string, cap int, nonempty bool) bool {
	return utf8.ValidString(s) && len(s) <= cap && (!nonempty || len(s) > 0)
}
func ascii(s string, cap int) bool {
	if !text(s, cap, true) {
		return false
	}
	for _, b := range []byte(s) {
		if b < 33 || b > 126 {
			return false
		}
	}
	return true
}
func command(s string) bool {
	switch s {
	case "read", "current", "qualify", "retire", "join", "close":
		return true
	}
	return false
}
func validRequest(r Request) bool {
	if r.Version != 1 || !sequence(r.Sequence) || r.Sequence == "0" || !command(r.Command) || !text(r.RequestOriginal, 393216, false) || !text(r.ReplayKey, 512, false) || r.ProofExpiresMS < 0 || r.ProofExpiresMS > maxSafe {
		return false
	}
	if r.Command == "qualify" {
		return text(r.RequestOriginal, 393216, true) && ascii(r.ReplayKey, 512) && r.ProofExpiresMS > 0
	}
	return r.RequestOriginal == "" && r.ReplayKey == "" && r.ProofExpiresMS == 0
}
func validResponse(r Response, expected, cmd string) bool {
	if r.Version != 1 || !sequence(r.Sequence) || r.Sequence != expected || !sequence(expected) || !command(cmd) || r.PhysicalDone && cmd != "close" {
		return false
	}
	switch r.Error.Tag {
	case "none":
		if r.ErrorPresent || r.Error.Code != 0 {
			return false
		}
	case "code":
		if !r.ErrorPresent {
			return false
		}
	case "retained":
		if !r.ErrorPresent || r.Error.Code != 0 {
			return false
		}
	default:
		return false
	}
	if r.Original != nil && !text(*r.Original, 524288, true) {
		return false
	}
	if !r.ErrorPresent {
		if cmd == "read" || cmd == "qualify" {
			return r.Original != nil
		}
		return r.Original == nil
	}
	return true
}
func encode(v any) ([]byte, error) {
	b, e := json.Marshal(v)
	if e != nil || len(b)+1 > MaxFrameBytes {
		return nil, ErrFrame
	}
	return append(b, '\n'), nil
}
func decode(raw []byte, out any) error {
	if len(raw) == 0 || len(raw) > MaxFrameBytes || raw[len(raw)-1] != '\n' || !utf8.Valid(raw) {
		return ErrFrame
	}
	d := json.NewDecoder(bytes.NewReader(raw[:len(raw)-1]))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(new(any)) != io.EOF {
		return ErrFrame
	}
	encoded, e := encode(out)
	if e != nil || !bytes.Equal(encoded, raw) {
		return ErrFrame
	}
	return nil
}
func EncodeRequestFrame(r Request) ([]byte, error) {
	if !validRequest(r) {
		return nil, ErrFrame
	}
	return encode(r)
}
func DecodeRequestFrame(raw []byte) (Request, error) {
	var r Request
	if decode(raw, &r) != nil || !validRequest(r) {
		return r, ErrFrame
	}
	return r, nil
}
func EncodeResponseFrame(r Response, expected, cmd string) ([]byte, error) {
	if !validResponse(r, expected, cmd) {
		return nil, ErrFrame
	}
	return encode(r)
}
func DecodeResponseFrame(raw []byte, expected, cmd string) (Response, error) {
	var r Response
	if decode(raw, &r) != nil || !validResponse(r, expected, cmd) {
		return r, ErrFrame
	}
	return r, nil
}

// Expected fields remain strings. This code never reads signed profile epochs.
type ExpectedV4 struct {
	NetworkID          string  `json:"networkId"`
	CanonicalOwner     string  `json:"canonicalOwner"`
	Account            string  `json:"account"`
	SessionBinding     string  `json:"sessionBinding"`
	ProductID          string  `json:"productId"`
	ClientID           string  `json:"clientId"`
	Platform           string  `json:"platform"`
	ApplicationID      string  `json:"applicationId"`
	BundleID           *string `json:"bundleId"`
	PackageID          *string `json:"packageId"`
	Origin             string  `json:"origin"`
	Callback           string  `json:"callback"`
	DeviceID           string  `json:"deviceId"`
	Generation         string  `json:"generation"`
	RegistrationID     string  `json:"registrationId"`
	Revision           string  `json:"revision"`
	RegistrationDigest string  `json:"registrationDigest"`
}
type BindingOriginal struct {
	Version              string     `json:"version"`
	ProfileOriginal      string     `json:"profileOriginal"`
	RegistrationOriginal string     `json:"registrationOriginal"`
	ExpiresMS            int64      `json:"expiresMS"`
	Expected             ExpectedV4 `json:"expected"`
	DataOnly             bool       `json:"dataOnly"`
	RootAdmission        bool       `json:"RootAdmission"`
	V4Authentication     bool       `json:"V4Authentication"`
}
type QualifiedOriginal struct {
	Version               string `json:"version"`
	ProfileOriginal       string `json:"profileOriginal"`
	RegistrationOriginal  string `json:"registrationOriginal"`
	RequestOriginalSHA256 string `json:"requestOriginalSHA256"`
	ProofReplayKey        string `json:"proofReplayKey"`
	ExpiresMS             int64  `json:"expiresMS"`
	DataOnly              bool   `json:"dataOnly"`
	RootAdmission         bool   `json:"RootAdmission"`
	V4Authentication      bool   `json:"V4Authentication"`
}

func validExpected(e ExpectedV4) bool {
	for _, s := range []string{e.NetworkID, e.CanonicalOwner, e.Account, e.SessionBinding, e.ProductID, e.ClientID, e.Platform, e.ApplicationID, e.Origin, e.Callback, e.DeviceID, e.Generation, e.RegistrationID, e.Revision, e.RegistrationDigest} {
		if !text(s, 2048, true) {
			return false
		}
	}
	for _, s := range []*string{e.BundleID, e.PackageID} {
		if s != nil && !text(*s, 2048, true) {
			return false
		}
	}
	return e.ProductID == "social" && sequence(e.Generation) && e.Generation != "0" && sequence(e.Revision) && e.Revision != "0"
}
func validOriginal(profile, registration string, expires int64, data, root, v4 bool) bool {
	return text(profile, 65536, true) && text(registration, 65536, true) && expires > 0 && expires <= maxSafe && data && !root && !v4
}
func digest(s string) bool {
	if len(s) != 64 {
		return false
	}
	for _, b := range []byte(s) {
		if !(b >= 'a' && b <= 'f' || b >= '0' && b <= '9') {
			return false
		}
	}
	return true
}
func decodeOriginal(raw string, out any) error {
	if !text(raw, 524288, true) {
		return ErrFrame
	}
	return decode(append([]byte(raw), '\n'), out)
}
func DecodeBindingOriginal(raw string) (BindingOriginal, error) {
	var o BindingOriginal
	if decodeOriginal(raw, &o) != nil || o.Version != "YNX-SOCIAL-JOINT-PROFILE-ORIGINAL/v1" || !validOriginal(o.ProfileOriginal, o.RegistrationOriginal, o.ExpiresMS, o.DataOnly, o.RootAdmission, o.V4Authentication) || !validExpected(o.Expected) {
		return o, ErrFrame
	}
	return o, nil
}
func DecodeQualifiedOriginal(raw string) (QualifiedOriginal, error) {
	var o QualifiedOriginal
	if decodeOriginal(raw, &o) != nil || o.Version != "YNX-SOCIAL-DIRECTORY-PRINCIPAL-ORIGINAL/v1" || !validOriginal(o.ProfileOriginal, o.RegistrationOriginal, o.ExpiresMS, o.DataOnly, o.RootAdmission, o.V4Authentication) || !digest(o.RequestOriginalSHA256) || !ascii(o.ProofReplayKey, 512) {
		return o, ErrFrame
	}
	return o, nil
}

// ReadFrame returns partial raw bytes with any failure, so a real owner can
// retain originals before interpreting error. EOF is never physicalDone.
type FrameReader struct{ r *bufio.Reader }

func NewFrameReader(r io.Reader) *FrameReader { return &FrameReader{bufio.NewReaderSize(r, 4096)} }
func (r *FrameReader) ReadFrame() ([]byte, error) {
	var out []byte
	for {
		part, e := r.r.ReadSlice('\n')
		if len(out)+len(part) > MaxFrameBytes {
			return out, ErrFrame
		}
		out = append(out, part...)
		if e == nil {
			return out, nil
		}
		if e == bufio.ErrBufferFull {
			continue
		}
		if len(out) > 0 {
			return out, ErrFrame
		}
		return out, e
	}
}
func WriteFrame(w io.Writer, raw []byte) error {
	if len(raw) == 0 || len(raw) > MaxFrameBytes || raw[len(raw)-1] != '\n' {
		return ErrFrame
	}
	n, e := w.Write(raw)
	if e != nil {
		return e
	}
	if n != len(raw) {
		return io.ErrShortWrite
	}
	return nil
}

// No error string or stack crosses the pipe. Caller retains the actual local
// first error; optional numeric original code is separate from its presence.
func ErrorFromLocal(err error, originalCode *int32) (bool, ErrorDATA) {
	if err == nil {
		return false, ErrorDATA{"none", 0}
	}
	if originalCode != nil {
		return true, ErrorDATA{"code", *originalCode}
	}
	return true, ErrorDATA{"retained", 0}
}
