package quantlab

import (
	"archive/tar"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productsessionv2"
)

// Actual product HTTP, engine and file persistence. The canonical native
// authority is an explicit test double; this is not real Wallet/public approval.
func TestNativePaperWorkspaceOwnsDataWithoutTenantOrRecordsPermission(t *testing.T) {
	_, alice := quantProofFixture(t, "a")
	_, bob := quantProofFixture(t, "c")
	_, oldAccount := quantProofFixture(t, "d")
	_, records := quantProofFixture(t, "e")
	alice["scopes"], bob["scopes"] = []string{quantPaperWorkspaceScope}, []string{quantPaperWorkspaceScope}
	records["scopes"] = []string{"quant:records:read"}
	sessions := map[string]map[string]any{strings.Repeat("a", 64): alice, strings.Repeat("c", 64): bob, strings.Repeat("d", 64): oldAccount, strings.Repeat("e", 64): records}
	var mu sync.Mutex
	used, revoked := map[string]bool{}, map[string]bool{}
	native, err := productsessionv2.NewClient(QuantPrivateAuthority, QuantPrivateSessionPolicy(), privateRoundTrip(func(r *http.Request) (*http.Response, error) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.String() != QuantPrivateAuthority+"/v2/product-sessions/introspect" {
			t.Error("noncanonical authority")
		}
		body, _ := io.ReadAll(r.Body)
		if string(body) != `{"requiredScopes":["quant:paper:workspace"]}` {
			t.Error("scope upgraded or substituted")
		}
		raw, _ := base64.RawURLEncoding.DecodeString(r.Header.Get(productsessionv2.ProofHeader))
		var proof map[string]any
		_ = json.Unmarshal(raw, &proof)
		binding, _ := proof["sessionBinding"].(string)
		nonce, _ := proof["nonce"].(string)
		status := 200
		payload := map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": true, "result": map[string]any{"active": true, "session": sessions[binding]}}
		if revoked[binding] || used[nonce] {
			status = 401
			payload = map[string]any{"schemaVersion": 2, "requestId": r.Header.Get("X-Request-Id"), "ok": false, "error": map[string]string{"code": "SESSION_REVOKED", "message": "Isolated authority refusal"}}
		}
		used[nonce] = true
		encoded, _ := json.Marshal(payload)
		return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}, "Cache-Control": {"no-store"}, "X-Request-Id": {r.Header.Get("X-Request-Id")}}, Body: io.NopCloser(strings.NewReader(string(encoded)))}, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	cfg := Config{StatePath: filepath.Join(t.TempDir(), "state.json"), PrivateSession: native, MarketData: quantBrowserQAMarket{}}
	service, err := NewTenantServer(cfg, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = service.Close() }()
	if _, err := service.baseService.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	backup := filepath.Join(filepath.Dir(cfg.StatePath), "pre-paper.backup.json")
	if _, err := service.baseService.Backup(backup); err != nil {
		t.Fatal(err)
	}
	var sequence atomic.Int64
	header := func(label string) string {
		proof, _ := quantProofFixture(t, label)
		digest := sha256.Sum256([]byte(`{"requiredScopes":["quant:paper:workspace"]}`))
		proof["bodyDigest"] = hex.EncodeToString(digest[:])
		proof["nonce"] = fmt.Sprintf("%032x", sequence.Add(1))
		return quantProofHeader(t, proof)
	}
	call := func(method, path, label, body, tenant string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "https://quant.ynxweb4.com"+path, strings.NewReader(body))
		r.Header.Set("Origin", "https://quant.ynxweb4.com")
		r.Header.Set(TenantHeader, tenant)
		if label != "" {
			r.Header.Set(productsessionv2.ProofHeader, header(label))
		}
		w := httptest.NewRecorder()
		service.ServeHTTP(w, r)
		return w
	}
	for _, label := range []string{"", "d", "e"} {
		w := call("GET", "/v1/wallet/paper/snapshot", label, "", strings.Repeat("f", 64))
		if w.Code != 401 && w.Code != 403 {
			t.Fatalf("old scope authorized Paper: %d", w.Code)
		}
	}
	if service.paperMappings != nil {
		t.Fatal("insufficient scope allocated workspace")
	}
	results := make(chan int, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			results <- call("GET", "/v1/wallet/paper/snapshot", "a", "", strings.Repeat("f", 64)).Code
		}()
	}
	wait.Wait()
	close(results)
	for status := range results {
		if status != 200 {
			t.Fatalf("concurrent own snapshot: %d", status)
		}
	}
	if len(service.paperMappings.state.PaperWorkspaceBindings) != 1 {
		t.Fatal("concurrent approval allocated two workspaces")
	}
	q := request()
	backtest, _ := json.Marshal(map[string]any{"strategy": q.Strategy, "assumptions": q.Assumptions})
	response := call("POST", "/v1/wallet/paper/backtests/from-market", "a", string(backtest), strings.Repeat("c", 64))
	if response.Code != 201 {
		t.Fatalf("own backtest %d", response.Code)
	}
	var experiment Experiment
	_ = json.Unmarshal(response.Body.Bytes(), &experiment)
	orderBody, _ := json.Marshal(map[string]any{"strategyHash": experiment.Strategy.StrategyHash, "side": "buy", "amount": 1_000_000, "idempotencyKey": "isolated-native-paper-intent"})
	first := call("POST", "/v1/wallet/paper/orders", "a", string(orderBody), strings.Repeat("c", 64))
	if first.Code != 201 {
		t.Fatalf("own Paper %d", first.Code)
	}
	var order PaperOrder
	_ = json.Unmarshal(first.Body.Bytes(), &order)
	second := call("POST", "/v1/wallet/paper/orders", "a", string(orderBody), strings.Repeat("f", 64))
	var replay PaperOrder
	_ = json.Unmarshal(second.Body.Bytes(), &replay)
	if second.Code != 201 || replay.ID != order.ID || replay.IdempotencyKey != order.IdempotencyKey {
		t.Fatal("Paper intent replay changed order")
	}
	foreign := call("POST", "/v1/wallet/paper/orders", "c", string(orderBody), strings.Repeat("f", 64))
	if foreign.Code != 400 && foreign.Code != 403 {
		t.Fatalf("foreign strategy accepted %d", foreign.Code)
	}
	for _, path := range []string{"/v1/testnet/orders", "/v1/paper/orders", "/v1/strategies/foreign/schedule"} {
		w := call("POST", path, "a", "{}", strings.Repeat("f", 64))
		if w.Code != 403 {
			t.Fatalf("scope escaped exact routes %s:%d", path, w.Code)
		}
	}
	snapshot := call("GET", "/v1/wallet/paper/snapshot", "c", "", strings.Repeat("f", 64))
	var ownB map[string]any
	_ = json.Unmarshal(snapshot.Body.Bytes(), &ownB)
	var paperB struct {
		Paper PaperState `json:"paper"`
	}
	_ = json.Unmarshal(snapshot.Body.Bytes(), &paperB)
	if snapshot.Code != 200 || ownB["account"] != bob["account"] || len(ownB["strategies"].(map[string]any)) != 0 || len(paperB.Paper.Orders) != 0 {
		t.Fatal("B saw A workspace")
	}
	raw, err := os.ReadFile(cfg.StatePath)
	if err != nil {
		t.Fatal(err)
	}
	// Exact pre-Paper typed reader still accepts the original root envelope.
	// The mapping is a separate durable store, never an unknown business field.
	typ := reflect.TypeOf(state{})
	fields := []reflect.StructField{}
	for i := 0; i < typ.NumField(); i++ {
		field := typ.Field(i)
		if field.Name != "PaperWorkspaceBindings" {
			fields = append(fields, field)
		}
	}
	oldReader := reflect.New(reflect.StructOf(fields))
	if json.Unmarshal(raw, oldReader.Interface()) != nil {
		t.Fatal("old reader decode failed")
	}
	oldDigest := oldReader.Elem().FieldByName("Integrity").String()
	oldReader.Elem().FieldByName("Integrity").SetString("")
	var oldTop map[string]json.RawMessage
	_ = json.Unmarshal(raw, &oldTop)
	if hash(oldReader.Elem().Interface()) != oldDigest || len(oldTop) != 13 {
		t.Fatal("Paper ownership broke the original reader/root envelope")
	}
	mappingPath := cfg.StatePath + ".paper-workspaces"
	bindings, err := os.ReadFile(mappingPath)
	if err != nil {
		t.Fatal(err)
	}
	var aliceTenant string
	for _, binding := range service.paperMappings.state.PaperWorkspaceBindings {
		if binding.Account == alice["account"] {
			aliceTenant = binding.TenantID
		}
	}
	verifyOriginal664PaperRollback(t, cfg.StatePath, filepath.Join(service.root, aliceTenant+".json"))
	if after, _ := os.ReadFile(mappingPath); !bytes.Equal(bindings, after) {
		t.Fatal("old binary changed isolated ownership")
	}
	assertBindings := func() {
		t.Helper()
		current, err := New(Config{StatePath: cfg.StatePath})
		if err != nil {
			t.Fatal(err)
		}
		defer current.Close()
		actual, _ := os.ReadFile(mappingPath)
		if !reflect.DeepEqual(bindings, actual) {
			t.Fatal("rollback lost ownership history")
		}
		w := httptest.NewRecorder()
		NewServer(current).ServeHTTP(w, httptest.NewRequest("GET", "https://quant.ynxweb4.com/v1/wallet/paper/snapshot", nil))
		if w.Code != 503 {
			t.Fatal("disabled current-reader rollback exposed Paper")
		}
		if len(current.state.PaperWorkspaceBindings) != 0 {
			t.Fatal("ownership entered original root state")
		}
	}
	assertBindings()
	for _, operation := range []string{"restore", "delete"} {
		before, _ := os.ReadFile(cfg.StatePath)
		original := service.baseService.store
		service.baseService.store = browserRollbackFailStore{original}
		if operation == "restore" {
			_, err = service.baseService.Restore(backup)
		} else {
			_, err = service.baseService.DeleteAllLocalData("DELETE ALL LOCAL QUANT DATA")
		}
		service.baseService.store = original
		if err == nil {
			t.Fatal("durable failure was reported as success")
		}
		after, _ := os.ReadFile(cfg.StatePath)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("failed restore/delete changed durable history")
		}
		assertBindings()
	}
	if _, err = service.baseService.Restore(backup); err != nil {
		t.Fatal(err)
	}
	assertBindings()
	if len(service.baseService.state.Experiments) != 1 {
		t.Fatal("rollback restore lost original root data")
	}
	if _, err = service.baseService.DeleteAllLocalData("DELETE ALL LOCAL QUANT DATA"); err != nil {
		t.Fatal(err)
	}
	assertBindings()
	if err = service.Close(); err != nil {
		t.Fatal(err)
	}
	service, err = NewTenantServer(cfg, "all")
	if err != nil {
		t.Fatal(err)
	}
	restored := call("GET", "/v1/wallet/paper/snapshot", "a", "", strings.Repeat("c", 64))
	var owned map[string]any
	_ = json.Unmarshal(restored.Body.Bytes(), &owned)
	if restored.Code != 200 || owned["account"] != alice["account"] || len(owned["paper"].(map[string]any)["Orders"].([]any)) != 1 {
		t.Fatal("reopen lost owned Paper or replayed order")
	}
	for _, label := range []string{"", "d", "e"} {
		denied := call("POST", "/v1/wallet/paper/risk/kill", label, `{"reason":"Confirmed native halt","idempotencyKey":"native-risk-http"}`, "")
		if denied.Code != 401 && denied.Code != 403 {
			t.Fatal("risk scope escape", denied.Code)
		}
	}
	for range 2 {
		result := call("POST", "/v1/wallet/paper/risk/kill", "a", `{"reason":"Confirmed native halt","idempotencyKey":"native-risk-http"}`, strings.Repeat("c", 64))
		if result.Code != 201 {
			t.Fatal("native risk failed", result.Code, result.Body.String())
		}
		var receipt map[string]any
		if json.Unmarshal(result.Body.Bytes(), &receipt) != nil || receipt["account"] != alice["account"] || receipt["paper"].(map[string]any)["KillSwitch"] != true {
			t.Fatal("unbound native risk receipt")
		}
	}
	unchanged := call("GET", "/v1/wallet/paper/snapshot", "c", "", "")
	var unchangedB struct {
		Paper PaperState `json:"paper"`
	}
	_ = json.Unmarshal(unchanged.Body.Bytes(), &unchangedB)
	if unchanged.Code != 200 || unchangedB.Paper.KillSwitch {
		t.Fatal("A native risk halted B")
	}
	mu.Lock()
	revoked[strings.Repeat("a", 64)] = true
	mu.Unlock()
	if call("GET", "/v1/wallet/paper/snapshot", "a", "", "").Code != 401 {
		t.Fatal("revoked approval restored workspace access")
	}
	if call("GET", "/v1/wallet/paper/snapshot", "c", "", "").Code != 200 {
		t.Fatal("A revoke affected B")
	}
}

