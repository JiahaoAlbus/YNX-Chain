# P0-109 DEX canonical authorization handoff

DEX consumes Wallet/Auth source `4679de8e8d0675e2013254c92ff1935191f87c21` through the accepted controlled-frame safe launcher. It creates a complete canonical v2 request, saves it to the required protected capability before launch, and parses callbacks against the same request. Bare/manual URI construction and top-level custom-scheme navigation are removed. MetaMask remains an independent EIP-1193 route.

The DEX browser has no product-proven protected device/storage adapter at this checkpoint, so authorization, Product Session, Swap, liquidity, token approval and action callbacks fail closed. Unit tests pass 24/24, scanner passes 13 files, and the production build passes. Browser E2E has 4/8 blocked by unavailable authoritative snapshot proxy `127.0.0.1:6436`; this is not visible Wallet or transaction evidence.

All public, installed, browser-visible, ComputerControl, approval/callback, Product Session, swap/liquidity/approval, signing and deployment states remain false. Rollback is a normal revert of this checkpoint only.
