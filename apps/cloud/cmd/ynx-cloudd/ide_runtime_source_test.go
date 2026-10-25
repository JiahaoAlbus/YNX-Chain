package main

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// PUBLIC lifecycle/config boundaries only; not a Root, SQL server or grant.
func publicIDESourceConfig(t *testing.T) ideSourceStartupConfig {
	t.Helper()
	raw := `{"version":"YNX-IDE-AUTH-SOURCE-STARTUP/v1","authPostgres":{"connectionUrl":"postgres://public:PUBLIC_SECRET@public.invalid:5432/auth?sslmode=verify-full","maxOpen":2,"maxIdle":1,"connectTimeoutSeconds":2,"maxIdleSeconds":60,"maxLifetimeSeconds":120},"source":{"release":{"path":"/PUBLIC/release","bytes":1,"sha256":"DIGEST"},"verifier":{"node":{"path":"/PUBLIC/node","bytes":1,"sha256":"DIGEST"},"sdkRoot":"/PUBLIC/sdk","sdkFiles":[{"path":"native/original-auth-identity-source-verifier.mjs","bytes":1,"sha256":"DIGEST"}]}}}`
	c, e := parseIDESourceStartupConfig([]byte(strings.ReplaceAll(raw, "DIGEST", strings.Repeat("a", 64))))
	if e != nil {
		t.Fatal(e)
	}
	return c
}

type publicIDESourceConnector struct {
	events  *[]string
	pingErr error
}
type publicIDESourceDriver struct{}
type publicIDESourceConn struct {
	events  *[]string
	pingErr error
}

func (c publicIDESourceConnector) Driver() driver.Driver { return publicIDESourceDriver{} }
func (c publicIDESourceConnector) Connect(context.Context) (driver.Conn, error) {
	return &publicIDESourceConn{c.events, c.pingErr}, nil
}
func (publicIDESourceDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("PUBLIC no driver fallback")
}
func (c *publicIDESourceConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("PUBLIC no statements")
}
func (c *publicIDESourceConn) Begin() (driver.Tx, error) {
	return nil, errors.New("PUBLIC no transactions")
}
func (c *publicIDESourceConn) Ping(context.Context) error { return c.pingErr }
func (c *publicIDESourceConn) Close() error               { *c.events = append(*c.events, "pool"); return nil }

type publicIDEPublicationSource struct {
	publicIDEConfigSource
	events   *[]string
	closes   int
	closeErr error
}

func (s *publicIDEPublicationSource) Close() error {
	s.closes++
	*s.events = append(*s.events, "source")
	return s.closeErr
}

func TestIDERuntimeSourceConstructorPartialAndCleanupAreOwned(t *testing.T) {
	for _, mode := range []string{"ready", "open-partial", "open-empty-error", "empty-pool", "ping", "source-partial", "nil-source", "cancel-after-source", "close-unknown"} {
		t.Run(mode, func(t *testing.T) {
			var events []string
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			source := &publicIDEPublicationSource{events: &events}
			openCause := errors.New("PUBLIC_SECRET original pool-open cause")
			if mode == "close-unknown" {
				source.closeErr = errors.New("PUBLIC_SECRET close")
			}
			constructed := 0
			owner, e := openIDEPublicationSource(ctx, publicIDESourceConfig(t), func(developerauthority.PostgresCatalogConfig) (*sql.DB, error) {
				if mode == "open-empty-error" {
					return nil, openCause
				}
				if mode == "empty-pool" {
					return nil, nil
				}
				var ping error
				if mode == "ping" {
					ping = errors.New("PUBLIC_SECRET ping")
				}
				db := sql.OpenDB(publicIDESourceConnector{&events, ping})
				if mode == "open-partial" {
					return db, openCause
				}
				return db, nil
			}, func(context.Context, *sql.DB, developerauthority.OriginalIDEPublicationSourceConfig) (idePublicationSource, error) {
				constructed++
				if mode == "source-partial" {
					return source, errors.New("PUBLIC_SECRET constructor")
				}
				if mode == "nil-source" {
					return (*publicIDEPublicationSource)(nil), nil
				}
				if mode == "cancel-after-source" {
					cancel()
				}
				return source, nil
			})
			if owner == nil {
				t.Fatal("original partial discarded")
			}
			success := mode == "ready" || mode == "close-unknown"
			if (e == nil) != success {
				t.Fatal("wrong admission", e)
			}
			if e != nil && strings.Contains(e.Error(), "PUBLIC_SECRET") {
				t.Fatal("private cause leaked")
			}
			if (mode == "open-partial" || mode == "open-empty-error" || mode == "empty-pool" || mode == "ping") && constructed != 0 {
				t.Fatal("failed pool reached Source constructor")
			}
			if (mode == "open-partial" || mode == "open-empty-error") && owner.firstCause != openCause {
				t.Fatal("private original pool-open first cause replaced")
			}
			if success && len(events) != 0 {
				t.Fatal("ready children closed before normal drain")
			}
			first := owner.Close()
			for i := 0; i < 2; i++ {
				if owner.Close() != first {
					t.Fatal("close result changed")
				}
			}
			if !success && first != errIDESourceClose {
				t.Fatal("failed open lost sticky cleanup state")
			}
			if source.closes > 1 {
				t.Fatal("Source closed repeatedly")
			}
			if constructed > 0 && mode != "nil-source" && !reflect.DeepEqual(events, []string{"source", "pool"}) {
				t.Fatal("Source not joined before its owned pool", events)
			}
		})
	}
}

func TestIDERuntimeSourceConfigurationCannotInventCommissioningOrFallback(t *testing.T) {
	c := publicIDESourceConfig(t)
	encoded, e := json.Marshal(c)
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{fmt.Sprint(c), fmt.Sprintf("%#v", c), string(encoded)} {
		if strings.Contains(s, "PUBLIC_SECRET") || strings.Contains(s, "postgres://") {
			t.Fatal("configuration leaked")
		}
	}
	for _, connection := range []string{strings.Replace(c.AuthPostgres.ConnectionURL, "verify-full", "disable", 1), c.AuthPostgres.ConnectionURL + "&sslmode=verify-full", c.AuthPostgres.ConnectionURL + "&options=PUBLIC"} {
		bad := c.AuthPostgres
		bad.ConnectionURL = connection
		if _, e := ideSourceAuthConnection(bad); e == nil {
			t.Fatal("insecure/ambiguous pool admitted")
		}
	}
	for _, raw := range []string{`null`, `{"version":"YNX-IDE-AUTH-SOURCE-STARTUP/v1","version":"YNX-IDE-AUTH-SOURCE-STARTUP/v1"}`, strings.Repeat("X", ideSourceConfigLimit+1)} {
		if _, e := parseIDESourceStartupConfig([]byte(raw)); e == nil {
			t.Fatal("ambiguous configuration admitted")
		}
	}
	for _, original := range []*ideDeploymentStartupInputs{nil, {Source: &publicIDEConfigSource{}}} {
		in, owner, e := prepareOriginalIDEDeploymentStartup(context.Background(), "/PUBLIC/missing", "", original)
		if in != nil || owner != nil || e == nil {
			t.Fatal("Source-only or replacement fallback admitted")
		}
	}
	in, owner, e := prepareOriginalIDEDeploymentStartup(context.Background(), "", "", nil)
	if in != nil || owner != nil || e != nil {
		t.Fatal("unconfigured normal service changed")
	}
}
