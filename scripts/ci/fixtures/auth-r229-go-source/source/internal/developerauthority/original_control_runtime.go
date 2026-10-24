package developerauthority

// Concrete durable CONTROL portion of the Source factory. It composes the
// actual pinned current verifier, never accepts a provider callback or a
// caller-supplied registered key, and never replaces Catalog's ACL transaction.
// Full OriginalSource13 composition is separate; this owner is not that type.
import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"time"
)

type OriginalProjectControlRuntimeConfig struct {
	Verifier OriginalSourceVerifierConfig
	// OriginalSource is the release/Root-owned complete v2 source input, not
	// request JSON. The crypto process verifies its signed profile/current.
	OriginalSource     []byte
	WalletCodeIdentity string
}

func (OriginalProjectControlRuntimeConfig) String() string {
	return "OriginalProjectControlRuntimeConfig{original references redacted}"
}
func (c OriginalProjectControlRuntimeConfig) GoString() string { return c.String() }

type OriginalProjectControlRuntime struct {
	mu                 sync.Mutex
	db                 *sql.DB // borrowed, never closed
	verifier           *OriginalSourceVerifierOwner
	source             []byte
	caller, profile    string
	firstCause         error
	last               *originalControlCurrent
	closeSelected      bool
	closeResult        error
	now                func() time.Time // fixed production clock; private test seam
	lastSourceOriginal []byte           // retain actual original before a DB/late failure
}

func (*OriginalProjectControlRuntime) String() string {
	return "OriginalProjectControlRuntime{originals retained privately}"
}
func (o *OriginalProjectControlRuntime) GoString() string { return o.String() }

// The normal factory retains owner+error. No DDL, commissioning, private key
// access, new DB pool, endpoint override or signer creation occurs here.
func OpenOriginalProjectControlRuntime(ctx context.Context, db *sql.DB, c OriginalProjectControlRuntimeConfig) (*OriginalProjectControlRuntime, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || !text(c.WalletCodeIdentity) || len(c.OriginalSource) == 0 || len(c.OriginalSource) > originalVerifierInputLimit {
		return nil, ErrDenied
	}
	var fields map[string]json.RawMessage
	var profile string
	var policy struct {
		Signature struct {
			Purpose string `json:"purpose"`
		} `json:"signatureContract"`
	}
	if json.Unmarshal(c.OriginalSource, &fields) != nil || json.Unmarshal(fields["profileRaw"], &profile) != nil || profile == "" || json.Unmarshal(fields["policy"], &policy) != nil || policy.Signature.Purpose != "ide-project-control-authority-v1" {
		return nil, ErrDenied
	}
	o := &OriginalProjectControlRuntime{db: db, source: append([]byte(nil), c.OriginalSource...), caller: c.WalletCodeIdentity, profile: hash([]byte(profile)), now: time.Now}
	v, e := OpenOriginalSourceVerifier(c.Verifier)
	o.verifier = v
	if e != nil {
		o.firstCause = e
		return o, e
	}
	var revision int
	if e = db.QueryRowContext(ctx, `SELECT revision FROM public.auth_ide_control_capture_schema WHERE singleton=1`).Scan(&revision); e != nil || revision != 1 {
		o.firstCause = ErrUnknown
		return o, ErrUnknown
	}
	// Normal preflight actually verifies current. Source input must be the exact
	// operation, including node/previous/original signed buffers.
	if e = o.AssertSourceCurrent(ctx); e != nil {
		o.firstCause = e
		return o, e
	}
	return o, nil
}

