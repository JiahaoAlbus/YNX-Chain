package developerauthority

// Original protected issuer/query persistence, NOT a Source, signer, grant or
// Native capture factory. Only the genuine normal issuer may supply the already
// verified R187 scope/capture. No HTTP role, callback, mutable trust provider,
// DDL, replacement DB or process-only once state is installed here.
import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sync"
	"time"
)

var approvalHex = regexp.MustCompile(`^[a-f0-9]{64}$`)
var approvalUUID = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
var approvalNonce = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

type originalApprovalStoreConfig struct{ source, instance, profileSHA256 string }
type originalApprovalScopeDATA struct {
	original                              []byte
	digest, ref, confirmation, revocation string
	approvedMS, expiresMS                 int64
}
type originalApprovalRow struct {
	scope                     originalApprovalScopeDATA
	sequence, floor           int64
	decision, requestState    string
	resultOriginal            []byte
	resultSHA256, stateSHA256 string
	observedMS                int64
}
type originalApprovalQueryDATA struct {
	nonce                               string
	row                                 originalApprovalRow
	envelopeOriginal                    []byte
	envelopeSHA256, phase               string
	observedMS                          int64
	signingSelected, completionSelected bool
}
type originalApprovalStore struct {
	mu            sync.Mutex
	db            *sql.DB // borrowed actual protected normal Auth pool; never closed here
	config        originalApprovalStoreConfig
	now           func() time.Time
	ready, closed bool
	firstCause    error
	phase         string
	lastRow       *originalApprovalRow
	lastMutation  *originalApprovalMutationDATA
	lastQuery     *originalApprovalQueryDATA
	pending       map[*originalApprovalQueryDATA]bool // custody only; DB is durable once authority
	closeSelected bool
	closeResult   error
}
type originalApprovalMutationDATA struct {
	phase              string
	expected, returned originalApprovalRow
	cause              error
}

func (*originalApprovalMutationDATA) String() string {
	return "OriginalApprovalMutationDATA{originals and cause retained privately}"
}
func (m *originalApprovalMutationDATA) GoString() string { return m.String() }
func (*originalApprovalRow) String() string {
	return "OriginalApprovalRow{protected scope/result retained}"
}
func (w *originalApprovalRow) GoString() string { return w.String() }

