package quantlab

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSavedPaperReceiptReadIsDurableHaltSafeAndNeverMutatesState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path, MarketData: quantBrowserQAMarket{}})
	if err != nil {
		t.Fatal(err)
	}
	experiment, err := s.RunBacktest(request())
	if err != nil {
		t.Fatal(err)
	}
	key := "quant-native-paper-11111111-1111-4111-8111-111111111111"
	order, err := s.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, "buy", 1000000, key, PaperExecutionCosts{Policy: PaperCostPolicyV1, FeeBPS: 10, SlippageBPS: 5})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.submitPaperRisk("kill", "fixture-halt-receipt-read", "Confirmed receipt fixture halt", 0, 0); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	// Cold-start without a market client or the caller's current strategy.
	restarted, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/v1/wallet/paper/order-receipt?key="+key, nil)
	for range 3 {
		result, err := restarted.savedPaperOrderReceipt(r)
		if err != nil || !reflect.DeepEqual(result, order) {
			t.Fatal("saved receipt changed/re-executed", err)
		}
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("read changed durable state")
	}
	if !restarted.state.Paper.KillSwitch || len(restarted.state.Paper.Orders) != 1 {
		t.Fatal("read resumed/duplicated order")
	}
	if _, err = s.SubmitPaperSignalWithCostsFromMarket(experiment.Strategy.StrategyHash, "buy", 1000000, "new-forbidden-after-halt", PaperExecutionCosts{}); err != ErrForbidden {
		t.Fatal("halt was bypassed")
	}
	for _, suffix := range []string{"", "?key=invalid", "?key=" + key + "&key=" + key, "?key=" + key + "&account=foreign", "?key=" + key + "&tenant=foreign"} {
		if _, err = restarted.savedPaperOrderReceipt(httptest.NewRequest("GET", "/v1/wallet/paper/order-receipt"+suffix, nil)); err != ErrInvalid {
			t.Fatal("unsafe selector accepted", suffix, err)
		}
	}
	foreign, err := New(Config{StatePath: filepath.Join(t.TempDir(), "other.json")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = foreign.savedPaperOrderReceipt(r); err != ErrUnavailable {
		t.Fatal("missing/foreign receipt claimed resolved", err)
	}
	// Corrupt duplicates are ambiguous, never whichever row happens to be first.
	restarted.state.Paper.Orders = append(restarted.state.Paper.Orders, order)
	if err = restarted.save(); err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.savedPaperOrderReceipt(r); err != ErrConflict {
		t.Fatal("ambiguous receipt accepted", err)
	}
}

func TestExistingReceiptLookupNeverAllocatesMissingTenantOrMapping(t *testing.T) {
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "root.json")}
	server, err := NewTenantServer(cfg, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	if _, err = server.existingPaperReceiptWorkspace("owner-a"); err != ErrUnavailable {
		t.Fatal("missing mapping accepted")
	}
	if server.paperMappings != nil || len(server.servers) != 0 {
		t.Fatal("lookup initialized mappings/cache")
	}
	mapping, err := server.paperMappingStore()
	if err != nil {
		t.Fatal(err)
	}
	account := "owner-a"
	id := hash(account)
	mapping.state.PaperWorkspaceBindings = map[string]paperWorkspaceBinding{}
	mapping.state.PaperWorkspaceBindings[hashBytes([]byte("YNX Quant Paper workspace v1\x00"+account))] = paperWorkspaceBinding{Account: account, TenantID: id, CreatedAt: mapping.cfg.Now()}
	if err = mapping.save(); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(cfg.StatePath + ".paper-workspaces")
	for range 3 {
		if _, err = server.existingPaperReceiptWorkspace(account); err != ErrUnavailable {
			t.Fatal("missing tenant allocated")
		}
	}
	after, _ := os.ReadFile(cfg.StatePath + ".paper-workspaces")
	if !bytes.Equal(before, after) {
		t.Fatal("lookup changed mapping audit/state")
	}
	files, err := os.ReadDir(server.root)
	if err != nil || len(files) != 0 || len(server.servers) != 0 {
		t.Fatal("lookup created tenant")
	}
	tenant, err := New(Config{StatePath: filepath.Join(server.root, id+".json")})
	if err != nil {
		t.Fatal(err)
	}
	tenant.state.Paper.Orders = []PaperOrder{{ID: "paper-1", IdempotencyKey: "quant-native-paper-11111111-1111-4111-8111-111111111111"}}
	if err = tenant.save(); err != nil {
		t.Fatal(err)
	}
	original, _ := os.ReadFile(tenant.cfg.StatePath)
	observed, err := server.existingPaperReceiptWorkspace(account)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = observed.savedPaperOrderReceipt(httptest.NewRequest("GET", "/v1/wallet/paper/order-receipt?key="+tenant.state.Paper.Orders[0].IdempotencyKey, nil)); err != nil {
		t.Fatal(err)
	}
	result, _ := os.ReadFile(tenant.cfg.StatePath)
	if !bytes.Equal(original, result) || len(server.servers) != 0 {
		t.Fatal("read changed tenant")
	}
	if _, err = server.existingPaperReceiptWorkspace("owner-b"); err != ErrUnavailable {
		t.Fatal("foreign receipt accepted")
	}
}
