//! Private local key lifecycle, NOT identity admission or a Keystore implementation.
//! Selected upstream encoding is unchanged. No Java/JS or public secret interface.
use libsignal_protocol::{IdentityKey, IdentityKeyPair};
use std::rc::Rc;
use std::marker::PhantomData;
use zeroize::Zeroizing;

mod initial_prekeys;
mod initial_registration;
pub(crate) use initial_registration::{
    InitialRegistrationError, NativeInitialRegistrationPlan, NativeInitialRegistrationProposal,
};
pub(crate) use initial_prekeys::{
    InitialPreKeyError, NativeInitialPreKeyGeneration, NativeInitialPreKeyRecords,
};

const MAX_CLASSIC_SERIALIZED: usize = 256;
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum OwnKeyError { Bounds, Encoding, PairMismatch, NonCanonical }

/// Native custodian only. Not Clone/Debug/Send; never an authorization capability.
/// Upstream IdentityKeyPair is Copy and cannot be securely wiped by this wrapper.
/// Its transient/internal copies remain a disclosed upstream residency limitation.
pub(crate) struct NativeClassicOwnKey {
    pair: IdentityKeyPair,
    local: PhantomData<Rc<()>>,
}
/// Wiped owned serialized copy. No byte getter, JNI representation, or Debug.
/// Real authenticated native Keystore seal/unseal port is not supplied yet.
pub(crate) struct SerializedClassicOwnKey {
    pub(super) bytes: Zeroizing<Vec<u8>>,
    local: PhantomData<Rc<()>>,
}
impl NativeClassicOwnKey {
    // Primitive use by the private pair custodian only; no authorization claim.
    pub(crate) fn sign_pair_transcript(&self, message: &[u8]) -> Result<Box<[u8]>, OwnKeyError> {
        if message.is_empty() || message.len() > 65536 { return Err(OwnKeyError::Bounds); }
        use rand::TryRngCore as _;
        self.pair.private_key().calculate_signature(message, &mut rand::rngs::OsRng.unwrap_err())
            .map_err(|_| OwnKeyError::Encoding)
    }
    /// Called only by native key custodian. Local import is NOT identity trust.
    pub(crate) fn from_selected(pair: IdentityKeyPair) -> Result<Self, OwnKeyError> {
        let derived = pair.private_key().public_key().map_err(|_| OwnKeyError::Encoding)?;
        if &derived != pair.public_key() { return Err(OwnKeyError::PairMismatch); }
        Ok(Self { pair, local: PhantomData })
    }
    pub(crate) fn public_identity(&self) -> IdentityKey { *self.pair.identity_key() }
    pub(crate) fn serialize_for_native_custody(&self) -> Result<SerializedClassicOwnKey, OwnKeyError> {
        // Adopt the exact upstream returned allocation; no secret string/hex/log.
        let bytes = Zeroizing::new(self.pair.serialize().into_vec());
        SerializedClassicOwnKey::take_native_bytes(bytes)
    }
}
impl SerializedClassicOwnKey {
    // Private: only a future verified native protector may supply decrypted bytes.
    // This function alone supplies NO authentication/protector/rollback provenance.
    pub(super) fn take_native_bytes(bytes: Zeroizing<Vec<u8>>) -> Result<Self, OwnKeyError> {
        if bytes.is_empty() || bytes.len() > MAX_CLASSIC_SERIALIZED {
            return Err(OwnKeyError::Bounds);
        }
        Ok(Self { bytes, local: PhantomData })
    }
    pub(crate) fn reload(self) -> Result<NativeClassicOwnKey, OwnKeyError> {
        let pair = IdentityKeyPair::try_from(self.bytes.as_slice()).map_err(|_| OwnKeyError::Encoding)?;
        let owner = NativeClassicOwnKey::from_selected(pair)?;
        // Upstream decoder accepts protobuf flexibility; private persisted own-key
        // record must be the exact selected serializer output, with no trailing or
        // duplicated fields. Re-encoding is NOT a new Signal wire format.
        let canonical = Zeroizing::new(owner.pair.serialize().into_vec());
        if canonical.as_slice() != self.bytes.as_slice() { return Err(OwnKeyError::NonCanonical); }
        Ok(owner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ownkey_public_reject_empty_before_selected_parse() {
        assert!(matches!(SerializedClassicOwnKey::take_native_bytes(Zeroizing::new(vec![])), Err(OwnKeyError::Bounds)));
    }
    #[test]
    fn ownkey_public_reject_overlimit_before_selected_parse() {
        assert!(matches!(SerializedClassicOwnKey::take_native_bytes(Zeroizing::new(vec![0; MAX_CLASSIC_SERIALIZED + 1])), Err(OwnKeyError::Bounds)));
    }
    #[test]
    fn ownkey_public_invalid_protobuf_no_key_creation() {
        let owned = SerializedClassicOwnKey::take_native_bytes(Zeroizing::new(vec![0xff])).unwrap();
        assert!(matches!(owned.reload(), Err(OwnKeyError::Encoding)));
    }
    #[test]
    fn ownkey_public_missing_fields_no_key_creation() {
        let owned = SerializedClassicOwnKey::take_native_bytes(Zeroizing::new(vec![0x0a, 0x00])).unwrap();
        assert!(matches!(owned.reload(), Err(OwnKeyError::Encoding)));
    }
}

/// Private local association only; NOT authenticated disk state or device trust.
/// Retains both same classic native owner and unverified PQ ciphertext owner.
pub(crate) struct PendingLocalOwnKeyStorage {
    classic: NativeClassicOwnKey,
    pq: crate::private_pq_storage::UnverifiedPqStoredRecord,
}
impl NativeClassicOwnKey {
    pub(crate) fn join_unverified_storage(self, pq: crate::private_pq_storage::UnverifiedPqStoredRecord)
        -> Result<PendingLocalOwnKeyStorage, (Self, crate::private_pq_storage::UnverifiedPqStoredRecord)> {
        let public = self.public_identity().serialize();
        if !pq.classic_matches(&public) { return Err((self, pq)); }
        Ok(PendingLocalOwnKeyStorage { classic: self, pq })
    }
}

impl SerializedClassicOwnKey {
    /// Selected native decode plus exact expected public binding. This is local
    /// key consistency, NOT proof that input was Keystore-authenticated/device
    /// authorized. Only real protector caller may establish that independently.
    pub(crate) fn reload_for_native_binding(self, expected: IdentityKey)
        -> Result<NativeClassicOwnKey, OwnKeyError> {
        let owner = self.reload()?;
        if owner.public_identity() != expected { return Err(OwnKeyError::PairMismatch); }
        Ok(owner)
    }
}

#[cfg(test)]
mod selected_fixture_lifecycle {
    use super::*;
    use libsignal_protocol::PrivateKey;
    // Deterministic isolated UNREGISTRABLE fixture scalar, not a user key,
    // existing profile, source/device grant, randomized keygen or signing call.
    fn fixture(byte:u8) -> NativeClassicOwnKey {
        let private=PrivateKey::deserialize(&[byte;32]).unwrap();
        NativeClassicOwnKey::from_selected(IdentityKeyPair::try_from(private).unwrap()).unwrap()
    }
    fn dummy_record(classic:&[u8;33]) -> crate::private_pq_storage::UnverifiedPqStoredRecord {
        use crate::private_pq_storage::{ExpectedStorage,UnverifiedPqStoredRecord};
        let alias=b"ynx.social.ownkey.v1.0123456789abcdef0123456789abcdef";
        let pq=[0u8;2592];let binding=[9u8];
        let mut aad=b"YNX/SOCIAL/OWN-PQ-STORAGE/V1".to_vec();aad.extend(1u32.to_be_bytes());aad.extend(87u32.to_be_bytes());aad.extend(1u64.to_be_bytes());aad.extend((alias.len() as u32).to_be_bytes());aad.extend(alias);aad.extend(classic);aad.extend(pq);aad.extend(1u32.to_be_bytes());aad.extend(binding);
        let mut wire=b"YNXPQK01".to_vec();wire.extend(1u32.to_be_bytes());wire.extend((aad.len() as u32).to_be_bytes());wire.extend(aad);wire.resize(wire.len()+12+4912,0);
        UnverifiedPqStoredRecord::decode(&wire,&ExpectedStorage{alias,generation:1,classic_public:classic,pq_public:&pq,owner_association:&binding}).unwrap()
    }
    #[test] fn r37_fixture_selected_valid_pair_roundtrip() {
        let owner=fixture(1);let public=owner.public_identity();
        let original=owner.serialize_for_native_custody().unwrap();
        let reloaded=owner.serialize_for_native_custody().unwrap().reload().unwrap();
        assert_eq!(reloaded.public_identity(),public);
        let again=reloaded.serialize_for_native_custody().unwrap();
        // Never format/log/assert_eq secret bytes on a failed assertion.
        assert!(original.bytes.as_slice()==again.bytes.as_slice());
    }
    #[test] fn r37_fixture_selected_mismatched_pair_rejected() {
        let a=fixture(1);let b=fixture(2);
        let mismatched=IdentityKeyPair::new(b.public_identity(),*a.pair.private_key());
        assert!(matches!(NativeClassicOwnKey::from_selected(mismatched),Err(OwnKeyError::PairMismatch)));
        let bytes=Zeroizing::new(mismatched.serialize().into_vec());
        assert!(matches!(SerializedClassicOwnKey::take_native_bytes(bytes).unwrap().reload(),Err(OwnKeyError::PairMismatch)));
    }
    #[test] fn r37_fixture_noncanonical_unknown_field_rejected() {
        let owner=fixture(1);let mut bytes=owner.serialize_for_native_custody().unwrap();
        bytes.bytes.extend_from_slice(&[0x18,0]); // unknown protobuf field3
        assert!(matches!(bytes.reload(),Err(OwnKeyError::NonCanonical)));
    }
    #[test] fn r37_fixture_noncanonical_duplicate_field_rejected() {
        let owner=fixture(1);let mut bytes=owner.serialize_for_native_custody().unwrap();
        let public=owner.public_identity().serialize();
        bytes.bytes.push(0x0a);bytes.bytes.push(public.len() as u8);bytes.bytes.extend_from_slice(&public);
        assert!(matches!(bytes.reload(),Err(OwnKeyError::NonCanonical)));
    }
    #[test] fn r37_fixture_expected_native_public_binding() {
        let a=fixture(1);let b=fixture(2);
        let selected=a.serialize_for_native_custody().unwrap().reload_for_native_binding(a.public_identity()).unwrap();
        assert_eq!(selected.public_identity(),a.public_identity());
        assert!(matches!(a.serialize_for_native_custody().unwrap().reload_for_native_binding(b.public_identity()),Err(OwnKeyError::PairMismatch)));
    }
    #[test] fn r37_fixture_same_pair_join_retained_unverified() {
        let owner=fixture(1);let public=owner.public_identity();let classic:[u8;33]=public.serialize().as_ref().try_into().unwrap();
        let record=dummy_record(&classic);let original=record.fixture_public_allocation();
        let pending=match owner.join_unverified_storage(record){Ok(p)=>p,Err(_)=>panic!("fixture association refused")};
        assert_eq!(pending.classic.public_identity(),public);assert_eq!(pending.pq.fixture_public_allocation(),original);
        // No authenticated reload/admission/receipt type is returned here.
    }
    #[test] fn r37_fixture_join_failure_returns_both_originals() {
        let a=fixture(1);let b=fixture(2);let expected=a.public_identity();
        let original_bytes=a.serialize_for_native_custody().unwrap();
        let other:[u8;33]=b.public_identity().serialize().as_ref().try_into().unwrap();
        let record=dummy_record(&other);let original_allocation=record.fixture_public_allocation();
        let (returned,record)=match a.join_unverified_storage(record){Err(owners)=>owners,Ok(_)=>panic!("mismatched fixture admitted")};
        assert_eq!(returned.public_identity(),expected);assert_eq!(record.fixture_public_allocation(),original_allocation);
        let after=returned.serialize_for_native_custody().unwrap();assert!(original_bytes.bytes.as_slice()==after.bytes.as_slice());
        let bpublic=b.public_identity();let joined=match b.join_unverified_storage(record){Ok(p)=>p,Err(_)=>panic!("original record lost")};
        assert_eq!(joined.classic.public_identity(),bpublic);assert_eq!(joined.pq.fixture_public_allocation(),original_allocation);
    }
}
