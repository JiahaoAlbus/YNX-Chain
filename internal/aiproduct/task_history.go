package aiproduct

import "os"

// Prior holders may recover their own original metadata, never see the new
// holder's queue or model output. Auth independently qualifies actual queries.
func (s *Store) readTaskProjectionForSession(session ProductSession, id string, after uint64) (TaskProjection, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	task, err := s.ownedTaskLocked(session.Account, id)
	if err != nil {
		return TaskProjection{}, err
	}
	if session.DeviceID == "" {
		return TaskProjection{}, os.ErrNotExist
	}
	if task.Holder == session.DeviceID {
		return s.taskEventProjectionLocked(task, after)
	}
	visible := map[string]bool{}
	for id, record := range s.state.Actions {
		if record.Account == session.Account && record.ToolStep != nil && record.ToolStep.TaskID == task.ID && record.ToolStep.Holder == session.DeviceID && record.ToolStep.Generation < task.Generation {
			visible[id] = true
		}
	}
	for id, run := range s.state.TaskRuns {
		if run.Account == session.Account && run.TaskID == task.ID && run.Holder == session.DeviceID && run.Generation < task.Generation {
			visible[id] = true
		}
	}
	if len(visible) == 0 && !s.taskSessionHasHistoryLocked(session.Account, session.DeviceID, task.ID) {
		return TaskProjection{}, os.ErrNotExist
	}
	projection, err := s.taskEventProjectionLocked(task, after)
	if err != nil {
		return TaskProjection{}, err
	}
	events := []TaskEvent{}
	for _, event := range projection.Events {
		if visible[event.ObjectID] {
			events = append(events, event)
		}
	}
	steps := []ActionRecord{}
	for _, record := range projection.Steps {
		if visible[record.ID] {
			// Grant locators and the new queue are not historical read rights.
			record.ToolStep.TaskGrantRef = ""
			steps = append(steps, record)
		}
	}
	projection.Events, projection.Steps = events, steps
	projection.RecoveryOnly = true
	projection.AgentConfigurationID = ""
	projection.AgentConfigurationRevision = 0
	return projection, nil
}
