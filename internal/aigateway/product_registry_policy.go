package aigateway

type gatewayProductContextPolicy struct {
	DataClass     string
	Authority     string
	SourceOwner   string
	Approval      string
	MaxBytes      int64
	MaxAgeSeconds int64
}

// gatewayProductContextPolicies is the fail-closed Gateway execution snapshot of
// internal/aiproduct/product-ai-registry.json. The registry conformance test and
// release gate require exact equality so this map cannot silently drift.
var gatewayProductContextPolicies = map[string]map[string]gatewayProductContextPolicy{
	"ai": {
		"conversation": {DataClass: "private", Authority: "ynx-authoritative", SourceOwner: "14-ai", Approval: "session_scope", MaxBytes: 262144, MaxAgeSeconds: 86400},
	},
	"wallet": {
		"selected_wallet_records": {DataClass: "financial", Authority: "ynx-authoritative", SourceOwner: "02-wallet-auth", Approval: "explicit_selection_and_permission", MaxBytes: 131072, MaxAgeSeconds: 60},
	},
	"social": {
		"selected_social_content": {DataClass: "communications", Authority: "ynx-authoritative", SourceOwner: "03-social", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 300},
	},
	"pay": {
		"selected_pay_receipts": {DataClass: "financial", Authority: "ynx-authoritative", SourceOwner: "04-pay", Approval: "explicit_selection_and_permission", MaxBytes: 131072, MaxAgeSeconds: 60},
	},
	"card": {
		"selected_card_activity": {DataClass: "financial", Authority: "ynx-authoritative", SourceOwner: "06-card", Approval: "explicit_selection_and_permission", MaxBytes: 131072, MaxAgeSeconds: 60},
	},
	"exchange": {
		"selected_exchange_records": {DataClass: "financial", Authority: "ynx-authoritative", SourceOwner: "07-exchange", Approval: "explicit_selection_and_permission", MaxBytes: 196608, MaxAgeSeconds: 15},
	},
	"quant": {
		"selected_quant_research": {DataClass: "research", Authority: "ynx-authoritative", SourceOwner: "08-quant-lab", Approval: "explicit_selection_and_permission", MaxBytes: 524288, MaxAgeSeconds: 300},
	},
	"shop": {
		"selected_shop_orders": {DataClass: "commerce", Authority: "ynx-authoritative", SourceOwner: "09-shop", Approval: "explicit_selection_and_permission", MaxBytes: 196608, MaxAgeSeconds: 300},
	},
	"seller": {
		"selected_seller_records": {DataClass: "commerce", Authority: "ynx-authoritative", SourceOwner: "10-seller-console", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 300},
	},
	"developer": {
		"selected_code_context": {DataClass: "source-code", Authority: "user-selected", SourceOwner: "11-developer", Approval: "explicit_selection_and_permission", MaxBytes: 524288, MaxAgeSeconds: 3600},
	},
	"explorer": {
		"selected_public_chain_records": {DataClass: "public", Authority: "ynx-authoritative", SourceOwner: "01-chain-core", Approval: "explicit_selection", MaxBytes: 262144, MaxAgeSeconds: 15},
	},
	"monitor": {
		"selected_monitor_incidents": {DataClass: "operational", Authority: "ynx-authoritative", SourceOwner: "13-monitor", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 30},
	},
	"trust": {
		"selected_trust_records": {DataClass: "trust-sensitive", Authority: "ynx-authoritative", SourceOwner: "15-trust-center", Approval: "explicit_selection_and_permission", MaxBytes: 196608, MaxAgeSeconds: 300},
	},
	"resource": {
		"selected_resource_usage": {DataClass: "operational", Authority: "ynx-authoritative", SourceOwner: "resource", Approval: "explicit_selection_and_permission", MaxBytes: 196608, MaxAgeSeconds: 60},
	},
	"cloud": {
		"selected_cloud_files": {DataClass: "private-content", Authority: "ynx-authoritative", SourceOwner: "cloud", Approval: "explicit_selection_and_permission", MaxBytes: 524288, MaxAgeSeconds: 300},
	},
	"browser": {
		"selected_browser_history": {DataClass: "private-history", Authority: "user-selected", SourceOwner: "browser", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 300},
	},
	"search": {
		"selected_search_results": {DataClass: "public", Authority: "third-party", SourceOwner: "search", Approval: "explicit_selection", MaxBytes: 262144, MaxAgeSeconds: 300},
	},
	"finance": {
		"selected_finance_records": {DataClass: "financial", Authority: "ynx-authoritative", SourceOwner: "finance", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 60},
	},
	"mail": {
		"selected_mail_messages": {DataClass: "communications", Authority: "user-selected", SourceOwner: "mail", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 300},
	},
	"music": {
		"selected_music_library": {DataClass: "private-profile", Authority: "ynx-authoritative", SourceOwner: "music", Approval: "explicit_selection_and_permission", MaxBytes: 131072, MaxAgeSeconds: 3600},
	},
	"video": {
		"selected_video_assets": {DataClass: "private-content", Authority: "ynx-authoritative", SourceOwner: "video", Approval: "explicit_selection_and_permission", MaxBytes: 262144, MaxAgeSeconds: 3600},
	},
	"creator-studio": {
		"selected_creator_assets": {DataClass: "private-content", Authority: "ynx-authoritative", SourceOwner: "creator-studio", Approval: "explicit_selection_and_permission", MaxBytes: 524288, MaxAgeSeconds: 3600},
	},
	"docs": {
		"selected_documents": {DataClass: "private-content", Authority: "user-selected", SourceOwner: "docs", Approval: "explicit_selection_and_permission", MaxBytes: 524288, MaxAgeSeconds: 3600},
	},
	"calendar": {
		"selected_calendar_events": {DataClass: "communications", Authority: "user-selected", SourceOwner: "calendar", Approval: "explicit_selection_and_permission", MaxBytes: 131072, MaxAgeSeconds: 300},
	},
}
