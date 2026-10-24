package developerauthority

import (
	"context"
	"database/sql"
	"net/http"
	"sync"
)

// Normal production Catalog Source composition. Publication's other five
// methods and actual release admission remain separate; no Source13 facade.
type OriginalDeveloperSourceFactoryConfig struct {
	Principal OriginalDeveloperHTTPAuthorityConfig
	Control   OriginalProjectControlRuntimeConfig
	// Exact release-owned dedicated ide-project-authority-v1 Source input.
	// It is not the per-command CONTROL Source or caller JSON.
	ProjectOriginalSource []byte
	// Optional independently release-selected approval Source. Its absence
	// preserves the existing eight-method factory, but cannot approve release.
	PublicationOriginalSource   []byte
	PublicationNodeCodeIdentity string // original release-admitted Node, NOT Wallet's code identity
}

func (OriginalDeveloperSourceFactoryConfig) String() string {
	return "OriginalDeveloperSourceFactoryConfig{release references redacted}"
}
func (c OriginalDeveloperSourceFactoryConfig) GoString() string { return c.String() }

type OriginalDeveloperSourceFactory struct {
	mu            sync.Mutex
	principal     *OriginalDeveloperHTTPAuthority
	control       *OriginalProjectControlRuntime
	publisher     *originalFactoryPublisher
	publication   *originalFactoryPublication
	firstCause    error
	closeSelected bool
	closeResult   error
}

func (*OriginalDeveloperSourceFactory) String() string {
	return "OriginalDeveloperSourceFactory{original partial owners retained}"
}
func (o *OriginalDeveloperSourceFactory) GoString() string { return o.String() }

// Keep nonnil owner even with error. The factory owns its acquired children;
// db remains the caller's property. No DDL, SDK fallback, trust callback,
// replacement authority or alternate endpoint is accepted.
func OpenOriginalDeveloperSourceFactory(ctx context.Context, db *sql.DB, c OriginalDeveloperSourceFactoryConfig) (*OriginalDeveloperSourceFactory, error) {
	if ctx == nil || ctx.Err() != nil || db == nil {
		return nil, ErrDenied
	}
	o := &OriginalDeveloperSourceFactory{}
	p, e := OpenOriginalDeveloperHTTPAuthority(c.Principal)
	o.principal = p
	if e != nil {
		o.firstCause = e
		return o, e
	}
	control, e := OpenOriginalProjectControlRuntime(ctx, db, c.Control)
	o.control = control
	if e != nil {
		o.firstCause = e
		return o, e
	}
	publisher, e := openOriginalFactoryPublisher(ctx, db, control, c.ProjectOriginalSource)
	o.publisher = publisher
	if e != nil {
		o.firstCause = e
		return o, e
	}
	if len(c.PublicationOriginalSource) != 0 {
		publication, e := openOriginalFactoryPublication(ctx, db, control, c.PublicationOriginalSource, c.PublicationNodeCodeIdentity)
		o.publication = publication
		if e != nil {
			o.firstCause = e
			return o, e
		}
	}
	return o, nil
}

func (o *OriginalDeveloperSourceFactory) usable() bool {
	return o != nil && !o.closeSelected && o.firstCause == nil && o.principal != nil && o.control != nil
}

func (o *OriginalDeveloperSourceFactory) AssertSourceCurrent(ctx context.Context) error {
	if o == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.usable() {
		return ErrUnknown
	}
	return o.control.AssertSourceCurrent(ctx)
}
func (o *OriginalDeveloperSourceFactory) CurrentExistingPrincipal(ctx context.Context, r *http.Request) (Principal, error) {
	if o == nil {
		return Principal{}, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.usable() {
		return Principal{}, ErrUnknown
	}
	if e := o.control.AssertSourceCurrent(ctx); e != nil {
		return Principal{}, e
	}
	p, e := o.principal.CurrentExistingPrincipal(ctx, r)
	if e != nil {
		return Principal{}, e
	}
	if e = o.control.AssertSourceCurrent(ctx); e != nil {
		return Principal{}, ErrUnknown
	}
	return p, nil
}
func (o *OriginalDeveloperSourceFactory) AssertPrincipalCurrent(ctx context.Context, p Principal) error {
	if o == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.usable() {
		return ErrUnknown
	}
	if e := o.control.AssertSourceCurrent(ctx); e != nil {
		return e
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return e
	}
	return o.control.AssertSourceCurrent(ctx)
}
func (o *OriginalDeveloperSourceFactory) AuthorizeProjectControl(ctx context.Context, p Principal, c Command, proof []byte) (Approval, error) {
	if o == nil {
		return Approval{}, ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.usable() {
		return Approval{}, ErrUnknown
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return Approval{}, e
	}
	a, e := o.control.AuthorizeProjectControl(ctx, p, c, proof)
	if e != nil {
		return a, e
	}
	if e = o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return Approval{}, ErrUnknown
	}
	return a, nil
}
func (o *OriginalDeveloperSourceFactory) AssertControlCurrent(ctx context.Context, p Principal, a Approval) error {
	if o == nil {
		return ErrDenied
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.usable() {
		return ErrUnknown
	}
	if e := o.principal.AssertPrincipalCurrent(ctx, p); e != nil {
		return e
	}
	if e := o.control.AssertControlCurrent(ctx, p, a); e != nil {
		return e
	}
	return o.principal.AssertPrincipalCurrent(ctx, p)
}

func (o *OriginalDeveloperSourceFactory) Close() error {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.closeSelected {
		return o.closeResult
	}
	o.closeSelected = true
	if o.publication != nil {
		o.closeResult = o.publication.close()
	}
	// Finish the child that owns bounded SDK/DB operations before retiring the
	// parent HTTP credentials. Attempt both; never hide the first close result.
	if o.publisher != nil {
		if e := o.publisher.close(); e != nil && o.closeResult == nil {
			o.closeResult = e
		}
	}
	if o.control != nil {
		if e := o.control.Close(); e != nil && o.closeResult == nil {
			o.closeResult = e
		}
	}
	if o.principal != nil {
		if e := o.principal.Close(); e != nil && o.closeResult == nil {
			o.closeResult = e
		}
	}
	if o.closeResult == nil && o.firstCause != nil {
		o.closeResult = ErrUnknown
	}
	return o.closeResult
}
