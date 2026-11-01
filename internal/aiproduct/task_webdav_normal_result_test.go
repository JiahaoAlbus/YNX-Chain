package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func p08ExternalNormalResult(t *testing.T, f *p08WebDAVRuntimeFixture, session ProductSession) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/tasks/"+f.task.ID+"/tool-steps/"+f.input.OperationID+"/result", nil)
	r.SetPathValue("id", f.task.ID)
	r.SetPathValue("stepId", f.input.OperationID)
	w := httptest.NewRecorder()
	f.s.handleTaskToolResult(w, r, session)
	return w
}
func TestP08WebDAVNormalResultUsesOriginalObservation(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	original, err := f.deliver()
	if err != nil {
		t.Fatal(err)
	}
	beforeNetwork := f.dav.requests()
	before, _ := os.ReadFile(f.store.path)
	source, err := f.s.OpenTaskStoreSource()
	if err != nil {
		t.Fatal(err)
	}
	held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: TaskStorePrincipal{Account: f.session.Account, DeviceID: f.session.DeviceID, SessionID: f.session.ID}, TaskID: f.task.ID, StepID: f.input.OperationID})
	if err != nil {
		t.Fatal(err)
	}
	defer held.Close()
	metadata, err := held.View()
	if err != nil || metadata.Operation.ID != original.OperationID || metadata.Operation.Status != "CONTENT_PRESENT" || metadata.Operation.ToolID != taskWebDAVToolID {
		t.Fatal("original operation not captured", err)
	}
	path := "/api/tasks/" + f.task.ID + "/tool-steps/" + f.input.OperationID + "/result"
	observed, err := source.ObserveOriginalTaskRead(context.Background(), f.s, f.session, p08ReadCall(path))
	if err != nil {
		t.Fatal(err)
	}
	defer observed.Close()
	v, err := observed.View()
	if err != nil || v.Decision != "OBSERVED" || v.Scope != "READ_ONLY_OBSERVATION" || v.Status != 200 {
		t.Fatal("read became effect", err)
	}
	raw, err := observed.Body()
	if err != nil {
		t.Fatal(err)
	}
	var receipt TaskWebDAVReceipt
	if json.Unmarshal(raw, &receipt) != nil || receipt != original || receipt.AuthorshipProven || receipt.State == "COMMITTED" {
		t.Fatal("external observation relabeled")
	}
	after, _ := os.ReadFile(f.store.path)
	if !bytes.Equal(before, after) || beforeNetwork != f.dav.requests() {
		t.Fatal("read replayed remote I/O or changed original state")
	}
	cold, err := NewStore(f.store.path, f.key)
	if err != nil {
		t.Fatal(err)
	}
	f.s.store = cold
	w := p08ExternalNormalResult(t, f, f.session)
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), raw) {
		t.Fatal("cold normal result changed original bytes")
	}
}
func TestP08WebDAVNormalResultUnknownDoesNotRecoverOrReplay(t *testing.T) {
	f := newP08WebDAVRuntime(t)
	f.dav.lostACK = true
	original, err := f.deliver()
	if err == nil || original.State != "UNKNOWN" {
		t.Fatal("fixture must retain original uncertain PUT")
	}
	w := p08ExternalNormalResult(t, f, f.session)
	var r TaskWebDAVReceipt
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &r) != nil || r != original || r.State != "UNKNOWN" || f.dav.requests() != "PUT" {
		t.Fatal("normal result manufactured recovery or retried PUT")
	}
}
func TestP08WebDAVNormalResultRejectsForeignTamperedAndAmbiguous(t *testing.T) {
	for _, kind := range []string{"foreign-account", "foreign-device", "tampered", "ambiguous"} {
		t.Run(kind, func(t *testing.T) {
			f := newP08WebDAVRuntime(t)
			if _, err := f.deliver(); err != nil {
				t.Fatal(err)
			}
			session := f.session
			switch kind {
			case "foreign-account":
				session.Account = "PUBLIC-other"
			case "foreign-device":
				session.DeviceID = "PUBLIC-other"
			case "tampered":
				key := taskWebDAVKey(session.Account, f.task.ID, f.input.OperationID)
				r := f.store.state.WebDAVDeliveries[key]
				r.Receipt.AuthorshipProven = true
				f.store.state.WebDAVDeliveries[key] = r
			case "ambiguous":
				f.store.state.Actions[f.input.OperationID] = ActionRecord{ID: f.input.OperationID, Account: session.Account}
			}
			before := f.dav.requests()
			w := p08ExternalNormalResult(t, f, session)
			if w.Code == 200 || before != f.dav.requests() {
				t.Fatal("foreign/tampered/collision read accepted or touched remote")
			}
			source, _ := f.s.OpenTaskStoreSource()
			if held, err := source.Capture(context.Background(), TaskStoreCapture{Principal: TaskStorePrincipal{Account: session.Account, DeviceID: session.DeviceID, SessionID: session.ID}, TaskID: f.task.ID, StepID: f.input.OperationID}); err == nil || held != nil {
				t.Fatal("capture accepted invalid original observation")
			}
		})
	}
}
