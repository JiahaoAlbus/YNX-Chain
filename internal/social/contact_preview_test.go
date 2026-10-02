package social

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestContactConfirmationRejectsChangedResolvedIdentity(t *testing.T) {
	service, now := testService(t)
	alice, bob, replacement := newFixture(t, 117), newFixture(t, 118), newFixture(t, 119)
	login, err := service.Login(signedLogin(t, service, alice, now))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(service, testResolver{account: replacement.account}).Handler())
	defer server.Close()
	body := []byte(fmt.Sprintf(`{"idempotencyKey":"confirmed-target","source":"handle","value":"bob_social","expectedAccount":%q}`, bob.account))
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contact-requests", login.Token, body)
	defer response.Body.Close()
	if response.StatusCode != http.StatusConflict || len(service.state.Requests) != 0 {
		t.Fatal("changed identity after preview created a request")
	}
}

func TestContactPreviewDoesNotGrantRelationshipAndRequiresAuthentication(t *testing.T) {
	service, _ := testService(t)
	server := httptest.NewServer(NewServer(service, testResolver{}).Handler())
	defer server.Close()
	response := doRequest(t, http.MethodPost, server.URL+"/social/v1/contacts/preview", "", []byte(`{"source":"handle","value":"bob_social"}`))
	defer response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized || len(service.state.Requests) != 0 || len(service.state.Contacts) != 0 {
		t.Fatal("unauthenticated preview granted access or changed relationships")
	}
}
