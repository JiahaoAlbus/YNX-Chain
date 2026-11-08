package main

import (
	"errors"
	"reflect"
	"testing"
	"time"

	taskv6 "github.com/JiahaoAlbus/YNX-Chain/internal/authaitaskv6"
)

// PUBLIC cleanup outcome controls. These cannot install an Auth or LINK owner.
func TestNormalTaskServiceCleanupStopsBeforeBorrowedParents(t *testing.T) {
	for _, failed := range []string{"", "v6", "receiver", "runtime"} {
		t.Run("failure_"+failed, func(t *testing.T) {
			cause := errors.New("PUBLIC original cleanup uncertainty")
			var order []string
			stage := func(name string) func() error {
				return func() error {
					order = append(order, name)
					if name == failed {
						return cause
					}
					return nil
				}
			}
			c := &originalTaskServiceCleanup{v6: stage("v6"), receiver: stage("receiver"), runtime: stage("runtime")}
			want := []string{"v6", "receiver", "runtime"}
			if failed == "v6" {
				want = want[:1]
			} else if failed == "receiver" {
				want = want[:2]
			}
			for round := 0; round < 2; round++ {
				err := c.close()
				if (failed == "" && err != nil) || (failed != "" && err != cause) {
					t.Fatal("original first cause changed", err)
				}
				if !reflect.DeepEqual(order, want) {
					t.Fatalf("crossed child or replayed close: %v want %v", order, want)
				}
			}
			_, held := retainedOriginalTaskServiceCleanup.Load(c)
			if held != (failed != "") {
				t.Fatal("actual uncertain owners not retained, or healthy owners leaked")
			}
			// Only the test's controlled closures are released by this fixture.
			retainedOriginalTaskServiceCleanup.Delete(c)
		})
	}
}

func TestNormalTaskServiceCleanupActualUnavailablePartial(t *testing.T) {
	v6, err := taskv6.OpenOriginalAITaskActionServerV6(nil)
	if v6 == nil || err == nil {
		t.Fatal("missing original server lost partial")
	}
	c := &originalTaskServiceCleanup{v6: func() error { return closeOriginalTaskV6(v6, time.Second) }}
	if err := c.close(); err != nil {
		t.Fatal(err)
	}
	if _, held := retainedOriginalTaskServiceCleanup.Load(c); held {
		t.Fatal("fully drained actual partial retained as UNKNOWN")
	}
}
