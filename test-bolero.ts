import { join } from "path";
import { parseInvoiceFromPdf } from "./app/services/pdfParsing.server";

async function main() {
  const pdfPath = join(process.cwd(), "Bolero (1).pdf");
  console.log(`Parsing Bolero invoice: ${pdfPath}`);

  const result = await parseInvoiceFromPdf(pdfPath, "Bolero", false);
  console.log("Success:", result.success);
  if (!result.success) {
    console.error("Error:", result.error);
    process.exit(1);
  }
  if (!result.data) {
    console.error("No data returned");
    process.exit(1);
  }
  console.log("Invoice date:", result.data.invoiceMetadata.invoiceDate);
  console.log("Shipping fee:", result.data.invoiceMetadata.shippingFee);
  console.log(`Items (${result.data.lineItems.length}):`);
  for (const item of result.data.lineItems) {
    console.log(
      `- SKU: ${item.supplierSku} | Desc: ${item.description || ""} | Qty: ${item.quantity} | PU: ${item.unitPrice} | Total: ${item.total}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
