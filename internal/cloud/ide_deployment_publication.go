package cloud

import (
	"context"
	"net/http"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// AuthIDEDeploymentAuthority is a consumer of the ORIGINAL Auth catalog and
// its private publication decision. Construction does not create a Source,
// migrate a database, register a publisher, approve a resource or enable routes.
type AuthIDEDeploymentAuthority struct {
	*IDEDeveloperCatalogAccess
	publication *developerauthority.Catalog
}

func NewAuthIDEDeploymentAuthority(catalog *developerauthority.Catalog) (*AuthIDEDeploymentAuthority, error) {
	access, err := NewIDEDeveloperCatalogAccess(catalog)
	if err != nil {
		return nil, err
	}
	return &AuthIDEDeploymentAuthority{IDEDeveloperCatalogAccess: access, publication: catalog}, nil
}

func cloudPublicationPermit(original *developerauthority.PublicationPermit) IDEDeploymentPermit {
	if original == nil {
		return IDEDeploymentPermit{}
	}
	b := original.Binding
	return IDEDeploymentPermit{
		RequestID: original.RequestID, Principal: original.Principal,
		PublisherID: original.PublisherID, ResourceID: original.ResourceID,
		ResourceApprovalRef: original.ResourceApprovalRef,
		ApprovalSHA256:      original.ApprovalSHA256, ManifestSHA256: original.ManifestSHA256,
		Binding:        IDEArtifactBinding{ProjectID: b.ProjectID, Version: b.Version, ContentDigest: b.ContentDigest, PublishPurpose: b.PublishPurpose, TargetEnvironment: b.TargetEnvironment, ByteSize: b.ByteSize},
		RuntimeSeconds: original.RuntimeSeconds, ExpiresAt: time.UnixMilli(original.ExpiresMS),
		RequiresAdditionalCharge: original.RequiresAdditionalCharge,
		originalAuthPermit:       original,
	}
}

func sameOriginalPublicationPermit(permit IDEDeploymentPermit) bool {
	original := permit.originalAuthPermit
	if original == nil {
		return false
	}
	expected := cloudPublicationPermit(original)
	return permit.RequestID == expected.RequestID && permit.Principal == expected.Principal && permit.PublisherID == expected.PublisherID && permit.ResourceID == expected.ResourceID && permit.ResourceApprovalRef == expected.ResourceApprovalRef && permit.ApprovalSHA256 == expected.ApprovalSHA256 && permit.ManifestSHA256 == expected.ManifestSHA256 && permit.Binding == expected.Binding && permit.RuntimeSeconds == expected.RuntimeSeconds && permit.ExpiresAt.Equal(expected.ExpiresAt) && permit.RequiresAdditionalCharge == expected.RequiresAdditionalCharge
}

func (a *AuthIDEDeploymentAuthority) Authorize(ctx context.Context, r *http.Request, principal string, manifest, approval []byte) (IDEDeploymentPermit, error) {
	if a == nil || a.publication == nil || ctx == nil || r == nil || principal == "" {
		return IDEDeploymentPermit{}, ErrDenied
	}
	// Auth alone verifies the original request, proof, artifact signature,
	// current publisher registration and independent existing-resource approval.
	original, err := a.publication.AuthorizePublication(ctx, r, manifest, approval)
	if err != nil {
		return IDEDeploymentPermit{}, err
	}
	if original == nil || original.Principal != principal {
		return IDEDeploymentPermit{}, ErrDenied
	}
	return cloudPublicationPermit(original), nil
}

func (a *AuthIDEDeploymentAuthority) Recheck(ctx context.Context, r *http.Request, permit IDEDeploymentPermit) error {
	if a == nil || a.publication == nil || ctx == nil || r == nil || !sameOriginalPublicationPermit(permit) {
		return ErrDenied
	}
	// The opaque original survives only this dispatch, never the operation
	// journal/JSON. After a restart, queries use current Auth project access;
	// no saved approval packet or fabricated permit can authorize a replay.
	return a.publication.RecheckPermit(ctx, r, permit.originalAuthPermit)
}

var _ IDEDeploymentAuthority = (*AuthIDEDeploymentAuthority)(nil)
var _ IDEProjectRuntimeAuthority = (*AuthIDEDeploymentAuthority)(nil)
