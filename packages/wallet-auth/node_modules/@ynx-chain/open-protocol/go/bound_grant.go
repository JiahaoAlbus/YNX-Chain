package openprotocol

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const BoundGrantDomain = "YNX-OPEN/BOUND-GRANT/1"
const GrantEffectDomain = "YNX-OPEN/GRANT-EFFECT/1"
const BoundGrantDataVersion = "AUTH-BOUND-GRANT-PRIVATE/v1"

type LegacyGrantRefV1 struct {
	Realm  string `json:"realm"`
	Tenant string `json:"tenant"`
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Rev    string `json:"rev"`
}
type GrantBindV1 struct {
	Bytes    string `json:"bytes"`
	SHA3_512 string `json:"sha3_512"`
	SHA512   string `json:"sha512"`
}
type GrantToolV1 struct {
	ID      string      `json:"id"`
	Version string      `json:"version"`
	Schema  GrantBindV1 `json:"schema"`
}
type GrantTargetV1 struct {
	Service   string `json:"service"`
	Tenant    string `json:"tenant"`
	Origin    string `json:"origin"`
	Path      string `json:"path"`
	Region    string `json:"region"`
	Operation string `json:"operation"`
}
type GrantSessionV1 struct {
	ID      string `json:"id"`
	Epoch   string `json:"epoch"`
	Channel string `json:"channel"`
}
type GrantSourceV1 struct {
	Ref     LegacyGrantRefV1 `json:"ref"`
	Fields  []string         `json:"fields"`
	Label   string           `json:"label"`
	Binding GrantBindV1      `json:"binding"`
}
type GrantStepBindingV1 struct {
	Task          LegacyGrantRefV1 `json:"task"`
	Generation    string           `json:"generation"`
	StepID        string           `json:"stepId"`
	Input         GrantBindV1      `json:"input"`
	Tool          GrantToolV1      `json:"tool"`
	Target        GrantTargetV1    `json:"target"`
	Purpose       string           `json:"purpose"`
	Risk          string           `json:"risk"`
	HolderSession GrantSessionV1   `json:"holderSession"`
	Sources       []GrantSourceV1  `json:"sources"`
}
type BoundGrantV1 struct {
	Version      string             `json:"version"`
	ID           string             `json:"id"`
	Realm        string             `json:"realm"`
	Tenant       string             `json:"tenant"`
	Issuer       LegacyGrantRefV1   `json:"issuer"`
	IssuerEpoch  string             `json:"issuerEpoch"`
	Holder       LegacyGrantRefV1   `json:"holder"`
	HolderEpoch  string             `json:"holderEpoch"`
	Audience     string             `json:"audience"`
	Operation    string             `json:"operation"`
	Resources    []LegacyGrantRefV1 `json:"resources"`
	Cap          string             `json:"cap"`
	SingleMax    string             `json:"singleMax"`
	ValidFrom    string             `json:"validFrom"`
	Expires      string             `json:"expires"`
	Nonce        string             `json:"nonce"`
	Rev          string             `json:"rev"`
	NonDelegable bool               `json:"nonDelegable"`
	ApprovalID   string             `json:"approvalId"`
	Binding      GrantStepBindingV1 `json:"binding"`
}
type GrantEffectV1 struct {
	Grant BoundGrantV1       `json:"grant"`
	Step  GrantStepBindingV1 `json:"step"`
}

