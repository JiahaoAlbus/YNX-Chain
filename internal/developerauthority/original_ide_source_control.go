package developerauthority

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strconv"
	"time"
)

type originalIDEControlAttachment struct {
	ControlOriginal      string `json:"controlOriginal"`
	Nonce                string `json:"nonce"`
	RegistrationOriginal string `json:"registrationOriginal"`
}
type originalIDEControlProjection struct {
	Principal    string `json:"principalSHA256"`
	Binding      string `json:"bindingSHA256"`
	Proof        string `json:"proofSHA256"`
	Confirmation string `json:"confirmationRef"`
	Revocation   string `json:"revocationRef"`
	Request      string `json:"requestId"`
	Nonce        string `json:"nonce"`
	Decision     string `json:"decision"`
	Expires      int64  `json:"expiresMS"`
	Ready        bool   `json:"readyForSourceVerification"`
	Verified     bool   `json:"signatureVerified"`
	Data         bool   `json:"dataOnly"`
	Authorized   bool   `json:"authorized"`
	Committed    bool   `json:"committed"`
	Native       bool   `json:"nativeAdmission"`
}

// The expected nonce/registration come from the pre-existing protected Native
// capture row, not from the proof they authenticate. This method cannot create
// a review/nonce, approve a command, replace a capture or acquire a signing key.
func (o *OriginalIDEPublicationSourceOwner) control(ctx context.Context, p Principal, c Command, proof []byte) (Approval, *originalIDESourceRecord, error) {
	var empty Approval
	if e := o.check(ctx); e != nil {
		return empty, nil, e
	}
	if !c.valid(time.Now().UnixMilli()) || !principalValid(p, time.Now().UnixMilli()) {
		return empty, nil, ErrDenied
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return empty, nil, e
	}
	r, e := o.record(ctx, "control", p.Account, objectHash(c))
	if e != nil {
		return empty, r, e
	}
	var a originalIDEControlAttachment
	if originalIDEStrict(r.input.Attachment, &a) != nil || len(a.ControlOriginal) == 0 || len(a.ControlOriginal) > 393216 || !approvalNonce.MatchString(a.Nonce) || !bytes.Equal(proof, []byte(a.ControlOriginal)) {
		return empty, r, ErrDenied
	}
	if e = o.current(ctx, r); e != nil {
		return empty, r, e
	}
	sourceBefore := r.projection
	input := map[string]any{"operation": "ide-project-control-current-native-node/v1", "source": o.sourceInput(r), "approvalOriginal": a.ControlOriginal, "principal": originalIDEPrincipal(p), "command": originalIDECommand(c), "expected": map[string]string{"nonce": a.Nonce, "callerIdentity": o.config.CallerIdentity, "sourceCurrentRef": p.CurrentRef}}
	raw, e := originalIDEJSON(input)
	if e != nil {
		return empty, r, e
	}
	out, e := o.verifier.invokeDATA(ctx, raw, originalVerifierOutputLimit, false, originalIDEControlOutput)
	r.current = bytes.Clone(out)
	if e != nil {
		return empty, r, e
	}
	var envelope struct {
		Projection originalIDEControlProjection `json:"projection"`
	}
	if json.Unmarshal(out, &envelope) != nil {
		return empty, r, ErrDenied
	}
	v := envelope.Projection
	result := Approval{v.Principal, v.Binding, v.Proof, v.Confirmation, v.Revocation, v.Expires}
	if !v.Ready || v.Decision != "approve" || v.Request != c.RequestID || v.Nonce != a.Nonce || !validApproval(result, p, c, proof, time.Now().UnixMilli()) {
		return empty, r, ErrDenied
	}
	if e = o.current(ctx, r); e != nil {
		return empty, r, e
	}
	if !originalIDESameSource(sourceBefore, r.projection) {
		return empty, r, ErrDenied
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return empty, r, e
	}
	if !validApproval(result, p, c, proof, time.Now().UnixMilli()) {
		return empty, r, ErrDenied
	}
	return result, r, nil
}
func (o *OriginalIDEPublicationSourceOwner) AuthorizeProjectControl(ctx context.Context, p Principal, c Command, proof []byte) (Approval, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	a, _, e := o.control(ctx, p, c, bytes.Clone(proof))
	return a, e
}
func (o *OriginalIDEPublicationSourceOwner) AssertControlCurrent(ctx context.Context, p Principal, a Approval) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	r, e := o.record(ctx, "control", p.Account, a.BindingSHA256)
	if e != nil {
		return e
	}
	var attachment originalIDEControlAttachment
	if originalIDEStrict(r.input.Attachment, &attachment) != nil {
		return ErrDenied
	}
	var wire struct {
		Command string `json:"commandOriginal"`
	}
	if json.Unmarshal([]byte(attachment.ControlOriginal), &wire) != nil {
		return ErrDenied
	}
	var cmd Command
	if json.Unmarshal([]byte(wire.Command), &cmd) != nil || objectHash(cmd) != a.BindingSHA256 {
		return ErrDenied
	}
	found, _, e := o.control(ctx, p, cmd, []byte(attachment.ControlOriginal))
	if e != nil || found != a {
		return ErrDenied
	}
	return nil
}
func (o *OriginalIDEPublicationSourceOwner) VerifyProtectedPublisherOriginal(ctx context.Context, p Principal, c Command, public []byte) (ProtectedPublisher, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	var empty ProtectedPublisher
	r, e := o.record(ctx, "control", p.Account, objectHash(c))
	if e != nil {
		return empty, e
	}
	var a originalIDEControlAttachment
	if originalIDEStrict(r.input.Attachment, &a) != nil || c.Action != "project.publisher" || c.Revoke || hash(public) != c.PublicOriginalSHA256 {
		return empty, ErrDenied
	}
	if _, r, e = o.control(ctx, p, c, []byte(a.ControlOriginal)); e != nil {
		return empty, e
	}
	if e = o.current(ctx, r); e != nil {
		return empty, e
	}
	raw, e := originalIDEJSON(map[string]any{"operation": "ide-protected-publisher-current-native-node/v1", "source": o.sourceInput(r), "registrationOriginal": a.RegistrationOriginal, "principal": originalIDEPrincipal(p), "command": originalIDECommand(c)})
	if e != nil {
		return empty, e
	}
	out, e := o.verifier.invokeDATA(ctx, raw, originalVerifierOutputLimit, false, originalIDEPublisherOutput)
	r.current = bytes.Clone(out)
	if e != nil {
		return empty, e
	}
	var envelope struct {
		Projection struct {
			Account, ProjectID, PublisherID, KeyRole, PublicSHA256, RegistrationRef string
			Expires                                                                 int64 `json:"expiresAtMs"`
		} `json:"projection"`
	}
	if json.Unmarshal(out, &envelope) != nil {
		return empty, ErrDenied
	}
	v := envelope.Projection
	key := ProtectedPublisher{v.Account, v.ProjectID, v.PublisherID, v.KeyRole, v.PublicSHA256, v.RegistrationRef, v.Expires}
	// Compare actual carried R13 separately from independent dual custody proof.
	var registration struct {
		Public string `json:"publicOriginal"`
	}
	if json.Unmarshal([]byte(a.RegistrationOriginal), &registration) != nil {
		return empty, ErrDenied
	}
	decoded, e := base64.RawURLEncoding.DecodeString(registration.Public)
	if e != nil || base64.RawURLEncoding.EncodeToString(decoded) != registration.Public || !bytes.Equal(decoded, public) || key.Account != c.SubjectAccount || key.ProjectID != c.ProjectID || key.PublisherID != c.PublisherID || key.KeyRole != "ide-artifact-publisher" || key.PublicSHA256 != c.PublicOriginalSHA256 || key.ExpiresMS < c.GrantExpiresMS {
		return empty, ErrDenied
	}
	if e = o.current(ctx, r); e != nil {
		return empty, e
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return empty, e
	}
	if time.Now().UnixMilli() >= key.ExpiresMS {
		return empty, ErrDenied
	}
	return key, nil
}

