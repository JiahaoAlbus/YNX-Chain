package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	authgrant "ynx.local/authgrantpolicy"
)

// PUBLIC fixtures only. Actual Auth policy + actual Shop Store/HTTP are used;
// this is not sole SDK WIRE, PQ signatures, a protected Source or Root admission.
type publicShopTaskSource struct {
	snapshot                         authgrant.Snapshot
	store                            *Store
	asserts, retired, joined, closed int
	closeErr                         error
	onAssert                         func(int)
}

func (s *publicShopTaskSource) Snapshot(context.Context) (authgrant.Snapshot, error) {
	raw, _ := json.Marshal(s.snapshot)
	var copy authgrant.Snapshot
	_ = json.Unmarshal(raw, &copy)
	return copy, nil
}
func (s *publicShopTaskSource) AssertCurrent(ctx context.Context, v authgrant.SourceVersion) error {
	s.asserts++
	if s.onAssert != nil {
		s.onAssert(s.asserts)
	}
	if s.asserts > 1 && s.store.mu.TryLock() {
		s.store.mu.Unlock()
		return errors.New("PUBLIC final Auth gate was outside original order lock")
	}
	if v != s.snapshot.Version {
		return errors.New("PUBLIC Source revision changed")
	}
	return ctx.Err()
}
func (s *publicShopTaskSource) FenceScope() authgrant.FenceScope {
	return authgrant.EgressOnlyReadFence
}
func (s *publicShopTaskSource) Retire() error { s.retired++; return nil }
func (s *publicShopTaskSource) Join() error   { s.joined++; return nil }
func (s *publicShopTaskSource) Close() error  { s.closed++; return s.closeErr }

type publicShopTaskVerifier struct {
	source                                  *publicShopTaskSource
	opens                                   int
	first                                   error
	onOpen                                  func()
	responseErr, responseCloseErr           error
	responseOpened, responseClosed, attests int
	operation                               *OriginalShopTaskOrderOperation
	badResponseProof                        bool
}

// PUBLIC response operation/proof stand-in, not a durable registry or signer.
type publicShopTaskResponse struct{ verifier *publicShopTaskVerifier }

func (v *publicShopTaskVerifier) OpenShopOrderReadResponse(context.Context, OriginalShopTaskOrderCall) (HeldOriginalShopTaskOrderResponse, error) {
	v.responseOpened++
	return &publicShopTaskResponse{v}, v.responseErr
}
func (p *publicShopTaskResponse) Operation() (OriginalShopTaskOrderOperation, error) {
	if p.verifier.operation != nil {
		return *p.verifier.operation, nil
	}
	return OriginalShopTaskOrderOperation{"PUBLIC-original-op", "PUBLIC-remote-ref"}, nil
}
func (p *publicShopTaskResponse) AttestShopOrderReadResponse(_ context.Context, r OriginalShopTaskOrderResponse, payload []byte) (authgrant.Proof, error) {
	p.verifier.attests++
	if p.verifier.source.closed != 0 || r.Operation.OriginalOperationID != "PUBLIC-original-op" || r.Operation.RemoteRef != "PUBLIC-remote-ref" {
		return authgrant.Proof{}, ErrUnavailable
	}
	if p.verifier.badResponseProof {
		payload = []byte("PUBLIC wrong proof payload")
	}
	return authgrant.Proof{Payload: append([]byte(nil), payload...), Wire: []byte("PUBLIC-not-a-response-signature"), Purpose: "PUBLIC-response-proof"}, nil
}
func (p *publicShopTaskResponse) Close() error {
	p.verifier.responseClosed++
	return p.verifier.responseCloseErr
}

func (v *publicShopTaskVerifier) OpenTaskGrantSource(_ context.Context, _ authgrant.TaskEffectBinding, g, h authgrant.Proof) (authgrant.HeldTaskGrantSource, error) {
	v.opens++
	if v.onOpen != nil {
		v.onOpen()
	}
	if string(g.Wire) != "PUBLIC-grant-not-signature" || string(h.Wire) != "PUBLIC-holder-not-signature" {
		return v.source, errors.New("PUBLIC opaque proof changed")
	}
	return v.source, v.first
}

type publicShopTaskInput struct {
	OrderID  string   `json:"orderId"`
	Snapshot string   `json:"snapshot"`
	Fields   []string `json:"fields"`
}
type publicShopTaskCodec struct {
	call             OriginalShopTaskOrderCall
	source           *publicShopTaskSource
	decodes, encodes int
	onEncode         func()
	skipAttestation  bool
}

