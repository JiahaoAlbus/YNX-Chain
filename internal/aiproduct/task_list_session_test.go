package aiproduct

import (
	"fmt"
	"testing"
)

func TestP08TaskListSessionHistoryAndPagination(t *testing.T) {
	s, conversation, _ := p08TaskStore(t)
	session := ProductSession{Account: conversation.Account, DeviceID: "holder-a"}
	s.state.Tasks = make(map[string]TaskRecord)
	s.state.Actions = make(map[string]ActionRecord)
	s.state.TaskRuns = make(map[string]taskModelRun)
	s.state.TaskActionOutcomes = make(map[string]storedTaskActionOutcome)
	for i := 0; i < 105; i++ {
		id := fmt.Sprintf("task-%03d", i)
		s.state.Tasks[id] = TaskRecord{ID: id, Account: session.Account, ConversationID: conversation.ID, Holder: "holder-b", Revision: 2, Generation: 2, Status: "READY", AgentConfigurationID: "private-config", AgentConfigurationRevision: 9}
		switch i % 3 {
		case 0:
			s.state.Actions[id] = ActionRecord{Account: session.Account, ToolStep: &ToolStepBinding{TaskID: id, Holder: session.DeviceID}}
		case 1:
			s.state.TaskRuns[id] = taskModelRun{Account: session.Account, TaskID: id, Holder: session.DeviceID}
		case 2:
			s.state.TaskActionOutcomes[id] = storedTaskActionOutcome{View: TaskActionOutcomeView{Principal: TaskStorePrincipal{Account: session.Account, DeviceID: session.DeviceID}, TaskID: id}}
		}
	}
	// History for another account or device cannot authorize discovery.
	for _, id := range []string{"task-200", "task-201"} {
		s.state.Tasks[id] = TaskRecord{ID: id, Account: session.Account, ConversationID: conversation.ID, Holder: "holder-b", Revision: 1, Generation: 1, Status: "DRAFT"}
	}
	s.state.TaskRuns["wrong-account"] = taskModelRun{Account: "other-account", TaskID: "task-200", Holder: session.DeviceID}
	s.state.Actions["wrong-device"] = ActionRecord{Account: session.Account, ToolStep: &ToolStepBinding{TaskID: "task-201", Holder: "other-device"}}
	first, err := s.ListTasksForSession(session, "")
	if err != nil || len(first.Tasks) != 100 || !first.HasMore || first.NextID != "task-099" {
		t.Fatalf("first page = %+v, %v", first, err)
	}
	second, err := s.ListTasksForSession(session, first.NextID)
	if err != nil || len(second.Tasks) != 5 || second.HasMore || second.NextID != "task-104" {
		t.Fatalf("second page = %+v, %v", second, err)
	}
	for _, page := range []TaskPage{first, second} {
		for _, task := range page.Tasks {
			if task.AgentConfigurationID != "" || task.AgentConfigurationRevision != 0 {
				t.Fatalf("old holder received current holder configuration: %+v", task)
			}
		}
	}
}
