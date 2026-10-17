import { importMobileMnemonic, type MnemonicAccountMaterial, type MnemonicWordCount } from "../security/mnemonicAccount";

/** Local short-lived numbered-grid state. Never persist, log or public-export. */
export class MnemonicInputController {
  private count: MnemonicWordCount = 12;
  private words: string[] = Array(12).fill("");
  private shown = false;
  private revision = 0;
  private open = false;
  begin(wordCount: MnemonicWordCount = 12): void {
    this.checkCount(wordCount); this.clear(); this.count = wordCount;
    this.words = Array(wordCount).fill(""); this.open = true;
  }
  clear(): void { this.words.fill(""); this.words = Array(this.count).fill(""); this.shown = false; this.open = false; this.revision++; }
  select(wordCount: MnemonicWordCount): void { this.checkCount(wordCount); if (!this.open) throw Error("Mnemonic input is closed"); if (wordCount !== this.count) this.begin(wordCount); }
  setWord(index: number, value: string): void {
    if (!this.open || !Number.isSafeInteger(index) || index < 0 || index >= this.count || typeof value !== "string" || value.length > 512) throw Error("Invalid recovery word input");
    const normalized = value.normalize("NFKD").trim();
    if (/\s/u.test(normalized)) {
      const pasted = normalized.split(/\s+/u);
      if (pasted.length !== this.count || pasted.some(word => !/^[a-z]+$/.test(word))) throw Error("Pasted phrase must match the selected 12 or 24 words; nothing was truncated");
      this.words = pasted;
    } else {
      if (normalized !== "" && !/^[a-z]+$/.test(normalized)) throw Error("Use English recovery words without numbers or punctuation");
      this.words[index] = normalized;
    }
    this.revision++;
  }
  toggleVisibility(): void { if (!this.open) throw Error("Mnemonic input is closed"); this.shown = !this.shown; }
  /** Rendering-only local snapshot; screen lifecycle owner must clear on lock. */
  view(): Readonly<{wordCount:MnemonicWordCount;words:readonly string[];visible:boolean;complete:boolean}> {
    return Object.freeze({wordCount:this.count,words:Object.freeze([...this.words]),visible:this.shown,complete:this.open&&this.words.every(Boolean)});
  }
  review(): Readonly<{material:MnemonicAccountMaterial;assertCurrent:()=>void}> {
    if (!this.open || this.words.some(word => !word)) throw Error("Fill every numbered recovery word");
    const revision=this.revision;
    const assertCurrent=()=>{if(!this.open||this.revision!==revision)throw Error("Recovery input changed or was closed; review it again");};
    return Object.freeze({material:importMobileMnemonic(this.words.join(" "),"",assertCurrent),assertCurrent});
  }
  private checkCount(value: number): asserts value is MnemonicWordCount { if (value !== 12 && value !== 24) throw Error("Choose 12 or 24 recovery words"); }
}
