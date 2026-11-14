package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// PUBLIC configuration and adapter lifecycle only. No actual import/Root/PG.
func publicIDECommissionRaw(t *testing.T) []byte {
	t.Helper()
	c := publicIDESourceConfig(t)
	pin := func(p developerauthority.OriginalVerifierFile) map[string]any {
		return map[string]any{"path": p.Path, "bytes": p.Bytes, "sha256": p.SHA256}
	}
	files := []any{}
	for _, p := range c.Source.Verifier.SDKFiles {
		files = append(files, pin(p))
	}
	pg := c.AuthPostgres
	inner := map[string]any{"version": "YNX-IDE-AUTH-SOURCE-STARTUP/v1", "authPostgres": map[string]any{"connectionUrl": pg.ConnectionURL, "maxOpen": pg.MaxOpen, "maxIdle": pg.MaxIdle, "connectTimeoutSeconds": int(pg.ConnectTimeout.Seconds()), "maxIdleSeconds": int(pg.MaxIdleTime.Seconds()), "maxLifetimeSeconds": int(pg.MaxLifetime.Seconds())}, "source": map[string]any{"release": pin(c.Source.Release), "verifier": map[string]any{"node": pin(c.Source.Verifier.Node), "sdkRoot": c.Source.Verifier.SDKRoot, "sdkFiles": files}}}
	raw, e := json.Marshal(map[string]any{"version": "YNX-IDE-AUTH-COMMISSIONING-STARTUP/v1", "authSourceConfig": inner, "admission": pin(c.Source.Release), "capture": pin(c.Source.Release)})
	if e != nil {
		t.Fatal(e)
	}
	return raw
}

type publicIDECommissionManager struct {
	events                     *[]string
	installs, resolves, closes int
	installErr, closeErr       error
}

func (o *publicIDECommissionManager) InstallSelectedCapture(context.Context, developerauthority.OriginalVerifierFile) (developerauthority.OriginalIDECommissioningReceipt, error) {
	o.installs++
	if o.installErr != nil {
		return developerauthority.OriginalIDECommissioningReceipt{}, o.installErr
	}
	return developerauthority.OriginalIDECommissioningReceipt{CaptureSHA256: strings.Repeat("a", 64), Committed: true}, nil
}
func (o *publicIDECommissionManager) ResolveSelected(context.Context) (developerauthority.OriginalIDECommissioningReceipt, error) {
	o.resolves++
	return developerauthority.OriginalIDECommissioningReceipt{CaptureSHA256: strings.Repeat("a", 64), Committed: true}, nil
}
func (o *publicIDECommissionManager) Close() error {
	o.closes++
	*o.events = append(*o.events, "manager")
	return o.closeErr
}

func TestIDERuntimeCommissioningExplicitActionAndConfigNoFallback(t *testing.T) {
	raw := publicIDECommissionRaw(t)
	c, e := parseIDECommissionConfig(raw)
	if e != nil {
		t.Fatal(e)
	}
	for _, s := range []string{fmt.Sprint(c), fmt.Sprintf("%#v", c)} {
		if strings.Contains(s, "PUBLIC_SECRET") {
			t.Fatal("config leaked")
		}
	}
	for _, bad := range [][]byte{[]byte(`null`), append(append([]byte{}, raw...), []byte(` {}`)...), []byte(strings.Replace(string(raw), `"capture":`, `"capture":{},"capture":`, 1)), []byte(strings.Replace(string(raw), `"bytes":1`, `"bytes":0`, 1))} {
		if _, e := parseIDECommissionConfig(bad); e == nil {
			t.Fatal("ambiguous/unpinned config accepted")
		}
	}
	for _, action := range []string{"", "retry", "install-again"} {
		if r, e := runIDECommissioning(context.Background(), "/PUBLIC/missing", action); e == nil || r.Committed {
			t.Fatal("implicit write action")
		}
	}
	file := publicIDEConfigFile(t, raw)
	held, e := readIDEProtectedBytes(file, ideSourceConfigLimit)
	if e != nil || !reflect.DeepEqual(held, raw) {
		t.Fatal("protected command config", e)
	}
}

func TestIDERuntimeCommissioningOnlySelectedActionAndPartialCleanup(t *testing.T) {
	for _, mode := range []string{"install", "resolve", "unknown", "partial", "open-error", "nil-manager", "close-unknown"} {
		t.Run(mode, func(t *testing.T) {
			c, e := parseIDECommissionConfig(publicIDECommissionRaw(t))
			if e != nil {
				t.Fatal(e)
			}
			var events []string
			m := &publicIDECommissionManager{events: &events}
			original := errors.New("PUBLIC_SECRET original cause")
			if mode == "unknown" {
				m.installErr = original
			}
			if mode == "close-unknown" {
				m.closeErr = original
			}
			action := "install"
			if mode == "resolve" {
				action = "resolve"
			}
			r, owner, e := performIDECommissioning(context.Background(), c, action, func(developerauthority.PostgresCatalogConfig) (*sql.DB, error) {
				db := sql.OpenDB(publicIDESourceConnector{events: &events})
				if mode == "open-error" {
					return db, original
				}
				return db, nil
			}, func(_ context.Context, _ *sql.DB, _ ideCommissionConfig, got string) (ideCommissionManager, error) {
				if got != action {
					t.Fatal("constructor action changed")
				}
				if mode == "partial" {
					return m, original
				}
				if mode == "nil-manager" {
					return (*publicIDECommissionManager)(nil), nil
				}
				return m, nil
			})
			if owner == nil {
				t.Fatal("partial attempt lost")
			}
			if mode == "unknown" || mode == "partial" || mode == "open-error" {
				if e != errIDECommissioning || owner.firstCause != original {
					t.Fatal("first cause replaced")
				}
			}
			if mode == "unknown" && (m.installs != 1 || m.resolves != 0 || r.Committed) {
				t.Fatal("UNKNOWN retried/reconciled into success")
			}
			if mode == "resolve" && (m.installs != 0 || m.resolves != 1 || !r.Committed) {
				t.Fatal("cold DATA recovery wrote")
			}
			if mode == "install" && (e != nil || m.installs != 1 || m.resolves != 0 || !r.Committed) {
				t.Fatal("normal once mapping")
			}
			if (mode == "partial" || mode == "nil-manager") && (m.installs != 0 || m.resolves != 0) {
				t.Fatal("failed manager used")
			}
			first := owner.Close()
			if owner.Close() != first || m.closes > 1 {
				t.Fatal("cleanup not sticky/once")
			}
			if mode != "open-error" && mode != "nil-manager" && !reflect.DeepEqual(events, []string{"manager", "pool"}) {
				t.Fatal("manager not drained before own pool", events)
			}
			if mode == "close-unknown" && first != errIDECommissioning {
				t.Fatal("cleanup UNKNOWN cleared")
			}
		})
	}
}
