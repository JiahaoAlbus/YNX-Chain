package openprotocol

import (
	"bytes"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"io"
	"reflect"
	"sort"
	"strconv"
	"unicode/utf8"
)

const ShopOrderReadOperation = "shop.order.read"
const ShopOrderReadPath = "/api/tools/shop.order.read"

var shopOrderReadFields = map[string]bool{"createdAt": true, "currency": true, "reservationExpiresAt": true, "shippingYNXT": true, "status": true, "subtotalYNXT": true, "taxYNXT": true, "totalYNXT": true, "updatedAt": true}

type ShopOrderReadSelection struct {
	OrderID  string   `json:"orderId"`
	Fields   []string `json:"fields"`
	Snapshot string   `json:"snapshot"`
}
type ShopOrderReadTool struct {
	ID, Version, Operation, Purpose, Risk string
	Schema                                GrantBindV1
}

func shopBind(b []byte) GrantBindV1 {
	a, c := sha3.Sum512(b), sha512.Sum512(b)
	return GrantBindV1{Bytes: strconv.Itoa(len(b)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(c[:])}
}
func shopSelection(s ShopOrderReadSelection) error {
	if len(s.OrderID) < 1 || len(s.OrderID) > 256 || !utf8.ValidString(s.OrderID) || len(s.Snapshot) != 128 || len(s.Fields) < 1 || len(s.Fields) > 9 || !sort.StringsAreSorted(s.Fields) {
		return ErrInvalid
	}
	if _, e := bgHex(s.Snapshot, 64); e != nil {
		return e
	}
	for i, f := range s.Fields {
		if !shopOrderReadFields[f] || i > 0 && s.Fields[i-1] == f {
			return ErrInvalid
		}
	}
	return nil
}
func EncodeShopOrderReadInputDATA(s ShopOrderReadSelection) ([]byte, error) {
	s.Fields = append([]string(nil), s.Fields...)
	if e := shopSelection(s); e != nil {
		return nil, e
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if e := enc.Encode(s); e != nil {
		return nil, e
	}
	return bytes.TrimSuffix(b.Bytes(), []byte("\n")), nil
}
func DecodeShopOrderReadInputDATA(raw []byte) (ShopOrderReadSelection, error) {
	var s ShopOrderReadSelection
	if len(raw) == 0 || len(raw) > 32768 || !utf8.Valid(raw) || !shopJSONSurrogates(raw) {
		return s, ErrInvalid
	}
	d := json.NewDecoder(bytes.NewReader(bytes.Clone(raw)))
	tok, e := d.Token()
	if e != nil || tok != json.Delim('{') {
		return s, ErrInvalid
	}
	seen := map[string]bool{}
	for d.More() {
		t, e := d.Token()
		if e != nil {
			return s, e
		}
		k, ok := t.(string)
		if !ok || seen[k] {
			return s, ErrInvalid
		}
		seen[k] = true
		switch k {
		case "orderId":
			e = d.Decode(&s.OrderID)
		case "fields":
			e = d.Decode(&s.Fields)
		case "snapshot":
			e = d.Decode(&s.Snapshot)
		default:
			return s, ErrInvalid
		}
		if e != nil {
			return s, e
		}
	}
	tok, e = d.Token()
	if e != nil || tok != json.Delim('}') || d.Decode(&struct{}{}) != io.EOF || len(seen) != 3 {
		return s, ErrInvalid
	}
	return s, shopSelection(s)
}
func BindShopOrderReadInputDATA(raw []byte) (GrantBindV1, error) {
	if len(raw) > 32768 {
		return GrantBindV1{}, ErrBounds
	}
	b := bytes.Clone(raw)
	if _, e := DecodeShopOrderReadInputDATA(b); e != nil {
		return GrantBindV1{}, e
	}
	return shopBind(b), nil
}
func ShopOrderReadInputSchemaDATA() []byte { return []byte(shopOrderReadOriginalInputSchema) }
func ShopOrderReadToolDescriptorDATA() ShopOrderReadTool {
	return ShopOrderReadTool{ShopOrderReadOperation, "1", ShopOrderReadOperation, "read-selected-shop-order", "read", shopBind([]byte(shopOrderReadOriginalInputSchema))}
}

const shopOrderReadOriginalInputSchema = "{\n  \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\n  \"$id\": \"urn:ynx:tool:shop.order.read:input:1\",\n  \"title\": \"Shop selected order read arguments\",\n  \"type\": \"object\",\n  \"additionalProperties\": false,\n  \"required\": [\"orderId\", \"fields\", \"snapshot\"],\n  \"properties\": {\n    \"orderId\": {\"type\": \"string\", \"minLength\": 1, \"maxLength\": 256},\n    \"fields\": {\n      \"type\": \"array\",\n      \"minItems\": 1,\n      \"maxItems\": 9,\n      \"uniqueItems\": true,\n      \"description\": \"Exact selected fields in ascending lexical order; no implicit defaults or scope expansion.\",\n      \"items\": {\n        \"type\": \"string\",\n        \"enum\": [\"createdAt\", \"currency\", \"reservationExpiresAt\", \"shippingYNXT\", \"status\", \"subtotalYNXT\", \"taxYNXT\", \"totalYNXT\", \"updatedAt\"]\n      }\n    },\n    \"snapshot\": {\"type\": \"string\", \"pattern\": \"^[0-9a-f]{128}$\"}\n  }\n}\n"

// encoding/json replaces unpaired escaped surrogates; this shared profile
// refuses replacement so TS and Go preserve exact same Unicode identifiers.
func shopJSONSurrogates(raw []byte) bool {
	in := false
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if c == '"' {
			in = !in
			continue
		}
		if !in || c != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			return false
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return false
		}
		n, e := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if e != nil {
			return false
		}
		i += 4
		if n >= 0xd800 && n <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			lo, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || lo < 0xdc00 || lo > 0xdfff {
				return false
			}
			i += 6
		} else if n >= 0xdc00 && n <= 0xdfff {
			return false
		}
	}
	return true
}

