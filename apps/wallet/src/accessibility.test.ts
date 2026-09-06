import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { COLORS, HIGH_CONTRAST_LIGHT } from "./theme";

test("critical Wallet controls expose accessibility roles, names and state",async()=>{
  const source=await readFile(new URL("../App.tsx",import.meta.url),"utf8");
  const i18n=await readFile(new URL("./i18n/i18n.ts",import.meta.url),"utf8");
  for(const label of ["Lock Wallet","Switch Wallet account","YNX Wallet recovery key","Approve","Reject","AI security explanation","Remove local account"])assert.ok(`${source}\n${i18n}`.includes(label),`missing accessibility contract for ${label}`);
  assert.ok(source.includes('accessibilityState={{expanded:accountsOpen}}'));
  assert.ok(source.includes('accessibilityState={{disabled}}'));
  assert.ok(source.includes('accessibilityRole="radio"'));
  for(const contract of ["Klein blue and white appearance","isReduceMotionEnabled","reduceMotionChanged","isHighTextContrastEnabled","Text follows the device font scale","MODAL_ANIMATION"])assert.ok(source.includes(contract),`missing adaptive accessibility contract ${contract}`);
});

function luminance(hex:string){const channels=hex.slice(1).match(/../g)!.map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return channels[0]!*.2126+channels[1]!*.7152+channels[2]!*.0722}
function contrast(a:string,b:string){const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(values[0]!+.05)/(values[1]!+.05)}

test("Klein blue and white retain readable normal and high contrast content",()=>{
  for(const palette of [COLORS,HIGH_CONTRAST_LIGHT]){
    assert.equal(palette.blue,"#002FA7");assert.equal(palette.white,"#FFFFFF");
    assert.ok(contrast(palette.white,palette.blue)>=7,"white balance and button text needs strong contrast on Klein blue");
    for(const foreground of [palette.ink,palette.muted,palette.danger,palette.success,palette.warning])assert.ok(contrast(foreground,palette.white)>=4.5,`${foreground} must remain readable on white`);
    assert.ok(contrast(palette.muted,palette.surface)>=4.5,"secondary card copy must remain readable");
  }
});

test("native appearance and app balance surfaces keep the blue-white palette when the OS is dark",async()=>{
  const read=(path:string)=>readFile(new URL(path,import.meta.url),"utf8");
  const [source,config,android,colors,ios]=await Promise.all([read("../App.tsx"),read("../app.json"),read("../android/app/src/main/res/values/styles.xml"),read("../android/app/src/main/res/values/colors.xml"),read("../ios/YNXWallet/Info.plist")]);
  assert.equal(JSON.parse(config).expo.userInterfaceStyle,"light");
  assert.match(android,/Theme\.AppCompat\.Light\.NoActionBar/);assert.match(android,/name="android:forceDarkAllowed">false/);
  assert.match(colors,/name="colorPrimary">#002FA7/);assert.match(ios,/<key>UIUserInterfaceStyle<\/key>\s*<string>Light<\/string>/);
  assert.equal(source.includes("useColorScheme"),false);assert.equal(source.includes("DARK_COLORS"),false);
  assert.match(source,/balanceCard:\{backgroundColor:ACTIVE_COLORS\.blue/);
  assert.match(source,/balanceLabel:\{color:ACTIVE_COLORS\.white/);assert.match(source,/balanceMeta:\{color:ACTIVE_COLORS\.white/);
  assert.match(source,/<StatusBar style="dark"\/>/);
});
