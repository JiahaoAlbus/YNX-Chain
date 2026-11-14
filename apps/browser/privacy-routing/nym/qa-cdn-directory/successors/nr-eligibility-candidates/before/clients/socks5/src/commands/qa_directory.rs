//! No profile argument, key access, init, gateway registration or normal readiness output.
use std::{collections::{BTreeMap,BTreeSet}, error::Error, fs::File, io::Read, path::PathBuf};
use nym_crypto::{Digest,sha2::Sha256};
use nym_validator_client::{qa_directory as transport, nym_nodes::{BasicEntryInformation,PaginatedCachedNodesResponseV2,SkimmedNodeV1,NodeRole}, pagination::PaginatedResponse, models::described::v2::NymNodeDescriptionV2};

#[derive(clap::Args)]
pub(crate) struct Args {
    #[clap(long)] plan: PathBuf,
    #[clap(long)] plan_sha256: String,
    #[clap(long)] run_id: String,
}
pub(crate) fn install(args:&Args) -> Result<(),Box<dyn Error+Send+Sync>> {
    use std::os::unix::fs::MetadataExt;
    unsafe extern "C" {fn geteuid()->u32;}
    let before=std::fs::symlink_metadata(&args.plan)?;
    if !before.is_file() || before.uid()!=unsafe{geteuid()} || before.nlink()!=1 || before.mode()&0o777!=0o600 || before.len()>4096 {
        return Err("qa-directory-unsafe-plan-file".into())
    }
    let mut file=File::open(&args.plan)?;let actual=file.metadata()?;
    if actual.ino()!=before.ino() || actual.dev()!=before.dev() || actual.uid()!=before.uid() || actual.mode()!=before.mode() || actual.nlink()!=1 {
        return Err("qa-directory-changed-plan-file".into())
    }
    let mut bytes=Vec::new();file.by_ref().take(4097).read_to_end(&mut bytes)?;
    let digest=Sha256::digest(&bytes).iter().map(|b|format!("{b:02x}")).collect::<String>();
    if bytes.len()>4096 || args.plan_sha256.len()!=64 || digest!=args.plan_sha256 {return Err("qa-directory-plan-sha".into())}
    transport::install(&bytes,&args.run_id)?;Ok(())
}

