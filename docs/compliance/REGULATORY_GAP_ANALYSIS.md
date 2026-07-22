# YNX Regulatory and Compliance Gap Analysis

| Metadata | Value |
| --- | --- |
| Version | 0.1.1-candidate |
| Effective date | 2026-07-22 |
| Evidence source commit | `719e1018267ed5a53e6fae5211c5fd8a1503c35c` |
| Product release | YNX Testnet documentation candidate |
| Last reviewed | 2026-07-22 |
| Superseded version | None |
| Review status | Issue-spotting draft; not legal advice, license determination or approval |

## Executive conclusion

YNX is not ready to claim regulated production services. The legal entity,
jurisdictions, customer/product scope, licenses/registrations, compliance officers,
policies, providers, contracts, monitoring, reports, audits and regulator-facing
evidence are incomplete. Testnet engineering and a non-executing control plane do
not remove legal obligations if a production service performs a regulated activity.

An official-source issue-spotting refresh completed on 2026-07-22. FATF's 2021
[updated VA/VASP guidance](https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html)
addresses risk assessment, VASP licensing/registration, stablecoins, peer-to-peer
risk and the travel rule; FATF's [virtual-assets topic page](https://www.fatf-gafi.org/en/topics/virtual-assets.html)
lists later implementation updates. US sources reviewed were FinCEN's
[convertible virtual currency guidance](https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering)
and OFAC's [virtual-currency sanctions guidance](https://ofac.treasury.gov/system/files/126/virtual_currency_guidance_brochure.pdf).
The EU source reviewed was the official text of
[Regulation (EU) 2023/1114 (MiCA)](https://eur-lex.europa.eu/eli/reg/2023/1114/oj?locale=en),
which addresses offers/admission, issuer and crypto-asset-service-provider
authorization/governance, holder/client protection and market integrity.

These sources show why activity-specific analysis is required; they do not decide
YNX's classification, applicability, licensing position or compliance. Qualified
counsel must verify amendments, effective/transitional rules, national
implementation and every relevant jurisdiction before launch.

## Classification method

For each product and jurisdiction, counsel must map:

1. legal entity and location;
2. users/customers and marketing reach;
3. assets and legal characterization;
4. custody/control and transaction authority;
5. activity flow and counterparties;
6. fees/revenue and conflicts;
7. data and outsourcing;
8. licensing/registration/reporting;
9. consumer/investor protection; and
10. launch, monitoring, incident and exit obligations.

## AML/KYC/KYB gap

| Required area | Current evidence | Gap before production |
| --- | --- | --- |
| Risk assessment | General caution only | Entity/product/customer/geography/channel/asset risk assessment |
| Customer identification | No central approved program | KYC/KYB, beneficial ownership, verification, exceptions and refresh |
| Enhanced due diligence | Not established | Triggers, source of funds/wealth, high-risk approval and review |
| Transaction monitoring | Product telemetry is not AML monitoring | Scenarios, thresholds, tuning, case workflow, QA and model governance |
| Suspicious activity | Not established | Jurisdiction-specific escalation, filing, confidentiality and retention |
| Travel-rule data | Not established | Applicability, counterparty/provider, data quality, privacy and failure |
| Recordkeeping | Technical logs only | Statutory records, access, retention, legal hold and audit |
| Governance | Not established | Officer, board reporting, training, independent testing and remediation |

KYC/KYB is not automatically required for every public software interaction, but
may be required for custodial, exchange, payment, card, stablecoin, bridge,
managed-vault or other in-scope services. Counsel must decide by activity and
jurisdiction.

## Sanctions gap

Required work includes jurisdiction/exposure mapping, sanctions ownership/control
rules, screening sources, onboarding and ongoing screening, wallet/address and
transaction risk treatment, false-positive resolution, blocking/rejecting rules,
reporting, recordkeeping, geolocation/device controls where lawful, evasion
typologies, provider governance, testing and escalation.

Screening data is an input, not final authority. Asset restrictions require a
defined legal/protocol authority, evidence, scope, appeal/correction and audit.
The current stablecoin service cannot freeze native YNXT.

## Payments gap

Pay intents and Testnet settlement engineering do not establish a licensed
payment service. Analyze money transmission/payment institution, merchant
acquiring, stored value, remittance, settlement, refunds/chargebacks, safeguarding,
capital, agent/provider, disclosures, receipts, complaints, fraud, AML/sanctions,
privacy, escheatment and cross-border obligations by flow and jurisdiction.

No public consumer value-transfer claim should launch without approved Wallet,
settlement, refund/dispute, provider and reconciliation evidence.

## Exchange gap

Analyze exchange/virtual-asset service, broker/dealer, trading venue, derivatives,
custody, market-making, listing, market-abuse/surveillance, best execution, client-
asset segregation, capital, conflicts, disclosures, complaints, reporting and
wind-down. Testnet order books or paper markets must not be marketed as regulated
production liquidity.

Production custody, deposits/withdrawals, listing approval, market surveillance,
proof of liabilities/solvency and legal authorization are absent.

## Stablecoin gap

Analyze issuer/e-money/payment token/stablecoin classification, authorization,
whitepaper/disclosure, reserve eligibility/segregation, custody, attestation,
redemption, capital, governance, interest/yield restrictions, distribution,
marketing, complaints, AML/sanctions, recovery and insolvency.

The current service records review and non-executing intents only. No issuer,
token, reserve, redemption or peg/liquidity evidence exists.

## Card gap

No active card program is claimed. Before any card product, determine issuer,
network, processor, program manager and sponsor-bank roles; BIN/program approval;
KYC/AML/sanctions; funding and safeguarding; authorization/clearing/settlement;
fees and exchange rates; chargebacks/disputes; fraud; PCI DSS scope; privacy;
consumer credit/debit/prepaid rules; complaints; reporting and wind-down.

UI, test cards or provider adapters must not be presented as card issuance.

## Custody gap

Analyze legal custody/control, customer asset/title, segregation, subcustody,
hot/warm/cold keys, threshold approval, withdrawal governance, staking/governance
rights, rehypothecation, insurance, statements, reconciliation, proof of
liabilities/solvency, incidents, recovery, succession and insolvency.

Current deterministic test vectors and signer procedures are not production
custody or provider approval.

## Bridge gap

Analyze who controls locked/minted/released assets, represented-asset legal status,
relayer/custody authority, money-transmission/exchange implications, sanctions,
consumer disclosures, finality, limits, reserves/liabilities, fees, incidents,
recovery and cross-border flows. The current Bridge is local and non-executing.

## Managed Quant and vault gap

Analyze investment adviser/manager, collective investment, broker/execution,
derivatives, custody, suitability/appropriateness, mandate, best execution,
valuation, fees/high-water marks, performance marketing, conflicts, liquidity,
reporting, complaints and wind-down. Paper trading and AI suggestions are not
authorization for managed assets.

## Privacy and AI gap

Complete entity/data-flow/lawful-basis mapping, provider contracts, international
transfers, retention, rights, tracking, children, sensitive data, security and
breach response. AI requires context consent, provider/model/retention/training
disclosure, human approval, audit, explanation/appeal for consequential use and
prohibition on autonomous sensitive actions.

## Consumer and marketing gap

Terms, privacy, AUP, fees, risks, support, complaints, refunds/disputes, status,
accessibility and local-language review are incomplete. Every economic/financial
claim requires the capital-claim fields and evidence ID. Dark patterns, fabricated
social proof/rankings and unsupported urgency/guarantees are prohibited.

## Licensing decision record required

For each launch market/product, counsel should produce a signed decision record:

- facts and architecture reviewed;
- legal entity and jurisdictions;
- regulated activities and asset classifications;
- licenses/registrations or reason not required;
- conditions, limits and prohibited flows;
- required policies/providers/contracts/capital;
- disclosures and marketing restrictions;
- reporting/recordkeeping/incident obligations;
- launch approval, expiry and change triggers; and
- responsible executive and counsel.

## Launch blockers

- No approved legal entity/jurisdiction/product map.
- No signed license analysis or required registrations.
- No approved AML/KYC/KYB/sanctions program for in-scope services.
- No production custody, reserve/redemption, Bridge, card or exchange controls.
- No complete privacy/provider/transfer/retention program.
- No effective Terms, Privacy, AUP, support, complaints or incident contacts.
- No final token allocation/economic governance and marketing approval.
- No independent legal/security/economic review packet acceptance.

## Change log

- 0.1.1-candidate (2026-07-22): Refreshed issue spotting against official FATF,
  OFAC, FinCEN and EUR-Lex sources without inferring a YNX legal conclusion.
- 0.1.0-candidate (2026-07-22): Added cross-product classification method and
  AML/KYC, sanctions, payments, exchange, stablecoin, card, custody, Bridge,
  managed Quant, privacy/AI, consumer/marketing, decision-record and launch gaps.
