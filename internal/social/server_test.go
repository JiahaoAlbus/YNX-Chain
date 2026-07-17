package social

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type testResolver struct{ account string }
type testMultiResolver map[string]string

func (r testResolver) ResolveDiscovery(source, value string) (string, error) {
	if source != "handle" || value != "bob_social" {
		return "", errors.New("only an exact Social handle is accepted")
	}
	return r.account, nil
}
func (r testMultiResolver) ResolveDiscovery(source, value string) (string, error) {
	if source != "handle" {
		return "", errors.New("only handle discovery is supported")
	}
	account, ok := r[value]
	if !ok {
		return "", errors.New("handle is not known")
	}
	return account, nil
}

func TestServerStrictParserDiscoveryBoundaryAndAuthorization(t *testing.T) {
	service, now := testService(t)
	service.cfg.RateLimitMax = 100
	aliceFixture := newFixture(t, 31)
	bobFixture := newFixture(t, 32)
	login, err := service.Login(signedLogin(t, service, aliceFixture, now))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service, testResolver{account: bobFixture.account}).Handler())
	defer server.Close()
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, []byte(`{"idempotencyKey":"request-server-1","source":"handle","value":"bob_social","unknown":true}`))
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown field status=%d", response.StatusCode)
	}
	response.Body.Close()
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, []byte(`{"idempotencyKey":"request-server-2","source":"handle","value":"ynx1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqz7fll8"}`))
	if response.StatusCode == http.StatusCreated {
		t.Fatal("wallet address discovery was accepted")
	}
	response.Body.Close()
	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, []byte(`{"idempotencyKey":"request-server-3","source":"handle","value":"bob_social"}`))
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("handle discovery status=%d", response.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	response = doRequest(t, http.MethodGet, server.URL+"/social/v1/contacts", "", nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status=%d", response.StatusCode)
	}
	response.Body.Close()
}

func TestServerRejectsLegacyWalletQueryFieldAuthorization(t *testing.T) {
	service, _ := testService(t)
	server := httptest.NewServer(NewServer(service, testResolver{}).Handler())
	defer server.Close()
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/wallet/challenge?account=legacy&nonce=legacy", "", []byte(`{}`))
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("legacy wallet query status=%d", response.StatusCode)
	}
}

func TestServerConversationMemberMutationResolvesDiscoveryAndEnforcesAuthorization(t *testing.T) {
	service, now := testService(t)
	service.cfg.RateLimitMax = 100
	aliceFixture, bobFixture, carolFixture, daveFixture := newFixture(t, 91), newFixture(t, 92), newFixture(t, 93), newFixture(t, 94)
	aliceLogin, bobLogin := loginResult(t, service, aliceFixture, now), loginResult(t, service, bobFixture, now)
	carolLogin := loginResult(t, service, carolFixture, now)
	daveLogin := loginResult(t, service, daveFixture, now)
	alice, bob, carol, dave := aliceLogin.Session, bobLogin.Session, carolLogin.Session, daveLogin.Session
	aliceToken, bobToken := aliceLogin.Token, bobLogin.Token

	request, _, err := service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "group-membership-request-1", TargetAccount: bob.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(bob, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	request, _, err = service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "group-membership-request-2", TargetAccount: carol.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(carol, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	request, _, err = service.RequestContact(alice, ContactRequestInput{IdempotencyKey: "group-membership-request-3", TargetAccount: dave.Account, Source: "handle"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TransitionRequest(dave, request.ID, "accept"); err != nil {
		t.Fatal(err)
	}
	group, _, err := service.CreateGroupConversation(alice, "team", "group-create-membership", []string{bob.Account, dave.Account})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	server := httptest.NewServer(NewServer(service, testMultiResolver{"carol_social": carol.Account}).Handler())
	defer server.Close()

	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/conversations/"+group.ID+"/members", "", []byte(`{"idempotencyKey":"membership-1","add":[{"idempotencyKey":"add-carol","source":"handle","value":"carol_social"}],"remove":[]}`))
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing auth status=%d", response.StatusCode)
	}
	response.Body.Close()

	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/conversations/"+group.ID+"/members", aliceToken, []byte(`{"idempotencyKey":"membership-1","add":[{"idempotencyKey":"add-carol","source":"handle","value":"carol_social"}],"remove":[]}`))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("owner add status=%d", response.StatusCode)
	}
	type membershipResponse struct {
		Record struct {
			Members []any `json:"members"`
		} `json:"record"`
		Replayed bool       `json:"replayed"`
	}
	var out membershipResponse
	if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if out.Replayed || len(out.Record.Members) != 4 {
		t.Fatalf("unexpected membership response %#v", out)
	}

	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/conversations/"+group.ID+"/members", aliceToken, []byte(`{"idempotencyKey":"membership-1","add":[{"idempotencyKey":"add-carol","source":"handle","value":"carol_social"}],"remove":[]}`))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("idempotent replay status=%d", response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if !out.Replayed {
		t.Fatalf("replay flag not set: %#v", out)
	}

	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/conversations/"+group.ID+"/members", bobToken, []byte(`{"idempotencyKey":"membership-2","add":[{"idempotencyKey":"add-carol","source":"handle","value":"carol_social"}],"remove":[]}`))
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("non-owner status=%d", response.StatusCode)
	}
	response.Body.Close()

	response = doRequest(t, http.MethodPost, server.URL+"/social/v1/conversations/"+group.ID+"/members", aliceToken, []byte(`{"idempotencyKey":"membership-1","remove":["`+carol.Account+`"]}`))
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("idempotency conflict status=%d", response.StatusCode)
	}
	response.Body.Close()
}

func doRequest(t *testing.T, method, url, token string, body []byte) *http.Response {
	t.Helper()
	request, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func loginResult(t *testing.T, service *Service, fixture fixture, now time.Time) LoginResult {
	t.Helper()
	result, err := service.Login(signedLogin(t, service, fixture, now))
	if err != nil {
		t.Fatal(err)
	}
	return result
}
