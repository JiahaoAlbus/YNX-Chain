//go:build unix

package main

import (
	"io"
	"testing"
)

func TestRuntimeConsumerRemoteCLIRequiresPlanAndIndependentPinTogether(t *testing.T) {
	for _, extra := range [][]string{{"--runtime-upgrade-plan", "plan.json"}, {"--runtime-upgrade-plan-hash", "pin"}} {
		args := append(remoteOperatorArgs(), extra...)
		if _, err := parseOptions(args, io.Discard); err == nil {
			t.Fatal("remote runtime source accepted partial independent pins")
		}
	}
	args := append(remoteOperatorArgs(), "--runtime-upgrade-plan", "plan.json", "--runtime-upgrade-plan-hash", "pin")
	got, err := parseOptions(args, io.Discard)
	if err != nil || got.runtimePlan != "plan.json" || got.runtimePlanHash != "pin" {
		t.Fatal("complete independent read-only plan configuration rejected", err)
	}
}
