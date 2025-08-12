import PDFParser from "pdf2json";
import { join } from "path";

// Types for parsed invoice data
export interface ParsedInvoiceData {
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
  lineItems: {
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  rawText?: string[]; // For debugging
}

export interface PdfExtractionResult {
  success: boolean;
  data?: ParsedInvoiceData;
  error?: string;
  warnings?: string[];
}

// Extract structured text from PDF using pdf2json
export async function extractStructuredText(pdfFilePath: string): Promise<{
  success: boolean;
  textLines?: Array<{
    yPosition: number;
    text: string;
    items: Array<{
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>;
  error?: string;
}> {
  return new Promise((resolve) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on("pdfParser_dataError", (errData) => {
      console.error("PDF Parser Error:", errData.parserError);
      resolve({ 
        success: false, 
        error: errData.parserError?.toString() || "PDF parsing failed" 
      });
    });
    
    pdfParser.on("pdfParser_dataReady", (pdfData) => {
      try {
        const allTexts: Array<{
          x: number;
          y: number;
          text: string;
          fontSize?: number;
          page: number;
        }> = [];
        
        // Extract all text elements with positions
        pdfData.Pages.forEach((page, pageIndex) => {
          if (page.Texts) {
            page.Texts.forEach((textBlock) => {
              if (textBlock.R) {
                textBlock.R.forEach((run) => {
                  const decodedText = decodeURIComponent(run.T);
                  if (decodedText.trim()) {
                    allTexts.push({
                      x: textBlock.x,
                      y: textBlock.y,
                      text: decodedText,
                      fontSize: run.TS ? run.TS[1] : undefined,
                      page: pageIndex + 1
                    });
                  }
                });
              }
            });
          }
        });
        
        // Group text by Y coordinate (lines)
        const tolerance = 0.5;
        const lineGroups: { [key: number]: typeof allTexts } = {};
        
        allTexts.forEach(item => {
          const roundedY = Math.round(item.y / tolerance) * tolerance;
          if (!lineGroups[roundedY]) {
            lineGroups[roundedY] = [];
          }
          lineGroups[roundedY].push(item);
        });
        
        // Convert to sorted lines
        const textLines = Object.keys(lineGroups)
          .map(y => ({
            yPosition: parseFloat(y),
            items: lineGroups[parseFloat(y)].sort((a, b) => a.x - b.x),
            text: lineGroups[parseFloat(y)]
              .sort((a, b) => a.x - b.x)
              .map(t => t.text)
              .join(' ')
              .trim()
          }))
          .filter(line => line.text.length > 0)
          .sort((a, b) => a.yPosition - b.yPosition);
        
        resolve({
          success: true,
          textLines
        });
        
      } catch (error) {
        console.error("Error processing PDF data:", error);
        resolve({ 
          success: false, 
          error: error instanceof Error ? error.message : "Failed to process PDF data" 
        });
      }
    });
    
    pdfParser.loadPDF(pdfFilePath);
  });
}

// Main parsing function that delegates to supplier-specific parsers
export async function parseInvoiceFromPdf(
  pdfFilePath: string, 
  supplierName: string
): Promise<PdfExtractionResult> {
  try {
    // Extract structured text first
    const extractionResult = await extractStructuredText(pdfFilePath);
    
    if (!extractionResult.success || !extractionResult.textLines) {
      return {
        success: false,
        error: extractionResult.error || "Failed to extract text from PDF"
      };
    }
    
    // Select parser based on supplier
    const parser = selectParser(supplierName);
    
    // Parse with selected strategy
    const parseResult = await parser.parse(extractionResult.textLines);
    
    return parseResult;
    
  } catch (error) {
    console.error("Error parsing invoice PDF:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown parsing error"
    };
  }
}

// Parser interface for supplier-specific implementations
export interface InvoiceParser {
  parse(textLines: Array<{
    yPosition: number;
    text: string;
    items: Array<{
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>): Promise<PdfExtractionResult>;
}

// Parser selection logic
function selectParser(supplierName: string): InvoiceParser {
  const normalizedName = supplierName.toLowerCase().trim();
  
  // Check for known suppliers
  if (normalizedName.includes('yamamoto') || normalizedName.includes('iaf')) {
    return new YamamotoParser();
  }
  
  if (normalizedName.includes('bolero')) {
    return new BoleroParser();
  }
  
  // Default to generic parser
  return new GenericParser();
}

// Yamamoto/IAF Network parser (based on our test data)
class YamamotoParser implements InvoiceParser {
  async parse(textLines: Array<{
    yPosition: number;
    text: string;
    items: Array<{
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>): Promise<PdfExtractionResult> {
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: {
          currency: "EUR",
          shippingFee: 0
        },
        lineItems: []
      };
      
      let parsingLineItems = false;
      
      for (const line of textLines) {
        const text = line.text;
        
        // Extract invoice date (format: DD/MM/YYYY)
        const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (dateMatch && !result.invoiceMetadata.invoiceDate) {
          const [, day, month, year] = dateMatch;
          result.invoiceMetadata.invoiceDate = new Date(`${year}-${month}-${day}`);
        }
        
        // Extract invoice number
        const invoiceMatch = text.match(/Invoice\s+(\w+)/i);
        if (invoiceMatch) {
          result.invoiceMetadata.invoiceNumber = invoiceMatch[1];
        }
        
        // Detect table headers to start parsing line items
        if (text.includes('ITEM') && text.includes('DESCRIPTION') && text.includes('UNIT PRICE')) {
          parsingLineItems = true;
          continue;
        }
        
        // Stop parsing line items when we hit totals or footer
        if (text.includes('Subtotal') || text.includes('Total') || text.includes('VAT')) {
          parsingLineItems = false;
          
          // Try to extract shipping fee
          const shippingMatch = text.match(/shipping|spedizione|transport/i);
          if (shippingMatch) {
            const priceMatch = text.match(/(\d+[.,]\d{2})/);
            if (priceMatch) {
              result.invoiceMetadata.shippingFee = parseFloat(priceMatch[1].replace(',', '.'));
            }
          }
          continue;
        }
        
        // Parse line items (look for any product codes - IAF, FITT, etc.)
        if (parsingLineItems) {
          const lineItem = this.parseYamamotoLineItem(text);
          if (lineItem) {
            result.lineItems.push(lineItem);
          }
        }
      }
      
      return {
        success: true,
        data: result,
        warnings: result.lineItems.length === 0 ? ['No line items found'] : undefined
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to parse Yamamoto invoice"
      };
    }
  }
  
  private parseYamamotoLineItem(text: string): {
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  } | null {
    // Example lines: 
    // "IAF00068182 YAMAMOTO NUTRITION Glutamine POWDER  600 grammes -  PZ 15,00 17,09 256,35 NI41"
    // "FITT003  Sconto extra  PZ 1,00 -0,31 -0,31 ESC15"
    // "Protein Powder 25kg  PZ 5,00 12,50 62,50" (no SKU case)
    
    // Strategy 1: Try to extract SKU at start of line
    let sku = '';
    let description = '';
    
    const skuMatch = text.match(/^([A-Z0-9]+)\s+(.+?)\s+PZ/);
    if (skuMatch) {
      // Has SKU: "IAF00068182 YAMAMOTO NUTRITION Glutamine POWDER PZ ..."
      sku = skuMatch[1];
      description = skuMatch[2].trim();
    } else {
      // Strategy 2: No SKU, use description as SKU
      const noSkuMatch = text.match(/^(.+?)\s+PZ/);
      if (noSkuMatch) {
        description = noSkuMatch[1].trim();
        // Generate SKU from description (first 10 chars + hash)
        sku = this.generateSkuFromDescription(description);
      } else {
        return null; // Can't parse this line
      }
    }
    
    // Extract quantity (PZ followed by number)
    const quantityMatch = text.match(/PZ\s+(\d+[.,]\d+|\d+)/);
    if (!quantityMatch) return null;
    
    // Extract prices (look for decimal numbers, including negative ones)
    const priceMatches = text.match(/(-?\d+[.,]\d{2})/g);
    if (!priceMatches || priceMatches.length < 2) return null;
    
    // Last price is usually total, second to last is unit price
    const unitPrice = parseFloat(priceMatches[priceMatches.length - 2].replace(',', '.'));
    const total = parseFloat(priceMatches[priceMatches.length - 1].replace(',', '.'));
    const quantity = parseFloat(quantityMatch[1].replace(',', '.'));
    
    return {
      supplierSku: sku,
      description: description || undefined,
      quantity,
      unitPrice,
      total
    };
  }
  
  // Generate SKU when product doesn't have one
  private generateSkuFromDescription(description: string): string {
    // Take first 10 characters, remove spaces, add simple hash
    const clean = description.replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 10);
    const hash = Math.abs(this.simpleHash(description)).toString(36).substring(0, 3);
    return `GEN_${clean}_${hash}`;
  }
  
  // Simple hash function for generating consistent SKUs
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }
}

// Placeholder for Bolero parser
class BoleroParser implements InvoiceParser {
  async parse(textLines: Array<{
    yPosition: number;
    text: string;
    items: Array<{
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>): Promise<PdfExtractionResult> {
    // TODO: Implement Bolero-specific parsing logic
    return {
      success: false,
      error: "Bolero parser not yet implemented"
    };
  }
}

// Generic fallback parser
class GenericParser implements InvoiceParser {
  async parse(textLines: Array<{
    yPosition: number;
    text: string;
    items: Array<{
      x: number;
      y: number;
      text: string;
      fontSize?: number;
    }>;
  }>): Promise<PdfExtractionResult> {
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: {
          currency: "EUR",
          shippingFee: 0
        },
        lineItems: [],
        rawText: textLines.map(line => line.text)
      };
      
      // Basic date extraction
      for (const line of textLines) {
        const dateMatch = line.text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
        if (dateMatch && !result.invoiceMetadata.invoiceDate) {
          const [, day, month, year] = dateMatch;
          result.invoiceMetadata.invoiceDate = new Date(`${year}-${month}-${day}`);
          break;
        }
      }
      
      return {
        success: true,
        data: result,
        warnings: ['Generic parser used - manual review recommended']
      };
      
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Generic parsing failed"
      };
    }
  }
}