type originalIDEProjectView struct {
	Principal map[string]json.RawMessage `json:"principal"`
	Project   struct {
		ID                     string `json:"projectId"`
		Owner                  string `json:"ownerAccount"`
		Origin                 string `json:"runtimeOrigin"`
		Current                string `json:"currentReference"`
		Revision               string `json:"projectRevision"`
		Catalog                string `json:"catalogRevision"`
		Read, Publish, Runtime bool
		Expires                int64 `json:"expiresMS"`
	} `json:"project"`
	Publisher *struct {
		Account      string `json:"account"`
		Project      string `json:"projectId"`
		ID           string `json:"publisherId"`
		Role         string `json:"keyRole"`
		Public       string `json:"publicOriginal"`
		Hash         string `json:"publicSHA256"`
		Registration string `json:"registrationRef"`
		Revision     string `json:"revision"`
		Expires      int64  `json:"expiresMS"`
		Revoked      bool   `json:"revoked"`
	} `json:"publisher"`
	Endpoint, SPKI string
}

func (o *OriginalIDEPublicationSourceOwner) project(ctx context.Context, p Principal) (*originalIDESourceRecord, originalIDEProjectView, error) {
	var v originalIDEProjectView
	r, e := o.record(ctx, "project", p.Account, objectHash(p))
	if e != nil {
		return r, v, e
	}
	if e = o.current(ctx, r); e != nil {
		return r, v, e
	}
	var selection struct {
		Authority originalIDEProjectView `json:"projectAuthority"`
	}
	if json.Unmarshal(r.projection.Selection, &selection) != nil {
		return r, v, ErrDenied
	}
	v = selection.Authority
	// Source projectAuthority uses numeric expiresMS; the dedicated CLI
	// Principal transport uses decimal strings. They are distinct existing
	// schemas, not aliases or permission DTOs.
	expectedPrincipal := map[string]any{}
	for k, value := range originalIDEPrincipal(p) {
		expectedPrincipal[k] = value
	}
	expectedPrincipal["expiresMS"] = p.ExpiresMS
	expected, _ := originalIDEJSON(expectedPrincipal)
	actual, _ := originalIDEJSON(v.Principal)
	if !bytes.Equal(actual, expected) || v.Project.Expires <= time.Now().UnixMilli() {
		return r, v, ErrDenied
	}
	return r, v, nil
}
func (o *OriginalIDEPublicationSourceOwner) publisher(ctx context.Context, p Principal, key Publisher) (*originalIDESourceRecord, error) {
	r, v, e := o.project(ctx, p)
	if e != nil {
		return r, e
	}
	k := v.Publisher
	if k == nil {
		return r, ErrDenied
	}
	public, e := base64.RawURLEncoding.DecodeString(k.Public)
	revision, re := strconv.ParseUint(k.Revision, 10, 64)
	if e != nil || re != nil || revision == 0 || strconv.FormatUint(revision, 10) != k.Revision || k.Revoked || !v.Project.Publish || k.Expires <= time.Now().UnixMilli() || k.Account != p.Account || k.Account != key.Account || k.Project != key.ProjectID || k.ID != key.PublisherID || k.Role != "ide-artifact-publisher" || k.Role != key.KeyRole || k.Hash != hash(public) || k.Hash != key.PublicSHA256 || k.Registration != key.RegistrationRef || revision != key.Revision || k.Expires != key.ExpiresMS || key.Revoked || !bytes.Equal(public, key.PublicOriginal) {
		return r, ErrDenied
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return r, e
	}
	return r, nil
}
func (o *OriginalIDEPublicationSourceOwner) AssertPublisherCurrent(ctx context.Context, p Principal, key Publisher) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	_, e := o.publisher(ctx, p, key)
	return e
}
