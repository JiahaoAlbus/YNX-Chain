package developerauthority

// Private, fixed normal Auth callee. This is NOT an exported Source13, a
// caller-selectable signer, or a callback adapter. The normal startup custodian
// must independently admit the immutable SDK/Node26/role configuration. The
// SDK's release-selected factory (not stdin) owns all protected key references.
import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const originalApprovalIssuerEntry = "scripts/original-publication-approval-issuer.mjs"
const originalApprovalQueryPath = "/v1/ide-publication-approval-current"

type originalApprovalIssuerOwner struct {
	mu                      sync.Mutex
	pins                    *OriginalSourceVerifierOwner
	store                   *originalApprovalStore
	closed, closeSelected   bool
	closeResult, firstCause error
	phase                   string
	lastQuery               *originalApprovalQueryDATA
	stdout, stderr          []byte // private bounded partial originals, never public error text
	exit                    int
}

func (*originalApprovalIssuerOwner) String() string {
	return "OriginalApprovalIssuerOwner{protected custody redacted}"
}

// Acquires the original complete-file pinner and actual borrowed durable store.
// No child/key access is performed on open. Partial owners must be retained by
// the original startup custodian, including when this returns owner+error.
func openOriginalApprovalIssuer(ctx context.Context, dbConfig originalApprovalStoreConfig, store *originalApprovalStore, config OriginalSourceVerifierConfig) (*originalApprovalIssuerOwner, error) {
	if ctx == nil || ctx.Err() != nil || store == nil || store.config != dbConfig {
		return nil, ErrDenied
	}
	seen := false
	for _, p := range config.SDKFiles {
		if p.Path == originalApprovalIssuerEntry {
			seen = true
		}
	}
	if !seen {
		return nil, ErrDenied
	}
	o := &originalApprovalIssuerOwner{store: store}
	p, e := OpenOriginalSourceVerifier(config)
	o.pins = p
	if e != nil {
		o.firstCause = e
		o.phase = "OPEN_PINS"
		return o, e
	}
	return o, nil
}

func approvalQueryCurrentOriginal(q *originalApprovalQueryDATA, now int64) ([]byte, error) {
	if q == nil || !q.row.valid(now) || now < q.observedMS {
		return nil, ErrDenied
	}
	w := q.row
	// Canonical outer JSON ordering. Scope and signed result originals are never
	// reconstructed. Counters remain decimal strings (no JS Number conversion).
	values := map[string]any{"actualApprovalRef": w.scope.ref, "confirmationRef": w.scope.confirmation, "decision": w.decision, "expiresAtMs": w.scope.expiresMS, "floor": strconv.FormatInt(w.floor, 10), "issuedAtMs": now, "kind": approvalScopeKind(w.scope.original), "nonce": q.nonce, "requestState": w.requestState, "resultOriginalSHA256": w.resultSHA256, "revocationRef": w.scope.revocation, "scopeSHA256": w.scope.digest, "sequence": strconv.FormatInt(w.sequence, 10), "version": "YNX-IDE-APPROVAL-CURRENT/v1"}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var out strings.Builder
	out.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			out.WriteByte(',')
		}
		name, _ := originalApprovalTransportString(k)
		out.WriteString(name)
		out.WriteByte(':')
		switch v := values[k].(type) {
		case string:
			s, ok := originalApprovalTransportString(v)
			if !ok {
				return nil, ErrDenied
			}
			out.WriteString(s)
		case int64:
			out.WriteString(strconv.FormatInt(v, 10))
		default:
			return nil, ErrDenied
		}
	}
	out.WriteByte('}')
	return []byte(out.String()), nil
}

func approvalScopeKind(raw []byte) string {
	var s struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return s.Kind
}

func (o *originalApprovalIssuerOwner) fail(phase string, cause error) error {
	if o.firstCause == nil {
		o.firstCause = cause
		o.phase = phase
	}
	return ErrUnknown
}

