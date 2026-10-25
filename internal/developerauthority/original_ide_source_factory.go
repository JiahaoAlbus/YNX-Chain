package developerauthority

// Concrete normal Auth supplier. Configuration is a protected, independently
// release-admitted startup file, never HTTP/ENV/decoded signature authority.
// Original SDK mathematics + PSv2 + exact Root captures + durable watermarks
// are required together; a Source-current DATA projection alone grants nothing.
import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"
)

type OriginalIDEPublicationSourceConfig struct {
	Release  OriginalVerifierFile
	Verifier OriginalSourceVerifierConfig
}

func (OriginalIDEPublicationSourceConfig) String() string {
	return "OriginalIDEPublicationSourceConfig{release references redacted}"
}
func (c OriginalIDEPublicationSourceConfig) GoString() string { return c.String() }

type originalIDETemplate struct {
	SourceID   string          `json:"sourceId"`
	InstanceID string          `json:"instanceId"`
	Policy     json.RawMessage `json:"policy"`
	Node       json.RawMessage `json:"node"`
}
type originalIDERelease struct {
	Version        string                         `json:"version"`
	SourceID       string                         `json:"sourceId"`
	InstanceID     string                         `json:"instanceId"`
	CallerIdentity string                         `json:"callerIdentity"`
	PrincipalSPKI  string                         `json:"principalSPKI"`
	CatalogBinding string                         `json:"catalogBinding"`
	Templates      map[string]originalIDETemplate `json:"templates"`
}
type originalIDESourceInput struct {
	Root       string          `json:"rootRaw"`
	Enrollment string          `json:"enrollmentRaw"`
	Profile    string          `json:"profileRaw"`
	Head       string          `json:"headRaw"`
	Attachment json.RawMessage `json:"attachment"`
}
type originalIDESourceRecord struct {
	kind, subject, binding, digest, profile, previousSHA string
	original                                             []byte
	input                                                originalIDESourceInput
	previous                                             json.RawMessage
	current                                              []byte
	projection                                           originalIDEProjection
}
type originalIDEProjection struct {
	Selection         json.RawMessage `json:"selection"`
	PrincipalID       string          `json:"principalId"`
	SubjectOwner      string          `json:"subjectOwner"`
	SubjectKeyVersion string          `json:"subjectKeyVersion"`
	Generation        uint64          `json:"generation"`
	Sequence          uint64          `json:"sequence"`
	Floor             uint64          `json:"floor"`
	Head              string          `json:"head"`
	Status            string          `json:"status"`
	TimeFloor         int64           `json:"timeFloor"`
	Expires           int64           `json:"expiresAtMs"`
	Profile           string          `json:"profileDigest"`
	SourceID          string          `json:"sourceId"`
	InstanceID        string          `json:"instanceId"`
	Height            string          `json:"executionHeight"`
	DataOnly          bool            `json:"dataOnly"`
	NativeAdmission   bool            `json:"nativeAdmission"`
}
type OriginalIDEPublicationSourceOwner struct {
	mu                 sync.Mutex
	db                 *sql.DB // borrowed existing normal Auth pool; never closed here
	release            verifierHeldFile
	config             originalIDERelease
	principal          *OriginalDeveloperHTTPAuthority
	verifier           *OriginalSourceVerifierOwner
	first, closeResult error
	closeSelected      bool
	last               *originalIDESourceRecord // retains actual partial before status checks
}

func (*OriginalIDEPublicationSourceOwner) String() string {
	return "OriginalIDEPublicationSourceOwner{original custody redacted}"
}
func (o *OriginalIDEPublicationSourceOwner) GoString() string { return o.String() }

var _ OriginalSource = (*OriginalIDEPublicationSourceOwner)(nil)
var _ OriginalPublicationSource = (*OriginalIDEPublicationSourceOwner)(nil)
var _ OriginalPublicationSelector = (*OriginalIDEPublicationSourceOwner)(nil)

