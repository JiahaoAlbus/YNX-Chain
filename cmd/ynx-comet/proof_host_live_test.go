//go:build unix

package main

import (
	"bytes"
	"strings"
	"testing"

	"github.com/spf13/pflag"
)

func TestProofHostLiveNormalFlagsNeverSelectStockOrPartial(t *testing.T) {
	for _, args := range [][]string{
		{"--proof-host-live-policy", "/original/live.json"},
		{"--proof-host-live-policy-sha256", strings.Repeat("a", 64)},
		{"--proof-host-live-policy", "/original/live.json", "--proof-host-live-policy-sha256", strings.Repeat("a", 64)},
		{"--proof-host-live-policy", "/original/live.json", "--proof-host-live-policy", "/other/live.json"},
	} {
		p := pqOptions{recoveryFD: -1}
		f := pflag.NewFlagSet("live", pflag.ContinueOnError)
		registerProofHostLiveFlags(f, &p)
		err := f.Parse(args)
		if err == nil && (!p.enabled() || p.validate() == nil) {
			t.Fatal("partial live options selected stock/bootstrap", args)
		}
	}
	p := pqOptions{recoveryFD: -1}
	live, err := prepareOperatorProofHostLive(nil, nil, p)
	if err != nil || live != nil || p.enabled() {
		t.Fatal("default-off changed original stock mode", err)
	}
	p.proofLivePolicy = "/original/live.json"
	p.proofLivePolicyHash = strings.Repeat("a", 64)
	p.schedule = "/original/schedule.json"
	p.scheduleHash = strings.Repeat("b", 64)
	if _, err = prepareOperatorProofHostLive(nil, nil, p); err == nil {
		t.Fatal("missing actual owning Application accepted")
	}
}

func TestRequestProofHostSourceNormalCommandRejectsUnpinnedInputs(t *testing.T) {
	for _, args := range [][]string{{}, {"--proof-host-live-policy", "/missing"}, {"--proof-host-live-policy", "/missing", "--proof-host-live-policy-sha256", strings.Repeat("a", 64), "--source-plan", "/attacker"}, {"--proof-host-live-policy", "/missing", "--proof-host-live-policy", "/replacement", "--proof-host-live-policy-sha256", strings.Repeat("a", 64)}} {
		cmd := newRequestProofHostSourceCommand()
		var out bytes.Buffer
		cmd.SetOut(&out)
		cmd.SetErr(&out)
		cmd.SetArgs(args)
		if err := cmd.Execute(); err == nil {
			t.Fatal("unapproved trigger accepted", args)
		}
		if strings.Contains(out.String(), "request_published") {
			t.Fatal("failed trigger reported publication")
		}
	}
}
