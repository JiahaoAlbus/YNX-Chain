package developerauthority

import (
	"bytes"
	"context"
	"database/sql"
	"database/sql/driver"
	"sync"
	"time"
)

// Package-private participant. A renderer/product adapter cannot implement
// this method or mint the nonserializable original Catalog transaction token.
// A Source without this normal owned callee must refuse publisher mutations.
type originalPublisherCatalogParticipant interface {
	bindOriginalPublisherCatalog(context.Context, *originalPublisherCatalogOperation) error
}
type originalPublisherCatalogOperation struct {
	mu                                  sync.Mutex
	catalog                             *Catalog
	tx                                  *sql.Tx
	connection                          *sql.Conn
	principal                           Principal
	command                             Command
	approval                            Approval
	key                                 ProtectedPublisher
	controlProof, public                []byte
	selected                            bool
	store                               *originalPublisherCaptureStore
	attempt                             *originalPublisherCaptureAttempt
	result                              error
	panicCause                          any
	driverCause                         error
	rollbackCause, connectionCloseCause error
	partialRows                         []driver.Rows
	registryRevision                    int64
}

func (*originalPublisherCatalogOperation) String() string {
	return "originalPublisherCatalogOperation{same original ACL transaction only}"
}
func (o *originalPublisherCatalogOperation) GoString() string { return o.String() }

const originalPublisherCatalogRowSQL = `SELECT account,key_role,public_original,public_sha256,registration_ref,revision,expires_ms,revoked FROM developer_publishers WHERE project_id=$1 AND publisher_id=$2`
const originalPublisherCatalogActivateSQL = `INSERT INTO public.auth_ide_publisher_catalog_bindings
 (project_id,publisher_id,account,public_sha256,registration_ref,publisher_revision,source_id,instance_id,profile_sha256,capture_head,capture_execution_id,grant_expires_ms,binding_state,registry_revision)
 SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active',1
 FROM public.auth_ide_publisher_captures
 WHERE source_id=$7 AND instance_id=$8 AND profile_sha256=$9 AND capture_head=$10
 AND execution_id=$11 AND registration_ref=$5 AND principal_sha256=$14
 AND command_sha256=$15 AND proof_sha256=$16 AND public_sha256=$4
 AND capture_state='captured' AND capture_revision=1 AND observation_expires_ms>$17
 AND grant_expires_ms=$18 AND observation_expires_ms=$19 AND registration_nonce=$20
 ON CONFLICT(project_id,publisher_id) DO UPDATE SET
 account=EXCLUDED.account,public_sha256=EXCLUDED.public_sha256,registration_ref=EXCLUDED.registration_ref,
 publisher_revision=EXCLUDED.publisher_revision,source_id=EXCLUDED.source_id,instance_id=EXCLUDED.instance_id,
 profile_sha256=EXCLUDED.profile_sha256,capture_head=EXCLUDED.capture_head,capture_execution_id=EXCLUDED.capture_execution_id,
 grant_expires_ms=EXCLUDED.grant_expires_ms,binding_state='active',registry_revision=auth_ide_publisher_catalog_bindings.registry_revision+1
 WHERE auth_ide_publisher_catalog_bindings.publisher_revision=$13
 AND auth_ide_publisher_catalog_bindings.publisher_revision<EXCLUDED.publisher_revision
 RETURNING registry_revision`
const originalPublisherCatalogRevokeSQL = `UPDATE public.auth_ide_publisher_catalog_bindings
 SET binding_state='revoked',publisher_revision=$1,registry_revision=registry_revision+1
 WHERE project_id=$2 AND publisher_id=$3 AND account=$4 AND public_sha256=$5
 AND publisher_revision=$6 AND binding_state='active' AND registration_ref=$7 AND grant_expires_ms=$8
 RETURNING registry_revision`

