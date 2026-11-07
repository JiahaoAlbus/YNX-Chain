//go:build cgo && (linux || darwin)

package main

import (
	"context"
	"errors"
	"testing"
	"time"

	sourceparentprofile "github.com/JiahaoAlbus/YNX-Chain/packages/wallet-auth/go/sourceparentprofile"
	"github.com/cometbft/cometbft/libs/log"
)

func TestObserverCLINormalOriginalSourcePartialWithoutStart(t *testing.T) {
	options, conf := observerCommandFixture(t, "atomic-json")
	process, cancel := context.WithCancel(context.Background())
	defer cancel()
	n, held, err := constructObserverNode(process, conf, log.NewNopLogger(), options)
	if err != nil || n == nil || held == nil {
		t.Fatal("normal mother caller", err)
	}
	custody, ok := held.(*observerCustody)
	if !ok || custody.startup == nil {
		t.Fatal("actual mother caller lost Source owner")
	}
	defer custody.Close()
	defer n.OnStop()
	select {
	case <-custody.startup.Ready():
	case <-time.After(3 * time.Second):
		t.Fatal("optional original factory blocked")
	}
	var actual sourceparentprofile.Failure
	if !errors.As(custody.startup.SourceFailure(), &actual) || !actual.Present || actual.Code != 1 {
		t.Fatal("normal caller did not call genuine original profile")
	}
	if n.IsRunning() || n.IsListening() || n.PrivValidator() != nil || process.Err() != nil {
		t.Fatal("optional profile affected ordinary process")
	}
	custody.startup.Close()
	if err = custody.Close(); err != nil {
		t.Fatal("drained optional failure became ordinary node failure", err)
	}
	if process.Err() != nil || !custody.startup.LocalComplete() {
		t.Fatal("ordinary process canceled or profile debt hidden")
	}
}