func (*originalApprovalStore) String() string {
	return "OriginalApprovalStore{protected diagnostics redacted}"
}
func (o *originalApprovalStore) GoString() string { return o.String() }
func openOriginalApprovalStore(ctx context.Context, db *sql.DB, config originalApprovalStoreConfig) (*originalApprovalStore, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || !text(config.source) || !text(config.instance) || !approvalHex.MatchString(config.profileSHA256) {
		return nil, ErrDenied
	}
	o := &originalApprovalStore{db: db, config: config, now: time.Now, pending: make(map[*originalApprovalQueryDATA]bool)}
	var revision int
	if e := db.QueryRowContext(ctx, `SELECT revision FROM public.auth_ide_approval_schema WHERE singleton=1`).Scan(&revision); e != nil {
		return o, o.unknown("SCHEMA", e)
	}
	if revision != 1 {
		return o, o.unknown("SCHEMA", ErrDenied)
	}
	o.ready = true
	return o, nil
}
func (o *originalApprovalStore) unknown(phase string, e error) error {
	if o.firstCause == nil {
		o.firstCause = e
		o.phase = phase
	}
	o.ready = false
	return ErrUnknown
}
func (o *originalApprovalStore) check(ctx context.Context) error {
	if ctx == nil || ctx.Err() != nil || !o.ready || o.closed || o.firstCause != nil {
		return ErrUnknown
	}
	return nil
}
func (s originalApprovalScopeDATA) valid(now int64) bool {
	if len(s.original) < 1 || len(s.original) > 16384 || !approvalHex.MatchString(s.digest) || hash(s.original) != s.digest || !approvalUUID.MatchString(s.ref) || !text(s.confirmation) || !text(s.revocation) || s.approvedMS <= 0 || s.expiresMS <= s.approvedMS || s.expiresMS-s.approvedMS > 30000 || now < s.approvedMS || now >= s.expiresMS {
		return false
	}
	// Full R187 scope is validated by the actual Root/Native issuer upstream.
	// Preserve canonical opaque original bytes here, not a reconstructed DTO.
	var value map[string]json.RawMessage
	return json.Unmarshal(s.original, &value) == nil && len(value) > 0
}
func (w originalApprovalRow) digest() string {
	return objectHash(struct {
		Scope                                string
		Sequence, Floor                      int64
		Decision, RequestState, ResultSHA256 string
	}{w.scope.digest, w.sequence, w.floor, w.decision, w.requestState, w.resultSHA256})
}
func (w originalApprovalRow) valid(now int64) bool {
	if !w.scope.valid(now) || w.sequence < 1 || w.floor < 0 || w.floor > w.sequence || w.observedMS < w.scope.approvedMS || w.observedMS > now || w.stateSHA256 != w.digest() {
		return false
	}
	if len(w.resultOriginal) > 262144 || len(w.resultOriginal) == 0 && w.resultSHA256 != "" || len(w.resultOriginal) > 0 && hash(w.resultOriginal) != w.resultSHA256 {
		return false
	}
	if w.decision != "approved" && w.decision != "rejected" && w.decision != "revoked" && w.decision != "expired" && w.decision != "unknown" {
		return false
	}
	switch w.requestState {
	case "selected", "signed-unhanded", "returned", "rejected", "failed", "unknown":
	default:
		return false
	}
	if w.decision == "approved" && w.requestState != "selected" && w.requestState != "signed-unhanded" && w.requestState != "returned" && w.requestState != "failed" || w.decision == "unknown" && w.requestState != "unknown" || w.decision == "rejected" && w.requestState != "rejected" {
		return false
	}
	if (w.requestState == "signed-unhanded" || w.requestState == "returned") && len(w.resultOriginal) == 0 {
		return false
	}
	return true
}

const approvalColumns = `scope_original,scope_sha256,approval_ref,confirmation_ref,revocation_ref,approved_ms,expires_ms,sequence,floor,decision,request_state,result_original,result_sha256,state_sha256,observed_ms`
const approvalInsertSQL = `INSERT INTO public.auth_ide_publication_approvals
(source_id,instance_id,profile_sha256,` + approvalColumns + `)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,0,'approved','selected',$11,'',$12,$13)
ON CONFLICT(source_id,instance_id,approval_ref) DO NOTHING
RETURNING ` + approvalColumns
const approvalReadSQL = `SELECT ` + approvalColumns + ` FROM public.auth_ide_publication_approvals WHERE source_id=$1 AND instance_id=$2 AND profile_sha256=$3 AND approval_ref=$4`

