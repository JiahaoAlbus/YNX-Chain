import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=(file:string)=>readFileSync(new URL(file,import.meta.url),"utf8");
test("Card Web root is English and disables browser translation until a user selects another locale",()=>{const app=source("../App.tsx"),guest=source("GuestExperience.tsx"),build=source("../scripts/build-web.mjs");assert.match(app,/useState<Locale>\("en"\)/);assert.match(guest,/GuestLocaleContext=createContext<Locale>\("en"\)/);assert.match(build,/name=\\\"google\\\" content=\\\"notranslate\\\"/);assert.match(build,/document\.documentElement\.lang=\\\"en\\\"/);assert.match(build,/setAttribute\(\\\"translate\\\",\\\"no\\\"\)/);assert.match(build,/classList\.add\(\\\"notranslate\\\"\)/);});