type ShopOrderReadTaskEffectBindingDATA struct {
	Realm, Tenant, Account, Audience                     string
	GrantID, GrantRevision                               string
	Task                                                 LegacyGrantRefV1
	Generation, StepID                                   string
	Holder                                               LegacyGrantRefV1
	HolderEpoch, SessionID, SessionEpoch, ChannelBinding string
	Tool                                                 ShopOrderReadTool
	Input                                                GrantBindV1
	Fields                                               []string
	Target                                               GrantTargetV1
	Resources                                            []LegacyGrantRefV1
	Sources                                              []GrantSourceV1
	EgressActual                                         *GrantBindV1
}
type ShopOrderReadExpectedProfileDATA struct {
	Target    GrantTargetV1
	OrderKind string
}
type ShopOrderReadProofDATA struct {
	Purpose       string
	Payload, Wire []byte
}

func shopToolE(t ShopOrderReadTool) ([]byte, error) {
	rows := make([][]byte, 6)
	var e error
	rows[0], e = bgLegacy(t.ID)
	if e != nil {
		return nil, e
	}
	rows[1], e = bgU64(t.Version)
	if e != nil {
		return nil, e
	}
	for i, s := range []string{t.Operation, t.Purpose, t.Risk} {
		rows[i+2], e = bgLegacy(s)
		if e != nil {
			return nil, e
		}
	}
	rows[5], e = bgBind(t.Schema)
	if e != nil {
		return nil, e
	}
	return EncodeFields(rows...)
}
func shopReadTool(w []byte) (ShopOrderReadTool, error) {
	var t ShopOrderReadTool
	f, e := DecodeFields(w, 6)
	if e != nil {
		return t, e
	}
	t.ID, e = bgText(f[0])
	if e != nil {
		return t, e
	}
	t.Version, e = bgRead64(f[1])
	if e != nil {
		return t, e
	}
	t.Operation, e = bgText(f[2])
	if e != nil {
		return t, e
	}
	t.Purpose, e = bgText(f[3])
	if e != nil {
		return t, e
	}
	t.Risk, e = bgText(f[4])
	if e != nil {
		return t, e
	}
	t.Schema, e = bgReadBind(f[5])
	return t, e
}
func shopFieldsE(fields []string) ([]byte, error) {
	if len(fields) < 1 || len(fields) > 9 {
		return nil, ErrInvalid
	}
	rows := make([][]byte, len(fields))
	for i, f := range fields {
		if !shopOrderReadFields[f] || i > 0 && fields[i-1] >= f {
			return nil, ErrInvalid
		}
		rows[i] = []byte(f)
	}
	return EncodeFields(rows...)
}
func shopReadFields(w []byte) ([]string, error) {
	f, e := bgList(w, true)
	if e != nil {
		return nil, e
	}
	if len(f) > 9 {
		return nil, ErrInvalid
	}
	out := make([]string, len(f))
	for i, b := range f {
		out[i] = string(b)
	}
	_, e = shopFieldsE(out)
	return out, e
}
func shopBindingE(b ShopOrderReadTaskEffectBindingDATA) ([]byte, error) {
	if b.EgressActual != nil || len(b.Resources) != 1 || len(b.Sources) != 1 {
		return nil, ErrInvalid
	}
	rows := make([][]byte, 21)
	var e error
	for i, s := range []string{b.Realm, b.Tenant, b.Account, b.Audience, b.GrantID} {
		rows[i], e = bgLegacy(s)
		if e != nil {
			return nil, e
		}
	}
	if rows[5], e = bgU64(b.GrantRevision); e != nil {
		return nil, e
	}
	if rows[6], e = bgRef(b.Task); e != nil {
		return nil, e
	}
	if rows[7], e = bgU64(b.Generation); e != nil {
		return nil, e
	}
	if rows[8], e = bgLegacy(b.StepID); e != nil {
		return nil, e
	}
	if rows[9], e = bgRef(b.Holder); e != nil {
		return nil, e
	}
	if rows[10], e = bgU64(b.HolderEpoch); e != nil {
		return nil, e
	}
	if rows[11], e = bgLegacy(b.SessionID); e != nil {
		return nil, e
	}
	if rows[12], e = bgU64(b.SessionEpoch); e != nil {
		return nil, e
	}
	if rows[13], e = bgLegacy(b.ChannelBinding); e != nil {
		return nil, e
	}
	if rows[14], e = shopToolE(b.Tool); e != nil {
		return nil, e
	}
	if rows[15], e = bgBind(b.Input); e != nil {
		return nil, e
	}
	if rows[16], e = shopFieldsE(b.Fields); e != nil {
		return nil, e
	}
	if rows[17], e = bgSink(b.Target); e != nil {
		return nil, e
	}
	r, e := bgRef(b.Resources[0])
	if e != nil {
		return nil, e
	}
	rows[18], e = EncodeFields(r)
	if e != nil {
		return nil, e
	}
	source, e := bgSource(b.Sources[0])
	if e != nil {
		return nil, e
	}
	if _, e = shopFieldsE(b.Sources[0].Fields); e != nil {
		return nil, e
	}
	rows[19], e = EncodeFields(source)
	if e != nil {
		return nil, e
	}
	rows[20], e = EncodeFields([]byte{0})
	if e != nil {
		return nil, e
	}
	return EncodeFields(rows...)
}
func shopReadBinding(w []byte) (ShopOrderReadTaskEffectBindingDATA, error) {
	var b ShopOrderReadTaskEffectBindingDATA
	f, e := DecodeFields(w, 21)
	if e != nil {
		return b, e
	}
	targets := []*string{&b.Realm, &b.Tenant, &b.Account, &b.Audience, &b.GrantID}
	for i, p := range targets {
		*p, e = bgText(f[i])
		if e != nil {
			return b, e
		}
	}
	if b.GrantRevision, e = bgRead64(f[5]); e != nil {
		return b, e
	}
	if b.Task, e = bgReadRef(f[6]); e != nil {
		return b, e
	}
	if b.Generation, e = bgRead64(f[7]); e != nil {
		return b, e
	}
	if b.StepID, e = bgText(f[8]); e != nil {
		return b, e
	}
	if b.Holder, e = bgReadRef(f[9]); e != nil {
		return b, e
	}
	if b.HolderEpoch, e = bgRead64(f[10]); e != nil {
		return b, e
	}
	if b.SessionID, e = bgText(f[11]); e != nil {
		return b, e
	}
	if b.SessionEpoch, e = bgRead64(f[12]); e != nil {
		return b, e
	}
	if b.ChannelBinding, e = bgText(f[13]); e != nil {
		return b, e
	}
	if b.Tool, e = shopReadTool(f[14]); e != nil {
		return b, e
	}
	if b.Input, e = bgReadBind(f[15]); e != nil {
		return b, e
	}
	if b.Fields, e = shopReadFields(f[16]); e != nil {
		return b, e
	}
	if b.Target, e = bgReadSink(f[17]); e != nil {
		return b, e
	}
	rs, e := DecodeFields(f[18], 1)
	if e != nil {
		return b, e
	}
	r, e := bgReadRef(rs[0])
	if e != nil {
		return b, e
	}
	b.Resources = []LegacyGrantRefV1{r}
	ss, e := DecodeFields(f[19], 1)
	if e != nil {
		return b, e
	}
	s, e := bgReadSource(ss[0])
	if e != nil {
		return b, e
	}
	b.Sources = []GrantSourceV1{s}
	none, e := DecodeFields(f[20], 1)
	if e != nil || !bytes.Equal(none[0], []byte{0}) {
		return b, ErrInvalid
	}
	return b, nil
}
func shopCheckBinding(b ShopOrderReadTaskEffectBindingDATA, raw []byte, expected ShopOrderReadExpectedProfileDATA) error {
	if _, e := bgLegacy(expected.OrderKind); e != nil {
		return e
	}
	if _, e := bgSink(expected.Target); e != nil {
		return e
	}
	if b.Target != expected.Target || b.Target.Path != ShopOrderReadPath || b.Target.Operation != ShopOrderReadOperation || b.Target.Service != b.Audience || b.Target.Tenant != b.Tenant || b.Tool != ShopOrderReadToolDescriptorDATA() {
		return ErrInvalid
	}
	s, e := DecodeShopOrderReadInputDATA(raw)
	if e != nil {
		return e
	}
	r, source := b.Resources[0], b.Sources[0]
	if b.Input != shopBind(raw) || r.ID != s.OrderID || r.Kind != expected.OrderKind || !reflect.DeepEqual(b.Fields, s.Fields) || source.Ref != r || !reflect.DeepEqual(source.Fields, s.Fields) || b.Holder.Kind != "agent" {
		return ErrInvalid
	}
	for _, ref := range []LegacyGrantRefV1{b.Task, b.Holder, r} {
		if ref.Realm != b.Realm || ref.Tenant != b.Tenant {
			return ErrInvalid
		}
	}
	return nil
}
func EncodeShopOrderReadBindingDATA(input ShopOrderReadTaskEffectBindingDATA, inputOriginal []byte, expected ShopOrderReadExpectedProfileDATA) ([]byte, error) {
	if len(inputOriginal) > 32768 {
		return nil, ErrBounds
	}
	w, e := shopBindingE(input)
	if e != nil {
		return nil, e
	}
	b, e := shopReadBinding(w)
	if e != nil {
		return nil, e
	}
	if e = shopCheckBinding(b, bytes.Clone(inputOriginal), expected); e != nil {
		return nil, e
	}
	return w, nil
}
func DecodeShopOrderReadBindingDATA(input, inputOriginal []byte, expected ShopOrderReadExpectedProfileDATA) (ShopOrderReadTaskEffectBindingDATA, error) {
	if len(input) > MaxControlBytes || len(inputOriginal) > 32768 {
		return ShopOrderReadTaskEffectBindingDATA{}, ErrBounds
	}
	w := bytes.Clone(input)
	b, e := shopReadBinding(w)
	if e != nil {
		return b, e
	}
	canonical, e := shopBindingE(b)
	if e != nil {
		return b, e
	}
	if !bytes.Equal(w, canonical) {
		return b, ErrInvalid
	}
	return b, shopCheckBinding(b, bytes.Clone(inputOriginal), expected)
}
func EncodeShopOrderReadProofDATA(p ShopOrderReadProofDATA, expectedPurpose string) ([]byte, error) {
	if p.Purpose != expectedPurpose || len(p.Payload) < 1 || len(p.Wire) < 1 || len(p.Payload) > MaxControlBytes || len(p.Wire) > MaxControlBytes {
		return nil, ErrInvalid
	}
	purpose, e := bgLegacy(expectedPurpose)
	if e != nil {
		return nil, e
	}
	return EncodeFields(purpose, bytes.Clone(p.Payload), bytes.Clone(p.Wire))
}
func DecodeShopOrderReadProofDATA(input []byte, expectedPurpose string) (ShopOrderReadProofDATA, error) {
	f, e := DecodeFields(input, 3)
	if e != nil {
		return ShopOrderReadProofDATA{}, e
	}
	purpose, e := bgText(f[0])
	if e != nil {
		return ShopOrderReadProofDATA{}, e
	}
	p := ShopOrderReadProofDATA{purpose, bytes.Clone(f[1]), bytes.Clone(f[2])}
	_, e = EncodeShopOrderReadProofDATA(p, expectedPurpose)
	return p, e
}

