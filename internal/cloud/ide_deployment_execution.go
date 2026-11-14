package cloud

import (
	"context"
	"io"
	"strconv"
	"time"
)

func validIDEOperationVersion(op IDEDeploymentOperation) bool {
	if op.ManifestVersion == "" {
		return op.ManifestBinding == nil && op.ManifestV2 == nil && op.ArtifactSHA256 == "" && op.CatalogProjectID == ""
	}
	if op.ManifestVersion != "2" || op.ManifestBinding == nil || op.ManifestV2 == nil || op.ContentBinding == nil || op.Binding != (IDEArtifactBinding{}) || op.CatalogProjectID == "" || op.ManifestV2.Artifact.Content != *op.ContentBinding || op.ManifestV2.Artifact.Size != strconv.FormatInt(op.ContentBinding.Bytes, 10) || op.ContentBinding.Bytes < 0 || op.ContentBinding.Bytes > MaxMultipartBytes || op.ManifestBinding.Bytes < 1 || op.ManifestBinding.Bytes > 16384 || !ideOCIDigest.MatchString("sha256:"+op.ArtifactSHA256) {
		return false
	}
	return true
}

// Shared existing-resource executor input. This is local DATA from a held
// authorized request; it is never a six-field authorization for V2.
type ideExecutionSnapshot struct {
	IDEDeploymentOperation
	Principal, TargetEnvironment string
	ExpiresAt                    time.Time
}

type IDEDeploymentV2Executor interface {
	ApplyExistingV2(context.Context, IDEDeploymentOperation, string, time.Time, io.Reader, func() error) (IDEDeploymentResult, error)
}

func legacyIDEExecution(p IDEDeploymentPermit) ideExecutionSnapshot {
	return ideExecutionSnapshot{IDEDeploymentOperation: IDEDeploymentOperation{RequestID: p.RequestID, Binding: p.Binding, ContentBinding: p.contentBinding, ExpectedSlotRevision: p.expectedSlotRevision, RollbackTarget: rollbackTargetID(p), ManifestSHA256: p.ManifestSHA256, ApprovalSHA256: p.ApprovalSHA256, PublisherID: p.PublisherID, ResourceID: p.ResourceID, RuntimeSeconds: p.RuntimeSeconds, ResourceApprovalRef: p.ResourceApprovalRef}, Principal: p.Principal, TargetEnvironment: p.Binding.TargetEnvironment, ExpiresAt: p.ExpiresAt}
}
func ideArtifactSize(op IDEDeploymentOperation) int64 {
	if op.ManifestVersion == "2" {
		if op.ContentBinding == nil {
			return -1
		}
		return op.ContentBinding.Bytes
	}
	return op.Binding.ByteSize
}
func ideArtifactSHA256(op IDEDeploymentOperation) string {
	if op.ManifestVersion == "2" {
		return op.ArtifactSHA256
	}
	return op.Binding.ContentDigest
}
func ideOperationEnvironment(op IDEDeploymentOperation) string {
	if op.ManifestVersion == "2" {
		if op.ManifestV2 == nil {
			return ""
		}
		return op.ManifestV2.Environment
	}
	return op.Binding.TargetEnvironment
}
func (e *OCIIDEDeploymentExecutor) ApplyExistingV2(ctx context.Context, op IDEDeploymentOperation, principal string, expires time.Time, body io.Reader, current func() error) (IDEDeploymentResult, error) {
	if op.ManifestVersion != "2" || op.ManifestV2 == nil || op.ManifestBinding == nil || op.ContentBinding == nil || op.Binding != (IDEArtifactBinding{}) || op.ManifestV2.Artifact.Content != *op.ContentBinding {
		return IDEDeploymentResult{}, ErrDenied
	}
	return e.applyExisting(ctx, ideExecutionSnapshot{IDEDeploymentOperation: op, Principal: principal, TargetEnvironment: op.ManifestV2.Environment, ExpiresAt: expires}, body, current)
}
