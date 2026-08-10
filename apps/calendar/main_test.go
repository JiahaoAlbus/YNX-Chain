package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdmissionIsBoundedAndRecovers(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	handler := withAdmission(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusNoContent)
	}), 1)
	firstDone := make(chan int, 1)
	go func() {
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
		firstDone <- recorder.Code
	}()
	<-entered

	overflow := httptest.NewRecorder()
	handler.ServeHTTP(overflow, httptest.NewRequest(http.MethodGet, "/", nil))
	if overflow.Code != http.StatusServiceUnavailable || overflow.Header().Get("Retry-After") != "1" {
		t.Fatalf("unbounded or unsafe overflow response: %d %q", overflow.Code, overflow.Body.String())
	}
	close(release)
	if code := <-firstDone; code != http.StatusNoContent {
		t.Fatalf("admitted request failed: %d", code)
	}
}
