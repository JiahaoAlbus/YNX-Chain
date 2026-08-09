package video

import (
	"os"
	"testing"
)

func TestLocalObjectStorageBoundsUsageAndCleanup(t *testing.T) {
	storage, err := NewLocalObjectStorage(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = storage.Resolve("../escape"); err == nil {
		t.Fatal("object traversal accepted")
	}
	if _, err = storage.Resolve("/absolute"); err == nil {
		t.Fatal("absolute object key accepted")
	}
	if _, err = storage.EnsurePrefix("vid_test"); err != nil {
		t.Fatal(err)
	}
	path, err := storage.Resolve("vid_test/original")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, []byte("owned"), 0600); err != nil {
		t.Fatal(err)
	}
	if used, err := storage.Usage("vid_test"); err != nil || used != 5 {
		t.Fatalf("usage=%d err=%v", used, err)
	}
	if err = storage.RemovePrefix("vid_test"); err != nil {
		t.Fatal(err)
	}
	if used, err := storage.Usage("vid_test"); err != nil || used != 0 {
		t.Fatalf("removed usage=%d err=%v", used, err)
	}
}
