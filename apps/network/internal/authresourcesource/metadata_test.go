package networkresourcesource

import (
	"context"
	"errors"
	"testing"
)

type publicMetadataNative struct {
	publicNative
	body         []byte
	lateMetadata func()
}

func (n *publicMetadataNative) metadata(handle, uint32) ([]byte, error) {
	if n.lateMetadata != nil {
		n.lateMetadata()
	}
	return n.body, nil
}
func TestMetadataOwnedCopyAndPostCurrent(t *testing.T) {
	n := &publicMetadataNative{body: []byte("PUBLIC original metadata")}
	s, e := openNative(context.Background(), n)
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.ReadOriginalConsumerIdentityDATA(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	n.body[0] = 'X'
	if b[0] != 'P' {
		t.Fatal("not owned")
	}
	n.lateMetadata = func() { n.late = ErrRetired }
	if b, e := s.ReadOriginalInputRefDATA(context.Background()); b != nil || !errors.Is(e, ErrRetired) {
		t.Fatal(b, e)
	}
}
func TestMetadataLateCancelNoPublication(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	n := &publicMetadataNative{body: []byte("PUBLIC"), lateMetadata: cancel}
	s, e := openNative(ctx, n)
	if e != nil {
		t.Fatal(e)
	}
	if b, e := s.ReadOriginalSourceCurrentRefDATA(ctx); b != nil || !errors.Is(e, context.Canceled) {
		t.Fatal(b, e)
	}
}
