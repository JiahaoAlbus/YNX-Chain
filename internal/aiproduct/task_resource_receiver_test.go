package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	link "github.com/JiahaoAlbus/YNX-Chain/internal/securelink"
	originalclient "github.com/JiahaoAlbus/YNX-Chain/packages/auth-grant-history-client/go"
	authgrant "ynx.local/authgrantpolicy"
)

// Actual Store/policy/receiver/Unix transport, PUBLIC verifier/history boundary.
// This fixture never installs the normal factory or claims native Source/Root.
func taskResourceFixture(t *testing.T) (*OriginalTaskReadResource, OriginalTaskResourceReadRequest, *p08OriginalHeldFixture) {
	t.Helper()
	store, b, held := p08OriginalAuthFixture(t)
	store.mu.Lock()
	record := store.state.Actions[b.StepID]
	step := *record.ToolStep
	step.TaskGrantRef = b.GrantID
	record.ToolStep = &step
	store.state.Actions[record.ID] = record
	input, e := store.decrypt(b.Account, storedMessage{Message: Message{ID: record.ID, ConversationID: step.TaskID}, Nonce: step.InputNonce, Cipher: step.InputCipher})
	store.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	proof := authgrant.Proof{Payload: []byte("PUBLIC payload"), Wire: []byte("PUBLIC not signature"), Purpose: "PUBLIC-fixture"}
	r := OriginalTaskResourceReadRequest{Version: "1", AuthorityOperationID: "PUBLIC_AUTH_ORIGINAL_OP", ExpectedGrantRevision: b.GrantRevision, Binding: b, Grant: proof, Holder: proof, RawInput: []byte(input), AuthorizationRef: "PUBLIC_QUERY_REF"}
	held.snapshot.Effect.OriginalOp = r.AuthorityOperationID
	o := &OriginalTaskReadResource{store: store, verifier: p08OriginalVerifierFixture{held: held}, current: func(ctx context.Context) error { return ctx.Err() }, children: make(map[*OriginalTaskResourceReadCall]struct{}), queryCurrent: func(ctx context.Context) error { return ctx.Err() }}
	o.queryMaterial = func(ctx context.Context, q OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error) {
		if !q.QueryOriginal || q.AuthorizationRef != r.AuthorizationRef {
			return originalBrokerQueryMaterial{}, errToolConflict
		}
		return originalBrokerQueryMaterial{State: "UNKNOWN", Binding: b, Call: originalclient.TaskAuthorityCall{Grant: proof, Holder: proof, OriginalOperation: r.AuthorityOperationID}}, ctx.Err()
	}
	return o, r, held
}

