import { registerRootComponent } from "expo";
import App from "./App";
// App owns the product header and safe areas; isolated QA roots are not imported.
registerRootComponent(App);