const ShopOrderReadRequestDomain = "YNX-OPEN/SHOP-ORDER-READ-REQUEST/1"
const ShopOrderReadRequestContentType = "application/vnd.ynx.shop-order-read.v1"
const ShopOrderReadResultProfile = "YNX-OPEN/SHOP-ORDER-READ-RESULT/1"

type OriginalShopTaskOrderCallDATA struct {
	Binding       ShopOrderReadTaskEffectBindingDATA
	Grant, Holder ShopOrderReadProofDATA
	Input         []byte
}

func shopCheckGrantCall(b ShopOrderReadTaskEffectBindingDATA, gp, hp ShopOrderReadProofDATA) error {
	g, e := DecodeBoundGrant(gp.Payload)
	if e != nil {
		return e
	}
	effect, e := DecodeGrantEffect(hp.Payload)
	if e != nil {
		return e
	}
	inner, e := EncodeBoundGrant(effect.Grant)
	if e != nil || !bytes.Equal(inner, gp.Payload) {
		return ErrInvalid
	}
	s := g.Binding
	if g.ID != b.GrantID || g.Rev != b.GrantRevision || g.Realm != b.Realm || g.Tenant != b.Tenant || g.Audience != b.Audience || g.Operation != b.Tool.Operation || g.Holder != b.Holder || g.HolderEpoch != b.HolderEpoch || s.Task != b.Task || s.Generation != b.Generation || s.StepID != b.StepID || s.Input != b.Input || s.Target != b.Target || s.Tool.ID != b.Tool.ID || s.Tool.Version != b.Tool.Version || s.Tool.Schema != b.Tool.Schema || s.Purpose != b.Tool.Purpose || s.Risk != b.Tool.Risk || s.HolderSession.ID != b.SessionID || s.HolderSession.Epoch != b.SessionEpoch || s.HolderSession.Channel != b.ChannelBinding || len(g.Resources) != 1 || len(s.Sources) != 1 || g.Resources[0] != b.Resources[0] || !reflect.DeepEqual(s.Sources[0], b.Sources[0]) {
		return ErrInvalid
	}
	return nil
}
func EncodeShopOrderReadRequestDATA(c OriginalShopTaskOrderCallDATA, expected ShopOrderReadExpectedProfileDATA) ([]byte, error) {
	if len(c.Input) > 32768 {
		return nil, ErrBounds
	}
	raw := bytes.Clone(c.Input)
	b, e := EncodeShopOrderReadBindingDATA(c.Binding, raw, expected)
	if e != nil {
		return nil, e
	}
	gp, e := EncodeShopOrderReadProofDATA(c.Grant, BoundGrantDomain)
	if e != nil {
		return nil, e
	}
	hp, e := EncodeShopOrderReadProofDATA(c.Holder, GrantEffectDomain)
	if e != nil {
		return nil, e
	}
	safe, e := shopReadBinding(b)
	if e != nil {
		return nil, e
	}
	g, e := DecodeShopOrderReadProofDATA(gp, BoundGrantDomain)
	if e != nil {
		return nil, e
	}
	h, e := DecodeShopOrderReadProofDATA(hp, GrantEffectDomain)
	if e != nil {
		return nil, e
	}
	if e = shopCheckGrantCall(safe, g, h); e != nil {
		return nil, e
	}
	return EncodeFields([]byte(ShopOrderReadRequestDomain), b, gp, hp, raw)
}
func DecodeShopOrderReadRequestDATA(input []byte, expected ShopOrderReadExpectedProfileDATA, actualContentType string) (OriginalShopTaskOrderCallDATA, error) {
	var c OriginalShopTaskOrderCallDATA
	if actualContentType != ShopOrderReadRequestContentType {
		return c, ErrInvalid
	}
	f, e := DecodeFields(input, 5)
	if e != nil {
		return c, e
	}
	if string(f[0]) != ShopOrderReadRequestDomain {
		return c, ErrInvalid
	}
	c.Binding, e = DecodeShopOrderReadBindingDATA(f[1], f[4], expected)
	if e != nil {
		return c, e
	}
	c.Grant, e = DecodeShopOrderReadProofDATA(f[2], BoundGrantDomain)
	if e != nil {
		return c, e
	}
	c.Holder, e = DecodeShopOrderReadProofDATA(f[3], GrantEffectDomain)
	if e != nil {
		return c, e
	}
	c.Input = bytes.Clone(f[4])
	return c, shopCheckGrantCall(c.Binding, c.Grant, c.Holder)
}

