package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/governanceview"
	"github.com/JiahaoAlbus/YNX-Chain/internal/governance"
)

type governanceReadDenyAuth struct{ calls atomic.Uint32 }

func (a *governanceReadDenyAuth) Authenticate(*http.Request) (governance.Principal, error) {
	a.calls.Add(1)
	return governance.Principal{}, errors.New("public fixture has no login or native permission")
}

type governanceReadTransport func(*http.Request) (*http.Response, error)

func (f governanceReadTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// This seeds only a private in-memory PUBLIC registry fixture through its real
// service methods. There is no Wallet, native account, production store or vote.
func originalGovernanceReadFixture(t *testing.T) (*governance.Service, *httptest.Server, *governanceReadDenyAuth, string) {
	t.Helper()
	service, err := governance.NewService(governance.Policy{ChainID: "controlled-registry-testnet", VoteDomain: "ynx-governance.vote.v1", VoteReplacementPolicy: "replace_before_deadline", VoteWithdrawalPolicy: "withdraw_before_deadline", VoteMaxClockSkew: time.Minute, MinimumDeposit: 100, QuorumBPS: 5000, ThresholdBPS: 6667, VotingPeriod: time.Hour, Timelock: 2 * time.Hour, TimelockGrace: 6 * time.Hour, MaxLifetime: 30 * 24 * time.Hour, EmergencyThreshold: 3, EmergencyMaxDuration: 24 * time.Hour, ParameterRules: map[string]governance.ParameterRule{"/bridge/exposureLimit": {Scope: governance.ScopeBridge, Numeric: true, Minimum: 0, Maximum: 500000000}}, GenesisRoleManifestHash: strings.Repeat("1", 64), ElectorateApprovalThreshold: 2})
	if err != nil {
		t.Fatal(err)
	}
	auth := &governanceReadDenyAuth{}
	state := filepath.Join(t.TempDir(), "never-written-registry-state.json")
	server, err := governance.NewServer(service, auth, state, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/governance/proposals" && !strings.HasPrefix(r.URL.Path, "/governance/proposals/") {
			t.Errorf("reader escaped fixed GET routes %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("local ticket/credentials forwarded upstream")
		}
		server.Handler().ServeHTTP(w, r)
	}))
	t.Cleanup(source.Close)
	return service, source, auth, state
}
func createGovernanceReadProposal(t *testing.T, s *governance.Service, index int, extra int) governance.Proposal {
	t.Helper()
	now := time.Now().UTC()
	amount := int64(45000000 + index)
	text := "Controlled public fixture; no native voting eligibility, Wallet approval or chain-finality claim."
	p, err := s.Create(governance.ProposalInput{Nonce: "public-nonce-" + strconv.Itoa(index), ProposalType: "bridge_limit_change", Scope: governance.ScopeBridge, Proposer: "public-fixture-proposer", Owner: "public-fixture-owner", Summary: "Reported public proposal <script>never-execute</script> " + strconv.Itoa(index), Motivation: text + strings.Repeat("m", extra), TechnicalImpact: text, EconomicImpact: text, SecurityRisk: text, UserImpact: text, ProviderImpact: text, Migration: text, Rollback: text, CanaryPlan: text, VerificationPlan: text, ConflictDisclosure: text, Dependencies: []string{"controlled-fixture-dependency"}, Evidence: []string{"sha256:public-fixture-data-only"}, Changes: []governance.ParameterChange{{Path: "/bridge/exposureLimit", Before: "50000000", After: strconv.FormatInt(amount, 10), Maximum: 500000000, Numeric: &amount}}, SourceCommit: strings.Repeat("c", 40), Release: "public-fixture.1", ExpiresAt: now.Add(7 * 24 * time.Hour)}, now)
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func governanceReadDTO(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var out map[string]any
	if err := d.Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out
}
func assertGovernanceReadBoundary(t *testing.T, m governanceview.Metadata) {
	t.Helper()
	if m.ProjectionVersion != governanceview.ProjectionVersion || m.Classification != "RPC_ONLY" || m.ReportKind != "governance-registry" || m.Authority || m.WalletApproval || m.NativeEligibility || m.ChainFinality || m.NumericEncoding != "decimal-strings" {
		t.Fatalf("public registry promoted to authority %+v", m)
	}
}
func saveGovernanceReadEvidence(t *testing.T, name string, raw []byte) {
	t.Helper()
	if directory := os.Getenv("YNX_GOVERNANCE_CONTRACT_EVIDENCE"); directory != "" {
		if err := os.WriteFile(filepath.Join(directory, name), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNetworkGovernanceReadOriginalHandler(t *testing.T) {
	s, source, auth, state := originalGovernanceReadFixture(t)
	reader, err := governanceview.New(source.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	empty := reader.ListProposals(context.Background())
	if empty.Code != "EMPTY" || empty.ReportedCount == nil || *empty.ReportedCount != "0" || empty.ReturnedCount != "0" || empty.Truncated || len(empty.Proposals) != 0 {
		t.Fatalf("original empty registry became unsupported/populated %+v", empty)
	}
	p := createGovernanceReadProposal(t, s, 1, 0)
	p, err = s.Deposit(p.ID, 9007199254740993, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	h, helperServer := fixture(t, source.URL)
	h.governance = reader
	if status, _ := call(t, helperServer, "/api/governance-proposals", helperServer.URL, "", map[string]any{}); status != 401 {
		t.Fatal("unpaired governance reader allowed")
	}
	_, challenge := call(t, helperServer, "/api/pair/challenge", helperServer.URL, "", nil)
	status, paired := call(t, helperServer, "/api/pair", helperServer.URL, "", map[string]any{"challenge": challenge["challenge"], "code": "operator-code"})
	if status != 200 {
		t.Fatal(paired)
	}
	scope, ok := paired["scope"].([]any)
	if !ok {
		t.Fatal("missing actual pairing scope")
	}
	found := false
	for _, s := range scope {
		if s == "governance.read" {
			found = true
		}
	}
	if !found {
		t.Fatal("pair scope omitted public governance read")
	}
	ticket := paired["ticket"].(string)
	request := func(route string, payload any) []byte {
		body, _ := json.Marshal(payload)
		req, _ := http.NewRequest(http.MethodPost, helperServer.URL+route, bytes.NewReader(body))
		req.Header.Set("Origin", helperServer.URL)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+ticket)
		res, err := helperServer.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, err := io.ReadAll(res.Body)
		if err != nil || res.StatusCode != 200 {
			t.Fatalf("normal paired read %d %v %s", res.StatusCode, err, raw)
		}
		return raw
	}
	listRaw := request("/api/governance-proposals", map[string]any{})
	var list governanceview.List
	if json.Unmarshal(listRaw, &list) != nil || list.Code != "REPORTED" || list.Source == nil || *list.Source != governanceview.OriginalSource || list.Version == nil || *list.Version != governanceview.OriginalVersion || list.ResponseSHA256 == nil || list.Endpoint == nil || *list.Endpoint != source.URL+"/governance/proposals" || len(list.Proposals) != 1 || list.ReturnedCount != "1" {
		t.Fatalf("actual paired handler list invalid %s", listRaw)
	}
	assertGovernanceReadBoundary(t, list.Metadata)
	projected := governanceReadDTO(t, list.Proposals[0])
	if projected["id"] != p.ID || projected["deposit"] != "9007199254740993" || projected["eligiblePower"] != "0" {
		t.Fatalf("original numeric lexemes lost %+v", projected)
	}
	input := projected["input"].(map[string]any)
	if !strings.Contains(input["summary"].(string), "<script>") {
		t.Fatal("source string changed rather than projecting inert data")
	}
	changes := input["changes"].([]any)
	if changes[0].(map[string]any)["numeric"] != "45000001" {
		t.Fatal("nested original integer not decimal string")
	}
	detailRaw := request("/api/governance-proposal", map[string]any{"id": p.ID})
	var detail governanceview.Detail
	if json.Unmarshal(detailRaw, &detail) != nil || detail.Code != "REPORTED" || !bytes.Equal(detail.Proposal, list.Proposals[0]) {
		t.Fatalf("list/detail original proposal differs %s", detailRaw)
	}
	assertGovernanceReadBoundary(t, detail.Metadata)
	saveGovernanceReadEvidence(t, "actual-helper-original-list.json", listRaw)
	saveGovernanceReadEvidence(t, "actual-helper-original-detail.json", detailRaw)
	if code, out := call(t, helperServer, "/api/governance-proposal", helperServer.URL, ticket, map[string]any{"id": strings.Repeat("f", 64)}); code != 200 || out["code"] != "NOT_FOUND" || out["proposal"] != nil {
		t.Fatalf("original missing proposal concealed %d %+v", code, out)
	}
	for _, bad := range []struct {
		route string
		body  any
	}{{"/api/governance-proposals", map[string]any{"url": source.URL}}, {"/api/governance-proposal", map[string]any{"id": "../../health"}}, {"/api/governance-proposal", map[string]any{"id": p.ID, "path": "/votes"}}} {
		if code, _ := call(t, helperServer, bad.route, helperServer.URL, ticket, bad.body); code != 400 {
			t.Fatalf("forged read selector accepted %d", code)
		}
	}
	if code, _ := call(t, helperServer, "/api/governance-proposals", "https://foreign.invalid", ticket, map[string]any{}); code != 403 {
		t.Fatal("foreign origin governance reader allowed")
	}
	if _, err := os.Stat(state); !errors.Is(err, os.ErrNotExist) || auth.calls.Load() != 0 {
		t.Fatal("public reads initialized/persisted registry or invoked authorization")
	}
}

func TestNetworkGovernanceReadProjectionBounds(t *testing.T) {
	for _, extra := range []int{0, 15000} {
		t.Run(strconv.Itoa(extra), func(t *testing.T) {
			s, source, _, _ := originalGovernanceReadFixture(t)
			for i := 0; i < 60; i++ {
				createGovernanceReadProposal(t, s, i, extra)
			}
			reader, err := governanceview.New(source.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			report := reader.ListProposals(context.Background())
			raw, _ := json.Marshal(report)
			if report.Code != "REPORTED" || report.ReportedCount == nil || *report.ReportedCount != "60" || !report.Truncated || len(report.Proposals) == 0 || len(report.Proposals) > 50 || report.ReturnedCount != strconv.Itoa(len(report.Proposals)) || len(raw) > governanceview.MaxResponseBytes {
				t.Fatalf("original list truncation incorrect count=%d bytes=%d %+v", len(report.Proposals), len(raw), report.Metadata)
			}
			if extra == 0 && len(report.Proposals) != 50 {
				t.Fatal("count bound truncated too early")
			}
			if extra > 0 && len(report.Proposals) >= 50 {
				t.Fatal("whole-response byte budget not exercised")
			}
			actual := s.ListProposals()
			for i, raw := range report.Proposals {
				row := governanceReadDTO(t, raw)
				if row["id"] != actual[i].ID {
					t.Fatal("source order changed or proposal dropped")
				}
			}
			if extra > 0 {
				saveGovernanceReadEvidence(t, "actual-helper-byte-truncated-list.json", raw)
			}
		})
	}
}

func TestNetworkGovernanceReadInvalidReports(t *testing.T) {
	s, _, _, _ := originalGovernanceReadFixture(t)
	p := createGovernanceReadProposal(t, s, 2, 0)
	base := map[string]any{"data": map[string]any{"proposals": []governance.Proposal{p}, "stateMachine": governance.ProposalStatuses()}, "source": governanceview.OriginalSource, "version": governanceview.OriginalVersion, "asOf": time.Now().UTC()}
	valid, _ := json.Marshal(base)
	modify := func(f func(map[string]any)) []byte {
		v := governanceReadDTO(t, valid)
		f(v)
		raw, _ := json.Marshal(v)
		return raw
	}
	proposal := func(v map[string]any) map[string]any {
		return v["data"].(map[string]any)["proposals"].([]any)[0].(map[string]any)
	}
	cases := map[string][]byte{
		"source-is-not-native-authority": modify(func(v map[string]any) { v["source"] = "native-root-approved" }),
		"unsupported-version":            modify(func(v map[string]any) { v["version"] = "ynx-governance-api/v9" }),
		"null-proposals-not-empty":       modify(func(v map[string]any) { v["data"].(map[string]any)["proposals"] = nil }),
		"missing-metadata":               modify(func(v map[string]any) { delete(v, "asOf") }),
		"invalid-calendar":               modify(func(v map[string]any) { v["asOf"] = "2026-02-31T00:00:00Z" }),
		"unknown-authority-field":        modify(func(v map[string]any) { v["authority"] = true }),
		"unknown-proposal-grant":         modify(func(v map[string]any) { proposal(v)["nativeGrant"] = true }),
		"uint64-overflow":                modify(func(v map[string]any) { proposal(v)["deposit"] = json.Number("18446744073709551616") }),
		"fractional-integer":             modify(func(v map[string]any) { proposal(v)["deposit"] = json.Number("1.5") }),
		"exponent-integer":               modify(func(v map[string]any) { proposal(v)["deposit"] = json.Number("1e3") }),
		"null-integer":                   modify(func(v map[string]any) { proposal(v)["deposit"] = nil }),
		"missing-original-field":         modify(func(v map[string]any) { delete(proposal(v), "deposit") }),
		"unknown-original-status":        modify(func(v map[string]any) { proposal(v)["status"] = "native-finalized" }),
		"duplicate-original-id": modify(func(v map[string]any) {
			data := v["data"].(map[string]any)
			items := data["proposals"].([]any)
			data["proposals"] = append(items, items[0])
		}),
		"oversized-single-proposal": modify(func(v map[string]any) {
			proposal(v)["input"].(map[string]any)["motivation"] = strings.Repeat("m", governanceview.MaxProposalBytes)
		}),
		"duplicate-envelope-key": []byte(strings.Replace(string(valid), `"source":"`+governanceview.OriginalSource+`"`, `"source":"`+governanceview.OriginalSource+`","source":"`+governanceview.OriginalSource+`"`, 1)),
		"deep-json":              []byte(`{"data":` + strings.Repeat(`[`, 34) + `0` + strings.Repeat(`]`, 34) + `}`),
		"body-limit":             bytes.Repeat([]byte("x"), governanceview.MaxBodyBytes+1),
		"malformed":              []byte("not json"),
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(body)
			}))
			defer source.Close()
			reader, err := governanceview.New(source.URL, nil)
			if err != nil {
				t.Fatal(err)
			}
			out := reader.ListProposals(context.Background())
			if out.Code != "INVALID_RESPONSE" || len(out.Proposals) != 0 || out.ReportedCount != nil || out.Truncated {
				t.Fatalf("invalid report accepted %+v", out.Metadata)
			}
			assertGovernanceReadBoundary(t, out.Metadata)
		})
	}
	for _, status := range []int{404, 405, 501} {
		t.Run("unsupported-"+strconv.Itoa(status), func(t *testing.T) {
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte("route not supported"))
			}))
			defer source.Close()
			reader, _ := governanceview.New(source.URL, nil)
			if out := reader.ListProposals(context.Background()); out.Code != "UNSUPPORTED" {
				t.Fatal(out.Metadata)
			}
		})
	}
	t.Run("wrong-detail-id", func(t *testing.T) {
		raw, _ := json.Marshal(map[string]any{"data": p, "source": governanceview.OriginalSource, "version": governanceview.OriginalVersion, "asOf": time.Now().UTC()})
		source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(raw) }))
		defer source.Close()
		reader, _ := governanceview.New(source.URL, nil)
		out := reader.Proposal(context.Background(), strings.Repeat("a", 64))
		if out.Code != "INVALID_RESPONSE" || out.Proposal != nil {
			t.Fatal("foreign proposal identity accepted")
		}
	})
	t.Run("disconnected", func(t *testing.T) {
		source := httptest.NewServer(http.NotFoundHandler())
		reader, _ := governanceview.New(source.URL, nil)
		source.Close()
		if out := reader.ListProposals(context.Background()); out.Code != "UNAVAILABLE" {
			t.Fatal(out.Metadata)
		}
	})
	t.Run("fixed-redirect-does-not-discover", func(t *testing.T) {
		var reached atomic.Uint32
		other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { reached.Add(1) }))
		defer other.Close()
		source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, other.URL, 302) }))
		defer source.Close()
		reader, _ := governanceview.New(source.URL, nil)
		if out := reader.ListProposals(context.Background()); out.Code != "UNAVAILABLE" || reached.Load() != 0 {
			t.Fatal("redirect source followed")
		}
	})
	for _, invalid := range []string{"http://example.com", "http://localhost:1234", "https://user:secret@example.com", "https://example.com?url=elsewhere", "https://example.com/../other", "https://example.com/a%2fb", "file:///tmp/source"} {
		if _, err := governanceview.New(invalid, nil); err == nil {
			t.Fatal("invalid fixed source accepted")
		}
	}
}

