package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/JiahaoAlbus/YNX-Chain/internal/economics"
)

func main() {
	economicsInputPath := flag.String("economics-input", "", "path to a deterministic economics runtime replay JSON input")
	stakingInputPath := flag.String("staking-input", "", "path to a deterministic staking risk runtime replay JSON input")
	sourceCommit := flag.String("source-commit", "", "40-character lowercase source commit represented by this integration bundle")
	flag.Parse()
	if *economicsInputPath == "" || *stakingInputPath == "" || *sourceCommit == "" {
		fail("-economics-input, -staking-input, and -source-commit are required")
	}

	var economicInput economics.RuntimeReplayInput
	decodeFile(*economicsInputPath, &economicInput)
	economicState, err := economics.ReplayEconomicRuntime(economicInput)
	if err != nil {
		fail(err.Error())
	}

	var stakingInput economics.StakingRiskReplayInput
	decodeFile(*stakingInputPath, &stakingInput)
	stakingState, err := economics.ReplayStakingRiskRuntime(stakingInput)
	if err != nil {
		fail(err.Error())
	}

	bundle, err := economics.BuildEconomicsIntegrationBundle(*sourceCommit, economicState, stakingState)
	if err != nil {
		fail(err.Error())
	}
	if err := economics.ValidateEconomicsIntegrationBundle(bundle); err != nil {
		fail(err.Error())
	}
	encoded, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func decodeFile(path string, output any) {
	payload, err := os.ReadFile(path)
	if err != nil {
		fail(err.Error())
	}
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(output); err != nil {
		fail("decode input: " + err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		fail("input must contain exactly one JSON value")
	}
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(2)
}
