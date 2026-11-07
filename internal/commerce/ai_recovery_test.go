package commerce

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAIOriginalCreationLookupIsColdReadOnlyAndBound(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shop.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, buyer := actor(t, 71)
	_, foreign := actor(t, 72)
	input := AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Only selected public product IDs", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "original-ai-create-key"}
	job, err := s.CreateAIJob(buyer, input)
	if err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	cold, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		got, e := cold.LookupAIJobIntent(buyer, input)
		if e != nil || got.ID != job.ID || got.Status != "permission_granted" || got.RunAttemptID != "" {
			t.Fatal(got, e)
		}
		got.AllowedActions[0] = "pay"
		got.ContextClasses[0] = "private_key"
	}
	got, _ := cold.AIJob(buyer, job.ID)
	if got.AllowedActions[0] != "draft_comparison" || got.ContextClasses[0] != "public_catalog" {
		t.Fatal("read result aliases original state")
	}
	changed := input
	changed.ContextSummary = "replacement"
	if _, e := cold.LookupAIJobIntent(buyer, changed); !errors.Is(e, ErrConflict) {
		t.Fatal("changed intent accepted", e)
	}
	if _, e := cold.LookupAIJobIntent(foreign, input); !errors.Is(e, ErrNotFound) {
		t.Fatal("foreign creation visible", e)
	}
	missing := input
	missing.IdempotencyKey = "missing-original-key"
	if _, e := cold.LookupAIJobIntent(buyer, missing); !errors.Is(e, ErrNotFound) {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("query wrote snapshot or began model execution")
	}
}

func TestAIRecentJobsAndWalletProjectionKeepCurrentActor(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 71)
	_, other := actor(t, 72)
	input := AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Public product details", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "current-ai-original"}
	job, e := s.CreateAIJob(buyer, input)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.CreateAIJob(other, input)
	if e != nil {
		t.Fatal(e)
	}
	rows := s.recentAIJobs(buyer)
	if len(rows) != 1 || rows[0].ID != job.ID {
		t.Fatal("foreign job listed")
	}
	v := &verifiedBusinessRequest{walletAccount: "ynx_current", principal: Principal{Account: buyer, Role: "buyer"}}
	got := buyerWalletWire(job, v).(map[string]any)
	if got["WalletActor"] != "ynx_current" || got["Actor"] != buyer {
		t.Fatal(got)
	}
	unrelated := job
	unrelated.Actor = other
	if _, ok := buyerWalletWire(unrelated, v).(map[string]any)["WalletActor"]; ok {
		t.Fatal("foreign association")
	}
	fake := map[string]any{"Actor": buyer, "ID": job.ID}
	if _, ok := buyerWalletWire(fake, v).(map[string]any)["WalletActor"]; ok {
		t.Fatal("untyped data became association")
	}
}

func TestAINormalReadAndIntentRecoveryUseExistingV2Authority(t *testing.T) {
	s, _ := Open("")
	_, buyer := actor(t, 71)
	_, other := actor(t, 72)
	in := AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Public comparison", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "http-original-ai-key"}
	job, e := s.CreateAIJob(buyer, in)
	if e != nil {
		t.Fatal(e)
	}
	server := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: buyer, role: "buyer"}})
	body, _ := json.Marshal(in)
	if w := businessHTTPRequest(server, "GET", "/api/ai/jobs/"+job.ID, "", ""); w.Code != 401 {
		t.Fatal("read fell back to bearer", w.Code)
	}
	for i, p := range []string{"/api/ai/jobs", "/api/ai/jobs/" + job.ID, "/api/ai/jobs/intent-lookup"} {
		method, b := "GET", ""
		if strings.HasSuffix(p, "intent-lookup") {
			method, b = "POST", string(body)
		}
		w := businessHTTPRequest(server, method, p, strings.Repeat(string(rune('b'+i)), 43), b)
		if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte(job.ID)) {
			t.Fatal(p, w.Code, w.Body.String())
		}
	}
	foreign := NewServer(s, ServerConfig{businessV2: controlledBusinessVerifier{account: other, role: "buyer"}})
	if w := businessHTTPRequest(foreign, "GET", "/api/ai/jobs/"+job.ID, strings.Repeat("z", 43), ""); w.Code != 404 {
		t.Fatal("foreign job read", w.Code, w.Body.String())
	}
	got, _ := s.AIJob(buyer, job.ID)
	if got.Status != "permission_granted" || got.RunAttemptID != "" {
		t.Fatal("read ran provider", got)
	}
}
