import { parseInvoiceFromPdf } from "./app/services/pdfParsing.server";
import { extractPdfTables } from "./app/services/pythonPdfExtractor.server";
import { join } from "path";

async function testPythonIntegration() {
  console.log("🐍 Testing Python PDF Table Extraction Integration");
  console.log("================================================");
  
  const pdfPath = join(process.cwd(), 'Yamamoto.pdf');
  
  try {
    console.log(`📄 Testing with: ${pdfPath}`);
    
    // Test Python table extraction directly
    console.log("\n1. Testing direct Python table extraction...");
    try {
      const tableResult = await extractPdfTables(pdfPath, 'invoice');
      console.log("✅ Python table extraction successful");
      console.log(`📊 Tables found: ${tableResult.total_found || 0}`);
      
      if (tableResult.tables && tableResult.tables.length > 0) {
        console.log("\n📋 First table preview:");
        const firstTable = tableResult.tables[0];
        console.log(`  Method: ${firstTable.method || 'unknown'}`);
        console.log(`  Page: ${firstTable.page || 'unknown'}`);
        console.log(`  Shape: ${firstTable.shape ? `${firstTable.shape[0]}x${firstTable.shape[1]}` : 'unknown'}`);
        console.log(`  Headers: ${JSON.stringify(firstTable.headers || [])}`);
        
        if (firstTable.data && firstTable.data.length > 0) {
          console.log("  First 3 rows:");
          firstTable.data.slice(0, 3).forEach((row, index) => {
            console.log(`    ${index + 1}: ${JSON.stringify(row)}`);
          });
        }
      }
    } catch (error: any) {
      console.log("❌ Python table extraction failed:", error.message);
    }
    
    // Test with Python parser
    console.log("\n2. Testing PDF parsing with Python parser...");
    try {
      const result = await parseInvoiceFromPdf(pdfPath, "IAF Network", true);
      
      console.log(`\n📊 Parse Result with Python Parser:`);
      console.log(`Success: ${result.success}`);
      
      if (result.success && result.data) {
        console.log(`\n📝 Invoice Metadata:`);
        console.log(`  Invoice Number: ${result.data.invoiceMetadata.invoiceNumber || 'Not found'}`);
        console.log(`  Invoice Date: ${result.data.invoiceMetadata.invoiceDate || 'Not found'}`);
        console.log(`  Currency: ${result.data.invoiceMetadata.currency}`);
        console.log(`  Shipping Fee: €${result.data.invoiceMetadata.shippingFee}`);
        
        console.log(`\n🛍️  Line Items (${result.data.lineItems.length} found):`);
        result.data.lineItems.slice(0, 5).forEach((item, index) => {
          console.log(`  ${index + 1}. SKU: ${item.supplierSku}`);
          console.log(`     Description: ${item.description || 'N/A'}`);
          console.log(`     Quantity: ${item.quantity}`);
          console.log(`     Unit Price: €${item.unitPrice ? item.unitPrice.toFixed(2) : 'N/A'}`);
          console.log(`     Total: €${item.total ? item.total.toFixed(2) : 'N/A'}`);
          console.log("");
        });
        
        if (result.data.lineItems.length > 5) {
          console.log(`  ... and ${result.data.lineItems.length - 5} more items`);
        }
        
        if (result.warnings && result.warnings.length > 0) {
          console.log(`⚠️  Warnings:`);
          result.warnings.forEach(warning => console.log(`  - ${warning}`));
        }
        
      } else {
        console.log(`❌ Error: ${result.error}`);
      }
    } catch (error: any) {
      console.log("❌ Python parsing test failed:", error.message);
    }
    
    // Compare with regular parser
    console.log("\n3. Testing PDF parsing with regular parser for comparison...");
    try {
      const regularResult = await parseInvoiceFromPdf(pdfPath, "IAF Network", false);
      
      console.log(`\n📊 Parse Result with Regular Parser:`);
      console.log(`Success: ${regularResult.success}`);
      
      if (regularResult.success && regularResult.data) {
        console.log(`\n🛍️  Line Items (${regularResult.data.lineItems.length} found):`);
        regularResult.data.lineItems.slice(0, 5).forEach((item, index) => {
          console.log(`  ${index + 1}. SKU: ${item.supplierSku}`);
          console.log(`     Description: ${item.description || 'N/A'}`);
          console.log(`     Quantity: ${item.quantity}`);
          console.log(`     Unit Price: €${item.unitPrice ? item.unitPrice.toFixed(2) : 'N/A'}`);
          console.log(`     Total: €${item.total ? item.total.toFixed(2) : 'N/A'}`);
          console.log("");
        });
      }
    } catch (error: any) {
      console.log("❌ Regular parsing test failed:", error.message);
    }
    
  } catch (error: any) {
    console.error("❌ Test failed:", error);
  }
}

testPythonIntegration().catch(console.error);