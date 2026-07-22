package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantapp"
	"log"
)

func main() {
	if err := quantapp.Run(quantapp.Config{Name: "ynx-quant-paperd", Role: "paper", DefaultAddr: "127.0.0.1:6445"}); err != nil {
		log.Fatal(err)
	}
}
