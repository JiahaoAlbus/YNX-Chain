package main

import (
	"errors"
	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
)

func (p pqOptions) invoiceConfigured() bool {
	return p.invoiceSchedule != "" || p.invoiceScheduleHash != ""
}

func (p pqOptions) validateInvoiceOptions() error {
	if (p.invoiceSchedule == "") != (p.invoiceScheduleHash == "") {
		return errors.New("invoice activation requires both independent schedule and hash pin")
	}
	if p.invoiceConfigured() && p.applicationLayout() == "block-journal" {
		return errors.New("invoice activation supports atomic-json and snapshot-journal only")
	}
	return nil
}

func (p pqOptions) loadInvoiceAuthorization() (*consensus.PQInvoiceAuthorization, error) {
	if err := p.validateInvoiceOptions(); err != nil {
		return nil, err
	}
	if !p.invoiceConfigured() {
		return nil, nil
	}
	raw, err := readBounded(p.invoiceSchedule, consensus.MaxPQInvoiceScheduleBytes)
	if err != nil {
		return nil, err
	}
	return consensus.NewPQInvoiceAuthorization(raw, p.invoiceScheduleHash)
}
