import { join } from "path";
import { extractStructuredText } from "./app/services/pdfParsing.server";

async function main() {
  const pdfPath = join(process.cwd(), "Labz Nutrition.pdf");
  console.log("Dumping Labz Nutrition structured text:", pdfPath);
  const res = await extractStructuredText(pdfPath);
  if (!res.success || !res.textLines) {
    console.error("Failed:", res.error);
    process.exit(1);
  }
  const lines = res.textLines;
  console.log(`Total lines: ${lines.length}`);
  const collapseLine = (ln: any): string => {
    const toks = (ln.items || [])
      .map((it: any) => ({ x: it.x, t: (it.text || "").trim() }))
      .filter((it: any) => it.t.length > 0)
      .sort((a: any, b: any) => a.x - b.x);
    if (!toks.length) return "";
    let out = toks[0].t;
    let prevX = toks[0].x;
    const gapForSpace = 0.35; // tuned for this PDF letter spacing
    for (let i = 1; i < toks.length; i++) {
      const { x, t } = toks[i];
      const gap = x - prevX;
      const noSpaceBefore = /^(,|\.|:|;|%|€|!|\)|\]|\}|-|®)$/;
      const noSpaceAfterPrev = /(^-|\(|\[|\{)$/;
      const shouldSpace = gap > gapForSpace;
      if (shouldSpace) out += " ";
      // Remove extra space around punctuation/hyphen
      if (noSpaceBefore.test(t) && out.endsWith(" ")) out = out.slice(0, -1);
      if (noSpaceAfterPrev.test(out[out.length - 1] || "")) {
        if (out.endsWith(" ")) out = out.slice(0, -1);
      }
      out += t;
      prevX = x;
    }
    // Normalize common patterns
    out = out.replace(/K\s?g/gi, "Kg");
    out = out.replace(/\s+-\s+/g, "-");
    return out.trim();
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] as any;
    const collapsed = collapseLine(ln);
    const items = (ln.items || [])
      .sort((a: any, b: any) => a.x - b.x)
      .map((it: any) => `${it.x.toFixed(2)}:${(it.text || "").trim()}`)
      .join(" | ");
    console.log(`[${i}] y=${ln.yPosition.toFixed(2)} :: ${collapsed}`);
    console.log(`    tokens: ${items}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
