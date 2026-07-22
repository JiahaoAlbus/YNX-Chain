package main

import (
	"github.com/JiahaoAlbus/YNX-Chain/internal/quantapp"
	"log"
)

func main() {
	if err := quantapp.Run(quantapp.Config{Name: "ynx-quantd", Role: "all", DefaultAddr: "127.0.0.1:6444"}); err != nil {
		log.Fatal(err)
	}
}