// No startup DDL, key acquisition, implicit approval, root registration or
// alternate pool. Retain nonnil owner on error and Close it independently.
func OpenOriginalIDEPublicationSource(ctx context.Context, db *sql.DB, c OriginalIDEPublicationSourceConfig) (*OriginalIDEPublicationSourceOwner, error) {
	if ctx == nil || ctx.Err() != nil || db == nil {
		return nil, ErrDenied
	}
	o := &OriginalIDEPublicationSourceOwner{db: db}
	var e error
	o.release, e = verifierOpen(c.Release)
	if e != nil {
		o.first = e
		return o, e
	}
	raw, e := io.ReadAll(io.NewSectionReader(o.release.file, 0, c.Release.Bytes+1))
	if e != nil {
		o.first = e
		return o, e
	}
	o.config, e = originalIDEParseRelease(raw)
	if e != nil {
		o.first = e
		return o, e
	}
	var revision int
	if e = db.QueryRowContext(ctx, "SELECT revision FROM public.auth_ide_original_source_schema WHERE singleton=1").Scan(&revision); e != nil || revision != 1 {
		o.first = ErrUnknown
		return o, ErrUnknown
	}
	o.verifier, e = OpenOriginalSourceVerifier(c.Verifier)
	if e != nil {
		o.first = e
		return o, e
	}
	o.principal, e = OpenOriginalDeveloperHTTPAuthority(OriginalDeveloperHTTPAuthorityConfig{o.config.PrincipalSPKI})
	if e != nil {
		o.first = e
		return o, e
	}
	if e = o.assertSourceLocked(ctx); e != nil {
		o.first = e
		return o, e
	}
	return o, nil
}
func (o *OriginalIDEPublicationSourceOwner) check(ctx context.Context) error {
	if o == nil || ctx == nil || ctx.Err() != nil || o.closeSelected || o.first != nil || o.db == nil || o.verifier == nil || o.principal == nil {
		return ErrDenied
	}
	if e := o.release.check(); e != nil {
		o.first = e
		return ErrUnknown
	}
	return nil
}
func (o *OriginalIDEPublicationSourceOwner) fail(e error) error {
	if o.first == nil {
		o.first = e
	}
	return ErrUnknown
}

const originalIDESourceRead = `SELECT original,sha256 FROM public.auth_ide_original_source_records WHERE source_id=$1 AND instance_id=$2 AND kind=$3 AND subject=$4 AND binding=$5`
const originalIDEHeadRead = `SELECT previous_original,sha256 FROM public.auth_ide_original_source_heads WHERE source_id=$1 AND instance_id=$2 AND profile_sha256=$3`
const originalIDEHeadCAS = `WITH changed AS (
 UPDATE public.auth_ide_original_source_heads SET previous_original=$5,sha256=$6 WHERE source_id=$1 AND instance_id=$2 AND profile_sha256=$3 AND sha256=$4 RETURNING *
), observed AS (
 INSERT INTO public.auth_ide_original_source_observations(source_id,instance_id,kind,reference,original,sha256)
 SELECT source_id,instance_id,'source',profile_sha256,$7,$8 FROM changed RETURNING sha256
) SELECT c.previous_original,c.sha256 FROM changed c JOIN observed o ON o.sha256=$8`