func (c *publicShopTaskCodec) DecodeShopOrderRead(_ context.Context, _ *http.Request, raw []byte) (OriginalShopTaskOrderCall, error) {
	c.decodes++
	var in publicShopTaskInput
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(&in); err != nil {
		return OriginalShopTaskOrderCall{}, ErrInvalidState
	}
	if d.Decode(&struct{}{}) != io.EOF {
		return OriginalShopTaskOrderCall{}, ErrInvalidState
	}
	call := c.call
	call.Input = raw
	return call, nil
}
func (c *publicShopTaskCodec) EncodeShopOrderRead(ctx context.Context, response OriginalShopTaskOrderResponse, attest OriginalShopTaskOrderAttest) (OriginalShopTaskOrderEncoding, error) {
	c.encodes++
	p, source, scope := response.Projection, response.Source, response.AuthScope
	if c.source.closed != 0 {
		return OriginalShopTaskOrderEncoding{}, errors.New("PUBLIC Source closed before original read/encoding")
	}
	if c.source.store.mu.TryLock() {
		c.source.store.mu.Unlock()
		return OriginalShopTaskOrderEncoding{}, errors.New("PUBLIC encoder outside resource lock")
	}
	if c.onEncode != nil {
		c.onEncode()
	}
	// PUBLIC local result encoding only, not the missing sole SDK Source codec.
	data, _ := json.Marshal(p.Data)
	body, _ := json.Marshal(struct {
		Projection OrderProjection                `json:"projection"`
		Label      string                         `json:"label"`
		Scope      authgrant.FenceScope           `json:"authScope"`
		Operation  OriginalShopTaskOrderOperation `json:"operation"`
	}{p, source.Label, scope, response.Operation})
	if c.skipAttestation {
		return OriginalShopTaskOrderEncoding{SourceBytes: data, Body: body, ContentType: "application/json"}, nil
	}
	proof, err := attest(ctx, data, body)
	if err != nil {
		return OriginalShopTaskOrderEncoding{}, err
	}
	if len(proof.Wire) == 0 {
		return OriginalShopTaskOrderEncoding{}, ErrUnavailable
	}
	envelope, _ := json.Marshal(struct {
		Payload json.RawMessage `json:"payload"`
		Proof   authgrant.Proof `json:"proof"`
	}{body, proof})
	return OriginalShopTaskOrderEncoding{SourceBytes: data, Body: envelope, ContentType: "application/json"}, nil
}

