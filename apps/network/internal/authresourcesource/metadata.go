package networkresourcesource

import (
	"bytes"
	"context"
)

// These bounded owned DATA originals are output only. No metadata value can
// construct a Source or a permission, and no caller supplies resource paths.
type metadataNative interface {
	metadata(handle, uint32) ([]byte, error)
}

func (s *Source) metadata(ctx context.Context, kind uint32) ([]byte, error) {
	done, e := s.enter(ctx)
	if e != nil {
		return nil, e
	}
	defer done()
	abi, ok := s.abi.(metadataNative)
	if !ok {
		return nil, ErrNotSupplied
	}
	if e = s.abi.current(s.h); e != nil {
		return nil, e
	}
	raw, e := abi.metadata(s.h, kind)
	if e != nil {
		return nil, e
	}
	owned := bytes.Clone(raw)
	if e = s.abi.current(s.h); e != nil {
		return nil, e
	}
	if e = s.post(ctx); e != nil {
		return nil, e
	}
	return owned, nil
}
func (s *Source) ReadOriginalInputRefDATA(ctx context.Context) ([]byte, error) {
	return s.metadata(ctx, 1)
}
func (s *Source) ReadOriginalConsumerIdentityDATA(ctx context.Context) ([]byte, error) {
	return s.metadata(ctx, 2)
}
func (s *Source) ReadOriginalSourceCurrentRefDATA(ctx context.Context) ([]byte, error) {
	return s.metadata(ctx, 3)
}
