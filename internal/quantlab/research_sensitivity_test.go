package quantlab

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestResearchAdjacentWindowsKeepExplicitSensitivityParameters(t *testing.T) {
	for _, fast := range []int64{2, 9, 24} {
		t.Run(fmt.Sprint(fast), func(t *testing.T) {
			s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json")})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			r := request()
			r.Strategy.Params = map[string]int64{"fast": fast, "slow": fast + 1}
			x, err := s.RunBacktest(r)
			if err != nil {
				t.Fatal(err)
			}
			// fast+1 and slow-1 each make both averages identical, so their
			// actual sensitivity calculation must have no trades or return.
			for _, label := range []string{"fast+1", "slow-1"} {
				m := x.Sensitivity[label]
				if !m.NoTrade || m.Trades != 0 || m.ReturnBPS != 0 {
					t.Fatalf("equal-window sensitivity silently changed parameters: %s %+v", label, m)
				}
			}
		})
	}
}
