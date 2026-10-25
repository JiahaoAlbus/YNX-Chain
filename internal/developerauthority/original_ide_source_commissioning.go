package developerauthority

// Protected provisioning entrypoint, deliberately NOT a public HTTP handler or
// startup side effect. It imports independently admitted original captures and
// history, never manufactures trust, a zero watermark, a key or an approval.
import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"sync"
	"time"
)

func originalIDEParseRelease(raw []byte) (originalIDERelease, error) {
	var c originalIDERelease
	if originalIDEStrict(raw, &c) != nil || c.Version != "YNX-IDE-PUBLICATION-SOURCE/v1" || !text(c.SourceID) || !text(c.InstanceID) || !text(c.CallerIdentity) || !approvalHex.MatchString(c.PrincipalSPKI) || !approvalHex.MatchString(c.CatalogBinding) || len(c.Templates) != 5 {
		return c, ErrDenied
	}
	for kind, purpose := range map[string]string{"catalog": "ide-project-authority-v1", "project": "ide-project-authority-v1", "control": "ide-project-control-authority-v1", "artifact": "ide-publication-approval-authority-v1", "resource": "ide-publication-approval-authority-v1"} {
		t, ok := c.Templates[kind]
		var p struct {
			Signature struct {
				Purpose string `json:"purpose"`
			} `json:"signatureContract"`
		}
		if !ok || !text(t.SourceID) || !text(t.InstanceID) || json.Unmarshal(t.Policy, &p) != nil || p.Signature.Purpose != purpose || len(t.Node) == 0 {
			return c, ErrDenied
		}
	}
	return c, nil
}

// Admission is a SECOND independently startup-admitted protected file. Its
// expected digest is selected by the existing provisioning custodian, not read
// from the capture being imported or from HTTP/ENV. Root coordinates suppliers;
// it is not instructed to generate missing original histories.
type OriginalIDECommissioningConfig struct {
	Source    OriginalIDEPublicationSourceConfig
	Admission OriginalVerifierFile
}

func (OriginalIDECommissioningConfig) String() string {
	return "OriginalIDECommissioningConfig{protected references redacted}"
}
func (c OriginalIDECommissioningConfig) GoString() string { return c.String() }

type originalIDECommissioningAdmission struct {
	Version             string `json:"version"`
	SourceID            string `json:"sourceId"`
	InstanceID          string `json:"instanceId"`
	DatabaseRole        string `json:"databaseRole"`
	SourceReleaseSHA256 string `json:"sourceReleaseSHA256"`
	CaptureSHA256       string `json:"captureSHA256"`
	CaptureBytes        int64  `json:"captureBytes"`
	ExpiresMS           int64  `json:"expiresAtMs"`
}
type originalIDECommissioningCapture struct {
	Version          string `json:"version"`
	SourceID         string `json:"sourceId"`
	InstanceID       string `json:"instanceId"`
	Kind             string `json:"kind"`
	Subject          string `json:"subject"`
	Binding          string `json:"binding"`
	Original         string `json:"original"`
	Previous         string `json:"previousOriginal"`
	ApprovalPrevious string `json:"approvalPreviousOriginal"`
}
type OriginalIDECommissioningReceipt struct {
	CaptureSHA256 string
	Committed     bool
}

// The exact allocated capture stays retained before selection. Commit UNKNOWN
// never permits another write; ResolveSelected only reads that same receipt.
type OriginalIDECommissioningOwner struct {
	mu                 sync.Mutex
	source             *OriginalIDEPublicationSourceOwner
	admission          verifierHeldFile
	capture            verifierHeldFile
	config             originalIDECommissioningAdmission
	raw, current       []byte
	afterCurrent       []byte
	heldApproval       *originalIDECommissionedApproval
	selected           bool
	first, closeResult error
	closed             bool
}

func (*OriginalIDECommissioningOwner) String() string {
	return "OriginalIDECommissioningOwner{original custody redacted}"
}
func (o *OriginalIDECommissioningOwner) GoString() string { return o.String() }

func OpenOriginalIDECommissioning(ctx context.Context, privilegedAuthDB *sql.DB, c OriginalIDECommissioningConfig) (*OriginalIDECommissioningOwner, error) {
	return openOriginalIDECommissioning(ctx, privilegedAuthDB, c, nil)
}

