package cloud

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// PUBLIC OCI responses exercise the real consumer and real durable journal.
// These tests do not provide authority, containers or deployment acceptance.
func TestIDEDeploymentPinnedContainerRefusesReplacement(t *testing.T) {
	for _, method := range []string{"status", "logs", "http"} {
		t.Run(method, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			op := m.operation()
			op.DeploymentID = m.row.ID
			m.row.ID = strings.Repeat("e", 64)
			m.row.State.Running = true
			m.row.State.Status = "running"
			effects := 0
			base := m.e.run
			m.e.run = func(ctx context.Context, args ...string) ([]byte, error) {
				if args[0] != "inspect" {
					effects++
				}
				return base(ctx, args...)
			}
			m.e.input = func(context.Context, []byte, ...string) ([]byte, error) {
				effects++
				return []byte("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"), nil
			}
			var err error
			switch method {
			case "status":
				_, err = m.e.ObserveOriginal(context.Background(), op)
			case "logs":
				_, err = m.e.Logs(context.Background(), op, 64<<10)
			case "http":
				m.e.cfg.RuntimeOrigin = "https://runtime.public.invalid"
				m.e.cfg.HTTPPort = 8080
				response, e := m.e.RoundTripProject(context.Background(), op, &http.Request{Method: "GET", URL: &url.URL{Path: "/"}, Header: make(http.Header)})
				err = e
				if response != nil {
					response.Body.Close()
				}
			}
			if err == nil || effects != 0 {
				t.Fatalf("replacement admitted: method=%s error=%v effects=%d", method, err, effects)
			}
		})
	}
}

func TestIDEDeploymentEffectsUseInspectedContainerID(t *testing.T) {
	for _, method := range []string{"start", "logs", "http"} {
		t.Run(method, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			id := m.row.ID
			effects := 0
			base := m.e.run
			m.e.run = func(ctx context.Context, args ...string) ([]byte, error) {
				if args[0] == "start" || args[0] == "logs" {
					effects++
					if args[len(args)-1] != id {
						return nil, errors.New("PUBLIC mutable container name used after inspection")
					}
				}
				return base(ctx, args...)
			}
			op := m.operation()
			op.DeploymentID = id
			var err error
			switch method {
			case "start":
				_, err = m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil })
			case "logs":
				_, err = m.e.Logs(context.Background(), op, 64<<10)
			case "http":
				m.row.State.Running = true
				m.row.State.Status = "running"
				m.e.cfg.RuntimeOrigin = "https://runtime.public.invalid"
				m.e.cfg.HTTPPort = 8080
				m.e.input = func(_ context.Context, _ []byte, args ...string) ([]byte, error) {
					effects++
					if len(args) < 3 || args[2] != id {
						return nil, errors.New("PUBLIC runtime bridge used a mutable name")
					}
					return []byte("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"), nil
				}
				response, e := m.e.RoundTripProject(context.Background(), op, &http.Request{Method: "GET", URL: &url.URL{Path: "/"}, Header: make(http.Header)})
				err = e
				if response != nil {
					response.Body.Close()
				}
			}
			if err != nil || effects != 1 {
				t.Fatalf("not bound to inspected instance: %v effects=%d", err, effects)
			}
		})
	}
}

func TestIDEDeploymentRestartCannotReplaceConfirmedInstance(t *testing.T) {
	root := filepath.Join(t.TempDir(), "private-journal")
	j, err := newIDEDeploymentJournal(root)
	if err != nil {
		t.Fatal(err)
	}
	input := ideOperationInput(t)
	op, _, err := j.begin("PUBLIC_ACTOR", input)
	if err != nil {
		t.Fatal(err)
	}
	op.State = "running"
	op.DeploymentID = strings.Repeat("b", 64)
	op.RuntimeURL = "https://public.invalid/runtime"
	op.UpdatedAt = time.Now().UTC()
	if err = j.recordTerminal("PUBLIC_ACTOR", op, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	reopened, err := newIDEDeploymentJournal(root)
	if err != nil {
		t.Fatal(err)
	}
	replacement := op
	replacement.State = "completed"
	replacement.DeploymentID = strings.Repeat("e", 64)
	replacement.UpdatedAt = time.Now().UTC()
	gateCalls := 0
	err = reopened.recordTerminal("PUBLIC_ACTOR", replacement, func() error { gateCalls++; return nil })
	if !errors.Is(err, ErrIDEDeploymentConflict) || gateCalls != 0 {
		t.Fatalf("confirmed instance overwritten after restart: %v gate=%d", err, gateCalls)
	}
	retained, err := reopened.lookup("PUBLIC_ACTOR", op.RequestID)
	if err != nil || retained.State != "running" || retained.DeploymentID != op.DeploymentID {
		t.Fatal("original observation lost")
	}
	if _, claim, err := reopened.begin("PUBLIC_ACTOR", input); err != nil || claim {
		t.Fatal("replacement enabled replay")
	}
	replacement.DeploymentID = op.DeploymentID
	if err = reopened.recordTerminal("PUBLIC_ACTOR", replacement, func() error { return nil }); err != nil {
		t.Fatal(err)
	}
}
