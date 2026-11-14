package cloud

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"time"

	"golang.org/x/sys/unix"
)

// Supplied only by original registered pricing/current-approval authority.
// No HTTP body, header, local price file, old signed deployment or user-entered
// money field can construct the production dependency or approve a charge.
type IDEUsagePricePermit struct {
	Principal     string
	RequestID     string
	Period        string
	SampleBinding ObjectBinding
	MaximumAtoms  string
	Until         time.Time
	Schedule      IDEUsagePriceSchedule
}
type IDEUsagePricingAuthority interface {
	CurrentUsagePrice(context.Context, *http.Request, IDEDeploymentOperation, IDEUsageAggregate) (IDEUsagePricePermit, error)
	RecheckUsagePrice(context.Context, *http.Request, IDEUsagePricePermit) error
}

// Product-side invoice intent only, not a new payment wire/signature codec.
// The original Pay adapter must validate its actual native metadata, merchant,
// terms and original identity. It must not turn this intent into a funds spend.
type IDEUsageInvoiceRequest struct {
	BillID           string        `json:"billId"`
	RequestID        string        `json:"requestId"`
	InstanceID       string        `json:"instanceId"`
	Period           string        `json:"period"`
	ScheduleID       string        `json:"scheduleId"`
	ScheduleRevision string        `json:"scheduleRevision"`
	RegistrationRef  string        `json:"registrationRef"`
	ApprovalRef      string        `json:"approvalRef"`
	Merchant         string        `json:"merchant"`
	Recipient        string        `json:"recipient"`
	Asset            IDEUsageAsset `json:"asset"`
	Atoms            string        `json:"atoms"`
	SampleBinding    ObjectBinding `json:"sampleBinding"`
}
type IDEUsageInvoiceResult struct {
	Request           IDEUsageInvoiceRequest `json:"request"`
	InvoiceID         string                 `json:"invoiceId"`
	OriginalOperation string                 `json:"originalOperation"`
	State             string                 `json:"state"`
}
type IDEUsageInvoiceProducer interface {
	CreateUsageInvoice(context.Context, IDEUsageInvoiceRequest, func() error) (IDEUsageInvoiceResult, error)
	LookupUsageInvoice(context.Context, IDEUsageInvoiceRequest) (IDEUsageInvoiceResult, error)
}
type IDEUsageBill struct {
	Request           IDEUsageInvoiceRequest `json:"request"`
	Schedule          IDEUsagePriceSchedule  `json:"schedule"`
	Aggregate         IDEUsageAggregate      `json:"aggregate"`
	State             string                 `json:"state"`
	Settlement        string                 `json:"settlement"`
	InvoiceID         string                 `json:"invoiceId,omitempty"`
	OriginalOperation string                 `json:"originalOperation,omitempty"`
	CreatedAt         time.Time              `json:"createdAt"`
	UpdatedAt         time.Time              `json:"updatedAt"`
}
type ideUsageBilling struct {
	prices IDEUsagePricingAuthority
	pay    IDEUsageInvoiceProducer
}

// Normal startup currently supplies neither dependency. The original Source/
// Pay owners must wire concrete approved callees; registering callbacks in a
// test is not production admission. Missing dependencies leave usage UNPRICED.
func (s *Server) EnableIDEUsageBilling(prices IDEUsagePricingAuthority, pay IDEUsageInvoiceProducer) error {
	if s.ideDeployments == nil || s.ideDeployments.billing != nil || prices == nil || pay == nil {
		return ErrIDEUsageUnpriced
	}
	if err := s.ideDeployments.authority.AssertCurrent(context.Background()); err != nil {
		return err
	}
	s.ideDeployments.billing = &ideUsageBilling{prices: prices, pay: pay}
	return nil
}

func lockIDEUsageBilling(file string) (func(), error) {
	fd, err := unix.Open(file+".lock", unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "ide-period-bill-lock")
	info, err := f.Stat()
	var stat unix.Stat_t
	if err != nil || unix.Fstat(fd, &stat) != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || stat.Nlink != 1 || stat.Uid != uint32(os.Geteuid()) {
		f.Close()
		return nil, ErrInvalid
	}
	if err = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		return nil, ErrIDEResourceBusy
	}
	return func() { _ = unix.Flock(fd, unix.LOCK_UN); _ = f.Close() }, nil
}
func (j *ideDeploymentJournal) usageBill(owner string, op IDEDeploymentOperation, period string) (IDEUsageBill, IDEUsageAggregate, error) {
	var empty IDEUsageBill
	var aggregate IDEUsageAggregate
	file := j.file(owner, op.RequestID) + ".usage"
	release, err := lockIDEUsageBilling(file)
	if err != nil {
		return empty, aggregate, err
	}
	defer release()
	return j.readUsageBillLocked(owner, op, period)
}

