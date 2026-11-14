//go:build darwin || linux

package grantruntime

import (
	"context"
	"crypto/sha3"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
	policy "ynx.local/authgrantpolicy"
)

func TestDynamicOriginalModelDisclosure(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := os.MkdirTemp(home, ".ynx-public-disclosure-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for _, name := range []string{"projection", "round1", "round2", "duplicate"} {
			_ = os.Remove(filepath.Join(dir, name))
		}
		_ = os.Remove(dir)
	})
	put := func(name string, v any) protectedRef {
		raw, e := json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
		path := filepath.Join(dir, name)
		if e = os.WriteFile(path, raw, 0600); e != nil {
			t.Fatal(e)
		}
		return protectedRef{Path: path, SHA256: digest(raw), Bytes: int64(len(raw))}
	}
	const endpoint = "https://model.example.invalid/v1/chat/completions"
	holder := policy.Ref{Realm: "PUBLIC-realm", Tenant: "PUBLIC-tenant", ID: "PUBLIC-device"}
	b := policy.TaskEffectBinding{Realm: holder.Realm, Tenant: holder.Tenant, Account: "PUBLIC-account", Task: policy.Ref{ID: "PUBLIC-task"}, SessionID: "PUBLIC-session", Holder: holder, HolderEpoch: "1"}
	expiry := strconv.FormatInt(time.Now().Add(time.Hour).UnixMilli(), 10)
	grant := policy.GrantState{ID: "PUBLIC-grant", Revision: "1", Status: "active", Expires: expiry, Binding: b}
	snapshot := policy.Snapshot{Version: policy.SourceVersion{Authority: "PUBLIC-authority"}, Grant: grant, Expires: expiry, Holder: policy.PrincipalState{Status: "active"}, Session: policy.SessionState{Status: "active"}}
	projection := authorityProjection{Version: "AUTH-ORIGINAL-GRANT-PROJECTION/private-v1", ChainID: make([]byte, 32), Snapshot: snapshot}
	row := releaseSelection{Projection: put("projection", projection), Authority: "PUBLIC-authority", Realm: b.Realm, Tenant: b.Tenant}
	q1 := ModelDisclosureRequest{Account: b.Account, TaskID: b.Task.ID, SessionID: b.SessionID, URL: endpoint, Model: "PUBLIC-model", Body: []byte(`{"messages":[{"role":"user","content":"first"}]}`)}
	q2 := q1
	q2.Body = []byte(`{"messages":[{"role":"user","content":"first"},{"role":"tool","content":"receipt"}]}`)
	permit := func(q ModelDisclosureRequest) modelDisclosure {
		a, b2 := sha3.Sum512(q.Body), sha512.Sum512(q.Body)
		return modelDisclosure{Account: q.Account, TaskID: q.TaskID, SessionID: q.SessionID, URL: q.URL, Model: q.Model, Disclosure: policy.DisclosureState{Status: "active", GrantID: grant.ID, GrantRevision: grant.Revision, Holder: holder, HolderEpoch: b.HolderEpoch, Purpose: "ai.model.inference", Expires: expiry, Target: policy.Sink{Origin: "https://model.example.invalid", Path: "/v1/chat/completions", Tenant: b.Tenant, Operation: "ai.model.inference"}, Actual: policy.Bind{Bytes: strconv.Itoa(len(q.Body)), SHA3_512: hex.EncodeToString(a[:]), SHA512: hex.EncodeToString(b2[:])}}}
	}
	ctx := context.Background()
	absent := row
	absent.ModelDisclosureCustody = "unregistered"
	partial, e := openProtectedRuntime(absent)
	if partial == nil || !errors.Is(e, ErrUnavailable) {
		t.Fatalf("no protected reader: %v", e)
	}
	if e = partial.CheckTaskModelDisclosure(ctx, q1); !errors.Is(e, ErrUnavailable) {
		t.Fatalf("partial owner admitted: %v", e)
	}
	_ = partial.Close()
	r, e := openProtectedRuntime(row)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = r.Close() })
	reader := &publicDisclosureReader{t: t, permits: map[policy.Bind]modelDisclosure{permit(q1).Disclosure.Actual: permit(q1)}}
	r.modelDisclosureReader = reader // test-only; never enters the release table
	if e = r.CheckTaskModelDisclosure(ctx, q1); e != nil {
		t.Fatal(e)
	}
	if e = r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrUnavailable) {
		t.Fatalf("wrong body reused: %v", e)
	}
	reader.permits[permit(q2).Disclosure.Actual] = permit(q2)
	if e = r.CheckTaskModelDisclosure(ctx, q2); e != nil {
		t.Fatal(e)
	}
	if reader.last.closes != 1 || reader.last.reads != 2 {
		t.Fatal("lost physical child or post-read")
	}
	reader.mode = "foreign"
	if e = r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrProof) || reader.last.closes != 1 {
		t.Fatalf("wrong request: %v", e)
	}
	reader.mode = "changed"
	if e = r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrCurrent) || reader.last.closes != 1 {
		t.Fatalf("changed original: %v", e)
	}
	reader.mode = "partial"
	if e = r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrCurrent) || reader.last.closes != 1 {
		t.Fatalf("partial acquisition: %v", e)
	}
	reader.mode = "close"
	if e = r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrCurrent) || reader.last.closes != 1 {
		t.Fatalf("close failure: %v", e)
	}
	t.Run("revoked_permit_never_reads_original", func(t *testing.T) {
		reader.mode = "revoked-permit"
		defer func() { reader.mode = "" }()
		if e := r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrCurrent) ||
			reader.last.reads != 0 || reader.last.closes != 1 {
			t.Fatalf("revoked permit: err=%v reads=%d closes=%d", e, reader.last.reads, reader.last.closes)
		}
	})
	t.Run("cancellation_during_acquire_forbids_read", func(t *testing.T) {
		ctx, cancel := context.WithCancel(ctx)
		defer cancel()
		reader.mode, reader.cancel = "cancel-acquire", cancel
		defer func() { reader.mode, reader.cancel = "", nil }()
		if e := r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, context.Canceled) ||
			reader.last.reads != 0 || reader.last.closes != 1 {
			t.Fatalf("read after canceled acquisition: err=%v reads=%d closes=%d", e, reader.last.reads, reader.last.closes)
		}
	})
	t.Run("retirement_during_current_forbids_reread", func(t *testing.T) {
		reader.mode, reader.cancel = "cancel-current", func() { _ = r.Retire() }
		if e := r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrRetired) ||
			reader.last.reads != 1 || reader.last.closes != 1 {
			t.Fatalf("reread after revoked current: err=%v reads=%d closes=%d", e, reader.last.reads, reader.last.closes)
		}
	})
}

