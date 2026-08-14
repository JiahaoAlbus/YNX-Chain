package datafabriccalendar

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/JiahaoAlbus/YNX-Chain/internal/datafabric"
)

type mappingArtifact struct {
	SchemaVersion int    `json:"schemaVersion"`
	ContractID    string `json:"contractId"`
	Calendar      struct {
		Owner        string   `json:"owner"`
		ProductID    string   `json:"productId"`
		SourceCommit string   `json:"sourceCommit"`
		OutboxSchema string   `json:"outboxSchema"`
		EventTypes   []string `json:"eventTypes"`
	} `json:"calendar"`
	DataFabric struct {
		IntegrationAdapterCommit string `json:"integrationAdapterCommit"`
		EnvelopeVersion          string `json:"envelopeVersion"`
		RegistryVersion          string `json:"registryVersion"`
		RegistryDefinitions      int    `json:"registryDefinitions"`
		RegistryArtifact         string `json:"registryArtifact"`
		RegistrySHA256           string `json:"registrySha256"`
	} `json:"dataFabric"`
	Acceptance struct {
		ProducerOutboxTestedLocal        bool `json:"producerOutboxTestedLocal"`
		CentralSchemaMappedLocal         bool `json:"centralSchemaMappedLocal"`
		AuthenticatedTransportDeployed   bool `json:"authenticatedTransportDeployed"`
		DurableRuntimeAcceptanceVerified bool `json:"durableRuntimeAcceptanceVerified"`
		MailDeliveryEnvelopeAccepted     bool `json:"mailDeliveryEnvelopeAccepted"`
		SharedTestnetVerified            bool `json:"sharedTestnetVerified"`
		IntegratedCentral                bool `json:"integratedCentral"`
		DeployedPublic                   bool `json:"deployedPublic"`
	} `json:"acceptance"`
	RemainingGates []string `json:"remainingGates"`
}

func TestCommittedCalendarMappingArtifactMatchesRuntimeAndStaysTruthful(t *testing.T) {
	repositoryRoot := filepath.Join("..", "..")
	body, err := os.ReadFile(filepath.Join(repositoryRoot, "release", "integration", "calendar-data-fabric-v2-mapping.json"))
	if err != nil {
		t.Fatal(err)
	}
	var artifact mappingArtifact
	if err := json.Unmarshal(body, &artifact); err != nil {
		t.Fatal(err)
	}
	if artifact.SchemaVersion != 1 || artifact.ContractID != "calendar-data-fabric-v2-mapping" || artifact.Calendar.Owner != CalendarOwner || artifact.Calendar.ProductID != CalendarProductID || artifact.Calendar.OutboxSchema != CalendarSchemaVersion {
		t.Fatalf("Calendar mapping identity drifted: %+v", artifact)
	}
	if artifact.Calendar.SourceCommit != "f1305e6b52c7484c099fe6b2f6cbc2b6d36508e2" || artifact.DataFabric.IntegrationAdapterCommit != "6f45ec22f7fb0eabc0a630d40d250de9caf75c28" {
		t.Fatalf("Calendar mapping source provenance drifted: %+v", artifact)
	}
	registry := datafabric.DefaultSchemaRegistry()
	definitions := registry.Definitions("calendar")
	eventTypes := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		eventTypes = append(eventTypes, definition.EventType)
	}
	sort.Strings(eventTypes)
	expectedTypes := append([]string(nil), artifact.Calendar.EventTypes...)
	sort.Strings(expectedTypes)
	if !reflect.DeepEqual(eventTypes, expectedTypes) || artifact.DataFabric.RegistryDefinitions != len(registry.Definitions("")) || artifact.DataFabric.RegistryVersion != registry.Version() || artifact.DataFabric.EnvelopeVersion != datafabric.EnvelopeSchemaVersionV2 {
		t.Fatalf("mapping artifact does not match the runtime registry: types=%v artifact=%+v", eventTypes, artifact.DataFabric)
	}
	registryBody, err := os.ReadFile(filepath.Join(repositoryRoot, filepath.FromSlash(artifact.DataFabric.RegistryArtifact)))
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(registryBody)
	if hex.EncodeToString(digest[:]) != artifact.DataFabric.RegistrySHA256 {
		t.Fatal("mapping artifact registry digest is stale")
	}
	if !artifact.Acceptance.ProducerOutboxTestedLocal || !artifact.Acceptance.CentralSchemaMappedLocal {
		t.Fatal("directly tested local producer and mapping states are understated")
	}
	if artifact.Acceptance.AuthenticatedTransportDeployed || artifact.Acceptance.DurableRuntimeAcceptanceVerified || artifact.Acceptance.MailDeliveryEnvelopeAccepted || artifact.Acceptance.SharedTestnetVerified || artifact.Acceptance.IntegratedCentral || artifact.Acceptance.DeployedPublic {
		t.Fatal("mapping artifact overclaims central, Mail, Testnet, or public acceptance")
	}
	if len(artifact.RemainingGates) < 6 {
		t.Fatal("mapping artifact omits material central acceptance gates")
	}
}
