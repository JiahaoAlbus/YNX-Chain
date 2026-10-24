package developerauthority

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

// Private factory custody, never a renderer-supplied verified/captured DTO.
// Entries are installed BEFORE any external work. Failures and actual partials
// remain attached to the same command; no new nonce, observation or SQL retry.
type originalFactoryPublisher struct {
	store                   *originalPublisherCaptureStore
	projectSource           []byte
	projectProfile          string
	pending                 map[string]*originalFactoryPublisherPending
	operations              []*originalPublisherCatalogOperation
	lastProjectOriginal     []byte
	projectOriginals        [][]byte
	firstCause, closeResult error
	closed                  bool
}
type originalFactoryPublisherPending struct {
	principal           Principal
	command             Command
	public, proof       []byte
	observation         *originalPublisherCurrent
	currentObservations []*originalPublisherCurrent
	attempt             *originalPublisherCaptureAttempt
	selected            bool
	result              error
}

func (*originalFactoryPublisher) String() string {
	return "originalFactoryPublisher{original custody/UNKNOWN retained privately}"
}
func (v *originalFactoryPublisher) GoString() string { return v.String() }
func (*originalFactoryPublisherPending) String() string {
	return "originalFactoryPublisherPending{originals/partials redacted}"
}
func (v *originalFactoryPublisherPending) GoString() string { return v.String() }

func openOriginalFactoryPublisher(ctx context.Context, db *sql.DB, control *OriginalProjectControlRuntime, source []byte) (*originalFactoryPublisher, error) {
	if ctx == nil || ctx.Err() != nil || db == nil || control == nil || control.db != db || len(source) == 0 || len(source) > originalVerifierInputLimit {
		return nil, ErrDenied
	}
	var fields map[string]json.RawMessage
	var profile string
	var policy struct {
		Signature struct {
			Purpose string `json:"purpose"`
		} `json:"signatureContract"`
	}
	if json.Unmarshal(source, &fields) != nil || json.Unmarshal(fields["profileRaw"], &profile) != nil || profile == "" || json.Unmarshal(fields["policy"], &policy) != nil || policy.Signature.Purpose != "ide-project-authority-v1" {
		return nil, ErrDenied
	}
	o := &originalFactoryPublisher{projectSource: append([]byte(nil), source...), projectProfile: hash([]byte(profile)), pending: map[string]*originalFactoryPublisherPending{}}
	s, e := openOriginalPublisherCaptureStore(ctx, db)
	o.store = s
	if e != nil {
		o.firstCause = e
		return o, e
	}
	var revision int
	if e = db.QueryRowContext(ctx, `SELECT revision FROM public.auth_ide_publisher_catalog_schema WHERE singleton=1`).Scan(&revision); e != nil || revision != 1 {
		o.firstCause = ErrUnknown
		return o, ErrUnknown
	}
	return o, nil
}
func (v *originalFactoryPublisher) close() error {
	if v == nil {
		return nil
	}
	if v.closed {
		return v.closeResult
	}
	v.closed = true
	if v.store != nil {
		v.closeResult = v.store.Close()
	}
	if v.closeResult == nil && v.firstCause != nil {
		v.closeResult = ErrUnknown
	}
	// Retain attempts, rows and failed transaction tokens; never close caller DB.
	return v.closeResult
}
func publisherPendingKey(p Principal, c Command) string { return objectHash(p) + ":" + objectHash(c) }
func (o *OriginalDeveloperSourceFactory) publisherUsable() bool {
	return o.usable() && o.publisher != nil && !o.publisher.closed && o.publisher.firstCause == nil && o.publisher.store != nil
}

// Called by Catalog's normal registration path AFTER its one original HTTP
// authentication. It does not authenticate/replay that request a second time.
func (o *OriginalDeveloperSourceFactory) captureOriginalPublisherRegistration(ctx context.Context, p Principal, c Command, public, proof []byte) error {
	if o == nil || ctx == nil || ctx.Err() != nil || !principalValid(p, time.Now().UnixMilli()) || !c.valid(time.Now().UnixMilli()) || c.Action != "project.publisher" || c.Revoke || len(public) == 0 || len(public) > 8192 || hash(public) != c.PublicOriginalSHA256 || len(proof) == 0 || len(proof) > 786432 {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() {
		return ErrUnknown
	}
	v := o.publisher
	key := publisherPendingKey(p, c)
	if previous := v.pending[key]; previous != nil {
		if !bytes.Equal(previous.public, public) || !bytes.Equal(previous.proof, proof) {
			return ErrConflict
		}
		return previous.result
	}
	r := &originalFactoryPublisherPending{principal: p, command: c, public: append([]byte(nil), public...), proof: append([]byte(nil), proof...), selected: true, result: ErrUnknown}
	v.pending[key] = r
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		r.result = e
		return e
	}
	// Same fixed process owner and release original; no HTTP callback/endpoint.
	control := o.control
	control.mu.Lock()
	if control.closeSelected || control.firstCause != nil {
		control.mu.Unlock()
		return ErrUnknown
	}
	input, e := json.Marshal(map[string]any{"operation": "ide-protected-publisher-current-native-node/v1", "source": json.RawMessage(control.source), "registrationOriginal": string(r.proof), "principal": originalControlPrincipalDTO(p), "command": originalControlCommandDTO(c)})
	if e == nil {
		r.observation, e = control.verifier.invokeOriginalProtectedPublisherCurrent(ctx, input, p, c, r.public, r.proof, control.caller)
	}
	if e == nil && (r.observation == nil || r.observation.profile != control.profile) {
		e = ErrDenied
	}
	control.mu.Unlock()
	if e != nil {
		r.result = e
		return e
	}
	r.attempt, e = v.store.retainOriginal(r.observation, p, c, r.public, r.proof, control.caller)
	if e == nil {
		e = v.store.capture(ctx, r.attempt)
	}
	if e == nil {
		e = o.principal.AssertPrincipalCurrent(ctx, p)
	}
	if e == nil {
		e = r.observation.recheckOriginalCompletion(ctx, p, c, r.public, r.proof, control.caller)
	}
	r.result = e
	return e
}

