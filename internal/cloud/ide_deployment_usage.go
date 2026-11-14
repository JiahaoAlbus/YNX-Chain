package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"golang.org/x/sys/unix"
)

// Engine observations are DATA, never a settlement or a paid receipt. All u64
// counters are decimal strings. No client may submit invented CPU/network units
// to the HTTP route; it samples only the exact original inspected instance.
type IDEUsageSample struct {
	InstanceID  string    `json:"instanceId"`
	Period      string    `json:"period"`
	SampleSeq   string    `json:"sampleSeq"`
	CPUNanos    string    `json:"cpuNanos"`
	CPUms       string    `json:"cpuMs"`
	MemoryBytes string    `json:"memoryBytes"`
	StoredBytes string    `json:"storedBytes"`
	EgressBytes string    `json:"egressBytes"`
	ObservedAt  time.Time `json:"observedAt"`
}

type IDEUsageRecord struct {
	Bills        map[string]IDEUsageBill   `json:"bills,omitempty"`
	Version      int                       `json:"version"`
	OwnerHash    string                    `json:"ownerHash"`
	RequestID    string                    `json:"requestId"`
	InstanceID   string                    `json:"instanceId"`
	Latest       IDEUsageSample            `json:"latest"`
	Samples      map[string]IDEUsageSample `json:"samples"`
	BillingState string                    `json:"billingState"`
}

type IDEDeploymentUsageExecutor interface {
	ObserveUsage(context.Context, IDEDeploymentOperation) (IDEUsageSample, error)
}

func (e *OCIIDEDeploymentExecutor) ObserveUsage(ctx context.Context, op IDEDeploymentOperation) (IDEUsageSample, error) {
	var empty IDEUsageSample
	inspection, err := e.inspect(ctx, op)
	if err != nil {
		return empty, err
	}
	staged, err := openIDEStagedOperation(filepath.Join(e.cfg.StorageRoot, e.name(op.RequestID, op.ApprovalSHA256), "artifact.mjs"), op)
	if err != nil {
		return empty, err
	}
	defer staged.file.Close()
	staged.contentBinding = op.ContentBinding
	if err = staged.verify(); err != nil {
		return empty, err
	}
	bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	transport := &http.Transport{DialContext: func(c context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(c, "unix", e.cfg.Socket)
	}, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return ErrDenied }}
	req, err := http.NewRequestWithContext(bounded, http.MethodGet, "http://docker/containers/"+inspection.ID+"/stats?stream=false&one-shot=true", nil)
	if err != nil {
		return empty, err
	}
	response, err := client.Do(req)
	if err != nil {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	var stats struct {
		ID   string    `json:"id"`
		Read time.Time `json:"read"`
		CPU  struct {
			Usage struct {
				Total *uint64 `json:"total_usage"`
			} `json:"cpu_usage"`
		} `json:"cpu_stats"`
		Memory struct {
			Usage *uint64 `json:"usage"`
		} `json:"memory_stats"`
		Networks map[string]struct {
			TX uint64 `json:"tx_bytes"`
		} `json:"networks"`
	}
	if json.Unmarshal(raw, &stats) != nil || stats.ID != inspection.ID || stats.Read.IsZero() || stats.Read.UnixNano() < 1 || stats.Read.After(e.now().Add(time.Minute)) || stats.CPU.Usage.Total == nil || stats.Memory.Usage == nil {
		return empty, ErrIDEExistingRuntimeUnavailable
	}
	var egress uint64
	for _, network := range stats.Networks {
		if ^uint64(0)-egress < network.TX {
			return empty, ErrInvalid
		}
		egress += network.TX
	}
	return IDEUsageSample{InstanceID: inspection.ID, Period: stats.Read.UTC().Format("2006-01-02"), SampleSeq: strconv.FormatInt(stats.Read.UnixNano(), 10), CPUNanos: strconv.FormatUint(*stats.CPU.Usage.Total, 10), CPUms: strconv.FormatUint(*stats.CPU.Usage.Total/1_000_000, 10), MemoryBytes: strconv.FormatUint(*stats.Memory.Usage, 10), StoredBytes: strconv.FormatInt(staged.info.Size(), 10), EgressBytes: strconv.FormatUint(egress, 10), ObservedAt: stats.Read.UTC()}, nil
}

