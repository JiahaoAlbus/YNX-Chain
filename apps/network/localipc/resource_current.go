package localipc

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/apps/network/contribution"
)

var ErrResourceHeld = errors.New("same original resource-current connection required")

// ResourceCurrentConfig is fixed trusted host composition, never a wire
// initializer/registration or Root proof. Normal absent Root/selection keeps it
// nil. It cannot rebind or initialize the Runner. LINK/Auth still authenticate
// their original registered resource reference and opaque native lifetime.
type ResourceCurrentConfig struct {
	Runner           *contribution.Runner
	SelectedResource contribution.ResourceIdentity
	ExpectedClient   ProcessIdentity
}
type ResourceCurrentLifetime struct {
	PartialAcquired  bool `json:"partialAcquired"`
	Retired          bool `json:"retired"`
	Joined           bool `json:"joined"`
	PhysicalComplete bool `json:"physicalComplete"`
}
type ResourceCurrentObservation struct {
	SessionID string                  `json:"sessionId"`
	Server    ProcessIdentity         `json:"server"`
	Caller    ProcessIdentity         `json:"caller"`
	Lifetime  ResourceCurrentLifetime `json:"lifetime"`
}
type ResourceCurrentResult struct {
	Code              string                            `json:"code"`
	Classification    string                            `json:"classification"`
	Authority         bool                              `json:"authority"`
	RegisteredIssuer  bool                              `json:"registeredIssuer"`
	ProductionEnabled bool                              `json:"productionEnabled"`
	ResourceCurrent   *contribution.ResourceCurrentDATA `json:"resourceCurrent,omitempty"`
	Observation       *ResourceCurrentObservation       `json:"observation,omitempty"`
}
type resourceCurrentService struct {
	config   ResourceCurrentConfig
	identity ProcessIdentity
	mu       sync.Mutex
	sessions map[*resourceCurrentSession]struct{}
	closing  bool
	wg       sync.WaitGroup
}
type resourceCurrentSession struct {
	mu                     sync.Mutex
	owner                  *resourceCurrentService
	id                     string
	caller                 ProcessIdentity
	reader                 *contribution.ResourceCurrentReader
	ready                  chan struct{}
	life                   ResourceCurrentLifetime
	first                  error
	drainOnce, releaseOnce sync.Once
}