func originalControlPrincipalDTO(p Principal) map[string]any {
	return map[string]any{"account": p.Account, "deviceId": p.DeviceID, "sessionRef": p.SessionRef, "currentRef": p.CurrentRef, "accountGeneration": strconv.FormatUint(p.AccountGeneration, 10), "sessionGeneration": strconv.FormatUint(p.SessionGeneration, 10), "expiresMS": strconv.FormatInt(p.ExpiresMS, 10)}
}
func originalControlCommandDTO(c Command) map[string]any {
	// Go original numeric tokens become decimal display strings, not float64.
	raw, _ := json.Marshal(c)
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	r := make(map[string]any, len(m))
	for k, v := range m {
		var s string
		var b bool
		switch k {
		case "ExpectedRevision", "GrantExpiresMS", "ExpiresMS":
			r[k] = string(v)
		case "Read", "Publish", "Runtime", "Revoke":
			_ = json.Unmarshal(v, &b)
			r[k] = b
		default:
			_ = json.Unmarshal(v, &s)
			r[k] = s
		}
	}
	return r
}
func (o *OriginalProjectControlRuntime) verify(ctx context.Context, p Principal, c Command, proof []byte) (*originalControlCurrent, error) {
	// The nonce is extracted only as a comparison candidate. It is not authority
	// until the fixed verifier authenticates the whole original decision + pair.
	var envelope struct {
		Decision string `json:"decisionOriginal"`
	}
	var decision struct {
		Nonce string `json:"nonce"`
	}
	if len(proof) > originalProjectControlApprovalLimit || json.Unmarshal(proof, &envelope) != nil || json.Unmarshal([]byte(envelope.Decision), &decision) != nil || !readNonceToken.MatchString(decision.Nonce) {
		return nil, ErrDenied
	}
	input, e := json.Marshal(map[string]any{"operation": "ide-project-control-current-native-node/v1", "source": json.RawMessage(o.source), "approvalOriginal": string(proof), "principal": originalControlPrincipalDTO(p), "command": originalControlCommandDTO(c), "expected": map[string]any{"nonce": decision.Nonce, "callerIdentity": o.caller, "sourceCurrentRef": p.CurrentRef}})
	if e != nil {
		return nil, ErrDenied
	}
	r, e := o.verifier.invokeOriginalControlCurrent(ctx, input, p, c, proof, decision.Nonce, o.caller)
	if r != nil {
		o.last = r
	}
	if e != nil {
		return r, e
	}
	if r.profile != o.profile {
		return r, ErrDenied
	}
	if e = o.observeCurrent(ctx, r); e != nil {
		return r, e
	}
	return r, nil
}

// Multi-instance current watermark, not a replacement Root. Only verified
// current outputs can reach this query. Equal sequence must keep the exact
// head; sequence/floor/generation may never roll back after a restart.
const originalControlSourceObserveSQL = `INSERT INTO public.auth_ide_control_source_heads
(source_id,instance_id,profile_sha256,generation,sequence,floor,capture_head)
VALUES($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT(source_id,instance_id) DO UPDATE SET
profile_sha256=EXCLUDED.profile_sha256,generation=EXCLUDED.generation,
sequence=EXCLUDED.sequence,floor=EXCLUDED.floor,capture_head=EXCLUDED.capture_head
WHERE auth_ide_control_source_heads.generation<=EXCLUDED.generation
AND auth_ide_control_source_heads.sequence<=EXCLUDED.sequence
AND auth_ide_control_source_heads.floor<=EXCLUDED.floor
AND (auth_ide_control_source_heads.generation<EXCLUDED.generation OR auth_ide_control_source_heads.profile_sha256=EXCLUDED.profile_sha256)
AND (auth_ide_control_source_heads.sequence<EXCLUDED.sequence OR auth_ide_control_source_heads.capture_head=EXCLUDED.capture_head)
RETURNING capture_head`

func (o *OriginalProjectControlRuntime) observeCurrent(ctx context.Context, r *originalControlCurrent) error {
	var head string
	e := o.db.QueryRowContext(ctx, originalControlSourceObserveSQL, r.sourceID, r.instanceID, r.profile, r.generation, r.sequence, r.floor, r.head).Scan(&head)
	if e == sql.ErrNoRows {
		return ErrDenied
	}
	if e != nil || head != r.head {
		o.firstCause = ErrUnknown
		return ErrUnknown
	}
	return nil
}

const originalControlCaptureInsertSQL = `INSERT INTO public.auth_ide_control_captures
(source_id,instance_id,profile_sha256,capture_head,principal_sha256,command_sha256,proof_sha256,confirmation_ref,revocation_ref,decision,expires_ms,principal_original,command_original,proof_original,verified_original)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT DO NOTHING RETURNING capture_head`

