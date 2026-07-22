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
	input := flag.String("input", "", "path to a JSON economics simulation input")
	flag.Parse()
	if *input == "" {
		fail("-input is required")
	}
	payload, err := os.ReadFile(*input)
	if err != nil {
		fail(err.Error())
	}
	var in economics.Inputs
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&in); err != nil {
		fail("decode input: " + err.Error())
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		fail("input must contain exactly one JSON value")
	}
	out, err := economics.Simulate(economics.DefaultCandidatePolicy(), in)
	if err != nil {
		fail(err.Error())
	}
	encoded, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	fmt.Println(string(encoded))
}

func fail(message string) { fmt.Fprintln(os.Stderr, message); os.Exit(2) }
