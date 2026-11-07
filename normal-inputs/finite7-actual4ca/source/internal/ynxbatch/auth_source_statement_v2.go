package ynxbatch

import (
	"bytes"
	"encoding/hex"
	"strconv"
	"strings"
	"unicode/utf8"
)

// AuthSourceStatementV2Domain is the existing Auth Source-v2 transcript domain.
// This codec supplies public DATA only. It does not interpret a product schema,
// admit a Root, acquire registration/current/floor, or grant Source authority.
const AuthSourceStatementV2Domain = "YNX/AUTH/SOURCE-ORIGINAL/V2"
const AuthSourceStatementV2BodyMaximum = 65536
const AuthSourceStatementV2MemberMaximum = 262144
const AuthSourceStatementV2MessageMaximum = 4 + 8*4 + len(AuthSourceStatementV2Domain) + len("enrollment") + 512 + 64 + 42 + 20 + 20 + AuthSourceStatementV2BodyMaximum

type AuthSourceStatementV2Role uint32

const (
	AuthSourceEnrollmentV2 AuthSourceStatementV2Role = 1
	AuthSourceProfileV2    AuthSourceStatementV2Role = 2
	AuthSourceCurrentV2    AuthSourceStatementV2Role = 3
)

// Frame must come from the same independently admitted immutable release row.
// There is intentionally no default frame or arbitrary purpose override.
type AuthSourceStatementV2Binding struct {
	Role                     AuthSourceStatementV2Role
	Frame                    string
	NetworkID                []byte
	Owner                    string
	KeyVersion, IssuedHeight uint64
}

func AuthSourceStatementV2Purpose(role AuthSourceStatementV2Role) (string, error) {
	switch role {
	case AuthSourceEnrollmentV2:
		return "AUTH-SOURCE-ENROLLMENT", nil
	case AuthSourceProfileV2:
		return "AUTH-SOURCE-PROFILE", nil
	case AuthSourceCurrentV2:
		return "AUTH-SOURCE-CURRENT", nil
	default:
		return "", invalid("Source-v2 fixed role")
	}
}

// BuildAuthSourceStatementV2 reproduces the original E8 exactly. Network,
// revision and height are TEXT fields in this protocol (not raw/U64 fields).
// Canonical body bytes are preserved, never reserialized. This performs JSON
// spelling checks only; the sole SDK retains all product and Root policy checks.
func BuildAuthSourceStatementV2(body []byte, b AuthSourceStatementV2Binding) ([]byte, error) {
	if _, err := AuthSourceStatementV2Purpose(b.Role); err != nil {
		return nil, err
	}
	if len(b.Frame) == 0 || len(b.Frame) > 512 || !utf8.ValidString(b.Frame) || strings.ContainsRune(b.Frame, 0) ||
		len(b.NetworkID) != 32 || len(b.Owner) != 42 || !strings.HasPrefix(b.Owner, "0x") || !productDeviceV4Hex(b.Owner[2:], 20) || b.KeyVersion == 0 ||
		len(body) == 0 || len(body) > AuthSourceStatementV2BodyMaximum || !utf8.Valid(body) || !productPairPendingCanonicalJSON(body) {
		return nil, invalid("Source-v2 statement DATA binding")
	}
	role := []string{"", "enrollment", "profile", "current"}[b.Role]
	return EncodeFields([]byte(AuthSourceStatementV2Domain), []byte(role), []byte(b.Frame), []byte(hex.EncodeToString(b.NetworkID)), []byte(b.Owner),
		[]byte(strconv.FormatUint(b.KeyVersion, 10)), []byte(strconv.FormatUint(b.IssuedHeight, 10)), body)
}

func InspectAuthSourceStatementV2(message, body []byte, b AuthSourceStatementV2Binding) error {
	if len(message) > AuthSourceStatementV2MessageMaximum {
		return invalid("Source-v2 E8 capacity")
	}
	expected, err := BuildAuthSourceStatementV2(body, b)
	if err != nil {
		return err
	}
	if !bytes.Equal(message, expected) {
		return invalid("Source-v2 exact E8 binding")
	}
	return nil
}
