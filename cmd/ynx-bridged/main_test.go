package main

import (
	"strings"
	"testing"
	"time"
)

func TestBridgeIntegerEnvironmentDefaultsFailClosed(t *testing.T) {
	t.Setenv("YNX_BRIDGE_TEST_INTEGER", "")
	value, err := envIntOrDefault("YNX_BRIDGE_TEST_INTEGER", 17)
	if err != nil || value != 17 {
		t.Fatalf("expected empty environment value to use fallback, value=%d err=%v", value, err)
	}

	t.Setenv("YNX_BRIDGE_TEST_INTEGER", " 23 ")
	value, err = envIntOrDefault("YNX_BRIDGE_TEST_INTEGER", 17)
	if err != nil || value != 23 {
		t.Fatalf("expected valid environment integer, value=%d err=%v", value, err)
	}

	t.Setenv("YNX_BRIDGE_TEST_INTEGER", "not-an-integer")
	_, err = envIntOrDefault("YNX_BRIDGE_TEST_INTEGER", 17)
	if err == nil || !strings.Contains(err.Error(), "YNX_BRIDGE_TEST_INTEGER") {
		t.Fatalf("expected invalid environment integer to fail closed, err=%v", err)
	}
}

func TestBridgeDurationEnvironmentDefaultsFailClosed(t *testing.T) {
	t.Setenv("YNX_BRIDGE_TEST_DURATION", "")
	value, err := envDurationOrDefault("YNX_BRIDGE_TEST_DURATION", 2*time.Minute)
	if err != nil || value != 2*time.Minute {
		t.Fatalf("expected empty environment value to use fallback, value=%s err=%v", value, err)
	}

	t.Setenv("YNX_BRIDGE_TEST_DURATION", " 45s ")
	value, err = envDurationOrDefault("YNX_BRIDGE_TEST_DURATION", 2*time.Minute)
	if err != nil || value != 45*time.Second {
		t.Fatalf("expected valid environment duration, value=%s err=%v", value, err)
	}

	t.Setenv("YNX_BRIDGE_TEST_DURATION", "soon")
	_, err = envDurationOrDefault("YNX_BRIDGE_TEST_DURATION", 2*time.Minute)
	if err == nil || !strings.Contains(err.Error(), "YNX_BRIDGE_TEST_DURATION") {
		t.Fatalf("expected invalid environment duration to fail closed, err=%v", err)
	}
}