func TestNetworkGovernanceReadRevokeAndExpiryFence(t *testing.T) {
	s, _, _, _ := originalGovernanceReadFixture(t)
	p := createGovernanceReadProposal(t, s, 3, 0)
	raw, _ := json.Marshal(map[string]any{"data": map[string]any{"proposals": []governance.Proposal{p}, "stateMachine": governance.ProposalStatuses()}, "source": governanceview.OriginalSource, "version": governanceview.OriginalVersion, "asOf": time.Now().UTC()})
	for _, test := range []string{"revoke", "expiry"} {
		t.Run(test, func(t *testing.T) {
			entered, release := make(chan struct{}), make(chan struct{})
			client := &http.Client{Transport: governanceReadTransport(func(r *http.Request) (*http.Response, error) {
				close(entered)
				<-release
				return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(raw)), Request: r}, nil
			})}
			reader, err := governanceview.New("https://fixed-public-registry.invalid", client)
			if err != nil {
				t.Fatal(err)
			}
			h, server := fixture(t, "https://fixed-chain.invalid")
			h.governance = reader
			ticket := pair(t, server)
			type answer struct {
				status int
				body   map[string]any
			}
			done := make(chan answer, 1)
			go func() {
				status, body := call(t, server, "/api/governance-proposals", server.URL, ticket, map[string]any{})
				done <- answer{status, body}
			}()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("normal paired read did not reach actual transport")
			}
			if test == "revoke" {
				if code, _ := call(t, server, "/api/revoke", server.URL, ticket, map[string]any{}); code != 200 {
					t.Fatal("revoke failed")
				}
			} else {
				h.mu.Lock()
				h.now = func() time.Time { return time.Now().Add(ticketLife + time.Minute) }
				h.mu.Unlock()
			}
			close(release)
			select {
			case out := <-done:
				if out.status != 401 || out.body["error"] != "PAIRING_REQUIRED" || out.body["proposals"] != nil {
					t.Fatalf("late public response escaped old context %+v", out)
				}
			case <-time.After(time.Second):
				t.Fatal("late public transport not released")
			}
		})
	}
}

