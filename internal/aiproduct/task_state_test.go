package aiproduct

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
)

func p08TaskStore(t *testing.T) (*Store, Conversation, []byte) {
	t.Helper()
	key := bytes.Repeat([]byte{83}, 32) // Isolated content encryption fixture only.
	s, err := NewStore(filepath.Join(t.TempDir(), "state.json"), key)
	if err != nil {
		t.Fatal(err)
	}
	c, err := s.CreateConversation("tenant-a", "P08 fixture")
	if err != nil {
		t.Fatal(err)
	}
	return s, c, key
}

func TestT_P08_01(t *testing.T) {
	s, c, key := p08TaskStore(t)
	for _, input := range [][3]string{
		{"", c.ID, "human"}, {"  ", c.ID, "human"},
		{"tenant-a", "missing", "human"}, {"tenant-b", c.ID, "human"},
		{"tenant-a", c.ID, ""}, {"tenant-a", c.ID, " \t"},
	} {
		if task, err := s.CreateTask(input[0], input[1], input[2]); err == nil || task != (TaskRecord{}) {
			t.Fatalf("invalid create returned success: %+v, %v", task, err)
		}
	}
	// Legacy snapshots may omit Tasks entirely.
	s.state.Tasks = nil
	task, err := s.CreateTask("tenant-a", c.ID, "agent-a")
	if err != nil {
		t.Fatal(err)
	}
	if task.ID == "" || task.Account != "tenant-a" || task.ConversationID != c.ID || task.Holder != "agent-a" ||
		task.Revision != 1 || task.Generation != 1 || task.Status != "DRAFT" || task.CreatedAt.IsZero() || task.CreatedAt != task.UpdatedAt {
		t.Fatalf("invalid initial record: %+v", task)
	}
	if len(s.state.Permissions) != 0 || len(s.state.Actions) != 0 {
		t.Fatal("creating task granted permission or created tool work")
	}
	second, err := s.CreateTask("tenant-a", c.ID, "human")
	if err != nil || second.ID == task.ID {
		t.Fatalf("tasks are not independent: %+v, %v", second, err)
	}
	restarted, err := NewStore(s.path, key)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := restarted.ReadTaskProjection("tenant-a", task.ID, 0)
	if err != nil || !reflect.DeepEqual(projection.TaskRecord, task) || projection.Cursor != 1 || !projection.Changed {
		t.Fatalf("restart lost initial task: %+v, %v", projection, err)
	}
}

func TestT_P08_02(t *testing.T) {
	s, c, _ := p08TaskStore(t)
	task, err := s.CreateTask("tenant-a", c.ID, "agent-a")
	if err != nil {
		t.Fatal(err)
	}
	for _, account := range []string{"tenant-b", "", " \t"} {
		for _, id := range []string{task.ID, "missing"} {
			projection, err := s.ReadTaskProjection(account, id, ^uint64(0))
			if !errors.Is(err, os.ErrNotExist) || !reflect.DeepEqual(projection, TaskProjection{}) {
				t.Fatalf("existence leak for %q/%q: %+v, %v", account, id, projection, err)
			}
		}
	}
	projection, err := s.ReadTaskProjection("tenant-a", task.ID, 1)
	if err != nil || projection.Changed || projection.Cursor != 1 {
		t.Fatalf("unchanged cursor: %+v, %v", projection, err)
	}
	if _, err := s.ReadTaskProjection("tenant-a", task.ID, 2); !errors.Is(err, ErrTaskCursor) {
		t.Fatalf("future cursor accepted: %v", err)
	}
	// Returning a value projection cannot mutate authoritative state.
	projection.Holder = "intruder"
	if got, _ := s.ReadTaskProjection("tenant-a", task.ID, 0); got.Holder != "agent-a" {
		t.Fatal("projection aliases authoritative task")
	}
	for _, status := range []string{"", "UNKNOWN", "canceled", "unrecognized"} {
		invalid := task
		invalid.Status = status
		s.state.Tasks[task.ID] = invalid
		if _, err := s.ReadTaskProjection("tenant-a", task.ID, 0); !errors.Is(err, ErrTaskState) {
			t.Fatalf("read accepted invalid state %q: %v", status, err)
		}
		if _, err := s.HandoffTask("tenant-a", task.ID, 1, 1, "agent-a", "human"); !errors.Is(err, ErrTaskState) {
			t.Fatalf("handoff accepted invalid state %q: %v", status, err)
		}
	}
	s.state.Tasks[task.ID] = task
	// Live ACL changes must invalidate even a known task ID.
	c.Account = "tenant-b"
	s.state.Conversations[c.ID] = c
	if _, err := s.ReadTaskProjection("tenant-a", task.ID, 0); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("changed conversation ACL ignored: %v", err)
	}
	delete(s.state.Conversations, c.ID)
	if _, err := s.ReadTaskProjection("tenant-a", task.ID, 0); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted conversation still readable: %v", err)
	}
}