// Cold recovery is a separate DATA-only opening. The SAME protected original
// admission/capture pins and role are required, but expiry cannot erase an
// already selected attempt. No verifier, insert, head advance or new grant.
func OpenOriginalIDECommissioningRecovery(ctx context.Context, privilegedAuthDB *sql.DB, c OriginalIDECommissioningConfig, selectedCapture OriginalVerifierFile) (*OriginalIDECommissioningOwner, error) {
	return openOriginalIDECommissioning(ctx, privilegedAuthDB, c, &selectedCapture)
}
func openOriginalIDECommissioning(ctx context.Context, privilegedAuthDB *sql.DB, c OriginalIDECommissioningConfig, recovery *OriginalVerifierFile) (*OriginalIDECommissioningOwner, error) {
	if ctx == nil || ctx.Err() != nil || privilegedAuthDB == nil {
		return nil, ErrDenied
	}
	o := &OriginalIDECommissioningOwner{source: &OriginalIDEPublicationSourceOwner{db: privilegedAuthDB}}
	var e error
	o.admission, e = verifierOpen(c.Admission)
	if e != nil {
		o.first = e
		return o, e
	}
	raw, e := io.ReadAll(io.NewSectionReader(o.admission.file, 0, c.Admission.Bytes+1))
	if e != nil || decodeExactObject(raw, 16384, map[string]any{"version": &o.config.Version, "sourceId": &o.config.SourceID, "instanceId": &o.config.InstanceID, "databaseRole": &o.config.DatabaseRole, "sourceReleaseSHA256": &o.config.SourceReleaseSHA256, "captureSHA256": &o.config.CaptureSHA256, "captureBytes": &o.config.CaptureBytes, "expiresAtMs": &o.config.ExpiresMS}) != nil || o.config.Version != "YNX-IDE-SOURCE-COMMISSIONING/v1" || !text(o.config.DatabaseRole) || !approvalHex.MatchString(o.config.CaptureSHA256) || o.config.CaptureBytes <= 0 || o.config.CaptureBytes > 1048576 || o.config.ExpiresMS <= 0 || (recovery == nil && o.config.ExpiresMS <= time.Now().UnixMilli()) || o.config.SourceReleaseSHA256 != c.Source.Release.SHA256 {
		o.first = ErrDenied
		return o, ErrDenied
	}
	o.source.release, e = verifierOpen(c.Source.Release)
	if e != nil {
		o.first = e
		return o, e
	}
	raw, e = io.ReadAll(io.NewSectionReader(o.source.release.file, 0, c.Source.Release.Bytes+1))
	if e == nil {
		o.source.config, e = originalIDEParseRelease(raw)
	}
	if e != nil || o.config.SourceID != o.source.config.SourceID || o.config.InstanceID != o.source.config.InstanceID {
		o.first = ErrDenied
		return o, ErrDenied
	}
	// Separate admin pool and actual DB role; normal HTTP role never receives
	// INSERT rights. No DDL or SET ROLE, fallback pool or credential acquisition.
	var role string
	var revision int
	if e = privilegedAuthDB.QueryRowContext(ctx, "SELECT current_user,revision FROM public.auth_ide_original_source_schema WHERE singleton=1").Scan(&role, &revision); e != nil || role != o.config.DatabaseRole || revision != 1 {
		o.first = ErrDenied
		return o, ErrDenied
	}
	if recovery != nil {
		o.selected = true
		if recovery.SHA256 != o.config.CaptureSHA256 || recovery.Bytes != o.config.CaptureBytes {
			o.first = ErrDenied
			return o, ErrDenied
		}
		o.capture, e = verifierOpen(*recovery)
		if e != nil {
			o.first = e
			return o, e
		}
		o.raw, e = io.ReadAll(io.NewSectionReader(o.capture.file, 0, recovery.Bytes+1))
		if e != nil {
			o.first = e
			return o, e
		}
		if _, _, e = originalIDECommissioningDecode(o.raw, o.source.config); e != nil {
			o.first = e
			return o, e
		}
		return o, nil
	}
	o.source.verifier, e = OpenOriginalSourceVerifier(c.Source.Verifier)
	if e != nil {
		o.first = e
		return o, e
	}
	o.source.principal, e = OpenOriginalDeveloperHTTPAuthority(OriginalDeveloperHTTPAuthorityConfig{o.source.config.PrincipalSPKI})
	if e != nil {
		o.first = e
		return o, e
	}
	return o, nil
}
func (o *OriginalIDECommissioningOwner) check(ctx context.Context) error {
	if o == nil || ctx == nil || ctx.Err() != nil || o.closed || o.first != nil || o.source == nil || o.config.ExpiresMS <= time.Now().UnixMilli() {
		return ErrDenied
	}
	if e := o.admission.check(); e != nil {
		return e
	}
	return o.source.check(ctx)
}
func originalIDECommissioningPrevious(raw string) error {
	var v struct {
		Sequence uint64 `json:"sequence"`
		Floor    uint64 `json:"floor"`
		Head     string `json:"head"`
		Time     int64  `json:"timeFloor"`
		Height   string `json:"executionHeight"`
	}
	if decodeExactObject([]byte(raw), 16384, map[string]any{"sequence": &v.Sequence, "floor": &v.Floor, "head": &v.Head, "timeFloor": &v.Time, "executionHeight": &v.Height}) != nil || v.Sequence == 0 || v.Sequence > 9007199254740991 || v.Floor > v.Sequence || !approvalHex.MatchString(v.Head) || v.Time <= 0 || v.Time > time.Now().UnixMilli() {
		return ErrDenied
	}
	h, e := strconv.ParseUint(v.Height, 10, 64)
	if e != nil || strconv.FormatUint(h, 10) != v.Height {
		return ErrDenied
	}
	return nil
}
func originalIDECommissioningDecode(raw []byte, c originalIDERelease) (originalIDECommissioningCapture, *originalIDESourceRecord, error) {
	var b originalIDECommissioningCapture
	if decodeExactObject(raw, 1048576, map[string]any{"version": &b.Version, "sourceId": &b.SourceID, "instanceId": &b.InstanceID, "kind": &b.Kind, "subject": &b.Subject, "binding": &b.Binding, "original": &b.Original, "previousOriginal": &b.Previous, "approvalPreviousOriginal": &b.ApprovalPrevious}) != nil || b.Version != "YNX-IDE-SOURCE-CAPTURE/v1" || b.SourceID != c.SourceID || b.InstanceID != c.InstanceID || !text(b.Binding) || len(b.Binding) > 256 || originalIDECommissioningPrevious(b.Previous) != nil {
		return b, nil, ErrDenied
	}
	if _, ok := c.Templates[b.Kind]; !ok {
		return b, nil, ErrDenied
	}
	if b.Kind != "artifact" && b.Kind != "resource" && !approvalHex.MatchString(b.Binding) {
		return b, nil, ErrDenied
	}
	if b.Kind == "catalog" {
		if b.Subject != "" || b.Binding != c.CatalogBinding {
			return b, nil, ErrDenied
		}
	} else if !text(b.Subject) {
		return b, nil, ErrDenied
	}
	r := &originalIDESourceRecord{kind: b.Kind, subject: b.Subject, binding: b.Binding, original: []byte(b.Original), previous: []byte(b.Previous), previousSHA: hash([]byte(b.Previous))}
	if len(r.original) == 0 || len(r.original) > 1572864 || decodeExactObject(r.original, 1572864, map[string]any{"rootRaw": &r.input.Root, "enrollmentRaw": &r.input.Enrollment, "profileRaw": &r.input.Profile, "headRaw": &r.input.Head, "attachment": &r.input.Attachment}) != nil || r.input.Root == "" || r.input.Enrollment == "" || r.input.Profile == "" || r.input.Head == "" {
		return b, nil, ErrDenied
	}
	r.profile = hash([]byte(r.input.Profile))
	r.digest = hash(r.original)
	if b.Kind == "artifact" || b.Kind == "resource" {
		if originalIDECommissioningApprovalPrevious(b.ApprovalPrevious) != nil {
			return b, nil, ErrDenied
		}
	} else if b.ApprovalPrevious != "" {
		return b, nil, ErrDenied
	}
	return b, r, nil
}
func originalIDECommissioningApprovalPrevious(raw string) error {
	var p struct {
		Sequence string `json:"sequence"`
		Floor    string `json:"floor"`
		Decision string `json:"decision"`
		State    string `json:"requestState"`
		Result   string `json:"resultOriginalSHA256"`
		Scope    string `json:"scopeSHA256"`
		Time     int64  `json:"timeFloor"`
	}
	if decodeExactObject([]byte(raw), 16384, map[string]any{"sequence": &p.Sequence, "floor": &p.Floor, "decision": &p.Decision, "requestState": &p.State, "resultOriginalSHA256": &p.Result, "scopeSHA256": &p.Scope, "timeFloor": &p.Time}) != nil || !approvalHex.MatchString(p.Result) || !approvalHex.MatchString(p.Scope) || p.Decision != "approved" || (p.State != "returned" && p.State != "signed-unhanded") || p.Time <= 0 || p.Time > time.Now().UnixMilli() {
		return ErrDenied
	}
	s, e := strconv.ParseUint(p.Sequence, 10, 64)
	f, fe := strconv.ParseUint(p.Floor, 10, 64)
	if e != nil || fe != nil || s == 0 || f > s || strconv.FormatUint(s, 10) != p.Sequence || strconv.FormatUint(f, 10) != p.Floor {
		return ErrDenied
	}
	return nil
}

