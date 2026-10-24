package developerauthority

import (
	"context"
	"testing"
	"time"
)

func TestApprovalDeliveryConcurrentRevocationRetainsTerminalOriginal(t *testing.T) {
	db, state, config := newApprovalFixture(t)
	o := openApprovalFixture(t, db, config)
	w := setupSignedApproval(t, o)
	q, e := o.reserveQuery(context.Background(), w.scope.ref, nonce(22))
	if e != nil {
		t.Fatal(e)
	}
	if e = o.selectQuerySigning(context.Background(), q); e != nil {
		t.Fatal(e)
	}
	state.afterWrite = func() {
		key := config.source + "/" + config.instance + "/" + w.scope.ref
		r := state.records[key]
		r.w.sequence++
		r.w.decision = "revoked"
		r.w.stateSHA256 = r.w.digest()
		state.records[key] = r
	}
	if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-terminal-original")); e != ErrUnknown || o.phase != "QUERY_DELIVERY_POST_CURRENT" {
		t.Fatal(e, o.phase)
	}
	if string(q.envelopeOriginal) != "PUBLIC-terminal-original" || q.phase != "terminal" || !o.pending[q] {
		t.Fatal("terminal custody lost")
	}
	if e = o.Close(); e != nil {
		t.Fatal(e)
	}
}

func TestApprovalDeliveryCompletionThenClockOrHeadChangeCannotEscape(t *testing.T) {
	for _, mode := range []string{"clock", "head", "context", "unchanged"} {
		t.Run(mode, func(t *testing.T) {
			db, state, config := newApprovalFixture(t)
			o := openApprovalFixture(t, db, config)
			w := setupSignedApproval(t, o)
			q, e := o.reserveQuery(context.Background(), w.scope.ref, nonce(23))
			if e != nil {
				t.Fatal(e)
			}
			if e = o.selectQuerySigning(context.Background(), q); e != nil {
				t.Fatal(e)
			}
			if e = o.completeQuery(context.Background(), q, []byte("PUBLIC-retained")); e != nil {
				t.Fatal(e)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			switch mode {
			case "clock":
				o.now = func() time.Time { return time.UnixMilli(31000) }
			case "context":
				cancel()
			case "head":
				state.mu.Lock()
				key := config.source + "/" + config.instance + "/" + w.scope.ref
				r := state.records[key]
				r.w.sequence++
				r.w.stateSHA256 = r.w.digest()
				state.records[key] = r
				state.mu.Unlock()
			}
			e = o.assertCompletedCurrent(ctx, q)
			if mode == "unchanged" {
				if e != nil {
					t.Fatal(e)
				}
			} else if e != ErrUnknown {
				t.Fatal("delivery accepted changed current", e)
			}
			if string(q.envelopeOriginal) != "PUBLIC-retained" {
				t.Fatal("lost original")
			}
		})
	}
}
