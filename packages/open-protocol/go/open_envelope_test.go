package openprotocol

import (
	"bytes"
	"encoding/hex"
	"testing"
)

func TestOPEN02ActualPublicEntry(t *testing.T) {
	c := challengeInput(t, challengeVectors(t)[0])
	wire, _ := EncodeIdentityChallengeV1DATA(c)
	all, _ := DecodeFields(wire, 11)
	ctx := OpenCtxV1{Realm: hex.EncodeToString(c.Realm), Tenant: hex.EncodeToString(c.Tenant), ActorEpoch: "0", TraceID: "trace-open02", RequestID: "req-open02"}
	r := EncodeOpenEnvelope(ctx, IdentityChallengeDomain, ctx.Realm, all[2:])
	if !r.OK || !bytes.Equal(r.Value, wire) {
		t.Fatal("actual entry differs")
	}
	if r = EncodeOpenEnvelope(ctx, "YNX-OPEN/IDENTITY-CONTROLLER/1", ctx.Realm, all[2:]); r.OK || r.Code != "UNSUPPORTED" {
		t.Fatal("unfrozen profile accepted")
	}
	ctx.Tenant = "00000000000000000000000000000000"
	if r = EncodeOpenEnvelope(ctx, IdentityChallengeDomain, ctx.Realm, all[2:]); r.OK || r.Code != "INVALID" {
		t.Fatal("wrong tenant accepted")
	}
}
