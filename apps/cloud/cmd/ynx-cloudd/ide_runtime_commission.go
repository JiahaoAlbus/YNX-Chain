package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"github.com/lib/pq"
)

var errIDECommissioning = errors.New("original IDE commissioning result unconfirmed; preserve selected capture and resolve only")

// A separate private management configuration, never accepted by HTTP or the
// normal Source startup. Admission/capture pins must be independently selected
// by their original custodians. This file is not an issuer, grant or migration.
type ideCommissionConfig struct {
	Startup            ideSourceStartupConfig
	Admission, Capture developerauthority.OriginalVerifierFile
}

func (ideCommissionConfig) String() string     { return "IDE commissioning configuration (redacted)" }
func (c ideCommissionConfig) GoString() string { return c.String() }
func (ideCommissionConfig) MarshalJSON() ([]byte, error) {
	return []byte(`{"protected":"redacted"}`), nil
}

func parseIDECommissionConfig(raw []byte) (ideCommissionConfig, error) {
	var c ideCommissionConfig
	if len(raw) == 0 || len(raw) > ideSourceConfigLimit || !utf8.Valid(raw) {
		return c, errIDEConfig
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	read := func(v any) func() error { return func() error { return d.Decode(v) } }
	pin := func(p *developerauthority.OriginalVerifierFile) error {
		return decodeIDEConfigObject(d, map[string]func() error{"path": read(&p.Path), "bytes": read(&p.Bytes), "sha256": read(&p.SHA256)})
	}
	var version string
	var source json.RawMessage
	e := decodeIDEConfigObject(d, map[string]func() error{
		"version": read(&version), "authSourceConfig": read(&source),
		"admission": func() error { return pin(&c.Admission) }, "capture": func() error { return pin(&c.Capture) },
	})
	if e != nil || version != "YNX-IDE-AUTH-COMMISSIONING-STARTUP/v1" {
		return ideCommissionConfig{}, errIDEConfig
	}
	if _, e = d.Token(); e != io.EOF {
		return ideCommissionConfig{}, errIDEConfig
	}
	c.Startup, e = parseIDESourceStartupConfig(source)
	if e != nil {
		return ideCommissionConfig{}, errIDEConfig
	}
	for _, p := range []developerauthority.OriginalVerifierFile{c.Admission, c.Capture} {
		if !filepath.IsAbs(p.Path) || filepath.Clean(p.Path) != p.Path || p.Path == "/" || strings.ContainsAny(p.Path, "\x00\r\n") || p.Bytes < 1 || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(p.SHA256) {
			return ideCommissionConfig{}, errIDEConfig
		}
	}
	if c.Admission.Bytes > 16384 || c.Capture.Bytes > 1048576 {
		return ideCommissionConfig{}, errIDEConfig
	}
	return c, nil
}

type ideCommissionManager interface {
	InstallSelectedCapture(context.Context, developerauthority.OriginalVerifierFile) (developerauthority.OriginalIDECommissioningReceipt, error)
	ResolveSelected(context.Context) (developerauthority.OriginalIDECommissioningReceipt, error)
	Close() error
}

type ideCommissionAttempt struct {
	db                                  *sql.DB // Owned here; the original Auth manager only borrows it.
	manager                             ideCommissionManager
	firstCause, closeCause, closeResult error
	once                                sync.Once
}

func (*ideCommissionAttempt) String() string     { return "IDE original commissioning attempt (redacted)" }
func (o *ideCommissionAttempt) GoString() string { return o.String() }
func (o *ideCommissionAttempt) Close() error {
	if o == nil {
		return nil
	}
	o.once.Do(func() {
		if !missingIDEValue(o.manager) {
			if e := o.manager.Close(); e != nil {
				o.closeCause = e
			}
		}
		if o.db != nil {
			if e := o.db.Close(); e != nil && o.closeCause == nil {
				o.closeCause = e
			}
		}
		if o.firstCause != nil || o.closeCause != nil {
			o.closeResult = errIDECommissioning
		}
	})
	return o.closeResult
}

func runIDECommissioning(ctx context.Context, file, action string) (developerauthority.OriginalIDECommissioningReceipt, error) {
	var empty developerauthority.OriginalIDECommissioningReceipt
	// There is deliberately no default write action and no action from ENV.
	if ctx == nil || ctx.Err() != nil || file == "" || (action != "install" && action != "resolve") {
		return empty, errIDECommissioning
	}
	raw, e := readIDEProtectedBytes(file, ideSourceConfigLimit)
	if e != nil {
		return empty, errIDECommissioning
	}
	c, e := parseIDECommissionConfig(raw)
	if e != nil {
		return empty, errIDECommissioning
	}
	r, owner, e := performIDECommissioning(ctx, c, action, func(c developerauthority.PostgresCatalogConfig) (*sql.DB, error) {
		connection, e := ideSourceAuthConnection(c)
		if e != nil {
			return nil, e
		}
		connector, e := pq.NewConnector(connection)
		if e != nil {
			return nil, errIDEConfig
		}
		return sql.OpenDB(connector), nil
	}, func(ctx context.Context, db *sql.DB, c ideCommissionConfig, action string) (ideCommissionManager, error) {
		cfg := developerauthority.OriginalIDECommissioningConfig{Source: c.Startup.Source, Admission: c.Admission}
		var owner *developerauthority.OriginalIDECommissioningOwner
		var e error
		if action == "resolve" {
			owner, e = developerauthority.OpenOriginalIDECommissioningRecovery(ctx, db, cfg, c.Capture)
		} else {
			owner, e = developerauthority.OpenOriginalIDECommissioning(ctx, db, cfg)
		}
		if owner == nil {
			return nil, e
		}
		return owner, e
	})
	if owner != nil {
		if closeErr := owner.Close(); e == nil && closeErr != nil {
			e = errIDECommissioning
		}
	}
	return r, e
}

// Private lifecycle seams, never a provider accepted by the command or HTTP.
// The production wrapper fixes lib/pq and the two original Auth constructors.
func performIDECommissioning(ctx context.Context, c ideCommissionConfig, action string, open func(developerauthority.PostgresCatalogConfig) (*sql.DB, error), construct func(context.Context, *sql.DB, ideCommissionConfig, string) (ideCommissionManager, error)) (developerauthority.OriginalIDECommissioningReceipt, *ideCommissionAttempt, error) {
	var empty developerauthority.OriginalIDECommissioningReceipt
	if ctx == nil || ctx.Err() != nil || (action != "install" && action != "resolve") || open == nil || construct == nil {
		return empty, nil, errIDECommissioning
	}
	if _, e := ideSourceAuthConnection(c.Startup.AuthPostgres); e != nil {
		return empty, nil, errIDECommissioning
	}
	bounded, cancel := context.WithTimeout(ctx, c.Startup.AuthPostgres.ConnectTimeout+30*time.Second)
	defer cancel()
	o := &ideCommissionAttempt{}
	fail := func(e error) (developerauthority.OriginalIDECommissioningReceipt, *ideCommissionAttempt, error) {
		o.firstCause = e
		return empty, o, errIDECommissioning
	}
	var e error
	o.db, e = open(c.Startup.AuthPostgres)
	if e != nil {
		return fail(e)
	}
	if o.db == nil {
		return fail(errIDECommissioning)
	}
	o.db.SetMaxOpenConns(c.Startup.AuthPostgres.MaxOpen)
	o.db.SetMaxIdleConns(c.Startup.AuthPostgres.MaxIdle)
	o.db.SetConnMaxIdleTime(c.Startup.AuthPostgres.MaxIdleTime)
	o.db.SetConnMaxLifetime(c.Startup.AuthPostgres.MaxLifetime)
	if e = o.db.PingContext(bounded); e != nil {
		return fail(e)
	}
	o.manager, e = construct(bounded, o.db, c, action)
	if e != nil {
		return fail(e)
	}
	if missingIDEValue(o.manager) || bounded.Err() != nil {
		return fail(errIDECommissioning)
	}
	var r developerauthority.OriginalIDECommissioningReceipt
	if action == "resolve" {
		r, e = o.manager.ResolveSelected(bounded)
	} else {
		r, e = o.manager.InstallSelectedCapture(bounded, c.Capture)
	}
	if e != nil {
		o.firstCause = e
		return r, o, errIDECommissioning
	}
	if bounded.Err() != nil {
		o.firstCause = bounded.Err()
		return r, o, errIDECommissioning
	}
	// A receipt is DATA about that import only, never permission to install a
	// Source or publish/deploy. UNKNOWN is never resolved by another write here.
	return r, o, nil
}
