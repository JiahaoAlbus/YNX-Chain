package productreadsource

import (
	"bytes"
	"encoding/json"
	"flag"
	"os"
	"testing"
)

var publicEncoderInput = flag.String("public-sdk-input", "", "PUBLIC test-only raw input to the same production DATA assembler")
var publicOldStruct = flag.Bool("public-old-struct", false, "reproduce original canonical-order defect")
var publicSDKOutput = flag.String("public-sdk-output", "", "actual sole SDK stdout, DATA adoption controls only")

func TestActualProductionSDKOutputAdopter(t *testing.T) {
	if *publicSDKOutput == "" {
		return
	}
	raw, e := os.ReadFile(*publicSDKOutput)
	if e != nil {
		t.Fatal(e)
	}
	var result struct {
		Projection map[string]json.RawMessage `json:"projection"`
		CurrentRaw string                     `json:"currentRaw"`
	}
	if e = decode(raw, &result); e != nil || result.CurrentRaw == "" {
		t.Fatal(e)
	}
	r := release{sourceID: "PUBLIC-PRODUCT-dispatch", resourceRef: "PUBLIC-Product-resource"}
	scope, prior, expires, e := readOriginalSDKProjection(result.Projection, r)
	if e != nil || prior.Sequence != 1 || prior.Floor != 0 || prior.ExecutionHeight != "5" || prior.TimeFloor < 1 || expires <= prior.TimeFloor || scope.Products[0].ProductID != "cloud.ide-usage" || len(scope.Operations) != 12 {
		t.Fatal("actual SDK output mismatch", e, scope, prior, expires)
	}
	for _, field := range []string{"status", "sourceId", "subjectOwner", "dataOnly", "nativeAdmission", "expiresAtMs", "selection", "sequence", "floor", "head", "timeFloor", "executionHeight"} {
		copy := map[string]json.RawMessage{}
		for k, v := range result.Projection {
			copy[k] = bytes.Clone(v)
		}
		copy["WrongCase"+field] = copy[field]
		delete(copy, field)
		if _, _, _, e := readOriginalSDKProjection(copy, r); e == nil {
			t.Fatal("missing/labeled output accepted", field)
		}
	}
}

func TestActualProductionSDKInputEncoder(t *testing.T) {
	if *publicEncoderInput == "" {
		r := release{}
		b, e := encodeOriginalSDKInput(r, []byte("{}"), []byte("{}"), []byte("{}"), []byte("{}"), previous{ExecutionHeight: "0"})
		if e != nil || !bytes.Contains(b, []byte(`"previous":{"executionHeight":"0","floor":0,"head":"","sequence":0,"timeFloor":0}`)) {
			t.Fatal(e, string(b))
		}
		for _, prior := range []previous{{Sequence: 9007199254740992, ExecutionHeight: "0"}, {Floor: 1, ExecutionHeight: "0"}, {TimeFloor: -1, ExecutionHeight: "0"}, {ExecutionHeight: "00"}, {ExecutionHeight: "18446744073709551616"}} {
			if _, e := encodeOriginalSDKInput(r, nil, nil, nil, nil, prior); e == nil {
				t.Fatal("invalid watermark accepted")
			}
		}
		return
	}
	raw, e := os.ReadFile(*publicEncoderInput)
	if e != nil {
		t.Fatal(e)
	}
	var input struct {
		Operation  string            `json:"operation"`
		Root       string            `json:"rootRaw"`
		Enrollment string            `json:"enrollmentRaw"`
		Profile    string            `json:"profileRaw"`
		Head       string            `json:"headRaw"`
		Node       map[string]string `json:"node"`
		Previous   previous          `json:"previous"`
		Policy     struct {
			RootDigest       string            `json:"rootDigest"`
			EnrollmentDigest string            `json:"enrollmentDigest"`
			Endpoint         string            `json:"endpoint"`
			SPKI             string            `json:"spki"`
			ApplicationID    string            `json:"applicationId"`
			ProductID        string            `json:"productId"`
			Platform         string            `json:"platform"`
			Contract         map[string]string `json:"signatureContract"`
		} `json:"policy"`
	}
	if e = decode(raw, &input); e != nil || input.Operation != "auth-source-v2-native-node/v1" || input.Policy.Contract["purpose"] != Purpose {
		t.Fatal(e)
	}
	r := release{applicationID: input.Policy.ApplicationID, productID: input.Policy.ProductID, platform: input.Policy.Platform, endpoint: input.Policy.Endpoint, spki: input.Policy.SPKI, nodeOrigin: input.Node["origin"], nodeSPKI: input.Node["spki"], nativeChainID: input.Node["nativeChainId"], enrollmentFrame: input.Policy.Contract["enrollmentFrame"], profileFrame: input.Policy.Contract["profileFrame"], currentFrame: input.Policy.Contract["currentFrame"], root: originalPin{SHA256: input.Policy.RootDigest}, enrollment: originalPin{SHA256: input.Policy.EnrollmentDigest}}
	b, e := encodeOriginalSDKInput(r, []byte(input.Root), []byte(input.Enrollment), []byte(input.Profile), []byte(input.Head), input.Previous)
	if e != nil {
		t.Fatal(e)
	}
	if *publicOldStruct {
		var v map[string]json.RawMessage
		if json.Unmarshal(b, &v) != nil {
			t.Fatal("parse")
		}
		v["previous"], e = json.Marshal(input.Previous)
		if e != nil {
			t.Fatal(e)
		}
		b, e = json.Marshal(v)
		if e != nil {
			t.Fatal(e)
		}
	}
	if _, e = os.Stdout.Write(b); e != nil {
		t.Fatal(e)
	}
	os.Exit(0)
}