// PostgreSQL executes UPDATE+history insertion as ONE atomic statement. A
// unique history/capture conflict rolls back the entire statement, not only a
// later external effect. No automatic retry after any DB uncertainty.
const approvalTransitionSQL = `WITH changed AS (
 UPDATE public.auth_ide_publication_approvals SET sequence=sequence+1,floor=$6,decision=$7,request_state=$8,result_original=$9,result_sha256=$10,state_sha256=$11,observed_ms=$12
 WHERE source_id=$1 AND instance_id=$2 AND profile_sha256=$3 AND approval_ref=$4 AND state_sha256=$5
 AND observed_ms<=$12 AND expires_ms>$12
 RETURNING *
), recorded AS (
 INSERT INTO public.auth_ide_publication_approval_history(source_id,instance_id,approval_ref,capture_sha256,previous_state_sha256,state_sha256,sequence,observed_ms)
 SELECT source_id,instance_id,approval_ref,$13,$5,state_sha256,sequence,observed_ms FROM changed RETURNING state_sha256
)
SELECT ` + `c.scope_original,c.scope_sha256,c.approval_ref,c.confirmation_ref,c.revocation_ref,c.approved_ms,c.expires_ms,c.sequence,c.floor,c.decision,c.request_state,c.result_original,c.result_sha256,c.state_sha256,c.observed_ms FROM changed c JOIN recorded h ON h.state_sha256=c.state_sha256`
const approvalReserveSQL = `WITH observed AS (
 UPDATE public.auth_ide_publication_approvals SET observed_ms=$6
 WHERE source_id=$1 AND instance_id=$2 AND profile_sha256=$3 AND approval_ref=$4
 AND observed_ms<=$6 AND expires_ms>$6
 RETURNING *
), consumed AS (
 INSERT INTO public.auth_ide_publication_approval_queries(source_id,instance_id,approval_ref,nonce,state_sha256,sequence,phase,observed_ms,expires_ms)
 SELECT source_id,instance_id,approval_ref,$5,state_sha256,sequence,'entered',$6,expires_ms FROM observed
 ON CONFLICT(source_id,instance_id,approval_ref,nonce) DO NOTHING RETURNING state_sha256
)
SELECT o.scope_original,o.scope_sha256,o.approval_ref,o.confirmation_ref,o.revocation_ref,o.approved_ms,o.expires_ms,o.sequence,o.floor,o.decision,o.request_state,o.result_original,o.result_sha256,o.state_sha256,o.observed_ms FROM observed o JOIN consumed q ON q.state_sha256=o.state_sha256`
const approvalCompleteQuerySQL = `UPDATE public.auth_ide_publication_approval_queries q
SET phase='terminal',envelope_original=$7,envelope_sha256=$8
WHERE q.source_id=$1 AND q.instance_id=$2 AND q.approval_ref=$3 AND q.nonce=$4 AND q.state_sha256=$5 AND q.phase='entered' AND q.expires_ms>$6
AND EXISTS(SELECT 1 FROM public.auth_ide_publication_approvals a WHERE a.source_id=q.source_id AND a.instance_id=q.instance_id AND a.approval_ref=q.approval_ref AND a.state_sha256=q.state_sha256 AND a.observed_ms<=$6)
RETURNING q.envelope_original,q.envelope_sha256,q.phase`
const approvalObserveQuerySQL = `SELECT q.state_sha256,q.sequence,q.phase,q.observed_ms,COALESCE(q.envelope_original,''::bytea),COALESCE(q.envelope_sha256,'')
FROM public.auth_ide_publication_approval_queries q
JOIN public.auth_ide_publication_approvals a ON a.source_id=q.source_id AND a.instance_id=q.instance_id AND a.approval_ref=q.approval_ref
WHERE q.source_id=$1 AND q.instance_id=$2 AND a.profile_sha256=$3 AND q.approval_ref=$4 AND q.nonce=$5`

