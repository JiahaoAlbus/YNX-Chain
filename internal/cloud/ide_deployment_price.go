package cloud

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"sort"
	"strconv"
	"strings"
	"time"
)

var ErrIDEUsageUnpriced = errors.New("registered current usage price or invoice authority unavailable")
var ErrIDEUsagePeriodOpen = errors.New("usage period is not closed for billing")
var ErrIDEUsagePeriodSealed = errors.New("original usage period is already sealed to one bill")

// Ledger units are supplied by original metadata/Pay, never UI decimals. These
// product DATA fields do not define a new Chain codec or signing domain.
type IDEUsageAsset struct {
	Genesis       string `json:"genesis"`
	NativeChainID string `json:"nativeChainId"`
	AssetID       string `json:"assetId"`
	UnitVersion   string `json:"unitVersion"`
}
type IDEUsageRate struct {
	Units string `json:"units"`
	Atoms string `json:"atoms"`
}
type IDEUsagePriceSchedule struct {
	ManifestVersion string             `json:"manifestVersion,omitempty"`
	ProjectRef      IDEDeploymentV2Ref `json:"projectRef,omitzero"`
	ID              string             `json:"id"`
	Revision        string             `json:"revision"`
	RegistrationRef string             `json:"registrationRef"`
	CurrentRef      string             `json:"currentRef"`
	ApprovalRef     string             `json:"approvalRef"`
	Merchant        string             `json:"merchant"`
	Recipient       string             `json:"recipient"`
	ResourceID      string             `json:"resourceId"`
	ProjectID       string             `json:"projectId"`
	Asset           IDEUsageAsset      `json:"asset"`
	EffectiveFrom   time.Time          `json:"effectiveFrom"`
	EffectiveUntil  time.Time          `json:"effectiveUntil"`
	// Every cumulative delta belongs to its observing sample's UTC day. Storage
	// is that day's observed peak staged bytes, not invented byte-seconds. Both
	// attribution and ceil-on-period-total must be in the registered tariff.
	MeterRule       string       `json:"meterRule"`
	CPUNanos        IDEUsageRate `json:"cpuNanos"`
	EgressBytes     IDEUsageRate `json:"egressBytes"`
	PeakStoredBytes IDEUsageRate `json:"peakStoredBytes"`
}
type IDEUsageAggregate struct {
	Period          string        `json:"period"`
	Samples         string        `json:"samples"`
	LastSampleSeq   string        `json:"lastSampleSeq"`
	SampleBinding   ObjectBinding `json:"sampleBinding"`
	CPUNanos        string        `json:"cpuNanos"`
	EgressBytes     string        `json:"egressBytes"`
	PeakStoredBytes string        `json:"peakStoredBytes"`
}

