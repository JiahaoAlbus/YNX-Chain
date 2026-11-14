package cloud

import (
	"errors"
	"net/http"
	"strconv"
)

type ideBeforeDispatchError struct{ cause error }

func (e ideBeforeDispatchError) Error() string { return e.cause.Error() }
func (e ideBeforeDispatchError) Unwrap() error { return e.cause }
func isIDEBeforeDispatch(err error) bool {
	var before ideBeforeDispatchError
	return errors.As(err, &before)
}

func ideSlotNumber(raw string) (uint64, error) {
	n, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || strconv.FormatUint(n, 10) != raw {
		return 0, ErrInvalid
	}
	return n, nil
}
func rollbackTargetID(p IDEDeploymentPermit) string {
	if p.rollbackTarget != nil {
		return p.rollbackTarget.RequestID
	}
	return ""
}
func sameIDETransition(a, b IDEDeploymentOperation) bool {
	if a.CatalogProjectID != b.CatalogProjectID || a.ManifestVersion != b.ManifestVersion || a.ArtifactSHA256 != b.ArtifactSHA256 || !sameOptionalIDEBind(a.ManifestBinding, b.ManifestBinding) || !sameIDEV2Manifest(a.ManifestV2, b.ManifestV2) {
		return false
	}
	if a.ExpectedSlotRevision != b.ExpectedSlotRevision || a.RollbackTarget != b.RollbackTarget {
		return false
	}
	return a.ContentBinding == nil && b.ContentBinding == nil || a.ContentBinding != nil && b.ContentBinding != nil && *a.ContentBinding == *b.ContentBinding
}

func sameOptionalIDEBind(a, b *ObjectBinding) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
func sameIDEV2Manifest(a, b *IDEDeploymentV2Manifest) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}
func validIDEObservedRevision(op IDEDeploymentOperation, revision string) bool {
	n, err := ideSlotNumber(revision)
	if err != nil || n == 0 {
		return false
	}
	if op.SlotRevision != "" {
		return op.SlotRevision == revision
	}
	if op.ExpectedSlotRevision != "" {
		prior, err := ideSlotNumber(op.ExpectedSlotRevision)
		return err == nil && prior != ^uint64(0) && n == prior+1
	}
	return true
}

// Headers select a CAS precondition and an already observed artifact, never
// grant permission. The original Auth still verifies a fresh exact manifest,
// publisher, account, environment, request and resource approval for this NEW
// forward deployment. No old approval, balance or chain state is rolled back.
func (d *ideDeploymentService) selectResourceTransition(r *http.Request, principal string, p *IDEDeploymentPermit) error {
	revisions, targets := r.Header.Values("X-Expected-Deployment-Revision"), r.Header.Values("X-Rollback-To")
	if len(revisions) == 0 && len(targets) == 0 {
		return nil
	}
	if _, ok := d.executor.(interface{ revisionedIDEResource() }); !ok {
		return ErrIDEExistingRuntimeUnavailable
	}
	if len(revisions) != 1 {
		return ErrInvalid
	}
	if _, err := ideSlotNumber(revisions[0]); err != nil {
		return err
	}
	p.expectedSlotRevision = revisions[0]
	if len(targets) == 0 {
		return nil
	}
	if len(targets) != 1 || !productWriteKey.MatchString(targets[0]) || targets[0] == p.RequestID {
		return ErrInvalid
	}
	original, err := d.journal.lookup(principal, targets[0])
	if err != nil {
		return err
	}
	if d.authorizeOperationRead(r.Context(), r, original) != nil {
		return ErrDenied
	}
	// Only a proven successful original artifact, with the same actual content
	// and existing resource, can be a rollback target. Re-upload remains bounded
	// and verified; the mutable staging path of the old job is never reopened.
	if original.State != "completed" || original.ExitCode == nil || *original.ExitCode != 0 || original.DeploymentID == "" || original.ResourceID != p.ResourceID || original.Binding != p.Binding || original.ContentBinding == nil || p.contentBinding == nil || *original.ContentBinding != *p.contentBinding {
		return ErrIDEDeploymentConflict
	}
	p.rollbackTarget = &original
	return nil
}

func (*OCIIDEDeploymentExecutor) revisionedIDEResource() {}
