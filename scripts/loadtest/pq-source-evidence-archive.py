"""Bounded readback of already collected immutable public CI archive bytes."""
import hashlib
import io
import re
import stat
import zipfile

def read_original_archive(raw, *, expected_sha256, expected_members, member_limit=32*1024*1024, total_limit=128*1024*1024):
    # Source, run, job and official artifact ID must be checked by the caller
    # against owner-frozen provenance before invoking this data-only helper.
    if (type(raw) is not bytes or len(raw)>128*1024*1024 or type(expected_sha256) is not str
        or not re.fullmatch(r'[0-9a-f]{64}',expected_sha256) or hashlib.sha256(raw).hexdigest()!=expected_sha256
        or type(expected_members) is not dict or not expected_members
        or type(member_limit) is not int or member_limit<=0 or type(total_limit) is not int or total_limit<=0):
        raise ValueError('invalid frozen original archive')
    for name,digest in expected_members.items():
        if (type(name) is not str or not re.fullmatch(r'[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',name)
            or any(part in ('.','..') for part in name.split('/')) or type(digest) is not str
            or not re.fullmatch(r'[0-9a-f]{64}',digest)):
            raise ValueError('invalid frozen archive member')
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries=archive.infolist()
            if len(entries)!=len(expected_members) or {x.filename for x in entries}!=set(expected_members):
                raise ValueError('original archive inventory differs')
            result={};total=0
            for entry in entries:
                mode=(entry.external_attr>>16)&0xffff
                if (entry.is_dir() or entry.flag_bits&1 or entry.file_size>member_limit
                    or stat.S_IFMT(mode) not in (0,stat.S_IFREG)):
                    raise ValueError('unsafe original archive member')
                total+=entry.file_size
                if total>total_limit: raise ValueError('original archive aggregate exceeds bound')
                with archive.open(entry) as source:
                    value=source.read(member_limit+1)
                if len(value)!=entry.file_size or hashlib.sha256(value).hexdigest()!=expected_members[entry.filename]:
                    raise ValueError('original archive member digest differs')
                result[entry.filename]=value
            return result
    except (zipfile.BadZipFile,RuntimeError,EOFError,OSError) as exc:
        raise ValueError('unreadable original archive') from exc
