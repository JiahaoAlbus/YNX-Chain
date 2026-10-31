package openprotocol

import (
	"bytes"
	"encoding/binary"
)

const IdentityEventSchema = "YNX-OPEN/IDENTITY-EVENT/1"
const IdentityControllerDomain = "YNX-OPEN/IDENTITY-CONTROLLER/1"
const IdentityOldPairDomain = "YNX-OPEN/IDENTITY-OLD-PAIR/1"
const IdentityNewPoPDomain = "YNX-OPEN/IDENTITY-NEW-POP/1"
const IdentityRecoveryDomain = "YNX-OPEN/IDENTITY-RECOVERY/1"

type IdentitySubjectV1DATA struct {
	Realm, Tenant, ID []byte
	Kind              string
	Rev               uint64
}
type IdentityPairV1DATA struct {
	Suite    string
	PKA, PKB []byte
}
type IdentityBoundV1DATA struct {
	Length           uint64
	SHA3_512, SHA512 []byte
}
type IdentityEventV1DATA struct {
	ID                          []byte
	Subject                     IdentitySubjectV1DATA
	Action                      string
	FromEpoch, ToEpoch          uint64
	NewPair                     *IdentityPairV1DATA
	TrustID, PolicyID, Previous []byte
	Bound                       IdentityBoundV1DATA
}
type IdentityRoleAuthorizationV1DATA struct {
	Role                               string
	Realm                              []byte
	NetworkBinding                     NetworkBindingV1
	Action                             string
	Audience, EventOriginal, Nonce     []byte
	NotAfter, ExpectedEpoch, NextEpoch uint64
}

func identityAction(a string) bool {
	switch a {
	case "register", "rotate", "suspend", "revoke", "recover":
		return true
	}
	return false
}
func roleDomain(role string) string {
	switch role {
	case "controller":
		return IdentityControllerDomain
	case "oldPair":
		return IdentityOldPairDomain
	case "newPoP":
		return IdentityNewPoPDomain
	case "recovery":
		return IdentityRecoveryDomain
	}
	return ""
}
func domainRole(domain string) string {
	for _, r := range []string{"controller", "oldPair", "newPoP", "recovery"} {
		if roleDomain(r) == domain {
			return r
		}
	}
	return ""
}
func allowedRole(action, role string) bool {
	switch action {
	case "register":
		return role == "controller" || role == "newPoP"
	case "rotate":
		return role == "controller" || role == "oldPair" || role == "newPoP"
	case "suspend", "revoke":
		return role == "controller"
	case "recover":
		return role == "recovery" || role == "newPoP"
	}
	return false
}
func identityEpochs(a string, from, to uint64) bool {
	if a == "register" {
		return from == 0 && to == 1
	}
	return from >= 1 && from != ^uint64(0) && to == from+1
}
func encodeIdentitySubject(s IdentitySubjectV1DATA) ([]byte, error) {
	if len(s.Realm) != 16 || len(s.Tenant) != 16 || len(s.ID) != 16 || s.Kind != "agent" {
		return nil, ErrInvalid
	}
	return EncodeFields(s.Realm, s.Tenant, []byte("agent"), s.ID, openU64(s.Rev))
}
func decodeIdentitySubject(w []byte) (IdentitySubjectV1DATA, error) {
	var s IdentitySubjectV1DATA
	f, e := DecodeFields(w, 5)
	if e != nil {
		return s, e
	}
	r, e := readOpenU64(f[4])
	if e != nil {
		return s, e
	}
	s = IdentitySubjectV1DATA{Realm: f[0], Tenant: f[1], Kind: string(f[2]), ID: f[3], Rev: r}
	if _, e = encodeIdentitySubject(s); e != nil {
		return IdentitySubjectV1DATA{}, e
	}
	return s, nil
}
func encodeIdentityPair(p *IdentityPairV1DATA) ([]byte, error) {
	if p == nil {
		return EncodeFields([]byte{0})
	}
	if p.Suite != "YNX-BATCH/v0.1" || len(p.PKA) != 2592 || len(p.PKB) != 64 {
		return nil, ErrInvalid
	}
	return EncodeFields([]byte{1}, []byte(p.Suite), p.PKA, p.PKB)
}
func decodeIdentityPair(w []byte) (*IdentityPairV1DATA, error) {
	if len(w) < 4 {
		return nil, ErrInvalid
	}
	if binary.BigEndian.Uint32(w) == 1 {
		f, e := DecodeFields(w, 1)
		if e != nil || !bytes.Equal(f[0], []byte{0}) {
			return nil, ErrInvalid
		}
		return nil, nil
	}
	f, e := DecodeFields(w, 4)
	if e != nil || !bytes.Equal(f[0], []byte{1}) {
		return nil, ErrInvalid
	}
	p := &IdentityPairV1DATA{Suite: string(f[1]), PKA: f[2], PKB: f[3]}
	if _, e = encodeIdentityPair(p); e != nil {
		return nil, e
	}
	return p, nil
}
func encodePrevious(p []byte) ([]byte, error) {
	if p == nil {
		return EncodeFields([]byte{0})
	}
	if len(p) != 16 {
		return nil, ErrInvalid
	}
	return EncodeFields([]byte{1}, p)
}
func decodePrevious(w []byte) ([]byte, error) {
	if len(w) < 4 {
		return nil, ErrInvalid
	}
	if binary.BigEndian.Uint32(w) == 1 {
		f, e := DecodeFields(w, 1)
		if e != nil || !bytes.Equal(f[0], []byte{0}) {
			return nil, ErrInvalid
		}
		return nil, nil
	}
	f, e := DecodeFields(w, 2)
	if e != nil || !bytes.Equal(f[0], []byte{1}) || len(f[1]) != 16 {
		return nil, ErrInvalid
	}
	return f[1], nil
}