fn complete<T>(page:&PaginatedResponse<T>) -> bool {
    page.pagination.page==0 && page.pagination.total>0 && page.pagination.total<=20_000
        && page.pagination.total==page.data.len() && page.pagination.size==page.data.len()
}
fn canonical_wss_hostname(hostname:&str) -> bool {
    let Ok(parsed)=url::Url::parse(&format!("https://{hostname}/")) else {return false};
    hostname.is_ascii() && hostname.len()<=253 && hostname==hostname.to_ascii_lowercase()
        && parsed.host_str()==Some(hostname) && matches!(parsed.host(),Some(url::Host::Domain(_)))
        && hostname.parse::<std::net::IpAddr>().is_err() && parsed.username().is_empty()
        && parsed.password().is_none() && parsed.query().is_none() && parsed.fragment().is_none()
}
/// Official BasicEntryInformation and RoutingNode::ws_entry_address_tls describe
/// absent hostname/WSS as no TLS capability. Preserve every original row; absence
/// is not a matched endpoint and never grants eligibility or a WS downgrade.
fn tls_entry_eligible(entry:Option<&BasicEntryInformation>, described:&BasicEntryInformation) -> Result<bool,String> {
    for info in [entry,Some(described)].into_iter().flatten() {
        if info.wss_port==Some(0) {return Err("qa-directory-entry-wss-zero".into())}
        if info.hostname.as_deref().is_some_and(|h|!canonical_wss_hostname(h)) {
            return Err("qa-directory-entry-wss-hostname".into())
        }
    }
    let Some(entry)=entry else {return Ok(false)};
    // Known conflicts must not be masked by another optional field being absent.
    if entry.ws_port!=described.ws_port {return Err("qa-directory-entry-ws-port-mismatch".into())}
    if let (Some(a),Some(b))=(&entry.hostname,&described.hostname) {
        if a!=b {return Err("qa-directory-entry-hostname-mismatch".into())}
    }
    if let (Some(a),Some(b))=(entry.wss_port,described.wss_port) {
        if a!=b {return Err("qa-directory-entry-wss-port-mismatch".into())}
    }
    Ok(matches!((&entry.hostname,&described.hostname,entry.wss_port,described.wss_port),
        (Some(a),Some(b),Some(port),Some(other)) if a==b && port==other && port!=0))
}
/// Directory completeness is not a promise that every public service is a
/// usable requester. The upstream SDK skips absent/unparseable NR candidates.
/// This QA deliberately narrows selection further to the official exit policy
/// and the embedded same-node gateway contract, without removing any raw row.
fn qa_requester_eligible(requester:Option<&nym_validator_client::models::described::v2::NetworkRequesterDetailsV2>,
    identity:nym_crypto::asymmetric::ed25519::PublicKey) -> bool {
    let Some(requester)=requester else {return false};
    let Ok(address)=requester.address.parse::<nym_sphinx::addressing::Recipient>() else {return false};
    requester.uses_exit_policy && address.gateway()==identity
}
fn validate_snapshot(basic:&PaginatedCachedNodesResponseV2<SkimmedNodeV1>, described:&PaginatedResponse<NymNodeDescriptionV2>, epoch:&serde_json::Value) -> Result<(),String> {
    if !complete(&basic.nodes) || !complete(described) || basic.metadata.status.is_some() {return Err("qa-directory-incomplete-or-no-updates".into())}
    let now=time::OffsetDateTime::now_utc();
    let start=epoch["current_epoch_start"].as_str().and_then(|v|time::OffsetDateTime::parse(v,&time::format_description::well_known::Rfc3339).ok()).ok_or("qa-directory-epoch-start")?;
    let seconds=epoch["epoch_length"]["secs"].as_i64().ok_or("qa-directory-epoch-length")?;
    if !(600..=86400).contains(&seconds) || epoch["epoch_length"]["nanos"].as_u64()!=Some(0)
        || epoch["total_elapsed_epochs"].as_u64()!=Some(basic.metadata.absolute_epoch_id as u64)
        || start>now || start+time::Duration::seconds(seconds)<=now+time::Duration::seconds(300)
    {return Err("qa-directory-stale-epoch".into())}
    let refreshed=basic.metadata.refreshed_at();
    if refreshed>now+time::Duration::seconds(5) || now-refreshed>time::Duration::seconds(seconds) {return Err("qa-directory-stale-metadata".into())}
    let mut full=BTreeMap::new();let mut identities=BTreeMap::new();
    for node in &described.data {
        let key=node.ed25519_identity_key().to_base58_string();
        if full.insert(node.node_id,node).is_some() || identities.insert(key,node.node_id).is_some() {return Err("qa-directory-ambiguous-description".into())}
    }
    let mut ids=BTreeSet::new();let mut keys=BTreeSet::new();let mut entries=0;let mut exits=0;
    let mut unjoined_basics=0;let mut ineligible_requesters=0;
    for node in &basic.nodes.data {
        let identity=node.ed25519_identity_pubkey.to_base58_string();
        if !ids.insert(node.node_id) || !keys.insert(identity.clone()) {return Err("qa-directory-ambiguous-basic".into())}
        if node.ip_addresses.is_empty() {return Err("qa-directory-address-mismatch".into())}
        // Do not hide a known cross-key/id conflict as an absent description.
        if identities.get(&identity).is_some_and(|id|*id!=node.node_id) {return Err("qa-directory-node-id-identity-conflict".into())}
        // The official SDK documents described nodes as a scraped subset. An
        // absent join cannot be selected; the complete Basic row remains intact.
        let Some(description)=full.get(&node.node_id) else {unjoined_basics+=1;continue};
        if description.ed25519_identity_key()!=node.ed25519_identity_pubkey {return Err("qa-directory-identity-mismatch".into())}
        let host=&description.description.host_information;
        if node.ip_addresses.iter().collect::<BTreeSet<_>>()!=host.ip_address.iter().collect::<BTreeSet<_>>() {
            return Err("qa-directory-address-mismatch".into())
        }
        if matches!(node.role,NodeRole::EntryGateway) && node.supported_roles.entry {
            // Official constructor copies the exact described hostname/WS/WSS fields.
            // Do not fill missing Basic fields from it or remove any node from output.
            entries+=usize::from(tls_entry_eligible(node.entry.as_ref(),&description.entry_information())?);
        }
        if matches!(node.role,NodeRole::ExitGateway) && node.supported_roles.exit_nr {
            if qa_requester_eligible(description.description.network_requester.as_ref(),node.ed25519_identity_pubkey) {exits+=1}
            else {ineligible_requesters+=1}
        }
    }
    tracing::info!(target:"ynx_qa_directory", basic_rows=basic.nodes.data.len(), described_rows=described.data.len(),
        tls_eligible_entries=entries, qa_eligible_requesters=exits, unjoined_basics, ineligible_requesters,
        "qa_directory_complete_data_candidate_capabilities");
    if entries==0 || exits==0 {return Err("qa-directory-no-current-entry-exit".into())}
    Ok(())
}
/// A response's `size` is page-local. Normalize it only after every declared row has
/// arrived; never rewrite total or promote a partial page to a complete directory.
struct CompletePages<T> { total:Option<usize>, rows:Vec<T>, next:u8 }
impl<T> CompletePages<T> {
    fn new() -> Self {Self{total:None,rows:Vec::new(),next:0}}
    fn push(&mut self,page:PaginatedResponse<T>) -> Result<bool,String> {
        if self.next>=80 || page.pagination.page!=self.next as u32 || page.pagination.total==0 || page.pagination.total>20_000
            || page.data.is_empty() || page.pagination.size<page.data.len() || page.pagination.size>page.pagination.total
            || self.total.is_some_and(|total|total!=page.pagination.total)
            || self.rows.len().checked_add(page.data.len()).is_none_or(|length|length>page.pagination.total)
        {return Err("qa-directory-page-contract".into())}
        self.total=Some(page.pagination.total);self.rows.extend(page.data);self.next+=1;
        Ok(self.rows.len()==self.total.unwrap())
    }
    fn finish(self) -> Result<PaginatedResponse<T>,String> {
        if self.total!=Some(self.rows.len()) || self.rows.is_empty() {return Err("qa-directory-incomplete-pages".into())}
        Ok(PaginatedResponse{pagination:nym_validator_client::pagination::Pagination{total:self.rows.len(),size:self.rows.len(),page:0},data:self.rows})
    }
}
async fn fetch_basic(session:&mut transport::Session) -> Result<PaginatedCachedNodesResponseV2<SkimmedNodeV1>,Box<dyn Error+Send+Sync>> {
    let mut pages=CompletePages::new();let mut metadata=None;
    for page in 0..80 {
        let bytes=session.fetch(transport::Resource::Basic(page)).await?;
        let value:PaginatedCachedNodesResponseV2<SkimmedNodeV1>=serde_json::from_slice(&bytes).map_err(|_|"qa-directory-basic-type")?;
        if !same_metadata(&metadata,&value.metadata) {return Err("qa-directory-page-metadata-changed".into())}
        if metadata.is_none() {metadata=Some(value.metadata)}
        if pages.push(value.nodes)? {return Ok(PaginatedCachedNodesResponseV2{metadata:metadata.unwrap(),nodes:pages.finish()?})}
    }
    Err("qa-directory-page-count".into())
}
fn same_metadata(previous:&Option<nym_validator_client::nym_nodes::NodesResponseMetadata>, next:&nym_validator_client::nym_nodes::NodesResponseMetadata) -> bool {
    previous.as_ref().is_none_or(|old|serde_json::to_value(old).ok()==serde_json::to_value(next).ok())
}
async fn fetch_described(session:&mut transport::Session) -> Result<PaginatedResponse<NymNodeDescriptionV2>,Box<dyn Error+Send+Sync>> {
    let mut pages=CompletePages::new();
    for page in 0..80 {
        let bytes=session.fetch(transport::Resource::Described(page)).await?;
        let value:PaginatedResponse<NymNodeDescriptionV2>=nym_validator_client::reviewed_network::decode_directory_bincode(&bytes)?;
        if pages.push(value)? {return Ok(pages.finish()?)}
    }
    Err("qa-directory-page-count".into())
}
pub(crate) async fn execute() -> Result<(),Box<dyn Error+Send+Sync>> {
    let mut session=transport::take_session()?;
    let basic=fetch_basic(&mut session).await?;
    let described=fetch_described(&mut session).await?;
    let epoch_bytes=session.fetch(transport::Resource::Epoch).await?;
    let epoch:serde_json::Value=serde_json::from_slice(&epoch_bytes).map_err(|_|"qa-directory-epoch-type")?;
    validate_snapshot(&basic,&described,&epoch)?;session.require_live()?;
    // Exact original DATA envelope; never a proof of route/NE/normal authorization.
    let bytes=serde_json::to_vec(&serde_json::json!({"schema":"YNX_NYM_DIRECTORY_V1","basic":basic,"described":described,"epoch":epoch}))?;
    if bytes.len()>16_777_216 {return Err("qa-directory-envelope-size".into())}
    session.require_live()?;
    use std::io::Write;let mut stdout=std::io::stdout().lock();stdout.write_all(&bytes)?;stdout.write_all(b"\n")?;Ok(())
}