type paperMappingFaultStore struct {
	stateStore
	conflict bool
	closed   int
}

func (s *paperMappingFaultStore) load() (state, bool, error) { return newQuantState(), true, nil }
func (s *paperMappingFaultStore) save(*state) error {
	if s.conflict {
		return errStateConflict
	}
	return errors.New("isolated sidecar write failed")
}
func (s *paperMappingFaultStore) requiresFilesystemLock() bool { return false }
func (s *paperMappingFaultStore) close() error                 { s.closed++; return nil }
func TestPaperMappingWriteFailureAndCASNeverAdoptOwnership(t *testing.T) {
	for _, conflict := range []bool{false, true} {
		store := &paperMappingFaultStore{conflict: conflict}
		mapping := &Service{cfg: Config{StatePath: filepath.Join(t.TempDir(), "mapping"), Now: func() time.Time { return time.Now().UTC() }}, store: store, state: newQuantState()}
		base, err := New(Config{StatePath: filepath.Join(t.TempDir(), "root")})
		if err != nil {
			t.Fatal(err)
		}
		server := &TenantServer{baseService: base, paperMappings: mapping, servers: map[string]*Server{}}
		if _, err := server.paperWorkspace("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"); err == nil {
			t.Fatal("failed ownership save was adopted")
		}
		if len(mapping.state.PaperWorkspaceBindings) != 0 || len(server.servers) != 0 || len(base.state.PaperWorkspaceBindings) != 0 {
			t.Fatal("failed/CAS ownership allocation leaked into memory or tenant")
		}
		if err := server.Close(); err != nil {
			t.Fatal(err)
		}
		if store.closed != 1 {
			t.Fatal("mapping store was not closed exactly once")
		}
	}
	server := &TenantServer{baseService: &Service{cfg: Config{StatePath: " "}}}
	if _, err := server.paperMappingStore(); err == nil {
		t.Fatal("missing durable path initialized a cwd sidecar")
	}
}

