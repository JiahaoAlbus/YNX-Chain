import { registerRootComponent } from "expo";
import App from "./src/VeilSocialApp";
// The normal product uses only the new-core root. No legacy/QA root fallback.
registerRootComponent(App);
