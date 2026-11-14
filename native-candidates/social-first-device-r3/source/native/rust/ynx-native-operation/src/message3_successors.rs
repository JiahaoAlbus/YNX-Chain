//! Actual same-operation checkpoint/terminal continuation. No extra owner,
//! signing purpose, clock renewal, synthetic predecessor or public grant.
use super::*;
include!("message3_ordinary_successors.inc.rs");

const CHECKPOINT_DOMAIN: &[u8] = b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-CHECKPOINT/V1\0";
const TERMINAL_DOMAIN: &[u8] = b"YNX/SOCIAL/FIRST-DEVICE-INDEPENDENT-TERMINAL/V1\0";
const CHECKPOINT_ROLES: [&str; 1] = ["first-device-independent-checkpoint-anchor"];
const TERMINAL_ROLES: [&str; 2] = ["first-device-independent-terminal-issuer", "first-device-independent-terminal-anchor"];

#[repr(C)]
#[derive(Clone, Copy)]
struct CheckpointObservation {
    version: u32, size: u32, anchor_floor: u64,
    anchor_counter_name: [u8; 34], reserved: [u8; 6],
    checkpoint_digest: [u8; 32], output_cipher_hash: [u8; 32],
}
const _: [(); 120] = [(); std::mem::size_of::<CheckpointObservation>()];
unsafe extern "C" {
    fn ynx_native_core_resource_driver_checkpoint(resource: *mut c_void) -> i32;
    fn ynx_native_core_resource_driver_checkpoint_original_query(resource: *mut c_void, out: *mut CheckpointObservation) -> i32;
}
fn roles(kind: u32) -> Result<&'static [&'static str], i32> {
    match kind { 2 => Ok(&CHECKPOINT_ROLES), 3 => Ok(&TERMINAL_ROLES), _ => Err(BOUND) }
}
fn signer(kind: u32, slot: usize) -> Result<usize, i32> {
    if slot >= roles(kind)?.len() { return Err(BOUND); }
    Ok(if kind == 2 { 1 } else { slot })
}
fn stage_index(kind: u32) -> Result<usize, i32> {
    match kind { 2 => Ok(0), 3 => Ok(1), _ => Err(BOUND) }
}
pub(super) struct Attempt {
    kind: u32, checkpoint: Vec<u8>, body: Vec<u8>, frames: [Vec<u8>; 2],
    classic: [Vec<u8>; 2], pq: [Vec<u8>; 2], originals: [Vec<u8>; 2],
    receipt: Vec<u8>, readback: Vec<u8>, phase: u32, first: i32,
}
impl Attempt {
    fn empty(kind: u32) -> Self {
        Self { kind, checkpoint: Vec::new(), body: Vec::new(), frames: std::array::from_fn(|_| Vec::new()),
            classic: std::array::from_fn(|_| Vec::new()), pq: std::array::from_fn(|_| Vec::new()),
            originals: std::array::from_fn(|_| Vec::new()), receipt: Vec::new(), readback: Vec::new(), phase: 0, first: OK }
    }
    fn spans(&self, a: &EngineAttempt) -> Result<Snapshot, i32> {
        Ok(Snapshot { version: 1, kind: self.kind, phase: self.phase, role_count: roles(self.kind)?.len() as u32,
            storage_generation: a.binding.storage_generation(), policy_generation: a.binding.policy_generation(),
            deadline: a.binding.deadline(), intent: a.binding.intent(),
            id: Span::of(a.context.link.facts.operation.as_bytes()), body: Span::of(&self.body),
            frames: std::array::from_fn(|i| Span::of(&self.frames[i])),
            classic: std::array::from_fn(|i| Span::of(&self.classic[i])),
            pq: std::array::from_fn(|i| Span::of(&self.pq[i])), receipt: Span::of(&self.receipt) })
    }
    fn all_bytes(&self) -> [&[u8]; 12] {
        [&self.checkpoint, &self.body, &self.frames[0], &self.frames[1], &self.classic[0], &self.classic[1],
            &self.pq[0], &self.pq[1], &self.originals[0], &self.originals[1], &self.receipt, &self.readback]
    }
}
fn current_stage(a: &EngineAttempt, kind: u32) -> Result<&Attempt, i32> {
    a.successors[stage_index(kind)?].as_ref().ok_or(1)
}
fn current_stage_mut(a: &mut EngineAttempt, kind: u32) -> Result<&mut Attempt, i32> {
    a.successors[stage_index(kind)?].as_mut().ok_or(1)
}
// Same SDK inventory only. Caller separately verifies the actual ordinary
// engine424; no legacy160 effect or strong observation is accepted here.
pub(super)fn ordinary_snapshot(a:&EngineAttempt,kind:u32)->Result<(Snapshot,i32),i32>{
 let stage=current_stage(a,kind)?;Ok((stage.spans(a)?,stage.first))
}
pub(super)fn protect_retained_output(a:&EngineAttempt,output:(usize,usize))->Result<(),i32>{
  device_possession::protect_output(a,output)?;
 for stage in a.successors.iter().flatten(){for bytes in stage.all_bytes(){if !bytes.is_empty()&&!disjoint(output,region(bytes.as_ptr(),bytes.len()).ok_or(BOUND)?){return Err(BOUND)}}}Ok(())
}
pub(super) fn fail(holder: *mut c_void, policy: *mut c_void, kind: u32, cause: i32) -> i32 {
    let cause = if cause == OK { UNKNOWN } else { cause };
    let _ = with_attempt(holder, policy, |a| {
        let stage = current_stage_mut(a, kind)?;
        if stage.first == OK { stage.first = cause; }
        stage.phase = 4;
        if a.lifecycle_first == OK { a.lifecycle_first = cause; }
        Ok(())
    });
    cause
}
pub(super) fn record_signature(a: &mut EngineAttempt, kind: u32, slot: usize, pq: bool, bytes: Vec<u8>, actual: i32) -> Result<(), i32> {
    signer(kind, slot)?;
    let stage = current_stage_mut(a, kind)?;
    let target = if pq { &mut stage.pq[slot] } else { &mut stage.classic[slot] };
    if !target.is_empty() { return Err(MISMATCH); }
    *target = bytes;
    if actual != OK && stage.first == OK { stage.first = actual; stage.phase = 4; }
    Ok(())
}
pub(super) fn snapshot(holder: *mut c_void, policy: *mut c_void, facts: &Effect, out: *mut Snapshot, output: (usize, usize)) -> Result<(), i32> {
    let observed = with_attempt(holder, policy, |a| {
        // Protect every retained stage, including predecessors, from aliases.
        for span in [super::spans(a).id, Span::of(&a.body), Span::of(&a.receipt)] {
            if span.size != 0 && !disjoint(output, region(span.data, span.size).ok_or(BOUND)?) { return Err(BOUND); }
        }
        for bytes in a.frames.iter().chain(&a.classic).chain(&a.pq).chain(&a.originals).chain([&a.readback]) {
            if !bytes.is_empty() && !disjoint(output, region(bytes.as_ptr(), bytes.len()).ok_or(BOUND)?) { return Err(BOUND); }
        }
        for stage in a.successors.iter().flatten() {
            for bytes in stage.all_bytes() {
                if !bytes.is_empty() && !disjoint(output, region(bytes.as_ptr(), bytes.len()).ok_or(BOUND)?) { return Err(BOUND); }
            }
        }
        effect_matches(a, facts, facts.kind)?;
        let stage = current_stage(a, facts.kind)?;
        if facts.checkpoint_original.size != stage.checkpoint.len() || facts.checkpoint_original.size == 0
            || region(facts.checkpoint_original.data, facts.checkpoint_original.size).is_none()
            || unsafe { std::slice::from_raw_parts(facts.checkpoint_original.data, facts.checkpoint_original.size) } != stage.checkpoint
        { return Err(MISMATCH); }
        if stage.body.is_empty() || stage.frames[..roles(facts.kind)?.len()].iter().any(Vec::is_empty) { return Err(if stage.first == OK { 1 } else { stage.first }); }
        Ok((stage.spans(a)?, stage.first, a.context.clone()))
    });
    match observed {
        Ok((view, first, original)) => {
            let complete = view.phase >= 2;
            unsafe { std::ptr::write(out, view); }
            let live = context(holder, policy);
            if first != OK { return Err(first); }
            let live = live?;
            if live.startup != original.startup || live.link.facts != original.link.facts || live.classic != original.classic || live.pq != original.pq { return Err(MISMATCH); }
            if complete { verify_retained_signed_binding(holder, policy, facts.kind)?; }
            Ok(())
        }
        Err(code) => { if code != BOUND { unsafe { std::ptr::write_bytes(out, 0, 1); } } Err(code) }
    }
}
fn verify_retained_signed_binding(holder: *mut c_void, policy: *mut c_void, kind: u32) -> Result<(), i32> {
    if with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?{return verify_ordinary_stage(holder,policy,kind,true)}
    // Expected raw originals are fetched independently from the actual same
    // policy, not from Material, signed body digest strings or caller flags.
    let original = context(holder, policy)?;
    let mut expected: NativeCoreParticipantOriginalsV2 = unsafe { std::mem::zeroed() };
    status(unsafe { ynx_sdk_native_core_participant_originals_v2(policy, &mut expected) })?;
    if expected.version != 2 || expected.purpose != 1 { return Err(MISMATCH); }
    let issuer_current = copy_span(Span { data: expected.issuer_current.data, size: expected.issuer_current.size }, 1048576)?;
    let anchor_current = copy_span(Span { data: expected.anchor_current.data, size: expected.anchor_current.size }, 1048576)?;
    let namespace = copy_span(Span { data: expected.origin[4].data, size: expected.origin[4].size }, 1048576)?;
    let (checkpoint, terminal) = with_attempt(holder, policy, |a| {
        let checkpoint = current_stage(a, 2)?.originals[0].clone();
        let terminal = if kind == 3 {
            let stage = current_stage(a, 3)?; Some((stage.originals[0].clone(), stage.originals[1].clone()))
        } else { None };
        Ok((checkpoint, terminal))
    })?;
    STARTUP_EVIDENCE.with(|r| {
        let r = r.try_borrow().map_err(|_| UNKNOWN)?;
        let held = r.get(&original.startup).ok_or(1)?;
        let binding = crate::message_evidence::CommitCurrentOriginals { issuer_current: &issuer_current, anchor_current: &anchor_current, namespace: &namespace };
        crate::message_evidence::verify_commit_current_originals(&held.source, &checkpoint,
            terminal.as_ref().map(|(issuer, anchor)| (issuer.as_slice(), anchor.as_slice())), &binding)
            .map_err(|error| match error { crate::source_evidence::Error::ProfileRequired => 1, crate::source_evidence::Error::Bounds => BOUND, _ => MISMATCH })
    })?;
    context(holder, policy)?; Ok(())
}
fn copy_span(span: Span, max: usize) -> Result<Vec<u8>, i32> {
    if span.size == 0 || span.size > max || region(span.data, span.size).is_none() { return Err(BOUND); }
    Ok(unsafe { std::slice::from_raw_parts(span.data, span.size) }.to_vec())
}
fn original_window(issued: u64, expires: u64, now: i64) -> Result<(i64, i64), i32> {
    if issued == 0 || expires > 9007199254740991 || expires.checked_sub(issued).is_none_or(|n| n == 0 || n > 30000) { return Err(BOUND); }
    let issued = i64::try_from(issued).map_err(|_| BOUND)?;
    let expires = i64::try_from(expires).map_err(|_| BOUND)?;
    if now < issued || now >= expires { return Err(1); }
    Ok((issued, expires))
}
struct Material { enrollment: [String; 2], current: [String; 2], administration: String, namespace: String, issued: i64, expires: i64 }
fn material(holder: *mut c_void, policy: *mut c_void) -> Result<Material, i32> {
    let c = context(holder, policy)?;
    let ordinary = with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?;
    let operation_id = CORE_LOANS_V2.with(|r|{let r=r.try_borrow().map_err(|_|UNKNOWN)?;let loan=r.get(&(policy as usize)).ok_or(1)?;if loan.startup!=c.startup||loan.unknown{return Err(MISMATCH)}Ok(loan.id)})?;
    let (issued, expires) = original_window(c.link.facts.issued_ms, c.link.facts.expires_ms, crate::source_evidence::now_ms().map_err(|_| UNKNOWN)?)?;
    let mut originals: NativeCoreParticipantOriginalsV2 = unsafe { std::mem::zeroed() };
    status(unsafe { ynx_sdk_native_core_participant_originals_v2(policy, &mut originals) })?;
    if originals.version != 2 || originals.purpose != 1 { return Err(MISMATCH); }
    let hash_span = |span: &NativeOriginalSpan| -> Result<String, i32> {
        Ok(hex(&Sha256::digest(copy_span(Span { data: span.data, size: span.size }, 1048576)?)))
    };
    let namespace = hash_span(&originals.origin[4])?;
    let current = [hash_span(&originals.issuer_current)?, hash_span(&originals.anchor_current)?];
    let (enrollment, administration) = STARTUP_EVIDENCE.with(|r| {
        let mut r = r.try_borrow_mut().map_err(|_| UNKNOWN)?;
        let held = r.get_mut(&c.startup).ok_or(1)?; selected_current(held)?;
        if ordinary {
            let m=ordinary_startup::material(held,&operation_id)?;
            selected_current(held)?;
            return Ok(([m.issuer_enrollment_digest,m.anchor_enrollment_digest],m.administration_domain));
        }
        let result = {
            let records = held.enrollment.as_ref().ok_or(1)?;
            let issuer_history: Vec<_> = records.issuer_predecessors.iter().map(|v| v.as_slice()).collect();
            let anchor_history: Vec<_> = records.anchor_predecessors.iter().map(|v| v.as_slice()).collect();
            let issuer_digest = hex(&Sha256::digest(&records.issuer_current));
            let anchor_digest = hex(&Sha256::digest(&records.anchor_current));
            let issuer = crate::message_enrollment::verify_startup(&held.source, &records.issuer_current, &issuer_history, 1, &issuer_digest).map_err(|_| MISMATCH)?;
            let anchor = crate::message_enrollment::verify_startup(&held.source, &records.anchor_current, &anchor_history, 2, &anchor_digest).map_err(|_| MISMATCH)?;
            issuer.match_source_role(&held.source, 1).map_err(|_| MISMATCH)?;
            anchor.match_source_role(&held.source, 2).map_err(|_| MISMATCH)?;
            if issuer.registration.administration_domain == anchor.registration.administration_domain || issuer_digest == anchor_digest { return Err(MISMATCH); }
            ([issuer_digest, anchor_digest], anchor.registration.administration_domain.clone())
        };
        selected_current(held)?; Ok(result)
    })?;
    if administration.is_empty() || administration.len() > 128 { return Err(BOUND); }
    context(holder, policy)?;
    Ok(Material { enrollment, current, administration, namespace, issued, expires })
}
fn checkpoint_matches(raw: &[u8], binding: &Binding, effect: &[u8; 32], observed: &CheckpointObservation, output: &[u8]) -> Result<(), i32> {
    if observed.version != 1 || observed.size != 120 || observed.anchor_floor == 0
        || observed.anchor_counter_name.iter().all(|v| *v == 0) || observed.reserved != [0; 6]
        || raw.len() < 152 || raw.len() > 16384 || raw.get(..19) != Some(b"YNXCORECHECKPOINTV1")
        || raw[19..24].iter().chain(&raw[112..128]).any(|v| *v != 0)
        || raw[24..56] != binding.intent || raw[56..64] != binding.storage_generation.to_be_bytes()
        || raw[64..72] != binding.deadline.to_be_bytes() || raw[80..112] != *effect
        || <[u8; 32]>::from(Sha256::digest(raw)) != observed.checkpoint_digest
        || output != observed.output_cipher_hash
    { return Err(MISMATCH); }
    let mut cursor = 128usize;
    for _ in 0..3 {
        let end = cursor.checked_add(8).ok_or(BOUND)?;
        let length = u64::from_be_bytes(raw.get(cursor..end).ok_or(BOUND)?.try_into().map_err(|_| BOUND)?);
        let length = usize::try_from(length).map_err(|_| BOUND)?;
        if length == 0 || length > 16384 { return Err(BOUND); }
        cursor = end.checked_add(length).ok_or(BOUND)?;
        if cursor > raw.len() { return Err(BOUND); }
    }
    if cursor != raw.len() { return Err(BOUND); }
    Ok(())
}
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
struct StageReceipt<'a> { version: u32, id: &'a str, kind: &'a str, body_digest: String, originals: Vec<OriginalDescriptor> }
fn prepare(holder: *mut c_void, policy: *mut c_void, resource: *mut c_void, kind: u32, started: &mut bool) -> Result<usize, i32> {
    let index = stage_index(kind)?;
    // Duplicate refusal precedes current callbacks and changes no old stage.
    with_attempt(holder, policy, |a| {
        if a.successors[index].is_some() { return Err(DUPLICATE); }
        if a.resource != resource as usize || a.phase != 3 || a.first != OK || a.readback != a.receipt || a.originals[0].is_empty() { return Err(MISMATCH); }
        if kind == 3 { let prior = current_stage(a, 2)?; if prior.phase != 3 || prior.first != OK || prior.readback != prior.receipt { return Err(MISMATCH); } }
        Ok(())
    })?;
    if with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?{return prepare_ordinary(holder,policy,resource,kind,started)}
    let c = context(holder, policy)?;
    with_attempt(holder, policy, |a| {
        if a.successors[index].is_some() { return Err(DUPLICATE); }
        a.successors[index] = Some(Attempt::empty(kind)); *started = true; Ok(())
    })?;
    let mut facts: Effect = unsafe { std::mem::zeroed() };
    status(unsafe { ynx_native_core_resource_driver_message3_effect_facts(resource, kind, &mut facts) })?;
    let checkpoint = copy_span(facts.checkpoint_original, 16384)?;
    let mut observed: CheckpointObservation = unsafe { std::mem::zeroed() };
    status(unsafe { ynx_native_core_resource_driver_checkpoint_original_query(resource, &mut observed) })?;
    let m = material(holder, policy)?;
    with_attempt(holder, policy, |a| {
        effect_matches(a, &facts, kind)?;
        let engine = a.engine.as_ref().ok_or(UNKNOWN)?;
        if engine.typed.len() != 416 { return Err(MISMATCH); }
        checkpoint_matches(&checkpoint, a.binding.strong()?, &a.effect_digest, &observed, &engine.typed[144..176])?;
        let engine_digest = hex(&Sha256::digest(&a.originals[0]));
        let body = if kind == 2 {
            encode(&crate::message_evidence::EngineCheckpointBody { version: 1,
                purpose: "SOCIAL_FIRST_DEVICE_INDEPENDENT_CHECKPOINT_V1".into(), engine_commit_digest: engine_digest,
                administration_domain: m.administration, enrollment_digest: m.enrollment[1].clone(),
                counter_name: B64.encode(observed.anchor_counter_name), floor: observed.anchor_floor.to_string(),
                // One immutable signed slot per genuine original intent. This
                // is not the independent domain state's sequence number.
                sequence: "1".into(), previous_digest: None, source_head: hex(&a.binding.strong()?.head), namespace_digest: m.namespace,
                issued: m.issued, expires: m.expires })?
        } else {
            let prior = current_stage(a, 2)?;
            if prior.checkpoint != checkpoint || prior.originals[0].is_empty() { return Err(MISMATCH); }
            encode(&crate::message_evidence::EngineTerminalBody { version: 1,
                purpose: "SOCIAL_FIRST_DEVICE_INDEPENDENT_TERMINAL_V1".into(), engine_commit_digest: engine_digest,
                checkpoint_digest: hex(&Sha256::digest(&prior.originals[0])),
                issuer_enrollment_digest: m.enrollment[0].clone(), anchor_enrollment_digest: m.enrollment[1].clone(),
                issuer_current_digest: m.current[0].clone(), anchor_current_digest: m.current[1].clone(),
                operation: a.context.link.facts.operation.clone(), nonce: B64.encode(a.context.link.facts.nonce),
                once_digest: hex(&observed.checkpoint_digest), protected_output_digest: hex(&observed.output_cipher_hash),
                sequence: "1".into(), previous_digest: None, state: "committed".into(), issued: m.issued, expires: m.expires })?
        };
        if body.is_empty() || body.len() > 32768 { return Err(BOUND); }
        let stage = current_stage_mut(a, kind)?;
        stage.checkpoint = checkpoint; stage.body = body;
        let domain = if kind == 2 { CHECKPOINT_DOMAIN } else { TERMINAL_DOMAIN };
        for (slot, role) in roles(kind)?.iter().enumerate() {
            let mut frame = domain.to_vec(); frame.push(role.len() as u8); frame.extend_from_slice(role.as_bytes());
            frame.extend_from_slice(&(stage.body.len() as u32).to_be_bytes()); frame.extend_from_slice(&stage.body); stage.frames[slot] = frame;
        }
        Ok(())
    })?;
    context(holder, policy)?; Ok(c.startup)
}
fn finish_parts(a: &mut EngineAttempt, kind: u32) -> Result<(), i32> {
    let id = a.context.link.facts.operation.clone(); let stage = current_stage_mut(a, kind)?;
    let mut originals = Vec::new();
    for (slot, role) in roles(kind)?.iter().enumerate() {
        if stage.classic[slot].len() != 64 || stage.pq[slot].len() != 4627 { return Err(MISMATCH); }
        stage.originals[slot] = encode(&Envelope { version: 1, role, body: B64.encode(&stage.body),
            signature: Signature { classic: B64.encode(&stage.classic[slot]), pq: B64.encode(&stage.pq[slot]) } })?;
        originals.push(OriginalDescriptor { bytes: stage.originals[slot].len(), sha256: hex(&Sha256::digest(&stage.originals[slot])) });
    }
    stage.receipt = encode(&StageReceipt { version: 1, id: &id, kind: if kind == 2 { "engineCheckpoint" } else { "engineTerminal" },
        body_digest: hex(&Sha256::digest(&stage.body)), originals })?;
    stage.phase = 2; Ok(())
}
fn run_stage(holder: *mut c_void, policy: *mut c_void, resource: *mut c_void, kind: u32, started: &mut bool) -> Result<(), i32> {
    let startup = prepare(holder, policy, resource, kind, started)?;
    status(unsafe { ynx_native_core_resource_driver_message3_enter(resource, holder, kind) })?;
    with_attempt(holder, policy, |a| { current_stage_mut(a, kind)?.phase = 1; Ok(()) })?;
    for slot in 0..roles(kind)?.len() { for pq in [false, true] {
        context(holder, policy)?;
        let frame = with_attempt(holder, policy, |a| Ok(current_stage(a, kind)?.frames[slot].clone()))?;
        status(unsafe { ynx_native_core_resource_driver_message3_key_enter(resource, holder, kind, slot as u32, u32::from(pq)) })?;
        let mut guard = KeyGuard { holder, policy, resource, kind, role: slot, pq, frame, claimed: false, finished: false };
        if with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?{super::fixed_message_key_owner::sign_selected_ordinary_key(guard,startup,signer(kind,slot)?)?;continue;}
        let signed = STARTUP_EVIDENCE.with(|r| {
            let mut r = r.try_borrow_mut().map_err(|_| UNKNOWN)?; let held = r.get_mut(&startup).ok_or(UNKNOWN)?; selected_current(held)?;
            let pair = held.pairs[signer(kind, slot)?].as_mut().ok_or(1)?;
            Ok::<_, i32>(pair.sign_engine_guard(&mut guard))
        });
        let (bytes, actual) = match signed { Ok((bytes, result)) => (bytes, result.err().map(custody_status).unwrap_or(OK)), Err(code) => (Vec::new(), code) };
        guard.finish(bytes, actual)?;
    } }
    with_attempt(holder, policy, |a| finish_parts(a, kind))?;
    let mut readback = vec![0u8; 4096]; let mut written = 0;
    let code = unsafe { ynx_native_core_resource_driver_message3_retire(resource, holder, kind, readback.as_mut_ptr(), readback.len(), &mut written) };
    let bounded = written <= readback.len(); if bounded { readback.truncate(written); }
    with_attempt(holder, policy, |a| {
        let stage = current_stage_mut(a, kind)?; stage.readback = readback;
        if !bounded { return Err(UNKNOWN); } if code == OK && stage.readback != stage.receipt { return Err(MISMATCH); } Ok(())
    })?;
    status(code)?; context(holder, policy)?;
    with_attempt(holder, policy, |a| { current_stage_mut(a, kind)?.phase = 3; Ok(()) })
}
fn stage_boundary(holder: *mut c_void, policy: *mut c_void, resource: *mut c_void, kind: u32) -> i32 {
    let mut started = false;
    let result = catch_unwind(AssertUnwindSafe(|| run_stage(holder, policy, resource, kind, &mut started))).unwrap_or(Err(UNKNOWN));
    finish_run_status(started, result, |cause| fail(holder, policy, kind, cause))
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_engine_checkpoint_run_v1(holder: *mut c_void, policy: *mut c_void, resource: *mut c_void) -> i32 {
    stage_boundary(holder, policy, resource, 2)
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_engine_terminal_run_v1(holder: *mut c_void, policy: *mut c_void, resource: *mut c_void) -> i32 {
    stage_boundary(holder, policy, resource, 3)
}
#[unsafe(no_mangle)]
pub(crate) unsafe extern "C" fn ynx_sdk_native_engine_lifecycle_run_v1(holder: *mut c_void, policy: *mut c_void, resource: *mut c_void) -> i32 {
    // The normal caller chooses this instead of commit-only, not in addition
    // to its old checkpoint path. Duplicate commit refuses before any effect.
    let committed = unsafe { super::ynx_sdk_native_engine_commit_run_v1(holder, policy, resource) };
    if committed != OK { return committed; }
    let result = catch_unwind(AssertUnwindSafe(|| {
        context(holder, policy)?;
        // Ordinary signs the actual committed engine row. It never enters
        // the old hardware checkpoint, nor manufactures its floor/name.
        if !with_attempt(holder,policy,|a|Ok(a.binding.is_ordinary()))?{
            status(unsafe { ynx_native_core_resource_driver_checkpoint(resource) })?;
        }
        status(stage_boundary(holder, policy, resource, 2))?;
        status(stage_boundary(holder, policy, resource, 3))?;
        context(holder, policy)?; Ok(())
    })).unwrap_or(Err(UNKNOWN));
    match result { Ok(()) => OK, Err(cause) => {
        let _ = with_attempt(holder, policy, |a| { if a.lifecycle_first == OK { a.lifecycle_first = cause; } Ok(()) }); cause
    } }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn engine_successor_checkpoint_slot_zero_selects_real_anchor_key_pair() {
        assert_eq!(signer(2, 0), Ok(1)); assert!(signer(2, 1).is_err());
        assert_eq!(signer(3, 0), Ok(0)); assert_eq!(signer(3, 1), Ok(1)); assert!(signer(1, 0).is_err());
    }
    #[test] fn engine_successor_original_window_is_fixed_and_never_renewed_by_observation() {
        assert_eq!(original_window(100, 200, 150), Ok((100, 200)));
        assert_eq!(original_window(100, 200, 199), Ok((100, 200)));
        for values in [(0, 200, 100), (100, 30101, 100), (100, 200, 99), (100, 200, 200)] {
            assert!(original_window(values.0, values.1, values.2).is_err());
        }
    }
    #[test] fn engine_successor_observation_layout_matches_frozen_a9_private_abi() {
        assert_eq!(std::mem::size_of::<CheckpointObservation>(), 120);
        assert_eq!(std::mem::offset_of!(CheckpointObservation, anchor_counter_name), 16);
        assert_eq!(std::mem::offset_of!(CheckpointObservation, checkpoint_digest), 56);
        assert_eq!(std::mem::offset_of!(CheckpointObservation, output_cipher_hash), 88);
    }
    #[test] fn engine_successor_checkpoint_receipt_has_one_signed_original_not_two_or_body_digest() {
        let raw = b"PUBLIC-ANCHOR-ENVELOPE";
        let receipt = encode(&StageReceipt {version: 1, id: "original-operation", kind: "engineCheckpoint",
            body_digest: hex(&Sha256::digest(b"PUBLIC-BODY")), originals: vec![OriginalDescriptor {bytes: raw.len(), sha256: hex(&Sha256::digest(raw))}]}).unwrap();
        let value: serde_json::Value = serde_json::from_slice(&receipt).unwrap();
        assert_eq!(value["originals"].as_array().unwrap().len(), 1);
        assert_ne!(value["bodyDigest"], value["originals"][0]["sha256"]);
    }
    #[test] fn engine_successor_foreign_holder_never_creates_a_stage_or_changes_original_registry() {
        assert_ne!(stage_boundary(0x55usize as *mut c_void, 0x66usize as *mut c_void, 0x77usize as *mut c_void, 2), OK);
        SDK_CUSTODY.with(|r| assert!(r.borrow().is_empty()));
    }
}


