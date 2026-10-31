package openprotocol

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

const TaskAuthorityResponsePurpose = "YNX-OPEN/TASK-AUTHORITY-RESPONSE/1"
const TaskAuthorityWholeMaxBytes = 1048576
const TaskAuthorityPayloadMaxBytes = 65536

// Complete registered subject, not a legacy ID or inferred epoch.
type TaskAuthorityFullRefDATA struct {
	Realm  string `json:"realm"`
	Tenant string `json:"tenant"`
	Kind   string `json:"kind"`
	ID     string `json:"id"`
	Rev    string `json:"rev"`
}
type TaskAuthorityResponseCallDATA struct {
	GrantRef       LegacyGrantRefV1   `json:"grantRef"`
	GrantPayload   GrantBindV1        `json:"grantPayload"`
	GrantWire      GrantBindV1        `json:"grantWire"`
	HolderPayload  GrantBindV1        `json:"holderPayload"`
	HolderWire     GrantBindV1        `json:"holderWire"`
	Issuer         LegacyGrantRefV1   `json:"issuer"`
	Holder         LegacyGrantRefV1   `json:"holder"`
	IssuerEpoch    string             `json:"issuerEpoch"`
	HolderEpoch    string             `json:"holderEpoch"`
	Binding        GrantStepBindingV1 `json:"binding"`
	RequestBinding GrantBindV1        `json:"requestBinding"`
}
type TaskAuthorityTransportDATA struct {
	Action      string `json:"action"`
	Method      string `json:"method"`
	Path        string `json:"path"`
	Service     string `json:"service"`
	Origin      string `json:"origin"`
	ContentType string `json:"contentType"`
	StatusCode  int    `json:"statusCode"`
}
type TaskAuthorityDeclaredSourceDATA struct {
	Resource LegacyGrantRefV1 `json:"resource"`
	Fields   []string         `json:"fields"`
	Label    string           `json:"label"`
	Binding  GrantBindV1      `json:"binding"`
}
type TaskAuthorityResponseResourceDATA struct {
	OperationID     string                          `json:"operationID"`
	RemoteRef       string                          `json:"remoteRef"`
	AuthScope       string                          `json:"authScope"`
	Source          TaskAuthorityDeclaredSourceDATA `json:"source"`
	ResponseBinding GrantBindV1                     `json:"responseBinding"`
}
type TaskAuthorityResponsePayloadDATA struct {
	Version                     string                             `json:"version"`
	Purpose                     string                             `json:"purpose"`
	Realm                       string                             `json:"realm"`
	Tenant                      string                             `json:"tenant"`
	Authority                   string                             `json:"authority"`
	Account                     string                             `json:"account"`
	CurrentTaskRevision         string                             `json:"currentTaskRevision"`
	CurrentGeneration           string                             `json:"currentGeneration"`
	SourceExpires               string                             `json:"sourceExpires"`
	ResponseIssuer              TaskAuthorityFullRefDATA           `json:"responseIssuer"`
	IssuerEpoch                 string                             `json:"issuerEpoch"`
	PolicyRevision              string                             `json:"policyRevision"`
	Height                      string                             `json:"height"`
	ChainID                     string                             `json:"chainID"`
	Call                        TaskAuthorityResponseCallDATA      `json:"call"`
	Transport                   TaskAuthorityTransportDATA         `json:"transport"`
	OperationID                 string                             `json:"operationID"`
	State                       string                             `json:"state"`
	OpaqueOriginalBinding       GrantBindV1                        `json:"opaqueOriginalBinding"`
	WholeServiceResponseBinding GrantBindV1                        `json:"wholeServiceResponseBinding"`
	WholeRequestBinding         GrantBindV1                        `json:"wholeRequestBinding"`
	Resource                    *TaskAuthorityResponseResourceDATA `json:"resource"`
	Nonce                       string                             `json:"nonce"`
	IssuedAt                    string                             `json:"issuedAt"`
	Expires                     string                             `json:"expires"`
}
type TaskAuthorityProofDATA struct {
	Purpose                       string
	PayloadOriginal, WireOriginal []byte
}
type TaskAuthorityRequestInputDATA struct {
	Version, Nonce, Account, CurrentTaskRevision, CurrentGeneration, SourceExpires string
	OriginalBody                                                                   []byte
}
type TaskAuthorityRequestDATA struct {
	TaskAuthorityRequestInputDATA
	DataOnly, SignatureVerified, SourceAdmission, NativeAdmission, OperationVerified bool
}
type TaskAuthorityWholeResponseInputDATA struct {
	Version      string
	OriginalBody []byte
	Proof        TaskAuthorityProofDATA
}
type TaskAuthorityWholeResponseDATA struct {
	TaskAuthorityWholeResponseInputDATA
	DataOnly, SignatureVerified, SourceAdmission, NativeAdmission, OperationVerified bool
}
type TaskAuthorityActualResourceDATA struct {
	OperationID, RemoteRef, AuthScope string
	Source                            TaskAuthorityDeclaredSourceDATA
	ResponseOriginal, SourceBytes     []byte
}
type TaskAuthorityOriginalCallDATA struct {
	GrantRef          LegacyGrantRefV1
	Grant, Holder     TaskAuthorityProofDATA
	RawInput          []byte
	OriginalOperation string
}
type TaskAuthorityRegisteredIssuerDATA struct {
	Principal                                             TaskAuthorityFullRefDATA
	IssuerEpoch, PolicyRevision, Height, ChainID, Expires string
}
type TaskAuthorityWholeExpectedDATA struct {
	MaxResponseBytes                                                                                                                 int
	RequestOriginal                                                                                                                  []byte
	Call                                                                                                                             TaskAuthorityOriginalCallDATA
	Transport                                                                                                                        TaskAuthorityTransportDATA
	Issuer                                                                                                                           TaskAuthorityRegisteredIssuerDATA
	Realm, Tenant, Authority, Account, CurrentTaskRevision, CurrentGeneration, SourceExpires, OperationID, State, OpaqueOriginal, At string
	Resource                                                                                                                         *TaskAuthorityActualResourceDATA
}
type TaskAuthorityWholeBindingDATA struct {
	Payload                                                                          TaskAuthorityResponsePayloadDATA
	ResponseOriginal                                                                 []byte
	Proof                                                                            TaskAuthorityProofDATA
	DataOnly, SignatureVerified, SourceAdmission, NativeAdmission, OperationVerified bool
}