// Caller holds the existing original usage lock. Shared read-only capture and
// the billing writer use exactly the same validation, not a second bill DB.
func (j *ideDeploymentJournal) readUsageBillLocked(owner string, op IDEDeploymentOperation, period string) (IDEUsageBill, IDEUsageAggregate, error) {
	var empty IDEUsageBill
	var aggregate IDEUsageAggregate
	file := j.file(owner, op.RequestID) + ".usage"
	record, err := readIDEUsage(file)
	if err != nil {
		return empty, aggregate, err
	}
	if record.OwnerHash != productHash([]byte(owner)) || record.InstanceID != op.DeploymentID || record.RequestID != op.RequestID {
		return empty, aggregate, ErrDenied
	}
	aggregate, err = aggregateIDEUsage(record, op, period)
	if err != nil {
		return empty, aggregate, err
	}
	if bill, ok := record.Bills[period]; ok {
		if bill.Aggregate != aggregate || bill.Request.RequestID != op.RequestID || bill.Request.InstanceID != op.DeploymentID || bill.Request.Period != period || bill.Request.SampleBinding != aggregate.SampleBinding || validateUsageSchedule(bill.Schedule, op, period) != nil {
			return empty, aggregate, ErrIDEDeploymentConflict
		}
		atoms, priceErr := priceIDEUsage(aggregate, bill.Schedule)
		if priceErr != nil || atoms != bill.Request.Atoms || bill.Request.ScheduleID != bill.Schedule.ID || bill.Request.ScheduleRevision != bill.Schedule.Revision || bill.Request.Asset != bill.Schedule.Asset || bill.Request.Merchant != bill.Schedule.Merchant || bill.Request.Recipient != bill.Schedule.Recipient || bill.Request.ApprovalRef != bill.Schedule.ApprovalRef || bill.Request.RegistrationRef != bill.Schedule.RegistrationRef {
			return empty, aggregate, ErrIDEDeploymentConflict
		}
		if !validIDEUsageBillState(bill) {
			return empty, aggregate, ErrInvalid
		}
		return bill, aggregate, nil
	}
	return empty, aggregate, ErrNotFound
}

func validIDEUsageBillState(bill IDEUsageBill) bool {
	if bill.State == "NO_CHARGE" {
		return bill.Request.Atoms == "0" && bill.Settlement == "NOT_APPLICABLE" && bill.InvoiceID == "" && bill.OriginalOperation == ""
	}
	if bill.Settlement != "NOT_VERIFIED" {
		return false
	}
	switch bill.State {
	case "UNKNOWN":
		return bill.InvoiceID == "" && bill.OriginalOperation == ""
	case "PREPARED", "ISSUED":
		return bill.InvoiceID != "" && bill.OriginalOperation != ""
	}
	return false
}

func (j *ideDeploymentJournal) reserveUsageBill(owner string, op IDEDeploymentOperation, bill IDEUsageBill, current func() error) (IDEUsageBill, bool, error) {
	var empty IDEUsageBill
	file := j.file(owner, op.RequestID) + ".usage"
	release, err := lockIDEUsageBilling(file)
	if err != nil {
		return empty, false, err
	}
	defer release()
	record, err := readIDEUsage(file)
	if err != nil {
		return empty, false, err
	}
	if record.OwnerHash != productHash([]byte(owner)) || record.RequestID != op.RequestID || record.InstanceID != op.DeploymentID {
		return empty, false, ErrDenied
	}
	if prior, ok := record.Bills[bill.Request.Period]; ok {
		return prior, false, nil
	}
	aggregate, err := aggregateIDEUsage(record, op, bill.Request.Period)
	if err != nil || aggregate != bill.Aggregate {
		return empty, false, ErrIDEDeploymentConflict
	}
	if current == nil {
		return empty, false, ErrDenied
	}
	if record.Bills == nil {
		record.Bills = map[string]IDEUsageBill{}
	}
	record.Bills[bill.Request.Period] = bill
	record.BillingState = "PERIOD_BILLS"
	raw, err := json.Marshal(record)
	if err != nil || len(raw) > 1<<20 {
		return empty, false, ErrInvalid
	}
	if err = socialAtomicGuarded(file, raw, current); err != nil {
		return empty, false, err
	}
	return bill, true, nil
}

