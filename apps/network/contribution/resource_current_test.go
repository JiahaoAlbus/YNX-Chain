package contribution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/JiahaoAlbus/YNX-Chain/internal/productstore"
)

func currentTestRunner(t *testing.T) (*Runner, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "original-resource.json")
	r, err := NewDisabled(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r, path
}

var publicResourceIdentity = ResourceIdentity{"PUBLIC-local-resource-source", "PUBLIC-own-instance", "PUBLIC-histogram-resource"}

func TestOriginalResourceCurrentDATA(t *testing.T) {
	t.Run("own-incarnation-exact-nine-fields-no-source-floor-and-readonly", func(t *testing.T) {
		r, path := currentTestRunner(t)
		if _, err := r.ReadCurrentResourceDATA(context.Background()); !errors.Is(err, ErrResourceCurrent) {
			t.Fatal("uninitialized instance published", err)
		}
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(path)
		data, err := r.ReadCurrentResourceDATA(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(data)
		var fields map[string]any
		if json.Unmarshal(raw, &fields) != nil || len(fields) != 9 || data.Epoch != "1" || data.Sequence != "1" || data.Status != "active" || data.SourceID != publicResourceIdentity.SourceID || data.ExpiresAtMS-data.IssuedAtMS != 20000 {
			t.Fatal("invalid own current9", string(raw))
		}
		for _, key := range []string{"profileKeyEpoch", "currentKeyEpoch", "floor", "minimumSequence", "authority", "signature"} {
			if _, ok := fields[key]; ok {
				t.Fatal("foreign authority/counter invented", key)
			}
		}
		if err = r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		foreign := publicResourceIdentity
		foreign.ResourceKey = "PUBLIC-other"
		if err = r.InitializeCurrentResource(context.Background(), foreign); err == nil {
			t.Fatal("resource rebound")
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("reads/rebind changed original store")
		}
		meter := r.VerifyResourceMeter()
		if meter.ActiveWorkers != 0 || meter.VerifiedJobs != 0 {
			t.Fatal("metadata opened production", meter)
		}
	})
	t.Run("cold-original-commit-monotonic-private-snapshot", func(t *testing.T) {
		r, path := currentTestRunner(t)
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		first, err := r.ReadCurrentResourceDATA(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if err = r.Close(); err != nil {
			t.Fatal(err)
		}
		if _, err = r.ReadCurrentResourceDATA(context.Background()); err == nil {
			t.Fatal("closed private owner still current")
		}
		next, err := NewDisabled(path)
		if err != nil {
			t.Fatal(err)
		}
		defer next.Close()
		snapshot, err := next.ReadCurrentResourceDATA(context.Background())
		if err != nil || snapshot.Epoch != first.Epoch || snapshot.Sequence != "2" || snapshot.Head == first.Head {
			t.Fatal("cold commit did not advance own current", snapshot, err)
		}
		var wg sync.WaitGroup
		errs := make(chan error, 8)
		for i := 0; i < 8; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				v, e := next.ReadCurrentResourceDATA(context.Background())
				if e != nil {
					errs <- e
				} else if v.Sequence != snapshot.Sequence || v.Head != snapshot.Head {
					errs <- ErrResourceCurrent
				}
			}()
		}
		wg.Wait()
		close(errs)
		for e := range errs {
			t.Fatal("mixed snapshot", e)
		}
	})
	t.Run("external-original-replacement-or-tamper-is-not-current", func(t *testing.T) {
		r, path := currentTestRunner(t)
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		original, _ := os.ReadFile(path)
		var changed journal
		if _, err := productstore.Load(path, &changed); err != nil {
			t.Fatal(err)
		}
		changed.ResourceCurrent.Identity.ResourceKey = "PUBLIC-foreign"
		if err := productstore.Save(path, changed); err != nil {
			t.Fatal(err)
		}
		if _, err := r.ReadCurrentResourceDATA(context.Background()); err == nil {
			t.Fatal("changed disk original projected as current")
		}
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err == nil {
			t.Fatal("original mismatch overwritten")
		}
		after, _ := os.ReadFile(path)
		if bytes.Equal(original, after) {
			t.Fatal("test did not replace original")
		}
		if err := r.Close(); err != nil {
			t.Fatal(err)
		}
		if reopened, err := NewDisabled(path); err == nil {
			_ = reopened.Close()
			t.Fatal("corrupt head cold reopened")
		}
		retained, _ := os.ReadFile(path)
		if !bytes.Equal(after, retained) {
			t.Fatal("failed cold admission rewrote first cause")
		}
	})
	t.Run("full-uint64-own-sequence-overflow-fails-closed", func(t *testing.T) {
		r, _ := currentTestRunner(t)
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		// PUBLIC control only: simulate a genuinely prior own-store high sequence,
		// not generic Source generation, keyVersion, external floor or fixture import.
		r.mu.Lock()
		r.data.ResourceCurrent.Sequence = "9007199254740993"
		head, err := resourceCurrentHead(r.data)
		if err != nil {
			t.Fatal(err)
		}
		r.data.ResourceCurrent.Head = head
		if err = productstore.Save(r.path, r.data); err != nil {
			t.Fatal(err)
		}
		r.mu.Unlock()
		before, err := r.ReadCurrentResourceDATA(context.Background())
		if err != nil || before.Sequence != "9007199254740993" {
			t.Fatal("large sequence rounded", before, err)
		}
		r.mu.Lock()
		err = r.persist()
		r.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		next, err := r.ReadCurrentResourceDATA(context.Background())
		if err != nil || next.Sequence != "9007199254740994" {
			t.Fatal(next, err)
		}
		r.mu.Lock()
		r.data.ResourceCurrent.Sequence = strconv.FormatUint(^uint64(0), 10)
		head, err = resourceCurrentHead(r.data)
		if err != nil {
			t.Fatal(err)
		}
		r.data.ResourceCurrent.Head = head
		if err = productstore.Save(r.path, r.data); err != nil {
			t.Fatal(err)
		}
		err = r.persist()
		r.mu.Unlock()
		if err == nil {
			t.Fatal("u64 counter wrapped")
		}
		if _, err = r.ReadCurrentResourceDATA(context.Background()); err == nil {
			t.Fatal("failed commit published current")
		}
	})
	t.Run("failed-persistence-cannot-publish-uncommitted-head", func(t *testing.T) {
		r, path := currentTestRunner(t)
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		retained := path + ".retained"
		if err := os.Rename(path, retained); err != nil {
			t.Fatal(err)
		}
		if err := os.Mkdir(path, 0700); err != nil {
			t.Fatal(err)
		}
		r.mu.Lock()
		err := r.persist()
		r.mu.Unlock()
		if err == nil {
			t.Fatal("invalid original path saved")
		}
		if err = os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err = os.Rename(retained, path); err != nil {
			t.Fatal(err)
		}
		if _, err = r.ReadCurrentResourceDATA(context.Background()); err == nil {
			t.Fatal("restoring old file rearmed failed current")
		}
	})
	t.Run("cancellation-no-clock-or-counter-adoption", func(t *testing.T) {
		r, path := currentTestRunner(t)
		before, _ := os.ReadFile(path)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		if err := r.InitializeCurrentResource(ctx, publicResourceIdentity); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		after, _ := os.ReadFile(path)
		if !bytes.Equal(before, after) {
			t.Fatal("cancel changed store")
		}
		if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
			t.Fatal(err)
		}
		if _, err := r.ReadCurrentResourceDATA(ctx); !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
		data, err := r.ReadCurrentResourceDATA(context.Background())
		if err != nil || data.IssuedAtMS > time.Now().UnixMilli() || data.Sequence != "1" {
			t.Fatal(data, err)
		}
	})
}

