//! Explicit, compile-time QA-only directory successor. Never installs the normal reviewed
//! network context, provisions a profile, or grants Root/Browser/release qualification.
use std::{collections::BTreeSet, future::Future, net::{IpAddr, SocketAddr}, sync::{Arc, OnceLock, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use serde::Deserialize;
use crate::expiry_deadline::{AbsolutePolicyDeadline, DeadlineFailure};

pub const SOURCE_SHA256: &str = "596d541b58fdfe26082f858437165969a3933316482c279efbd21f5494b55a7b";
pub const ORIGIN: &str = "https://cdn1.media-platform.net";
const HOST: &str = "cdn1.media-platform.net";
const IP: &str = "172.104.178.252";
const MAX_BODY: usize = 4_194_304;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Input {
    schema: String, purpose: String,
    #[serde(rename="runID")] run_id: String,
    #[serde(rename="issuedAt")] issued_at: u64,
    #[serde(rename="expiresAt")] expires_at: u64,
    #[serde(rename="networkDefaultsSHA256")] source_sha256: String,
    origin: String, addresses: Vec<IpAddr>,
}
struct Plan { input: Input, deadline: AbsolutePolicyDeadline }
static INSTALLED: OnceLock<Plan> = OnceLock::new();
static CLAIMED: AtomicBool = AtomicBool::new(false);

fn now() -> Result<u64, String> {SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_secs()).map_err(|_|"qa-directory-clock".into())}
fn validate(bytes:&[u8], expected_run:&str, clock:u64) -> Result<Input,String> {
    if bytes.len()>4096 {return Err("qa-directory-plan-size".into())}
    let input:Input=serde_json::from_slice(bytes).map_err(|_|"qa-directory-plan-schema")?;
    if input.schema!="YNX_NYM_QA_CDN_DIRECTORY_V1" || input.purpose!="fresh-complete-directory-only"
        || input.run_id!=expected_run || !input.run_id.starts_with("qa-dir-") || input.run_id.len()!=39
        || !input.run_id[7..].bytes().all(|v|v.is_ascii_digit() || (b'a'..=b'f').contains(&v))
        || input.source_sha256!=SOURCE_SHA256 || input.origin!=ORIGIN
        || input.addresses!=vec![IP.parse::<IpAddr>().unwrap()]
        || input.issued_at>clock.saturating_add(5) || clock.saturating_sub(input.issued_at)>120
        || input.expires_at<=clock || input.expires_at<=input.issued_at || input.expires_at-input.issued_at>120
        || input.expires_at>clock.saturating_add(120)
    {return Err("qa-directory-plan-binding".into())}
    Ok(input)
}
/// Bytes/SHA/uid/mode/file-identity are verified by the dedicated CLI before this call.
/// No ordinary policy schema or normal init/run command can consume this purpose.
pub fn install(bytes:&[u8], expected_run:&str) -> Result<(),String> {
    if crate::reviewed_network::active() || INSTALLED.get().is_some() {return Err("qa-directory-mixed-context".into())}
    let input=validate(bytes,expected_run,now()?)?;
    let deadline=AbsolutePolicyDeadline::from_unix_seconds(input.expires_at).map_err(|_|"qa-directory-expired")?;
    INSTALLED.set(Plan{input,deadline}).map_err(|_|"qa-directory-repeated-install".into())
}

#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub enum Resource { Basic(u8), Described(u8), Epoch }
impl Resource {
    pub fn label(self) -> &'static str {match self {Self::Basic(_)=>"basic",Self::Described(_)=>"described",Self::Epoch=>"epoch"}}
    fn page(self) -> Option<u8> {
        match self { Self::Basic(page) | Self::Described(page) => Some(page), Self::Epoch => None }
    }
    fn target(self) -> String {match self {
        Self::Basic(page)=>format!("https://cdn1.media-platform.net/api/v2/unstable/nym-nodes/skimmed?page={page}&per_page=250"),
        Self::Described(page)=>format!("https://cdn1.media-platform.net/api/v2/nym-nodes/described?page={page}&per_page=250&output=bincode"),
        Self::Epoch=>"https://cdn1.media-platform.net/api/v1/epoch/current".into(),
    }}
    fn follows(self, previous:Option<Self>) -> bool {match (previous,self) {
        (None,Self::Basic(0))=>true,
        (Some(Self::Basic(old)),Self::Basic(next)) | (Some(Self::Described(old)),Self::Described(next))=>next<80 && next==old.saturating_add(1),
        (Some(Self::Basic(_)),Self::Described(0)) | (Some(Self::Described(_)),Self::Epoch)=>true,
        _=>false,
    }}
}
struct ClosedResolver { deadline: AbsolutePolicyDeadline }
impl reqwest::dns::Resolve for ClosedResolver {
    fn resolve(&self,name:reqwest::dns::Name)->reqwest::dns::Resolving {
        let allowed=name.as_str()==HOST && self.deadline.remaining().is_ok();
        let deadline=self.deadline;
        Box::pin(async move {
            if !allowed || deadline.remaining().is_err() {return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied,"qa-directory-unreviewed-dns").into())}
            Ok(Box::new(std::iter::once(SocketAddr::new(IP.parse().unwrap(),443))) as reqwest::dns::Addrs)
        })
    }
}
pub struct Session { plan: &'static Plan, consumed: BTreeSet<Resource>, last: Option<Resource>, failed: bool, received: usize }
pub fn take_session() -> Result<Session,String> {
    let plan=INSTALLED.get().ok_or("qa-directory-not-installed")?;
    plan.deadline.remaining().map_err(|_|"qa-directory-expired")?;
    if CLAIMED.swap(true,Ordering::SeqCst) {return Err("qa-directory-repeated-session".into())}
    Ok(Session{plan,consumed:BTreeSet::new(),last:None,failed:false,received:0})
}
impl Session {
    pub fn require_live(&self) -> Result<(),String> {self.plan.deadline.remaining().map(|_|()).map_err(|_|"qa-directory-expired".into())}
    pub fn run_id(&self) -> &str {&self.plan.input.run_id}
    fn record_chunk(&mut self, page_bytes:usize, amount:usize) -> Result<(),String> {
        if page_bytes.checked_add(amount).is_none_or(|x|x>MAX_BODY) {return Err("qa-directory-body-size".into())}
        let next=self.received.checked_add(amount).filter(|x|*x<=16_777_216).ok_or("qa-directory-session-size")?;
        self.received=next;Ok(())
    }
    /// No arbitrary URL/path/host option, retries, reissue, cross-origin rotation or fallback.
    pub async fn fetch(&mut self, resource:Resource) -> Result<Vec<u8>,String> {
        self.require_live()?;
        if self.failed {return Err("qa-directory-failed-session".into())}
        // Cancellation or any failed request poisons this one session. A different page is
        // not permission to continue after failure, retry a resource, or renew this lease.
        self.failed=true;
        let result=self.fetch_once(resource).await;
        if result.is_ok() {self.failed=false}
        result
    }
    async fn fetch_once(&mut self, resource:Resource) -> Result<Vec<u8>,String> {
        if !resource.follows(self.last) {return Err("qa-directory-resource-order".into())}
        if !self.consumed.insert(resource) {return Err("qa-directory-repeated-resource".into())}
        self.last=Some(resource);
        let started=Instant::now();
        let remaining=self.plan.deadline.remaining().map_err(|_|"qa-directory-expired")?;
        // Same official rustls Mozilla roots/provider as the strict production HTTP factory.
        // The independent resolver is closed to one source-pinned numeric HTTPS peer.
        let client=reqwest::Client::builder().use_preconfigured_tls((*crate::tls::rustls_client_config()).clone())
            .https_only(true).http1_only().no_proxy().redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never()).connect_timeout(remaining.min(Duration::from_secs(8)))
            .read_timeout(Duration::from_secs(20)).pool_max_idle_per_host(0)
            .dns_resolver(Arc::new(ClosedResolver{deadline:self.plan.deadline}))
            .build().map_err(|_|"qa-directory-client-build")?;
        let mut request=client.get(resource.target()).build().map_err(|_|"qa-directory-request-build")?;
        let headers=Duration::from_secs(20).checked_sub(started.elapsed()).filter(|x|!x.is_zero()).ok_or("qa-directory-header-timeout")?;
        *request.timeout_mut()=Some(self.plan.deadline.remaining().map_err(|_|"qa-directory-expired")?);
        let mut response=self.plan.deadline.run(headers,||client.execute(request)).await
            .map_err(|e|deadline_error(e,"qa-directory-header-timeout"))?
            .map_err(|_|"qa-directory-transport")?;
        self.require_live()?;
        if response.status().as_u16()!=200 {return Err("qa-directory-http-status".into())}
        if response.headers().get_all(reqwest::header::CONTENT_TYPE).iter().count()!=1 {return Err("qa-directory-mime".into())}
        let mime=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|x|x.to_str().ok()).filter(|x|x.len()<=64)
            .map(|x|x.split(';').next().unwrap_or("").trim());
        let expected=if matches!(resource,Resource::Described(_)) {"application/bincode"} else {"application/json"};
        if mime!=Some(expected) {return Err("qa-directory-mime".into())}
        if response.content_length().is_some_and(|x|x>MAX_BODY as u64 || x>16_777_216usize.saturating_sub(self.received) as u64) {return Err("qa-directory-body-size".into())}
        let content_length = response.content_length();
        let mut body = BodyReadProgress::new();
        let mut bytes=Vec::new();let mut logged=Instant::now();let mut logs=0;
        loop {
            // This is the same 20s positive-byte progress budget. An empty
            // chunk does not reset it, and the absolute plan still wins.
            let chunk = match body.next(self.plan.deadline, Duration::from_secs(20), || response.chunk()).await {
                Ok(chunk) => chunk,
                Err(reason) => {
                    let report = BodyReadFailure::new(self.run_id(), resource, reason, content_length, &body, bytes.len(), self.received);
                    // Use a bounded, typed stderr frame like the existing epoch
                    // diagnostic. Progress tracing is optional and may be filtered.
                    if let Ok(line) = serde_json::to_string(&report) {
                        eprintln!("YNX_NYM_QA_BODY_FAILURE_V1 {line}");
                    }
                    return Err(reason.label().into());
                }
            };
            self.require_live()?;
            let Some(chunk)=chunk else {break};
            self.record_chunk(bytes.len(),chunk.len())?;
            if !chunk.is_empty() {
                body.accept_chunk();
                bytes.extend_from_slice(&chunk);
            }
            if logs<24 && logged.elapsed()>=Duration::from_secs(5) {
                tracing::info!(target:"ynx_qa_directory", resource=resource.label(), bytes=bytes.len(), "qa_directory_progress");logs+=1;logged=Instant::now();
            }
        }
        self.require_live()?;Ok(bytes)
    }
}
fn deadline_error(failure:DeadlineFailure, step:&str) -> String {match failure {DeadlineFailure::PolicyExpired=>"qa-directory-expired".into(),DeadlineFailure::StepTimedOut=>step.into()}}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BodyReadError { Idle, Transport, Expired }

