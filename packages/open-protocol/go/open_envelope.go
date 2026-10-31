package openprotocol

import (
	"bytes"
	"encoding/hex"
	"strconv"
)

type OpenCtxV1 struct {
	Realm, Tenant, ActorEpoch, TraceID, RequestID string
	Actor                                         *string
}
type OpenEncodeResultV1 struct {
	OK              bool
	Value           []byte
	Code, RequestID string
}

func openID(s string) ([]byte, error) {
	if len(s) != 32 {
		return nil, ErrInvalid
	}
	for _, c := range s {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return nil, ErrInvalid
		}
	}
	b, e := hex.DecodeString(s)
	if e != nil {
		return nil, ErrInvalid
	}
	return b, nil
}
func openDisplay(s string) bool {
	if len(s) < 1 || len(s) > 128 {
		return false
	}
	for _, c := range []byte(s) {
		if c < 32 || c > 126 {
			return false
		}
	}
	return true
}

// EncodeOpenEnvelope only supports the explicit typed challenge profile.
// Success binds DATA to ctx, never account authority or trusted channel state.
func EncodeOpenEnvelope(ctx OpenCtxV1, domain, realm string, fields [][]byte) OpenEncodeResultV1 {
	bad := func(code string) OpenEncodeResultV1 { return OpenEncodeResultV1{Code: code, RequestID: ctx.RequestID} }
	realmBytes, e := openID(ctx.Realm)
	if e != nil {
		return bad("INVALID")
	}
	tenant, e := openID(ctx.Tenant)
	if e != nil {
		return bad("INVALID")
	}
	if ctx.Actor != nil {
		if _, e = openID(*ctx.Actor); e != nil {
			return bad("INVALID")
		}
	}
	epoch, e := strconv.ParseUint(ctx.ActorEpoch, 10, 64)
	if e != nil || strconv.FormatUint(epoch, 10) != ctx.ActorEpoch || !openDisplay(ctx.TraceID) || !openDisplay(ctx.RequestID) {
		return bad("INVALID")
	}
	if domain != IdentityChallengeDomain {
		return bad("UNSUPPORTED")
	}
	if realm != ctx.Realm || len(fields) != 9 {
		return bad("INVALID")
	}
	all := [][]byte{[]byte(domain), realmBytes}
	all = append(all, fields...)
	wire, e := EncodeFields(all...)
	if e != nil {
		if e == ErrBounds {
			return bad("BOUNDS")
		}
		return bad("INVALID")
	}
	c, e := DecodeIdentityChallengeV1DATA(wire)
	if e != nil || !bytes.Equal(c.Tenant, tenant) || !bytes.Equal(c.Realm, realmBytes) {
		return bad("INVALID")
	}
	return OpenEncodeResultV1{OK: true, Value: wire}
}