type originalIDECommissionedApproval struct {
	ref               string
	previous, current []byte
	expires           int64
}

func (o *OriginalIDECommissioningOwner) approval(ctx context.Context, b originalIDECommissioningCapture, r *originalIDESourceRecord) (*originalIDECommissionedApproval, error) {
	if b.ApprovalPrevious == "" {
		return nil, nil
	}
	var attachment struct {
		Scope string `json:"scopeOriginal"`
	}
	var scope originalIDEApprovalScope
	if originalIDEStrict(r.input.Attachment, &attachment) != nil || originalIDEStrict([]byte(attachment.Scope), &scope) != nil || scope.Kind != b.Kind || scope.Account != b.Subject || scope.Caller != o.source.config.CallerIdentity || !text(scope.Ref) || scope.Expires <= time.Now().UnixMilli() || (b.Kind == "artifact" && scope.Ref != b.Binding) {
		return nil, ErrDenied
	}
	var nonce [32]byte
	if _, e := rand.Read(nonce[:]); e != nil {
		return nil, ErrUnknown
	}
	input, e := originalIDEJSON(map[string]any{"operation": "ide-publication-approval-current-native-node/v1", "source": o.source.sourceInput(r), "expectedScopeOriginal": attachment.Scope, "nonce": base64.RawURLEncoding.EncodeToString(nonce[:]), "previous": json.RawMessage(b.ApprovalPrevious)})
	if e != nil {
		return nil, e
	}
	raw, e := o.source.verifier.InvokeOriginalApprovalCurrentDATA(ctx, input)
	// Retain even failed original output before considering its status.
	a := &originalIDECommissionedApproval{ref: scope.Ref, previous: []byte(b.ApprovalPrevious), current: bytes.Clone(raw)}
	if e != nil {
		return a, e
	}
	var out struct {
		Projection originalIDEApprovalProjection `json:"projection"`
	}
	if json.Unmarshal(raw, &out) != nil {
		return a, ErrDenied
	}
	p := out.Projection
	if p.Kind != b.Kind || p.Scope != hash([]byte(attachment.Scope)) || !p.Ready || p.Decision != "approved" || (p.State != "returned" && p.State != "signed-unhanded") || p.Expires > scope.Expires || p.Expires <= time.Now().UnixMilli() {
		return a, ErrDenied
	}
	a.expires = p.Expires
	return a, nil
}