func scanApproval(row *sql.Row, w *originalApprovalRow) error {
	return row.Scan(&w.scope.original, &w.scope.digest, &w.scope.ref, &w.scope.confirmation, &w.scope.revocation, &w.scope.approvedMS, &w.scope.expiresMS, &w.sequence, &w.floor, &w.decision, &w.requestState, &w.resultOriginal, &w.resultSHA256, &w.stateSHA256, &w.observedMS)
}
func (o *originalApprovalStore) captureRow(w originalApprovalRow) {
	w.scope.original = append([]byte(nil), w.scope.original...)
	w.resultOriginal = append([]byte(nil), w.resultOriginal...)
	o.lastRow = &w
}
func (o *originalApprovalStore) prepare(ctx context.Context, s originalApprovalScopeDATA) (*originalApprovalRow, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return nil, e
	}
	now := o.now().UnixMilli()
	s.original = append([]byte(nil), s.original...)
	if !s.valid(now) {
		return nil, ErrDenied
	}
	expected := originalApprovalRow{scope: s, sequence: 1, decision: "approved", requestState: "selected", observedMS: now}
	expected.stateSHA256 = expected.digest()
	o.lastMutation = &originalApprovalMutationDATA{phase: "PREPARE_SELECTED", expected: expected}
	var w originalApprovalRow
	e := scanApproval(o.db.QueryRowContext(ctx, approvalInsertSQL, o.config.source, o.config.instance, o.config.profileSHA256, s.original, s.digest, s.ref, s.confirmation, s.revocation, s.approvedMS, s.expiresMS, []byte{}, expected.stateSHA256, now), &w)
	o.lastMutation.returned = w
	o.lastMutation.cause = e
	if errors.Is(e, sql.ErrNoRows) {
		return nil, ErrConflict
	}
	if e != nil {
		return nil, o.unknown("PREPARE_RESULT_UNKNOWN", e)
	}
	o.captureRow(w)
	if !w.valid(o.now().UnixMilli()) || w.stateSHA256 != expected.stateSHA256 || !bytes.Equal(w.scope.original, s.original) || ctx.Err() != nil {
		return nil, o.unknown("PREPARE_POST_CURRENT", ErrDenied)
	}
	return o.lastRow, nil
}
func terminalState(s string) bool { return s == "rejected" || s == "failed" || s == "unknown" }
func transitionAllowed(old originalApprovalRow, next originalApprovalRow) bool {
	if old.decision != "approved" && next.decision != old.decision || terminalState(old.requestState) && next.requestState != old.requestState {
		return false
	}
	if old.requestState == "returned" && next.requestState != "returned" || old.requestState == "signed-unhanded" && next.requestState != "signed-unhanded" && next.requestState != "returned" && next.requestState != "unknown" {
		return false
	}
	if len(old.resultOriginal) > 0 && !bytes.Equal(old.resultOriginal, next.resultOriginal) {
		return false
	}
	return true
}
func (o *originalApprovalStore) transition(ctx context.Context, ref, captureDigest, expectedState, decision, state string, floor int64, result []byte) (*originalApprovalRow, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return nil, e
	}
	if !approvalUUID.MatchString(ref) || !approvalHex.MatchString(captureDigest) || !approvalHex.MatchString(expectedState) {
		return nil, ErrDenied
	}
	var old originalApprovalRow
	if e := scanApproval(o.db.QueryRowContext(ctx, approvalReadSQL, o.config.source, o.config.instance, o.config.profileSHA256, ref), &old); e != nil {
		if errors.Is(e, sql.ErrNoRows) {
			return nil, ErrDenied
		}
		return nil, o.unknown("TRANSITION_READ", e)
	}
	now := o.now().UnixMilli()
	if !old.valid(now) || old.stateSHA256 != expectedState {
		return nil, ErrConflict
	}
	next := old
	next.sequence++
	next.floor = floor
	next.decision = decision
	next.requestState = state
	next.resultOriginal = append([]byte(nil), result...)
	next.resultSHA256 = ""
	if len(result) > 0 {
		next.resultSHA256 = hash(result)
	}
	next.observedMS = now
	next.stateSHA256 = next.digest()
	if next.floor < old.floor || !next.valid(now) || !transitionAllowed(old, next) {
		return nil, ErrDenied
	}
	var w originalApprovalRow
	o.lastMutation = &originalApprovalMutationDATA{phase: "TRANSITION_SELECTED", expected: next}
	e := scanApproval(o.db.QueryRowContext(ctx, approvalTransitionSQL, o.config.source, o.config.instance, o.config.profileSHA256, ref, expectedState, floor, decision, state, next.resultOriginal, next.resultSHA256, next.stateSHA256, now, captureDigest), &w)
	o.lastMutation.returned = w
	o.lastMutation.cause = e
	if errors.Is(e, sql.ErrNoRows) {
		return nil, ErrConflict
	}
	if e != nil {
		return nil, o.unknown("TRANSITION_APPLIED_UNKNOWN", e)
	}
	o.captureRow(w)
	if !w.valid(o.now().UnixMilli()) || w.stateSHA256 != next.stateSHA256 || ctx.Err() != nil {
		return nil, o.unknown("TRANSITION_POST_CURRENT", ErrDenied)
	}
	return o.lastRow, nil
}
func (o *originalApprovalStore) reserveQuery(ctx context.Context, ref, nonce string) (*originalApprovalQueryDATA, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return nil, e
	}
	decoded, decodeError := base64.RawURLEncoding.DecodeString(nonce)
	if !approvalUUID.MatchString(ref) || !approvalNonce.MatchString(nonce) || decodeError != nil || len(decoded) != 32 || base64.RawURLEncoding.EncodeToString(decoded) != nonce || bytes.Equal(decoded, make([]byte, 32)) {
		return nil, ErrDenied
	}
	now := o.now().UnixMilli()
	q := &originalApprovalQueryDATA{nonce: nonce, phase: "entered", observedMS: now}
	o.lastQuery = q
	o.pending[q] = true // retained before any returned partial/error
	e := scanApproval(o.db.QueryRowContext(ctx, approvalReserveSQL, o.config.source, o.config.instance, o.config.profileSHA256, ref, nonce, now), &q.row)
	if errors.Is(e, sql.ErrNoRows) {
		delete(o.pending, q)
		return nil, ErrConflict
	}
	if e != nil {
		return q, o.unknown("QUERY_CONSUMED_UNKNOWN", e)
	}
	o.captureRow(q.row)
	if !q.row.valid(o.now().UnixMilli()) || ctx.Err() != nil {
		return q, o.unknown("QUERY_POST_CURRENT", ErrDenied)
	}
	return q, nil
}