// Read-only same-attempt public parts after actual retirement. A duplicate or
// rejected export must never mark or clear an already successful stage.
pub(super) fn completed_public_parts(stage:&Attempt,kind:u32)->Result<([&[u8];2],&[u8],&[u8]),i32>{
 if stage.kind!=kind||stage.phase!=3||stage.first!=OK{return Err(if stage.first!=OK{stage.first}else{MISMATCH})}
 if stage.receipt.is_empty()||stage.receipt!=stage.readback{return Err(MISMATCH)}
 let count=roles(kind)?.len();
 if stage.originals[..count].iter().any(Vec::is_empty)||stage.originals[count..].iter().any(|v|!v.is_empty()){return Err(MISMATCH)}
 Ok(([stage.originals[0].as_slice(),stage.originals[1].as_slice()],&stage.receipt,&stage.readback))
}
// Presence/retention gate for the same scoped server read. This is DATA
// availability only; the normal verification and physical owner still gate
// publication. Missing genuine successors are REQUIRED, not fabricated.
pub(super)fn server_read_ready(stage:Option<&Attempt>,kind:u32)->Result<(),i32>{
 let Some(stage)=stage else{return Err(1)};
 if stage.first!=OK{return Err(stage.first)}
 if stage.kind!=kind{return Err(MISMATCH)}
 if stage.phase!=3||stage.receipt.is_empty()||stage.receipt!=stage.readback{return Err(1)}
 let count=roles(kind)?.len();
 if stage.originals[..count].iter().any(Vec::is_empty){return Err(1)}
 if stage.originals[count..].iter().any(|v|!v.is_empty()){return Err(MISMATCH)}
 Ok(())
}
pub(super)fn completed_public_validate(holder:*mut c_void,policy:*mut c_void)->Result<(),i32>{
 verify_retained_signed_binding(holder,policy,2)?;verify_retained_signed_binding(holder,policy,3)
}

pub(super)fn ordinary_operation_predecessors(a:&EngineAttempt,kind:u32)->Result<[Vec<u8>;3],i32>{
 if kind==1{return Ok(std::array::from_fn(|_|vec![]))}
 if !a.binding.is_ordinary()||a.phase!=3||a.first!=OK||a.receipt!=a.readback||a.originals.iter().any(Vec::is_empty){return Err(MISMATCH)}
 let mut out=[a.originals[0].clone(),a.originals[1].clone(),vec![]];
 if kind==3{let prior=current_stage(a,2)?;if prior.phase!=3||prior.first!=OK||prior.receipt!=prior.readback||prior.originals[0].is_empty(){return Err(MISMATCH)}out[2]=prior.originals[0].clone();}else if kind!=2{return Err(BOUND)}
 if out.iter().any(|v|v.len()>196608){return Err(BOUND)}Ok(out)
}