func bgLegacy(s string) ([]byte, error) {
	if len(s) < 1 || len(s) > 256 {
		return nil, ErrInvalid
	}
	for _, c := range []byte(s) {
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.ContainsRune("._:/-", rune(c))) {
			return nil, ErrInvalid
		}
	}
	return []byte(s), nil
}
func bgUint(s string) (uint64, error) {
	n, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(n, 10) != s {
		return 0, ErrInvalid
	}
	return n, nil
}
func bgU64(s string) ([]byte, error) {
	n, e := bgUint(s)
	if e != nil {
		return nil, e
	}
	return openU64(n), nil
}
func bgRead64(b []byte) (string, error) {
	n, e := readOpenU64(b)
	if e != nil {
		return "", e
	}
	return strconv.FormatUint(n, 10), nil
}
func bgHex(s string, n int) ([]byte, error) {
	if len(s) != n*2 {
		return nil, ErrInvalid
	}
	for _, c := range []byte(s) {
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
func bgReadHex(b []byte, n int) (string, error) {
	if len(b) != n {
		return "", ErrInvalid
	}
	return hex.EncodeToString(b), nil
}
func bgText(b []byte) (string, error) {
	if !utf8.Valid(b) {
		return "", ErrInvalid
	}
	return string(b), nil
}
func bgFrame(w []byte, count int) ([][]byte, error) { return DecodeFields(w, count) }
func bgList(w []byte, nonempty bool) ([][]byte, error) {
	if len(w) < 4 {
		return nil, ErrInvalid
	}
	n := binary.BigEndian.Uint32(w)
	if n > 1024 || nonempty && n == 0 {
		return nil, ErrBounds
	}
	return DecodeFields(w, int(n))
}
func bgOrdered(rows [][]byte) error {
	for i := 1; i < len(rows); i++ {
		if bytes.Compare(rows[i-1], rows[i]) >= 0 {
			return ErrInvalid
		}
	}
	return nil
}
func bgRef(r LegacyGrantRefV1) ([]byte, error) {
	rows := make([][]byte, 5)
	var e error
	for i, s := range []string{r.Realm, r.Tenant, r.Kind, r.ID} {
		rows[i], e = bgLegacy(s)
		if e != nil {
			return nil, e
		}
	}
	rows[4], e = bgU64(r.Rev)
	if e != nil {
		return nil, e
	}
	return EncodeFields(rows...)
}
func bgReadRef(w []byte) (LegacyGrantRefV1, error) {
	var r LegacyGrantRefV1
	f, e := bgFrame(w, 5)
	if e != nil {
		return r, e
	}
	texts := make([]string, 4)
	for i := range texts {
		texts[i], e = bgText(f[i])
		if e != nil {
			return r, e
		}
	}
	rev, e := bgRead64(f[4])
	if e != nil {
		return r, e
	}
	r = LegacyGrantRefV1{Realm: texts[0], Tenant: texts[1], Kind: texts[2], ID: texts[3], Rev: rev}
	if _, e = bgRef(r); e != nil {
		return LegacyGrantRefV1{}, e
	}
	return r, nil
}
func bgBind(b GrantBindV1) ([]byte, error) {
	n, e := bgU64(b.Bytes)
	if e != nil {
		return nil, e
	}
	a, e := bgHex(b.SHA3_512, 64)
	if e != nil {
		return nil, e
	}
	c, e := bgHex(b.SHA512, 64)
	if e != nil {
		return nil, e
	}
	return EncodeFields(n, a, c)
}
func bgReadBind(w []byte) (GrantBindV1, error) {
	var b GrantBindV1
	f, e := bgFrame(w, 3)
	if e != nil {
		return b, e
	}
	n, e := bgRead64(f[0])
	if e != nil {
		return b, e
	}
	a, e := bgReadHex(f[1], 64)
	if e != nil {
		return b, e
	}
	c, e := bgReadHex(f[2], 64)
	if e != nil {
		return b, e
	}
	return GrantBindV1{Bytes: n, SHA3_512: a, SHA512: c}, nil
}
func bgField(s string) ([]byte, error) {
	if !utf8.ValidString(s) || len(s) == 0 || len(s) > 512 || strings.Contains(s, "*") {
		return nil, ErrInvalid
	}
	units := 0
	for _, r := range s {
		units += utf16.RuneLen(r)
	}
	if units > 128 {
		return nil, ErrInvalid
	}
	return []byte(s), nil
}
func bgSource(s GrantSourceV1) ([]byte, error) {
	r, e := bgRef(s.Ref)
	if e != nil {
		return nil, e
	}
	if len(s.Fields) < 1 || len(s.Fields) > 1024 {
		return nil, ErrBounds
	}
	fields := make([][]byte, len(s.Fields))
	for i, x := range s.Fields {
		fields[i], e = bgField(x)
		if e != nil {
			return nil, e
		}
	}
	if e = bgOrdered(fields); e != nil {
		return nil, e
	}
	mask, e := EncodeFields(fields...)
	if e != nil {
		return nil, e
	}
	if s.Label != "PUBLIC" && s.Label != "TENANT" && s.Label != "RESTRICTED" && s.Label != "VAULT" {
		return nil, ErrInvalid
	}
	b, e := bgBind(s.Binding)
	if e != nil {
		return nil, e
	}
	return EncodeFields(r, mask, []byte(s.Label), b)
}
func bgReadSource(w []byte) (GrantSourceV1, error) {
	var s GrantSourceV1
	f, e := bgFrame(w, 4)
	if e != nil {
		return s, e
	}
	s.Ref, e = bgReadRef(f[0])
	if e != nil {
		return s, e
	}
	mask, e := bgList(f[1], true)
	if e != nil {
		return s, e
	}
	s.Fields = make([]string, len(mask))
	for i, b := range mask {
		s.Fields[i], e = bgText(b)
		if e != nil {
			return s, e
		}
	}
	s.Label, e = bgText(f[2])
	if e != nil {
		return s, e
	}
	s.Binding, e = bgReadBind(f[3])
	return s, e
}
func bgSink(s GrantTargetV1) ([]byte, error) {
	rows := make([][]byte, 6)
	var e error
	for i, v := range []string{s.Service, s.Tenant, s.Origin, s.Path, s.Region, s.Operation} {
		rows[i], e = bgLegacy(v)
		if e != nil {
			return nil, e
		}
	}
	return EncodeFields(rows...)
}
func bgReadSink(w []byte) (GrantTargetV1, error) {
	var s GrantTargetV1
	f, e := bgFrame(w, 6)
	if e != nil {
		return s, e
	}
	v := make([]string, 6)
	for i := range v {
		v[i], e = bgText(f[i])
		if e != nil {
			return s, e
		}
	}
	return GrantTargetV1{Service: v[0], Tenant: v[1], Origin: v[2], Path: v[3], Region: v[4], Operation: v[5]}, nil
}
func bgStep(s GrantStepBindingV1) ([]byte, error) {
	if s.Risk != "read" && s.Risk != "write" && s.Risk != "asset" {
		return nil, ErrInvalid
	}
	if len(s.Sources) > 1024 {
		return nil, ErrBounds
	}
	task, e := bgRef(s.Task)
	if e != nil {
		return nil, e
	}
	gen, e := bgU64(s.Generation)
	if e != nil {
		return nil, e
	}
	id, e := bgLegacy(s.StepID)
	if e != nil {
		return nil, e
	}
	input, e := bgBind(s.Input)
	if e != nil {
		return nil, e
	}
	toolID, e := bgLegacy(s.Tool.ID)
	if e != nil {
		return nil, e
	}
	toolVersion, e := bgU64(s.Tool.Version)
	if e != nil {
		return nil, e
	}
	schema, e := bgBind(s.Tool.Schema)
	if e != nil {
		return nil, e
	}
	tool, e := EncodeFields(toolID, toolVersion, schema)
	if e != nil {
		return nil, e
	}
	target, e := bgSink(s.Target)
	if e != nil {
		return nil, e
	}
	purpose, e := bgLegacy(s.Purpose)
	if e != nil {
		return nil, e
	}
	sessionID, e := bgLegacy(s.HolderSession.ID)
	if e != nil {
		return nil, e
	}
	sessionEpoch, e := bgU64(s.HolderSession.Epoch)
	if e != nil {
		return nil, e
	}
	channel, e := bgLegacy(s.HolderSession.Channel)
	if e != nil {
		return nil, e
	}
	session, e := EncodeFields(sessionID, sessionEpoch, channel)
	if e != nil {
		return nil, e
	}
	sources := make([][]byte, len(s.Sources))
	refs := make([][]byte, len(s.Sources))
	for i, v := range s.Sources {
		sources[i], e = bgSource(v)
		if e != nil {
			return nil, e
		}
		refs[i], e = bgRef(v.Ref)
		if e != nil {
			return nil, e
		}
	}
	if e = bgOrdered(refs); e != nil {
		return nil, e
	}
	sourceSet, e := EncodeFields(sources...)
	if e != nil {
		return nil, e
	}
	return EncodeFields(task, gen, id, input, tool, target, purpose, []byte(s.Risk), session, sourceSet)
}
func bgReadStep(w []byte) (GrantStepBindingV1, error) {
	var s GrantStepBindingV1
	f, e := bgFrame(w, 10)
	if e != nil {
		return s, e
	}
	s.Task, e = bgReadRef(f[0])
	if e != nil {
		return s, e
	}
	s.Generation, e = bgRead64(f[1])
	if e != nil {
		return s, e
	}
	s.StepID, e = bgText(f[2])
	if e != nil {
		return s, e
	}
	s.Input, e = bgReadBind(f[3])
	if e != nil {
		return s, e
	}
	tool, e := bgFrame(f[4], 3)
	if e != nil {
		return s, e
	}
	s.Tool.ID, e = bgText(tool[0])
	if e != nil {
		return s, e
	}
	s.Tool.Version, e = bgRead64(tool[1])
	if e != nil {
		return s, e
	}
	s.Tool.Schema, e = bgReadBind(tool[2])
	if e != nil {
		return s, e
	}
	s.Target, e = bgReadSink(f[5])
	if e != nil {
		return s, e
	}
	s.Purpose, e = bgText(f[6])
	if e != nil {
		return s, e
	}
	s.Risk, e = bgText(f[7])
	if e != nil {
		return s, e
	}
	session, e := bgFrame(f[8], 3)
	if e != nil {
		return s, e
	}
	s.HolderSession.ID, e = bgText(session[0])
	if e != nil {
		return s, e
	}
	s.HolderSession.Epoch, e = bgRead64(session[1])
	if e != nil {
		return s, e
	}
	s.HolderSession.Channel, e = bgText(session[2])
	if e != nil {
		return s, e
	}
	rows, e := bgList(f[9], false)
	if e != nil {
		return s, e
	}
	s.Sources = make([]GrantSourceV1, len(rows))
	for i, r := range rows {
		s.Sources[i], e = bgReadSource(r)
		if e != nil {
			return s, e
		}
	}
	return s, nil
}

// Preflight mirrors the private DATA capture budget before nested allocations.
type bgBudget struct{ n int }

func (b *bgBudget) add(s ...string) error {
	for _, v := range s {
		if len(v) > MaxControlBytes-b.n {
			return ErrBounds
		}
		b.n += len(v)
	}
	return nil
}
func (b *bgBudget) ref(r LegacyGrantRefV1) error {
	if e := b.add("realm", "tenant", "kind", "id", "rev"); e != nil {
		return e
	}
	return b.add(r.Realm, r.Tenant, r.Kind, r.ID, r.Rev)
}
func (b *bgBudget) bind(v GrantBindV1) error {
	if e := b.add("bytes", "sha3_512", "sha512"); e != nil {
		return e
	}
	return b.add(v.Bytes, v.SHA3_512, v.SHA512)
}
func (b *bgBudget) step(s GrantStepBindingV1) error {
	if len(s.Sources) > 1024 {
		return ErrBounds
	}
	if e := b.add("task", "generation", "stepId", "input", "tool", "target", "purpose", "risk", "holderSession", "sources"); e != nil {
		return e
	}
	if e := b.ref(s.Task); e != nil {
		return e
	}
	if e := b.add(s.Generation, s.StepID, s.Purpose, s.Risk); e != nil {
		return e
	}
	if e := b.bind(s.Input); e != nil {
		return e
	}
	if e := b.add("id", "version", "schema", s.Tool.ID, s.Tool.Version); e != nil {
		return e
	}
	if e := b.bind(s.Tool.Schema); e != nil {
		return e
	}
	if e := b.add("service", "tenant", "origin", "path", "region", "operation", s.Target.Service, s.Target.Tenant, s.Target.Origin, s.Target.Path, s.Target.Region, s.Target.Operation); e != nil {
		return e
	}
	if e := b.add("id", "epoch", "channel", s.HolderSession.ID, s.HolderSession.Epoch, s.HolderSession.Channel); e != nil {
		return e
	}
	for _, x := range s.Sources {
		if len(x.Fields) < 1 || len(x.Fields) > 1024 {
			return ErrBounds
		}
		if e := b.add("ref", "fields", "label", "binding", x.Label); e != nil {
			return e
		}
		if e := b.ref(x.Ref); e != nil {
			return e
		}
		if e := b.bind(x.Binding); e != nil {
			return e
		}
		if e := b.add(x.Fields...); e != nil {
			return e
		}
	}
	return nil
}
func bgPreflight(g BoundGrantV1) error {
	if len(g.Resources) < 1 || len(g.Resources) > 1024 {
		return ErrBounds
	}
	b := &bgBudget{}
	if e := b.add("version", "id", "realm", "tenant", "issuer", "issuerEpoch", "holder", "holderEpoch", "audience", "operation", "resources", "cap", "singleMax", "validFrom", "expires", "nonce", "rev", "nonDelegable", "approvalId", "binding", g.Version, g.ID, g.Realm, g.Tenant, g.IssuerEpoch, g.HolderEpoch, g.Audience, g.Operation, g.Cap, g.SingleMax, g.ValidFrom, g.Expires, g.Nonce, g.Rev, g.ApprovalID); e != nil {
		return e
	}
	if e := b.ref(g.Issuer); e != nil {
		return e
	}
	if e := b.ref(g.Holder); e != nil {
		return e
	}
	for _, r := range g.Resources {
		if e := b.ref(r); e != nil {
			return e
		}
	}
	return b.step(g.Binding)
}

// EncodeBoundGrant is the real shared codec port, not a policy decision.
func EncodeBoundGrant(g BoundGrantV1) ([]byte, error) {
	if e := bgPreflight(g); e != nil {
		return nil, e
	}
	if g.Version != BoundGrantDataVersion || !g.NonDelegable || g.Holder.Kind != "agent" || g.Issuer.Kind == "agent" || g.Issuer.Realm != g.Realm || g.Holder.Realm != g.Realm || g.Issuer.Tenant != g.Tenant || g.Holder.Tenant != g.Tenant {
		return nil, ErrInvalid
	}
	cap, e := bgUint(g.Cap)
	if e != nil {
		return nil, e
	}
	single, e := bgUint(g.SingleMax)
	if e != nil || single > cap {
		return nil, ErrInvalid
	}
	from, e := bgUint(g.ValidFrom)
	if e != nil {
		return nil, e
	}
	expires, e := bgUint(g.Expires)
	if e != nil || expires <= from {
		return nil, ErrInvalid
	}
	resources := make([][]byte, len(g.Resources))
	for i, r := range g.Resources {
		if r.Realm != g.Realm || r.Tenant != g.Tenant {
			return nil, ErrInvalid
		}
		resources[i], e = bgRef(r)
		if e != nil {
			return nil, e
		}
	}
	if e = bgOrdered(resources); e != nil {
		return nil, e
	}
	if g.Binding.Task.Realm != g.Realm || g.Binding.Task.Tenant != g.Tenant || g.Binding.Target.Tenant != g.Tenant || g.Binding.Target.Service != g.Audience {
		return nil, ErrInvalid
	}
	for _, s := range g.Binding.Sources {
		if s.Ref.Realm != g.Realm || s.Ref.Tenant != g.Tenant {
			return nil, ErrInvalid
		}
		r, e := bgRef(s.Ref)
		if e != nil {
			return nil, e
		}
		found := false
		for _, v := range resources {
			if bytes.Equal(r, v) {
				found = true
			}
		}
		if !found {
			return nil, ErrInvalid
		}
	}
	rows := make([][]byte, 21)
	rows[0] = []byte(BoundGrantDomain)
	rows[1] = []byte(g.Version)
	rows[2], e = bgHex(g.ID, 16)
	if e != nil {
		return nil, e
	}
	rows[3], e = bgLegacy(g.Realm)
	if e != nil {
		return nil, e
	}
	rows[4], e = bgLegacy(g.Tenant)
	if e != nil {
		return nil, e
	}
	rows[5], e = bgRef(g.Issuer)
	if e != nil {
		return nil, e
	}
	rows[6], e = bgU64(g.IssuerEpoch)
	if e != nil {
		return nil, e
	}
	rows[7], e = bgRef(g.Holder)
	if e != nil {
		return nil, e
	}
	rows[8], e = bgU64(g.HolderEpoch)
	if e != nil {
		return nil, e
	}
	rows[9], e = bgLegacy(g.Audience)
	if e != nil {
		return nil, e
	}
	rows[10], e = bgLegacy(g.Operation)
	if e != nil {
		return nil, e
	}
	rows[11], e = EncodeFields(resources...)
	if e != nil {
		return nil, e
	}
	for i, s := range []string{g.Cap, g.SingleMax, g.ValidFrom, g.Expires} {
		rows[12+i], e = bgU64(s)
		if e != nil {
			return nil, e
		}
	}
	rows[16], e = bgHex(g.Nonce, 16)
	if e != nil {
		return nil, e
	}
	rows[17], e = bgU64(g.Rev)
	if e != nil {
		return nil, e
	}
	rows[18] = []byte{1}
	rows[19], e = bgLegacy(g.ApprovalID)
	if e != nil {
		return nil, e
	}
	rows[20], e = bgStep(g.Binding)
	if e != nil {
		return nil, e
	}
	return EncodeFields(rows...)
}
func DecodeBoundGrant(w []byte) (BoundGrantV1, error) {
	var g BoundGrantV1
	f, e := bgFrame(w, 21)
	if e != nil {
		return g, e
	}
	if string(f[0]) != BoundGrantDomain || !bytes.Equal(f[18], []byte{1}) {
		return g, ErrInvalid
	}
	g.Version, e = bgText(f[1])
	if e != nil {
		return g, e
	}
	g.ID, e = bgReadHex(f[2], 16)
	if e != nil {
		return g, e
	}
	g.Realm, e = bgText(f[3])
	if e != nil {
		return g, e
	}
	g.Tenant, e = bgText(f[4])
	if e != nil {
		return g, e
	}
	g.Issuer, e = bgReadRef(f[5])
	if e != nil {
		return g, e
	}
	g.IssuerEpoch, e = bgRead64(f[6])
	if e != nil {
		return g, e
	}
	g.Holder, e = bgReadRef(f[7])
	if e != nil {
		return g, e
	}
	g.HolderEpoch, e = bgRead64(f[8])
	if e != nil {
		return g, e
	}
	g.Audience, e = bgText(f[9])
	if e != nil {
		return g, e
	}
	g.Operation, e = bgText(f[10])
	if e != nil {
		return g, e
	}
	res, e := bgList(f[11], true)
	if e != nil {
		return g, e
	}
	g.Resources = make([]LegacyGrantRefV1, len(res))
	for i, r := range res {
		g.Resources[i], e = bgReadRef(r)
		if e != nil {
			return g, e
		}
	}
	values := []*string{&g.Cap, &g.SingleMax, &g.ValidFrom, &g.Expires}
	for i, p := range values {
		*p, e = bgRead64(f[12+i])
		if e != nil {
			return g, e
		}
	}
	g.Nonce, e = bgReadHex(f[16], 16)
	if e != nil {
		return g, e
	}
	g.Rev, e = bgRead64(f[17])
	if e != nil {
		return g, e
	}
	g.NonDelegable = true
	g.ApprovalID, e = bgText(f[19])
	if e != nil {
		return g, e
	}
	g.Binding, e = bgReadStep(f[20])
	if e != nil {
		return g, e
	}
	canonical, e := EncodeBoundGrant(g)
	if e != nil || !bytes.Equal(canonical, w) {
		return BoundGrantV1{}, ErrInvalid
	}
	return g, nil
}
func EncodeGrantEffect(g BoundGrantV1, s GrantStepBindingV1) ([]byte, error) {
	full, e := EncodeBoundGrant(g)
	if e != nil {
		return nil, e
	}
	budget := &bgBudget{}
	if e = budget.step(s); e != nil {
		return nil, e
	}
	selected, e := bgStep(s)
	if e != nil {
		return nil, e
	}
	original, e := bgStep(g.Binding)
	if e != nil || !bytes.Equal(selected, original) {
		return nil, ErrInvalid
	}
	return EncodeFields([]byte(GrantEffectDomain), full, selected)
}
func DecodeGrantEffect(w []byte) (GrantEffectV1, error) {
	var effect GrantEffectV1
	f, e := bgFrame(w, 3)
	if e != nil {
		return effect, e
	}
	if string(f[0]) != GrantEffectDomain {
		return effect, ErrInvalid
	}
	effect.Grant, e = DecodeBoundGrant(f[1])
	if e != nil {
		return effect, e
	}
	effect.Step, e = bgReadStep(f[2])
	if e != nil {
		return effect, e
	}
	canonical, e := EncodeGrantEffect(effect.Grant, effect.Step)
	if e != nil || !bytes.Equal(canonical, w) {
		return GrantEffectV1{}, ErrInvalid
	}
	return effect, nil
}