func usagePeriod(raw string) (time.Time, time.Time, error) {
	start, err := time.Parse("2006-01-02", raw)
	if err != nil || start.Format("2006-01-02") != raw {
		return time.Time{}, time.Time{}, ErrInvalid
	}
	return start, start.AddDate(0, 0, 1), nil
}
func usageAssetValid(asset IDEUsageAsset) bool {
	genesis, err := hex.DecodeString(asset.Genesis)
	if err != nil || len(genesis) != 32 || hex.EncodeToString(genesis) != asset.Genesis {
		return false
	}
	chain, err := ideSlotNumber(asset.NativeChainID)
	if err != nil || chain == 0 || chain > uint64(1<<63-1) {
		return false
	}
	_, err = ideSlotNumber(asset.UnitVersion)
	return err == nil && asset.AssetID != "" && len(asset.AssetID) <= 256 && strings.TrimSpace(asset.AssetID) == asset.AssetID && !strings.ContainsAny(asset.AssetID, "\r\n\x00")
}
func validateUsageSchedule(schedule IDEUsagePriceSchedule, op IDEDeploymentOperation, period string) error {
	start, end, err := usagePeriod(period)
	if err != nil {
		return err
	}
	rev, err := ideSlotNumber(schedule.Revision)
	if err != nil || rev == 0 || !usageAssetValid(schedule.Asset) || schedule.MeterRule != "cumulative-sample-end/UTC-day/ceil-total/v1" || schedule.ResourceID != op.ResourceID || schedule.EffectiveFrom.After(start) || schedule.EffectiveUntil.Before(end) {
		return ErrIDEUsageUnpriced
	}
	if op.ManifestVersion == "2" {
		// Registered pricing must retain the actual full project ref AND its
		// independently supplied Catalog projection. Never guess fullRef.ID is
		// a Catalog ID, or authorize a cross-tenant tariff by a display string.
		if !validIDEOperationVersion(op) || schedule.ManifestVersion != "2" || schedule.ProjectRef != op.ManifestV2.Project || schedule.ProjectID != op.CatalogProjectID {
			return ErrIDEUsageUnpriced
		}
	} else if schedule.ManifestVersion != "" || schedule.ProjectRef != (IDEDeploymentV2Ref{}) || schedule.ProjectID != op.Binding.ProjectID {
		return ErrIDEUsageUnpriced
	}
	for _, text := range []string{schedule.ID, schedule.RegistrationRef, schedule.CurrentRef, schedule.ApprovalRef, schedule.Merchant, schedule.Recipient} {
		if text == "" || len(text) > 512 || strings.TrimSpace(text) != text || strings.ContainsAny(text, "\r\n\x00") {
			return ErrIDEUsageUnpriced
		}
	}
	for _, rate := range []IDEUsageRate{schedule.CPUNanos, schedule.EgressBytes, schedule.PeakStoredBytes} {
		units, err := ideSlotNumber(rate.Units)
		if err != nil || units == 0 {
			return ErrIDEUsageUnpriced
		}
		if _, err = ideSlotNumber(rate.Atoms); err != nil {
			return ErrIDEUsageUnpriced
		}
	}
	return nil
}
func aggregateIDEUsage(record IDEUsageRecord, op IDEDeploymentOperation, period string) (IDEUsageAggregate, error) {
	var empty IDEUsageAggregate
	if _, _, err := usagePeriod(period); err != nil {
		return empty, err
	}
	if record.InstanceID != op.DeploymentID || record.RequestID != op.RequestID || len(record.Samples) == 0 || len(record.Samples) > 1024 {
		return empty, ErrIDEUsageUnpriced
	}
	samples := make([]IDEUsageSample, 0, len(record.Samples))
	for key, sample := range record.Samples {
		if key != sample.Period+"/"+sample.SampleSeq || validateIDEUsage(sample, op) != nil {
			return empty, ErrInvalid
		}
		samples = append(samples, sample)
	}
	sort.Slice(samples, func(i, j int) bool { return samples[i].ObservedAt.Before(samples[j].ObservedAt) })
	var previousCPU, previousEgress, totalCPU, totalEgress, peak, count uint64
	var last string
	var selected []IDEUsageSample
	var baseline *IDEUsageSample
	var previousSample *IDEUsageSample
	var previousTime time.Time
	for _, sample := range samples {
		cpu, _ := ideSlotNumber(sample.CPUNanos)
		egress, _ := ideSlotNumber(sample.EgressBytes)
		stored, _ := ideSlotNumber(sample.StoredBytes)
		if !previousTime.IsZero() && !sample.ObservedAt.After(previousTime) || cpu < previousCPU || egress < previousEgress {
			return empty, ErrIDEDeploymentConflict
		}
		if sample.Period == period {
			if count == 0 {
				baseline = previousSample
			}
			totalCPU += cpu - previousCPU
			totalEgress += egress - previousEgress
			if stored > peak {
				peak = stored
			}
			count++
			last = sample.SampleSeq
			selected = append(selected, sample)
		}
		previousCPU, previousEgress, previousTime = cpu, egress, sample.ObservedAt
		copy := sample
		previousSample = &copy
	}
	if count == 0 {
		return empty, ErrIDEUsageUnpriced
	}
	raw, err := json.Marshal(struct {
		Baseline *IDEUsageSample  `json:"baseline"`
		Samples  []IDEUsageSample `json:"samples"`
	}{baseline, selected})
	if err != nil {
		return empty, err
	}
	return IDEUsageAggregate{Period: period, Samples: strconv.FormatUint(count, 10), LastSampleSeq: last, SampleBinding: bindObjectBytes(raw), CPUNanos: strconv.FormatUint(totalCPU, 10), EgressBytes: strconv.FormatUint(totalEgress, 10), PeakStoredBytes: strconv.FormatUint(peak, 10)}, nil
}

// Checked integer ledger arithmetic only. There is no display-scale conversion,
// float, balance mutation or transaction signer here.
func priceIDEUsage(aggregate IDEUsageAggregate, schedule IDEUsagePriceSchedule) (string, error) {
	total := new(big.Int)
	for _, line := range []struct {
		amount string
		rate   IDEUsageRate
	}{{aggregate.CPUNanos, schedule.CPUNanos}, {aggregate.EgressBytes, schedule.EgressBytes}, {aggregate.PeakStoredBytes, schedule.PeakStoredBytes}} {
		amount, err := ideSlotNumber(line.amount)
		if err != nil {
			return "", err
		}
		units, err := ideSlotNumber(line.rate.Units)
		if err != nil || units == 0 {
			return "", ErrInvalid
		}
		atoms, err := ideSlotNumber(line.rate.Atoms)
		if err != nil {
			return "", err
		}
		quantity := new(big.Int).SetUint64(amount)
		quantity.Add(quantity, new(big.Int).SetUint64(units-1))
		quantity.Div(quantity, new(big.Int).SetUint64(units))
		quantity.Mul(quantity, new(big.Int).SetUint64(atoms))
		total.Add(total, quantity)
		if !total.IsUint64() {
			return "", ErrInvalid
		}
	}
	return total.String(), nil
}
