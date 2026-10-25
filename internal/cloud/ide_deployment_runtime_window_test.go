package cloud

import (
	"bytes"
	"context"
	"errors"
	"testing"
	"time"
)

// PUBLIC OCI responses with a controllable elapsed clock; no actual container
// or authority is supplied. The real execution/receipt fences are exercised.
func TestIDEDeploymentRuntimeWindowIncludesStopGraceAfterLatency(t *testing.T) {
	for _, scenario := range []struct {
		name        string
		after       string
		remaining   time.Duration
		wantCreates int
	}{
		{"before-create", "image", 29 * time.Second, 0},
		{"before-start", "create", 10 * time.Second, 1},
		{"stop-grace", "create", 29 * time.Second, 1},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			m := publicIDEOCIFixture(t)
			now := time.Now()
			m.e.now = func() time.Time { return now }
			base := m.e.run
			m.e.run = func(c context.Context, args ...string) ([]byte, error) {
				body, err := base(c, args...)
				if args[0] == scenario.after {
					now = m.p.ExpiresAt.Add(-scenario.remaining)
				}
				return body, err
			}
			_, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil })
			if !errors.Is(err, ErrDenied) || m.creates != scenario.wantCreates || m.starts != 0 {
				t.Fatalf("stale runtime window admitted: err=%v create=%d start=%d", err, m.creates, m.starts)
			}
			if scenario.wantCreates == 1 && createdRecordedID(t, createdReceiptPath(m)) != m.row.ID {
				t.Fatal("acknowledged original ID lost on remaining-budget refusal")
			}
			if _, err = m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil }); err == nil || m.creates != scenario.wantCreates || m.starts != 0 {
				t.Fatal("refused original deployment replayed")
			}
		})
	}
}
func TestIDEDeploymentRuntimeWindowExactBoundRemainsUsable(t *testing.T) {
	m := publicIDEOCIFixture(t)
	now := time.Now()
	m.e.now = func() time.Time { return now }
	base := m.e.run
	m.e.run = func(c context.Context, args ...string) ([]byte, error) {
		body, err := base(c, args...)
		if args[0] == "image" {
			now = m.p.ExpiresAt.Add(-30 * time.Second)
		}
		return body, err
	}
	result, err := m.e.ApplyExisting(context.Background(), m.p, bytes.NewReader(m.body), func() error { return nil })
	if err != nil || result.State != "running" || m.creates != 1 || m.starts != 1 {
		t.Fatalf("valid bounded runtime refused: %#v %v", result, err)
	}
}
