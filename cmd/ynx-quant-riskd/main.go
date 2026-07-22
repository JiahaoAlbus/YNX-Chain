package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantapp"
	"log"
)

func main() {
	if err := quantapp.Run(quantapp.Config{Name: "ynx-quant-riskd", Role: "risk", DefaultAddr: "127.0.0.1:6446"}); err != nil {
		log.Fatal(err)
	}
}