func TestT_P08_03(t *testing.T) {
	t.Run("competing_handoffs_and_restart", func(t *testing.T) {
		s, c, key := p08TaskStore(t)
		task, err := s.CreateTask("tenant-a", c.ID, "agent-a")
		if err != nil {
			t.Fatal(err)
		}
		action := ActionRecord{ID: "original-op", Account: "tenant-a", ConversationID: c.ID,
			Status: "UNKNOWN", GatewayID: "original-remote", Description: "firstCause: response lost", Evidence: []string{"original-receipt"}}
		s.state.Actions[action.ID] = action
		if err := s.saveLocked(); err != nil {
			t.Fatal(err)
		}
		for _, account := range []string{"tenant-b", "", " "} {
			for _, id := range []string{task.ID, "missing"} {
				if _, err := s.HandoffTask(account, id, 1, 1, "agent-a", "human"); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("foreign handoff leaked existence: %v", err)
				}
			}
		}
		for _, holders := range [][2]string{{"", "human"}, {"agent-a", " "}} {
			if _, err := s.HandoffTask("tenant-a", task.ID, 1, 1, holders[0], holders[1]); err == nil {
				t.Fatal("blank holder accepted")
			}
		}
		start := make(chan struct{})
		results := make(chan error, 2)
		var wg sync.WaitGroup
		for _, holder := range []string{"human-device-1", "human-device-2"} {
			wg.Add(1)
			go func(holder string) {
				defer wg.Done()
				<-start
				_, err := s.HandoffTask("tenant-a", task.ID, 1, 1, "agent-a", holder)
				results <- err
			}(holder)
		}
		close(start)
		wg.Wait()
		close(results)
		winners, conflicts := 0, 0
		for err := range results {
			if err == nil {
				winners++
			} else if errors.Is(err, ErrTaskConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if winners != 1 || conflicts != 1 {
			t.Fatalf("winners=%d conflicts=%d", winners, conflicts)
		}
		got, err := s.ReadTaskProjection("tenant-a", task.ID, 1)
		if err != nil || got.Revision != 2 || got.Generation != 2 || !got.Changed || got.Cursor != 2 || got.Holder == "agent-a" {
			t.Fatalf("CAS did not advance exactly once: %+v, %v", got, err)
		}
		for _, cas := range []struct {
			rev, gen uint64
			holder   string
		}{
			{1, 2, got.Holder}, {2, 1, got.Holder}, {2, 2, "agent-a"},
		} {
			if _, err := s.HandoffTask("tenant-a", task.ID, cas.rev, cas.gen, cas.holder, "agent-b"); !errors.Is(err, ErrTaskConflict) {
				t.Fatalf("stale writer accepted: %v", err)
			}
		}
		restarted, err := NewStore(s.path, key)
		if err != nil {
			t.Fatal(err)
		}
		persisted, err := restarted.ReadTaskProjection("tenant-a", task.ID, 1)
		if err != nil || !reflect.DeepEqual(persisted, got) || !reflect.DeepEqual(restarted.state.Actions[action.ID], action) || len(restarted.state.Permissions) != 0 {
			t.Fatalf("restart changed task/history/authority: %+v, %v", persisted, err)
		}
	})

	for _, operation := range []string{"create_nil_map", "create_existing_map", "handoff"} {
		t.Run("save_failure_"+operation, func(t *testing.T) {
			s, c, key := p08TaskStore(t)
			task, err := s.CreateTask("tenant-a", c.ID, "agent-a")
			if err != nil {
				t.Fatal(err)
			}
			if operation == "create_nil_map" {
				s.state.Tasks = nil
			}
			// Exercise rollback when auditLocked drops its oldest entry.
			for len(s.state.Audits) < 10000 {
				s.auditLocked("tenant-a", "fixture", c.ID, "isolated audit retention fixture")
			}
			if err := s.saveLocked(); err != nil {
				t.Fatal(err)
			}
			before, err := json.Marshal(s.state)
			if err != nil {
				t.Fatal(err)
			}
			originalPath := s.path
			diskBefore, err := os.ReadFile(originalPath)
			if err != nil {
				t.Fatal(err)
			}
			// Existing state file cannot also be a directory: deterministic
			// filesystem failure even when the test process has elevated rights.
			s.path = filepath.Join(originalPath, "impossible.json")
			var returned TaskRecord
			if operation == "handoff" {
				returned, err = s.HandoffTask("tenant-a", task.ID, 1, 1, "agent-a", "human")
			} else {
				returned, err = s.CreateTask("tenant-a", c.ID, "human")
			}
			var firstCause *os.PathError
			if err == nil || returned != (TaskRecord{}) || !errors.As(err, &firstCause) || firstCause.Op != "mkdir" {
				t.Fatalf("save failure lost first cause or returned success: %+v, %v", returned, err)
			}
			after, marshalErr := json.Marshal(s.state)
			if marshalErr != nil || !bytes.Equal(before, after) {
				t.Fatalf("failed save changed in-memory state/audit: %v", marshalErr)
			}
			diskAfter, err := os.ReadFile(originalPath)
			if err != nil || !bytes.Equal(diskBefore, diskAfter) {
				t.Fatalf("failed save changed original disk state: %v", err)
			}
			restarted, err := NewStore(originalPath, key)
			if err != nil {
				t.Fatal(err)
			}
			if operation != "create_nil_map" {
				got, err := restarted.ReadTaskProjection("tenant-a", task.ID, 0)
				if err != nil || !reflect.DeepEqual(got.TaskRecord, task) {
					t.Fatalf("failed save persisted handoff: %+v, %v", got, err)
				}
			}
		})
	}
}
