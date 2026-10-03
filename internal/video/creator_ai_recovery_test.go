package video

import (
	"errors"
	"testing"
)

func TestCreatorStudioAIRecoveryMatchesOriginalOwnerBoundary(t *testing.T) {
	s, c := fixture(t, nil)
	v := upload(t, s, c, "Original collaborative video")
	acceptRole(t, s, c.Owner, c.ID, testEditorAccount, CreatorRoleEditor)
	own, e := s.PrepareAI(c.Owner, v.ID, "summary", []string{"metadata"})
	if e != nil {
		t.Fatal(e)
	}
	editor, e := s.PrepareAI(testEditorAccount, v.ID, "summary", []string{"metadata"})
	if e != nil {
		t.Fatal(e)
	}
	for _, entry := range []struct{ actor, id, other string }{{c.Owner, own.ID, editor.ID}, {testEditorAccount, editor.ID, own.ID}} {
		view, e := s.Studio(entry.actor)
		if e != nil {
			t.Fatal(e)
		}
		if len(view.Videos) != 1 || len(view.AIJobs) != 1 || view.AIJobs[0].ID != entry.id {
			t.Fatalf("AI owner isolation removed collaborative video or leaked private context: %s %+v", entry.actor, view.AIJobs)
		}
		if _, e = s.GetAI(entry.actor, entry.other); !errors.Is(e, ErrForbidden) {
			t.Fatal("direct original owner boundary differs from Studio")
		}
	}
	restarted, e := NewService(s.cfg)
	if e != nil {
		t.Fatal(e)
	}
	view, e := restarted.Studio(c.Owner)
	if e != nil || len(view.AIJobs) != 1 || view.AIJobs[0].ID != own.ID {
		t.Fatal("cold recovery lost own saved request")
	}
}