func (j *ideDeploymentJournal) confirmUsageBill(owner string, op IDEDeploymentOperation, bill IDEUsageBill, result IDEUsageInvoiceResult, current func() error) (IDEUsageBill, error) {
	if result.Request != bill.Request || result.InvoiceID == "" || len(result.InvoiceID) > 256 || result.OriginalOperation == "" || len(result.OriginalOperation) > 256 || (result.State != "PREPARED" && result.State != "ISSUED") {
		return bill, ErrIDEDeploymentConflict
	}
	file := j.file(owner, op.RequestID) + ".usage"
	release, err := lockIDEUsageBilling(file)
	if err != nil {
		return bill, err
	}
	defer release()
	record, err := readIDEUsage(file)
	if err != nil {
		return bill, err
	}
	prior, ok := record.Bills[bill.Request.Period]
	if !ok || prior.Request != bill.Request || prior.Aggregate != bill.Aggregate || prior.Schedule != bill.Schedule || record.OwnerHash != productHash([]byte(owner)) || record.InstanceID != op.DeploymentID {
		return bill, ErrIDEDeploymentConflict
	}
	if prior.InvoiceID != "" && (prior.InvoiceID != result.InvoiceID || prior.OriginalOperation != result.OriginalOperation) {
		return prior, ErrIDEDeploymentConflict
	}
	if prior.State == "ISSUED" && result.State == "PREPARED" {
		return prior, nil
	}
	prior.InvoiceID, prior.OriginalOperation, prior.State = result.InvoiceID, result.OriginalOperation, result.State
	prior.Settlement = "NOT_VERIFIED"
	prior.UpdatedAt = time.Now().UTC()
	record.Bills[bill.Request.Period] = prior
	raw, err := json.Marshal(record)
	if err != nil || len(raw) > 1<<20 {
		return bill, ErrInvalid
	}
	if current == nil {
		return bill, ErrDenied
	}
	if err = socialAtomicGuarded(file, raw, current); err != nil {
		return bill, err
	}
	return prior, nil
}