func (o *OriginalIDEPublicationSourceOwner) record(ctx context.Context, kind, subject, binding string) (*originalIDESourceRecord, error) {
	if e := o.check(ctx); e != nil {
		return nil, e
	}
	if _, ok := o.config.Templates[kind]; !ok {
		return nil, ErrDenied
	}
	r := &originalIDESourceRecord{kind: kind, subject: subject, binding: binding}
	o.last = r
	if e := o.db.QueryRowContext(ctx, originalIDESourceRead, o.config.SourceID, o.config.InstanceID, kind, subject, binding).Scan(&r.original, &r.digest); e != nil {
		return r, ErrDenied
	}
	if len(r.original) == 0 || len(r.original) > 1572864 || hash(r.original) != r.digest || decodeExactObject(r.original, 1572864, map[string]any{"rootRaw": &r.input.Root, "enrollmentRaw": &r.input.Enrollment, "profileRaw": &r.input.Profile, "headRaw": &r.input.Head, "attachment": &r.input.Attachment}) != nil {
		return r, ErrDenied
	}
	r.profile = hash([]byte(r.input.Profile))
	if e := o.db.QueryRowContext(ctx, originalIDEHeadRead, o.config.SourceID, o.config.InstanceID, r.profile).Scan(&r.previous, &r.previousSHA); e != nil {
		return r, ErrDenied
	}
	if len(r.previous) == 0 || len(r.previous) > 16384 || hash(r.previous) != r.previousSHA {
		return r, ErrDenied
	}
	return r, nil
}
func (o *OriginalIDEPublicationSourceOwner) sourceInput(r *originalIDESourceRecord) map[string]any {
	t := o.config.Templates[r.kind]
	return map[string]any{"operation": "auth-source-v2-native-node/v1", "node": t.Node, "policy": t.Policy, "rootRaw": r.input.Root, "enrollmentRaw": r.input.Enrollment, "profileRaw": r.input.Profile, "headRaw": r.input.Head, "previous": r.previous}
}
func (o *OriginalIDEPublicationSourceOwner) current(ctx context.Context, r *originalIDESourceRecord) error {
	started := time.Now()
	raw, e := originalIDEJSON(o.sourceInput(r))
	if e != nil {
		return e
	}
	out, e := o.verifier.InvokeOriginalCurrentDATA(ctx, raw)
	r.current = bytes.Clone(out)
	if e != nil {
		return e
	}
	var p json.RawMessage
	var signed string
	if decodeExactObject(bytes.TrimSuffix(out, []byte("\n")), originalVerifierOutputLimit, map[string]any{"projection": &p, "currentRaw": &signed}) != nil || json.Unmarshal(p, &r.projection) != nil {
		return ErrUnknown
	}
	t := o.config.Templates[r.kind]
	v := r.projection
	if v.Profile != r.profile || v.SourceID != t.SourceID || v.InstanceID != t.InstanceID || v.Status != "active" || !v.DataOnly || v.NativeAdmission || time.Now().UnixMilli() < v.TimeFloor || time.Now().UnixMilli() >= v.Expires {
		return ErrDenied
	}
	// The pre-existing durable baseline is mandatory. Never invent zero/floors.
	next, e := originalIDEJSON(map[string]any{"sequence": v.Sequence, "floor": v.Floor, "head": v.Head, "timeFloor": v.TimeFloor, "executionHeight": v.Height})
	if e != nil {
		return e
	}
	var observed []byte
	var digest string
	if e = o.db.QueryRowContext(ctx, originalIDEHeadCAS, o.config.SourceID, o.config.InstanceID, r.profile, r.previousSHA, next, hash(next), out, hash(out)).Scan(&observed, &digest); e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return ErrConflict
		}
		return o.fail(e)
	}
	if !bytes.Equal(observed, next) || digest != hash(next) || ctx.Err() != nil {
		return o.fail(ErrUnknown)
	}
	var currentRaw []byte
	var currentHash string
	if e = o.db.QueryRowContext(ctx, originalIDESourceRead, o.config.SourceID, o.config.InstanceID, r.kind, r.subject, r.binding).Scan(&currentRaw, &currentHash); e != nil || !bytes.Equal(currentRaw, r.original) || currentHash != r.digest {
		return ErrDenied
	}
	r.previous = bytes.Clone(next)
	r.previousSHA = digest
	if e = o.check(ctx); e != nil {
		return e
	}
	now := time.Now().UnixMilli()
	if now < v.TimeFloor || now >= v.Expires || v.Expires <= started.UnixMilli() || time.Since(started) >= time.Duration(v.Expires-started.UnixMilli())*time.Millisecond {
		return ErrDenied
	}
	return nil
}
func (o *OriginalIDEPublicationSourceOwner) assertSourceLocked(ctx context.Context) error {
	r, e := o.record(ctx, "catalog", "", o.config.CatalogBinding)
	if e != nil {
		return e
	}
	return o.current(ctx, r)
}
func (o *OriginalIDEPublicationSourceOwner) AssertSourceCurrent(ctx context.Context) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.assertSourceLocked(ctx)
}
func (o *OriginalIDEPublicationSourceOwner) CurrentExistingPrincipal(ctx context.Context, r *http.Request) (Principal, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return Principal{}, e
	}
	// Catalog calls Principal/CurrentProject/CurrentPublisher on the SAME HTTP
	// original. Reborrow its already verified original owner, never authenticate
	// or consume the PSv2 proof twice. UNKNOWN/selected is never retried.
	in, e := captureOriginalHTTPRequest(r)
	if e != nil {
		return Principal{}, e
	}
	o.principal.mu.Lock()
	held := o.principal.records[objectHash(in)]
	var p Principal
	var phase string
	if held != nil {
		p = held.principal
		phase = held.phase
	}
	o.principal.mu.Unlock()
	if held != nil {
		if phase != "verified" {
			return Principal{}, ErrUnknown
		}
		if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
			return Principal{}, e
		}
		return p, nil
	}
	return o.principal.CurrentExistingPrincipal(ctx, r)
}
func (o *OriginalIDEPublicationSourceOwner) AssertPrincipalCurrent(ctx context.Context, p Principal) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return e
	}
	return o.principal.AssertPrincipalCurrent(ctx, p)
}
func (o *OriginalIDEPublicationSourceOwner) AssertCatalogAuthorityCurrent(ctx context.Context, p Principal) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return e
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return e
	}
	return o.assertSourceLocked(ctx)
}
func (o *OriginalIDEPublicationSourceOwner) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected {
		return o.closeResult
	}
	o.closeSelected = true
	for _, f := range []func() error{func() error {
		if o.principal != nil {
			return o.principal.Close()
		}
		return nil
	}, func() error {
		if o.verifier != nil {
			return o.verifier.Close()
		}
		return nil
	}, func() error {
		if o.release.file != nil {
			return o.release.file.Close()
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
