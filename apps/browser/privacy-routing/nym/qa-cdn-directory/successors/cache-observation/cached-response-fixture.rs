//! Memory-only response through the same compiled QA observer.
use std::io::{self, Write};

#[path = "qa_cache_observation.rs"]
mod qa_cache_observation;

// Exact observer receives the same enum view without linking the Nym runtime.
#[derive(Clone, Copy)]
pub(crate) enum Resource {
    Basic(u8),
}

impl Resource {
    fn label(self) -> &'static str { "basic" }
    fn page(self) -> Option<u8> {
        match self { Self::Basic(page) => Some(page) }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let wire = http::Response::builder()
        .status(200)
        .header("date", "Sat, 14 Nov 2026 04:32:27 GMT")
        .header("age", "30")
        .header("cache-control", "public, max-age=60, x-hidden=\"no-store, private\"")
        .header("set-cookie", "fixture-secret=never-persist-this")
        .body("never emit this body")?;
    let response: reqwest::Response = wire.into();
    qa_cache_observation::emit("qa-dir-11111111111111111111111111111111", Resource::Basic(0), &response, 42);
    io::stdout().write_all(b"response-fixture-complete\n")?;
    Ok(())
}