func (o *OriginalIDECommissioningOwner) InstallSelectedCapture(ctx context.Context, pin OriginalVerifierFile) (OriginalIDECommissioningReceipt, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	var empty OriginalIDECommissioningReceipt
	if e := o.check(ctx); e != nil {
		return empty, e
	}
	if o.selected || pin.SHA256 != o.config.CaptureSHA256 || pin.Bytes != o.config.CaptureBytes {
		return empty, ErrDenied
	}
	// Selection occurs before opening; failed/partial input never causes retry.
	o.selected = true
	var e error
	o.capture, e = verifierOpen(pin)
	if e != nil {
		o.first = e
		return empty, e
	}
	o.raw, e = io.ReadAll(io.NewSectionReader(o.capture.file, 0, pin.Bytes+1))
	if e != nil {
		o.first = e
		return empty, e
	}
	b, r, e := originalIDECommissioningDecode(o.raw, o.source.config)
	if e != nil {
		o.first = e
		return empty, e
	}
	started := time.Now()
	input, e := originalIDEJSON(o.source.sourceInput(r))
	if e != nil {
		o.first = e
		return empty, e
	}
	o.current, e = o.source.verifier.InvokeOriginalCurrentDATA(ctx, input)
	if e != nil {
		o.first = e
		return empty, e
	}
	var out struct {
		Projection originalIDEProjection `json:"projection"`
	}
	if json.Unmarshal(o.current, &out) != nil {
		o.first = ErrDenied
		return empty, ErrDenied
	}
	v := out.Projection
	t := o.source.config.Templates[b.Kind]
	if v.Profile != r.profile || v.SourceID != t.SourceID || v.InstanceID != t.InstanceID || v.Status != "active" || !v.DataOnly || v.NativeAdmission {
		o.first = ErrDenied
		return empty, ErrDenied
	}
	approval, e := o.approval(ctx, b, r)
	o.heldApproval = approval
	if e != nil {
		o.first = e
		return empty, e
	}
	// Re-read through the SAME pinned Source after the approval-current call.
	// No DB or Source head is modified by either verifier invocation here.
	if approval != nil {
		again, ae := o.source.verifier.InvokeOriginalCurrentDATA(ctx, input)
		o.afterCurrent = bytes.Clone(again)
		var after struct {
			Projection originalIDEProjection `json:"projection"`
		}
		if ae != nil || json.Unmarshal(again, &after) != nil || !originalIDESameSource(v, after.Projection) {
			o.first = ErrDenied
			return empty, ErrDenied
		}
		v = after.Projection
		o.current = bytes.Clone(again)
	}
	if e = o.check(ctx); e != nil {
		o.first = e
		return empty, e
	}
	if e = o.capture.check(); e != nil {
		o.first = e
		return empty, e
	}
	fence := func() error {
		now := time.Now().UnixMilli()
		if now < v.TimeFloor || now >= v.Expires || (approval != nil && now >= approval.expires) || time.Since(started) >= time.Duration(v.Expires-started.UnixMilli())*time.Millisecond {
			return ErrDenied
		}
		if e := o.check(ctx); e != nil {
			return e
		}
		return o.capture.check()
	}
	e = originalIDECommissioningCommit(ctx, o.source.db, o.config.DatabaseRole, o.source.config, r, approval, o.raw, o.current, fence)
	if e != nil {
		o.first = e
		return empty, e
	}
	if e = fence(); e != nil {
		o.first = e
		return empty, ErrUnknown
	}
	return OriginalIDECommissioningReceipt{CaptureSHA256: hash(o.raw), Committed: true}, nil
}

