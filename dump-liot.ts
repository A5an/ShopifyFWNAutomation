import { join } from "path";
import { extractStructuredText } from "./app/services/pdfParsing.server";

async function main() {
  const pdfPath = join(process.cwd(), "Liot.pdf");
  console.log("Dumping Liot structured text:", pdfPath);
  const res = await extractStructuredText(pdfPath);
  if (!res.success || !res.textLines) {
    console.error("Failed:", res.error);
    process.exit(1);
  }
  const lines = res.textLines;
  console.log(`Total lines: ${lines.length}`);
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i] as any;
    let reconstructedText = "";
    let lastX = -Infinity;
    let lastText = "";
    const sortedItems = [...ln.items].sort((a: any, b: any) => a.x - b.x);
    for (const item of sortedItems) {
      const currentText = (item.text || "").trim();
      if (!currentText) continue;
      if (lastText && item.x - (lastX + lastText.length * 0.1) > 0.5) {
        reconstructedText += " ";
      }
      reconstructedText += currentText;
      lastX = item.x;
      lastText = currentText;
    }
    reconstructedText = reconstructedText.replace(/\s+/g, " ").trim();
    const items = sortedItems
      .map((it: any) => `${it.x.toFixed(2)}:${(it.text || "").trim()}`)
      .join(" | ");
    console.log(`[${i}] y=${ln.yPosition.toFixed(2)} :: ${reconstructedText}`);
    console.log(`    tokens: ${items}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
