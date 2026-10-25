package developerauthority

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"sort"
	"strconv"
)

// JS canonical outer transport only. Opaque signed originals stay byte-exact.
// In particular U+2028 and literal backslash-u are not interchanged.
func originalIDEJSON(v any) ([]byte, error) {
	raw, e := json.Marshal(v)
	if e != nil {
		return nil, ErrDenied
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var x any
	if d.Decode(&x) != nil {
		return nil, ErrDenied
	}
	var out bytes.Buffer
	var put func(any) error
	put = func(v any) error {
		switch y := v.(type) {
		case nil:
			out.WriteString("null")
		case bool:
			out.WriteString(strconv.FormatBool(y))
		case json.Number:
			out.WriteString(string(y))
		case string:
			s, ok := originalApprovalTransportString(y)
			if !ok {
				return ErrDenied
			}
			out.WriteString(s)
		case []any:
			out.WriteByte('[')
			for i, z := range y {
				if i > 0 {
					out.WriteByte(',')
				}
				if e := put(z); e != nil {
					return e
				}
			}
			out.WriteByte(']')
		case map[string]any:
			keys := make([]string, 0, len(y))
			for k := range y {
				keys = append(keys, k)
			}
			sort.Strings(keys)
			out.WriteByte('{')
			for i, k := range keys {
				if i > 0 {
					out.WriteByte(',')
				}
				s, _ := originalApprovalTransportString(k)
				out.WriteString(s)
				out.WriteByte(':')
				if e := put(y[k]); e != nil {
					return e
				}
			}
			out.WriteByte('}')
		default:
			return ErrDenied
		}
		return nil
	}
	if e = put(x); e != nil {
		return nil, e
	}
	return out.Bytes(), nil
}

// HTTP envelope is canonical base64url text. Decode once for the SDK. The
// caller's SignatureSHA256 remains hash(original HTTP text), not Member hash.
func originalIDEArtifactMember(wire []byte) ([]byte, error) {
	if len(wire) == 0 || len(wire) > 131072 {
		return nil, ErrDenied
	}
	b, e := base64.RawURLEncoding.DecodeString(string(wire))
	if e != nil || len(b) == 0 || len(b) > 98304 || base64.RawURLEncoding.EncodeToString(b) != string(wire) {
		return nil, ErrDenied
	}
	return b, nil
}
func originalIDEPrincipal(p Principal) map[string]string {
	return map[string]string{"account": p.Account, "deviceId": p.DeviceID, "sessionRef": p.SessionRef, "currentRef": p.CurrentRef, "accountGeneration": strconv.FormatUint(p.AccountGeneration, 10), "sessionGeneration": strconv.FormatUint(p.SessionGeneration, 10), "expiresMS": strconv.FormatInt(p.ExpiresMS, 10)}
}
func originalIDECommand(c Command) map[string]any {
	return map[string]any{"RequestID": c.RequestID, "Action": c.Action, "ProjectID": c.ProjectID, "TeamID": c.TeamID, "SubjectAccount": c.SubjectAccount, "PublisherID": c.PublisherID, "RuntimeOrigin": c.RuntimeOrigin, "ExpectedRevision": strconv.FormatUint(c.ExpectedRevision, 10), "GrantExpiresMS": strconv.FormatInt(c.GrantExpiresMS, 10), "Read": c.Read, "Publish": c.Publish, "Runtime": c.Runtime, "Revoke": c.Revoke, "ExpiresMS": strconv.FormatInt(c.ExpiresMS, 10), "PublicOriginalSHA256": c.PublicOriginalSHA256}
}
func originalIDEStrict(raw []byte, out any) error {
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil {
		return ErrDenied
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return ErrDenied
	}
	return nil
}
