package main

import "errors"

func rejectExternalRuntimeUpgrade(plan, pin string) error {
	if plan != "" || pin != "" {
		return errors.New("runtime upgrade requires the normal in-process ynx-comet engine checkpoint channel; external ABCI socket/grpc cannot authenticate engine H/AppHash/AppVersion")
	}
	return nil
}
