import { useEffect, useState } from "react";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import { nativeSocialSession } from "./nativeSessionRuntime";
import type { NativeSessionView } from "./nativeSessionController";

export function NativeSessionPanel() {
  const [state, setState] = useState<NativeSessionView>({ status: "guest", message: "Wallet identity is not linked.", scopes: [], canOpen: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); }
    catch { setError("Wallet connection is unavailable. Your protected request is retained; retry when ready."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let live = true;
    let stop = () => {};
    try {
      const client = nativeSocialSession();
      stop = client.subscribe(value => { if (live) setState(value); });
      void client.restore().catch(() => { if (live) setError("Wallet restoration needs an explicit retry."); });
      const urls = Linking.addEventListener("url", ({ url }) => { void perform(() => client.handleReturn(url)); });
      const app = AppState.addEventListener("change", next => { if (next === "active") void client.restore().catch(() => { if (live) setError("Wallet restoration needs an explicit retry."); }); });
      void Linking.getInitialURL().then(url => { if (live && url) void perform(() => client.handleReturn(url)); });
      return () => { live = false; stop(); urls.remove(); app.remove(); };
    } catch { setError("Native protected storage is required to link a Wallet."); }
    return () => { live = false; stop(); };
  }, []);
  const button = (label: string, action: () => Promise<unknown>) => (
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void perform(action)} style={{ padding: 13, borderRadius: 12, backgroundColor: "#002FA7", opacity: busy ? 0.5 : 1, marginTop: 10 }}>
      <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
  return <View style={{ alignSelf: "stretch", marginTop: 12 }}>
    <Text accessibilityLiveRegion="polite" style={{ color: "#475467", textAlign: "center" }}>{state.message}</Text>
    {state.account ? <Text selectable style={{ color: "#101828", marginTop: 8 }}>{state.account}</Text> : null}
    {state.status === "connected" ? <Text style={{ color: "#475467", marginTop: 8 }}>Identity linked. Encrypted messaging requires a separate permission and verified Social device registration.</Text> : button("Sign in with YNX Wallet", () => nativeSocialSession().begin())}
    {state.canOpen ? button("Open Wallet request", () => nativeSocialSession().open()) : null}
    {button("Retry saved connection", () => nativeSocialSession().restore())}
    {state.status !== "guest" ? button("Disconnect Wallet identity", () => nativeSocialSession().disconnect()) : null}
    {error ? <Text accessibilityRole="alert" style={{ color: "#B42318", marginTop: 10 }}>{error}</Text> : null}
  </View>;
}
