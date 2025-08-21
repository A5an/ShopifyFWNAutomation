import { join } from "path";
import { extractStructuredText } from "./app/services/pdfParsing.server";

async function main() {
  const pdfPath = join(process.cwd(), "Bolero (1).pdf");
  const res = await extractStructuredText(pdfPath);
  if (!res.success || !res.textLines) {
    console.error("Failed to extract text:", res.error);
    process.exit(1);
  }
  console.log(`Extracted ${res.textLines.length} lines`);
  for (const line of res.textLines.slice(0, 120)) {
    console.log(`Y=${line.yPosition.toFixed(2)} | ${line.text}`);
    const items = line.items
      .map((i) => `${i.x.toFixed(2)}:"${i.text}"`)
      .join("  ");
    console.log(`  -> ${items}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
