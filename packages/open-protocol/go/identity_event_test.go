package openprotocol

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"
	"testing"
)

type eventInputVector struct {
	IDHex                      string
	Subject                    struct{ RealmHex, TenantHex, Kind, IDHex, Rev string }
	Action, FromEpoch, ToEpoch string
	NewPair                    *struct{ Suite, PKAHex, PKBHex string }
	TrustIDHex, PolicyIDHex    string
	PreviousHex                *string
	Bound                      struct{ Bytes, SHA3_512Hex, SHA512Hex string }
}
type eventVector struct {
	Input   eventInputVector
	WireHex string
}
type roleVector struct {
	Input struct {
		Role, RealmHex, Action, AudienceHex, EventAction, NonceHex, NotAfter, ExpectedEpoch, NextEpoch string
		NetworkBinding                                                                                 struct{ Kind, GenesisHex, NativeChainID, NetworkIDHex string }
	}
	WireHex string
}
type eventVectorSet struct {
	Events         []eventVector
	Authorizations []roleVector
}

func eventVectors(t *testing.T) eventVectorSet {
	t.Helper()
	var out eventVectorSet
	raw, e := os.ReadFile("../test/fixtures/identity-event-v1.json")
	if e != nil {
		t.Fatal(e)
	}
	if e = json.Unmarshal(raw, &out); e != nil {
		t.Fatal(e)
	}
	return out
}
func eventHX(t *testing.T, s string) []byte {
	t.Helper()
	b, e := hex.DecodeString(s)
	if e != nil {
		t.Fatal(e)
	}
	return b
}
func eventU(t *testing.T, s string) uint64 {
	t.Helper()
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil {
		t.Fatal(e)
	}
	return n
}
func eventInput(t *testing.T, v eventInputVector) IdentityEventV1DATA {
	t.Helper()
	e := IdentityEventV1DATA{ID: eventHX(t, v.IDHex), Subject: IdentitySubjectV1DATA{Realm: eventHX(t, v.Subject.RealmHex), Tenant: eventHX(t, v.Subject.TenantHex), Kind: v.Subject.Kind, ID: eventHX(t, v.Subject.IDHex), Rev: eventU(t, v.Subject.Rev)}, Action: v.Action, FromEpoch: eventU(t, v.FromEpoch), ToEpoch: eventU(t, v.ToEpoch), TrustID: eventHX(t, v.TrustIDHex), PolicyID: eventHX(t, v.PolicyIDHex), Bound: IdentityBoundV1DATA{Length: eventU(t, v.Bound.Bytes), SHA3_512: eventHX(t, v.Bound.SHA3_512Hex), SHA512: eventHX(t, v.Bound.SHA512Hex)}}
	if v.NewPair != nil {
		e.NewPair = &IdentityPairV1DATA{Suite: v.NewPair.Suite, PKA: eventHX(t, v.NewPair.PKAHex), PKB: eventHX(t, v.NewPair.PKBHex)}
	}
	if v.PreviousHex != nil {
		e.Previous = eventHX(t, *v.PreviousHex)
	}
	return e
}
func roleInput(t *testing.T, v roleVector, set eventVectorSet) IdentityRoleAuthorizationV1DATA {
	t.Helper()
	i := v.Input
	r := IdentityRoleAuthorizationV1DATA{Role: i.Role, Realm: eventHX(t, i.RealmHex), Action: i.Action, Audience: eventHX(t, i.AudienceHex), Nonce: eventHX(t, i.NonceHex), NotAfter: eventU(t, i.NotAfter), ExpectedEpoch: eventU(t, i.ExpectedEpoch), NextEpoch: eventU(t, i.NextEpoch), NetworkBinding: NetworkBindingV1{Kind: i.NetworkBinding.Kind}}
	if r.NetworkBinding.Kind == "ynx-chain" {
		r.NetworkBinding.Genesis = eventHX(t, i.NetworkBinding.GenesisHex)
		r.NetworkBinding.NativeChainID = eventU(t, i.NetworkBinding.NativeChainID)
		r.NetworkBinding.NetworkID = eventHX(t, i.NetworkBinding.NetworkIDHex)
	}
	for _, e := range set.Events {
		if e.Input.Action == i.EventAction {
			r.EventOriginal = eventHX(t, e.WireHex)
		}
	}
	return r
}
func TestOPEN02IdentityEventRoleSharedVectors(t *testing.T) {
	v := eventVectors(t)
	for _, x := range v.Events {
		got, e := EncodeIdentityEventV1DATA(eventInput(t, x.Input))
		if e != nil || hex.EncodeToString(got) != x.WireHex {
			t.Fatalf("%s event vector differs: %v", x.Input.Action, e)
		}
		parsed, e := DecodeIdentityEventV1DATA(got)
		if e != nil || parsed.Subject.Rev != 9007199254740993 {
			t.Fatal("event decode/revision")
		}
		again, e := EncodeIdentityEventV1DATA(parsed)
		if e != nil || !bytes.Equal(again, got) {
			t.Fatal("event roundtrip")
		}
	}
	for _, x := range v.Authorizations {
		got, e := EncodeIdentityRoleAuthorizationV1DATA(roleInput(t, x, v))
		if e != nil || hex.EncodeToString(got) != x.WireHex {
			t.Fatalf("%s role vector differs: %v", x.Input.Role, e)
		}
		r, e := DecodeIdentityRoleAuthorizationV1DATA(got)
		if e != nil {
			t.Fatal(e)
		}
		again, e := EncodeIdentityRoleAuthorizationV1DATA(r)
		if e != nil || !bytes.Equal(again, got) {
			t.Fatal("role roundtrip")
		}
	}
}
func TestOPEN02IdentityEventEpochsAndPresence(t *testing.T) {
	v := eventVectors(t)
	for _, x := range v.Events {
		e := eventInput(t, x.Input)
		bad := e
		if e.Action == "register" {
			bad.ToEpoch = 2
		} else {
			bad.FromEpoch = 0
			bad.ToEpoch = 1
		}
		if _, err := EncodeIdentityEventV1DATA(bad); err == nil {
			t.Fatal("bad generation")
		}
		if e.Action != "register" {
			bad = e
			bad.FromEpoch = ^uint64(0)
			bad.ToEpoch = 0
			if _, err := EncodeIdentityEventV1DATA(bad); err == nil {
				t.Fatal("overflow generation")
			}
		}
		bad = e
		if e.NewPair == nil {
			bad.NewPair = eventInput(t, v.Events[0].Input).NewPair
		} else {
			bad.NewPair = nil
		}
		if _, err := EncodeIdentityEventV1DATA(bad); err == nil {
			t.Fatal("wrong pair presence")
		}
		bad = e
		if e.Previous == nil {
			bad.Previous = make([]byte, 16)
		} else {
			bad.Previous = nil
		}
		if _, err := EncodeIdentityEventV1DATA(bad); err == nil {
			t.Fatal("wrong previous presence")
		}
	}
}
func TestOPEN02IdentityRoleBindingsAndPurpose(t *testing.T) {
	v := eventVectors(t)
	for _, x := range v.Authorizations {
		r := roleInput(t, x, v)
		wrong := r
		wrong.ExpectedEpoch++
		if _, e := EncodeIdentityRoleAuthorizationV1DATA(wrong); e == nil {
			t.Fatal("wrong epoch binding")
		}
		wrong = r
		wrong.Realm = make([]byte, 16)
		if _, e := EncodeIdentityRoleAuthorizationV1DATA(wrong); e == nil {
			t.Fatal("wrong realm")
		}
		wrong = r
		wrong.Action = "unknown"
		if _, e := EncodeIdentityRoleAuthorizationV1DATA(wrong); e == nil {
			t.Fatal("wrong action")
		}
	}
	for _, x := range v.Authorizations {
		r := roleInput(t, x, v)
		if r.Action == "recover" {
			r.Role = "oldPair"
			if _, e := EncodeIdentityRoleAuthorizationV1DATA(r); e == nil {
				t.Fatal("old pair recovery bypass")
			}
		}
		if r.Action == "revoke" || r.Action == "suspend" {
			r.Role = "newPoP"
			if _, e := EncodeIdentityRoleAuthorizationV1DATA(r); e == nil {
				t.Fatal("wrong role")
			}
		}
	}
}
func TestOPEN02IdentityEventRoleMalformed(t *testing.T) {
	v := eventVectors(t)
	event := eventHX(t, v.Events[0].WireHex)
	for _, bad := range [][]byte{event[:len(event)-1], append(append([]byte{}, event...), 0)} {
		if _, e := DecodeIdentityEventV1DATA(bad); e == nil {
			t.Fatal("event malformed")
		}
	}
	f, _ := DecodeFields(event, 10)
	f[8], _ = EncodeFields([]byte{2})
	bad, _ := EncodeFields(f...)
	if _, e := DecodeIdentityEventV1DATA(bad); e == nil {
		t.Fatal("unknown presence tag")
	}
	role := eventHX(t, v.Authorizations[0].WireHex)
	f, _ = DecodeFields(role, 10)
	f[0], f[1] = f[1], f[0]
	bad, _ = EncodeFields(f...)
	if _, e := DecodeIdentityRoleAuthorizationV1DATA(bad); e == nil {
		t.Fatal("role reordered")
	}
	if _, e := DecodeIdentityRoleAuthorizationV1DATA(append(role, 0)); e == nil {
		t.Fatal("role trailing")
	}
}
func TestOPEN02IdentityRolesActualPublicEntry(t *testing.T) {
	v := eventVectors(t)
	for _, x := range v.Authorizations {
		r := roleInput(t, x, v)
		wire := eventHX(t, x.WireHex)
		all, _ := DecodeFields(wire, 10)
		e, _ := DecodeIdentityEventV1DATA(r.EventOriginal)
		ctx := OpenCtxV1{Realm: hex.EncodeToString(r.Realm), Tenant: hex.EncodeToString(e.Subject.Tenant), ActorEpoch: "0", TraceID: "event-trace", RequestID: "event-request"}
		got := EncodeOpenEnvelope(ctx, roleDomain(r.Role), ctx.Realm, all[2:])
		if !got.OK || !bytes.Equal(got.Value, wire) {
			t.Fatal("actual public role entry")
		}
		ctx.Tenant = "00000000000000000000000000000000"
		if EncodeOpenEnvelope(ctx, roleDomain(r.Role), ctx.Realm, all[2:]).Code != "INVALID" {
			t.Fatal("public context tenant mismatch")
		}
	}
}
