# YNX Wallet CLI testnet candidates

Source identity: `68b68bbcbc7a301c113db82a2183537191976ff0`

These are engineering candidates for YNX Testnet 6423. They are not production-signed, notarized, hosted, or store-released. Verify the matching SHA-256 in `SHA256SUMS` before extraction.

## macOS 12+

Select `darwin-arm64` for Apple silicon or `darwin-amd64` for Intel. The arm64 binary is ad-hoc linker signed; the amd64 binary is unsigned.

```sh
gzip -dc ynx-wallet-cli-darwin-<arch>.gz > ynx-wallet-cli
chmod 0755 ynx-wallet-cli
./ynx-wallet-cli version
./ynx-wallet-cli validate-config
```

Uninstall with `rm ./ynx-wallet-cli` and confirm the selected install directory is empty.

## Linux kernel 3.2+

Select `linux-arm64` or `linux-amd64`. Both binaries are unsigned.

```sh
gzip -dc ynx-wallet-cli-linux-<arch>.gz > ynx-wallet-cli
chmod 0755 ynx-wallet-cli
./ynx-wallet-cli version
./ynx-wallet-cli validate-config
```

Uninstall with `rm ./ynx-wallet-cli` and check the selected install directory for residue.

## Windows 10 / Windows Server 2016+

Select `windows-arm64` or `windows-amd64`. Both PE files are unsigned and have Authenticode status `NotSigned`.

```powershell
$input = [IO.File]::OpenRead('ynx-wallet-cli-windows-<arch>.exe.gz')
$gzip = [IO.Compression.GZipStream]::new($input,[IO.Compression.CompressionMode]::Decompress)
$output = [IO.File]::Create('ynx-wallet-cli.exe')
$gzip.CopyTo($output); $output.Dispose(); $gzip.Dispose(); $input.Dispose()
.\ynx-wallet-cli.exe version
.\ynx-wallet-cli.exe validate-config
```

Uninstall with `Remove-Item .\ynx-wallet-cli.exe` and verify `Test-Path .\ynx-wallet-cli.exe` returns `False`.

## Offline chain acceptance

`validate-config` must report `ynx_6423-1`, decimal `6423`, EVM `0x1917`, and `YNXT`. The command `chain-status --chain-id 9102` must fail closed with exit code 78, error `WRONG_CHAIN`, and remediation `USE_YNX_TESTNET_6423`. These checks do not prove a live RPC connection, account, signature, or transaction.
