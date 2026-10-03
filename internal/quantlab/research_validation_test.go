package quantlab

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

type countedResearchMarket struct{ calls int }

func (m *countedResearchMarket) History(string, int) ([]Bar, string, error) {
	m.calls++
	return bars(), "fixture://actual-matches", nil
}
func (*countedResearchMarket) Latest(string) (MarketTick, error) { return MarketTick{}, ErrUnavailable }

func TestResearchHTTPRejectsExplicitInvalidAndNullWithoutMarketOrStateMutation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	market := &countedResearchMarket{}
	s, err := New(Config{StatePath: path, MarketData: market})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	server := NewRoleServer(s, "research")
	valid := `{"strategy":{"ID":"research","Name":"Research","Seed":0,"Params":{"fast":3,"slow":8}},"assumptions":{"FeeBPS":0,"SlippageBPS":0,"Seed":0,"LatencyBars":1,"ParticipationBPS":1000,"TrainEnd":24,"WalkForwardWindows":3}}`
	cases := []string{
		strings.Replace(valid, `"fast":3`, `"fast":0`, 1),
		strings.Replace(valid, `"slow":8`, `"slow":3`, 1),
		strings.Replace(valid, `"Seed":0`, `"Seed":9007199254740992`, 1),
		strings.Replace(valid, `"FeeBPS":0`, `"FeeBPS":null`, 1),
		strings.Replace(valid, `"SlippageBPS":0`, `"SlippageBPS":-1`, 1),
		strings.Replace(valid, `"fast":3`, `"fast":null`, 1),
		strings.Replace(valid, `"Name":"Research"`, `"Name":null`, 1),
		strings.Replace(valid, `"fast":3`, `"fast":3,"fast":4`, 1),
		strings.Replace(valid, `"Seed":0`, `"Seed":0,"seed":7`, 1),
	}
	for i, payload := range cases {
		r := httptest.NewRequest(http.MethodPost, "/v1/public/research/backtests/from-market", strings.NewReader(payload))
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		var problem map[string]string
		_ = json.Unmarshal(w.Body.Bytes(), &problem)
		if w.Code != 400 || problem["error"] != "invalid_research_parameters" || problem["errorId"] == "" {
			t.Fatalf("case %d: %d %s", i, w.Code, w.Body.String())
		}
		if market.calls != 0 {
			t.Fatal("invalid request read market")
		}
		after, _ := os.ReadFile(path)
		if !reflect.DeepEqual(before, after) {
			t.Fatal("invalid request changed state")
		}
	}
	// Omission is compatible; explicit zero seed/cost remains valid and visible.
	payload := strings.Replace(valid, `,"Params":{"fast":3,"slow":8}`, "", 1)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/public/research/backtests/from-market", strings.NewReader(payload)))
	var x Experiment
	_ = json.Unmarshal(w.Body.Bytes(), &x)
	if w.Code != 201 || x.Strategy.Params["fast"] != 3 || x.Strategy.Params["slow"] != 8 || x.Strategy.Seed != 0 || x.Assumptions.FeeBPS != 0 {
		t.Fatalf("compatible defaults not returned: %d %s", w.Code, w.Body.String())
	}
	after, _ := os.ReadFile(path)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("public research changed shared state")
	}
}

func TestResearchParametersRejectWithoutPersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.RunBacktest(request()); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*BacktestRequest){
		"fast zero":              func(r *BacktestRequest) { r.Strategy.Params["fast"] = 0 },
		"fast one":               func(r *BacktestRequest) { r.Strategy.Params["fast"] = 1 },
		"slow equal":             func(r *BacktestRequest) { r.Strategy.Params["slow"] = 3 },
		"unsafe seed":            func(r *BacktestRequest) { r.Strategy.Seed = 9007199254740992 },
		"unsafe assumption seed": func(r *BacktestRequest) { r.Assumptions.Seed = 9007199254740992 },
		"unsafe fee":             func(r *BacktestRequest) { r.Assumptions.FeeBPS = 9007199254740992 },
		"negative slippage":      func(r *BacktestRequest) { r.Assumptions.SlippageBPS = -1 },
		"blank name":             func(r *BacktestRequest) { r.Strategy.Name = "   " },
		"long name":              func(r *BacktestRequest) { r.Strategy.Name = strings.Repeat("x", 81) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			r := request()
			mutate(&r)
			if _, err := s.RunBacktest(r); !errors.Is(err, ErrInvalid) {
				t.Fatalf("expected invalid, got %v", err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatal("rejected request changed state")
			}
		})
	}
}

func TestResearchOmittedWindowsReturnEffectiveDefaultsAndReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	r := request()
	r.Strategy.Params = nil
	x, err := s.RunBacktest(r)
	if err != nil {
		t.Fatal(err)
	}
	if x.Strategy.Params["fast"] != 3 || x.Strategy.Params["slow"] != 8 {
		t.Fatalf("not effective defaults: %v", x.Strategy.Params)
	}
	s.Close()
	reopened, err := New(Config{StatePath: path})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reflect.DeepEqual(reopened.state.Experiments[x.ID], x) {
		t.Fatal("reopened experiment changed")
	}
	r = request()
	r.Strategy.Params = map[string]int64{"fast": 9}
	if _, err := reopened.RunBacktest(r); !errors.Is(err, ErrInvalid) {
		t.Fatal("omitted slow cannot repair incompatible explicit fast")
	}
}
