package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
	"github.com/lib/pq"
)

var errIDESourceStartup = errors.New("original IDE publication Source startup unconfirmed")
var errIDESourceClose = errors.New("original IDE publication Source cleanup unconfirmed")

const ideSourceConfigLimit = 2 << 20

// Private operator configuration, NOT a signed statement or commissioning API.
// References must already be independently admitted by the original Root owner.
// Merely hashing a file, owning this config or passing it here grants nothing:
// the fixed Auth constructor still requires genuine captures/current/history.
type ideSourceStartupConfig struct {
	AuthPostgres developerauthority.PostgresCatalogConfig
	Source       developerauthority.OriginalIDEPublicationSourceConfig
}

func (ideSourceStartupConfig) String() string     { return "IDE Source startup configuration (redacted)" }
func (c ideSourceStartupConfig) GoString() string { return c.String() }
func (ideSourceStartupConfig) MarshalJSON() ([]byte, error) {
	return []byte(`{"protected":"redacted"}`), nil
}

func parseIDESourceStartupConfig(raw []byte) (ideSourceStartupConfig, error) {
	var c ideSourceStartupConfig
	if len(raw) == 0 || len(raw) > ideSourceConfigLimit || !utf8.Valid(raw) {
		return c, errIDEConfig
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	read := func(v any) func() error { return func() error { return d.Decode(v) } }
	pin := func(p *developerauthority.OriginalVerifierFile) error {
		return decodeIDEConfigObject(d, map[string]func() error{"path": read(&p.Path), "bytes": read(&p.Bytes), "sha256": read(&p.SHA256)})
	}
	var version string
	var connect, idle, lifetime int
	err := decodeIDEConfigObject(d, map[string]func() error{
		"version": read(&version),
		"authPostgres": func() error {
			return decodeIDEConfigObject(d, map[string]func() error{
				"connectionUrl": read(&c.AuthPostgres.ConnectionURL), "maxOpen": read(&c.AuthPostgres.MaxOpen), "maxIdle": read(&c.AuthPostgres.MaxIdle),
				"connectTimeoutSeconds": read(&connect), "maxIdleSeconds": read(&idle), "maxLifetimeSeconds": read(&lifetime),
			})
		},
		"source": func() error {
			return decodeIDEConfigObject(d, map[string]func() error{
				"release": func() error { return pin(&c.Source.Release) },
				"verifier": func() error {
					return decodeIDEConfigObject(d, map[string]func() error{
						"node":    func() error { return pin(&c.Source.Verifier.Node) },
						"sdkRoot": read(&c.Source.Verifier.SDKRoot),
						"sdkFiles": func() error {
							token, e := d.Token()
							if e != nil || token != json.Delim('[') {
								return errIDEConfig
							}
							for d.More() {
								if len(c.Source.Verifier.SDKFiles) >= 32768 {
									return errIDEConfig
								}
								var p developerauthority.OriginalVerifierFile
								if pin(&p) != nil {
									return errIDEConfig
								}
								c.Source.Verifier.SDKFiles = append(c.Source.Verifier.SDKFiles, p)
							}
							token, e = d.Token()
							if e != nil || token != json.Delim(']') {
								return errIDEConfig
							}
							return nil
						},
					})
				},
			})
		},
	})
	if err != nil || version != "YNX-IDE-AUTH-SOURCE-STARTUP/v1" {
		return ideSourceStartupConfig{}, errIDEConfig
	}
	if _, err = d.Token(); err != io.EOF {
		return ideSourceStartupConfig{}, errIDEConfig
	}
	c.AuthPostgres.ConnectTimeout = time.Duration(connect) * time.Second
	c.AuthPostgres.MaxIdleTime = time.Duration(idle) * time.Second
	c.AuthPostgres.MaxLifetime = time.Duration(lifetime) * time.Second
	if _, err = ideSourceAuthConnection(c.AuthPostgres); err != nil {
		return ideSourceStartupConfig{}, errIDEConfig
	}
	abs := func(p string) bool {
		return filepath.IsAbs(p) && filepath.Clean(p) == p && p != "/" && !strings.ContainsAny(p, "\x00\r\n")
	}
	if !abs(c.Source.Release.Path) || !abs(c.Source.Verifier.Node.Path) || !abs(c.Source.Verifier.SDKRoot) || len(c.Source.Verifier.SDKFiles) == 0 {
		return ideSourceStartupConfig{}, errIDEConfig
	}
	for _, p := range append([]developerauthority.OriginalVerifierFile{c.Source.Release, c.Source.Verifier.Node}, c.Source.Verifier.SDKFiles...) {
		if p.Bytes < 1 || !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(p.SHA256) {
			return ideSourceStartupConfig{}, errIDEConfig
		}
	}
	seen := make(map[string]bool)
	for _, p := range c.Source.Verifier.SDKFiles {
		if p.Path == "" || p.Path == "." || p.Path == ".." || filepath.IsAbs(p.Path) || strings.HasPrefix(p.Path, "../") || filepath.ToSlash(filepath.Clean(p.Path)) != p.Path || strings.ContainsAny(p.Path, "\\\x00\r\n") || seen[p.Path] {
			return ideSourceStartupConfig{}, errIDEConfig
		}
		seen[p.Path] = true
	}
	return c, nil
}

// Fixed lib/pq connector only. This opens a bounded pool to an EXISTING Auth
// database; it never creates a database/user/schema or imports capture rows.
func ideSourceAuthConnection(c developerauthority.PostgresCatalogConfig) (string, error) {
	if c.MaxOpen < 1 || c.MaxOpen > 64 || c.MaxIdle < 0 || c.MaxIdle > c.MaxOpen || c.ConnectTimeout < time.Second || c.ConnectTimeout > 30*time.Second || c.MaxIdleTime < time.Second || c.MaxIdleTime > time.Hour || c.MaxLifetime < c.MaxIdleTime || c.MaxLifetime > 24*time.Hour {
		return "", errIDEConfig
	}
	u, e := url.Parse(c.ConnectionURL)
	if e != nil || u == nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || u.User == nil || u.User.Username() == "" || u.Fragment != "" || u.Opaque != "" || u.RawPath != "" || !strings.HasPrefix(u.Path, "/") || len(u.Path) < 2 || strings.Contains(u.Path[1:], "/") {
		return "", errIDEConfig
	}
	password, present := u.User.Password()
	port, e := strconv.Atoi(u.Port())
	if e != nil || port < 1 || port > 65535 || !present || password == "" {
		return "", errIDEConfig
	}
	q, e := url.ParseQuery(u.RawQuery)
	if e != nil {
		return "", errIDEConfig
	}
	for k, v := range q {
		if len(v) != 1 || (k != "sslmode" && k != "sslrootcert") {
			return "", errIDEConfig
		}
	}
	if q.Get("sslmode") != "verify-full" {
		return "", errIDEConfig
	}
	q.Set("options", "")
	q.Set("application_name", "ynx-auth-ide-publication-source")
	q.Set("connect_timeout", strconv.Itoa(int((c.ConnectTimeout+time.Second-1)/time.Second)))
	u.RawQuery = q.Encode()
	return u.String(), nil
}

type idePublicationSource interface {
	developerauthority.OriginalSource
	developerauthority.OriginalPublicationSource
	developerauthority.OriginalPublicationSelector
	Close() error
}

type ideSourceStartupOwner struct {
	db                      *sql.DB // This outer startup owns this pool; the Auth Source only borrows it.
	source                  idePublicationSource
	once                    sync.Once
	firstCause, closeResult error
}

func (*ideSourceStartupOwner) String() string     { return "IDE Source startup owner (redacted)" }
func (o *ideSourceStartupOwner) GoString() string { return o.String() }
func (o *ideSourceStartupOwner) Close() error {
	if o == nil {
		return nil
	}
	o.once.Do(func() {
		// Stop/join the Source before releasing our pool. Catalog/HTTP owners
		// are drained first by normal main; borrowed external Sources are not ours.
		if !missingIDEValue(o.source) && o.source.Close() != nil {
			o.closeResult = errIDESourceClose
		}
		if o.db != nil && o.db.Close() != nil {
			o.closeResult = errIDESourceClose
		}
		if o.firstCause != nil {
			o.closeResult = errIDESourceClose
		}
	})
	return o.closeResult
}

func openIDEPublicationSourceStartup(ctx context.Context, c ideSourceStartupConfig) (*ideSourceStartupOwner, error) {
	return openIDEPublicationSource(ctx, c, func(c developerauthority.PostgresCatalogConfig) (*sql.DB, error) {
		connection, e := ideSourceAuthConnection(c)
		if e != nil {
			return nil, e
		}
		connector, e := pq.NewConnector(connection)
		if e != nil {
			return nil, errIDEConfig
		}
		return sql.OpenDB(connector), nil
	}, func(ctx context.Context, db *sql.DB, cfg developerauthority.OriginalIDEPublicationSourceConfig) (idePublicationSource, error) {
		source, e := developerauthority.OpenOriginalIDEPublicationSource(ctx, db, cfg)
		if source == nil {
			return nil, e
		}
		return source, e
	})
}

// Private lifecycle test seams only. The normal entry above fixes both openers.
func openIDEPublicationSource(ctx context.Context, c ideSourceStartupConfig, open func(developerauthority.PostgresCatalogConfig) (*sql.DB, error), construct func(context.Context, *sql.DB, developerauthority.OriginalIDEPublicationSourceConfig) (idePublicationSource, error)) (*ideSourceStartupOwner, error) {
	if ctx == nil || ctx.Err() != nil || open == nil || construct == nil {
		return nil, errIDESourceStartup
	}
	if _, e := ideSourceAuthConnection(c.AuthPostgres); e != nil {
		return nil, errIDESourceStartup
	}
	bounded, cancel := context.WithTimeout(ctx, c.AuthPostgres.ConnectTimeout+10*time.Second)
	defer cancel()
	o := &ideSourceStartupOwner{}
	fail := func(e error) (*ideSourceStartupOwner, error) {
		o.firstCause = e
		_ = o.Close()
		return o, errIDESourceStartup
	}
	var e error
	o.db, e = open(c.AuthPostgres)
	if e != nil {
		return fail(e)
	}
	if o.db == nil {
		return fail(errIDESourceStartup)
	}
	o.db.SetMaxOpenConns(c.AuthPostgres.MaxOpen)
	o.db.SetMaxIdleConns(c.AuthPostgres.MaxIdle)
	o.db.SetConnMaxIdleTime(c.AuthPostgres.MaxIdleTime)
	o.db.SetConnMaxLifetime(c.AuthPostgres.MaxLifetime)
	if e = o.db.PingContext(bounded); e != nil {
		return fail(e)
	}
	o.source, e = construct(bounded, o.db, c.Source)
	if e != nil {
		return fail(e)
	}
	if missingIDEValue(o.source) || bounded.Err() != nil {
		return fail(errIDESourceStartup)
	}
	return o, nil
}

func prepareOriginalIDEDeploymentStartup(ctx context.Context, sourceFile, runtimeFile string, original *ideDeploymentStartupInputs) (*ideDeploymentStartupInputs, *ideSourceStartupOwner, error) {
	if sourceFile == "" {
		inputs, e := resolveIDEDeploymentStartup(ctx, runtimeFile, original)
		return inputs, nil, e
	}
	// Never replace an existing Source or silently select another identity.
	if ctx == nil || ctx.Err() != nil || original != nil || runtimeFile == "" {
		return nil, nil, errIDESourceStartup
	}
	raw, e := readIDEProtectedBytes(sourceFile, ideSourceConfigLimit)
	if e != nil {
		return nil, nil, errIDEConfig
	}
	c, e := parseIDESourceStartupConfig(raw)
	if e != nil {
		return nil, nil, errIDEConfig
	}
	owner, e := openIDEPublicationSourceStartup(ctx, c)
	if e != nil {
		return nil, owner, e
	}
	inputs, e := resolveIDEDeploymentStartup(ctx, runtimeFile, &ideDeploymentStartupInputs{Source: owner.source})
	if e != nil {
		owner.firstCause = e
		_ = owner.Close()
		return nil, owner, errIDESourceStartup
	}
	return inputs, owner, nil
}
