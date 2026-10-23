#!/usr/bin/env python3
"""One fixed, independently authorized verifier of the retained actual export0.

This is DATA, not a resume or an export retry. Neither historical attempt is
written. The old failed result stays failed; this caller records its own single
normal verifier exit and links the independently pinned prior export evidence.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import stat
import sys
from types import ModuleType


VERSION = "YNX-RETAINED-NATIVE-EXPORT-VERIFY/v1"
BASE_VERSION = "YNX-ORIGINAL-NATIVE-COPY-VERIFY/v1"
CASE = "/var/tmp/ynx-pq-original-native-check-5d-20261023163017Z"
ATTEMPT = "offline-verify-retained-export-8g180s"
PRIOR_ATTEMPT = "offline-export-verify-8g180s-observation-fixed"
BASE_NAME = "verify-original-native-copy.py"
# Current executable source qualification is separate from the immutable
# controller identity that produced the retained failed export. Updating the
# sampler must never rewrite that export's intent or prior evidence.
BASE_PIN = {"bytes": "48804", "sha256": "f6f9b1da0289707e8e30cac545d3f557819bc7bd75f5d413ae08eb7ce8e9d11d"}
PRIOR_GUARD_BYTES = "47901"
PRIOR_GUARD_SHA256 = "fa8a1ac1230b4f3ac5bee549019d7e7e3312c5a954c3a19227c8607f054e6c37"
PRIOR_CONTRACT = "bc3b5448b12f2d3b5c5cb098f4f35fbd88e7320f893415b77198ae249e04cbb4"
PRIOR_CHILD = {"phase": "export", "pid": 1592161, "startTicks": 1557438355}
PRIOR_FILES = {}
for _name, _size, _sha, _inode, _ns in (
    ("intent.json", "652", "7bf7604d39122e99b210692a374c6504925b44e09c41bf6b94697da0efcd1dc5", "405740", "1792780153338417027"),
    ("result.json", "718", "01ccfea0e9e6f3af69cdb5ce691b5616aaaf7452a36dcfbe88a543e83daa74ad", "405746", "1792780188043847246"),
    ("journal.jsonl", "58423", "bd592bc24c80202b6a97209a504f967e850143270ba82cbc49641a82e0e11fa3", "405741", "1792780187913849381"),
    ("first-cause.json", "30", "c5f7f370ab725b819eed638cbacc66b58356593242ae77bbb8157d07477b7ec0", "405745", "1792780188041847279"),
    ("migration.json", "700665224", "b48596cf5440ff8324d2545e7661d7570acc98ae77b712dcdd7eca2eaa14db23", "405744", "1792780184570904264"),
):
    PRIOR_FILES[_name] = dict(bytes=_size, sha256=_sha, witness=dict(uid="0", mode="600", device="64770",
        inode=_inode, bytes=_size, mtimeNs=_ns, ctimeNs=_ns, nlink="1"))
PRIOR_EXPORT = dict(attempt=PRIOR_ATTEMPT, contractSHA256=PRIOR_CONTRACT,
                    controllerSHA256=PRIOR_GUARD_SHA256, files=PRIOR_FILES)
CHECKPOINT = dict(height="1987832", stateHash="b8ec4956306d2c3951683ec8296797d39579cfc786a240cdb7c387044ff480f4",
                  accounts="5310", validators="4")
BASE_FIELDS = ("classification", "casePath", "controllerSHA256", "inputs", "toolSource", "limits",
               "environment", "mustBeEmptyProcessGroups", "preparedInputWitness")
RESULT_FIELDS = ("version", "classification", "contractSHA256", "normalExitCodes", "firstCause", "cleanupComplete",
    "cleanupError", "sampleCount", "peakOwnedRSSBytes", "maxCaseDeltaBytes", "minFreeDiskBytes", "elapsedMs",
    "inputBytesUnchanged", "verification", "preparedOwnerUID", "guardMode", "cgroupHardWall", "ownedSockets",
    "migrationVerified", "authoritativeFinalCheckpoint", "sourceDeploymentQualified", "deployment", "rootGrant", "publicActivation")


class Refused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Refused(code)


def closed(value, names):
    require(type(value) is dict and set(value) == set(names), "closed_fields_required")


def digest(value):
    require(type(value) is str and re.fullmatch("[0-9a-f]{64}", value) and value != "0" * 64,
            "independent_nonzero_sha256_required")
    return value


def decode(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value, "duplicate_json_field")
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=unique,
        parse_constant=lambda _: (_ for _ in ()).throw(Refused("nonfinite_json")))


def identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def witness(info):
    return dict(uid=str(info.st_uid), mode=format(stat.S_IMODE(info.st_mode), "o"), device=str(info.st_dev),
        inode=str(info.st_ino), bytes=str(info.st_size), mtimeNs=str(info.st_mtime_ns), ctimeNs=str(info.st_ctime_ns), nlink=str(info.st_nlink))


def read_bootstrap(path, maximum, expected=None):
    # No imported local module participates in this pre-import trust check.
    require(path.is_absolute() and str(path.resolve(strict=True)) == str(path), "canonical_bootstrap_file_required")
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and stat.S_IMODE(before.st_mode) in (0o400, 0o600)
            and before.st_uid == os.geteuid() and before.st_nlink == 1 and 0 < before.st_size <= maximum,
            "private_bounded_bootstrap_file_required")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(fd, "rb") as source:
        require(identity(os.fstat(source.fileno())) == identity(before), "bootstrap_open_identity_changed")
        raw = source.read(maximum + 1)
        require(len(raw) == before.st_size and identity(os.fstat(source.fileno())) == identity(before)
                and identity(path.lstat()) == identity(before), "bootstrap_file_changed")
    pin = dict(bytes=str(len(raw)), sha256=hashlib.sha256(raw).hexdigest())
    require(expected is None or pin == expected, "bootstrap_pin_mismatch")
    return dict(pin=pin, identity=identity(before)), raw


def load_base(descriptor):
    closed(descriptor, ("bytes", "sha256", "witness"))
    require({key: descriptor[key] for key in BASE_PIN} == BASE_PIN, "fixed_base_guard_pin_required")
    closed(descriptor["witness"], ("uid", "mode", "device", "inode", "bytes", "mtimeNs", "ctimeNs", "nlink"))
    path = Path(__file__).absolute().parent / BASE_NAME
    parent = path.parent
    require(str(parent.resolve(strict=True)) == str(parent), "canonical_base_directory_required")
    directory = parent.lstat()
    require(stat.S_ISDIR(directory.st_mode) and stat.S_IMODE(directory.st_mode) == 0o700
            and directory.st_uid == os.geteuid(), "private_base_directory_required")
    before, source_bytes = read_bootstrap(path, int(BASE_PIN["bytes"]), BASE_PIN)
    require(witness(path.lstat()) == descriptor["witness"], "base_guard_metadata_mismatch")
    module = ModuleType("ynx_fixed_retained_export_base")
    module.__file__, module.__package__ = str(path), ""
    # Execute the already verified bytes, never let a loader reopen a path
    # between the pin check and execution of the local base module.
    exec(compile(source_bytes, str(path), "exec"), module.__dict__)
    after, _ = read_bootstrap(path, int(BASE_PIN["bytes"]), BASE_PIN)
    require(after == before and witness(path.lstat()) == descriptor["witness"], "base_guard_changed_during_import")
    require(module.VERSION == BASE_VERSION and module.CASE == CASE and module.ATTEMPT == PRIOR_ATTEMPT,
            "fixed_base_profile_mismatch")
    return module, (path, before, None)


def base_contract(value):
    return dict(version=BASE_VERSION, **{key: value[key] for key in BASE_FIELDS})


def validate_contract(base, value):
    closed(value, ("version", *BASE_FIELDS, "baseGuard", "priorExport"))
    require(value["version"] == VERSION and value["classification"] == "data" and value["casePath"] == CASE,
            "wrong_fixed_retained_profile")
    base.validate_contract(base_contract(value))
    descriptor = value["baseGuard"]
    closed(descriptor, ("bytes", "sha256", "witness"))
    require({key: descriptor[key] for key in BASE_PIN} == BASE_PIN, "fixed_base_guard_pin_required")
    row = descriptor["witness"]
    closed(row, ("uid", "mode", "device", "inode", "bytes", "mtimeNs", "ctimeNs", "nlink"))
    require(row["uid"] == "0" and row["mode"] in ("400", "600") and row["nlink"] == "1"
            and row["bytes"] == BASE_PIN["bytes"], "prepared_base_guard_witness_required")
    for key in ("inode", "mtimeNs", "ctimeNs"):
        base.positive(row[key])
    require(type(row["device"]) is str and re.fullmatch("0|[1-9][0-9]*", row["device"]), "prepared_base_device_required")
    require(value["priorExport"] == PRIOR_EXPORT, "fixed_actual_export0_evidence_required")
    require({"pgid": str(PRIOR_CHILD["pid"]), "leaderStartTicks": str(PRIOR_CHILD["startTicks"])}
            in value["mustBeEmptyProcessGroups"], "prior_export_group_must_be_empty")
    return value


def validate_prior_result(base, value):
    base.closed(value, RESULT_FIELDS)
    codes = value["normalExitCodes"]
    require(type(codes) is list and len(codes) == 1 and type(codes[0]) is int and codes[0] == 0,
            "prior_actual_export_exit0_required")
    require(value["version"] == BASE_VERSION and value["classification"] == "data"
            and value["contractSHA256"] == PRIOR_CONTRACT and value["firstCause"] == "fresh_memory_floor"
            and value["cleanupComplete"] is True and value["cleanupError"] is None
            and value["verification"] is None and value["inputBytesUnchanged"] is False
            and value["preparedOwnerUID"] == "0", "prior_failed_export0_result_required")
    require(all(value[key] is False for key in ("migrationVerified", "authoritativeFinalCheckpoint",
            "sourceDeploymentQualified", "deployment", "rootGrant", "publicActivation", "cgroupHardWall")),
            "prior_result_must_not_claim_authority")


def validate_prior_export(base, case, progress):
    directory = case / PRIOR_ATTEMPT
    base.private_directory(directory)
    pins, documents = {}, {}
    for name, expected in PRIOR_FILES.items():
        path = directory / name
        require(base.prepared_witness(base.regular(path)) == expected["witness"], "retained_export_identity_mismatch")
        pin = {key: expected[key] for key in ("bytes", "sha256")}
        record, raw = base.read_file(path, pin, None if name == "migration.json" else 131072, progress)
        require(base.prepared_witness(base.regular(path)) == expected["witness"], "retained_export_identity_mismatch")
        pins[name] = record
        if name != "migration.json":
            documents[name] = raw
    result = base.decode(documents["result.json"])
    validate_prior_result(base, result)
    intent = base.decode(documents["intent.json"])
    base.closed(intent, ("version", "contractSHA256", "controllerSHA256", "status", "automaticRetry", "limits",
                        "environment", "sourceFinalCheckpoint", "rootGrant"))
    require(intent == dict(version=BASE_VERSION, contractSHA256=PRIOR_CONTRACT, controllerSHA256=PRIOR_GUARD_SHA256,
        status="unknown", automaticRetry=False, limits=base.LIMITS, environment=base.ENVIRONMENT,
        sourceFinalCheckpoint=False, rootGrant=False), "prior_export_intent_mismatch")
    require(base.decode(documents["first-cause.json"]) == {"code": "fresh_memory_floor"}, "prior_first_cause_changed")
    journal = [base.decode(line) for line in documents["journal.jsonl"].splitlines()]
    for event in journal:
        base.closed(event, ("event", "detail"))
    started = [event["detail"] for event in journal if event["event"] == "child_started"]
    exited = [event["detail"] for event in journal if event["event"] == "child_exited"]
    require(started == [PRIOR_CHILD] and exited == [{"phase": "export", "code": 0}], "prior_export_journal_exit0_required")
    return dict(files=pins, result=result)


def normal_command(case):
    return [str(case / "tools/extracted/ynx-consensus-package"), "-verify-migration-state",
            str(case / PRIOR_ATTEMPT / "migration.json")]


def qualify_retained_verifier(base, raw, codes, prior_result):
    validate_prior_result(base, prior_result)
    require(type(codes) is list and len(codes) == 1 and type(codes[0]) is int and codes[0] == 0,
            "actual_single_verifier_exit0_required")
    match = re.fullmatch(rb"consensus migration state passed: height=([1-9][0-9]*) lastBlockHash=((?:0x)?[0-9a-f]{64}) stateHash=([0-9a-f]{64}) accounts=([1-9][0-9]*) validators=(4)\n", raw)
    require(match is not None, "normal_retained_verifier_completion_missing")
    result = dict(height=match[1].decode(), lastBlockHash=match[2].decode(), stateHash=match[3].decode(),
                  accounts=match[4].decode(), validators=match[5].decode())
    require(all(result[key] == value for key, value in CHECKPOINT.items()), "retained_checkpoint_mismatch")
    return result


def run(base, contract, contract_pin, witnesses):
    require(sys.platform == "linux" and platform.machine() == "x86_64", "linux_amd64_required")
    require(os.geteuid() == 0, "explicit_root_prepared_copy_required")
    require(hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"), "identity_safe_cleanup_unavailable")
    case = Path(contract["casePath"])
    base.private_directory(case)
    require(not os.path.lexists(case / ATTEMPT), "retained_verifier_attempt_partial_or_unknown_retained")
    # The pinned base constructor only assigns its old output path; it does not
    # open or write it. Replace that DATA attribute before any output creation.
    controller = base.Controller(base_contract(contract), contract_pin)
    controller.output = case / ATTEMPT
    libc = base.ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [base.ctypes.c_int, base.ctypes.c_ulong, base.ctypes.c_ulong, base.ctypes.c_ulong, base.ctypes.c_ulong]
    previous, confirmed = base.ctypes.c_int(), base.ctypes.c_int()
    require(libc.prctl(37, base.ctypes.cast(base.ctypes.pointer(previous), base.ctypes.c_void_p).value, 0, 0, 0) == 0
            and libc.prctl(36, 1, 0, 0, 0) == 0
            and libc.prctl(37, base.ctypes.cast(base.ctypes.pointer(confirmed), base.ctypes.c_void_p).value, 0, 0, 0) == 0
            and confirmed.value == 1, "owned_child_subreaper_required")
    controller.output.mkdir(mode=0o700)
    base.sync_directory(case)
    base.exclusive(controller.output / "intent.json", base.json_bytes(dict(version=VERSION, contractSHA256=contract_pin,
        controllerSHA256=contract["controllerSHA256"], baseGuardSHA256=BASE_PIN["sha256"], priorExport=PRIOR_EXPORT,
        status="unknown", automaticRetry=False, limits=base.LIMITS, environment=base.ENVIRONMENT,
        sourceFinalCheckpoint=False, rootGrant=False)))
    fd = os.open(controller.output / "journal.jsonl", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    controller.events = os.fdopen(fd, "wb")
    result, source_pins, prior, cleanup_ok, cleanup_error = None, None, None, False, None
    previous_handlers, timer_owned = {}, False
    def interrupted(_signum, _frame):
        raise base.Refused("external_interruption")
    def active_timeout(_signum, _frame):
        raise base.Refused("active_time_limit")
    try:
        controller.event("fresh_preflight", controller.last_sample)
        require(signal.getitimer(signal.ITIMER_REAL) == (0.0, 0.0), "fresh_controller_timer_required")
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGALRM):
            previous_handlers[sig] = signal.signal(sig, interrupted)
        signal.signal(signal.SIGALRM, active_timeout)
        signal.setitimer(signal.ITIMER_REAL, max(0.001, controller.started + base.LIMITS["activeSeconds"] - base.time.monotonic()))
        timer_owned = True
        base.check_prepared_witness(case, contract["preparedInputWitness"])
        source_pins = base.validate_inputs(case, controller.capacity)
        prior = validate_prior_export(base, case, controller.capacity)
        controller.command(normal_command(case), "verify", source_pins["tools/extracted/ynx-consensus-package"])
        result = qualify_retained_verifier(base, (controller.output / "verify.stdout").read_bytes(), controller.codes, prior["result"])
        after_prior = validate_prior_export(base, case, controller.capacity)
        require(after_prior == prior, "retained_export_changed_after_verification")
        for name, before in source_pins.items():
            after, _ = base.read_file(case / name, before["pin"], progress=controller.capacity,
                                     executable=name.rsplit("/", 1)[-1] in base.TOOLS)
            require(after == before, "original_input_changed_after_verification")
        for path, before, executable in witnesses:
            after, _ = base.read_file(path, before["pin"], maximum=1 << 20,
                                     progress=controller.capacity, executable=executable)
            require(after == before, "contract_or_fixed_source_changed")
        base.check_prepared_witness(case, contract["preparedInputWitness"])
        controller.next_sample = 0
        controller.capacity()
    except Exception as exc:
        controller.first_cause = str(exc) if isinstance(exc, (Refused, base.Refused)) else "input_or_telemetry_" + type(exc).__name__
    finally:
        if timer_owned:
            signal.setitimer(signal.ITIMER_REAL, 0)
        for sig in previous_handlers:
            signal.signal(sig, signal.SIG_IGN)
        if timer_owned:
            signal.signal(signal.SIGALRM, lambda _s, _f: (_ for _ in ()).throw(base.Refused("cleanup_time_limit")))
            remaining = min(base.LIMITS["cleanupSeconds"], controller.started + base.LIMITS["totalSeconds"] - base.time.monotonic())
            signal.setitimer(signal.ITIMER_REAL, max(0.001, remaining))
        try:
            cleanup_ok, cleanup_error = controller.cleanup()
        except Exception as exc:
            cleanup_ok, cleanup_error = False, str(exc) if isinstance(exc, (Refused, base.Refused)) else "cleanup_telemetry_incomplete"
        if timer_owned:
            signal.setitimer(signal.ITIMER_REAL, 0)
        for sig, handler in previous_handlers.items():
            signal.signal(sig, handler)
        if libc.prctl(36, previous.value, 0, 0, 0) != 0:
            cleanup_ok, cleanup_error = False, cleanup_error or "subreaper_restore_failed"
        try:
            controller.events.close()
        except OSError:
            cleanup_ok, cleanup_error = False, cleanup_error or "journal_persistence_failed"
    if not cleanup_ok:
        controller.first_cause = controller.first_cause or cleanup_error
    if base.time.monotonic() - controller.started > base.LIMITS["totalSeconds"]:
        controller.first_cause = controller.first_cause or "total_time_limit"
    if controller.first_cause is not None:
        try:
            failure = dict(code=controller.first_cause)
            if controller.task_sample_failure is not None:
                failure.update(taskSample=controller.task_sample_failure, taskSampleJournalError=controller.task_sample_journal_error)
            base.exclusive(controller.output / "first-cause.json", base.json_bytes(failure))
        except Exception:
            pass
    receipt = dict(version=VERSION, classification="data", contractSHA256=contract_pin, baseGuard=BASE_PIN,
        priorExport=PRIOR_EXPORT, normalExitCodes=controller.codes, firstCause=controller.first_cause,
        cleanupComplete=cleanup_ok, cleanupError=cleanup_error, sampleCount=controller.samples,
        peakOwnedRSSBytes=controller.peak_rss, maxCaseDeltaBytes=controller.max_delta, minFreeDiskBytes=controller.min_free,
        elapsedMs=int((base.time.monotonic() - controller.started) * 1000), inputBytesUnchanged=controller.first_cause is None,
        verification=result, preparedOwnerUID="0", guardMode="sampled-proc-smaps-rollup-200ms", cgroupHardWall=False,
        ownedSockets="sampled-rejected", migrationVerified=result is not None and controller.first_cause is None and cleanup_ok,
        authoritativeFinalCheckpoint=False, sourceDeploymentQualified=False, deployment=False, rootGrant=False, publicActivation=False)
    try:
        base.exclusive(controller.output / "result.json", base.json_bytes(receipt))
    except Exception:
        raise Refused(controller.first_cause or "result_persistence_failed")
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract", required=True)
    parser.add_argument("--contract-sha256", required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirmed-contract-sha256")
    args = parser.parse_args(argv)
    try:
        digest(args.contract_sha256)
        contract_path = Path(args.contract)
        record, raw = read_bootstrap(contract_path, 65536)
        require(record["pin"]["sha256"] == args.contract_sha256, "external_contract_pin_mismatch")
        value = decode(raw)
        require(type(value) is dict and "baseGuard" in value, "fixed_base_descriptor_required")
        base, base_witness = load_base(value["baseGuard"])
        contract = validate_contract(base, value)
        source_path = Path(__file__).absolute()
        source, _ = base.read_file(source_path, maximum=1 << 20, executable=None)
        require(source["pin"]["sha256"] == contract["controllerSHA256"], "controller_source_hash_mismatch")
        require(args.execute or args.confirmed_contract_sha256 is None, "confirmation_without_execution")
        if not args.execute:
            print(base.json_bytes(dict(version=VERSION, classification="data", contractValidated=True,
                executionStarted=False, requiresExactRootWindow=True, rootGrant=False)).decode(), end="")
            return 0
        require(args.confirmed_contract_sha256 == args.contract_sha256, "exact_external_contract_confirmation_required")
        result = run(base, contract, args.contract_sha256,
                     [(contract_path, record, False), (source_path, source, None), base_witness])
        print(base.json_bytes(result).decode(), end="")
        return 0 if result["migrationVerified"] else 1
    except Exception as exc:
        code = str(exc) if isinstance(exc, Refused) or type(exc).__name__ == "Refused" else "input_or_telemetry_" + type(exc).__name__
        print(json.dumps(dict(version=VERSION, classification="data", firstCause=code,
                             executionStarted=False, rootGrant=False), sort_keys=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
