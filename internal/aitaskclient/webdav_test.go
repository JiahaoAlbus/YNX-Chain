package aitaskclient

import "testing"

func TestP08WebDAVNormalRoutes(t *testing.T) {
	for _, row := range []struct{ action, method, path string }{{"webdav-deliver", "POST", "/api/tasks/task_original/webdav"}, {"webdav-query", "POST", "/api/tasks/task_original/webdav/original_operation/query"}, {"webdav-result", "GET", "/api/tasks/task_original/webdav/original_operation"}} {
		r, err := Resolve(Request{Action: row.action, TaskID: "task_original", StepID: "original_operation"})
		if err != nil || r.Method != row.method || r.Path != row.path || !r.Private {
			t.Fatalf("original route changed: %+v %v", r, err)
		}
		if _, err := Resolve(Request{Action: row.action, TaskID: "../other", StepID: "original_operation"}); err == nil {
			t.Fatal("unbound task route accepted")
		}
	}
	if _, err := Resolve(Request{Action: "webdav-query", TaskID: "task_original", StepID: "http://other/object"}); err == nil {
		t.Fatal("model URL accepted as original operation")
	}
}
