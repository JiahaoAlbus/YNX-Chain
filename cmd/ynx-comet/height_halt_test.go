package main

import (
	"io"
	"path/filepath"
	"strings"
	"testing"

	"github.com/spf13/pflag"
)

func TestOperatorHeightHaltNormalFlagsAndNoLegacyFallback(t *testing.T) {
	session := strings.Repeat("a", 64)
	complete := []string{"--height-halt-control", filepath.Join("/original/application", "operator-height-halt-"+session+".json"), "--operator-plan-sha256", strings.Repeat("b", 64), "--height-halt-session-id", session}
	for _, name := range []string{"complete", "no-control", "no-plan-pin", "no-session", "uppercase-session", "zero-plan", "foreign-directory", "original-state-alias", "duplicate-plan", "duplicate-control"} {
		t.Run(name, func(t *testing.T) {
			p := pqOptions{state: "/original/application/state", genesisHash: strings.Repeat("c", 64), recoveryFD: -1}
			flags := pflag.NewFlagSet("start", pflag.ContinueOnError)
			flags.SetOutput(io.Discard)
			registerHeightHaltFlags(flags, &p)
			args := append([]string(nil), complete...)
			switch name {
			case "no-control":
				args = args[2:]
			case "no-plan-pin":
				args = append(args[:2], args[4:]...)
			case "no-session":
				args = args[:4]
			case "uppercase-session":
				args[5] = strings.ToUpper(session)
			case "zero-plan":
				args[3] = strings.Repeat("0", 64)
			case "foreign-directory":
				args[1] = "/foreign/operator-height-halt-" + session + ".json"
			case "original-state-alias":
				args[1] = p.state
			case "duplicate-plan":
				args = append(args, "--operator-plan-sha256", strings.Repeat("d", 64))
			case "duplicate-control":
				args = append(args, "--height-halt-control", args[1])
			}
			err := flags.Parse(args)
			if err == nil {
				err = p.validateHeightHalt()
			}
			if name == "complete" {
				if err != nil || !p.enabled() || !p.heightHaltConfigured() {
					t.Fatal("normal complete halt identity rejected or selected stock legacy", err)
				}
				if configureOperatorHeightHalt(nil, p) == nil {
					t.Fatal("halt acquired a node identity from absent node")
				}
			} else if err == nil {
				t.Fatal("incomplete/ambiguous halt authority accepted", name)
			}
		})
	}
	if err := (pqOptions{}).validateHeightHalt(); err != nil {
		t.Fatal("disabled maintenance changed normal startup", err)
	}
	if err := configureOperatorHeightHalt(nil, pqOptions{}); err != nil {
		t.Fatal("disabled maintenance touched node", err)
	}
}
