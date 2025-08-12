import { parseInvoiceFromPdf } from "./app/services/pdfParsing.server.js";
import { join } from "path";

async function testParsingIntegration() {
  console.log("🧪 Testing PDF Parsing Integration");
  console.log("================================");
  
  const pdfPath = join(process.cwd(), 'Yamamoto.pdf');
  
  try {
    console.log(`📄 Testing with: ${pdfPath}`);
    
    // Test with Yamamoto supplier (should use YamamotoParser)
    const result = await parseInvoiceFromPdf(pdfPath, "IAF Network");
    
    console.log("\n📊 Parse Result:");
    console.log(`Success: ${result.success}`);
    
    if (result.success && result.data) {
      console.log(`\n📝 Invoice Metadata:`);
      console.log(`  Invoice Number: ${result.data.invoiceMetadata.invoiceNumber || 'Not found'}`);
      console.log(`  Invoice Date: ${result.data.invoiceMetadata.invoiceDate || 'Not found'}`);
      console.log(`  Currency: ${result.data.invoiceMetadata.currency}`);
      console.log(`  Shipping Fee: €${result.data.invoiceMetadata.shippingFee}`);
      
      console.log(`\n🛍️  Line Items (${result.data.lineItems.length} found):`);
      result.data.lineItems.forEach((item, index) => {
        console.log(`  ${index + 1}. SKU: ${item.supplierSku}`);
        console.log(`     Description: ${item.description || 'N/A'}`);
        console.log(`     Quantity: ${item.quantity}`);
        console.log(`     Unit Price: €${item.unitPrice.toFixed(2)}`);
        console.log(`     Total: €${item.total.toFixed(2)}`);
        console.log("");
      });
      
      if (result.warnings && result.warnings.length > 0) {
        console.log(`⚠️  Warnings:`);
        result.warnings.forEach(warning => console.log(`  - ${warning}`));
      }
      
    } else {
      console.log(`❌ Error: ${result.error}`);
    }
    
    // Test with unknown supplier (should use GenericParser)
    console.log("\n" + "=".repeat(50));
    console.log("🧪 Testing with Unknown Supplier (Generic Parser)");
    
    const genericResult = await parseInvoiceFromPdf(pdfPath, "Unknown Supplier");
    
    console.log(`Success: ${genericResult.success}`);
    if (genericResult.success && genericResult.data) {
      console.log(`Line Items: ${genericResult.data.lineItems.length}`);
      console.log(`Date Found: ${!!genericResult.data.invoiceMetadata.invoiceDate}`);
      
      if (genericResult.warnings) {
        console.log(`Warnings: ${genericResult.warnings.join(', ')}`);
      }
    }
    
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

testParsingIntegration().catch(console.error);
