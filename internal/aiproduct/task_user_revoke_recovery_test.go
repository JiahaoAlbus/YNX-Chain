package aiproduct

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

type p08UserRecoveryAuthorizer struct {
	session ProductSession
	revoked bool
}

func (a *p08UserRecoveryAuthorizer) Authorize(_ context.Context, _ *http.Request, _ []string) (productsessionv2.Session, error) {
	if a.revoked {
		return productsessionv2.Session{}, &productsessionv2.Error{Code: "SESSION_REVOKED", Status: http.StatusUnauthorized}
	}
	return productsessionv2.Session{
		SessionBinding: a.session.ID, Account: a.session.Account, DeviceID: a.session.DeviceID,
		ClientID: FormalProductClientID, Scopes: a.session.Scopes,
		IssuedAt: time.Now().Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339Nano),
	}, nil
}

type p08UserRecoveryBroker struct {
	*p08ConversationClient
	revoked bool
}

func (b *p08UserRecoveryBroker) NewEffectsCurrent(ctx context.Context) error {
	if b.revoked {
		return errTaskEffectSourceUnavailable
	}
	return ctx.Err()
}

func TestP08UserHTTPResultRecoveryAfterEffectRevocation(t *testing.T) {
	f, _, client := newP08ConversationLoop(t)
	client.lostACK = true
	prepared := f.server.toolEffects.(*originalRuntimeToolEffects).runtime
	broker := &p08UserRecoveryBroker{p08ConversationClient: client}
	prepared.broker.client = broker
	server, err := NewServer(Config{GatewayURL: "http://127.0.0.1:1", GatewayKey: testGatewayKey, ExactWalletCallback: FormalCallback, TaskRuntime: prepared}, f.server.store, nil)
	if err != nil {
		t.Fatal(err)
	}
	authorizer := &p08UserRecoveryAuthorizer{session: f.session}
	server.wallet = authorizer
	f.server = server
	product := httptest.NewServer(server.Handler())
	defer product.Close()
	call := func(method, path string, body any, want int) []byte {
		t.Helper()
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		r, err := http.NewRequest(method, product.URL+path, bytes.NewReader(raw))
		if err != nil {
			t.Fatal(err)
		}
		r.Header.Set(productsessionv2.ProofHeader, "PUBLIC-fixture-proof")
		r.Header.Set("Content-Type", "application/json")
		response, err := product.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		out, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != want {
			t.Fatalf("%s %s: got %d want %d, %s (%v)", method, path, response.StatusCode, want, out, err)
		}
		return out
	}
	path := "/api/tasks/" + f.task.ID
	request := f.request()
	request.AuthorizationRef = "PUBLIC_QUERY_REF"
	var pending taskRunView
	if err := json.Unmarshal(call(http.MethodPost, path+"/runs", request, http.StatusOK), &pending); err != nil || len(pending.Steps) != 1 {
		t.Fatalf("proposal: %+v %v", pending, err)
	}
	approveConversationLoop(t, f, pending)
	request.Resume, request.Prompt = true, ""
	call(http.MethodPost, path+"/runs", request, http.StatusConflict)
	step := path + "/tool-steps/" + pending.Steps[0]
	ref := map[string]string{"authorizationRef": request.AuthorizationRef}
	call(http.MethodGet, step+"/result", nil, http.StatusConflict)
	broker.revoked = true
	call(http.MethodPost, path+"/tool-steps/"+f.expected.StepID+"/dispatch", ref, http.StatusServiceUnavailable)
	task := server.store.state.Tasks[f.task.ID]
	call(http.MethodPost, path+"/cancel", map[string]uint64{"revision": task.Revision, "generation": task.Generation}, http.StatusOK)
	wire := call(http.MethodPost, step+"/reconcile", ref, http.StatusOK)
	if !bytes.Equal(wire, []byte(client.last.Original)) || !bytes.Equal(wire, call(http.MethodGet, step+"/result", nil, http.StatusOK)) {
		t.Fatal("user recovery changed the original verified result")
	}
	var finished TaskProjection
	if err := json.Unmarshal(call(http.MethodGet, path, nil, http.StatusOK), &finished); err != nil || finished.Status != "CANCELLED" {
		t.Fatalf("task did not settle cancellation: %+v %v", finished, err)
	}
	authorizer.revoked = true
	denied := call(http.MethodGet, step+"/result", nil, http.StatusUnauthorized)
	if !bytes.Contains(denied, []byte("SESSION_REVOKED")) || bytes.Contains(denied, []byte("actual selected source body")) {
		t.Fatal("revoked session obtained private result")
	}
	call(http.MethodPost, path+"/runs", request, http.StatusUnauthorized)
	if client.effects != 1 || client.inputReads != 1 || client.queries != 1 || f.requests.Load() != 1 {
		t.Fatal("revocation or original query replayed work")
	}
}
