import type { SoliditySnapshot } from './soliditySnapshot';
export type CompilerDiagnostic = { severity: string; message: string; formattedMessage?: string; errorCode?: string; sourceLocation?: { file: string; start: number; end: number } };
export function solidityDiagnosticsBundle(snapshot: SoliditySnapshot, diagnostics: CompilerDiagnostic[]) {
  const located = diagnostics.filter(item => item.sourceLocation && Object.hasOwn(snapshot.sources, item.sourceLocation.file));
  if (located.length > 256 || located.some(item => new TextEncoder().encode(item.message).length > 8192)) throw Error('The source diagnostics exceed the editor transfer limit. Read the complete compiler evidence below.');
  return { protocol: 'ynx-solidity-diagnostics/v1', snapshot, diagnostics: located.map(item => ({ file: item.sourceLocation!.file, start: item.sourceLocation!.start, end: item.sourceLocation!.end, severity: item.severity, message: item.message, code: item.errorCode || '' })) };
}
