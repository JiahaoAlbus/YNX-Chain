package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/cloud"
	"github.com/JiahaoAlbus/YNX-Chain/internal/developerauthority"
)

// PUBLIC lifecycle-only boundaries. This is NOT a usable OriginalSource,
// database, publication authority or OCI resource. No real service is started.
type publicStartupSource struct {
	developerauthority.OriginalSource
	developerauthority.OriginalPublicationSource
	developerauthority.OriginalPublicationSelector
}
type publicCatalogPool struct {
	catalog              *developerauthority.Catalog
	catalogErr, closeErr error
	closes               int
}

func (p *publicCatalogPool) Catalog() (*developerauthority.Catalog, error) {
	return p.catalog, p.catalogErr
}
func (p *publicCatalogPool) Close() error { p.closes++; return p.closeErr }
func publicStartupInputs() *ideDeploymentStartupInputs {
	return &ideDeploymentStartupInputs{Source: &publicStartupSource{}, Runtime: cloud.IDEExistingOCIConfig{RuntimeOrigin: "https://runtime.public.invalid", HTTPPort: 3000}}
}

func TestIDERuntimeUnconfiguredAndMissingSourceCannotOpenPool(t *testing.T) {
	owner, err := attachOriginalIDEDeploymentRuntime(context.Background(), &cloud.Server{}, nil)
	if owner != nil || err != nil {
		t.Fatal("unconfigured runtime changed existing service")
	}
	for _, source := range []developerauthority.OriginalSource{nil, (*publicStartupSource)(nil)} {
		in := publicStartupInputs()
		in.Source = source
		calls := 0
		owner, err := attachIDEDeploymentRuntime(context.Background(), &cloud.Server{}, in, func(context.Context, developerauthority.PostgresCatalogConfig, developerauthority.OriginalSource) (ideCatalogPool, error) {
			calls++
			return nil, nil
		}, func(*cloud.Server, *developerauthority.Catalog, cloud.IDEExistingOCIConfig) error { return nil })
		if owner != nil || !errors.Is(err, errIDEStartup) || calls != 0 {
			t.Fatal("missing source opened pool")
		}
	}
}

func TestIDERuntimeStartupFailuresCaptureAndDrainOriginalPartial(t *testing.T) {
	for _, mode := range []string{"open-partial", "not-ready", "nil-catalog", "install", "cancel-after-open"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			pool := &publicCatalogPool{catalog: &developerauthority.Catalog{}, closeErr: errors.New("PUBLIC secret URL must not escape")}
			installed := 0
			owner, err := attachIDEDeploymentRuntime(ctx, &cloud.Server{}, publicStartupInputs(), func(context.Context, developerauthority.PostgresCatalogConfig, developerauthority.OriginalSource) (ideCatalogPool, error) {
				switch mode {
				case "open-partial":
					return pool, errors.New("PUBLIC secret URL must not escape")
				case "not-ready":
					pool.catalogErr = errors.New("PUBLIC schema mismatch")
				case "nil-catalog":
					pool.catalog = nil
				case "cancel-after-open":
					cancel()
				}
				return pool, nil
			}, func(*cloud.Server, *developerauthority.Catalog, cloud.IDEExistingOCIConfig) error {
				installed++
				return errors.New("PUBLIC install error")
			})
			if owner == nil || !errors.Is(err, errIDEStartup) || strings.Contains(err.Error(), "secret") || pool.closes != 1 {
				t.Fatal("partial owner discarded or first cause exposed", pool.closes)
			}
			if mode != "install" && installed != 0 {
				t.Fatal("not-ready pool installed")
			}
			for i := 0; i < 2; i++ {
				if !errors.Is(owner.Close(), errIDEClose) {
					t.Fatal("first close UNKNOWN lost")
				}
			}
			if pool.closes != 1 {
				t.Fatal("pool close repeated")
			}
		})
	}
}

func TestIDERuntimePoolRemainsOwnedUntilNormalClose(t *testing.T) {
	pool := &publicCatalogPool{catalog: &developerauthority.Catalog{}}
	installed := 0
	owner, err := attachIDEDeploymentRuntime(context.Background(), &cloud.Server{}, publicStartupInputs(), func(context.Context, developerauthority.PostgresCatalogConfig, developerauthority.OriginalSource) (ideCatalogPool, error) {
		return pool, nil
	}, func(_ *cloud.Server, c *developerauthority.Catalog, _ cloud.IDEExistingOCIConfig) error {
		installed++
		if c != pool.catalog {
			t.Fatal("original catalog replaced")
		}
		return nil
	})
	if err != nil || owner == nil || pool.closes != 0 || installed != 1 {
		t.Fatal("lifecycle mapping failed", err)
	}
	var wait sync.WaitGroup
	for i := 0; i < 16; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if err := owner.Close(); err != nil {
				t.Error(err)
			}
		}()
	}
	wait.Wait()
	if pool.closes != 1 {
		t.Fatal("normal close not exactly once", pool.closes)
	}
}