type ShopOrderReadProjectionDATA struct {
	OrderID  string            `json:"orderId"`
	Snapshot string            `json:"snapshot"`
	Fields   []string          `json:"fields"`
	Data     map[string]string `json:"data"`
}
type ShopOrderReadDeclaredSourceDATA struct {
	Resource LegacyGrantRefV1 `json:"resource"`
	Fields   []string         `json:"fields"`
	Label    string           `json:"label"`
	Binding  GrantBindV1      `json:"binding"`
}
type ShopOrderReadResponseValueDATA struct {
	Version    string                          `json:"version"`
	Profile    string                          `json:"profile"`
	Projection ShopOrderReadProjectionDATA     `json:"projection"`
	Source     ShopOrderReadDeclaredSourceDATA `json:"source"`
	AuthFence  string                          `json:"authFence"`
}
type ShopOrderReadExpectedResponseDATA struct {
	Selection ShopOrderReadSelection
	Source    ShopOrderReadDeclaredSourceDATA
}
type ShopOrderReadResponseDATA struct {
	ResponseOriginal, SourceBytes               []byte
	ResponseBinding, SourceBinding              GrantBindV1
	DeclaredSource                              ShopOrderReadDeclaredSourceDATA
	Projection                                  ShopOrderReadProjectionDATA
	AuthFence                                   string
	DataOnly, SourceVerified, OperationVerified bool
}