// Normal issuer calls this BEFORE its original protected role signs. It is
// not a signing capability; it is a one-selection fence on THIS persisted
// query handle. Restart/another instance cannot recreate it for this nonce.
func (o *originalApprovalStore) selectQuerySigning(ctx context.Context, q *originalApprovalQueryDATA) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if e := o.check(ctx); e != nil {
		return e
	}
	if q == nil || !o.pending[q] || q.phase != "entered" || q.signingSelected {
		return ErrConflict
	}
	if !q.row.valid(o.now().UnixMilli()) {
		return o.unknown("QUERY_PRE_SIGN_CURRENT", ErrDenied)
	}
	q.signingSelected = true
	return nil
}
func (o *originalApprovalStore) failSelectedQuery(q *originalApprovalQueryDATA, cause error) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if q == nil || !o.pending[q] || !q.signingSelected {
		return ErrDenied
	}
	if cause == nil {
		cause = ErrUnknown
	}
	return o.unknown("QUERY_SIGN_OR_POST_CURRENT_UNKNOWN", cause)
}
func (o *originalApprovalStore) completeQuery(ctx context.Context, q *originalApprovalQueryDATA, original []byte) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	if q == nil || !o.pending[q] || !q.signingSelected || q.completionSelected || q.phase != "entered" || len(original) == 0 || len(original) > 393216 {
		return ErrDenied
	}
	q.completionSelected = true
	// Preserve the actual signed/public original before DB status and post-time.
	q.envelopeOriginal = append([]byte(nil), original...)
	q.envelopeSHA256 = hash(original)
	if e := o.check(ctx); e != nil {
		if ctx != nil && ctx.Err() != nil {
			e = ctx.Err()
		}
		return o.unknown("QUERY_COMPLETION_CONTEXT", e)
	}
	now := o.now().UnixMilli()
	var got []byte
	var digest, phase string
	e := o.db.QueryRowContext(ctx, approvalCompleteQuerySQL, o.config.source, o.config.instance, q.row.scope.ref, q.nonce, q.row.stateSHA256, now, q.envelopeOriginal, q.envelopeSHA256).Scan(&got, &digest, &phase)
	if e != nil {
		return o.unknown("QUERY_COMPLETION_UNKNOWN", e)
	}
	q.phase = phase
	if phase != "terminal" || digest != q.envelopeSHA256 || !bytes.Equal(got, q.envelopeOriginal) || !q.row.valid(o.now().UnixMilli()) || ctx.Err() != nil {
		return o.unknown("QUERY_COMPLETION_POST_CURRENT", ErrDenied)
	}
	// Completion is not a current-state proof. A concurrent custodian may have
	// revoked/advanced the approval while the terminal row was being returned.
	// Re-read the actual durable row, not the process-local reserved snapshot.
	if e := o.assertCompletedCurrentLocked(ctx, q); e != nil {
		return e
	}
	delete(o.pending, q)
	return nil
}

