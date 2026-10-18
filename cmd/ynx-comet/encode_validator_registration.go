package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/JiahaoAlbus/YNX-Chain/internal/consensus"
	"github.com/JiahaoAlbus/YNX-Chain/internal/ynxconsensusauth"
	"github.com/spf13/cobra"
)

type validatorRegistrationEncoding struct {
	Version                string `json:"version"`
	PayloadBase64          string `json:"payloadBase64"`
	ABCIHash               string `json:"abciHash"`
	WireSHA256             string `json:"wireSHA256"`
	OperationHash          string `json:"operationHash"`
	ChainID                string `json:"chainId"`
	ConsensusGenesisSHA256 string `json:"consensusGenesisSHA256"`
	ApprovedAt             int64  `json:"approvedAt,string"`
	EffectiveAt            int64  `json:"effectiveAt,string"`
	ValidatorAddress       string `json:"validatorAddress"`
	Encoded                bool   `json:"encoded"`
	RegistrationAuthorized bool   `json:"registrationAuthorized"`
}

func newEncodeValidatorRegistrationCommand() *cobra.Command {
	var path, pin string
	command := &cobra.Command{
		Use: "encode-validator-registration", Short: "Encode an independently pinned complete registration wire; does not authorize or submit it",
		Args: cobra.NoArgs, SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(*cobra.Command, []string) error { return nil },
		RunE: func(command *cobra.Command, _ []string) error {
			decodedPin, err := hex.DecodeString(pin)
			if err != nil || len(decodedPin) != 32 || hex.EncodeToString(decodedPin) != pin {
				return errors.New("registration wire requires an independent lowercase 32-byte SHA256 pin")
			}
			wire, err := readInitializationInput(path, ynxconsensusauth.MaxRegistrationBytes)
			if err != nil {
				return err
			}
			digest := sha256.Sum256(wire)
			if hex.EncodeToString(digest[:]) != pin {
				return errors.New("complete registration wire differs from its independent hash")
			}
			registration, err := ynxconsensusauth.DecodeRegistration(wire)
			if err != nil {
				return err
			}
			payload, err := consensus.EncodeValidatorRegistryTransaction(wire)
			if err != nil {
				return err
			}
			operationHash, err := ynxconsensusauth.RegistrationHash(wire)
			if err != nil {
				return err
			}
			abciHash := sha256.Sum256(payload)
			result := validatorRegistrationEncoding{Version: "YNX-VALIDATOR-REGISTRATION-ENCODING/v1", PayloadBase64: base64.StdEncoding.EncodeToString(payload), ABCIHash: "0x" + hex.EncodeToString(abciHash[:]), WireSHA256: pin, OperationHash: "0x" + hex.EncodeToString(operationHash[:]), ChainID: registration.Intent.ChainID, ConsensusGenesisSHA256: hex.EncodeToString(registration.Intent.GenesisID), ApprovedAt: registration.Intent.ApprovedAt, EffectiveAt: registration.Intent.EffectiveAt, ValidatorAddress: hex.EncodeToString(registration.Intent.ValidatorAddress), Encoded: true}
			return json.NewEncoder(command.OutOrStdout()).Encode(result)
		},
	}
	command.Flags().Var(&initializationStringFlag{target: &path}, "wire", "existing complete canonical Registration wire, including original approvals and both possession proofs")
	command.Flags().Var(&initializationStringFlag{target: &pin}, "wire-sha256", "independent exact raw wire SHA256")
	if err := command.MarkFlagRequired("wire"); err != nil {
		panic(err)
	}
	if err := command.MarkFlagRequired("wire-sha256"); err != nil {
		panic(err)
	}
	return command
}
