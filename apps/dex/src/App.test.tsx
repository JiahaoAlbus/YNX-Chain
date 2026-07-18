import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const json=(value:unknown)=>Promise.resolve({ok:true,json:()=>Promise.resolve(value)}) as Promise<Response>;
describe("YNX DEX product shell",()=>{
 beforeEach(()=>{location.hash="";localStorage.clear();Object.defineProperty(navigator,"onLine",{configurable:true,value:true});vi.stubGlobal("fetch",vi.fn((input:RequestInfo|URL)=>{const path=String(input);if(path.includes("/v1/pools"))return json({items:[],source:"indexed YNX Testnet EVM events"});if(path.includes("/v1/transactions"))return json({items:[],source:"indexed YNX Testnet EVM events"});return json({source:"YNX Testnet EVM events",indexedEvents:0,pools:0,swaps:0,liquidityEvents:0,latestBlock:0})}))});
 afterEach(()=>{cleanup();vi.unstubAllGlobals();document.documentElement.dir="ltr";document.documentElement.lang="en"});
 it("renders truthful empty swap and pool states without fabricated metrics",async()=>{render(<App/>);expect(screen.getByRole("heading",{name:"Swap"})).toBeInTheDocument();await waitFor(()=>expect(screen.getByText("No executable route")).toBeInTheDocument());expect(screen.queryByText(/APY [1-9]/)).not.toBeInTheDocument();const primary=screen.getByRole("complementary",{name:"Primary navigation"});fireEvent.click(within(primary).getByRole("button",{name:"Pools"}));await waitFor(()=>expect(screen.getByText("No verified pools indexed yet")).toBeInTheDocument())});
 it("fails closed when canonical Wallet registry is unavailable",async()=>{render(<App/>);fireEvent.click(screen.getByRole("button",{name:"Connect Wallet"}));expect(await screen.findByRole("dialog",{name:"Connect Wallet"})).toBeInTheDocument();expect(screen.getByText(/registry is not integrated/)).toBeInTheDocument();expect(screen.getByRole("button",{name:"Continue in YNX Wallet"})).toBeDisabled()});
 it("persists Arabic RTL and dark appearance",async()=>{render(<App/>);fireEvent.click(screen.getByRole("button",{name:"Settings"}));fireEvent.change(screen.getByLabelText("Language"),{target:{value:"ar"}});expect(document.documentElement.dir).toBe("rtl");fireEvent.click(screen.getByLabelText("داكن"));expect(document.documentElement.dataset.theme).toBe("dark")});
});