// Called only by the normal Source participant AFTER Catalog itself checked
// owner/admin ACL + expected revision and wrote its publisher row in this tx.
// Neither this method nor a verified capture can bypass that original path.
func (s *originalPublisherCaptureStore) bindCatalogTransaction(ctx context.Context, o *originalPublisherCatalogOperation, a *originalPublisherCaptureAttempt) (result error) {
	if s == nil || o == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.selected {
		if o.store != s || o.attempt != a {
			return ErrDenied
		}
		return o.result
	}
	o.selected = true
	o.store = s
	o.attempt = a
	defer func() {
		if cause := recover(); cause != nil {
			o.panicCause = cause
			o.result = ErrUnknown
			result = ErrUnknown
		}
	}()
	fail := func(e error) error { o.result = e; return e }
	if ctx == nil || ctx.Err() != nil || o.catalog == nil || o.catalog.db != s.db || o.tx == nil || o.connection == nil || o.command.Action != "project.publisher" || !validApproval(o.approval, o.principal, o.command, o.controlProof, time.Now().UnixMilli()) {
		return fail(ErrDenied)
	}
	// Reject an in-flight/unknown capture BEFORE waiting on its store mutex
	// and before reading a receipt that Scan may still be filling.
	if !o.command.Revoke && (a == nil || !a.completed.Load()) {
		return fail(ErrDenied)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.firstCause != nil {
		return fail(ErrUnknown)
	}
	// Validate the actual row ALREADY written in the same original transaction.
	var row Publisher
	row.ProjectID = o.command.ProjectID
	row.PublisherID = o.command.PublisherID
	if e := o.fixedTransactionRow(ctx, originalPublisherCatalogRowSQL, row.ProjectID, row.PublisherID).Scan(&row.Account, &row.KeyRole, &row.PublicOriginal, &row.PublicSHA256, &row.RegistrationRef, &row.Revision, &row.ExpiresMS, &row.Revoked); e != nil {
		return fail(e)
	}
	if row.Account != o.command.SubjectAccount || row.KeyRole != "ide-artifact-publisher" || row.PublicSHA256 != o.command.PublicOriginalSHA256 || row.Revision != o.command.ExpectedRevision+1 || row.Revoked != o.command.Revoke || hash(row.PublicOriginal) != row.PublicSHA256 {
		return fail(ErrDenied)
	}
	if o.command.Revoke {
		if a != nil {
			return fail(ErrDenied)
		}
		if e := o.fixedTransactionRow(ctx, originalPublisherCatalogRevokeSQL, row.Revision, row.ProjectID, row.PublisherID, row.Account, row.PublicSHA256, o.command.ExpectedRevision, row.RegistrationRef, row.ExpiresMS).Scan(&o.registryRevision); e != nil {
			return fail(e)
		}
	} else {
		if a == nil || a.store != s || a.result != nil || a.receipt == nil || !a.receipt.matches(a) || a.receipt.state != "captured" || a.principal != o.principal || a.command != o.command || !bytes.Equal(a.public, o.public) || !bytes.Equal(row.PublicOriginal, o.public) || row.RegistrationRef != a.registration || row.RegistrationRef != o.key.RegistrationRef || row.PublicSHA256 != o.key.PublicSHA256 || row.Account != o.key.Account || row.ProjectID != o.key.ProjectID || row.PublisherID != o.key.PublisherID || o.key.KeyRole != "ide-artifact-publisher" || o.key.ExpiresMS != a.grantExpires || row.ExpiresMS != o.command.GrantExpiresMS {
			return fail(ErrDenied)
		}
		if e := a.observation.recheckOriginalCompletion(ctx, a.principal, a.command, a.public, a.proof, a.caller); e != nil {
			return fail(e)
		}
		if e := o.fixedTransactionRow(ctx, originalPublisherCatalogActivateSQL, row.ProjectID, row.PublisherID, row.Account, row.PublicSHA256, row.RegistrationRef, row.Revision, a.source, a.instance, a.profile, a.head, a.execution, o.command.GrantExpiresMS, o.command.ExpectedRevision, objectHash(o.principal), objectHash(o.command), hash(a.proof), time.Now().UnixMilli(), a.grantExpires, a.observationExpires, a.nonce).Scan(&o.registryRevision); e != nil {
			return fail(e)
		}
		if e := a.observation.recheckOriginalCompletion(ctx, a.principal, a.command, a.public, a.proof, a.caller); e != nil {
			return fail(e)
		}
	}
	if o.registryRevision < 1 || ctx.Err() != nil || !validApproval(o.approval, o.principal, o.command, o.controlProof, time.Now().UnixMilli()) {
		return fail(ErrUnknown)
	}
	return nil
}

// Same token is rechecked immediately before and after Catalog Commit. No
// manual rollback after uncertain/real commit; the caller keeps its original
// ControlResult and UNKNOWN. No callback-selected nonce, tx or key is renewed.
func (o *originalPublisherCatalogOperation) recheckCompletion(ctx context.Context) error {
	if o == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.selected || o.result != nil || o.registryRevision < 1 || o.store == nil {
		return ErrUnknown
	}
	fail := func(e error) error {
		if o.result == nil {
			o.result = e
		}
		return ErrUnknown
	}
	if ctx == nil {
		return fail(ErrDenied)
	}
	if e := ctx.Err(); e != nil {
		return fail(e)
	}
	o.store.mu.Lock()
	ready := o.store.ready && !o.store.closed && o.store.firstCause == nil
	o.store.mu.Unlock()
	if !ready || !validApproval(o.approval, o.principal, o.command, o.controlProof, time.Now().UnixMilli()) {
		return fail(ErrDenied)
	}
	if o.attempt != nil {
		if e := o.attempt.observation.recheckOriginalCompletion(ctx, o.attempt.principal, o.attempt.command, o.attempt.public, o.attempt.proof, o.attempt.caller); e != nil {
			return fail(e)
		}
	}
	if e := ctx.Err(); e != nil {
		return fail(e)
	}
	if !validApproval(o.approval, o.principal, o.command, o.controlProof, time.Now().UnixMilli()) {
		return fail(ErrDenied)
	}
	return nil
}
