//! Private DATA matching the one canonical Main 31..35 dispatcher.
use crate::wire;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use serde::{Deserialize, Serialize};
pub(super) const PURPOSE: &str = "original-main-committed-pair-holder-read-v1";
pub(super) fn bytes(s: &str, min: usize, max: usize) -> Result<Vec<u8>, i32> {
    if s.len() > max.div_ceil(3) * 4 {
        return Err(2);
    }
    let b = B64.decode(s).map_err(|_| 2)?;
    if b.len() < min || b.len() > max || B64.encode(&b) != s {
        return Err(2);
    }
    Ok(b)
}
pub(super) fn token(s: &str) -> Result<[u8; 16], i32> {
    bytes(s, 16, 16)?.try_into().map_err(|_| 2)
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Open {
    pub version: u32,
    pub purpose: String,
    pub registered_read_resource: String,
    pub registered_source_resource: String,
    pub f06_record_digest: String,
    pub registration_original: String,
    pub issuer_credential_original: String,
    pub anchor_credential_original: String,
    pub history_envelope_original: String,
}
impl Open {
    pub fn checked(&self) -> Result<([u8; 32], [[u8; 32]; 4]), i32> {
        if self.version != 1 || self.purpose != PURPOSE {
            return Err(2);
        }
        bytes(&self.registered_read_resource, 32, 32)?;
        let source = bytes(&self.registered_source_resource, 32, 32)?
            .try_into()
            .map_err(|_| 2)?;
        if source == [0; 32] || bytes(&self.f06_record_digest, 32, 32)? == [0; 32] {
            return Err(2);
        }
        let mut d = [[0; 32]; 4];
        for (i, s) in [
            &self.registration_original,
            &self.issuer_credential_original,
            &self.anchor_credential_original,
            &self.history_envelope_original,
        ]
        .into_iter()
        .enumerate()
        {
            d[i] = wire::digest(&bytes(s, 1, 65536)?)
        }
        Ok((source, d))
    }
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Projection {
    pub application: [String; 6],
    pub classic_public: String,
    pub pq_public: String,
    pub account_issuer: String,
    pub account_subject: String,
    #[serde(rename = "notBeforeMS")]
    pub not_before_ms: i64,
    #[serde(rename = "expiresMS")]
    pub expires_ms: i64,
}
impl Projection {
    pub fn checked(&self) -> Result<(), i32> {
        let mut n = 33 + 2592;
        for s in self
            .application
            .iter()
            .chain([&self.account_issuer, &self.account_subject])
        {
            if s.is_empty() || s.len() > 4096 || s.chars().any(|c| c == '\0' || c.is_control()) {
                return Err(2);
            }
            n += s.len()
        }
        if n > 8192
            || self.not_before_ms < 0
            || self.expires_ms <= self.not_before_ms
            || self.expires_ms > 9007199254740991
        {
            return Err(2);
        }
        bytes(&self.classic_public, 33, 33)?;
        bytes(&self.pq_public, 2592, 2592)?;
        Ok(())
    }
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Reply {
    pub version: u32,
    pub error_present: bool,
    pub original_first: i32,
    pub unknown: bool,
    pub physical_done: bool,
    pub owner: String,
    pub view: String,
    pub projection: Option<Projection>,
}
impl Reply {
    pub fn tokens(&self) -> Result<([u8; 16], [u8; 16]), i32> {
        if self.version != 1 || (!self.error_present && self.original_first != 0) {
            return Err(2);
        }
        Ok((token(&self.owner)?, token(&self.view)?))
    }
    pub fn checked(&self) -> Result<([u8; 16], [u8; 16]), i32> {
        let (o, v) = self.tokens()?;
        if let Some(p) = &self.projection {
            if v == [0; 16] {
                return Err(2);
            }
            p.checked()?
        }
        Ok((o, v))
    }
}
pub(super) fn reply(raw: &[u8]) -> Result<Reply, i32> {
    // Main json.Marshal escapes HTML-sensitive strings. JSON field order and
    // equivalent escapes are not packet authority; exact required keys, UTF8,
    // typed booleans, duplicate/unknown denial are. Serde typed decoding rejects
    // duplicate fields, including escaped duplicate spellings, before Value.
    if raw.is_empty() || raw.len() > wire::LIMIT || std::str::from_utf8(raw).is_err() {
        return Err(2);
    }
    let r: Reply = serde_json::from_slice(raw).map_err(|_| 2)?;
    let v: serde_json::Value = serde_json::from_slice(raw).map_err(|_| 2)?;
    let o = v.as_object().ok_or(2)?;
    if o.len() != 8 || !o.contains_key("projection") {
        return Err(2);
    }
    Ok(r)
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Release {
    pub version: u32,
    pub view: String,
}
