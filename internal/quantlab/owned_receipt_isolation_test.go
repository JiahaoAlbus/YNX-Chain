package quantlab

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOwnedBusinessReceiptsDoNotExposeMutableState(t *testing.T) {
	for _, kind := range []string{"kill", "reconcile", "dataset", "research", "advance", "schedule-stop", "schedule-start"} {
		t.Run(kind, func(t *testing.T) {
			s, err := New(Config{StatePath: filepath.Join(t.TempDir(), "state.json"), MarketData: fixtureMarket{}})
			if err != nil {
				t.Fatal(err)
			}
			defer s.Close()
			experiment, err := s.RunBacktest(request())
			if err != nil {
				t.Fatal(err)
			}
			s.state.Paper.Orders = []PaperOrder{{ID: "retained", Amount: 9007199254740993}}
			s.state.Paper.DailyRisk = &PaperDailyRisk{Loss: 17}
			if err = s.save(); err != nil {
				t.Fatal(err)
			}
			var mutate func()
			switch kind {
			case "kill", "reconcile":
				var receipt PaperState
				if kind == "kill" {
					receipt, err = s.Kill("explicit local QA")
				} else {
					receipt, err = s.Reconcile(s.state.Paper.Cash, s.state.Paper.Position)
				}
				mutate = func() { receipt.Orders[0].Amount = 1; receipt.DailyRisk.Loss = 999 }
			case "dataset":
				input := validDataset(time.Now().UTC())
				var receipt DatasetRecord
				receipt, err = s.RegisterDataset(input)
				mutate = func() { receipt.Lineage[0] = "changed-return"; input.PermittedUses[0] = "changed-input" }
			case "research":
				var receipt Experiment
				receipt, err = s.RunBacktest(request())
				mutate = func() {
					receipt.Strategy.Params["fast"] = 999
					receipt.EquityCurve[0].Equity = -1
					receipt.MetricDefinitions["sharpeMilli"] = "changed"
				}
			case "advance", "schedule-stop", "schedule-start":
				var receipt StrategySpec
				if kind == "advance" {
					receipt, err = s.AdvanceStrategy(experiment.Strategy.ID, LifecycleApproval{TargetStage: StageWalkForward, RiskApproved: true, EvidenceDigest: strings.Repeat("e", 64), Actor: "controlled-owner"})
				} else {
					receipt, err = s.ConfigureStrategySchedule(experiment.Strategy.ID, kind == "schedule-start", 60, request().Assumptions)
				}
				mutate = func() { receipt.Params["fast"] = 999 }
			}
			if err != nil {
				t.Fatal(err)
			}
			before := hash(s.state)
			beforeBytes, err := os.ReadFile(s.cfg.StatePath)
			if err != nil {
				t.Fatal(err)
			}
			mutate()
			if hash(s.state) != before {
				t.Fatal("business receipt or caller input changed retained service state")
			}
			afterBytes, err := os.ReadFile(s.cfg.StatePath)
			if err != nil || !bytes.Equal(beforeBytes, afterBytes) {
				t.Fatalf("observation mutation changed durable bytes: %v", err)
			}
			reopened, err := New(s.cfg)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			if hash(reopened.state) != before {
				t.Fatal("cold instance did not retain the original business effect")
			}
		})
	}
}