func taBytes(v []byte, max int, empty bool) ([]byte, error) {
	if len(v) > max {
		return nil, ErrBounds
	}
	if !empty && len(v) == 0 {
		return nil, ErrInvalid
	}
	return bytes.Clone(v), nil
}
func taText(s string, max int, empty bool) error {
	if !utf8.ValidString(s) || !empty && s == "" {
		return ErrInvalid
	}
	if len(s) > max {
		return ErrBounds
	}
	return nil
}
func taU64(s string) (uint64, error) {
	v, e := strconv.ParseUint(s, 10, 64)
	if e != nil || strconv.FormatUint(v, 10) != s {
		return 0, ErrInvalid
	}
	return v, nil
}
func taHex(s string, n int) error {
	b, e := hex.DecodeString(s)
	if e != nil || len(b) != n || hex.EncodeToString(b) != s {
		return ErrInvalid
	}
	return nil
}
func taCanonical(v any) ([]byte, error) {
	switch x := v.(type) {
	case nil:
		return []byte("null"), nil
	case bool:
		return []byte(strconv.FormatBool(x)), nil
	case string:
		return shopJSONString(x)
	case json.Number:
		n, e := strconv.ParseInt(string(x), 10, 64)
		if e != nil || n > 9007199254740991 || n < -9007199254740991 || strconv.FormatInt(n, 10) != string(x) {
			return nil, ErrInvalid
		}
		return []byte(x), nil
	case []any:
		out := []byte{'['}
		for i, y := range x {
			if i > 0 {
				out = append(out, ',')
			}
			b, e := taCanonical(y)
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
			b, e := shopJSONString(k)
			if e != nil {
				return nil, e
			}
			out = append(out, b...)
			out = append(out, ':')
			b, e = taCanonical(x[k])
			if e != nil {
				return nil, e
			}
			out = append(out, b...)
		}
		return append(out, '}'), nil
	}
	return nil, ErrInvalid
}
func taJSON(v any, max int) ([]byte, error) {
	b, e := json.Marshal(v)
	if e != nil {
		return nil, e
	}
	var data any
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	if d.Decode(&data) != nil {
		return nil, ErrInvalid
	}
	out, e := taCanonical(data)
	if e != nil {
		return nil, e
	}
	if len(out) > max {
		return nil, ErrBounds
	}
	return out, nil
}
func taDecode(raw []byte, max int, out any) error {
	if len(raw) > max {
		return ErrBounds
	}
	if len(raw) == 0 || !utf8.Valid(raw) || !shopJSONSurrogates(raw) {
		return ErrInvalid
	}
	if len(raw) > max {
		return ErrBounds
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if d.Decode(out) != nil || d.Decode(new(any)) != io.EOF {
		return ErrInvalid
	}
	canonical, e := taJSON(out, max)
	if e != nil {
		return e
	}
	if !bytes.Equal(raw, canonical) {
		return ErrInvalid
	}
	return nil
}
func taEqual(a, b any) bool {
	aa, e := taJSON(a, TaskAuthorityWholeMaxBytes)
	if e != nil {
		return false
	}
	bb, e := taJSON(b, TaskAuthorityWholeMaxBytes)
	return e == nil && bytes.Equal(aa, bb)
}
func taFullRef(r TaskAuthorityFullRefDATA) error {
	for _, s := range []string{r.Realm, r.Tenant, r.Kind, r.ID} {
		if e := taText(s, 256, false); e != nil {
			return e
		}
	}
	_, e := taU64(r.Rev)
	return e
}
func EncodeTaskAuthorityFullRefDATA(r TaskAuthorityFullRefDATA) ([]byte, error) {
	if e := taFullRef(r); e != nil {
		return nil, e
	}
	v, _ := taU64(r.Rev)
	rev := make([]byte, 8)
	binary.BigEndian.PutUint64(rev, v)
	return EncodeFields([]byte(r.Realm), []byte(r.Tenant), []byte(r.Kind), []byte(r.ID), rev)
}
func taBind(v GrantBindV1) error { _, e := bgBind(v); return e }
func taSource(s TaskAuthorityDeclaredSourceDATA) error {
	_, e := bgRef(s.Resource)
	if e != nil {
		return e
	}
	_, e = bgSource(GrantSourceV1{Ref: s.Resource, Fields: s.Fields, Label: s.Label, Binding: s.Binding})
	return e
}
func taPayload(p TaskAuthorityResponsePayloadDATA) error {
	if p.Version != "1" || p.Purpose != TaskAuthorityResponsePurpose {
		return ErrInvalid
	}
	for _, s := range []string{p.Realm, p.Tenant, p.Authority, p.Account} {
		if e := taText(s, 256, false); e != nil {
			return e
		}
	}
	for _, s := range []string{p.CurrentTaskRevision, p.CurrentGeneration, p.SourceExpires, p.IssuerEpoch, p.PolicyRevision, p.Height, p.IssuedAt, p.Expires} {
		if _, e := taU64(s); e != nil {
			return e
		}
	}
	if taHex(p.ChainID, 32) != nil || taHex(p.Nonce, 32) != nil || taFullRef(p.ResponseIssuer) != nil || p.ResponseIssuer.Kind != "service" && p.ResponseIssuer.Kind != "organization" {
		return ErrInvalid
	}
	c := p.Call
	for _, r := range []LegacyGrantRefV1{c.GrantRef, c.Issuer, c.Holder, c.Binding.Task} {
		if _, e := bgRef(r); e != nil || r.Realm != p.Realm || r.Tenant != p.Tenant {
			return ErrInvalid
		}
	}
	for _, s := range []string{c.IssuerEpoch, c.HolderEpoch} {
		if _, e := taU64(s); e != nil {
			return e
		}
	}
	for _, b := range []GrantBindV1{c.GrantPayload, c.GrantWire, c.HolderPayload, c.HolderWire, c.RequestBinding, p.OpaqueOriginalBinding, p.WholeServiceResponseBinding, p.WholeRequestBinding} {
		if e := taBind(b); e != nil {
			return e
		}
	}
	if _, e := bgStep(c.Binding); e != nil {
		return e
	}
	if c.Binding.Target.Tenant != p.Tenant {
		return ErrInvalid
	}
	t := p.Transport
	if t.Action != "effect" && t.Action != "query" || t.Method != "POST" || t.ContentType != "application/json" || t.StatusCode != 200 && t.StatusCode != 409 {
		return ErrInvalid
	}
	for _, s := range []string{t.Path, t.Service, t.Origin} {
		if e := taText(s, 2048, false); e != nil {
			return e
		}
	}
	if !strings.HasPrefix(t.Path, "/") || strings.ContainsAny(t.Path, "?#") {
		return ErrInvalid
	}
	if taHex(p.OperationID, 32) != nil || p.State != "COMMITTED" && p.State != "FAILED" && p.State != "UNKNOWN" || t.StatusCode == 409 && p.State != "UNKNOWN" {
		return ErrInvalid
	}
	if p.State == "COMMITTED" {
		r := p.Resource
		if r == nil || r.OperationID != p.OperationID || r.AuthScope != "egress-only-read-fence" || taText(r.RemoteRef, 4096, false) != nil || taSource(r.Source) != nil || taBind(r.ResponseBinding) != nil || r.Source.Resource.Realm != p.Realm || r.Source.Resource.Tenant != p.Tenant {
			return ErrInvalid
		}
	} else if p.Resource != nil {
		return ErrInvalid
	}
	issued, _ := taU64(p.IssuedAt)
	expires, _ := taU64(p.Expires)
	ceiling, _ := taU64(p.SourceExpires)
	if expires <= issued || expires-issued > 60000 || expires > ceiling {
		return ErrInvalid
	}
	return nil
}
func EncodeTaskAuthorityResponsePayloadDATA(p TaskAuthorityResponsePayloadDATA) ([]byte, error) {
	if e := taPayload(p); e != nil {
		return nil, e
	}
	return taJSON(p, TaskAuthorityPayloadMaxBytes)
}
func DecodeTaskAuthorityResponsePayloadDATA(raw []byte) (TaskAuthorityResponsePayloadDATA, error) {
	var p TaskAuthorityResponsePayloadDATA
	if e := taDecode(raw, TaskAuthorityPayloadMaxBytes, &p); e != nil {
		return p, e
	}
	return p, taPayload(p)
}

type taRequestWire struct {
	Version             string `json:"version"`
	Nonce               string `json:"nonce"`
	Account             string `json:"account"`
	CurrentTaskRevision string `json:"currentTaskRevision"`
	CurrentGeneration   string `json:"currentGeneration"`
	SourceExpires       string `json:"sourceExpires"`
	OriginalBody        string `json:"originalBody"`
}

func taB64(s string, max int, empty bool) ([]byte, error) {
	if !empty && s == "" {
		return nil, ErrInvalid
	}
	if len(s) > (max*4+2)/3 {
		return nil, ErrBounds
	}
	b, e := base64.RawURLEncoding.Strict().DecodeString(s)
	if e != nil || base64.RawURLEncoding.EncodeToString(b) != s || !empty && len(b) == 0 {
		return nil, ErrInvalid
	}
	if len(b) > max {
		return nil, ErrBounds
	}
	return b, nil
}
func EncodeTaskAuthorityRequestDATA(r TaskAuthorityRequestInputDATA) ([]byte, error) {
	if r.Version != "1" || taHex(r.Nonce, 32) != nil || taText(r.Account, 256, false) != nil {
		return nil, ErrInvalid
	}
	for _, s := range []string{r.CurrentTaskRevision, r.CurrentGeneration, r.SourceExpires} {
		if _, e := taU64(s); e != nil {
			return nil, e
		}
	}
	body, e := taBytes(r.OriginalBody, TaskAuthorityWholeMaxBytes, false)
	if e != nil {
		return nil, e
	}
	return taJSON(taRequestWire{r.Version, r.Nonce, r.Account, r.CurrentTaskRevision, r.CurrentGeneration, r.SourceExpires, base64.RawURLEncoding.EncodeToString(body)}, TaskAuthorityWholeMaxBytes)
}
func DecodeTaskAuthorityRequestDATA(raw []byte) (TaskAuthorityRequestDATA, error) {
	var w taRequestWire
	var out TaskAuthorityRequestDATA
	if e := taDecode(raw, TaskAuthorityWholeMaxBytes, &w); e != nil {
		return out, e
	}
	body, e := taB64(w.OriginalBody, TaskAuthorityWholeMaxBytes, false)
	if e != nil {
		return out, e
	}
	r := TaskAuthorityRequestInputDATA{w.Version, w.Nonce, w.Account, w.CurrentTaskRevision, w.CurrentGeneration, w.SourceExpires, body}
	if _, e = EncodeTaskAuthorityRequestDATA(r); e != nil {
		return out, e
	}
	return TaskAuthorityRequestDATA{TaskAuthorityRequestInputDATA: r, DataOnly: true}, nil
}

type taProofWire struct {
	Purpose         string `json:"purpose"`
	PayloadOriginal string `json:"payloadOriginal"`
	WireOriginal    string `json:"wireOriginal"`
}
type taOuterWire struct {
	Version      string      `json:"version"`
	OriginalBody string      `json:"originalBody"`
	Proof        taProofWire `json:"proof"`
}

func taEnvelope(v TaskAuthorityWholeResponseInputDATA) (TaskAuthorityWholeResponseInputDATA, error) {
	if v.Version != "1" || v.Proof.Purpose != TaskAuthorityResponsePurpose {
		return v, ErrInvalid
	}
	var e error
	v.OriginalBody, e = taBytes(v.OriginalBody, TaskAuthorityWholeMaxBytes, false)
	if e != nil {
		return v, e
	}
	v.Proof.PayloadOriginal, e = taBytes(v.Proof.PayloadOriginal, TaskAuthorityPayloadMaxBytes, false)
	if e != nil {
		return v, e
	}
	v.Proof.WireOriginal, e = taBytes(v.Proof.WireOriginal, TaskAuthorityWholeMaxBytes, false)
	if e != nil {
		return v, e
	}
	p, e := DecodeTaskAuthorityResponsePayloadDATA(v.Proof.PayloadOriginal)
	if e != nil {
		return v, e
	}
	if shopBind(v.OriginalBody) != p.WholeServiceResponseBinding {
		return v, ErrInvalid
	}
	return v, nil
}
func EncodeTaskAuthorityWholeResponseDATA(input TaskAuthorityWholeResponseInputDATA, maxResponseBytes int) ([]byte, error) {
	if maxResponseBytes < 1 || maxResponseBytes > TaskAuthorityWholeMaxBytes {
		return nil, ErrBounds
	}
	v, e := taEnvelope(input)
	if e != nil {
		return nil, e
	}
	return taJSON(taOuterWire{v.Version, base64.RawURLEncoding.EncodeToString(v.OriginalBody), taProofWire{v.Proof.Purpose, base64.RawURLEncoding.EncodeToString(v.Proof.PayloadOriginal), base64.RawURLEncoding.EncodeToString(v.Proof.WireOriginal)}}, maxResponseBytes)
}
func DecodeTaskAuthorityWholeResponseDATA(raw []byte, maxResponseBytes int) (TaskAuthorityWholeResponseDATA, error) {
	var zero TaskAuthorityWholeResponseDATA
	if maxResponseBytes < 1 || maxResponseBytes > TaskAuthorityWholeMaxBytes {
		return zero, ErrBounds
	}
	var w taOuterWire
	if e := taDecode(raw, maxResponseBytes, &w); e != nil {
		return zero, e
	}
	body, e := taB64(w.OriginalBody, TaskAuthorityWholeMaxBytes, false)
	if e != nil {
		return zero, e
	}
	payload, e := taB64(w.Proof.PayloadOriginal, TaskAuthorityPayloadMaxBytes, false)
	if e != nil {
		return zero, e
	}
	proof, e := taB64(w.Proof.WireOriginal, TaskAuthorityWholeMaxBytes, false)
	if e != nil {
		return zero, e
	}
	v, e := taEnvelope(TaskAuthorityWholeResponseInputDATA{w.Version, body, TaskAuthorityProofDATA{w.Proof.Purpose, payload, proof}})
	if e != nil {
		return zero, e
	}
	return TaskAuthorityWholeResponseDATA{TaskAuthorityWholeResponseInputDATA: v, DataOnly: true}, nil
}
func AssertTaskAuthorityWholeResponseBindingDATA(original []byte, e TaskAuthorityWholeExpectedDATA) (TaskAuthorityWholeBindingDATA, error) {
	var zero TaskAuthorityWholeBindingDATA
	v, err := DecodeTaskAuthorityWholeResponseDATA(original, e.MaxResponseBytes)
	if err != nil {
		return zero, err
	}
	p, err := DecodeTaskAuthorityResponsePayloadDATA(v.Proof.PayloadOriginal)
	if err != nil {
		return zero, err
	}
	r, err := DecodeTaskAuthorityRequestDATA(e.RequestOriginal)
	if err != nil {
		return zero, err
	}
	if r.Account != e.Account || p.Account != e.Account || r.CurrentTaskRevision != e.CurrentTaskRevision || p.CurrentTaskRevision != e.CurrentTaskRevision || r.CurrentGeneration != e.CurrentGeneration || p.CurrentGeneration != e.CurrentGeneration || r.SourceExpires != e.SourceExpires || p.SourceExpires != e.SourceExpires || p.Realm != e.Realm || p.Tenant != e.Tenant || p.Authority != e.Authority || p.Nonce != r.Nonce || p.WholeRequestBinding != shopBind(e.RequestOriginal) || p.Call.RequestBinding != shopBind(r.OriginalBody) {
		return zero, ErrInvalid
	}
	c := e.Call
	if c.Grant.Purpose != BoundGrantDomain || c.Holder.Purpose != GrantEffectDomain {
		return zero, ErrInvalid
	}
	for _, b := range [][]byte{c.Grant.PayloadOriginal, c.Grant.WireOriginal, c.Holder.PayloadOriginal, c.Holder.WireOriginal} {
		if len(b) == 0 || len(b) > TaskAuthorityWholeMaxBytes {
			return zero, ErrBounds
		}
	}
	g, err := DecodeBoundGrant(c.Grant.PayloadOriginal)
	if err != nil {
		return zero, err
	}
	h, err := DecodeGrantEffect(c.Holder.PayloadOriginal)
	if err != nil {
		return zero, err
	}
	inner, err := EncodeBoundGrant(h.Grant)
	if err != nil || !bytes.Equal(inner, c.Grant.PayloadOriginal) || !reflect.DeepEqual(h.Step, g.Binding) {
		return zero, ErrInvalid
	}
	refRevision, err := taU64(c.GrantRef.Rev)
	if err != nil {
		return zero, err
	}
	grantRevision, _ := taU64(g.Rev)
	if c.GrantRef.Realm != g.Realm || c.GrantRef.Tenant != g.Tenant || c.GrantRef.Kind != "grant" || c.GrantRef.ID != g.ID || refRevision < grantRevision || e.Transport.Action == "effect" && c.GrantRef.Rev != g.Rev {
		return zero, ErrInvalid
	}
	wanted := TaskAuthorityResponseCallDATA{c.GrantRef, shopBind(c.Grant.PayloadOriginal), shopBind(c.Grant.WireOriginal), shopBind(c.Holder.PayloadOriginal), shopBind(c.Holder.WireOriginal), g.Issuer, g.Holder, g.IssuerEpoch, g.HolderEpoch, g.Binding, shopBind(r.OriginalBody)}
	if !taEqual(p.Call, wanted) || g.Realm != p.Realm || g.Tenant != p.Tenant || e.Transport.Action == "effect" && shopBind(c.RawInput) != g.Binding.Input || len(c.RawInput) > TaskAuthorityWholeMaxBytes {
		return zero, ErrInvalid
	}
	if !taEqual(p.Transport, e.Transport) {
		return zero, ErrInvalid
	}
	if e.Transport.Action == "query" {
		if taHex(c.OriginalOperation, 32) != nil || c.OriginalOperation != p.OperationID {
			return zero, ErrInvalid
		}
	} else if c.OriginalOperation != "" {
		return zero, ErrInvalid
	}
	if p.OperationID != e.OperationID || p.State != e.State || taText(e.OpaqueOriginal, TaskAuthorityWholeMaxBytes, true) != nil || p.OpaqueOriginalBinding != shopBind([]byte(e.OpaqueOriginal)) {
		return zero, ErrInvalid
	}
	i := e.Issuer
	if taFullRef(i.Principal) != nil || !taEqual(p.ResponseIssuer, i.Principal) || p.IssuerEpoch != i.IssuerEpoch || p.PolicyRevision != i.PolicyRevision || p.Height != i.Height || p.ChainID != i.ChainID {
		return zero, ErrInvalid
	}
	for _, s := range []string{i.IssuerEpoch, i.PolicyRevision, i.Height, i.Expires, e.At} {
		if _, err = taU64(s); err != nil {
			return zero, err
		}
	}
	if taHex(i.ChainID, 32) != nil {
		return zero, ErrInvalid
	}
	expires, _ := taU64(p.Expires)
	issuerExpires, _ := taU64(i.Expires)
	at, _ := taU64(e.At)
	issued, _ := taU64(p.IssuedAt)
	if expires > issuerExpires || at < issued || at >= expires {
		return zero, ErrInvalid
	}
	if p.State == "COMMITTED" {
		s := e.Resource
		if s == nil || len(s.ResponseOriginal) == 0 || len(s.ResponseOriginal) > TaskAuthorityWholeMaxBytes || len(s.SourceBytes) == 0 || len(s.SourceBytes) > TaskAuthorityWholeMaxBytes {
			return zero, ErrInvalid
		}
		resource := TaskAuthorityResponseResourceDATA{s.OperationID, s.RemoteRef, s.AuthScope, s.Source, shopBind(s.ResponseOriginal)}
		if !taEqual(p.Resource, resource) || shopBind(s.SourceBytes) != s.Source.Binding {
			return zero, ErrInvalid
		}
		found := false
		for _, x := range g.Binding.Sources {
			if x.Ref == s.Source.Resource && reflect.DeepEqual(x.Fields, s.Source.Fields) && x.Label == s.Source.Label {
				found = true
			}
		}
		if !found {
			return zero, ErrInvalid
		}
	} else if e.Resource != nil {
		return zero, ErrInvalid
	}
	return TaskAuthorityWholeBindingDATA{Payload: p, ResponseOriginal: v.OriginalBody, Proof: v.Proof, DataOnly: true}, nil
}
