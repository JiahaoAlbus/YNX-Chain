package commerce

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type heldCommerceAIGateway struct {
	started chan struct{}
	release chan struct{}
}

func (g heldCommerceAIGateway) Generate(context.Context, AIJob) (string, error) {
	close(g.started)
	<-g.release
	return "private provider result", nil
}

func TestCommerceLateAICompletionCannotReviveDeletedOrCancelledJobs(t *testing.T) {
	for _, action := range []string{"privacy deletion", "cancel", "cancel and delete", "superseded attempt"} {
		t.Run(action, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "commerce.json")
			s, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			_, buyer := actor(t, 72)
			job, err := s.CreateAIJob(buyer, AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Private comparison context", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "held-ai-completion-key"})
			if err != nil {
				t.Fatal(err)
			}
			gateway := heldCommerceAIGateway{started: make(chan struct{}), release: make(chan struct{})}
			done := make(chan error, 1)
			go func() { _, err := s.RunAIJob(context.Background(), buyer, job.ID, gateway); done <- err }()
			<-gateway.started
			switch action {
			case "privacy deletion":
				_, err = s.DeleteBuyerDataRequest(buyer, "delete-while-ai-running", nil)
			case "cancel", "cancel and delete":
				_, err = s.CancelAIJob(buyer, job.ID)
				if err == nil && action == "cancel and delete" {
					err = s.DeleteAIJob(buyer, job.ID)
				}
			case "superseded attempt":
				// A restored or replaced running attempt must not consume a prior
				// provider's result even when it has the same actor and job ID.
				s.mu.Lock()
				current := s.s.AIJobs[job.ID]
				current.RunAttemptID = "different-running-attempt"
				s.s.AIJobs[job.ID] = current
				err = s.persistLocked()
				s.mu.Unlock()
			}
			if err != nil {
				close(gateway.release)
				<-done
				t.Fatal(err)
			}
			before, _ := json.Marshal(s.s)
			close(gateway.release)
			if err := <-done; !errors.Is(err, ErrNotFound) && !errors.Is(err, ErrInvalidState) {
				t.Fatalf("late result was not rejected: %v", err)
			}
			after, _ := json.Marshal(s.s)
			if !bytes.Equal(before, after) {
				t.Fatal("late provider completion changed the committed state")
			}
			reopened, err := Open(path)
			if err != nil {
				t.Fatal(err)
			}
			if current, ok := reopened.s.AIJobs[job.ID]; ok && current.Result != "" {
				t.Fatal("private late result was persisted")
			}
			if action == "privacy deletion" || action == "cancel and delete" {
				if _, ok := reopened.s.AIJobs[job.ID]; ok {
					t.Fatal("deleted job was recreated")
				}
			}
		})
	}
}

func TestCommerceAIProviderDoesNotStartWhenAdmissionCannotPersist(t *testing.T) {
	path := filepath.Join(t.TempDir(), "commerce.json")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, buyer := actor(t, 72)
	job, err := s.CreateAIJob(buyer, AIInput{Workflow: "search_comparison", ContextClasses: []string{"public_catalog"}, ContextSummary: "Private context", EstimateUnits: 1, PermissionGranted: true, IdempotencyKey: "failed-ai-admission-key"})
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(s.s)
	if err := os.Mkdir(path+".tmp", 0o700); err != nil {
		t.Fatal(err)
	}
	gateway := heldCommerceAIGateway{started: make(chan struct{}), release: make(chan struct{})}
	close(gateway.release)
	if _, err := s.RunAIJob(context.Background(), buyer, job.ID, gateway); err == nil {
		t.Fatal("failed admission was reported as successful")
	}
	select {
	case <-gateway.started:
		t.Fatal("provider started without durable admission")
	default:
	}
	after, _ := json.Marshal(s.s)
	if !bytes.Equal(before, after) {
		t.Fatal("failed AI admission left a running attempt")
	}
}
