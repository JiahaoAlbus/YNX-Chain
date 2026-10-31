package aiproduct

import "time"

// TaskEvent contains only tenant-owned orchestration references, never prompt,
// token, proof or tool input bytes. Sequence belongs to this task, not a tenant
// or server-global log. This is distinct from the task revision used by CAS.
type TaskEvent struct {
	Sequence uint64    `json:"sequence"`
	Type     string    `json:"type"`
	ObjectID string    `json:"objectId"`
	At       time.Time `json:"at"`
}

const taskEventPageSize = 100

func (s *Store) appendTaskEventLocked(taskID string, minimum uint64, kind, objectID string) error {
	if minimum == 0 {
		return ErrTaskConflict
	}
	events := s.state.TaskEvents[taskID]
	sequence := minimum
	if len(events) > 0 {
		previous := events[len(events)-1].Sequence
		if previous == ^uint64(0) {
			return ErrTaskConflict
		}
		if previous+1 > sequence {
			sequence = previous + 1
		}
	}
	if s.state.TaskEvents == nil {
		s.state.TaskEvents = make(map[string][]TaskEvent)
	}
	s.state.TaskEvents[taskID] = append(events, TaskEvent{Sequence: sequence, Type: kind, ObjectID: objectID, At: s.now().UTC()})
	return nil
}

func (s *Store) restoreTaskEventsLocked(taskID string, previous []TaskEvent, existed, wasNil bool) {
	if wasNil {
		s.state.TaskEvents = nil
		return
	}
	if existed {
		s.state.TaskEvents[taskID] = previous
		return
	}
	delete(s.state.TaskEvents, taskID)
}

func (s *Store) taskEventProjectionLocked(task TaskRecord, after uint64) (TaskProjection, error) {
	events := s.state.TaskEvents[task.ID]
	latest := task.Revision
	if len(events) > 0 {
		latest = events[len(events)-1].Sequence
	}
	if after > latest {
		return TaskProjection{}, ErrTaskCursor
	}
	projection := TaskProjection{TaskRecord: task, Cursor: after, LatestCursor: latest, Events: []TaskEvent{}, Steps: []ActionRecord{}}
	if len(events) == 0 {
		// A historical record without events remains a metadata snapshot, not
		// fabricated execution history or approval evidence.
		projection.Cursor = latest
		projection.Changed = after < latest
		return projection, nil
	}
	seen := map[string]bool{}
	for _, event := range events {
		if event.Sequence <= after {
			continue
		}
		if len(projection.Events) == taskEventPageSize {
			projection.HasMore = true
			break
		}
		projection.Events = append(projection.Events, event)
		projection.Cursor = event.Sequence
		if record, ok := s.state.Actions[event.ObjectID]; ok && !seen[record.ID] && record.Account == task.Account && record.ToolStep != nil && record.ToolStep.TaskID == task.ID {
			projection.Steps = append(projection.Steps, publicToolStep(record))
			seen[record.ID] = true
		}
	}
	projection.Changed = len(projection.Events) > 0
	return projection, nil
}
