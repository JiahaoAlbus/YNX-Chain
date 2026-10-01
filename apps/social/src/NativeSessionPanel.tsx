import { useEffect, useState } from "react";
import { AppState, Linking, Pressable, Text, View } from "react-native";
import { nativeSocialSession } from "./nativeSessionRuntime";
import type { NativeSessionView } from "./nativeSessionController";

export function NativeSessionPanel({onChatReady}:{onChatReady?:(account:string)=>Promise<void>}) {
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
      const chat = nativeSocialSession("chat");
      const stopIdentity=client.subscribe(value => { if (live&&chat.current.status==="guest") setState(value); });
      const stopChat=chat.subscribe(value=>{if(live&&value.status!=="guest")setState(value)});
      stop=()=>{stopIdentity();stopChat()};
      const acceptChat=async()=>{const value=await chat.restore();if(value.status==="connected"&&value.account&&onChatReady)await onChatReady(value.account)};
      void client.restore().catch(() => { if (live) setError("Wallet restoration needs an explicit retry."); });
      void acceptChat().catch(()=>{if(live)setError("Saved chat permission needs an explicit retry.")});
      const handle=async(url:string)=>{await Promise.all([chat.restore(),client.restore()]);await (chat.current.status==="connecting"?chat:client).handleReturn(url);await acceptChat()};
      const urls = Linking.addEventListener("url", ({ url }) => { void perform(() => handle(url)); });
      const app = AppState.addEventListener("change", next => { if (next === "active") void perform(acceptChat); });
      void Linking.getInitialURL().then(url => { if (live && url) void perform(() => handle(url)); });
      return () => { live = false; stop(); urls.remove(); app.remove(); };
    } catch { setError("Native protected storage is required to link a Wallet."); }
    return () => { live = false; stop(); };
  }, [onChatReady]);
  const button = (label: string, action: () => Promise<unknown>) => (
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => void perform(action)} style={{ padding: 13, borderRadius: 12, backgroundColor: "#002FA7", opacity: busy ? 0.5 : 1, marginTop: 10 }}>
      <Text style={{ color: "white", fontWeight: "700", textAlign: "center" }}>{label}</Text>
    </Pressable>
  );
  return <View style={{ alignSelf: "stretch", marginTop: 12 }}>
    <Text accessibilityLiveRegion="polite" style={{ color: "#475467", textAlign: "center" }}>{state.message}</Text>
    {state.account ? <Text selectable style={{ color: "#101828", marginTop: 8 }}>{state.account}</Text> : null}
    {state.status === "connected" ? <Text style={{ color: "#475467", marginTop: 8 }}>Identity linked. Encrypted messaging requires a separate permission and verified Social device registration.</Text> : button("Sign in with YNX Wallet", () => nativeSocialSession().begin())}
    {state.canOpen ? button("Open Wallet request", () => (nativeSocialSession("chat").current.canOpen?nativeSocialSession("chat"):nativeSocialSession()).open()) : null}
    {button("Authorize profile, contacts and encrypted chat", () => nativeSocialSession("chat").begin())}
    {button("Retry saved connection", async () => {const chat=await nativeSocialSession("chat").restore();if(chat.status==="connected"&&chat.account&&onChatReady)await onChatReady(chat.account);else await nativeSocialSession().restore()})}
    {state.status !== "guest" ? button("Disconnect Wallet identity and chat", async () => {await nativeSocialSession("chat").disconnect();await nativeSocialSession().disconnect()}) : null}
    {error ? <Text accessibilityRole="alert" style={{ color: "#B42318", marginTop: 10 }}>{error}</Text> : null}
  </View>;
}