func TestPaperMappingPostgresOwnNamespaceAndSharedPool(t *testing.T) {
	url := strings.TrimSpace(os.Getenv("YNX_QUANT_POSTGRES_TEST_URL"))
	if url == "" {
		t.Skip("isolated PostgreSQL runtime not configured; file/CAS doubles are separate evidence")
	}
	config := Config{StatePath: filepath.Join(t.TempDir(), "state"), DatabaseURL: url, StateNamespace: fmt.Sprintf("paper-sidecar-qa-%d", time.Now().UnixNano())}
	server, err := NewTenantServer(config, "all")
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	mapping, err := server.paperMappingStore()
	if err != nil {
		t.Fatal(err)
	}
	rootStore, mappingStore := server.baseService.store.(*postgresStateStore), mapping.store.(*postgresStateStore)
	if rootStore.db != mappingStore.db || mappingStore.ownsDB || mappingStore.key != config.StateNamespace+":paper-workspaces:v1" || rootStore.key == mappingStore.key {
		t.Fatal("ownership sidecar borrowed root namespace or opened another pool")
	}
	if _, err := server.paperWorkspace("ynx10e0525sfrf53yh2aljmm3sn9jq5njk7llqhn80"); err != nil {
		t.Fatal(err)
	}
	if len(server.baseService.state.PaperWorkspaceBindings) != 0 {
		t.Fatal("mapping persisted in original root")
	}
	if err := mapping.Close(); err != nil {
		t.Fatal(err)
	}
	if err := rootStore.db.Ping(); err != nil {
		t.Fatal("closing sidecar closed shared pool")
	}
}

