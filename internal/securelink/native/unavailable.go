//go:build !securelink_openssl || !cgo

package native

import (
	"context"
	"net"
	"time"
)

type Context struct{}
type Conn struct{}

func (*Conn) ID() ConnectionID { return ConnectionID{} }

func NewContext(Config) (*Context, error)                              { return nil, ErrUnavailable }
func (*Context) Close() error                                          { return nil }
func (*Context) Client(context.Context, net.Conn) (*Conn, error)       { return nil, ErrUnavailable }
func (*Context) Server(context.Context, net.Conn) (*Conn, error)       { return nil, ErrUnavailable }
func (*Conn) Snapshot() State                                          { return State{} }
func (*Conn) ExportKeyingMaterial(string, []byte, int) ([]byte, error) { return nil, ErrUnavailable }
func (*Conn) Read([]byte) (int, error)                                 { return 0, ErrUnavailable }
func (*Conn) Write([]byte) (int, error)                                { return 0, ErrUnavailable }
func (*Conn) Close() error                                             { return nil }
func (*Conn) LocalAddr() net.Addr                                      { return nil }
func (*Conn) RemoteAddr() net.Addr                                     { return nil }
func (*Conn) SetDeadline(time.Time) error                              { return ErrUnavailable }
func (*Conn) SetReadDeadline(time.Time) error                          { return ErrUnavailable }
func (*Conn) SetWriteDeadline(time.Time) error                         { return ErrUnavailable }
