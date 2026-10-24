package developerauthority

import (
	"context"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func runtimeConfig(t *testing.T, c originalApprovalStoreConfig) OriginalPublicationApprovalRuntimeConfig {
	t.Helper()
	pins, _ := fixtureSourceProcess(t, "// PUBLIC unused verifier entry")
	p := filepath.Join(pins.SDKRoot, originalApprovalIssuerEntry)
	if e := os.Mkdir(filepath.Dir(p), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(p, []byte(approvalIssuerPublicChild), 0600); e != nil {
		t.Fatal(e)
	}
	pin := fixturePin(t, p)
	pin.Path = originalApprovalIssuerEntry
	pins.SDKFiles = append(pins.SDKFiles, pin)
	return OriginalPublicationApprovalRuntimeConfig{SourceID: c.source, InstanceID: c.instance, ProfileSHA256: c.profileSHA256, Verifier: pins}
}

func TestApprovalRuntimeActualNormalFactoryAndBorrowedDBCustody(t *testing.T) {
	db, _, config := newApprovalFixture(t)
	o, e := OpenOriginalPublicationApprovalRuntime(context.Background(), db, runtimeConfig(t, config))
	if e != nil {
		t.Fatal(e)
	}
	if o.store == nil || o.issuer == nil || o.issuer.store != o.store {
		t.Fatal("not the same actual store/query owner")
	}
	if _, ok := any(o).(OriginalSource); ok {
		t.Fatal("query runtime promoted to Source13")
	}
	if e = o.Close(); e != nil || o.Close() != nil {
		t.Fatal("normal close", e)
	}
	if e = db.PingContext(context.Background()); e != nil {
		t.Fatal("borrowed DB closed", e)
	}
	r := httptest.NewRecorder()
	o.ServeHTTP(r, httptest.NewRequest("GET", OriginalPublicationApprovalCurrentPath, nil))
	if r.Code != 503 {
		t.Fatal("closed runtime route")
	}
}

func TestApprovalRuntimeFailedOpenReturnsActualPartialAndStableClose(t *testing.T) {
	db, _, config := newApprovalFixture(t)
	c := runtimeConfig(t, config)
	c.Verifier.SDKFiles[0].SHA256 = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
	o, e := OpenOriginalPublicationApprovalRuntime(context.Background(), db, c)
	if e == nil || o == nil || o.store == nil || o.issuer == nil || o.issuer.pins == nil {
		t.Fatal("partial owner discarded")
	}
	first := o.Close()
	if first == nil || o.Close() != first {
		t.Fatal("first close result not retained")
	}
	if e = db.PingContext(context.Background()); e != nil {
		t.Fatal("borrowed DB discarded")
	}
}

func TestApprovalRuntimeSchemaUnknownNeverOpensIssuerOrEnablesRoute(t *testing.T) {
	db, state, c := newApprovalFixture(t)
	state.schema = 0
	o, e := OpenOriginalPublicationApprovalRuntime(context.Background(), db, runtimeConfig(t, c))
	if e == nil || o == nil || o.store == nil || o.issuer != nil {
		t.Fatal("schema failure fabricated owner")
	}
	r := httptest.NewRecorder()
	o.ServeHTTP(r, httptest.NewRequest("GET", OriginalPublicationApprovalCurrentPath, nil))
	if r.Code != 503 || state.writes != 0 {
		t.Fatal("unready runtime activated")
	}
	first := o.Close()
	if first == nil || o.Close() != first {
		t.Fatal("failed-open cleanup lost")
	}
}