// Compile and execute the exact old implementation against state written by
// the new service, rather than treating a reflected struct as binary evidence.
func verifyOriginal664PaperRollback(t *testing.T, rootPath, tenantPath string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	archiveCommand := exec.CommandContext(ctx, "git", "archive", "664b80b00ac576317524f25b49fc01d1c0db7196", "go.mod", "go.sum", "internal")
	archiveCommand.Dir = filepath.Join("..", "..")
	archive, err := archiveCommand.Output()
	if err != nil {
		t.Fatal("could not extract frozen rollback reader", err)
	}
	directory := t.TempDir()
	reader := tar.NewReader(bytes.NewReader(archive))
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(directory, header.Name)
		if !strings.HasPrefix(path, directory+string(os.PathSeparator)) {
			t.Fatal("archive escaped fixture")
		}
		if header.Typeflag == tar.TypeDir {
			if err := os.MkdirAll(path, 0700); err != nil {
				t.Fatal(err)
			}
			continue
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		contents, err := io.ReadAll(io.LimitReader(reader, 32<<20))
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, contents, 0600); err != nil {
			t.Fatal(err)
		}
	}
	const probe = `package quantlab
import("os";"testing")
func TestFrozen664PaperRollbackProbe(t *testing.T){
 for _,kind:=range []string{"ROOT","TENANT"}{
  path:=os.Getenv("YNX_PAPER_ROLLBACK_"+kind);s,err:=New(Config{StatePath:path});if err!=nil{t.Fatal(err)}
  if kind=="ROOT"&&len(s.state.Experiments)!=1{t.Fatal("original root history lost")}
  if kind=="TENANT"&&len(s.state.Paper.Orders)!=1{t.Fatal("new Paper history unreadable to old binary")}
  if _,err=s.RunBacktest(request());err!=nil{t.Fatal(err)};if err=s.Close();err!=nil{t.Fatal(err)}
  s,err=New(Config{StatePath:path});if err!=nil{t.Fatal(err)}
  if kind=="ROOT"&&len(s.state.Experiments)!=2{t.Fatal("old root save/cold restart failed")}
  if kind=="TENANT"&&len(s.state.Paper.Orders)!=1{t.Fatal("old save dropped new Paper history")};s.Close()
 }
}`
	if err := os.WriteFile(filepath.Join(directory, "internal", "quantlab", "paper_rollback_probe_test.go"), []byte(probe), 0600); err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, "go", "test", "./internal/quantlab", "-run", "^TestFrozen664PaperRollbackProbe$", "-count=1")
	command.Dir = directory
	command.Env = append(os.Environ(), "YNX_PAPER_ROLLBACK_ROOT="+rootPath, "YNX_PAPER_ROLLBACK_TENANT="+tenantPath)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("frozen 664 rollback reader failed: %v\n%s", err, output)
	}
}