func TestOriginalResourceCurrentReaderLifetime(t *testing.T) {
	r, path := currentTestRunner(t)
	if err := r.InitializeCurrentResource(context.Background(), publicResourceIdentity); err != nil {
		t.Fatal(err)
	}
	reader, err := r.BorrowCurrentResourceReader(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	identity := reader.StoreIdentity()
	if identity.JournalPath != path || identity.Resource != publicResourceIdentity || identity.Epoch != "1" {
		t.Fatal("wrong actual store identity", identity)
	}
	if err = reader.Current(context.Background()); err != nil {
		t.Fatal(err)
	}
	// PUBLIC held-read control exercises physical child debt against an actual
	// original Runner, without replacing its source or granting any permission.
	if _, err = reader.begin(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = reader.Retire(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	if complete, err := reader.Join(ctx); complete || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("pending debt lost", complete, err)
	}
	if _, err = reader.ReadCurrentResourceDATA(context.Background()); !errors.Is(err, ErrCurrentReaderRetired) {
		t.Fatal("retired read rearmed", err)
	}
	reader.end(nil)
	if complete, err := reader.Join(context.Background()); !complete || err != nil {
		t.Fatal(complete, err)
	}
	if complete, err := reader.Close(context.Background()); !complete || err != nil {
		t.Fatal(complete, err)
	}
	if complete, err := reader.Close(context.Background()); !complete || err != nil {
		t.Fatal("repeat close replaced reader", complete, err)
	}
	if _, err = r.ReadCurrentResourceDATA(context.Background()); err != nil {
		t.Fatal("borrow reader closed unrelated Runner", err)
	}
	late, err := r.BorrowCurrentResourceReader(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	cancel2()
	if err = late.Current(ctx2); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err = late.Current(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatal("failed current reader rearmed", err)
	}
	_ = late.Retire()
	_, _ = late.Join(context.Background())
	if complete, err := late.Close(context.Background()); !complete || !errors.Is(err, context.Canceled) {
		t.Fatal("physical vs first cause lost", complete, err)
	}
}
