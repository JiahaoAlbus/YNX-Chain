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
	inputPath := flag.String("input", "", "path to a deterministic Safety Module runtime replay JSON input")
	flag.Parse()
	if *inputPath == "" {
		fail("-input is required")
	}
	payload, err := os.ReadFile(*inputPath)
	if err != nil {
		fail(err.Error())
	}
	var input economics.SafetyModuleRuntimeReplayInput
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		fail("decode input: " + err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		fail("input must contain exactly one JSON value")
	}
	state, err := economics.ReplaySafetyModuleRuntime(input)
	if err != nil {
		fail(err.Error())
	}
	if err := economics.ValidateSafetyModuleRuntimeState(state); err != nil {
		fail(err.Error())
	}
	encoded, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func fail(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(2)
}
