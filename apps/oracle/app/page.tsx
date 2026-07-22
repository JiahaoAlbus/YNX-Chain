import type { Metadata } from "next";
import OracleConsole from "./oracle-console";

export const metadata: Metadata = {
  title: "YNX Oracle | Verifiable market data",
  description: "Inspect YNX Oracle health, versions, price quality, provider coverage, and strict consumer requirements.",
  alternates: { canonical: "/oracle" },
};

export default function Home() {
  return <OracleConsole />;
}
