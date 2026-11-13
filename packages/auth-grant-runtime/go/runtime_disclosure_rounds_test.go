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

func TestExactIndependentModelDisclosureRounds(t *testing.T) {
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
	first, second := put("round1", permit(q1)), put("round2", permit(q2))
	ctx := context.Background()
	open := func(refs ...protectedRef) *Runtime {
		pick := row
		copy(pick.ModelDisclosurePermits[:], refs)
		r, e := openProtectedRuntime(pick)
		if r != nil {
			t.Cleanup(func() { _ = r.Close() })
		}
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	r := open(first)
	if e := r.CheckTaskModelDisclosure(ctx, q1); e != nil {
		t.Fatal(e)
	}
	if e := r.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrUnavailable) {
		t.Fatalf("new round reused approval: %v", e)
	}
	both := open(first, second)
	for _, q := range []ModelDisclosureRequest{q1, q2, q2} {
		if e := both.CheckTaskModelDisclosure(ctx, q); e != nil {
			t.Fatal(e)
		}
	}
	bad := q2
	bad.Body = append(append([]byte(nil), bad.Body...), ' ')
	if e := both.CheckTaskModelDisclosure(ctx, bad); !errors.Is(e, ErrUnavailable) {
		t.Fatalf("changed body: %v", e)
	}
	bad = q2
	bad.URL += "?"
	if e := both.CheckTaskModelDisclosure(ctx, bad); !errors.Is(e, ErrProof) {
		t.Fatalf("force query: %v", e)
	}
	duplicate := open(first, put("duplicate", permit(q1)))
	if e := duplicate.CheckTaskModelDisclosure(ctx, q1); !errors.Is(e, ErrProof) {
		t.Fatalf("ambiguous approval: %v", e)
	}
	if e := os.WriteFile(second.Path, []byte("{}"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := both.CheckTaskModelDisclosure(ctx, q2); !errors.Is(e, ErrCurrent) {
		t.Fatalf("mutated held approval: %v", e)
	}
}
