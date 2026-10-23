# Original Go deployment interoperability input

`pq-contract-deploy-fbec-public.json` is the unchanged original artifact from
Protocol commit `fbecfbefff09d1f20b059fc859cfcdd6affcabde`, workflow 39955891165,
focused job 120421506186, artifact 12503131604. The producer test is
`TestGatewayPQActionFinalityRetainsCompiledContractTransport`.

- Original JSON: 2,314,662 bytes; SHA-256
  `ca39d8b803a118bb468ce2806cf7654ccf120c091c0364f973e859fedeba5982`.
- Original ZIP: 1,088,764 bytes; SHA-256
  `da04d205f067b85154391a90ec6c7daa5834af7c64e68d093ee1b5fe84ec5e54`.
- Member: 58,207 bytes; SHA-256
  `6f29de10adf0d203dee00c5e2dbd8f84ac91b6b44ab8a1fc06ad43b24560f1ff`.
- Five-field transport: 123,189 bytes; SHA-256
  `dcc3882a42e02b4c92affee5175804f22e7ca66dc90e85d203e54f4ad84b73f6`.

Protocol independently read the ZIP and JSON; the SDK download was byte-identical.
The artifact contains public data, N2/index1, Comet index0, fee10, native chain6423,
and the full signed payload including value0. Use its exact source and raw files;
its CI compiler artifacts differ from the earlier local Counter materials.

This is normal handshake/BlockExecutor/Commit test execution with captured GETs.
Prepared POST was not executed. Actual Comet node, independent finality, Native
grant, public BFT and deployed Source qualification are all false. No new keys,
signatures, approvals or POSTs are created by the consumer tests. Deliberately
corrupted public copies are negative tests only. This fixture stays under test/;
it does not change the frozen SDK333 runtime package or the separate auth2 tuple.
