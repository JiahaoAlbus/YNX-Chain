"""Validate completed normal validator-directory DATA for a QA receipt."""

from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
import re

MAX_BODY = 16_777_216
MAX_TABLE_ROWS = 20_000
FRESHNESS_RESERVE = timedelta(seconds=300)


class DirectoryCaptureError(ValueError):
    """Public, fixed-vocabulary capture failure."""


@dataclass(frozen=True)
class DirectorySummary:
    epoch: int
    rotation: int
    refreshed_utc: datetime
    epoch_end_utc: datetime
    basic_rows: int
    described_rows: int
    payload_sha256: str

    def receipt_data(self):
        return {
            "epoch": self.epoch, "rotation": self.rotation,
            "refreshedUTC": self.refreshed_utc.isoformat(),
            "epochEndUTC": self.epoch_end_utc.isoformat(),
            "basicRows": self.basic_rows, "describedRows": self.described_rows,
            "exactPayloadSHA256WithoutFinalLF": self.payload_sha256,
        }


def summarize_terminal(stdout, *, process, stdout_eof, stderr_eof, fds_closed, supervisor_live,
                       observed_utc, expires_utc, now_monotonic_ns, deadline_monotonic_ns):
    """Adapt the caller's owned-child wait and pipe observations."""
    if (not isinstance(process, dict) or process.get("terminalOutcome") != "ORIGINAL_POPEN_WAIT"
            or process.get("reaped") is not True or type(process.get("exit")) is not int or process["exit"] != 0
            or type(process.get("pid")) is not int or process["pid"] <= 1 or process.get("pgid") != process["pid"]
            or stdout_eof is not True or stderr_eof is not True or fds_closed is not True or supervisor_live is not True):
        raise DirectoryCaptureError("directory-terminal-capture-incomplete")
    if (not isinstance(observed_utc, datetime) or observed_utc.utcoffset() != timedelta(0)
            or not isinstance(expires_utc, datetime) or expires_utc.utcoffset() != timedelta(0)
            or type(now_monotonic_ns) is not int or type(deadline_monotonic_ns) is not int
            or now_monotonic_ns >= deadline_monotonic_ns or observed_utc >= expires_utc):
        raise DirectoryCaptureError("directory-capture-expired")
    return summarize(stdout, observed_utc=observed_utc)


def unique_object(pairs):
    result = {}
    for field, value in pairs:
        if field in result:
            raise DirectoryCaptureError("directory-duplicate-field")
        result[field] = value
    return result


def reject_constant(_):
    raise DirectoryCaptureError("directory-invalid-json-number")


def number(value, ceiling=(1 << 64) - 1):
    return type(value) is int and 0 <= value <= ceiling


def table_size(table):
    if not isinstance(table, dict):
        raise DirectoryCaptureError("directory-table-shape")
    rows, pagination = table.get("data"), table.get("pagination")
    if not isinstance(rows, list) or not isinstance(pagination, dict):
        raise DirectoryCaptureError("directory-table-shape")
    total, page = pagination.get("total"), pagination.get("page")
    if type(page) is not int or page != 0 or not number(total, MAX_TABLE_ROWS) or total != len(rows) or not rows:
        raise DirectoryCaptureError("directory-table-incomplete")
    # The normal command aggregates data but retains the first page's size.
    # Its complete table contract uses total and page, as Native's selector does.
    ids = set()
    for row in rows:
        node = row.get("node_id") if isinstance(row, dict) else None
        if not number(node, (1 << 32) - 1) or node in ids:
            raise DirectoryCaptureError("directory-node-id")
        ids.add(node)
    return total


def parse_utc(value, *, description):
    if not isinstance(value, str):
        raise DirectoryCaptureError("directory-" + description + "-format")
    if description == "epoch":
        pattern = r"([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2})(?:\.([0-9]{1,9}))?Z"
    else:
        pattern = r"([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{2}:[0-9]{2}:[0-9]{2})\.([0-9]{1,9}) \+00:00:00"
    match = re.fullmatch(pattern, value)
    if not match:
        raise DirectoryCaptureError("directory-" + description + "-format")
    date, clock, fraction = match.groups()
    try:
        return datetime.fromisoformat(f"{date}T{clock}.{(fraction or '0')[:6].ljust(6, '0')}+00:00")
    except ValueError:
        raise DirectoryCaptureError("directory-" + description + "-format") from None


def summarize(stdout, *, observed_utc):
    """Return a digest and finite public facts only. No role selection or launch authority."""
    if not isinstance(stdout, bytes) or not 2 <= len(stdout) <= MAX_BODY + 1 or not stdout.endswith(b"\n"):
        raise DirectoryCaptureError("directory-output-bound-or-terminator")
    raw = stdout[:-1]
    if not raw.startswith(b"{") or not raw.endswith(b"}"):
        raise DirectoryCaptureError("directory-output-frame")
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object, parse_constant=reject_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise DirectoryCaptureError("directory-invalid-json") from None
    if (not isinstance(document, dict) or set(document) != {"schema", "basic", "described", "epoch"}
            or document["schema"] != "YNX_NYM_DIRECTORY_V1"):
        raise DirectoryCaptureError("directory-envelope")
    basic, epoch = document["basic"], document["epoch"]
    metadata = basic.get("metadata") if isinstance(basic, dict) else None
    if not isinstance(metadata, dict) or "status" not in metadata or metadata["status"] is not None or not isinstance(epoch, dict):
        raise DirectoryCaptureError("directory-metadata")
    epoch_id, rotation = metadata.get("absolute_epoch_id"), metadata.get("rotation_id")
    current, period = epoch.get("total_elapsed_epochs"), epoch.get("epoch_length")
    if not number(epoch_id) or not number(rotation) or not number(current) or current != epoch_id:
        raise DirectoryCaptureError("directory-epoch-mismatch")
    if (not isinstance(period, dict) or not number(period.get("secs"), 86_400)
            or period["secs"] < 600 or type(period.get("nanos")) is not int or period["nanos"] != 0):
        raise DirectoryCaptureError("directory-epoch-length")
    refreshed = parse_utc(metadata.get("refreshed_at"), description="refresh")
    started = parse_utc(epoch.get("current_epoch_start"), description="epoch")
    length = timedelta(seconds=period["secs"])
    try:
        end = started + length
        if (observed_utc.utcoffset() != timedelta(0) or observed_utc < started
                or end - observed_utc <= FRESHNESS_RESERVE
                or not -timedelta(seconds=60) <= observed_utc - refreshed <= length):
            raise DirectoryCaptureError("directory-stale-epoch")
    except OverflowError:
        raise DirectoryCaptureError("directory-epoch-overflow") from None
    return DirectorySummary(epoch_id, rotation, refreshed, end, table_size(basic.get("nodes")),
                            table_size(document["described"]), hashlib.sha256(raw).hexdigest())