func validateIDEUsage(sample IDEUsageSample, op IDEDeploymentOperation) error {
	if !ideOCIDigest.MatchString("sha256:"+sample.InstanceID) || sample.InstanceID != op.DeploymentID || sample.ObservedAt.IsZero() || sample.ObservedAt.UnixNano() < 1 || sample.SampleSeq != strconv.FormatInt(sample.ObservedAt.UnixNano(), 10) || sample.Period != sample.ObservedAt.UTC().Format("2006-01-02") {
		return ErrInvalid
	}
	cpu, err := ideSlotNumber(sample.CPUNanos)
	if err != nil {
		return err
	}
	if sample.CPUms != strconv.FormatUint(cpu/1_000_000, 10) || sample.StoredBytes != strconv.FormatInt(ideArtifactSize(op), 10) {
		return ErrInvalid
	}
	if _, err = ideSlotNumber(sample.MemoryBytes); err != nil {
		return err
	}
	_, err = ideSlotNumber(sample.EgressBytes)
	return err
}

func readIDEUsage(file string) (IDEUsageRecord, error) {
	var empty IDEUsageRecord
	fd, err := unix.Open(file, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
	if err != nil {
		return empty, err
	}
	f := os.NewFile(uintptr(fd), "ide-original-usage")
	defer f.Close()
	info, err := f.Stat()
	var stat unix.Stat_t
	if err != nil || unix.Fstat(fd, &stat) != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) || info.Size() > 1<<20 {
		return empty, ErrInvalid
	}
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return empty, ErrInvalid
	}
	named, err := os.Lstat(file)
	after, afterErr := f.Stat()
	if err != nil || afterErr != nil || !os.SameFile(info, named) || info.Size() != after.Size() || !info.ModTime().Equal(after.ModTime()) {
		return empty, ErrInvalid
	}
	var record IDEUsageRecord
	if json.Unmarshal(raw, &record) != nil || record.Version != 1 || (record.BillingState != "UNPRICED" && record.BillingState != "PERIOD_BILLS") || record.Samples == nil || len(record.Samples) > 1024 {
		return empty, ErrInvalid
	}
	canonical, _ := json.Marshal(record)
	if string(canonical) != string(raw) {
		return empty, ErrInvalid
	}
	if len(record.Bills) == 0 && record.BillingState != "UNPRICED" || len(record.Bills) > 0 && record.BillingState != "PERIOD_BILLS" {
		return empty, ErrInvalid
	}
	for period, bill := range record.Bills {
		if period != bill.Request.Period || bill.Request.RequestID != record.RequestID || bill.Request.InstanceID != record.InstanceID || !validIDEUsageBillState(bill) {
			return empty, ErrInvalid
		}
	}
	return record, nil
}

