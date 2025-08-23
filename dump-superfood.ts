import { join } from "path";
import { extractStructuredText } from "./app/services/pdfParsing.server";

async function main() {
  const pdfPath = join(process.cwd(), "Ingredient Superfood.pdf");
  console.log("Dumping Ingredient Superfood structured text:", pdfPath);
  const res = await extractStructuredText(pdfPath);
  if (!res.success || !res.textLines) {
    console.error("Failed:", res.error);
    process.exit(1);
  }
  const lines = res.textLines;
  console.log(`Total lines: ${lines.length}`);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] as any;
    const items = (ln.items || [])
      .sort((a: any, b: any) => a.x - b.x)
      .map((it: any) => `${it.x.toFixed(2)}:${(it.text || "").trim()}`)
      .join(" | ");
    console.log(`[${i}] y=${ln.yPosition.toFixed(2)} :: ${ln.text}`);
    console.log(`    tokens: ${items}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