impl BodyReadError {
    fn label(self) -> &'static str {
        match self {
            Self::Idle => "qa-directory-body-idle",
            Self::Transport => "qa-directory-body-transport",
            Self::Expired => "qa-directory-expired",
        }
    }
}

struct BodyReadProgress {
    last: Instant,
    chunks: usize,
}

impl BodyReadProgress {
    fn new() -> Self { Self { last: Instant::now(), chunks: 0 } }

    fn accept_chunk(&mut self) {
        self.last = Instant::now();
        self.chunks += 1;
    }

    async fn next<T, F>(&self, deadline: AbsolutePolicyDeadline, idle: Duration, read: impl FnOnce() -> F)
        -> Result<Option<T>, BodyReadError>
    where F: Future<Output = Result<Option<T>, reqwest::Error>> {
        let remaining = idle.checked_sub(self.last.elapsed()).filter(|left| !left.is_zero())
            .ok_or(BodyReadError::Idle)?;
        deadline.run(remaining, read).await
            .map_err(|failure| match failure {
                DeadlineFailure::PolicyExpired => BodyReadError::Expired,
                DeadlineFailure::StepTimedOut => BodyReadError::Idle,
            })?
            .map_err(|_| BodyReadError::Transport)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BodyReadFailure<'a> {
    schema: &'static str,
    #[serde(rename = "runID")]
    run_id: &'a str,
    resource: &'static str,
    page: Option<u8>,
    reason: &'static str,
    expected_body_bytes: Option<u64>,
    received_body_bytes: usize,
    session_body_bytes: usize,
    nonempty_chunks: usize,
}

impl<'a> BodyReadFailure<'a> {
    fn new(run_id: &'a str, resource: Resource, reason: BodyReadError, expected_body_bytes: Option<u64>,
           body: &BodyReadProgress, received_body_bytes: usize, session_body_bytes: usize) -> Self {
        Self {
            schema: "YNX_NYM_QA_BODY_FAILURE_V1", run_id, resource: resource.label(), page: resource.page(),
            reason: reason.label(), expected_body_bytes, received_body_bytes, session_body_bytes,
            nonempty_chunks: body.chunks,
        }
    }
}
