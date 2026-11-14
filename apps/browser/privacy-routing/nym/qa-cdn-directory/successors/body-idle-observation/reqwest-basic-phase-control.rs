//! QA component only. Link the existing Nym TLS configuration and Reqwest cohort.
use std::{error::Error, future::Future, io, net::SocketAddr, pin::Pin, sync::{Arc, Mutex}, task::{Context, Poll}, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use original_http::expiry_deadline::{AbsolutePolicyDeadline, DeadlineFailure};
use serde_json::{json, Value};
use tower_layer::Layer;
use tower_service::Service;

const HOST: &str = "cdn1.media-platform.net";
const PUBLIC_PEER: &str = "172.104.178.252:443";
const ROUTE: &str = "/api/v2/unstable/nym-nodes/skimmed?page=0&per_page=250";
const BODY_SAMPLE_CAP: usize = 4096;

#[derive(Default)]
struct Milestones {
    connector_calls: u32,
    connector_start: Option<u64>,
    connector_completed: Option<u64>,
    connector_error: Option<u64>,
    resolver_calls: u32,
}

fn ms(start: Instant) -> u64 {
    start.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[derive(Clone)]
struct ConnectorObserver(Arc<Mutex<Milestones>>, Instant);

impl<S> Layer<S> for ConnectorObserver {
    type Service = Observed<S>;
    fn layer(&self, inner: S) -> Observed<S> {
        Observed { inner, observer: self.clone() }
    }
}

#[derive(Clone)]
struct Observed<S> {
    inner: S,
    observer: ConnectorObserver,
}

impl<S, R> Service<R> for Observed<S>
where
    S: Service<R>,
    S::Future: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<S::Response, S::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), S::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, request: R) -> Self::Future {
        let ConnectorObserver(milestones, start) = self.observer.clone();
        {
            let mut mark = milestones.lock().unwrap();
            mark.connector_calls += 1;
            mark.connector_start.get_or_insert_with(|| ms(start));
        }
        let operation = self.inner.call(request);
        Box::pin(async move {
            let result = operation.await;
            let mut mark = milestones.lock().unwrap();
            if result.is_ok() {
                mark.connector_completed.get_or_insert_with(|| ms(start));
            } else {
                mark.connector_error.get_or_insert_with(|| ms(start));
            }
            result
        })
    }
}

struct ClosedNumericResolver {
    peer: SocketAddr,
    deadline: AbsolutePolicyDeadline,
    milestones: Arc<Mutex<Milestones>>,
}

impl reqwest::dns::Resolve for ClosedNumericResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let approved = name.as_str() == HOST;
        let peer = self.peer;
        let deadline = self.deadline;
        let milestones = self.milestones.clone();
        Box::pin(async move {
            if !approved || deadline.remaining().is_err() {
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "qa-closed-resolver").into());
            }
            milestones.lock().unwrap().resolver_calls += 1;
            Ok(Box::new(std::iter::once(peer)) as reqwest::dns::Addrs)
        })
    }
}

fn request_error(error: &reqwest::Error) -> Value {
    // The linked reqwest predicates collapse some TCP/TLS details. No raw
    // error text, URL, headers or certificate bytes are emitted.
    json!({"kind": "reqwest", "isConnect": error.is_connect(), "isTimeout": error.is_timeout(),
           "isBody": error.is_body(), "isDecode": error.is_decode()})
}

fn deadline_error(error: DeadlineFailure) -> Value {
    let kind = match error {
        DeadlineFailure::PolicyExpired => "policy-expired",
        DeadlineFailure::StepTimedOut => "step-timeout",
    };
    json!({"kind": kind})
}

