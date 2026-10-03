import { registerRootComponent } from "expo";
import App from "./App";
import React from "react";
import {CardTypographyProvider} from "./src/cardTypography";
function CardRoot(){return React.createElement(CardTypographyProvider,null,React.createElement(App));}
registerRootComponent(CardRoot);
