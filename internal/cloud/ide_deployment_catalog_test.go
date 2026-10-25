package cloud

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// PUBLIC adapter seams only. These do not represent a live Auth Source,
// PostgreSQL catalog, signature, explicit approval or deployment authority.
type publicIDECatalog struct {
	access          developerauthority.Access
	principal       developerauthority.Principal
	err, late       error
	project, origin string
	rechecks        int
	request         *http.Request
}

func (c *publicIDECatalog) AssertCurrent(context.Context) error { return c.err }
func (c *publicIDECatalog) Principal(_ context.Context, r *http.Request) (developerauthority.Principal, error) {
	c.request = r
	return c.principal, c.err
}
func (c *publicIDECatalog) CurrentProject(_ context.Context, r *http.Request, id string) (developerauthority.Access, error) {
	c.request = r
	c.project = id
	return c.access, c.err
}
func (c *publicIDECatalog) RecheckProject(_ context.Context, r *http.Request, a developerauthority.Access) error {
	c.request = r
	c.rechecks++
	if a.CurrentReference != c.access.CurrentReference {
		return ErrDenied
	}
	return c.late
}
func (c *publicIDECatalog) AssertProjectRuntimeOrigin(_ context.Context, origin string) error {
	c.origin = origin
	return c.err
}
func (c *publicIDECatalog) AuthorizeProjectRuntime(_ context.Context, r *http.Request, id, origin string) (developerauthority.Access, error) {
	c.request = r
	c.project = id
	c.origin = origin
	return c.access, c.err
}

func TestIDEDeploymentCatalogProductionConstructorDoesNotEnablePublication(t *testing.T) {
	if _, err := NewIDEDeveloperCatalogAccess(nil); !errors.Is(err, ErrDenied) {
		t.Fatal("nil original catalog admitted")
	}
	a := &IDEDeveloperCatalogAccess{catalog: &publicIDECatalog{}}
	if _, ok := any(a).(IDEDeploymentAuthority); ok {
		t.Fatal("catalog-only access became publication authority")
	}
	if err := (*IDEDeveloperCatalogAccess)(nil).AssertCurrent(context.Background()); !errors.Is(err, ErrDenied) {
		t.Fatal("nil adapter admitted")
	}
}

func TestIDEDeploymentCatalogPreservesOriginalRequestAndCurrentFailure(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "https://cloud.example.invalid/api/v1/ide/deployments/request_original_123456", nil)
	c := &publicIDECatalog{principal: developerauthority.Principal{Account: "PUBLIC_ACCOUNT"}}
	a := &IDEDeveloperCatalogAccess{catalog: c}
	p, err := a.Principal(r.Context(), r)
	if err != nil || p != "PUBLIC_ACCOUNT" || c.request != r {
		t.Fatal("original principal request changed", p, err)
	}
	sentinel := errors.New("PUBLIC original source revoked")
	c.err = sentinel
	if err := a.AssertCurrent(r.Context()); !errors.Is(err, sentinel) {
		t.Fatal("source first cause lost", err)
	}
	if _, err := a.Principal(r.Context(), r); !errors.Is(err, sentinel) {
		t.Fatal("principal first cause lost", err)
	}
}

func TestIDEDeploymentCatalogReadRequiresExplicitCurrentProject(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "https://cloud.example.invalid/", nil)
	op := IDEDeploymentOperation{Binding: IDEArtifactBinding{ProjectID: "PUBLIC_PROJECT"}}
	for _, mode := range []string{"read", "owner-only", "wrong-project", "late-revocation", "source-error"} {
		t.Run(mode, func(t *testing.T) {
			c := &publicIDECatalog{access: developerauthority.Access{ProjectID: op.Binding.ProjectID, Read: true, CurrentReference: "PUBLIC_CURRENT"}}
			switch mode {
			case "owner-only":
				c.access.Read = false
				c.access.Publish = true
				c.access.OwnerAccount = "PUBLIC_OWNER"
			case "wrong-project":
				c.access.ProjectID = "OTHER"
			case "late-revocation":
				c.late = ErrDenied
			case "source-error":
				c.err = ErrDenied
			}
			a := &IDEDeveloperCatalogAccess{catalog: c}
			err := a.AuthorizeRead(r.Context(), r, op)
			if mode == "read" {
				if err != nil || c.rechecks != 1 || c.project != op.Binding.ProjectID || c.request != r {
					t.Fatal("read translation", err)
				}
			} else if err == nil {
				t.Fatal("read permission widened")
			}
		})
	}
}

func TestIDEDeploymentCatalogRuntimeSeparatesOriginAndCapability(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "https://project.runtime.example.invalid/", nil)
	origin := "https://runtime.example.invalid"
	for _, mode := range []string{"runtime", "read-only", "wrong-origin", "wrong-project", "terminal", "wrong-kind", "late-revocation"} {
		t.Run(mode, func(t *testing.T) {
			op := IDEDeploymentOperation{Binding: IDEArtifactBinding{ProjectID: "PUBLIC_PROJECT"}, State: "running", RuntimeKind: "node-http-project"}
			c := &publicIDECatalog{access: developerauthority.Access{ProjectID: op.Binding.ProjectID, RuntimeOrigin: origin, Runtime: true, Read: true, CurrentReference: "PUBLIC_CURRENT"}}
			switch mode {
			case "read-only":
				c.access.Runtime = false
			case "wrong-origin":
				c.access.RuntimeOrigin = "https://other.example.invalid"
			case "wrong-project":
				c.access.ProjectID = "OTHER"
			case "terminal":
				op.State = "completed"
			case "wrong-kind":
				op.RuntimeKind = "bounded-node-job"
			case "late-revocation":
				c.late = ErrDenied
			}
			a := &IDEDeveloperCatalogAccess{catalog: c}
			err := a.AuthorizeProjectRuntime(r.Context(), r, op, origin)
			if mode == "runtime" {
				if err != nil || c.rechecks != 1 || c.origin != origin || c.project != op.Binding.ProjectID || c.request != r {
					t.Fatal("runtime translation", err)
				}
			} else if err == nil {
				t.Fatal("runtime permission widened")
			}
		})
	}
}
