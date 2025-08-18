# PDF Invoice Parsing System

## Overview

This system automatically extracts invoice data from PDF files using `pdf2json` library with supplier-specific parsing strategies. It's designed to handle different invoice formats and integrate seamlessly with the FWN invoice management workflow.

As of recent updates, the system also includes Python-based table extraction for improved accuracy with complex PDF layouts.

## Architecture

```
app/services/
├── pdfParsing.server.ts          # Main parsing orchestrator
├── invoiceProcessing.server.ts   # Business logic & database integration
└── utils/
    └── supplierMapping.server.ts  # SKU mapping utilities
```

## How It Works

### 1. Text Extraction (`extractStructuredText`)

```typescript
const result = await extractStructuredText("path/to/invoice.pdf");
```

**What it does:**
- Uses `pdf2json` to parse PDF into text elements with X,Y coordinates
- Groups text by Y-coordinate to form readable lines
- Returns structured data with positioning information

**Returns:**
```typescript
{
  success: boolean;
  textLines?: Array<{
    yPosition: number;        // Y coordinate on page
    text: string;            // Combined text for the line
    items: Array<{           // Individual text elements
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>;
  error?: string;
}
```

### 2. Supplier-Specific Parsing (`parseInvoiceFromPdf`)

```typescript
const result = await parseInvoiceFromPdf("path/to/invoice.pdf", "Yamamoto");
```

**What it does:**
- Selects appropriate parser based on supplier name
- Parses structured text into invoice data
- Handles different SKU formats and layouts

**Parser Selection Logic:**
```typescript
if (supplierName.includes('yamamoto') || supplierName.includes('iaf')) {
  return new YamamotoParser();
}
if (supplierName.includes('bolero')) {
  return new BoleroParser();
}
// Default fallback
return new GenericParser();
```

**Returns:**
```typescript
{
  success: boolean;
  data?: {
    supplierInfo: {
      name?: string;
      address?: string;
      vatNumber?: string;
    };
    invoiceMetadata: {
      invoiceNumber?: string;
      invoiceDate?: Date;
      currency: string;
      shippingFee: number;
      subtotal?: number;
      total?: number;
    };
    lineItems: Array<{
      supplierSku: string;     // Product code (IAF00068182, FITT003, etc.)
      description?: string;    // Product description from PDF
      quantity: number;        // Quantity ordered
      unitPrice: number;       // Price per unit
      total: number;          // Line total
    }>;
  };
  error?: string;
  warnings?: string[];
}
```

### 3. Python-Based Table Extraction (NEW)

For complex PDF layouts, the system can optionally use Python libraries for better table extraction:

```typescript
// Use Python parser for better table extraction
const result = await parseInvoiceFromPdf("path/to/invoice.pdf", "Yamamoto", true);
```

**What it does:**
- Uses Python libraries (`camelot-py`, `pdfplumber`, `tabula-py`) for superior table extraction
- Falls back to JavaScript parsing if Python extraction fails
- Provides more accurate results for complex table layouts

### 4. Business Logic Integration (`processInvoicePdf`)

```typescript
await processInvoicePdf(invoiceId);
```

**What it does:**
1. Loads invoice from database
2. Parses PDF using appropriate parser
3. Maps supplier SKUs to FWN products via `SupplierSKU` table
4. Distributes shipping costs across all items
5. Updates invoice status and items in database
6. Creates comprehensive logs

**Complete Flow:**
```
Upload PDF → Save to disk → Create Invoice (PROCESSING)
    ↓
Parse PDF → Extract line items → Map SKUs to products
    ↓
Calculate shipping per item → Update database → Set status (PENDING_REVIEW/ERROR)
    ↓
Log everything → Ready for manual review
```

## Yamamoto Parser Details

### Supported Line Formats

**Standard IAF Products:**
```
IAF00068182 YAMAMOTO NUTRITION Glutamine POWDER 600 grammes - PZ 15,00 17,09 256,35 NI41
```

**Special Items (Discounts/Shipping):**
```
FITT003 Sconto extra PZ 1,00 -0,31 -0,31 ESC15
FITT001 Spese di spedizione PZ 1,00 149,53 149,53 NI41
```

