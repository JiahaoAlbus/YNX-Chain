package commerce

import "time"

const (
	ChainID      = 6423
	ChainName    = "ynx_6423-1"
	NativeSymbol = "YNXT"
)

type StoreProfile struct {
	ID, Owner, Name, Description, Policy, TrustURL, SettlementAccount string
	Status                                                            string
	CreatedAt, UpdatedAt                                              time.Time
}

type PublicStore struct {
	ID, Name, Description, Policy, TrustURL, Status string
}

type BuyerProfile struct {
	Account, DisplayName string
	Addresses            []Address
	UpdatedAt            time.Time
}

type Cart struct {
	Buyer     string
	Items     []CartItem
	UpdatedAt time.Time
}

type Variant struct {
	ID, Name, SKU string
	PriceYNXT     int64
	Inventory     int64
	Reserved      int64
}

type MediaAsset struct {
	URL, AltText, Kind string
}

type ProductRevision struct {
	Revision                     int64
	Actor, Action, RequestHash   string
	Title, Description, Category string
	Media                        []MediaAsset
	Variants                     []Variant
	Published                    bool
	At                           time.Time
}

type Product struct {
	ID, StoreID, Title, Description, Category string
	Published                                 bool
	Media                                     []MediaAsset
	Variants                                  []Variant
	Revision                                  int64
	EditHistory                               []ProductRevision
	CreatedAt, UpdatedAt                      time.Time
}

type CartItem struct {
	ProductID, VariantID string
	Quantity             int64
}

type Address struct {
	Recipient, Line1, City, Region, PostalCode, Country string
}

type OrderLine struct {
	ProductID, VariantID, Title, VariantName string
	Quantity, UnitPriceYNXT                  int64
}

type Shipment struct {
	Carrier, TrackingNumber, Status string
	UpdatedAt                       time.Time
}

type Resolution struct {
	Kind, Status, Reason, Explanation string
	RequestedAt, UpdatedAt            time.Time
}

type Review struct {
	Rating    int
	Body      string
	CreatedAt time.Time
}

type TrustCaseEvidence struct {
	CaseID, Status, EvidenceURL, AppealURL, Source string
	SubmittedAt                                    time.Time
}

type SettlementEvidence struct {
	InvoiceID, IntentID, Merchant, PayoutAddress, TransactionHash, Status, Payer, Currency, AuditHash string
	AmountYNXT                                                                                        int64
	BlockHeight                                                                                       uint64
	ConfirmedAt                                                                                       time.Time
}

type RefundEvidence struct {
	ID, Signer, Merchant, IntentID, Currency, Reason, Status, IdempotencyKey, RequestHash, TransactionHash, AuditHash string
	AmountYNXT                                                                                                        int64
	BlockHeight                                                                                                       uint64
	RecordedAt                                                                                                        time.Time
}

type Order struct {
	ID, Buyer, StoreID, Status, Currency, InvoiceID, PayIntentID, PayMerchant, PayPayoutAddress string
	Lines                                                                                       []OrderLine
	Address                                                                                     Address
	SubtotalYNXT, ShippingYNXT, TaxYNXT, TotalYNXT                                              int64
	TaxStatus, LogisticsStatus, RefundStatus, TrustStatus                                       string
	ReservationExpiresAt                                                                        time.Time
	Settlement                                                                                  *SettlementEvidence
	Refund                                                                                      *RefundEvidence
	Shipment                                                                                    *Shipment
	Resolution                                                                                  *Resolution
	Review                                                                                      *Review
	TrustCase                                                                                   *TrustCaseEvidence
	Timeline                                                                                    []OrderEvent
	CreatedAt, UpdatedAt                                                                        time.Time
}

type OrderEvent struct {
	ID, Actor, Role, Action, Status, Detail string
	At                                      time.Time
}

type AuditEvent struct {
	ID, Actor, Role, Action, ObjectType, ObjectID, Outcome, Detail string
	At                                                             time.Time
}

type IdempotencyRecord struct {
	Actor, Route, Key, RequestHash, ObjectID string
	CreatedAt                                time.Time
}

type AIJob struct {
	ID, Actor, Workflow, Status, ProviderStatus, ContextSummary string
	ContextClasses, AllowedActions                              []string
	EstimateUnits                                               int64
	PermissionGranted                                           bool
	Result, Failure                                             string
	Applied, Rejected, Cancelled                                bool
	CreatedAt, UpdatedAt                                        time.Time
}

type Snapshot struct {
	Version       int
	Stores        map[string]StoreProfile
	Products      map[string]Product
	Orders        map[string]Order
	Idempotency   map[string]IdempotencyRecord
	Audits        []AuditEvent
	AIJobs        map[string]AIJob
	BuyerProfiles map[string]BuyerProfile
	Carts         map[string]Cart
	SellerRoles   map[string]map[string]string
	RequestWindow map[string][]time.Time
}
