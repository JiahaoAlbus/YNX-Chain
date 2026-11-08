//! Private versioned IPC DATA, never a Root/signature/owner codec.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
pub(crate) const LIMIT: usize = 786432;
pub(crate) const OUTCOME: usize = 58000;
pub(crate) const MAGIC: &[u8; 8] = b"YNXRIPC1";
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u16)]
pub(crate) enum Command {
    Acquire = 1,
    Current = 2,
    Borrow = 3,
    Operate = 4,
    CompletedCurrent = 5,
    Observe = 6,
    Release = 7,
    Close = 8,
    ObserveOriginal = 9,
    BorrowCurrent = 10,
    WitnessOpen = 11,
    WitnessRead = 12,
    WitnessCurrent = 13,
    WitnessClose = 14,
    SourceWitnessOpen = 15,
    RuntimeAcquire = 16,
    InitialCurrentWitnessOpen = 17,
    ResultQuery = 18,
    ResultQueryClose = 19,
    ResultQueryCurrent = 20,
    FiniteJointAcquire = 21,
}
impl TryFrom<u16> for Command {
    type Error = i32;
    fn try_from(v: u16) -> Result<Self, i32> {
        match v {
            1 => Ok(Self::Acquire),
            2 => Ok(Self::Current),
            3 => Ok(Self::Borrow),
            4 => Ok(Self::Operate),
            5 => Ok(Self::CompletedCurrent),
            6 => Ok(Self::Observe),
            7 => Ok(Self::Release),
            8 => Ok(Self::Close),
            9 => Ok(Self::ObserveOriginal),
            10 => Ok(Self::BorrowCurrent),
            11 => Ok(Self::WitnessOpen),
            12 => Ok(Self::WitnessRead),
            13 => Ok(Self::WitnessCurrent),
            14 => Ok(Self::WitnessClose),
            15 => Ok(Self::SourceWitnessOpen),
            16 => Ok(Self::RuntimeAcquire),
            17 => Ok(Self::InitialCurrentWitnessOpen),
            18 => Ok(Self::ResultQuery),
            19 => Ok(Self::ResultQueryClose),
            20 => Ok(Self::ResultQueryCurrent),
            21 => Ok(Self::FiniteJointAcquire),
            _ => Err(2),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Header {
    pub command: Command,
    pub sequence: u64,
    pub owner: [u8; 16],
    pub digest: [u8; 32],
}
pub(crate) fn digest(b: &[u8]) -> [u8; 32] {
    Sha256::digest(b).into()
}
pub(crate) fn write_packet(w: &mut impl Write, h: Header, body: &[u8]) -> Result<(), i32> {
    if body.len() > LIMIT || h.sequence == 0 || h.digest != digest(body) {
        return Err(2);
    }
    let mut out = Vec::with_capacity(72 + body.len());
    out.extend(MAGIC);
    out.extend(1u16.to_be_bytes());
    out.extend((h.command as u16).to_be_bytes());
    out.extend((body.len() as u32).to_be_bytes());
    out.extend(h.sequence.to_be_bytes());
    out.extend(h.owner);
    out.extend(h.digest);
    out.extend(body);
    w.write_all(&out).map_err(|_| 8)
}
pub(crate) fn read_packet(r: &mut impl Read) -> Result<(Header, Vec<u8>), i32> {
    let mut raw = [0u8; 72];
    r.read_exact(&mut raw).map_err(|_| 8)?;
    if &raw[..8] != MAGIC || u16::from_be_bytes(raw[8..10].try_into().unwrap()) != 1 {
        return Err(2);
    }
    let command = Command::try_from(u16::from_be_bytes(raw[10..12].try_into().unwrap()))?;
    let n = u32::from_be_bytes(raw[12..16].try_into().unwrap()) as usize;
    if n > LIMIT {
        return Err(2);
    }
    let sequence = u64::from_be_bytes(raw[16..24].try_into().unwrap());
    if sequence == 0 {
        return Err(2);
    }
    let owner = raw[24..40].try_into().unwrap();
    let expected = raw[40..72].try_into().unwrap();
    let mut body = vec![0; n];
    r.read_exact(&mut body).map_err(|_| 8)?;
    if digest(&body) != expected {
        return Err(7);
    }
    Ok((
        Header {
            command,
            sequence,
            owner,
            digest: expected,
        },
        body,
    ))
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SourceNineOriginals {
    pub root: String,
    pub registration: String,
    pub status: String,
    pub credential: String,
    pub account_original: String,
    pub request: String,
    pub prepared_original: String,
    pub directory_checkpoint: String,
    pub namespace_prefix: String,
    pub status_history: Vec<String>,
    pub nonce: String,
    pub purpose: u32,
    pub role: u32,
}
pub(crate) struct SourceNineBytes {
    pub originals: [Vec<u8>; 9],
    pub history: Vec<Vec<u8>>,
    pub nonce: [u8; 32],
    pub purpose: u32,
    pub role: u32,
}
fn bytes(s: &str, min: usize, max: usize) -> Result<Vec<u8>, i32> {
    if s.len() > ((max + 2) / 3) * 4 {
        return Err(2);
    };
    let b = B64.decode(s).map_err(|_| 2)?;
    if b.len() < min || b.len() > max || B64.encode(&b) != s {
        return Err(2);
    };
    Ok(b)
}
impl SourceNineOriginals {
    pub fn checked(&self, family: u32) -> Result<SourceNineBytes, i32> {
        if !(1..=2).contains(&family)
            || self.purpose != family
            || !(1..=2).contains(&self.role)
            || self.status_history.len() > 255
        {
            return Err(2);
        }
        let values = [
            &self.root,
            &self.registration,
            &self.status,
            &self.credential,
            &self.account_original,
            &self.request,
            &self.prepared_original,
            &self.directory_checkpoint,
            &self.namespace_prefix,
        ];
        let mut originals: [Vec<u8>; 9] = std::array::from_fn(|_| Vec::new());
        let mut total = 32usize;
        for (i, s) in values.into_iter().enumerate() {
            let min = if i == 6 && family == 1 { 0 } else { 1 };
            let b = bytes(s, min, 393216)?;
            if min == 0 && !b.is_empty() {
                return Err(2);
            }
            total = total.checked_add(b.len()).ok_or(2)?;
            originals[i] = b;
        }
        let mut history = Vec::new();
        for s in &self.status_history {
            let b = bytes(s, 1, 393216)?;
            total = total.checked_add(b.len()).ok_or(2)?;
            history.push(b)
        }
        if total > 393216 {
            return Err(2);
        }
        let nonce = bytes(&self.nonce, 32, 32)?.try_into().map_err(|_| 2)?;
        Ok(SourceNineBytes {
            originals,
            history,
            nonce,
            purpose: self.purpose,
            role: self.role,
        })
    }
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Acquire {
    pub version: u32,
    pub profile: u32,
    pub family: u32,
    pub registered_resource: [u8; 32],
    pub source: SourceNineOriginals,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Reply {
    pub version: u32,
    pub code: i32,
    pub first_cause: i32,
    pub first_close_cause: i32,
    pub owner: [u8; 16],
    pub borrow_id: [u8;16],
    pub closed:bool,
    pub partial_original: String,
    pub data_only: bool,
    pub source_admitted: bool,
    pub root_admitted: bool,
}
impl Reply {
    pub fn new(code: i32, owner: [u8; 16], partial: &[u8]) -> Result<Self, i32> {
        if partial.len() > OUTCOME {
            return Err(2);
        }
        Ok(Self {
            version: 1,
            code,
            first_cause: code,
            first_close_cause: 0,
            owner,
            borrow_id:[0;16],
            closed:false,
            partial_original: B64.encode(partial),
            data_only: true,
            source_admitted: false,
            root_admitted: false,
        })
    }
}
pub(crate) fn canonical<T: for<'a> Deserialize<'a> + Serialize>(raw: &[u8]) -> Result<T, i32> {
    let v: T = serde_json::from_slice(raw).map_err(|_| 2)?;
    if serde_json::to_vec(&v).map_err(|_| 2)? != raw {
        return Err(2);
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixStream;
    #[test]
    fn actual_unix_packet_roundtrip_and_corrupt_digest() {
        let (mut a, mut b) = UnixStream::pair().unwrap();
        let data = b"PUBLIC IPC DATA NOT AUTHORITY";
        let h = Header {
            command: Command::Current,
            sequence: 1,
            owner: [2; 16],
            digest: digest(data),
        };
        write_packet(&mut a, h, data).unwrap();
        let (h2, b2) = read_packet(&mut b).unwrap();
        assert_eq!(h, h2);
        assert_eq!(b2, data);
        let mut wire = Vec::new();
        write_packet(&mut wire, h, data).unwrap();
        *wire.last_mut().unwrap() ^= 1;
        assert_eq!(read_packet(&mut wire.as_slice()).err(), Some(7));
    }
    #[test]
    fn no_generic_raw_sign_command_or_scope_default() {
        for command in [0, 22, 0xffff] {
            assert!(Command::try_from(command).is_err())
        }
        let mut out = Vec::new();
        assert!(
            write_packet(
                &mut out,
                Header {
                    command: Command::Operate,
                    sequence: 0,
                    owner: [0; 16],
                    digest: digest(b"")
                },
                b""
            )
            .is_err()
        );
        assert!(out.is_empty());
    }
    #[test]
    fn strict_reply_partial_does_not_upgrade_authority() {
        let r = Reply::new(8, [3; 16], b"PUBLIC_PARTIAL").unwrap();
        assert!(!r.root_admitted && !r.source_admitted && r.data_only);
        assert_eq!(r.code, 8);
        assert_eq!(B64.decode(r.partial_original).unwrap(), b"PUBLIC_PARTIAL");
        assert!(Reply::new(0, [0; 16], &vec![0; OUTCOME + 1]).is_err());
    }
}