func (o *OriginalDeveloperSourceFactory) VerifyProtectedPublisherOriginal(ctx context.Context, p Principal, c Command, public []byte) (ProtectedPublisher, error) {
	if o == nil || ctx == nil || ctx.Err() != nil {
		return ProtectedPublisher{}, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() {
		return ProtectedPublisher{}, ErrUnknown
	}
	r := o.publisher.pending[publisherPendingKey(p, c)]
	if r == nil || !r.selected || r.result != nil || r.attempt == nil || !r.attempt.completed.Load() || r.attempt.result != nil || r.attempt.receipt == nil || !r.attempt.receipt.matches(r.attempt) || r.attempt.receipt.state != "captured" || !bytes.Equal(r.public, public) {
		return ProtectedPublisher{}, ErrDenied
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		r.result = ErrUnknown
		return ProtectedPublisher{}, ErrUnknown
	}
	if e := o.refreshOriginalPublisherRegistration(ctx, r); e != nil {
		r.result = ErrUnknown
		return ProtectedPublisher{}, ErrUnknown
	}
	if e := r.observation.recheckOriginalCompletion(ctx, p, c, r.public, r.proof, o.control.caller); e != nil {
		r.result = ErrUnknown
		return ProtectedPublisher{}, ErrUnknown
	}
	v := r.observation.projection
	return ProtectedPublisher{Account: v.Account, ProjectID: v.ProjectID, PublisherID: v.PublisherID, KeyRole: v.KeyRole, PublicSHA256: v.PublicSHA256, RegistrationRef: v.RegistrationRef, ExpiresMS: r.observation.reviewExpiresMS}, nil
}

// A fresh actual role/current verification is a read, not another registration
// or capture attempt. Keep every original/partial and never replace the first
// capture's nonce/head/profile or clear UNKNOWN on an older result.
func (o *OriginalDeveloperSourceFactory) refreshOriginalPublisherRegistration(ctx context.Context, r *originalFactoryPublisherPending) error {
	control := o.control
	control.mu.Lock()
	defer control.mu.Unlock()
	if control.closeSelected || control.firstCause != nil || r == nil || r.observation == nil {
		return ErrUnknown
	}
	input, e := json.Marshal(map[string]any{"operation": "ide-protected-publisher-current-native-node/v1", "source": json.RawMessage(control.source), "registrationOriginal": string(r.proof), "principal": originalControlPrincipalDTO(r.principal), "command": originalControlCommandDTO(r.command)})
	if e != nil {
		return e
	}
	fresh, e := control.verifier.invokeOriginalProtectedPublisherCurrent(ctx, input, r.principal, r.command, r.public, r.proof, control.caller)
	if fresh != nil {
		r.currentObservations = append(r.currentObservations, fresh)
	}
	if e != nil {
		return e
	}
	if fresh == nil {
		return ErrUnknown
	}
	old := r.observation
	if old.sourceID != fresh.sourceID || old.instanceID != fresh.instanceID || old.profile != fresh.profile || old.profile != control.profile || old.head != fresh.head || old.nonce != fresh.nonce || old.generation != fresh.generation || old.sequence != fresh.sequence || old.floor != fresh.floor || old.reviewExpiresMS != fresh.reviewExpiresMS || old.projection.Account != fresh.projection.Account || old.projection.ProjectID != fresh.projection.ProjectID || old.projection.PublisherID != fresh.projection.PublisherID || old.projection.RegistrationRef != fresh.projection.RegistrationRef || old.projection.PublicSHA256 != fresh.projection.PublicSHA256 {
		return ErrUnknown
	}
	return fresh.recheckOriginalCompletion(ctx, r.principal, r.command, r.public, r.proof, control.caller)
}

func (o *OriginalDeveloperSourceFactory) bindOriginalPublisherCatalog(ctx context.Context, operation *originalPublisherCatalogOperation) error {
	if o == nil || ctx == nil || operation == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.publisherUsable() {
		return ErrUnknown
	}
	v := o.publisher
	// Preserve every actual token including SQL/Rows partial and close failures.
	found := false
	for _, previous := range v.operations {
		if previous == operation {
			found = true
			break
		}
	}
	if !found {
		v.operations = append(v.operations, operation)
	}
	var a *originalPublisherCaptureAttempt
	if !operation.command.Revoke {
		r := v.pending[publisherPendingKey(operation.principal, operation.command)]
		if r == nil || r.result != nil || !bytes.Equal(r.public, operation.public) {
			return ErrDenied
		}
		a = r.attempt
	}
	return v.store.bindCatalogTransaction(ctx, operation, a)
}
