import { NativeIDEPanel } from './NativeIDEPanel';
const preserveGuestOwnership = () => {};

export function NativeIDEHome() {
  return <div className="native-home">
    <header className="native-home-header"><a href="/projects" aria-label="YNX Developer home"><img src="/brand/ynx-logo.png" alt="" /><strong>YNX Developer</strong></a><a href="/guest-workspace">Guest text workspace</a></header>
    <main className="native-home-main">
      <div className="native-home-intro"><p className="edition">YNX TESTNET</p><h1>Your development workspace</h1><p>Open your Wallet projects in the full editor, with a persistent workspace, terminal and YNX development tools.</p></div>
      <div className="native-home-projects"><NativeIDEPanel projectId="wallet-projects" projectName="Your projects" revision={0} admitted={false} guestProjectAvailable={false} onOwnershipChange={preserveGuestOwnership} /></div>
      <p className="native-home-guest">Have a saved guest project? <a href="/guest-workspace">Open the guest text workspace</a> to recover or save it, then review a copy to your Wallet account.</p>
    </main>
  </div>;
}
