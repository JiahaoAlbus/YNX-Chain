import { registerRootComponent } from "expo";
import App from "./App";
import { withSocialBrand } from "./src/BrandRoot";
registerRootComponent(withSocialBrand(App));