func (o *originalApprovalStore) assertCompletedCurrentLocked(ctx context.Context, q *originalApprovalQueryDATA) error {
	if e := o.check(ctx); e != nil || q == nil || q.phase != "terminal" || !q.completionSelected || len(q.envelopeOriginal) == 0 {
		return o.unknown("QUERY_DELIVERY_CONTEXT", ErrDenied)
	}
	var live originalApprovalRow
	if e := scanApproval(o.db.QueryRowContext(ctx, approvalReadSQL, o.config.source, o.config.instance, o.config.profileSHA256, q.row.scope.ref), &live); e != nil {
		return o.unknown("QUERY_DELIVERY_READ", e)
	}
	o.captureRow(live)
	now := o.now().UnixMilli()
	if ctx.Err() != nil || !live.valid(now) || !q.row.valid(now) || live.stateSHA256 != q.row.stateSHA256 || !bytes.Equal(live.scope.original, q.row.scope.original) || live.observedMS < q.observedMS || hash(q.envelopeOriginal) != q.envelopeSHA256 {
		return o.unknown("QUERY_DELIVERY_POST_CURRENT", ErrDenied)
	}
	return nil
}

// The fixed HTTP owner invokes this again immediately before handing bytes to
// the original response writer. A historical terminal query never re-arms a
// nonce or becomes a reusable permission. Failures keep the exact original.
func (o *originalApprovalStore) assertCompletedCurrent(ctx context.Context, q *originalApprovalQueryDATA) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.assertCompletedCurrentLocked(ctx, q)
}

// Explicit observe-original reconciliation only. It never clears UNKNOWN,
// changes a nonce/state, returns a signing handle or promotes history to live
// current. A genuine normal Source must separately revalidate all authority.
func (o *originalApprovalStore) observeOriginal(ctx context.Context, ref string) (*originalApprovalRow, error) {
	if o == nil || ctx == nil || ctx.Err() != nil || !approvalUUID.MatchString(ref) {
		return nil, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	var w originalApprovalRow
	if e := scanApproval(o.db.QueryRowContext(ctx, approvalReadSQL, o.config.source, o.config.instance, o.config.profileSHA256, ref), &w); e != nil {
		return nil, e
	}
	o.captureRow(w)
	return o.lastRow, nil
}
func (o *originalApprovalStore) observeOriginalQuery(ctx context.Context, ref, nonce string) (*originalApprovalQueryDATA, error) {
	if o == nil || ctx == nil || ctx.Err() != nil || !approvalUUID.MatchString(ref) || !approvalNonce.MatchString(nonce) {
		return nil, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	q := &originalApprovalQueryDATA{nonce: nonce}
	e := o.db.QueryRowContext(ctx, approvalObserveQuerySQL, o.config.source, o.config.instance, o.config.profileSHA256, ref, nonce).Scan(&q.row.stateSHA256, &q.row.sequence, &q.phase, &q.observedMS, &q.envelopeOriginal, &q.envelopeSHA256)
	if e != nil {
		return nil, e
	}
	if !approvalHex.MatchString(q.row.stateSHA256) || q.row.sequence < 1 || (q.phase != "entered" && q.phase != "terminal") || q.phase == "terminal" && len(q.envelopeOriginal) == 0 || len(q.envelopeOriginal) > 393216 || len(q.envelopeOriginal) == 0 && q.envelopeSHA256 != "" || len(q.envelopeOriginal) > 0 && hash(q.envelopeOriginal) != q.envelopeSHA256 {
		return q, ErrUnknown
	}
	// Never insert an observed row into pending or create a signable handle.
	// No UNKNOWN/first-close state is cleared by this data-only reconciliation.
	return q, nil
}
func (o *originalApprovalStore) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected {
		return o.closeResult
	}
	o.closeSelected = true
	o.closed = true
	o.ready = false
	for q := range o.pending {
		if q.signingSelected && q.phase != "terminal" {
			o.closeResult = ErrUnknown
			break
		}
	}
	return o.closeResult
}
func (q *originalApprovalQueryDATA) String() string {
	return "OriginalApprovalQueryDATA{protected original retained}"
}
func (q *originalApprovalQueryDATA) GoString() string { return q.String() }

var _ fmt.Stringer = (*originalApprovalStore)(nil)
