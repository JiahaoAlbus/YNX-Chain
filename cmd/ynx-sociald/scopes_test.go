package main

import (
	"reflect"
	"testing"
)

func TestSocialAllowedScopesMatchApprovedRegistration(t *testing.T) {
	want := []string{"account:read", "profile:link", "social.ai", "social.contacts", "social.feed", "social.messaging", "social.profile"}
	if got := socialAllowedScopes(); !reflect.DeepEqual(got, want) {
		t.Fatalf("daemon registration mismatch: %v", got)
	}
	mutated := socialAllowedScopes()
	mutated[0] = "social.publishing"
	if !reflect.DeepEqual(socialAllowedScopes(), want) {
		t.Fatal("callers must not mutate later policy scope sets")
	}
}
