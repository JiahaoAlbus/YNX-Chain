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

type Product struct {
	ID, StoreID, Title, Description, Category string
	Published                                 bool
	Variants                                  []Variant
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

type SettlementEvidence struct {
	InvoiceID, TransactionHash, Status, Payer string
	AmountYNXT                                int64
	BlockHeight                               uint64
	ConfirmedAt                               time.Time
}

type Order struct {
	ID, Buyer, StoreID, Status, Currency, InvoiceID string
	Lines                                           []OrderLine
	Address                                         Address
	SubtotalYNXT, ShippingYNXT, TaxYNXT, TotalYNXT  int64
	TaxStatus, LogisticsStatus                      string
	ReservationExpiresAt                            time.Time
	Settlement                                      *SettlementEvidence
	Shipment                                        *Shipment
	Resolution                                      *Resolution
	Review                                          *Review
	CreatedAt, UpdatedAt                            time.Time
}

type AuditEvent struct {
	ID, Actor, Role, Action, ObjectType, ObjectID, Outcome, Detail string
	At                                                             time.Time
}

type Session struct {
	Token, Account, Role string
	ExpiresAt            time.Time
}

type WalletChallenge struct {
	ID, Account, Nonce, Product, Callback, DeviceID string
	Scopes                                          []string
	Purpose                                         string
	IssuedAt, ExpiresAt                             time.Time
	Consumed                                        bool
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
	Sessions      map[string]Session
	Challenges    map[string]WalletChallenge
	Idempotency   map[string]IdempotencyRecord
	Audits        []AuditEvent
	AIJobs        map[string]AIJob
	BuyerProfiles map[string]BuyerProfile
	Carts         map[string]Cart
	SellerRoles   map[string]map[string]string
	RequestWindow map[string][]time.Time
}