type publicDisclosureReader struct {
	t       *testing.T
	permits map[policy.Bind]modelDisclosure
	mode    string
	cancel  func()
	last    *publicDisclosurePermit
}

func (r *publicDisclosureReader) Close() error { return nil }
func (r *publicDisclosureReader) ReadOriginalPermit(_ context.Context, k originalModelDisclosureKey) (originalModelDisclosurePermit, error) {
	d, ok := r.permits[k.Actual]
	if !ok {
		return nil, ErrUnavailable
	}
	record := originalModelDisclosureRecord{Key: k, Permit: d}
	if r.mode == "foreign" {
		record.Key.SessionEpoch = "foreign"
	}
	raw, e := json.Marshal(record)
	if e != nil {
		r.t.Fatal(e)
	}
	p := &publicDisclosurePermit{key: k, raw: string(raw), mode: r.mode, cancel: r.cancel}
	r.last = p
	if r.mode == "cancel-acquire" {
		r.cancel()
	}
	if r.mode == "partial" {
		return p, ErrCurrent
	}
	return p, nil
}

type publicDisclosurePermit struct {
	key                     originalModelDisclosureKey
	raw, mode               string
	reads, closes, currents int
	cancel                  func()
}

func (p *publicDisclosurePermit) ReadOriginal(_ context.Context, k originalModelDisclosureKey) (string, error) {
	if k != p.key {
		return "", ErrProof
	}
	p.reads++
	if p.mode == "changed" && p.reads > 1 {
		return p.raw + " ", nil
	}
	return p.raw, nil
}
func (p *publicDisclosurePermit) Current(context.Context) error {
	p.currents++
	if p.mode == "revoked-permit" {
		return ErrCurrent
	}
	if p.mode == "cancel-current" && p.currents == 2 {
		p.cancel()
	}
	return nil
}
func (p *publicDisclosurePermit) Close() error {
	p.closes++
	if p.mode == "close" {
		return ErrCurrent
	}
	return nil
}
