package aiproduct

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestP08V6AdapterGetterAndActualObservationBodyBound(t *testing.T) {
	for _, size := range []int{1048576 - 4096, 1048576 + 1} {
		name := "below_v6_limit"
		if size > 1048576 {
			name = "above_v6_limit"
		}
		t.Run(name, func(t *testing.T) {
			store, c, _ := p08TaskStore(t)
			task, err := store.CreateTask(c.Account, c.ID, "holder")
			if err != nil {
				t.Fatal(err)
			}
			server := &Server{store: store}
			source, err := server.OpenTaskStoreSource()
			if err != nil {
				t.Fatal(err)
			}
			defer source.Close()
			session := ProductSession{Account: c.Account, DeviceID: task.Holder, ID: "PUBLIC-v6-reader"}
			runID := "PUBLIC-run"
			key := modelRunKey(c.Account, task.ID, runID)
			nonce, cipher, err := store.encrypt(c.Account, task.ID, key+":answer", strings.Repeat("X", size))
			if err != nil {
				t.Fatal(err)
			}
			store.state.TaskRuns = map[string]taskModelRun{key: {ID: key, RunID: runID, TaskID: task.ID, Account: c.Account, Holder: task.Holder, Generation: 1, Status: "COMPLETED", ReturnState: taskModelReturnVerified, AnswerNonce: nonce, AnswerCipher: cipher}}
			observation, err := source.ObserveOriginalTaskRead(context.Background(), server, session, p08ReadCall("/api/tasks/"+task.ID+"/runs/"+runID))
			if size > 1048576 {
				if observation != nil || !errors.Is(err, ErrTaskV6ObservationBodyLimit) {
					t.Fatalf("oversize signed observation allowed: %v", err)
				}
				if store.state.TaskRuns[key].AnswerCipher != cipher {
					t.Fatal("original result was truncated or rewritten")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			body, err := observation.Body()
			if err != nil || len(body) > 1048576 {
				t.Fatal("not actual bounded response")
			}
			var view taskRunView
			if json.Unmarshal(body, &view) != nil || len(view.Content) != size {
				t.Fatal("actual body changed below bound")
			}
			meta, _ := observation.View()
			if meta.Status != http.StatusOK || meta.Decision != "OBSERVED" || meta.BodyBytes != uint64(len(body)) {
				t.Fatal("bounded actual read was not observed")
			}
		})
	}
	var absent *Server
	if source, err := absent.OpenTaskStoreSource(); source != nil || err == nil {
		t.Fatal("nil Server produced a Store")
	}
}