func (d *ideDeploymentService) billUsage(ctx context.Context, r *http.Request, owner string, op IDEDeploymentOperation, period string, create bool, readCurrent func() error) (IDEUsageBill, error) {
	var empty IDEUsageBill
	if d.billing == nil || d.billing.prices == nil || d.billing.pay == nil {
		return empty, ErrIDEUsageUnpriced
	}
	if _, _, err := usagePeriod(period); err != nil {
		return empty, err
	}
	bill, aggregate, err := d.journal.usageBill(owner, op, period)
	if err == nil {
		if bill.State == "NO_CHARGE" {
			return bill, nil
		}
		if readCurrent() == nil {
			// Every existing intent, including pre-send crash, is query-only.
			result, lookupErr := d.billing.pay.LookupUsageInvoice(ctx, bill.Request)
			if lookupErr == nil {
				return d.journal.confirmUsageBill(owner, op, bill, result, readCurrent)
			}
		}
		return bill, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return empty, err
	}
	if !create {
		return empty, ErrNotFound
	}
	if op.State == "unknown" || op.DeploymentID == "" {
		return empty, ErrIDEUsageUnpriced
	}
	_, end, _ := usagePeriod(period)
	if d.now().Before(end) {
		return empty, ErrIDEUsagePeriodOpen
	}
	permit, err := d.billing.prices.CurrentUsagePrice(ctx, r, op, aggregate)
	if err != nil {
		return empty, ErrIDEUsageUnpriced
	}
	if permit.Principal != owner || permit.RequestID != op.RequestID || permit.Period != period || permit.SampleBinding != aggregate.SampleBinding || !permit.Until.After(d.now()) || validateUsageSchedule(permit.Schedule, op, period) != nil {
		return empty, ErrIDEUsageUnpriced
	}
	atoms, err := priceIDEUsage(aggregate, permit.Schedule)
	if err != nil {
		return empty, err
	}
	amount, _ := ideSlotNumber(atoms)
	cap, err := ideSlotNumber(permit.MaximumAtoms)
	if err != nil || amount > cap {
		return empty, ErrDenied
	}
	current := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := readCurrent(); err != nil {
			return err
		}
		if !permit.Until.After(d.now()) {
			return ErrDenied
		}
		return d.billing.prices.RecheckUsagePrice(ctx, r, permit)
	}
	schedule := permit.Schedule
	schedule.EffectiveFrom = schedule.EffectiveFrom.UTC()
	schedule.EffectiveUntil = schedule.EffectiveUntil.UTC()
	request := IDEUsageInvoiceRequest{BillID: "cloud_usage_" + productHash([]byte(owner+"\x00"+op.RequestID+"\x00"+op.DeploymentID+"\x00"+period)), RequestID: op.RequestID, InstanceID: op.DeploymentID, Period: period, ScheduleID: schedule.ID, ScheduleRevision: schedule.Revision, RegistrationRef: schedule.RegistrationRef, ApprovalRef: schedule.ApprovalRef, Merchant: schedule.Merchant, Recipient: schedule.Recipient, Asset: schedule.Asset, Atoms: atoms, SampleBinding: aggregate.SampleBinding}
	when := d.now().UTC()
	bill = IDEUsageBill{Request: request, Schedule: schedule, Aggregate: aggregate, State: "UNKNOWN", Settlement: "NOT_VERIFIED", CreatedAt: when, UpdatedAt: when}
	if amount == 0 {
		bill.State = "NO_CHARGE"
		bill.Settlement = "NOT_APPLICABLE"
	}
	bill, claim, err := d.journal.reserveUsageBill(owner, op, bill, current)
	if err != nil {
		return empty, err
	}
	if !claim {
		return bill, nil
	}
	if amount == 0 {
		return bill, nil
	} // No payable invoice is fabricated for zero usage price.
	if current() != nil {
		return bill, nil
	}
	result, err := d.billing.pay.CreateUsageInvoice(ctx, request, current)
	if err != nil {
		return bill, nil
	}
	return d.journal.confirmUsageBill(owner, op, bill, result, current)
}

func (s *Server) ideUsageBill(w http.ResponseWriter, r *http.Request) {
	d, principal, ok := s.ideDeploymentCaller(w, r)
	if !ok {
		return
	}
	if r.Body != nil {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1))
		if err != nil || len(body) > 0 {
			productReadFailure(w, 400, "IDE_BILLING_BODY_NOT_ALLOWED")
			return
		}
	}
	id := r.PathValue("request")
	if !productWriteKey.MatchString(id) {
		productReadFailure(w, 400, "IDE_DEPLOYMENT_REQUEST_INVALID")
		return
	}
	op, err := d.journal.lookup(principal, id)
	if err != nil {
		productReadFailure(w, 404, "IDE_DEPLOYMENT_NOT_FOUND")
		return
	}
	current := func() error {
		if err := r.Context().Err(); err != nil {
			return err
		}
		if err := d.authority.AssertCurrent(r.Context()); err != nil {
			return err
		}
		return d.authorizeOperationRead(r.Context(), r, op)
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_READ_DENIED")
		return
	}
	// A running/UNKNOWN deployment is not a second bill identity. Only a known
	// original instance with retained actual samples can reach pricing.
	if op.DeploymentID == "" {
		productReadFailure(w, 409, "IDE_USAGE_ORIGINAL_UNCONFIRMED")
		return
	}
	bill, err := d.billUsage(r.Context(), r, principal, op, r.PathValue("period"), r.Method == http.MethodPost, current)
	if err != nil {
		status := 503
		if errors.Is(err, ErrNotFound) {
			status = 404
		}
		if errors.Is(err, ErrInvalid) || errors.Is(err, ErrIDEUsagePeriodOpen) {
			status = 400
		}
		if errors.Is(err, ErrDenied) {
			status = 403
		}
		writeJSON(w, status, map[string]string{"outcome": "UNPRICED", "error": err.Error()})
		return
	}
	if current() != nil {
		productReadFailure(w, 403, "IDE_DEPLOYMENT_READ_DENIED")
		return
	}
	status := 200
	if bill.State == "UNKNOWN" {
		status = 202
	}
	writeJSON(w, status, bill)
}