func TestNetworkGovernanceReadConfiguredBasePath(t *testing.T) {
	service, source, _, _ := originalGovernanceReadFixture(t)
	createGovernanceReadProposal(t, service, 41, 0)
	for _, suffix := range []string{"", "/"} {
		reader, err := governanceview.New(source.URL+suffix, nil)
		if err != nil {
			t.Fatal(err)
		}
		out := reader.ListProposals(context.Background())
		if out.Code != "REPORTED" || out.Endpoint == nil || *out.Endpoint != source.URL+"/governance/proposals" {
			t.Fatalf("canonical trailing slash misconfigured %+v", out.Metadata)
		}
	}
	// A configured reverse-proxy prefix is retained; it is not a browser URL
	// selector and never redirects/discovers another port or origin.
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/fixed-prefix/governance/proposals" {
			t.Errorf("configured prefix escaped: %s", r.URL.Path)
		}
		resp, err := http.Get(source.URL + "/governance/proposals")
		if err != nil {
			t.Error(err)
			w.WriteHeader(502)
			return
		}
		defer resp.Body.Close()
		_, _ = io.Copy(w, resp.Body)
	}))
	defer proxy.Close()
	reader, err := governanceview.New(proxy.URL+"/fixed-prefix/", nil)
	if err != nil {
		t.Fatal(err)
	}
	out := reader.ListProposals(context.Background())
	if out.Code != "REPORTED" || out.Endpoint == nil || *out.Endpoint != proxy.URL+"/fixed-prefix/governance/proposals" {
		t.Fatalf("actual fixed prefix read failed %+v", out.Metadata)
	}
	raw, _ := json.Marshal(out)
	saveGovernanceReadEvidence(t, "actual-fixed-basepath-list.json", raw)
	for _, invalid := range []string{proxy.URL + "/fixed-prefix//", proxy.URL + "//", proxy.URL + "/fixed-prefix/../other", proxy.URL + "/fixed-prefix%2fother"} {
		if _, err := governanceview.New(invalid, nil); err == nil {
			t.Fatal("noncanonical configured prefix accepted")
		}
	}
}

