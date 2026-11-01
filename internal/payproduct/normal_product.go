package payproduct

import (
	"errors"
	"io"
	"sync"
)

// NormalCentralPayEndpoint is the existing daemon's fixed central endpoint and
// original LINK configuration. These settings are not Native Source authority.
type NormalCentralPayEndpoint struct {
	Origin         string
	APIKey         string
	LINKConfigPath string
}

// NormalProduct owns one original product Service/Store and its central LINK
// transport. Core/Cloud/Source/listener ownership is never transferred here.
// Keep a nonnil partial before inspecting OpenNormalProduct's error, then close
// it on rollback. On normal shutdown retire and drain all users, close Source
// successfully, then close this parent. A failed drain/child close retains it.
type NormalProduct struct {
	mu            sync.Mutex
	service       *Service
	transport     io.Closer
	first         error
	closeSelected bool
	closeErr      error
}

// OpenNormalProduct is shared by the original standalone daemon and the
// original Core-owned private host. It calls the same real constructors, with
// no callback client, replacement PayAPI, default HTTP or new ledger path.
func OpenNormalProduct(cfg Config, central NormalCentralPayEndpoint) (*NormalProduct, error) {
	result := &NormalProduct{}
	if cfg.PayAPI != nil {
		result.first = errors.New("normal Pay parent does not accept a replacement PayAPI")
		return result, result.first
	}
	api, err := NewProductionHTTPPayAPI(central.Origin, central.APIKey, central.LINKConfigPath)
	if err != nil {
		result.first = err
		return result, err
	}
	// Capture the original concrete factory's transport now; later mutation of
	// the legacy HTTPPayAPI.Client field cannot redirect owned cleanup.
	closer, ok := api.Client.Transport.(io.Closer)
	if !ok {
		result.first = errors.New("normal Pay central transport has no owned lifecycle")
		return result, result.first
	}
	result.transport = closer
	cfg.PayAPI = api
	result.service, result.first = New(cfg)
	return result, result.first
}

func (p *NormalProduct) Service() *Service {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.first != nil || p.closeSelected {
		return nil
	}
	return p.service
}

func (p *NormalProduct) Err() error {
	if p == nil {
		return errors.New("normal Pay product not supplied")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.first
}

// Store has no held file descriptor or independent Close: it is the actual
// Service's memory plus atomic durable file, not another database to open/close.
// Preserve a failed transport close even if its own later Close returns nil.
func (p *NormalProduct) Close() error {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closeSelected {
		return p.closeErr
	}
	p.closeSelected = true
	if p.transport != nil {
		p.closeErr = p.transport.Close()
	}
	if p.first == nil && p.closeErr != nil {
		p.first = p.closeErr
	}
	return p.closeErr
}
