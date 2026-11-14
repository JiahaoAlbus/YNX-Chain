package cloud

import (
	"bytes"
	"errors"
	"net/http"
	"reflect"
)

func missingIDEV2Permit(p IDEDeploymentV2Permit) bool {
	return p == nil || reflect.ValueOf(p).Kind() == reflect.Pointer && reflect.ValueOf(p).IsNil()
}

func (s *Server) finishIDEDeploymentV2(w http.ResponseWriter, r *http.Request, d *ideDeploymentService, principal string, artifact *IDEDeploymentV2Artifact, approval []byte, request, revision string, targets []string) {
	if d.v2Authority == nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_AUTHORITY_UNAVAILABLE")
		return
	}
	executor, ok := d.executor.(IDEDeploymentV2Executor)
	if !ok {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_EXECUTOR_UNAVAILABLE")
		return
	}
	rollback := ""
	if len(targets) == 1 {
		rollback = targets[0]
	}
	// Normal contract: this part is the original raw E11 Member. The original
	// Auth adapter independently acquires execution approval from protected
	// Source/Catalog for THIS same request. A Member cannot replace that grant.
	permit, err := d.v2Authority.AuthorizeV2(r.Context(), r, principal, IDEDeploymentV2Request{Artifact: artifact, MemberOriginal: bytes.Clone(approval), RequestID: request, ExpectedSlotRevision: revision, RollbackTarget: rollback})
	if !missingIDEV2Permit(permit) {
		defer permit.Close()
	}
	if err != nil || missingIDEV2Permit(permit) {
		if isIDEDeploymentV2RequestUnavailable(err) {
			productReadFailure(w, 503, "IDE_DEPLOYMENT_V2_ORIGINAL_REQUEST_UNAVAILABLE")
			return
		}
		productReadFailure(w, 403, "IDE_DEPLOYMENT_V2_APPROVAL_DENIED")
		return
	}
	grant := permit.Selection()
	manifest, binding, content := artifact.Manifest(), artifact.Binding(), artifact.ContentBinding()
	if grant.RequestID != request || grant.Principal != principal || grant.ExpectedSlotRevision != revision || grant.RollbackTarget != rollback || grant.Manifest != manifest || grant.ManifestBinding != binding || grant.ContentBinding != content || grant.CatalogProjectID == "" || grant.ResourceID == "" || grant.PublisherID == "" || grant.ResourceApprovalRef == "" || grant.RuntimeSeconds < 6 || grant.RuntimeSeconds > 300 || grant.RequiresAdditionalCharge || !grant.ExpiresAt.After(d.now()) {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_V2_SELECTION_DENIED")
		return
	}
	current := func() error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		if !grant.ExpiresAt.After(d.now()) {
			return ErrDenied
		}
		if err := d.authority.AssertCurrent(r.Context()); err != nil {
			return err
		}
		if permit.Selection() != grant {
			return ErrDenied
		}
		if err := permit.Recheck(r.Context()); err != nil {
			return err
		}
		if !grant.ExpiresAt.After(d.now()) || r.Context().Err() != nil {
			return ErrDenied
		}
		return nil
	}
	if rollback != "" {
		prior, err := d.journal.lookup(principal, rollback)
		if err != nil || d.authorizeOperationRead(r.Context(), r, prior) != nil || prior.ManifestVersion != "2" || prior.ManifestV2 == nil || prior.State != "completed" || prior.ExitCode == nil || *prior.ExitCode != 0 || prior.DeploymentID == "" || prior.ResourceID != grant.ResourceID || prior.ContentBinding == nil || *prior.ContentBinding != content || !sameIDEV2Rollback(*prior.ManifestV2, manifest) {
			productReadFailure(w, 409, "IDE_DEPLOYMENT_SLOT_SELECTION_REJECTED")
			return
		}
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_PERMISSION_CHANGED")
		return
	}
	proposal := IDEDeploymentOperation{CatalogProjectID: grant.CatalogProjectID, ManifestVersion: "2", ManifestBinding: &binding, ManifestV2: &manifest, ContentBinding: &content, ArtifactSHA256: productHash(artifact.content), RequestID: request, ExpectedSlotRevision: revision, RollbackTarget: rollback, ManifestSHA256: productHash(artifact.ManifestBytes()), ApprovalSHA256: productHash(approval), PublisherID: grant.PublisherID, ResourceID: grant.ResourceID, RuntimeSeconds: grant.RuntimeSeconds, ResourceApprovalRef: grant.ResourceApprovalRef, CreatedAt: d.now()}
	op, claim, err := d.journal.begin(principal, proposal)
	if errors.Is(err, ErrIDEDeploymentConflict) {
		productReadFailure(w, 409, "IDEMPOTENCY_KEY_CONFLICT")
		return
	}
	if err != nil {
		productReadFailure(w, 503, "IDE_DEPLOYMENT_JOURNAL_UNAVAILABLE")
		return
	}
	if claim && current() == nil {
		borrowed, borrowErr := permit.BorrowArtifactOriginal(r.Context())
		if borrowErr != nil || borrowed == nil {
			writeJSON(w, 202, op)
			return
		}
		result, executeErr := executor.ApplyExistingV2(r.Context(), op, principal, grant.ExpiresAt, borrowed, current)
		if isIDEBeforeDispatch(executeErr) {
			result = IDEDeploymentResult{RequestID: op.RequestID, ResourceID: op.ResourceID, State: "failed", ManifestVersion: "2", ManifestBinding: op.ManifestBinding, ContentBinding: op.ContentBinding}
			executeErr = nil
		}
		if executeErr == nil && r.Context().Err() == nil {
			op = d.acceptResult(principal, op, result, current)
		}
	}
	status := 202
	switch op.State {
	case "running":
		status = 201
	case "completed":
		status = 200
	case "failed":
		status = 409
	}
	writeJSON(w, status, op)
}

// A rollback is a new approved publication. Artifact fullRef/content/objectKey
// and owning project/tenant/env must match the successful historical artifact;
// current publisher/issuer epochs and version remain fresh Auth selections.
func sameIDEV2Rollback(a, b IDEDeploymentV2Manifest) bool {
	return a.Realm == b.Realm && a.Tenant == b.Tenant && a.Project == b.Project && a.Artifact == b.Artifact && a.Environment == b.Environment
}
