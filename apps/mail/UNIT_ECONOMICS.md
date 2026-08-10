# Mail unit economics

YNX Mail has no approved production provider, commercial terms, paid user
baseline or accepted billing schema. Numeric per-user cost, free quota, charge
or margin would therefore be fabricated.

| Component | Current value | Required evidence |
|---|---|---|
| Native message storage/delivery | unavailable | deployed usage and infrastructure bill |
| Internet mail submission | unavailable | approved provider terms and invoice |
| Attachment storage/egress | unavailable | approved object-store terms and usage |
| AI drafting/summaries | unavailable | provider/model/token invoice |
| Abuse, complaint and support handling | unavailable | privacy-reviewed operational telemetry |
| User charge or free quota | not approved | Product decision and Data Fabric billing contract |

For a measured period:

`cost per active user = (compute + storage + egress + provider + AI + support) / active users`

`gross margin candidate = accepted user/service revenue - attributable costs`

Provider acceptance is not inbox delivery, read confirmation or revenue. No
free quota or charge may be published until the provider terms, Data Fabric
billing schema, refund/dispute handling and user confirmation flow are accepted.

Scale only after two review periods show SLO compliance, bounded complaint and
abuse rates, sustainable provider cost and staffed support capacity. Pause or
kill Internet delivery on credential leakage, sender-auth failure, unbounded
queue growth, complaint suppression failure, data-rights failure or misleading
delivery status.