async fn perform(peer: SocketAddr, tls: rustls::ClientConfig, fixture: bool,
                 header_cap: Duration, connect_cap: Duration) -> Result<Value, Box<dyn Error>> {
    let start = Instant::now();
    let deadline = AbsolutePolicyDeadline::from_unix_seconds(
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + 120,
    ).map_err(|_| "deadline-init")?;
    let milestones = Arc::new(Mutex::new(Milestones::default()));
    let remaining = deadline.remaining().map_err(|_| "deadline-expired")?;
    let client = reqwest::Client::builder().use_preconfigured_tls(tls)
        .https_only(true).http1_only().no_proxy().redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never()).connect_timeout(remaining.min(connect_cap))
        .read_timeout(header_cap).pool_max_idle_per_host(0)
        .dns_resolver(Arc::new(ClosedNumericResolver { peer, deadline, milestones: milestones.clone() }))
        .connector_layer(ConnectorObserver(milestones.clone(), start))
        .build()?;
    let authority = if fixture { format!("{HOST}:{}", peer.port()) } else { HOST.to_string() };
    let mut request = client.get(format!("https://{authority}{ROUTE}")).build()?;
    *request.timeout_mut() = Some(deadline.remaining().map_err(|_| "deadline-expired")?);
    let cap = header_cap.checked_sub(start.elapsed()).ok_or("header-budget-elapsed-before-request")?;
    let current = tokio::time::Instant::now();
    let outer_header = current + cap;
    let mut status = None;
    let mut headers = None;
    let mut body = None;
    let mut yielded = None;
    let mut sampled = 0;
    let mut first = None;

    match deadline.run(cap, || client.execute(request)).await {
        Err(error) => first = Some(json!({"phase":"final-headers", "error":deadline_error(error)})),
        Ok(Err(error)) => first = Some(json!({"phase":"final-headers", "error":request_error(&error)})),
        Ok(Ok(mut response)) => {
            status = Some(response.status().as_u16());
            headers = Some(ms(start));
            if response.status() == reqwest::StatusCode::OK {
                // The public comparison shares one 20-second absolute time
                // budget. Chunk is sampled once. Reqwest controls its internal
                // decoded chunk size, while retained/reportable data is capped.
                let body_budget = outer_header.saturating_duration_since(tokio::time::Instant::now());
                match deadline.run(body_budget, || response.chunk()).await {
                    Err(error) => first = Some(json!({"phase":"first-body", "error":deadline_error(error)})),
                    Ok(Err(error)) => first = Some(json!({"phase":"first-body", "error":request_error(&error)})),
                    Ok(Ok(Some(chunk))) => {
                        yielded = Some(chunk.len());
                        sampled = chunk.len().min(BODY_SAMPLE_CAP);
                        body = Some(ms(start));
                    }
                    Ok(Ok(None)) => yielded = Some(0),
                }
            }
        }
    }
    let mark = milestones.lock().unwrap();
    if mark.connector_calls > 1 || mark.resolver_calls > 1 {
        first = Some(json!({"phase":"ownership", "error":{"kind":"unexpected-connector-count"}}));
    }
    Ok(json!({
        "schema":"P05_NYM_REQWEST_BASIC_PHASE_V1", "mode": if fixture { "loopback" } else { "public" },
        "connectorCalls":mark.connector_calls, "numericResolverCalls":mark.resolver_calls,
        "connectorStartedMs":mark.connector_start, "verifiedTlsConnectorMs":mark.connector_completed,
        "connectorErrorMs":mark.connector_error, "finalHeadersMs":headers, "firstBodyMs":body,
        "httpStatus":status, "firstDecodedChunkBytes":yielded, "observedBodyBytes":sampled,
        "retainedBodyBytes":0, "bodySampleCap":BODY_SAMPLE_CAP, "elapsedMs":ms(start),
        "firstFailure":first, "fullDirectoryAccepted":false, "rawResponsePersisted":false,
    }))
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (peer, tls, fixture, headers, connect) = match args.as_slice() {
        [mode] if mode == "public" => (PUBLIC_PEER.parse()?, (*original_http::tls::rustls_client_config()).clone(),
            false, Duration::from_secs(20), Duration::from_secs(8)),
        [mode, peer, ca] if mode == "fixture" => {
            let address: SocketAddr = peer.parse()?;
            if !address.is_ipv4() || !address.ip().is_loopback() || address.port() == 0 {
                return Err("fixture-numeric-loopback-required".into());
            }
            let mut roots = rustls::RootCertStore::empty();
            roots.add(std::fs::read(ca)?.into())?;
            let config = rustls::ClientConfig::builder_with_provider(original_http::tls::crypto_provider())
                .with_safe_default_protocol_versions()?.with_root_certificates(roots).with_no_client_auth();
            (address, config, true, Duration::from_millis(800), Duration::from_millis(300))
        }
        _ => return Err("only-fixed-public-or-numeric-loopback-fixture".into()),
    };
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let result = runtime.block_on(perform(peer, tls, fixture, headers, connect))?;
    drop(runtime);
    println!("{result}");
    if result["firstFailure"].is_object() {
        std::process::exit(2);
    }
    Ok(())
}
