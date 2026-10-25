package main

import (
	"context"
	"errors"
	"reflect"
	"sync"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

var errIDEStartup = errors.New("original IDE deployment runtime startup unconfirmed")
var errIDEClose = errors.New("original IDE deployment catalog close unconfirmed")

// Dedicated original Auth/config input, not the legacy file-session producer.
// No HTTP, renderer, environment grant or default Source populates this slot.
// Until the original producer is supplied, normal deployment stays disabled.
var originalIDEDeploymentStartup *ideDeploymentStartupInputs

type ideDeploymentStartupInputs struct {
	Source  developerauthority.OriginalSource
	Catalog developerauthority.PostgresCatalogConfig
	Runtime cloud.IDEExistingOCIConfig
}

type ideCatalogPool interface {
	Catalog() (*developerauthority.Catalog, error)
	Close() error
}

type ideRuntimeOwner struct {
	pool     ideCatalogPool
	once     sync.Once
	closeErr error
}

func (*ideRuntimeOwner) String() string {
	return "original IDE runtime owner (private inputs redacted)"
}
func (o *ideRuntimeOwner) Close() error {
	if o == nil {
		return errIDEClose
	}
	o.once.Do(func() {
		if o.pool == nil || o.pool.Close() != nil {
			o.closeErr = errIDEClose
		}
	})
	return o.closeErr
}

func missingIDEValue(v any) bool {
	if v == nil {
		return true
	}
	value := reflect.ValueOf(v)
	switch value.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Func, reflect.Map, reflect.Slice, reflect.Chan:
		return value.IsNil()
	}
	return false
}

func attachOriginalIDEDeploymentRuntime(ctx context.Context, server *cloud.Server, inputs *ideDeploymentStartupInputs) (*ideRuntimeOwner, error) {
	return attachIDEDeploymentRuntime(ctx, server, inputs, func(ctx context.Context, cfg developerauthority.PostgresCatalogConfig, source developerauthority.OriginalSource) (ideCatalogPool, error) {
		owner, err := developerauthority.OpenPostgresCatalog(ctx, cfg, source)
		if owner == nil {
			return nil, err
		}
		return owner, err
	}, func(server *cloud.Server, catalog *developerauthority.Catalog, cfg cloud.IDEExistingOCIConfig) error {
		authority, err := cloud.NewAuthIDEDeploymentAuthority(catalog)
		if err != nil {
			return err
		}
		executor, err := cloud.NewOCIIDEDeploymentExecutor(cfg)
		if err != nil {
			return err
		}
		return server.EnableIDEDeployments(authority, executor)
	})
}

// These private seams test ownership failures only. Production always calls
// the fixed original Auth opener and the original real authority/executor.
func attachIDEDeploymentRuntime(ctx context.Context, server *cloud.Server, inputs *ideDeploymentStartupInputs, open func(context.Context, developerauthority.PostgresCatalogConfig, developerauthority.OriginalSource) (ideCatalogPool, error), install func(*cloud.Server, *developerauthority.Catalog, cloud.IDEExistingOCIConfig) error) (*ideRuntimeOwner, error) {
	if inputs == nil {
		return nil, nil
	}
	if ctx == nil || ctx.Err() != nil || server == nil || missingIDEValue(inputs.Source) || open == nil || install == nil || inputs.Runtime.RuntimeOrigin == "" || inputs.Runtime.HTTPPort < 1024 || inputs.Runtime.HTTPPort > 65535 {
		return nil, errIDEStartup
	}
	if _, ok := inputs.Source.(developerauthority.OriginalPublicationSource); !ok {
		return nil, errIDEStartup
	}
	if _, ok := inputs.Source.(developerauthority.OriginalPublicationSelector); !ok {
		return nil, errIDEStartup
	}
	pool, err := open(ctx, inputs.Catalog, inputs.Source)
	if missingIDEValue(pool) {
		return nil, errIDEStartup
	}
	// Capture even an errored partial before checking status. Failed startup
	// cannot discard an allocated pool or replace close-UNKNOWN with nil/ready.
	owner := &ideRuntimeOwner{pool: pool}
	fail := func() (*ideRuntimeOwner, error) { _ = owner.Close(); return owner, errIDEStartup }
	if err != nil || ctx.Err() != nil {
		return fail()
	}
	catalog, err := pool.Catalog()
	if err != nil || catalog == nil {
		return fail()
	}
	if err = install(server, catalog, inputs.Runtime); err != nil || ctx.Err() != nil {
		return fail()
	}
	return owner, nil
}
