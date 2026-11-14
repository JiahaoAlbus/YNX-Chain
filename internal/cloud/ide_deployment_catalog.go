package cloud

import (
	"context"
	"net/http"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

type ideDeveloperCatalog interface {
	AssertCurrent(context.Context) error
	Principal(context.Context, *http.Request) (developerauthority.Principal, error)
	CurrentProject(context.Context, *http.Request, string) (developerauthority.Access, error)
	RecheckProject(context.Context, *http.Request, developerauthority.Access) error
	AssertProjectRuntimeOrigin(context.Context, string) error
	AuthorizeProjectRuntime(context.Context, *http.Request, string, string) (developerauthority.Access, error)
}

// IDEDeveloperCatalogAccess translates the original Auth catalog only. It is
// deliberately NOT an IDEDeploymentAuthority: publication approval and permit
// revalidation must come from the original Auth publication producer. Merely
// constructing this adapter cannot enable deployment routes or grant access.
type IDEDeveloperCatalogAccess struct {
	catalog ideDeveloperCatalog
}

// The production constructor accepts only the original concrete Auth catalog,
// never caller-supplied role booleans, bearer decoders or verifier callbacks.
func NewIDEDeveloperCatalogAccess(catalog *developerauthority.Catalog) (*IDEDeveloperCatalogAccess, error) {
	if catalog == nil {
		return nil, ErrDenied
	}
	return &IDEDeveloperCatalogAccess{catalog: catalog}, nil
}

func (a *IDEDeveloperCatalogAccess) AssertCurrent(ctx context.Context) error {
	if a == nil || a.catalog == nil || ctx == nil {
		return ErrDenied
	}
	return a.catalog.AssertCurrent(ctx)
}

func (a *IDEDeveloperCatalogAccess) Principal(ctx context.Context, r *http.Request) (string, error) {
	if a == nil || a.catalog == nil || ctx == nil || r == nil {
		return "", ErrDenied
	}
	p, err := a.catalog.Principal(ctx, r)
	if err != nil {
		return "", err
	}
	if p.Account == "" {
		return "", ErrDenied
	}
	return p.Account, nil
}

// The Cloud operation journal already selects the current account's original
// request. A journal row itself grants nothing: even its owner needs explicit
// CURRENT read permission on the exact project, then a fresh revision fence.
func (a *IDEDeveloperCatalogAccess) AuthorizeRead(ctx context.Context, r *http.Request, op IDEDeploymentOperation) error {
	if a == nil || a.catalog == nil || ctx == nil || r == nil || op.Binding.ProjectID == "" {
		return ErrDenied
	}
	access, err := a.catalog.CurrentProject(ctx, r, op.Binding.ProjectID)
	if err != nil {
		return err
	}
	if access.ProjectID != op.Binding.ProjectID || !access.Read {
		return ErrDenied
	}
	return a.catalog.RecheckProject(ctx, r, access)
}

func (a *IDEDeveloperCatalogAccess) AssertProjectRuntimeOrigin(ctx context.Context, origin string) error {
	if a == nil || a.catalog == nil || ctx == nil || origin == "" {
		return ErrDenied
	}
	return a.catalog.AssertProjectRuntimeOrigin(ctx, origin)
}

// Runtime access is separate from operation-log read and publication. Neither
// hostname possession, project ownership nor a successful earlier deployment
// substitutes for this original current principal/project/origin decision.
func (a *IDEDeveloperCatalogAccess) AuthorizeProjectRuntime(ctx context.Context, r *http.Request, op IDEDeploymentOperation, origin string) error {
	if a == nil || a.catalog == nil || ctx == nil || r == nil || origin == "" || op.Binding.ProjectID == "" || op.State != "running" || op.RuntimeKind != "node-http-project" {
		return ErrDenied
	}
	access, err := a.catalog.AuthorizeProjectRuntime(ctx, r, op.Binding.ProjectID, origin)
	if err != nil {
		return err
	}
	if access.ProjectID != op.Binding.ProjectID || access.RuntimeOrigin != origin || !access.Runtime {
		return ErrDenied
	}
	return a.catalog.RecheckProject(ctx, r, access)
}

var _ IDEProjectRuntimeAuthority = (*IDEDeveloperCatalogAccess)(nil)