func TestNetworkGovernanceReadOptionalConfigurationIsolation(t *testing.T) {
	var governanceRequests atomic.Uint32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/governance/") {
			governanceRequests.Add(1)
			t.Error("invalid optional source fell back to another source")
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/txs/"+knownTx) {
			_, _ = w.Write([]byte(`{"transaction":"public RPC fixture only","height":9007199254740993}`))
			return
		}
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"code":"NOT_SUPPLIED"}`))
	}))
	defer upstream.Close()
	for _, test := range []string{"original-rpc-canonical-mismatch", "explicit-invalid-governance-source"} {
		t.Run(test, func(t *testing.T) {
			rpc, governanceSource := upstream.URL, "http://not-loopback.invalid"
			if test == "original-rpc-canonical-mismatch" {
				rpc = upstream.URL + "/legacy/../configured"
				governanceSource = rpc
			}
			if err := validRPC(rpc); err != nil {
				t.Fatalf("fixture is not a previously accepted chain RPC: %v", err)
			}
			h, server := fixture(t, rpc)
			h.configureGovernanceRead(governanceSource) // Same normal run() assembly callee.
			if h.governance != nil || h.rpc != rpc {
				t.Fatal("optional rejection changed original chain source or enabled fallback")
			}
			clientStore(t, h) // Original fixture creates the required private 0700 child.
			h.historyContextPin = strings.Repeat("a", 64)
			ticket := pair(t, server)
			if status, out := call(t, server, "/api/status", server.URL, ticket, map[string]any{}); status != 200 || out["paired"] != true || out["rpc"] != rpc {
				t.Fatalf("optional governance stopped original status %d %+v", status, out)
			}
			status, saved := call(t, server, "/api/client-receipt", server.URL, ticket, map[string]any{"txId": knownTx})
			if status != 200 || saved["receiptId"] == nil || saved["txId"] != knownTx || saved["view"].(map[string]any)["level"] != "RPC_ONLY" {
				t.Fatalf("optional governance stopped original receipt computation/read %d %+v", status, saved)
			}
			status, historical := call(t, server, "/api/receipt", server.URL, ticket, map[string]any{"id": saved["receiptId"]})
			if status != 200 || historical["historical"] != true || historical["authority"] != false || historical["receipt"].(map[string]any)["receiptId"] != saved["receiptId"] {
				t.Fatalf("original receipt unavailable after optional failure %d %+v", status, historical)
			}
			status, report := call(t, server, "/api/governance-proposals", server.URL, ticket, map[string]any{})
			if status != 200 || report["code"] != "NOT_CONFIGURED" || report["source"] != nil || report["endpoint"] != nil || len(report["proposals"].([]any)) != 0 || report["reportedCount"] != nil {
				t.Fatalf("optional failure concealed or replaced source %d %+v", status, report)
			}
		})
	}
	if governanceRequests.Load() != 0 {
		t.Fatal("invalid fixed governance source was silently replaced")
	}
}