func publicShopTaskFixture(t *testing.T) (*Store, Order, *PreparedOriginalShopTaskOrders, *publicShopTaskVerifier, *publicShopTaskCodec, []byte) {
	t.Helper()
	s, o, buyer, _ := invoiceRecoveryFixture(t)
	fields := []string{"currency", "status", "totalYNXT"}
	projection, err := s.ReadScopedOrder(buyer, "buyer", o.ID, fields, "")
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(publicShopTaskInput{o.ID, projection.Snapshot, fields})
	data, _ := json.Marshal(projection.Data)
	ref := func(kind, id string) authgrant.Ref {
		return authgrant.Ref{Realm: "PUBLIC-realm", Tenant: "PUBLIC-tenant", Kind: kind, ID: id, Revision: "1"}
	}
	resource, holder, issuer := ref("shop.order", o.ID), ref("agent", "PUBLIC-agent"), ref("human", "PUBLIC-issuer")
	tool := ShopOrderReadToolDescriptor()
	target := authgrant.Sink{Service: "PUBLIC-shop", Tenant: "PUBLIC-tenant", Origin: "https://shop.invalid", Path: shopOrderReadPath, Region: "PUBLIC-region", Operation: shopOrderReadOperation}
	b := authgrant.TaskEffectBinding{Realm: resource.Realm, Tenant: resource.Tenant, Account: buyer, Audience: target.Service, GrantID: "PUBLIC-grant", GrantRevision: "1", Task: ref("task", "PUBLIC-task"), Generation: "1", StepID: "PUBLIC-step", Holder: holder, HolderEpoch: "1", SessionID: "PUBLIC-session", SessionEpoch: "1", ChannelBinding: "PUBLIC-channel", Tool: tool, Input: taskOrderBytesBinding(input), Fields: append([]string(nil), fields...), Target: target, Resources: []authgrant.Ref{resource}, Sources: []authgrant.Source{{Resource: resource, Fields: append([]string(nil), fields...), Label: "RESTRICTED", Binding: taskOrderBytesBinding(data)}}}
	start, end := strconv.FormatInt(time.Now().Add(-time.Second).UnixMilli(), 10), strconv.FormatInt(time.Now().Add(time.Minute).UnixMilli(), 10)
	// Clone the approved binding separately so mutated invoke DATA cannot mutate
	// the PUBLIC current grant snapshot at the same time.
	raw, _ := json.Marshal(b)
	var approved authgrant.TaskEffectBinding
	_ = json.Unmarshal(raw, &approved)
	held := &publicShopTaskSource{store: s, snapshot: authgrant.Snapshot{Version: authgrant.SourceVersion{Authority: "PUBLIC-authority", Revision: "1", PolicyRevision: "1"}, ObservedAt: start, Expires: end, Issuer: authgrant.PrincipalState{Ref: issuer, Epoch: "1", Status: "active", Role: "human"}, Holder: authgrant.PrincipalState{Ref: holder, Epoch: "1", Status: "active", Role: "agent"}, Grant: authgrant.GrantState{ID: b.GrantID, Revision: b.GrantRevision, Status: "active", Issuer: issuer, IssuerEpoch: "1", Holder: holder, HolderEpoch: "1", ValidFrom: start, Expires: end, Cap: "10", SingleMax: "2", NonDelegable: true, Binding: approved}, Task: authgrant.TaskState{Ref: b.Task, Generation: b.Generation, Holder: holder, HolderEpoch: "1", Status: "READY"}, Session: authgrant.SessionState{ID: b.SessionID, Epoch: "1", ChannelBinding: b.ChannelBinding, Holder: holder, HolderEpoch: "1", Status: "active"}, Catalog: authgrant.CatalogState{Tool: tool, Audience: target.Service, Status: "active"}, AuthorizedResources: append([]authgrant.Ref(nil), b.Resources...), Sources: approved.Sources, Budget: authgrant.BudgetState{Status: "ready", Cap: "10", SingleMax: "2", Spent: "0", Reserved: "0", Requested: "1", Slot: b.Slot()}, Effect: authgrant.EffectState{State: "NEW", Slot: b.Slot()}}}
	v := &publicShopTaskVerifier{source: held}
	proof := func(w string) authgrant.Proof {
		return authgrant.Proof{Payload: []byte("PUBLIC-payload"), Wire: []byte(w), Purpose: "PUBLIC-task-proof"}
	}
	codec := &publicShopTaskCodec{source: held, call: OriginalShopTaskOrderCall{Binding: b, Grant: proof("PUBLIC-grant-not-signature"), Holder: proof("PUBLIC-holder-not-signature"), Input: append([]byte(nil), input...)}}
	prepared, err := PrepareOriginalShopTaskOrders(v, codec, v, tool, target, resource.Kind, func(ctx context.Context) error { return ctx.Err() })
	if err != nil {
		t.Fatal(err)
	}
	return s, o, prepared, v, codec, input
}

func shopTaskRequest(t *testing.T, s *Store, p *PreparedOriginalShopTaskOrders, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	opens := 0
	server, err := p.OpenOriginal(context.Background(), func() (*Store, error) { opens++; return s, nil }, ServerConfig{})
	if err != nil || opens != 1 || server.store != s {
		t.Fatal("normal task composition lost original Store", err, opens)
	}
	r := httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(body))
	r.Header.Set("Content-Type", ShopOrderReadRequestContentType)
	r.Header.Set("Authorization", "Bearer ordinary-login-is-not-grant")
	r.Header.Set("X-Tool-Class", "read")
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	return w
}

