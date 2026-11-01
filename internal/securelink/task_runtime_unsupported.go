//go:build !linux && !darwin

package securelink

import (
	"context"
	"net/http"
)

type taskRuntimeRequest struct{}

func (*taskRuntimeRequest) localCurrent(*http.Request) error   { return ErrUnavailable }
func (*taskRuntimeRequest) freshCurrent(context.Context) error { return ErrUnavailable }

type OriginalTaskRuntimeForwarder struct{}

func NewOriginalTaskRuntimeForwarder(TaskRuntimeForwarderConfig) (*OriginalTaskRuntimeForwarder, error) {
	return nil, ErrUnavailable
}
func (*OriginalTaskRuntimeForwarder) Forward(context.Context, *http.Request, string, []byte) (TaskRuntimeReply, error) {
	return TaskRuntimeReply{}, ErrUnavailable
}
func (*OriginalTaskRuntimeForwarder) Retire() error              { return ErrUnavailable }
func (*OriginalTaskRuntimeForwarder) Join(context.Context) error { return ErrUnavailable }
func (*OriginalTaskRuntimeForwarder) Close() error               { return ErrUnavailable }
