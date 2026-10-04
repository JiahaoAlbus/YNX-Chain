package exchangeproduct

import "slices"

// Read and command receipts must not hand out mutable references to the
// retained state. Clone exact slices rather than re-encoding event payloads:
// their byte identity and digest are part of the existing execution contract.
func copyTWAPObservation(value TWAPOrder) TWAPOrder {
	value.ChildOrderIDs = slices.Clone(value.ChildOrderIDs)
	return value
}

func copyScaleObservation(value ScaleOrder) ScaleOrder {
	value.ChildOrderIDs = slices.Clone(value.ChildOrderIDs)
	return value
}

func copyAIObservation(value AIRecord) AIRecord {
	value.ContextClasses = slices.Clone(value.ContextClasses)
	return value
}

func copyExecutionObservation(value ExecutionEvent) ExecutionEvent {
	value.Payload = slices.Clone(value.Payload)
	return value
}

func copyCancelObservation(value CancelResult) CancelResult {
	value.TWAPOrders = slices.Clone(value.TWAPOrders)
	for i := range value.TWAPOrders {
		value.TWAPOrders[i] = copyTWAPObservation(value.TWAPOrders[i])
	}
	value.ScaleOrders = slices.Clone(value.ScaleOrders)
	for i := range value.ScaleOrders {
		value.ScaleOrders[i] = copyScaleObservation(value.ScaleOrders[i])
	}
	return value
}