func (o *originalApprovalIssuerOwner) query(ctx context.Context, profile, ref, scopeSHA, nonce string) (*originalApprovalQueryDATA, error) {
	if o == nil || ctx == nil {
		return nil, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || o.firstCause != nil || o.pins == nil || profile != o.store.config.profileSHA256 || !approvalUUID.MatchString(ref) || !approvalHex.MatchString(scopeSHA) || !approvalNonce.MatchString(nonce) {
		return nil, ErrDenied
	}
	// Resolve stored original first. Public malformed/stale scope must not burn
	// an existing nonce or poison another tenant's issuer.
	w, e := o.store.observeOriginal(ctx, ref)
	if e != nil {
		return nil, ErrDenied
	}
	if w.scope.digest != scopeSHA || !w.valid(o.store.now().UnixMilli()) || (approvalScopeKind(w.scope.original) != "artifact" && approvalScopeKind(w.scope.original) != "resource") {
		return nil, ErrDenied
	}
	for i := range o.pins.files {
		if e = o.pins.files[i].check(); e != nil {
			return nil, o.fail("PRE_FILES", e)
		}
	}
	if e = o.pins.inventory(); e != nil {
		return nil, o.fail("PRE_INVENTORY", e)
	}
	q, e := o.store.reserveQuery(ctx, ref, nonce)
	o.lastQuery = q
	if e != nil {
		return q, e
	}
	current, e := approvalQueryCurrentOriginal(q, o.store.now().UnixMilli())
	if e != nil {
		return q, o.fail("CURRENT_BODY", e)
	}
	// Use the original JSON.stringify string escaping for the opaque scope, not
	// Go's HTML/U+2028 escaping. Exact signed bytes survive this outer transport.
	a, _ := originalApprovalTransportString(string(current))
	b, _ := originalApprovalTransportString(string(q.row.scope.original))
	input := []byte(`{"currentOriginal":` + a + `,"operation":"original-publication-approval-current/v1","profileDigest":"` + profile + `","scopeOriginal":` + b + `}`)
	if e = o.store.selectQuerySigning(ctx, q); e != nil {
		return q, e
	}
	bounded, cancel := context.WithTimeout(ctx, 7*time.Second)
	defer cancel()
	cmd := exec.CommandContext(bounded, o.pins.config.Node.Path, filepath.Join(o.pins.config.SDKRoot, originalApprovalIssuerEntry))
	cmd.Env = []string{}
	cmd.Dir = o.pins.config.SDKRoot
	cmd.Stdin = bytes.NewReader(input)
	cmd.WaitDelay = time.Second
	out := &originalVerifierCapture{limit: 1048576}
	errout := &originalVerifierCapture{limit: 4096, rejectAny: true}
	cmd.Stdout = out
	cmd.Stderr = errout
	e = cmd.Run()
	o.stdout = append([]byte(nil), out.raw...)
	o.stderr = append([]byte(nil), errout.raw...)
	o.exit = -1
	if cmd.ProcessState != nil {
		o.exit = cmd.ProcessState.ExitCode()
	}
	// Retain same-attempt signed partial BEFORE examining status/late fences.
	var version, status, result, code string
	var data, authorized bool
	parsed := bytes.HasSuffix(out.raw, []byte("\n")) && decodeExactObject(bytes.TrimSuffix(out.raw, []byte("\n")), 1048576, map[string]any{"version": &version, "status": &status, "resultOriginal": &result, "errorCode": &code, "dataOnly": &data, "authorized": &authorized}) == nil
	if parsed && len(result) > 0 && len(result) <= 393216 {
		q.envelopeOriginal = []byte(result)
		q.envelopeSHA256 = hash(q.envelopeOriginal)
	}
	if e != nil || bounded.Err() != nil || out.rejected || errout.rejected || !parsed || version != "YNX-AUTH-PUBLICATION-ISSUER-RESULT/v1" || status != "current" || !data || authorized || code != "" || len(result) == 0 {
		_ = o.store.failSelectedQuery(q, ErrUnknown)
		return q, o.fail("ISSUER_PROCESS_OR_PARTIAL", ErrUnknown)
	}
	// The concrete SDK factory verifies the Root-selected scope and role. Bind
	// the returned original to THIS reserved row and THIS nonce, never raw JSON.
	var wire map[string]json.RawMessage
	var gotScope, gotCurrent string
	if json.Unmarshal([]byte(result), &wire) != nil || json.Unmarshal(wire["scopeOriginal"], &gotScope) != nil || json.Unmarshal(wire["currentOriginal"], &gotCurrent) != nil || gotScope != string(q.row.scope.original) || gotCurrent != string(current) {
		_ = o.store.failSelectedQuery(q, ErrDenied)
		return q, o.fail("ISSUER_ORIGINAL_BINDING", ErrDenied)
	}
	for i := range o.pins.files {
		if e = o.pins.files[i].check(); e != nil {
			_ = o.store.failSelectedQuery(q, e)
			return q, o.fail("POST_FILES", e)
		}
	}
	if e = o.pins.inventory(); e != nil {
		_ = o.store.failSelectedQuery(q, e)
		return q, o.fail("POST_INVENTORY", e)
	}
	if e = o.store.completeQuery(ctx, q, []byte(result)); e != nil {
		return q, o.fail("DURABLE_COMPLETION", e)
	}
	return q, nil
}

// Fixed production HTTP route: no scope body, role, key path, provider or
// callback is accepted. Only immutable owner profile + stored original + nonce.
func (o *originalApprovalIssuerOwner) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	deny := func() {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(`{"error":"ORIGINAL_APPROVAL_UNAVAILABLE"}`))
	}
	if r == nil || r.Method != "GET" || r.URL.Path != originalApprovalQueryPath || r.URL.RawFragment != "" || r.ContentLength != 0 {
		deny()
		return
	}
	v, e := url.ParseQuery(r.URL.RawQuery)
	if e != nil || len(v) != 4 {
		deny()
		return
	}
	for _, k := range []string{"profile", "approvalRef", "scope", "nonce"} {
		if len(v[k]) != 1 {
			deny()
			return
		}
	}
	q, err := o.query(r.Context(), v.Get("profile"), v.Get("approvalRef"), v.Get("scope"), v.Get("nonce"))
	if err != nil {
		deny()
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closed || o.firstCause != nil {
		deny()
		return
	}
	if err = o.store.assertCompletedCurrent(r.Context(), q); err != nil {
		deny()
		return
	}
	w.WriteHeader(http.StatusOK)
	if _, err = w.Write(q.envelopeOriginal); err != nil {
		_ = o.fail("DELIVERY_WRITE_UNKNOWN", err)
	}
}

func (o *originalApprovalIssuerOwner) Close() error {
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
	if o.pins != nil {
		o.closeResult = o.pins.Close()
	}
	if o.firstCause != nil && o.closeResult == nil {
		o.closeResult = ErrUnknown
	}
	return o.closeResult
}