func TestShopTaskOrderReadOriginalAuthActualHTTPStoreProjection(t *testing.T) {
	s, o, p, v, c, body := publicShopTaskFixture(t)
	before := transitionDomainSnapshot(t, s)
	w := shopTaskRequest(t, s, p, body)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(`"orderId":"`+o.ID+`"`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"totalYNXT":"25"`)) || !bytes.Contains(w.Body.Bytes(), []byte(`"authScope":"egress-only-read-fence"`)) || c.encodes != 1 || v.opens != 1 || v.source.asserts != 4 || v.source.closed != 1 || v.source.retired != 1 || v.source.joined != 1 {
		t.Fatal(w.Code, w.Body.String(), v.opens, v.source.asserts, v.source.closed)
	}
	for _, secret := range []string{o.Buyer, o.PayPayoutAddress, o.InvoiceID, o.PayIntentID, o.Address.Line1, "PUBLIC-grant-not-signature", "same-authority-resource-fence"} {
		if bytes.Contains(w.Body.Bytes(), []byte(secret)) {
			t.Fatal("task result leaked unselected data or promoted fence", secret)
		}
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("X-YNX-Auth-Fence") != "egress-only-read-fence" || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
		t.Fatal("read mutated original business/UNKNOWN history")
	}
}

func TestShopTaskOrderReadGrantCannotRetargetOrderFieldsOrInput(t *testing.T) {
	for _, fault := range []string{"same-price-other-order", "tenant", "holder", "generation", "input-sha3", "tool", "fields", "approved-private-field", "vault", "unknown-original-op"} {
		t.Run(fault, func(t *testing.T) {
			s, o, p, v, c, body := publicShopTaskFixture(t)
			switch fault {
			case "same-price-other-order":
				st, product := s.s.Stores[o.StoreID], s.s.Products[o.Lines[0].ProductID]
				other, err := s.CreateOrder(o.Buyer, orderInput(st, product, "task-other-same-price"))
				if err != nil {
					t.Fatal(err)
				}
				view, err := s.ReadScopedOrder(o.Buyer, "buyer", other.ID, c.call.Binding.Fields, "")
				if err != nil {
					t.Fatal(err)
				}
				body, _ = json.Marshal(publicShopTaskInput{other.ID, view.Snapshot, c.call.Binding.Fields})
				c.call.Binding.Input = taskOrderBytesBinding(body)
				c.call.Binding.Resources[0].ID = other.ID
				c.call.Binding.Sources[0].Resource.ID = other.ID
			case "tenant":
				c.call.Binding.Tenant = "PUBLIC-other-tenant"
			case "holder":
				v.source.snapshot.Holder.Epoch = "2"
			case "generation":
				v.source.snapshot.Task.Generation = "2"
			case "input-sha3":
				c.call.Binding.Input.SHA3_512 = strings.Repeat("f", 128)
			case "tool":
				c.call.Binding.Tool.ID = "ai.conversation.read"
			case "fields", "approved-private-field":
				fields := []string{"address"}
				var input publicShopTaskInput
				_ = json.Unmarshal(body, &input)
				input.Fields = fields
				body, _ = json.Marshal(input)
				c.call.Binding.Input = taskOrderBytesBinding(body)
				c.call.Binding.Fields = fields
				c.call.Binding.Sources[0].Fields = fields
				if fault == "approved-private-field" {
					raw, _ := json.Marshal(c.call.Binding)
					var approved authgrant.TaskEffectBinding
					_ = json.Unmarshal(raw, &approved)
					v.source.snapshot.Grant.Binding = approved
					v.source.snapshot.Sources = approved.Sources
				}
			case "vault":
				c.call.Binding.Sources[0].Label = "VAULT"
				v.source.snapshot.Grant.Binding.Sources[0].Label = "VAULT"
				v.source.snapshot.Sources[0].Label = "VAULT"
			case "unknown-original-op":
				v.source.snapshot.Effect.State = "UNKNOWN"
				v.source.snapshot.Effect.OriginalOp = "PUBLIC/original-operation"
			}
			before := transitionDomainSnapshot(t, s)
			w := shopTaskRequest(t, s, p, body)
			if w.Code < 400 || c.encodes != 0 || bytes.Contains(w.Body.Bytes(), []byte(o.ID)) || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
				t.Fatal("retargeted grant reached original data", fault, w.Code, w.Body.String(), c.encodes)
			}
			if fault == "unknown-original-op" && (w.Code != 409 || !bytes.Contains(w.Body.Bytes(), []byte(`"originalOp":"PUBLIC/original-operation"`))) {
				t.Fatal("UNKNOWN original result was replayed or lost", w.Code, w.Body.String())
			}
		})
	}
}

func TestShopTaskOrderReadLateResourcePermissionOrAuthorityChangeStopsOutput(t *testing.T) {
	for _, fault := range []string{"order-snapshot", "seller-revoked", "auth-revoked-during-encoding", "deadline-during-encoding", "source-content-binding", "context-cancel"} {
		t.Run(fault, func(t *testing.T) {
			s, o, p, v, c, body := publicShopTaskFixture(t)
			switch fault {
			case "order-snapshot":
				v.onOpen = func() {
					if _, err := s.transition(o.Buyer, "buyer", o.ID, "cancelled", nil, nil, nil, "task-cancel-before-read"); err != nil {
						t.Fatal(err)
					}
				}
			case "seller-revoked":
				owner := s.s.Stores[o.StoreID].Owner
				_, member := actor(t, 239)
				acceptSellerRole(t, s, owner, o.StoreID, member, SellerRoleViewer)
				c.call.Binding.Account = member
				v.source.snapshot.Grant.Binding.Account = member
				v.source.snapshot.Budget.Slot = c.call.Binding.Slot()
				v.source.snapshot.Effect.Slot = c.call.Binding.Slot()
				v.onOpen = func() {
					if _, _, err := s.RevokeSellerRole(owner, o.StoreID, member, "membership ended"); err != nil {
						t.Fatal(err)
					}
				}
			case "auth-revoked-during-encoding":
				c.onEncode = func() { v.source.snapshot.Grant.Status = "revoked" }
			case "deadline-during-encoding":
				c.onEncode = func() { v.source.snapshot.Expires = strconv.FormatInt(time.Now().Add(-time.Second).UnixMilli(), 10) }
			case "source-content-binding":
				bad := taskOrderBytesBinding([]byte("PUBLIC different source bytes"))
				c.call.Binding.Sources[0].Binding = bad
				v.source.snapshot.Grant.Binding.Sources[0].Binding = bad
				v.source.snapshot.Sources[0].Binding = bad
			case "context-cancel":
				// Separate below: cancellation happens after the actual read while
				// the original guard is still held through encoding.
			}
			var w *httptest.ResponseRecorder
			if fault == "context-cancel" {
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				c.onEncode = cancel
				server, err := p.OpenOriginal(ctx, func() (*Store, error) { return s, nil }, ServerConfig{})
				if err != nil {
					t.Fatal(err)
				}
				r := httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(body)).WithContext(ctx)
				r.Header.Set("Content-Type", ShopOrderReadRequestContentType)
				w = httptest.NewRecorder()
				server.Handler().ServeHTTP(w, r)
			} else {
				w = shopTaskRequest(t, s, p, body)
			}
			if w.Code < 400 || bytes.Contains(w.Body.Bytes(), []byte(o.ID)) || v.source.closed != 1 {
				t.Fatal("late state escaped original read fence", fault, w.Code, w.Body.String(), v.source.closed)
			}
		})
	}
}

func TestShopTaskOrderReadPartialCloseAndSecretCausePreserved(t *testing.T) {
	for _, partial := range []bool{true, false} {
		t.Run(strconv.FormatBool(partial), func(t *testing.T) {
			s, _, p, v, c, body := publicShopTaskFixture(t)
			cause := errors.New("PUBLIC-secret-proof-must-not-be-HTTP-error")
			if partial {
				v.first = cause
			} else {
				v.source.closeErr = cause
			}
			result, err := p.reader.readTaskOrder(context.Background(), s, httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(body)), body)
			if !errors.Is(err, cause) || len(result.Body) != 0 || v.source.closed != 1 || v.source.joined != 1 || v.source.retired != 1 || (partial && c.encodes != 0) {
				t.Fatal("partial source cause/custody lost or data escaped", err, v.source.closed, c.encodes)
			}
		})
	}
	// Public HTTP errors expose classification only, not private source causes.
	s, _, p, v, _, body := publicShopTaskFixture(t)
	v.source.closeErr = errors.New("PUBLIC-secret-proof-must-not-be-HTTP-error")
	w := shopTaskRequest(t, s, p, body)
	if w.Code != 503 || bytes.Contains(w.Body.Bytes(), []byte("PUBLIC-secret-proof")) {
		t.Fatal("private close cause leaked", w.Code, w.Body.String())
	}
}

func TestShopTaskOrderReadNoPartialInstallOrAlternateHTTPAuthority(t *testing.T) {
	s, _, p, v, c, body := publicShopTaskFixture(t)
	reader := p.reader.(*originalShopTaskOrderReader)
	if _, err := PrepareOriginalShopTaskOrders(nil, c, v, reader.tool, reader.target, reader.orderKind, p.current); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing protected verifier activated")
	}
	if _, err := PrepareOriginalShopTaskOrders(v, nil, v, reader.tool, reader.target, reader.orderKind, p.current); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing original SDK codec activated")
	}
	for _, path := range []string{shopOrderReadPath + "?approved=true", "/api/tools/shop%2eorder.read"} {
		server, err := p.OpenOriginal(context.Background(), func() (*Store, error) { return s, nil }, ServerConfig{})
		if err != nil {
			t.Fatal(err)
		}
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", path, bytes.NewReader(body))
		server.Handler().ServeHTTP(w, r)
		if w.Code < 400 || v.opens != 0 {
			t.Fatal("query/path metadata selected authority", w.Code, v.opens)
		}
	}
}

func TestShopTaskOrderReadDecodedBuffersCannotRetargetHeldSource(t *testing.T) {
	s, o, p, v, c, body := publicShopTaskFixture(t)
	v.onOpen = func() {
		c.call.Binding.Resources[0].ID = "PUBLIC-other-order"
		c.call.Binding.Fields[0] = "address"
		c.call.Binding.Sources[0].Fields[0] = "address"
		c.call.Grant.Wire[0] = 'X'
	}
	w := shopTaskRequest(t, s, p, body)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(o.ID)) || bytes.Contains(w.Body.Bytes(), []byte("PUBLIC-other-order")) || bytes.Contains(w.Body.Bytes(), []byte("address")) || v.source.closed != 1 {
		t.Fatal("decoder aliases retargeted selected source", w.Code, w.Body.String())
	}
}

func TestShopTaskOrderReadRuntimeCustodyRetirementDropsResponse(t *testing.T) {
	s, o, p, v, c, body := publicShopTaskFixture(t)
	retired := false
	p.current = func(context.Context) error {
		if retired {
			return errors.New("PUBLIC runtime custody retired")
		}
		return nil
	}
	c.onEncode = func() { retired = true }
	w := shopTaskRequest(t, s, p, body)
	if w.Code != 503 || bytes.Contains(w.Body.Bytes(), []byte(o.ID)) || v.source.closed != 1 || c.encodes != 1 {
		t.Fatal("retired runtime published private read", w.Code, w.Body.String(), v.source.closed)
	}
}

func TestShopTaskOrderReadOriginalResponseAssociationRequired(t *testing.T) {
	for _, fault := range []string{"no-response-source", "empty-original-op", "empty-remote-ref", "skip-attestation", "wrong-proof-payload", "partial-response-source", "response-close"} {
		t.Run(fault, func(t *testing.T) {
			s, _, p, v, c, body := publicShopTaskFixture(t)
			cause := errors.New("PUBLIC response source first cause")
			switch fault {
			case "no-response-source":
				r := p.reader.(*originalShopTaskOrderReader)
				if _, err := PrepareOriginalShopTaskOrders(v, c, nil, r.tool, r.target, r.orderKind, p.current); !errors.Is(err, ErrUnavailable) {
					t.Fatal("missing response source installed", err)
				}
				return
			case "empty-original-op":
				v.operation = &OriginalShopTaskOrderOperation{RemoteRef: "PUBLIC-remote-ref"}
			case "empty-remote-ref":
				v.operation = &OriginalShopTaskOrderOperation{OriginalOperationID: "PUBLIC-original-op"}
			case "skip-attestation":
				c.skipAttestation = true
			case "wrong-proof-payload":
				v.badResponseProof = true
			case "partial-response-source":
				v.responseErr = cause
			case "response-close":
				v.responseCloseErr = cause
			}
			before := transitionDomainSnapshot(t, s)
			result, err := p.reader.readTaskOrder(context.Background(), s, httptest.NewRequest("POST", shopOrderReadPath, bytes.NewReader(body)), body)
			if err == nil || len(result.Body) != 0 || v.source.closed != 1 || v.responseClosed != 1 || !bytes.Equal(before, transitionDomainSnapshot(t, s)) {
				t.Fatal("unassociated response escaped", fault, err, v.source.closed, v.responseClosed)
			}
			if (fault == "partial-response-source" || fault == "response-close") && !errors.Is(err, cause) {
				t.Fatal("original response first cause lost", err)
			}
		})
	}
}
