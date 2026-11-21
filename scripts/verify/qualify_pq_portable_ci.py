"""Qualify the original verifier events without granting runtime authority."""

PACKAGE = 'github.com/JiahaoAlbus/YNX-Chain/cmd/ynx-consensus-proof-verify'
REQUIRED = (
    'TestPortableImportLargeMigrationAndExactBound',
    'TestPortableImportMigrationMismatchPreservesPartialWithoutReceipt',
    'TestPortableImportMigrationOriginalReplacementFailsClosed',
    'TestPortableActualWriteAndCloseFailuresPreserveOriginals',
    'TestPortableSpacePreflightAndDurabilityFailuresAreNotSuccess',
    'TestPortableDiagnoseReportsMissingWithoutAuthority',
    'TestPortableCatalogAdmitsOriginal448941MigrationLength',
)


def qualify(events):
    for name in REQUIRED:
        top = [(e.get('Package'), e.get('Action')) for e in events
               if e.get('Test') == name and e.get('Action') in ('run', 'pass', 'fail', 'skip')]
        if top != [(PACKAGE, 'run'), (PACKAGE, 'pass')]:
            raise RuntimeError('portable original test missing, repeated, foreign or skipped: ' + name)
        children = {e.get('Test') for e in events if e.get('Test', '').startswith(name + '/')}
        for child in children:
            actions = [(e.get('Package'), e.get('Action')) for e in events
                       if e.get('Test') == child and e.get('Action') in ('run', 'pass', 'fail', 'skip')]
            if actions != [(PACKAGE, 'run'), (PACKAGE, 'pass')]:
                raise RuntimeError('portable original child incomplete or skipped: ' + child)
    return list(REQUIRED)
