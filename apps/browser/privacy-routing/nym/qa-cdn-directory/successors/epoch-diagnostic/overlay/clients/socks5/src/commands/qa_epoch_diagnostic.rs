//! Public epoch DATA only. No identity, IP, token, profile, node or admission fields.
use serde_json::{json, Value};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};

pub(super) struct Observation {
    pub reason: &'static str,
    pub legacy_error: Option<&'static str>,
    values: Value,
}
fn utc(value: OffsetDateTime) -> String {
    value.format(&Rfc3339).unwrap_or_else(|_| "NOT_FORMATTABLE".into())
}
impl Observation {
    pub fn data(&self, run_id: &str) -> Value {
        let mut value = self.values.clone();
        let fields = value.as_object_mut().unwrap();
        fields.insert("schema".into(), json!("YNX_NYM_QA_EPOCH_DIAGNOSTIC_V1"));
        fields.insert("NoProductionAuthority".into(), json!(true));
        fields.insert("diagnosticOnly".into(), json!(true));
        fields.insert("runID".into(), json!(run_id));
        fields.insert("reason".into(), json!(self.reason));
        fields.insert("legacyError".into(), json!(self.legacy_error));
        value
    }
}

/// Same old ordered predicates and exact boundaries. Source hashes refer to the
/// fixed official Interval and NodesResponseMetadata types, not to a self hash.
pub(super) fn inspect(basic_id: u64, refreshed: OffsetDateTime, epoch: &Value, now: OffsetDateTime) -> Observation {
    let start = epoch["current_epoch_start"].as_str()
        .and_then(|v| OffsetDateTime::parse(v, &Rfc3339).ok());
    let seconds = epoch["epoch_length"]["secs"].as_i64();
    let nanos = epoch["epoch_length"]["nanos"].as_u64();
    let epoch_id = epoch["total_elapsed_epochs"].as_u64();
    let end = start.zip(seconds.filter(|s| (600..=86400).contains(s)))
        .and_then(|(s, length)| s.checked_add(Duration::seconds(length)));
    let remaining_ms = end.map(|end| (end-now).whole_milliseconds().to_string());
    let (reason, legacy_error) = if start.is_none() {
        ("epoch_start_invalid", Some("qa-directory-epoch-start"))
    } else if seconds.is_none() {
        ("epoch_length_missing_or_type", Some("qa-directory-epoch-length"))
    } else if !(600..=86400).contains(&seconds.unwrap()) {
        ("epoch_length_out_of_range", Some("qa-directory-stale-epoch"))
    } else if nanos != Some(0) {
        ("epoch_nanos_not_zero", Some("qa-directory-stale-epoch"))
    } else if epoch_id != Some(basic_id) {
        ("epoch_id_mismatch_or_missing", Some("qa-directory-stale-epoch"))
    } else if start.unwrap() > now {
        ("epoch_start_in_future", Some("qa-directory-stale-epoch"))
    } else if end.is_none() {
        // Reject a representable start whose end overflows, rather than panic.
        ("epoch_end_out_of_range", Some("qa-directory-stale-epoch"))
    } else if end.unwrap() <= now+Duration::seconds(300) {
        ("epoch_remaining_not_above_300s", Some("qa-directory-stale-epoch"))
    } else if refreshed > now+Duration::seconds(5) {
        ("metadata_refresh_in_future", Some("qa-directory-stale-metadata"))
    } else if now-refreshed > Duration::seconds(seconds.unwrap()) {
        ("metadata_refresh_older_than_epoch_length", Some("qa-directory-stale-metadata"))
    } else {
        ("epoch_and_metadata_predicates_passed", None)
    };
    Observation { reason, legacy_error, values: json!({
        "sourceHash":"3958eb64c35bbb69a8fbad0754554d1d4a2dcfd634f1c170b17eaab8e16d243c",
        "metadataSourceHash":"6571bfabcefe7d274bc02e01a993d4656cd8d8c534f7693d748450b87cbafcce",
        "basicAbsoluteEpochID":basic_id,"totalElapsedEpochs":epoch_id,
        "epochLengthSeconds":seconds,"epochLengthNanos":nanos,
        "currentEpochStartUTC":start.map(utc),"epochEndUTC":end.map(utc),
        "nowUTC":utc(now),"nowUnixMilliseconds":now.unix_timestamp_nanos().div_euclid(1_000_000).to_string(),
        "remainingMilliseconds":remaining_ms,"minimumRemainingSeconds":300,
        "refreshedAtUTC":utc(refreshed),
        "metadataAgeMilliseconds":(now-refreshed).whole_milliseconds().to_string()
    }) }
}