// EncodeIdentityEventV1DATA checks syntax/epoch/presence only. Rev is not
// silently interpreted as an epoch. Current trust/head and policy remain Auth.
func EncodeIdentityEventV1DATA(e IdentityEventV1DATA) ([]byte, error) {
	if len(e.ID) != 16 || !identityAction(e.Action) || !identityEpochs(e.Action, e.FromEpoch, e.ToEpoch) || len(e.TrustID) != 16 || len(e.PolicyID) != 16 || len(e.Bound.SHA3_512) != 64 || len(e.Bound.SHA512) != 64 {
		return nil, ErrInvalid
	}
	wants := e.Action == "register" || e.Action == "rotate" || e.Action == "recover"
	if (e.NewPair != nil) != wants || (e.Previous == nil) != (e.Action == "register") {
		return nil, ErrInvalid
	}
	subject, err := encodeIdentitySubject(e.Subject)
	if err != nil {
		return nil, err
	}
	pair, err := encodeIdentityPair(e.NewPair)
	if err != nil {
		return nil, err
	}
	previous, err := encodePrevious(e.Previous)
	if err != nil {
		return nil, err
	}
	bound, err := EncodeFields(openU64(e.Bound.Length), e.Bound.SHA3_512, e.Bound.SHA512)
	if err != nil {
		return nil, err
	}
	return EncodeFields(e.ID, subject, []byte(e.Action), openU64(e.FromEpoch), openU64(e.ToEpoch), pair, e.TrustID, e.PolicyID, previous, bound)
}
func DecodeIdentityEventV1DATA(w []byte) (IdentityEventV1DATA, error) {
	var out IdentityEventV1DATA
	f, e := DecodeFields(w, 10)
	if e != nil {
		return out, e
	}
	subject, e := decodeIdentitySubject(f[1])
	if e != nil {
		return out, e
	}
	from, e := readOpenU64(f[3])
	if e != nil {
		return out, e
	}
	to, e := readOpenU64(f[4])
	if e != nil {
		return out, e
	}
	pair, e := decodeIdentityPair(f[5])
	if e != nil {
		return out, e
	}
	previous, e := decodePrevious(f[8])
	if e != nil {
		return out, e
	}
	b, e := DecodeFields(f[9], 3)
	if e != nil {
		return out, e
	}
	length, e := readOpenU64(b[0])
	if e != nil {
		return out, e
	}
	out = IdentityEventV1DATA{ID: f[0], Subject: subject, Action: string(f[2]), FromEpoch: from, ToEpoch: to, NewPair: pair, TrustID: f[6], PolicyID: f[7], Previous: previous, Bound: IdentityBoundV1DATA{Length: length, SHA3_512: b[1], SHA512: b[2]}}
	canonical, e := EncodeIdentityEventV1DATA(out)
	if e != nil || !bytes.Equal(canonical, w) {
		return IdentityEventV1DATA{}, ErrInvalid
	}
	return out, nil
}
func EncodeIdentityRoleAuthorizationV1DATA(r IdentityRoleAuthorizationV1DATA) ([]byte, error) {
	if !allowedRole(r.Action, r.Role) || len(r.Realm) != 16 || len(r.Audience) != 16 || len(r.Nonce) != 32 {
		return nil, ErrInvalid
	}
	event, e := DecodeIdentityEventV1DATA(r.EventOriginal)
	if e != nil {
		return nil, e
	}
	if !bytes.Equal(event.Subject.Realm, r.Realm) || event.Action != r.Action || event.FromEpoch != r.ExpectedEpoch || event.ToEpoch != r.NextEpoch {
		return nil, ErrInvalid
	}
	network, e := networkEncode(r.NetworkBinding)
	if e != nil {
		return nil, e
	}
	return EncodeFields([]byte(roleDomain(r.Role)), r.Realm, network, []byte(r.Action), r.Audience, r.EventOriginal, r.Nonce, openU64(r.NotAfter), openU64(r.ExpectedEpoch), openU64(r.NextEpoch))
}
func DecodeIdentityRoleAuthorizationV1DATA(w []byte) (IdentityRoleAuthorizationV1DATA, error) {
	var r IdentityRoleAuthorizationV1DATA
	f, e := DecodeFields(w, 10)
	if e != nil {
		return r, e
	}
	role := domainRole(string(f[0]))
	if role == "" {
		return r, ErrInvalid
	}
	network, e := networkDecode(f[2])
	if e != nil {
		return r, e
	}
	notAfter, e := readOpenU64(f[7])
	if e != nil {
		return r, e
	}
	from, e := readOpenU64(f[8])
	if e != nil {
		return r, e
	}
	to, e := readOpenU64(f[9])
	if e != nil {
		return r, e
	}
	r = IdentityRoleAuthorizationV1DATA{Role: role, Realm: f[1], NetworkBinding: network, Action: string(f[3]), Audience: f[4], EventOriginal: f[5], Nonce: f[6], NotAfter: notAfter, ExpectedEpoch: from, NextEpoch: to}
	canonical, e := EncodeIdentityRoleAuthorizationV1DATA(r)
	if e != nil || !bytes.Equal(canonical, w) {
		return IdentityRoleAuthorizationV1DATA{}, ErrInvalid
	}
	return r, nil
}