// Persist one sample once in the original operation journal. Cumulative engine
// counters are not summed on retries. No tariff is fabricated: a registered,
// versioned price schedule and Pay order must be supplied before billing.
func (j *ideDeploymentJournal) recordUsage(owner string, op IDEDeploymentOperation, sample IDEUsageSample, current func() error) (IDEUsageRecord, error) {
	var empty IDEUsageRecord
	if current == nil || current() != nil || validateIDEUsage(sample, op) != nil {
		return empty, ErrDenied
	}
	j.terminalMu.Lock()
	defer j.terminalMu.Unlock()
	original, err := j.lookup(owner, op.RequestID)
	if err != nil {
		return empty, err
	}
	if original.DeploymentID != sample.InstanceID || original.Binding != op.Binding || original.ResourceID != op.ResourceID || !sameIDETransition(original, op) {
		return empty, ErrIDEDeploymentConflict
	}
	file := j.file(owner, op.RequestID) + ".usage"
	fd, err := unix.Open(file+".lock", unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return empty, err
	}
	lock := os.NewFile(uintptr(fd), "ide-usage-sample-lock")
	defer lock.Close()
	info, err := lock.Stat()
	var stat unix.Stat_t
	if err != nil || unix.Fstat(fd, &stat) != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
		return empty, ErrInvalid
	}
	if err = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return empty, ErrIDEResourceBusy
	}
	defer unix.Flock(fd, unix.LOCK_UN)
	record, err := readIDEUsage(file)
	if errors.Is(err, os.ErrNotExist) {
		record = IDEUsageRecord{Version: 1, OwnerHash: productHash([]byte(owner)), RequestID: op.RequestID, InstanceID: sample.InstanceID, Samples: map[string]IDEUsageSample{}, BillingState: "UNPRICED"}
	} else if err != nil {
		return empty, err
	}
	if record.OwnerHash != productHash([]byte(owner)) || record.RequestID != op.RequestID || record.InstanceID != sample.InstanceID {
		return empty, ErrIDEDeploymentConflict
	}
	for key, stored := range record.Samples {
		if key != stored.Period+"/"+stored.SampleSeq || validateIDEUsage(stored, op) != nil || stored.ObservedAt.After(record.Latest.ObservedAt) {
			return empty, ErrInvalid
		}
	}
	if len(record.Samples) > 0 {
		if latest, ok := record.Samples[record.Latest.Period+"/"+record.Latest.SampleSeq]; !ok || latest != record.Latest {
			return empty, ErrInvalid
		}
	}
	key := sample.Period + "/" + sample.SampleSeq
	if prior, ok := record.Samples[key]; ok {
		if prior != sample {
			return empty, ErrIDEDeploymentConflict
		}
		if err := current(); err != nil {
			return empty, err
		}
		return record, nil
	}
	if _, sealed := record.Bills[sample.Period]; sealed {
		return empty, ErrIDEUsagePeriodSealed
	}
	if len(record.Samples) >= 1024 {
		return empty, fmt.Errorf("usage sample limit: %w", ErrInvalid)
	}
	if !record.Latest.ObservedAt.IsZero() {
		beforeCPU, _ := ideSlotNumber(record.Latest.CPUNanos)
		nextCPU, _ := ideSlotNumber(sample.CPUNanos)
		beforeEgress, _ := ideSlotNumber(record.Latest.EgressBytes)
		nextEgress, _ := ideSlotNumber(sample.EgressBytes)
		if !sample.ObservedAt.After(record.Latest.ObservedAt) || nextCPU < beforeCPU || nextEgress < beforeEgress {
			return empty, ErrIDEDeploymentConflict
		}
	}
	record.Samples[key] = sample
	record.Latest = sample
	raw, err := json.Marshal(record)
	if err != nil || len(raw) > 1<<20 {
		return empty, ErrInvalid
	}
	if err = socialAtomicGuarded(file, raw, current); err != nil {
		return empty, err
	}
	return record, nil
}

func (d *ideDeploymentService) readUsage(w http.ResponseWriter, r *http.Request, principal string, op IDEDeploymentOperation, current func() error) {
	executor, ok := d.executor.(IDEDeploymentUsageExecutor)
	if !ok {
		productReadFailure(w, 503, "IDE_USAGE_OBSERVER_UNAVAILABLE")
		return
	}
	sample, err := executor.ObserveUsage(r.Context(), op)
	if err != nil || current() != nil {
		productReadFailure(w, 503, "IDE_USAGE_ORIGINAL_UNAVAILABLE")
		return
	}
	record, err := d.journal.recordUsage(principal, op, sample, current)
	if err != nil {
		productReadFailure(w, 503, "IDE_USAGE_RECORD_UNCONFIRMED")
		return
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_READ_DENIED")
		return
	}
	writeJSON(w, 200, record)
}