// AuthorizeProjectControl performs the real current verification and durable
// once selection. A transaction/CAS error is UNKNOWN and disables this owner;
// it is not retried, even if the actual insert may have committed remotely.
func (o *OriginalProjectControlRuntime) AuthorizeProjectControl(ctx context.Context, p Principal, c Command, proof []byte) (Approval, error) {
	if o == nil || ctx == nil {
		return Approval{}, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected || o.firstCause != nil || ctx.Err() != nil {
		return Approval{}, ErrUnknown
	}
	r, e := o.verify(ctx, p, c, append([]byte(nil), proof...))
	if e != nil {
		return Approval{}, e
	}
	praw, _ := json.Marshal(p)
	craw, _ := json.Marshal(c)
	var head string
	e = o.db.QueryRowContext(ctx, originalControlCaptureInsertSQL, r.sourceID, r.instanceID, r.profile, r.head, objectHash(p), objectHash(c), hash(proof), r.approval.ConfirmationRef, r.approval.RevocationRef, r.projection.Decision, r.approval.ExpiresMS, praw, craw, append([]byte(nil), proof...), r.original).Scan(&head)
	if e == sql.ErrNoRows {
		return Approval{}, ErrConflict
	}
	if e != nil || head != r.head {
		o.firstCause = ErrUnknown
		return Approval{}, ErrUnknown
	}
	// Signed rejection also consumes this capture; never turn it into approval.
	if !r.projection.Ready {
		return Approval{}, ErrDenied
	}
	// The durable insert is an asynchronous external boundary. Recheck the
	// SAME original after it; failure does not undo or retry a consumed capture.
	post, postErr := o.verify(ctx, p, c, proof)
	if postErr != nil || post.head != r.head || post.approval != r.approval || !post.projection.Ready {
		return Approval{}, ErrUnknown
	}
	if !validApproval(r.approval, p, c, proof, time.Now().UnixMilli()) {
		return Approval{}, ErrUnknown
	}
	return r.approval, nil
}

func (o *OriginalProjectControlRuntime) AssertSourceCurrent(ctx context.Context) error {
	if o == nil || ctx == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected || o.firstCause != nil || ctx.Err() != nil || o.now == nil {
		return ErrUnknown
	}
	before := o.now()
	raw, err := o.verifier.InvokeOriginalCurrentDATA(ctx, o.source)
	if err != nil {
		return err
	}
	p, err := controlSourceProjection(bytes.TrimSuffix(raw, []byte("\n")), before)
	if err != nil || p.Profile != o.profile {
		return ErrDenied
	}
	o.lastSourceOriginal = append([]byte(nil), raw...)
	if err = o.observeCurrent(ctx, &originalControlCurrent{sourceID: p.SourceID, instanceID: p.InstanceID, profile: p.Profile, generation: p.Generation, sequence: p.Sequence, floor: p.Floor, head: p.Head}); err != nil {
		return err
	}
	// The durable watermark may already be committed. A timeout/expiry here
	// cannot be treated as an unexecuted read or trigger another observation.
	after := o.now().UnixMilli()
	if ctx.Err() != nil || after < before.UnixMilli() || after < p.TimeFloor || after >= p.Expires {
		o.firstCause = errOriginalSourcePostWatermarkCurrent
		return ErrUnknown
	}
	return nil
}

var errOriginalSourcePostWatermarkCurrent = errors.New("original Source current expired or cancelled after durable watermark completion")

// Recheck reads the SAME durable original, obtains fresh nonce-bound Source
// current from the fixed transport and verifies the same original proof again.
// It never selects/consumes a second capture or resends a Catalog operation.
func (o *OriginalProjectControlRuntime) AssertControlCurrent(ctx context.Context, p Principal, a Approval) error {
	if o == nil || ctx == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected || o.firstCause != nil || ctx.Err() != nil {
		return ErrUnknown
	}
	var pr, cr, proof []byte
	var head, profile, decision string
	var expires int64
	e := o.db.QueryRowContext(ctx, `SELECT principal_original,command_original,proof_original,capture_head,profile_sha256,decision,expires_ms FROM public.auth_ide_control_captures WHERE confirmation_ref=$1 AND revocation_ref=$2 AND principal_sha256=$3 AND command_sha256=$4 AND proof_sha256=$5`, a.ConfirmationRef, a.RevocationRef, a.PrincipalSHA256, a.BindingSHA256, a.ProofSHA256).Scan(&pr, &cr, &proof, &head, &profile, &decision, &expires)
	if e != nil || decision != "approve" || profile != o.profile || expires != a.ExpiresMS {
		return ErrDenied
	}
	var stored Principal
	var cmd Command
	if json.Unmarshal(pr, &stored) != nil || stored != p || json.Unmarshal(cr, &cmd) != nil || !validApproval(a, p, cmd, proof, time.Now().UnixMilli()) {
		return ErrDenied
	}
	r, e := o.verify(ctx, p, cmd, proof)
	if e != nil {
		return e
	}
	if r.head != head || r.approval != a || !r.projection.Ready || !validApproval(a, p, cmd, proof, time.Now().UnixMilli()) {
		return ErrDenied
	}
	return nil
}

func (o *OriginalProjectControlRuntime) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected {
		return o.closeResult
	}
	o.closeSelected = true
	if o.verifier != nil {
		o.closeResult = o.verifier.Close()
	}
	if o.closeResult == nil && o.firstCause != nil {
		o.closeResult = ErrUnknown
	}
	return o.closeResult
}
