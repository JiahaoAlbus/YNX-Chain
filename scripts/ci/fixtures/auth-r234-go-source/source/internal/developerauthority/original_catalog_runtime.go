package developerauthority

// Original service startup composition, not a new server, listener, router,
// JSON config loader or Source issuer. Independent normal release admission
// must supply config/DB; no default Root, environment or signer is installed.
import (
	"context"
	"database/sql"
	"net/http"
	"sync"
)

type OriginalDeveloperCatalogRuntime struct {
	mu            sync.RWMutex
	source        *OriginalDeveloperSourceFactory
	catalog       *Catalog
	openCause     error
	closeSelected bool
	closeResult   error
}

func (*OriginalDeveloperCatalogRuntime) String() string {
	return "OriginalDeveloperCatalogRuntime{original startup custody redacted}"
}
func (o *OriginalDeveloperCatalogRuntime) GoString() string { return o.String() }

// Same borrowed DB is passed to BOTH actual factory and Catalog. Acquired
// nonnil partial source is retained even alongside error. Startup must keep
// the returned runtime, call Close, and never promote an open error to ready.
func OpenOriginalDeveloperCatalogRuntime(ctx context.Context, db *sql.DB, config OriginalDeveloperSourceFactoryConfig) (*OriginalDeveloperCatalogRuntime, error) {
	if ctx == nil || ctx.Err() != nil || db == nil {
		return nil, ErrDenied
	}
	o := &OriginalDeveloperCatalogRuntime{}
	source, e := OpenOriginalDeveloperSourceFactory(ctx, db, config)
	o.source = source
	if e != nil {
		o.openCause = e
		return o, e
	}
	o.catalog, e = NewCatalog(db, source)
	if e != nil {
		o.openCause = e
		return o, e
	}
	return o, nil
}

// No callback/provider surface or exposed mutable Catalog/Source pointer.
// Every normal call holds original child custody through its final fence.
// Close is a writer: it cannot retire the source underneath an active call.
func (o *OriginalDeveloperCatalogRuntime) begin(ctx context.Context) (*Catalog, error) {
	if o == nil || ctx == nil || ctx.Err() != nil {
		return nil, ErrDenied
	}
	o.mu.RLock()
	if o.closeSelected || o.openCause != nil || o.source == nil || o.catalog == nil {
		o.mu.RUnlock()
		return nil, ErrUnknown
	}
	return o.catalog, nil
}
func (o *OriginalDeveloperCatalogRuntime) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected {
		return o.closeResult
	}
	o.closeSelected = true
	if o.source != nil {
		o.closeResult = o.source.Close()
	}
	if o.closeResult == nil && o.openCause != nil {
		o.closeResult = ErrUnknown
	}
	// Retain originals/partial/source after Close. Catalog does not own DB and
	// is deliberately not exposed for a caller to use after this lifetime ends.
	return o.closeResult
}
func (o *OriginalDeveloperCatalogRuntime) Principal(ctx context.Context, r *http.Request) (Principal, error) {
	if r == nil {
		return Principal{}, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return Principal{}, e
	}
	defer o.mu.RUnlock()
	return c.Principal(ctx, r)
}
func (o *OriginalDeveloperCatalogRuntime) AssertCurrent(ctx context.Context) error {
	c, e := o.begin(ctx)
	if e != nil {
		return e
	}
	defer o.mu.RUnlock()
	return c.AssertCurrent(ctx)
}
func (o *OriginalDeveloperCatalogRuntime) CurrentProject(ctx context.Context, r *http.Request, id string) (Access, error) {
	if r == nil {
		return Access{}, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return Access{}, e
	}
	defer o.mu.RUnlock()
	return c.CurrentProject(ctx, r, id)
}
func (o *OriginalDeveloperCatalogRuntime) CurrentPublisher(ctx context.Context, r *http.Request, project, id string) (Publisher, error) {
	if r == nil {
		return Publisher{}, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return Publisher{}, e
	}
	defer o.mu.RUnlock()
	return c.CurrentPublisher(ctx, r, project, id)
}
func (o *OriginalDeveloperCatalogRuntime) RecheckProject(ctx context.Context, r *http.Request, a Access) error {
	if r == nil {
		return ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return e
	}
	defer o.mu.RUnlock()
	return c.RecheckProject(ctx, r, a)
}
func (o *OriginalDeveloperCatalogRuntime) AuthorizeProjectRuntime(ctx context.Context, r *http.Request, project, origin string) (Access, error) {
	if r == nil {
		return Access{}, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return Access{}, e
	}
	defer o.mu.RUnlock()
	return c.AuthorizeProjectRuntime(ctx, r, project, origin)
}
func (o *OriginalDeveloperCatalogRuntime) AssertProjectRuntimeOrigin(ctx context.Context, origin string) error {
	c, e := o.begin(ctx)
	if e != nil {
		return e
	}
	defer o.mu.RUnlock()
	return c.AssertProjectRuntimeOrigin(ctx, origin)
}
func (o *OriginalDeveloperCatalogRuntime) ApplyControl(ctx context.Context, r *http.Request, cmd Command, proof, public []byte) (*ControlResult, error) {
	if r == nil {
		return nil, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return nil, e
	}
	defer o.mu.RUnlock()
	return c.ApplyControl(ctx, r, cmd, proof, public)
}
func (o *OriginalDeveloperCatalogRuntime) ApplyPublisherControl(ctx context.Context, r *http.Request, cmd Command, proof, public, registration []byte) (*ControlResult, error) {
	if r == nil {
		return nil, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return nil, e
	}
	defer o.mu.RUnlock()
	return c.ApplyPublisherControl(ctx, r, cmd, proof, public, registration)
}
func (o *OriginalDeveloperCatalogRuntime) ObserveControl(ctx context.Context, r *http.Request, id, binding string) (*ControlResult, error) {
	if r == nil {
		return nil, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return nil, e
	}
	defer o.mu.RUnlock()
	return c.ObserveControl(ctx, r, id, binding)
}
func (o *OriginalDeveloperCatalogRuntime) AuthorizePublication(ctx context.Context, r *http.Request, manifest, approval []byte) (*PublicationPermit, error) {
	if r == nil {
		return nil, ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return nil, e
	}
	defer o.mu.RUnlock()
	return c.AuthorizePublication(ctx, r, manifest, approval)
}
func (o *OriginalDeveloperCatalogRuntime) RecheckPermit(ctx context.Context, r *http.Request, p *PublicationPermit) error {
	if r == nil {
		return ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return e
	}
	defer o.mu.RUnlock()
	return c.RecheckPermit(ctx, r, p)
}
func (o *OriginalDeveloperCatalogRuntime) AuthorizeReadOperation(ctx context.Context, r *http.Request, original OriginalOperation) error {
	if r == nil {
		return ErrDenied
	}
	c, e := o.begin(ctx)
	if e != nil {
		return e
	}
	defer o.mu.RUnlock()
	return c.AuthorizeReadOperation(ctx, r, original)
}