func shopJSONString(s string) ([]byte, error) {
	if !utf8.ValidString(s) {
		return nil, ErrInvalid
	}
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	if err := e.Encode(s); err != nil {
		return nil, err
	}
	raw := bytes.TrimSuffix(b.Bytes(), []byte("\n"))
	out := make([]byte, 0, len(raw))
	for i := 0; i < len(raw); i++ {
		if raw[i] == '\\' && i+1 < len(raw) {
			if i+5 < len(raw) && (string(raw[i:i+6]) == `\u2028` || string(raw[i:i+6]) == `\u2029`) {
				r := []byte("\u2028")
				if raw[i+5] == '9' {
					r = []byte("\u2029")
				}
				out = append(out, r...)
				i += 5
				continue
			}
			out = append(out, raw[i], raw[i+1])
			i++
			continue
		}
		out = append(out, raw[i])
	}
	return out, nil
}
func shopCanonical(v any) ([]byte, error) {
	switch x := v.(type) {
	case string:
		return shopJSONString(x)
	case []any:
		out := []byte{'['}
		for i, row := range x {
			if i > 0 {
				out = append(out, ',')
			}
			b, e := shopCanonical(row)
			if e != nil {
				return nil, e
			}
			out = append(out, b...)
		}
		return append(out, ']'), nil
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k := range x {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := []byte{'{'}
		for i, k := range keys {
			if i > 0 {
				out = append(out, ',')
			}
			key, e := shopJSONString(k)
			if e != nil {
				return nil, e
			}
			b, e := shopCanonical(x[k])
			if e != nil {
				return nil, e
			}
			out = append(out, key...)
			out = append(out, ':')
			out = append(out, b...)
		}
		return append(out, '}'), nil
	default:
		return nil, ErrInvalid
	}
}
func shopRefMap(r LegacyGrantRefV1) map[string]any {
	return map[string]any{"realm": r.Realm, "tenant": r.Tenant, "kind": r.Kind, "id": r.ID, "rev": r.Rev}
}
func shopBindMap(b GrantBindV1) map[string]any {
	return map[string]any{"bytes": b.Bytes, "sha3_512": b.SHA3_512, "sha512": b.SHA512}
}
func shopStringArray(s []string) []any {
	a := make([]any, len(s))
	for i, v := range s {
		a[i] = v
	}
	return a
}
func shopSourceMap(s ShopOrderReadDeclaredSourceDATA) map[string]any {
	return map[string]any{"resource": shopRefMap(s.Resource), "fields": shopStringArray(s.Fields), "label": s.Label, "binding": shopBindMap(s.Binding)}
}
func shopValidateDeclaredSource(s ShopOrderReadDeclaredSourceDATA) error {
	if _, e := shopFieldsE(s.Fields); e != nil {
		return e
	}
	_, e := bgSource(GrantSourceV1{Ref: s.Resource, Fields: s.Fields, Label: s.Label, Binding: s.Binding})
	return e
}
func shopCheckResponse(v ShopOrderReadResponseValueDATA, expected ShopOrderReadExpectedResponseDATA) (map[string]any, []byte, GrantBindV1, error) {
	empty := GrantBindV1{}
	if v.Version != "1" || v.Profile != ShopOrderReadResultProfile || (v.AuthFence != "same-authority-resource-fence" && v.AuthFence != "egress-only-read-fence") {
		return nil, nil, empty, ErrInvalid
	}
	p := v.Projection
	selection := ShopOrderReadSelection{p.OrderID, p.Fields, p.Snapshot}
	if shopSelection(selection) != nil || shopSelection(expected.Selection) != nil || selection.OrderID != expected.Selection.OrderID || selection.Snapshot != expected.Selection.Snapshot || !reflect.DeepEqual(selection.Fields, expected.Selection.Fields) || v.Source.Resource.ID != p.OrderID || !reflect.DeepEqual(v.Source.Fields, p.Fields) || !reflect.DeepEqual(v.Source, expected.Source) || len(p.Data) != len(p.Fields) {
		return nil, nil, empty, ErrInvalid
	}
	if e := shopValidateDeclaredSource(v.Source); e != nil {
		return nil, nil, empty, e
	}
	data := map[string]any{}
	for _, k := range p.Fields {
		s, ok := p.Data[k]
		if !ok || !utf8.ValidString(s) || len(s) > MaxControlBytes {
			return nil, nil, empty, ErrInvalid
		}
		data[k] = s
	}
	source, e := shopCanonical(data)
	if e != nil {
		return nil, nil, empty, e
	}
	if len(source) > MaxControlBytes {
		return nil, nil, empty, ErrBounds
	}
	binding := shopBind(source)
	if binding != v.Source.Binding {
		return nil, nil, empty, ErrInvalid
	}
	m := map[string]any{"version": "1", "profile": ShopOrderReadResultProfile, "projection": map[string]any{"orderId": p.OrderID, "snapshot": p.Snapshot, "fields": shopStringArray(p.Fields), "data": data}, "source": shopSourceMap(v.Source), "authFence": v.AuthFence}
	return m, source, binding, nil
}
func shopResponseResult(v ShopOrderReadResponseValueDATA, original, source []byte, binding GrantBindV1) ShopOrderReadResponseDATA {
	p := v.Projection
	p.Fields = append([]string(nil), p.Fields...)
	data := make(map[string]string, len(p.Data))
	for k, value := range p.Data {
		data[k] = value
	}
	p.Data = data
	s := v.Source
	s.Fields = append([]string(nil), s.Fields...)
	return ShopOrderReadResponseDATA{ResponseOriginal: bytes.Clone(original), SourceBytes: bytes.Clone(source), ResponseBinding: shopBind(original), SourceBinding: binding, DeclaredSource: s, Projection: p, AuthFence: v.AuthFence, DataOnly: true, SourceVerified: false, OperationVerified: false}
}
func EncodeShopOrderReadResponseDATA(v ShopOrderReadResponseValueDATA, expected ShopOrderReadExpectedResponseDATA) (ShopOrderReadResponseDATA, error) {
	m, source, binding, e := shopCheckResponse(v, expected)
	if e != nil {
		return ShopOrderReadResponseDATA{}, e
	}
	original, e := shopCanonical(m)
	if e != nil {
		return ShopOrderReadResponseDATA{}, e
	}
	if len(original) > MaxControlBytes {
		return ShopOrderReadResponseDATA{}, ErrBounds
	}
	return shopResponseResult(v, original, source, binding), nil
}
func DecodeShopOrderReadResponseDATA(input []byte, expected ShopOrderReadExpectedResponseDATA) (ShopOrderReadResponseDATA, error) {
	if len(input) > MaxControlBytes {
		return ShopOrderReadResponseDATA{}, ErrBounds
	}
	original := bytes.Clone(input)
	if !utf8.Valid(original) || !shopJSONSurrogates(original) {
		return ShopOrderReadResponseDATA{}, ErrInvalid
	}
	var v ShopOrderReadResponseValueDATA
	d := json.NewDecoder(bytes.NewReader(original))
	d.DisallowUnknownFields()
	if e := d.Decode(&v); e != nil {
		return ShopOrderReadResponseDATA{}, e
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return ShopOrderReadResponseDATA{}, ErrInvalid
	}
	m, source, binding, e := shopCheckResponse(v, expected)
	if e != nil {
		return ShopOrderReadResponseDATA{}, e
	}
	canonical, e := shopCanonical(m)
	if e != nil || !bytes.Equal(canonical, original) {
		return ShopOrderReadResponseDATA{}, ErrInvalid
	}
	return shopResponseResult(v, original, source, binding), nil
}