func TestP08TaskResourceReadExecuteOriginalQuery(t *testing.T) {
	o, r, held := taskResourceFixture(t)
	ctx := context.Background()
	read := r
	read.AuthorityOperationID = ""
	read.RawInput = nil
	owner, input, err := o.ReadInput(ctx, read)
	if err != nil || owner == nil || !bytes.Equal(input, r.RawInput) {
		t.Fatalf("input: %v", err)
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	owner, result, err := o.Execute(ctx, r)
	if err != nil || result.State != "COMMITTED" || result.OperationID != r.AuthorityOperationID || !bytes.Contains(result.Original, []byte("actual selected source body")) {
		t.Fatalf("execute: %+v %v", result, err)
	}
	if err = o.Close(); !errors.Is(err, errTaskResourceChildren) {
		t.Fatalf("live guard discarded: %v", err)
	}
	// Parent retirement cancels that original child, never closes its Store.
	if err = owner.Current(ctx); err == nil {
		t.Fatal("retired parent kept child live")
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	if err = o.Close(); err != nil {
		t.Fatal(err)
	}
	// Independent original history remains usable through a successor owner.
	o = &OriginalTaskReadResource{store: o.store, verifier: o.verifier, current: o.current, queryCurrent: o.queryCurrent, queryMaterial: o.queryMaterial, children: make(map[*OriginalTaskResourceReadCall]struct{})}
	sequence := o.store.state.AuditSequence
	held.snapshot.Effect.State = "UNKNOWN"
	got, err := o.Query(ctx, r)
	if err != nil || got.State != "COMMITTED" || !bytes.Equal(got.Original, result.Original) || o.store.state.AuditSequence != sequence {
		t.Fatalf("query re-executed/lost original: %+v %v", got, err)
	}
}

func TestP08TaskResourceRejectsForgedOpAndChangedInput(t *testing.T) {
	for _, kind := range []string{"operation", "input", "revision", "resource", "grant"} {
		t.Run(kind, func(t *testing.T) {
			o, r, _ := taskResourceFixture(t)
			switch kind {
			case "operation":
				r.AuthorityOperationID = "FORGED"
			case "input":
				r.RawInput = []byte("changed")
			case "revision":
				r.ExpectedGrantRevision = "999"
			case "resource":
				r.Binding.Resources[0].ID = "foreign"
			case "grant":
				o.store.mu.Lock()
				record := o.store.state.Actions[r.Binding.StepID]
				step := *record.ToolStep
				step.TaskGrantRef = "foreign"
				record.ToolStep = &step
				o.store.state.Actions[record.ID] = record
				o.store.mu.Unlock()
			}
			sequence := o.store.state.AuditSequence
			owner, result, err := o.Execute(context.Background(), r)
			if owner != nil {
				_ = owner.Close()
			}
			if err == nil || len(result.Original) != 0 || o.store.state.AuditSequence != sequence {
				t.Fatalf("unsafe %s: %v %+v", kind, err, result)
			}
		})
	}
}

func TestP08TaskResourceRetainsUncertainCloseAndPartial(t *testing.T) {
	for _, partial := range []bool{false, true} {
		t.Run(map[bool]string{false: "close", true: "open"}[partial], func(t *testing.T) {
			o, r, held := taskResourceFixture(t)
			cause := errors.New("PUBLIC original close/partial cause")
			if partial {
				o.verifier = p08OriginalVerifierFixture{held: held, first: cause}
			} else {
				held.closeErr = cause
			}
			owner, _, err := o.Execute(context.Background(), r)
			if partial && !errors.Is(err, cause) {
				t.Fatal(err)
			}
			if owner == nil {
				t.Fatal("partial lost")
			}
			err = owner.Close()
			if !partial && !errors.Is(err, cause) {
				t.Fatal(err)
			}
			calls := held.closed
			_ = owner.Close()
			if held.closed != calls {
				t.Fatal("blind close retry")
			}
			if !partial && !errors.Is(o.Close(), errTaskResourceChildren) {
				t.Fatal("uncertain child discarded")
			}
		})
	}
}

func TestP08TaskResourcePublicHTTPDenied(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	raw, _ := json.Marshal(r)
	response := httptest.NewRecorder()
	o.Handler().ServeHTTP(response, httptest.NewRequest("POST", OriginalTaskReadExecutePath, bytes.NewReader(raw)))
	if response.Code != http.StatusForbidden {
		t.Fatal(response.Code)
	}
	if _, err := OpenOriginalTaskReadResource(context.Background(), &Server{store: o.store}); err == nil {
		t.Fatal("unregistered server became Source")
	}
}

func TestP08TaskResourceActualLINKFiniteReceiver(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	registration := p08CallerEndpointRegistration(t)
	registration.service = OriginalTaskReadResourceService
	registration.routes = []link.LocalCallerRoute{{Method: "POST", Path: OriginalTaskReadInputPath, MaxBodyBytes: 1 << 20, Timeout: 3 * time.Second}, {Method: "POST", Path: OriginalTaskReadExecutePath, MaxBodyBytes: 1 << 20, Timeout: 3 * time.Second}, {Method: "POST", Path: OriginalTaskReadQueryPath, MaxBodyBytes: 1 << 20, Timeout: 3 * time.Second}}
	e, err := openTaskCallerEndpoint(context.Background(), registration, o.Handler())
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, e)
	read := cloneOriginalResourceRequest(r)
	read.AuthorityOperationID, read.RawInput = "", nil
	inputWire, _ := json.Marshal(read)
	inputResponse, err := e.client.Call(context.Background(), "POST", OriginalTaskReadInputPath, "application/json", inputWire)
	var input struct {
		Input []byte `json:"input"`
	}
	if err != nil || inputResponse.StatusCode != 200 || json.Unmarshal(inputResponse.Body, &input) != nil || !bytes.Equal(input.Input, r.RawInput) {
		t.Fatalf("protected input: %+v %v", inputResponse, err)
	}
	raw, _ := json.Marshal(r)
	response, err := e.client.Call(context.Background(), "POST", OriginalTaskReadExecutePath, "application/json", raw)
	if err != nil {
		t.Fatal(err)
	}
	body := response.Body
	if response.StatusCode != http.StatusOK {
		t.Fatalf("protected receiver: %d %s %v", response.StatusCode, body, err)
	}
	var result OriginalTaskResourceReadResult
	if json.Unmarshal(body, &result) != nil || result.State != "COMMITTED" || result.OperationID != r.AuthorityOperationID {
		t.Fatalf("missing actual receipt: %s", body)
	}
	sequence := o.store.state.AuditSequence
	queryResponse, err := e.client.Call(context.Background(), "POST", OriginalTaskReadQueryPath, "application/json", raw)
	if err != nil || queryResponse.StatusCode != 200 || !bytes.Equal(queryResponse.Body, body) || sequence != o.store.state.AuditSequence {
		t.Fatalf("protected query changed original: %s %v", queryResponse.Body, err)
	}
	for _, malformed := range [][]byte{append([]byte(`{"Version":"1",`), raw[1:]...), append([]byte(`{"Unexpected":true,`), raw[1:]...)} {
		denied, err := e.client.Call(context.Background(), "POST", OriginalTaskReadExecutePath, "application/json", malformed)
		if err != nil || denied.StatusCode != 400 || o.store.state.AuditSequence != sequence {
			t.Fatalf("ambiguous DATA accepted: %+v %v", denied, err)
		}
	}
}

func TestP08TaskResourceInputRefusesInvalidatedStep(t *testing.T) {
	for _, status := range []string{"FAILED", "UNKNOWN", "pending_approval", ""} {
		t.Run(status, func(t *testing.T) {
			o, r, _ := taskResourceFixture(t)
			r.AuthorityOperationID, r.RawInput = "", nil
			record := o.store.state.Actions[r.Binding.StepID]
			record.Status = status
			o.store.state.Actions[record.ID] = record
			owner, input, err := o.ReadInput(context.Background(), r)
			if owner != nil {
				defer owner.Close()
			}
			if err == nil || len(input) != 0 {
				t.Fatalf("invalidated input disclosed: %q %v", input, err)
			}
		})
	}
}

func TestP08TaskResourceLateFailureRetainsColdOriginal(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	cause := errors.New("PUBLIC source lost after durable commit")
	o.current = func(ctx context.Context) error {
		if o.store.state.Actions[r.Binding.StepID].Status == "COMPLETED" {
			return cause
		}
		return ctx.Err()
	}
	owner, partial, err := o.Execute(context.Background(), r)
	if owner == nil || !errors.Is(err, cause) || partial.State != "COMMITTED" {
		t.Fatalf("lost partial: %+v %v", partial, err)
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	// This is only the original PUBLIC fixture's content key; no real account.
	cold, err := NewStore(o.store.path, bytes.Repeat([]byte{83}, 32))
	if err != nil {
		t.Fatal(err)
	}
	o.store = cold
	o.verifier = nil // independent history must not open any new effect guard
	sequence := cold.state.AuditSequence
	got, err := o.Query(context.Background(), r)
	if err != nil || !bytes.Equal(got.Original, partial.Original) || got.OperationID != r.AuthorityOperationID || sequence != cold.state.AuditSequence {
		t.Fatalf("cold original changed: %+v %v", got, err)
	}
}

func TestP08TaskResourceQueryRetirementHoldsOriginalChild(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	owner, _, err := o.Execute(context.Background(), r)
	if err != nil {
		t.Fatal(err)
	}
	if err = owner.Close(); err != nil {
		t.Fatal(err)
	}
	original := o.queryMaterial
	entered, release := make(chan struct{}), make(chan struct{})
	o.queryMaterial = func(ctx context.Context, q OriginalTaskAuthorizationRequest) (originalBrokerQueryMaterial, error) {
		close(entered)
		<-release
		return original(ctx, q)
	}
	done := make(chan error, 1)
	go func() {
		result, err := o.Query(context.Background(), r)
		if len(result.Original) != 0 {
			err = errors.New("retired query disclosed original")
		}
		done <- err
	}()
	<-entered
	if err = o.Close(); !errors.Is(err, errTaskResourceChildren) {
		t.Fatalf("query not retained: %v", err)
	}
	close(release)
	if err = <-done; err == nil {
		t.Fatal("retired query accepted")
	}
	if err = o.Close(); err != nil {
		t.Fatalf("query did not drain: %v", err)
	}
}

func TestP08TaskResourceOriginalHistoryProofMismatch(t *testing.T) {
	for _, kind := range []string{"operation", "grant", "holder", "revision"} {
		t.Run(kind, func(t *testing.T) {
			o, r, _ := taskResourceFixture(t)
			owner, _, err := o.Execute(context.Background(), r)
			if err != nil {
				t.Fatal(err)
			}
			if err = owner.Close(); err != nil {
				t.Fatal(err)
			}
			r = cloneOriginalResourceRequest(r)
			switch kind {
			case "operation":
				r.AuthorityOperationID = "foreign"
			case "grant":
				r.Grant.Wire[0] ^= 1
			case "holder":
				r.Holder.Wire[0] ^= 1
			case "revision":
				r.ExpectedGrantRevision = "foreign"
			}
			sequence := o.store.state.AuditSequence
			result, err := o.Query(context.Background(), r)
			if err == nil || len(result.Original) != 0 || sequence != o.store.state.AuditSequence {
				t.Fatalf("query leaked/replayed: %+v %v", result, err)
			}
		})
	}
}

func TestP08TaskResourceCopiedLINKRequestDenied(t *testing.T) {
	o, r, _ := taskResourceFixture(t)
	registration := p08CallerEndpointRegistration(t)
	registration.service = OriginalTaskReadResourceService
	registration.routes = []link.LocalCallerRoute{{Method: "POST", Path: OriginalTaskReadExecutePath, MaxBodyBytes: 1 << 20, Timeout: 3 * time.Second}}
	actualHandler := o.Handler()
	e, err := openTaskCallerEndpoint(context.Background(), registration, http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		// Even the genuine context does not authorize a replacement request.
		actualHandler.ServeHTTP(w, request.Clone(request.Context()))
	}))
	if err != nil {
		t.Fatal(err)
	}
	p08CallerEndpointCleanup(t, e)
	raw, _ := json.Marshal(r)
	sequence := o.store.state.AuditSequence
	response, err := e.client.Call(context.Background(), "POST", OriginalTaskReadExecutePath, "application/json", raw)
	if err != nil || response.StatusCode != http.StatusForbidden || o.store.state.AuditSequence != sequence {
		t.Fatalf("copied request accepted: %+v %v", response, err)
	}
}