const originalIDECommissioningReceiptRead = `SELECT original,sha256 FROM public.auth_ide_original_source_observations WHERE source_id=$1 AND instance_id=$2 AND kind='source' AND reference=$3 AND sha256=$4 AND current_user=$5`

func originalIDECommissioningCommit(ctx context.Context, db *sql.DB, role string, c originalIDERelease, r *originalIDESourceRecord, approval *originalIDECommissionedApproval, capture, current []byte, fence func() error) (result error) {
	tx, e := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if e != nil {
		return ErrUnknown
	}
	defer func() {
		if e := tx.Rollback(); e != nil && !errors.Is(e, sql.ErrTxDone) {
			result = ErrUnknown
		}
	}()
	var actual string
	if e = tx.QueryRowContext(ctx, "SELECT current_user").Scan(&actual); e != nil || actual != role {
		return ErrDenied
	}
	if e = fence(); e != nil {
		return e
	}
	// Existing heads are locked and must match exactly, never reset backwards.
	if _, e = tx.ExecContext(ctx, `INSERT INTO public.auth_ide_original_source_heads(source_id,instance_id,profile_sha256,previous_original,sha256) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, c.SourceID, c.InstanceID, r.profile, []byte(r.previous), r.previousSHA); e != nil {
		return ErrUnknown
	}
	var prior []byte
	var priorHash string
	if e = tx.QueryRowContext(ctx, originalIDEHeadRead+" FOR UPDATE", c.SourceID, c.InstanceID, r.profile).Scan(&prior, &priorHash); e != nil {
		return ErrUnknown
	}
	if !bytes.Equal(prior, r.previous) || priorHash != r.previousSHA {
		return ErrConflict
	}
	if approval != nil {
		if _, e = tx.ExecContext(ctx, `INSERT INTO public.auth_ide_original_approval_heads(source_id,instance_id,kind,approval_ref,previous_original,sha256) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, c.SourceID, c.InstanceID, r.kind, approval.ref, approval.previous, hash(approval.previous)); e != nil {
			return ErrUnknown
		}
		if e = tx.QueryRowContext(ctx, originalIDEApprovalHeadRead+" FOR UPDATE", c.SourceID, c.InstanceID, r.kind, approval.ref).Scan(&prior, &priorHash); e != nil {
			return ErrUnknown
		}
		if !bytes.Equal(prior, approval.previous) || priorHash != hash(approval.previous) {
			return ErrConflict
		}
	}
	res, e := tx.ExecContext(ctx, `INSERT INTO public.auth_ide_original_source_records(source_id,instance_id,kind,subject,binding,original,sha256) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, c.SourceID, c.InstanceID, r.kind, r.subject, r.binding, r.original, r.digest)
	if e != nil {
		return ErrUnknown
	}
	n, e := res.RowsAffected()
	if e != nil {
		return ErrUnknown
	}
	if n != 1 {
		return ErrConflict
	}
	for _, v := range []struct {
		ref string
		raw []byte
	}{{"commission-capture:" + hash(capture), capture}, {"commission-current:" + hash(capture), current}} {
		if _, e = tx.ExecContext(ctx, `INSERT INTO public.auth_ide_original_source_observations(source_id,instance_id,kind,reference,original,sha256) VALUES($1,$2,'source',$3,$4,$5)`, c.SourceID, c.InstanceID, v.ref, v.raw, hash(v.raw)); e != nil {
			return ErrUnknown
		}
	}
	if approval != nil {
		if _, e = tx.ExecContext(ctx, `INSERT INTO public.auth_ide_original_source_observations(source_id,instance_id,kind,reference,original,sha256) VALUES($1,$2,$3,$4,$5,$6)`, c.SourceID, c.InstanceID, r.kind, "commission-current:"+hash(capture), approval.current, hash(approval.current)); e != nil {
			return ErrUnknown
		}
	}
	if e = fence(); e != nil {
		return e
	}
	if e = tx.Commit(); e != nil {
		return ErrUnknown
	}
	return nil
}

// Read only, including after UNKNOWN. Never reinstall/reallocate/reverify or
// return raw originals. Missing receipt stays UNKNOWN, not permission to retry.
func (o *OriginalIDECommissioningOwner) ResolveSelected(ctx context.Context) (OriginalIDECommissioningReceipt, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	var empty OriginalIDECommissioningReceipt
	if ctx == nil || ctx.Err() != nil || o.closed || !o.selected || len(o.raw) == 0 {
		return empty, ErrDenied
	}
	var b []byte
	var h string
	digest := hash(o.raw)
	e := o.source.db.QueryRowContext(ctx, originalIDECommissioningReceiptRead, o.config.SourceID, o.config.InstanceID, "commission-capture:"+digest, digest, o.config.DatabaseRole).Scan(&b, &h)
	if e != nil || !bytes.Equal(b, o.raw) || h != digest {
		return empty, ErrUnknown
	}
	return OriginalIDECommissioningReceipt{CaptureSHA256: digest, Committed: true}, nil
}
func (o *OriginalIDECommissioningOwner) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed {
		return o.closeResult
	}
	o.closed = true
	for _, f := range []func() error{func() error {
		if o.source != nil {
			return o.source.Close()
		}
		return nil
	}, func() error {
		if o.capture.file != nil {
			return o.capture.file.Close()
		}
		return nil
	}, func() error {
		if o.admission.file != nil {
			return o.admission.file.Close()
		}
		return nil
	}} {
		if e := f(); e != nil && o.closeResult == nil {
			o.closeResult = e
		}
	}
	if o.first != nil && o.closeResult == nil {
		o.closeResult = ErrUnknown
	}
	return o.closeResult
}