func newResourceCurrentService(ctx context.Context, cfg *ResourceCurrentConfig) (*resourceCurrentService, error) {
	if cfg == nil {
		return nil, nil
	}
	if cfg.Runner == nil || !validProcessIdentity(cfg.ExpectedClient) || cfg.SelectedResource.SourceID == "" || cfg.SelectedResource.InstanceID == "" || cfg.SelectedResource.ResourceKey == "" {
		return nil, ErrResourceHeld
	}
	if err := CheckProcessIdentity(ctx, cfg.ExpectedClient); err != nil {
		return nil, err
	}
	identity, err := ObserveProcessIdentity(ctx, int32(os.Getpid()))
	if err != nil {
		return nil, err
	}
	return &resourceCurrentService{config: *cfg, identity: identity, sessions: make(map[*resourceCurrentSession]struct{})}, nil
}
func resourceCurrentFamily(op string) bool {
	return op == "resource_current" || op == "resource_current_retire" || op == "resource_current_join" || op == "resource_current_close"
}
func (s *resourceCurrentService) check(ctx context.Context, c *peerConn) error {
	peer, err := kernelPeer(c.UnixConn)
	if err != nil || !peer.Verified() || !peer.pidAvailable || peer.uid != s.config.ExpectedClient.UID || peer.pid != s.config.ExpectedClient.PID || peer != c.peer {
		return ErrResourceIdentity
	}
	if err = CheckProcessIdentity(ctx, s.config.ExpectedClient); err != nil {
		return err
	}
	return CheckProcessIdentity(ctx, s.identity)
}
func resourceCurrentBase() ResourceCurrentResult {
	return ResourceCurrentResult{Code: "UNAVAILABLE", Classification: "UNSIGNED_LOCAL_RESOURCE_CURRENT_DATA"}
}
func resourceCurrentPack(v ResourceCurrentResult) (Result, error) {
	raw, err := json.Marshal(v)
	return Result{Payload: raw}, err
}
func (s *resourceCurrentService) create(ctx context.Context, c *peerConn) (*resourceCurrentSession, error) {
	s.mu.Lock()
	if s.closing {
		s.mu.Unlock()
		return nil, ErrResourceHeld
	}
	lease := &resourceCurrentSession{owner: s, id: endpointID(), caller: s.config.ExpectedClient, ready: make(chan struct{})}
	s.sessions[lease] = struct{}{}
	s.wg.Add(1)
	s.mu.Unlock()
	// Publish the same attempt before borrowing; disconnect can retire it while
	// the original Runner mutex is occupied. Its ready debt is never discarded.
	c.resourceMu.Lock()
	c.resource = lease
	c.resourceMu.Unlock()
	defer close(lease.ready)
	reader, err := s.config.Runner.BorrowCurrentResourceReader(ctx)
	lease.mu.Lock()
	lease.reader = reader
	lease.life.PartialAcquired = reader != nil
	if err != nil {
		lease.first = err
	}
	retired := lease.life.Retired
	lease.mu.Unlock()
	if reader != nil {
		if reader.StoreIdentity().Resource != s.config.SelectedResource {
			err = ErrResourceHeld
			lease.fail(err)
			_ = reader.Retire()
		}
		if retired {
			_ = reader.Retire()
		}
	}
	return lease, err
}
func (r *resourceCurrentSession) fail(err error) {
	r.mu.Lock()
	if r.first == nil {
		r.first = err
	}
	r.mu.Unlock()
}
func (r *resourceCurrentSession) view() ResourceCurrentObservation {
	r.mu.Lock()
	defer r.mu.Unlock()
	return ResourceCurrentObservation{r.id, r.owner.identity, r.caller, r.life}
}
func (r *resourceCurrentSession) release() {
	r.releaseOnce.Do(func() { r.owner.mu.Lock(); delete(r.owner.sessions, r); r.owner.mu.Unlock(); r.owner.wg.Done() })
}
func (r *resourceCurrentSession) retire() error {
	r.mu.Lock()
	r.life.Retired = true
	reader, first := r.reader, r.first
	r.mu.Unlock()
	if reader != nil {
		return errors.Join(first, reader.Retire())
	}
	return first
}
func (r *resourceCurrentSession) join(ctx context.Context) (bool, error) {
	select {
	case <-r.ready:
	case <-ctx.Done():
		return false, ctx.Err()
	}
	r.mu.Lock()
	reader, retired, first := r.reader, r.life.Retired, r.first
	r.mu.Unlock()
	if !retired {
		return false, ErrResourceHeld
	}
	complete := true
	var err error
	if reader != nil {
		complete, err = reader.Join(ctx)
	}
	if complete {
		r.mu.Lock()
		r.life.Joined = true
		r.mu.Unlock()
	}
	return complete, errors.Join(first, err)
}
func (r *resourceCurrentSession) close(ctx context.Context) (bool, error) {
	r.mu.Lock()
	reader, joined, first, closed := r.reader, r.life.Joined, r.first, r.life.PhysicalComplete
	r.mu.Unlock()
	if closed {
		return true, first
	}
	if !joined {
		return false, ErrResourceHeld
	}
	complete := true
	var err error
	if reader != nil {
		complete, err = reader.Close(ctx)
	}
	if complete {
		r.mu.Lock()
		r.life.PhysicalComplete = true
		r.mu.Unlock()
		r.release()
	}
	return complete, errors.Join(first, err)
}
func (r *resourceCurrentSession) disconnect() {
	_ = r.retire()
	r.drainOnce.Do(func() {
		go func() {
			<-r.ready
			_ = r.retire()
			complete, _ := r.join(context.Background())
			if complete {
				_, _ = r.close(context.Background())
			}
		}()
	})
}
func (s *resourceCurrentService) retireAll() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.closing = true
	leases := make([]*resourceCurrentSession, 0, len(s.sessions))
	for lease := range s.sessions {
		leases = append(leases, lease)
	}
	s.mu.Unlock()
	for _, lease := range leases {
		lease.disconnect()
	}
}
func (s *resourceCurrentService) wait() {
	if s != nil {
		s.wg.Wait()
	}
}
func (s *resourceCurrentService) dispatch(ctx context.Context, c *peerConn, request Request) (Result, error) {
	var empty struct{}
	if strictJSON(request.Payload, &empty) != nil || !equivalentJSON(request.Payload, []byte(`{}`)) {
		c.invalidateResource(ErrResourceHeld)
		return Result{}, ErrResourceHeld
	}
	if err := s.check(ctx, c); err != nil {
		c.invalidateResource(err)
		return Result{}, err
	}
	c.resourceMu.Lock()
	lease := c.resource
	c.resourceMu.Unlock()
	if lease == nil {
		if request.Operation != "resource_current" {
			return Result{}, ErrResourceHeld
		}
		var err error
		lease, err = s.create(ctx, c)
		if lease == nil {
			return Result{}, err
		}
		if err != nil {
			lease.fail(err)
		}
	}
	result := resourceCurrentBase()
	switch request.Operation {
	case "resource_current":
		lease.mu.Lock()
		reader, first, retired := lease.reader, lease.first, lease.life.Retired
		lease.mu.Unlock()
		if reader != nil && first == nil && !retired {
			data, err := reader.ReadCurrentResourceDATA(ctx)
			if err == nil {
				err = s.check(ctx, c)
			}
			if err == nil {
				lease.mu.Lock()
				late := lease.life.Retired
				lease.mu.Unlock()
				if !late {
					result.ResourceCurrent = &data
					result.Code = "DATA_ONLY"
				}
			} else {
				lease.fail(err)
			}
		}
	case "resource_current_retire":
		_ = lease.retire()
		result.Code = "RETIRED"
	case "resource_current_join":
		// A bounded pending reply retains the original acquisition/read debt.
		bounded, cancel := context.WithTimeout(ctx, 250*time.Millisecond)
		complete, err := lease.join(bounded)
		cancel()
		result.Code = "PENDING"
		if complete {
			result.Code = "DRAINED"
		}
		if err != nil && !complete && ctx.Err() != nil {
			return Result{}, err
		}
	case "resource_current_close":
		complete, _ := lease.close(ctx)
		result.Code = "PENDING"
		if complete {
			result.Code = "CLOSED"
		}
	default:
		return Result{}, ErrResourceHeld
	}
	observation := lease.view()
	if request.Operation == "resource_current" && observation.Lifetime.Retired {
		result.ResourceCurrent = nil
		result.Code = "UNAVAILABLE"
	}
	result.Observation = &observation
	if err := s.check(ctx, c); err != nil {
		result.ResourceCurrent = nil
		lease.fail(err)
		lease.disconnect()
		return Result{}, err
	}
	return resourceCurrentPack(result)
}