**Products Without SKU:**
```
Protein Powder 25kg PZ 5,00 12,50 62,50
```
→ Generates SKU: `GEN_PROTEINPOW_X3K`

### Parsing Logic

1. **Table Detection:** Looks for headers containing "ITEM", "DESCRIPTION", "UNIT PRICE"
2. **Line Item Parsing:** Extracts any line with "PZ" (quantity indicator)
3. **SKU Extraction:** Matches `[A-Z0-9]+` at start of line, or generates from description
4. **Price Extraction:** Finds decimal numbers (`-?\d+[.,]\d{2}`)
5. **Stop Conditions:** Stops at "Subtotal", "Total", or "VAT" lines

## Adding New Supplier Parsers

### 1. Create Parser Class

```typescript
class NewSupplierParser implements InvoiceParser {
  async parse(textLines: TextLine[]): Promise<PdfExtractionResult> {
    // Custom parsing logic for this supplier
    const result: ParsedInvoiceData = {
      supplierInfo: {},
      invoiceMetadata: { currency: "EUR", shippingFee: 0 },
      lineItems: []
    };
    
    // Parse textLines according to supplier's format
    // ...
    
    return { success: true, data: result };
  }
}
```

### 2. Register in Parser Selection

```typescript
function selectParser(supplierName: string): InvoiceParser {
  const normalizedName = supplierName.toLowerCase().trim();
  
  if (normalizedName.includes('new-supplier')) {
    return new NewSupplierParser();
  }
  // ... existing logic
}
```

## Database Integration

### Schema Changes
- Added `description` field to `InvoiceItem` model
- Stores parsed product descriptions from PDF

### SKU Mapping
- Uses `SupplierSKU` table to link supplier codes → FWN products
- Unmapped SKUs stored with `productId: null` for manual review

### Status Flow
```
PROCESSING → PENDING_REVIEW → SUCCESS
           ↘ ERROR (if parsing fails)
```

## Setting Up Python Integration (NEW)

To use the enhanced Python-based PDF table extraction:

### 1. Install Python Dependencies

```bash
# Run the setup script
./setup-python.sh
```

Or manually install:

```bash
pip install -r python/requirements.txt
```

### 2. System Dependencies

Some Python libraries require system-level dependencies:

**macOS:**
```bash
brew install ghostscript
```

**Ubuntu/Debian:**
```bash
sudo apt-get install ghostscript python3-tk
```

**Windows:**
Download and install Ghostscript from https://www.ghostscript.com/download.html

### 3. Testing the Integration

```bash
# Test Python table extraction directly
node test-python-integration.js

# Test complete parsing flow with Python parser
node test-parsing-integration.js
```

## Error Handling

### Common Scenarios

1. **PDF Parsing Failed:** Invalid/corrupted PDF
2. **No Line Items Found:** Table structure not recognized
3. **SKU Mapping Missing:** Supplier code not in `SupplierSKU` table
4. **Invalid Numbers:** Price/quantity parsing failed

### Logging
All operations logged to `LogEntry` table with types:
- `UPLOAD`: File saved successfully
- `PROCESSING`: Parsing started
- `PARSING`: PDF text extraction
- `ERROR`: Any failures with details

## Testing

### Test Individual Parser
```bash
node test-parsing-integration.js
```

### Test Complete Flow
1. Upload PDF via `/app/upload`
2. Select supplier
3. Check `/app/review/{invoiceId}` for results
4. Use "Re-parse" button to retry if needed

## Performance Notes

- **PDF Size Limit:** 10MB (configurable in `fileUpload.server.ts`)
- **Processing Time:** ~2-5 seconds for typical invoices
- **Memory Usage:** Minimal, pdfs processed one at a time
- **Concurrent Uploads:** Handled via invoice status tracking

## Future Enhancements

1. **Background Processing:** Move parsing to queue (Bull/Redis)
2. **ML Enhancement:** Use AI for better table detection
3. **Multi-language:** Support non-English invoices
4. **Batch Processing:** Handle multiple PDFs simultaneously
5. **Auto-mapping:** Suggest SKU mappings based on description similarity
