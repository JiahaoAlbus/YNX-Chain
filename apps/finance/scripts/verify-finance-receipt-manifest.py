#!/usr/bin/env python3
"""Fail-closed verifier for the retained Finance preflight receipt manifest."""
import hashlib
import os
import pathlib
import sys

def canonical_name(value: str) -> str:
    if value.startswith('./'):
        value = value[2:]
    path = pathlib.PurePosixPath(value)
    if not value or value.startswith('./') or path.is_absolute() or '..' in path.parts or value in ('SHA256SUMS', '.SHA256SUMS.tmp'):
        raise ValueError('unsafe receipt SHA256SUMS path')
    return value

def fail(message: str) -> None:
    raise SystemExit(message)

if len(sys.argv) != 2:
    fail('usage: verify-finance-receipt-manifest.py <receipt-directory>')
root = pathlib.Path(sys.argv[1]).resolve()
manifest = root / 'SHA256SUMS'
if not manifest.is_file() or manifest.is_symlink():
    fail('receipt SHA256SUMS missing or unsafe')
listed: dict[str, str] = {}
for line in manifest.read_text(encoding='utf-8').splitlines():
    digest, sep, name = line.partition('  ')
    if not sep or len(digest) != 64 or any(ch not in '0123456789abcdef' for ch in digest):
        fail('invalid receipt SHA256SUMS entry')
    try:
        name = canonical_name(name)
    except ValueError as error:
        fail(str(error))
    if name in listed:
        fail('unsafe or duplicate receipt SHA256SUMS path')
    listed[name] = digest
expected: dict[str, pathlib.Path] = {}
for current, dirs, files in os.walk(root, followlinks=False):
    for name in dirs + files:
        if pathlib.Path(current, name).is_symlink():
            fail('receipt tree contains symlink')
    for name in files:
        candidate = pathlib.Path(current, name)
        relative = candidate.relative_to(root).as_posix()
        if relative not in ('SHA256SUMS', '.SHA256SUMS.tmp'):
            expected[relative] = candidate
if set(listed) != set(expected):
    fail('receipt SHA256SUMS set mismatch')
for relative, candidate in expected.items():
    if hashlib.sha256(candidate.read_bytes()).hexdigest() != listed[relative]:
        fail('receipt SHA256SUMS digest mismatch')
