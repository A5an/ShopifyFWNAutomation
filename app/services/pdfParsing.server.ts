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
        error: errData.parserError?.toString() || "PDF parsing failed",
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
                      page: pageIndex + 1,
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

        allTexts.forEach((item) => {
          const roundedY = Math.round(item.y / tolerance) * tolerance;
          if (!lineGroups[roundedY]) {
            lineGroups[roundedY] = [];
          }
          lineGroups[roundedY].push(item);
        });

        // Convert to sorted lines
        const textLines = Object.keys(lineGroups)
          .map((y) => ({
            yPosition: parseFloat(y),
            items: lineGroups[parseFloat(y)].sort((a, b) => a.x - b.x),
            text: lineGroups[parseFloat(y)]
              .sort((a, b) => a.x - b.x)
              .map((t) => t.text)
              .join(" ")
              .trim(),
          }))
          .filter((line) => line.text.length > 0)
          .sort((a, b) => a.yPosition - b.yPosition);

        resolve({
          success: true,
          textLines,
        });
      } catch (error) {
        console.error("Error processing PDF data:", error);
        resolve({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to process PDF data",
        });
      }
    });

    pdfParser.loadPDF(pdfFilePath);
  });
}

// Import the Python table parser
import { PythonTableParser } from "./pythonTableParser.server";

// Main parsing function that delegates to supplier-specific parsers
export async function parseInvoiceFromPdf(
  pdfFilePath: string,
  supplierName: string,
  usePythonParser: boolean = false,
): Promise<PdfExtractionResult> {
  try {
    // For Yamamoto, Swanson, and Rabeko suppliers, always use Python parser exclusively
    const forcePythonParser =
      supplierName.toLowerCase().includes("yamamoto") ||
      supplierName.toLowerCase().includes("iaf") ||
      supplierName.toLowerCase().includes("swanson") ||
      supplierName.toLowerCase().includes("rabeko");

    // Optionally use Python-based parser for better table extraction
    if (usePythonParser || forcePythonParser) {
      console.log("🐍 Using Python-based table parser");
      const pythonParser = new PythonTableParser();
      const result = await pythonParser.parse(pdfFilePath);

      // For suppliers forced to Python (Yamamoto/Swanson/Rabeko/Addict), always return the Python result
      if (forcePythonParser) {
        console.log(
          `🐍 Python parsing completed for forced supplier with ${result.data?.lineItems?.length || 0} line items`,
        );
        return result;
      }

      // For other suppliers using Python optionally, only return if successful with items
      if (
        result.success &&
        result.data &&
        result.data.lineItems &&
        result.data.lineItems.length > 0
      ) {
        console.log(
          `🐍 Python parsing succeeded with ${result.data.lineItems.length} line items`,
        );
        return result;
      }

      console.log(
        `🐍 Python parsing returned ${result.success ? "success" : "failure"} with ${result.data?.lineItems?.length || 0} line items`,
      );
      console.log(
        "🐍 Python parsing failed, falling back to JavaScript parsing",
      );
    }

    // Extract structured text first (only for non-Yamamoto/Swanson suppliers or when not using Python)
    const extractionResult = await extractStructuredText(pdfFilePath);

    if (!extractionResult.success || !extractionResult.textLines) {
      return {
        success: false,
        error: extractionResult.error || "Failed to extract text from PDF",
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
      error: error instanceof Error ? error.message : "Unknown parsing error",
    };
  }
}

// Parser interface for supplier-specific implementations
export interface InvoiceParser {
  parse(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{
        x: number;
        y: number;
        text: string;
        fontSize?: number;
      }>;
    }>,
  ): Promise<PdfExtractionResult>;
}
// Parser selection logic
function selectParser(supplierName: string): InvoiceParser {
  const normalizedName = supplierName.toLowerCase().trim();

  // Check for known suppliers
  if (normalizedName.includes("yamamoto") || normalizedName.includes("iaf")) {
    return new YamamotoParser();
  }

  if (normalizedName.includes("bolero")) {
    return new BoleroParser();
  }

  if (normalizedName.includes("swanson")) {
    return new SwansonParser();
  }

  if (normalizedName.includes("addict")) {
    return new AddictParser();
  }

  // Default to generic parser
  return new GenericParser();
}

// Enhanced Yamamoto/IAF Network parser with SKU-based approach
class YamamotoParser implements InvoiceParser {
  private columnThresholds: { [key: string]: number } = {};

  async parse(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{
        x: number;
        y: number;
        text: string;
        fontSize?: number;
      }>;
    }>,
  ): Promise<PdfExtractionResult> {
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: {
          currency: "EUR",
          shippingFee: 0,
        },
        lineItems: [],
      };

      // First, extract metadata
      this.extractMetadata(textLines, result);

      // Find table header and set up column detection
      this.detectTableHeader(textLines);

      // Use SKU-based approach to parse line items
      const lineItems = this.parseLineItemsBySku(textLines);

      console.log(
        `🎯 Successfully parsed ${lineItems.length} line items using SKU-based approach`,
      );

      result.lineItems = lineItems;

      return {
        success: true,
        data: result,
        warnings:
          result.lineItems.length === 0 ? ["No line items found"] : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to parse Yamamoto invoice",
      };
    }
  }

  private extractMetadata(textLines: any[], result: ParsedInvoiceData): void {
    for (const line of textLines) {
      const text = line.text;

      // Extract invoice date (format: DD/MM/YYYY)
      const dateMatch = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      if (dateMatch && !result.invoiceMetadata.invoiceDate) {
        const [, day, month, year] = dateMatch;
        result.invoiceMetadata.invoiceDate = new Date(
          `${year}-${month}-${day}`,
        );
      }

      // Extract invoice number
      const invoiceMatch = text.match(/Invoice\s+(\w+)/i);
      if (invoiceMatch) {
        result.invoiceMetadata.invoiceNumber = invoiceMatch[1];
      }

      // Note: Shipping fees are line items (e.g., "FITT001 Spese di spedizione")
      // No separate shipping fee extraction needed
    }
  }

  private detectTableHeader(textLines: any[]): void {
    for (const line of textLines) {
      const text = line.text.toUpperCase();

      // Look for table header
      if (
        text.includes("ITEM") &&
        text.includes("DESCRIPTION") &&
        text.includes("UNIT PRICE")
      ) {
        console.log(`✅ Found table header: "${line.text}"`);
        this.setupColumnDetection(line);
        break;
      }
    }
  }

  private setupColumnDetection(headerLine: any): void {
    // Analyze header positions to set up column detection
    const headerElements = headerLine.items.sort((a: any, b: any) => a.x - b.x);

    this.columnThresholds = {};

    headerElements.forEach((element: any) => {
      const text = element.text.toUpperCase();
      if (
        text.includes("ITEM") ||
        text.includes("SKU") ||
        text.includes("CODE")
      ) {
        this.columnThresholds.sku = element.x;
      } else if (text.includes("DESCRIPTION") || text.includes("PRODUCT")) {
        this.columnThresholds.description = element.x;
      } else if (text.includes("Q") && !text.includes("UNIT")) {
        this.columnThresholds.quantity = element.x;
      } else if (text.includes("UNIT PRICE") || text.includes("PREZZO")) {
        this.columnThresholds.unitPrice = element.x;
      } else if (text.includes("AMOUNT") || text.includes("TOTAL")) {
        this.columnThresholds.total = element.x;
      }
    });

    console.log(`🎯 Column thresholds set:`, this.columnThresholds);
  }

  private parseLineItemsBySku(textLines: any[]): any[] {
    const lineItems: any[] = [];

    // Collect all text elements from all lines with their positions
    const allTextElements: any[] = [];
    textLines.forEach((line) => {
      line.items.forEach((item: any) => {
        allTextElements.push({
          ...item,
          text: item.text.trim(),
        });
      });
    });

    // Find all SKU elements (IAF*, FITT*, etc.)
    const skuElements = allTextElements.filter((element) =>
      /^(IAF|FITT|YAM)\w*\d+/.test(element.text),
    );

    console.log(`🔍 Found ${skuElements.length} SKU elements`);

    for (const skuElement of skuElements) {
      console.log(
        `\n📦 Processing SKU: ${skuElement.text} at Y: ${skuElement.y}`,
      );

      // Collect all elements in the same row (Y ± 0.5 tolerance)
      const rowElements = allTextElements.filter(
        (element) => Math.abs(element.y - skuElement.y) <= 0.5,
      );

      console.log(`📋 Found ${rowElements.length} elements in this row`);
      rowElements.forEach((el) => console.log(`  - "${el.text}" at X:${el.x}`));

      // Parse this row into a line item
      const lineItem = this.parseRowElements(skuElement, rowElements);
      if (lineItem) {
        lineItems.push(lineItem);
      }
    }

    return lineItems;
  }

  private parseRowElements(skuElement: any, rowElements: any[]): any | null {
    try {
      // Sort elements by X position (left to right)
      const sortedElements = rowElements.sort((a, b) => a.x - b.x);

      // Extract the data using your approach
      const sku = skuElement.text.trim();
      const description = this.extractDescription(sortedElements);
      const quantity = this.extractQuantity(sortedElements);
      const unitPrice = this.extractUnitPrice(sortedElements);
      const total = this.extractTotal(sortedElements);

      console.log(
        `📊 Extracted: SKU="${sku}", Desc="${description}", Qty=${quantity}, Price=${unitPrice}, Total=${total}`,
      );

      if (!quantity || !unitPrice || !total) {
        console.log(`❌ Missing required data`);
        return null;
      }

      // Validate the calculation
      const expectedTotal = quantity * unitPrice;
      const tolerance = 0.02;
      if (Math.abs(expectedTotal - total) > tolerance) {
        console.log(
          `⚠️ Price validation warning: ${quantity} × ${unitPrice} = ${expectedTotal}, but total is ${total}`,
        );
      }

      return {
        supplierSku: sku,
        description: description || undefined,
        quantity,
        unitPrice,
        total,
      };
    } catch (error) {
      console.error(`❌ Error parsing row for SKU ${skuElement.text}:`, error);
      return null;
    }
  }

  private extractDescription(elements: any[]): string {
    // Look for description elements (product names, etc.)
    const descriptions: string[] = [];

    elements.forEach((element) => {
      const text = element.text;

      // Skip SKUs, quantities, prices, and tariff codes
      if (/^(IAF|FITT|YAM)\w*\d+/.test(text)) return;
      if (/^PZ\s+\d+/.test(text)) return;
      if (/^\d+[.,]\d{2}$/.test(text)) return;
      if (/^CUSTOM\s*'\s*S\s+TARIFF/.test(text)) return;
      if (/^\d{8}$/.test(text)) return; // Tariff numbers
      if (/^(NI\d+|ESC\d+)$/.test(text)) return; // VAT codes

      // Include actual description text
      if (text.length > 2 && !text.match(/^[-\s]*$/)) {
        descriptions.push(text);
      }
    });

    return descriptions.join(" ").trim().replace(/\s+/g, " ");
  }

  private extractQuantity(elements: any[]): number | null {
    // Look for "PZ" followed by number (including negative for returns)
    for (const element of elements) {
      const match = element.text.match(/^PZ\s+(-?\d+[.,]?\d*)$/);
      if (match) {
        return this.parseNumber(match[1]);
      }
    }

    // Look for standalone quantity numbers near PZ
    const pzElement = elements.find((el) => el.text === "PZ");
    if (pzElement) {
      // Find number element closest to PZ (including negative quantities)
      const numberElements = elements.filter((el) =>
        /^-?\d+[.,]?\d*$/.test(el.text),
      );
      if (numberElements.length > 0) {
        const closest = numberElements.reduce((prev, curr) =>
          Math.abs(curr.x - pzElement.x) < Math.abs(prev.x - pzElement.x)
            ? curr
            : prev,
        );
        return this.parseNumber(closest.text);
      }
    }

    return null;
  }

  private parseNumber(numberText: string): number {
    // Clean number parsing for quantities and simple numbers
    let normalized = numberText.trim();

    // Handle negative sign
    const isNegative = normalized.startsWith("-");
    if (isNegative) {
      normalized = normalized.substring(1);
    }

    // For simple numbers (quantities), just replace comma with dot
    normalized = normalized.replace(",", ".");

    let result = parseFloat(normalized);
    if (isNegative) {
      result = -result;
    }

    // Round to reasonable precision (up to 3 decimal places for quantities)
    return Math.round(result * 1000) / 1000;
  }

  private extractUnitPrice(elements: any[]): number | null {
    // Get all price elements INCLUDING NEGATIVE prices (important for discounts!)
    const priceElements = elements
      .filter((el) => {
        const text = el.text.trim();
        // Match: 123,45 or 1.234,56 or 1,234.56 or -123,45 (INCLUDE negative prices)
        return /^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/.test(text);
      })
      .sort((a, b) => a.x - b.x);

    console.log(
      `Price elements found: [${priceElements.map((p) => p.text).join(", ")}]`,
    );

    if (priceElements.length >= 3) {
      // When there are 3+ prices: quantity, unit price, total
      // Unit price is the middle one (second)
      const unitPriceText = priceElements[1].text;
      console.log(`Using middle price as unit price: ${unitPriceText}`);
      return this.parsePrice(unitPriceText);
    } else if (priceElements.length === 2) {
      // When there are 2 prices: unit price, total
      // Unit price is the first one
      const unitPriceText = priceElements[0].text;
      console.log(`Using first price as unit price: ${unitPriceText}`);
      return this.parsePrice(unitPriceText);
    }

    return null;
  }

  private extractTotal(elements: any[]): number | null {
    // Get all price elements (handles thousands separators) including negative for discounts
    const priceElements = elements
      .filter((el) => {
        const text = el.text.trim();
        // Match: 123,45 or 1.234,56 or 1,234.56 or -123,45
        return /^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/.test(text);
      })
      .sort((a, b) => a.x - b.x);

    if (priceElements.length >= 1) {
      // Total is always the rightmost price (last by X position)
      const totalText = priceElements[priceElements.length - 1].text;
      console.log(`Using rightmost price as total: ${totalText}`);
      return this.parsePrice(totalText);
    }

    return null;
  }

  private parsePrice(priceText: string): number {
    // Handle different thousands separators and decimal separators
    let normalized = priceText.trim();

    // Handle negative sign
    const isNegative = normalized.startsWith("-");
    if (isNegative) {
      normalized = normalized.substring(1);
    }

    // If there are multiple periods/commas, determine which is thousands vs decimal
    if ((normalized.match(/[.,]/g) || []).length > 1) {
      // European format: 1.234,56 → 1234.56
      if (
        normalized.includes(",") &&
        normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
      ) {
        normalized = normalized.replace(/\./g, "").replace(",", ".");
      }
      // US format: 1,234.56 → 1234.56
      else if (
        normalized.includes(".") &&
        normalized.lastIndexOf(".") > normalized.lastIndexOf(",")
      ) {
        normalized = normalized.replace(/,/g, "");
      }
    } else {
      // Single separator - assume it's decimal if 2 digits follow, thousands if 3+
      const parts = normalized.split(/[.,]/);
      if (parts.length === 2 && parts[1].length === 2) {
        // Decimal separator: 123,45 → 123.45
        normalized = normalized.replace(",", ".");
      }
    }

    // Parse and fix floating point precision issues
    let result = parseFloat(normalized);
    if (isNegative) {
      result = -result;
    }

    // Round to 2 decimal places to fix floating point precision issues
    // This prevents 17.09 becoming 17.09138696255201
    return Math.round(result * 100) / 100;
  }
}

// Swanson Health Products parser
class SwansonParser implements InvoiceParser {
  private columnThresholds: { [key: string]: number } = {};

  async parse(
    textLines: Array<{
      yPosition: number;
      text: string;
      page: number;
      items: Array<{
        x: number;
        y: number;
        text: string;
        fontSize?: number;
        page: number;
      }>;
    }>,
  ): Promise<PdfExtractionResult> {
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: {
          currency: "EUR",
          shippingFee: 0,
        },
        lineItems: [],
      };

      // Extract metadata
      this.extractMetadata(textLines, result);

      // Find table header and set up column detection
      this.detectTableHeader(textLines);

      // Use SKU-based approach to parse line items
      const lineItems = this.parseLineItemsBySku(textLines);

      console.log(
        `🎯 Successfully parsed ${lineItems.length} Swanson line items`,
      );

      result.lineItems = lineItems;

      return {
        success: true,
        data: result,
        warnings:
          result.lineItems.length === 0 ? ["No line items found"] : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to parse Swanson invoice",
      };
    }
  }

  private extractMetadata(textLines: any[], result: ParsedInvoiceData): void {
    for (const line of textLines) {
      const text = line.text;

      // Extract invoice date (format: YYYY-MM-DD)
      const dateMatch = text.match(/Date:\s*(\d{4}-\d{2}-\d{2})/);
      if (dateMatch && !result.invoiceMetadata.invoiceDate) {
        result.invoiceMetadata.invoiceDate = new Date(dateMatch[1]);
      }

      // Extract invoice number from "PRO-FORMA INVOICE Date: 2025-02-12 No: 250431"
      const invoiceMatch = text.match(/No:\s*(\w+)/);
      if (invoiceMatch) {
        result.invoiceMetadata.invoiceNumber = invoiceMatch[1];
      }

      // Extract shipping cost (if present)
      // Look for shipping-related terms in English and other languages
      const lowerText = text.toLowerCase();
      if (
        lowerText.includes("shipping") ||
        lowerText.includes("delivery") ||
        lowerText.includes("transport") ||
        lowerText.includes("freight") ||
        lowerText.includes("spedizione") || // Italian
        lowerText.includes("envío") || // Spanish
        lowerText.includes("livraison")
      ) {
        // French

        // Look for price patterns in the same line or nearby lines
        const priceMatch = text.match(/(\d+[.,]\d{2})/);
        if (priceMatch) {
          const shippingAmount = parseFloat(priceMatch[1].replace(",", "."));
          if (shippingAmount > 0) {
            result.invoiceMetadata.shippingFee = shippingAmount;
          }
        }
      }
    }
  }

  private detectTableHeader(textLines: any[]): void {
    for (const line of textLines) {
      const text = line.text.toUpperCase();

      // Look for Swanson table header: "SKU Name Exp. date QTY Unit price Amount"
      if (
        text.includes("SKU") &&
        text.includes("NAME") &&
        text.includes("QTY") &&
        text.includes("UNIT PRICE")
      ) {
        console.log(`✅ Found Swanson table header: "${line.text}"`);
        this.setupColumnDetection(line);
        break;
      }
    }
  }

  private setupColumnDetection(headerLine: any): void {
    const headerElements = headerLine.items.sort((a: any, b: any) => a.x - b.x);

    this.columnThresholds = {};

    headerElements.forEach((element: any) => {
      const text = element.text.toUpperCase();
      if (text.includes("SKU")) {
        this.columnThresholds.sku = element.x;
      } else if (text.includes("NAME")) {
        this.columnThresholds.description = element.x;
      } else if (text.includes("QTY")) {
        this.columnThresholds.quantity = element.x;
      } else if (text.includes("UNIT PRICE") || text.includes("PRICE")) {
        this.columnThresholds.unitPrice = element.x;
      } else if (text.includes("AMOUNT")) {
        this.columnThresholds.total = element.x;
      }
    });

    console.log(`🎯 Swanson column thresholds set:`, this.columnThresholds);
  }

  private parseLineItemsBySku(textLines: any[]): any[] {
    const lineItems: any[] = [];

    // Collect all text elements
    const allTextElements: any[] = [];
    textLines.forEach((line) => {
      line.items.forEach((item: any) => {
        allTextElements.push({
          ...item,
          text: item.text.trim(),
        });
      });
    });

    // Find all Swanson SKU elements (SW#### format)
    const skuElements = allTextElements.filter((element) =>
      /^SW[A-Z]*\d+/.test(element.text),
    );

    console.log(`🔍 Found ${skuElements.length} Swanson SKU elements`);

    for (const skuElement of skuElements) {
      console.log(
        `\n📦 Processing Swanson SKU: ${skuElement.text} at Y: ${skuElement.y}`,
      );

      // Collect all elements in the same row
      const rowElements = allTextElements.filter(
        (element) => Math.abs(element.y - skuElement.y) <= 0.5,
      );

      console.log(`📋 Found ${rowElements.length} elements in this row`);

      // Reconstruct the complete SKU by looking for adjacent fragments
      const completeSku = this.reconstructSwansonSku(skuElement, rowElements);

      // Parse this row into a line item
      const lineItem = this.parseSwansonRowElements(
        skuElement,
        rowElements,
        completeSku,
      );
      if (lineItem) {
        lineItems.push(lineItem);
      }
    }

    return lineItems;
  }

  private reconstructSwansonSku(skuElement: any, rowElements: any[]): string {
    // Start with the base SKU
    let completeSku = skuElement.text;

    // Look for adjacent single digits/characters that could be part of the SKU
    // Sort elements by X position to check for adjacent fragments
    const sortedElements = rowElements
      .filter((el) => el.x > skuElement.x && el.x < skuElement.x + 5) // Within reasonable distance
      .sort((a, b) => a.x - b.x);

    for (const element of sortedElements) {
      const text = element.text.trim();

      // Check if it's a single digit or short text that could be part of SKU
      if (/^[A-Z0-9]{1,2}$/.test(text) && element.x < skuElement.x + 3) {
        completeSku += text;
        break; // Only take the first adjacent fragment
      }
    }

    return completeSku;
  }

  private parseSwansonRowElements(
    skuElement: any,
    rowElements: any[],
    completeSku: string,
  ): any | null {
    try {
      const sortedElements = rowElements.sort((a, b) => a.x - b.x);

      const sku = completeSku; // Use the reconstructed complete SKU
      const description = this.extractSwansonDescription(sortedElements);
      const quantity = this.extractSwansonQuantity(sortedElements);
      const unitPrice = this.extractSwansonUnitPrice(sortedElements);

      if (!quantity || !unitPrice) {
        console.log(
          `❌ Missing required data: quantity=${quantity}, unitPrice=${unitPrice}`,
        );
        return null;
      }

      // Calculate total from unitPrice × quantity
      const totalInfo = this.calculateSwansonTotal(
        unitPrice,
        quantity,
        sortedElements,
      );
      const total = totalInfo.calculated;

      console.log(
        `📊 Swanson extracted: SKU="${sku}", Qty=${quantity}, Price=${unitPrice}, Total=${total}`,
      );

      return {
        supplierSku: sku,
        description: description || undefined,
        quantity,
        unitPrice,
        total,
      };
    } catch (error) {
      console.error(
        `❌ Error parsing Swanson row for SKU ${skuElement.text}:`,
        error,
      );
      return null;
    }
  }

  private extractSwansonDescription(elements: any[]): string {
    const descriptions: string[] = [];

    elements.forEach((element) => {
      const text = element.text;

      // Skip SKUs, quantities, prices, dates, and currency symbols
      if (/^SW[A-Z]*\d+/.test(text)) return; // Skip SKUs
      if (/^\d+$/.test(text)) return; // Skip pure numbers (quantities)
      if (/^\d+[.,]\d+\s*€?$/.test(text)) return; // Skip prices
      if (/^€/.test(text)) return; // Skip currency symbols
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return; // Skip dates

      // Include actual description text
      if (text.length > 1 && !text.match(/^[-\s€]*$/)) {
        descriptions.push(text);
      }
    });

    return descriptions.join(" ").trim().replace(/\s+/g, " ");
  }

  private extractSwansonQuantity(elements: any[]): number | null {
    // For Swanson format: "SW141 1 BERBERINE 400 MG 60 CAPS 2026-10-31 150 10.132 € 1519.8"
    // Quantity is typically the integer number that's reasonable for a quantity

    const integerElements = elements
      .filter((el) => /^\d+$/.test(el.text.trim()))
      .map((el) => ({ value: parseInt(el.text, 10), x: el.x, text: el.text }))
      .sort((a, b) => a.x - b.x); // Sort by position

    if (integerElements.length >= 1) {
      // Filter reasonable quantity candidates:
      // - Skip very small numbers (1-9, likely part of description)
      // - Skip very large numbers (>1000, likely totals)
      // - Keep reasonable quantities (10-1000)
      const candidateQuantities = integerElements.filter(
        (el) => el.value >= 10 && el.value <= 1000,
      );

      if (candidateQuantities.length > 0) {
        // For multiple candidates, take the largest reasonable one (most likely to be quantity)
        const quantity = Math.max(...candidateQuantities.map((el) => el.value));
        return quantity;
      }

      // Fallback: if no reasonable candidates but we have integers, take the first one > 1
      const fallbackCandidates = integerElements.filter((el) => el.value > 1);
      if (fallbackCandidates.length > 0) {
        const quantity = fallbackCandidates[0].value;
        return quantity;
      }
    }

    return null;
  }

  private extractSwansonUnitPrice(elements: any[]): number | null {
    // Find all decimal price elements
    const priceElements = elements
      .filter((el) => {
        const text = el.text.trim();
        return /^\d+[.,]\d+$/.test(text);
      })
      .sort((a, b) => a.x - b.x);

    if (priceElements.length >= 1) {
      // For Swanson format, unit price is the decimal number
      const unitPriceText = priceElements[0].text;
      return parseFloat(unitPriceText.replace(",", "."));
    }

    return null;
  }

  private calculateSwansonTotal(
    unitPrice: number,
    quantity: number,
    elements: any[],
  ): { calculated: number; pdfTotal?: number; matches?: boolean } {
    // Calculate total = unitPrice × quantity
    const calculated = Math.round(unitPrice * quantity * 100) / 100; // Round to 2 decimals

    // Try to find PDF's stated total for comparison
    let pdfTotal: number | undefined;

    elements.forEach((el) => {
      const text = el.text.trim();

      // Look for "€ 1519.8" format or large standalone numbers
      const euroMatch = text.match(/^€\s*(\d+(?:[.,]\d+)?)$/);
      if (euroMatch) {
        const value = parseFloat(euroMatch[1].replace(",", "."));
        if (value > unitPrice && value > quantity) {
          // Should be larger than both unit price and quantity
          pdfTotal = value;
        }
      }

      // Look for standalone large decimal numbers that could be totals
      if (/^\d+[.,]\d+$/.test(text)) {
        const value = parseFloat(text.replace(",", "."));
        if (value > unitPrice && value > quantity && value > 50) {
          pdfTotal = value;
        }
      }
    });

    const matches = pdfTotal
      ? Math.abs(calculated - pdfTotal) < 0.01
      : undefined;

    return { calculated, pdfTotal, matches };
  }
}

// Placeholder for Bolero parser
class BoleroParser implements InvoiceParser {
  async parse(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{
        x: number;
        y: number;
        text: string;
        fontSize?: number;
      }>;
    }>,
  ): Promise<PdfExtractionResult> {
    // TODO: Implement Bolero-specific parsing logic
    return {
      success: false,
      error: "Bolero parser not yet implemented",
    };
  }
}

// Generic fallback parser
class GenericParser implements InvoiceParser {
  async parse(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{
        x: number;
        y: number;
        text: string;
        fontSize?: number;
      }>;
    }>,
  ): Promise<PdfExtractionResult> {
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: {
          currency: "EUR",
          shippingFee: 0,
        },
        lineItems: [],
        rawText: textLines.map((line) => line.text),
      };

      // Basic date extraction
      for (const line of textLines) {
        const dateMatch = line.text.match(
          /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/,
        );
        if (dateMatch && !result.invoiceMetadata.invoiceDate) {
          const [, day, month, year] = dateMatch;
          result.invoiceMetadata.invoiceDate = new Date(
            `${year}-${month}-${day}`,
          );
          break;
        }
      }

      return {
        success: true,
        data: result,
        warnings: ["Generic parser used - manual review recommended"],
      };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Generic parsing failed",
      };
    }
  }
}

// Addict (French) invoice parser
class AddictParser implements InvoiceParser {
  async parse(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{
        x: number;
        y: number;
        text: string;
        fontSize?: number;
      }>;
    }>,
  ): Promise<PdfExtractionResult> {
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: {
          currency: "EUR",
          shippingFee: 0,
        },
        lineItems: [],
      };

      const columnThresholds: { [key: string]: number } = {};

      // 1) Find header line with French labels
      let headerY = -Infinity;
      for (const line of textLines) {
        const upper = line.text.toUpperCase();
        if (
          (upper.includes("LIBELL") || upper.includes("LIBELLÉ")) &&
          (upper.includes("PU") || upper.includes("P.U")) &&
          (upper.includes("PRIX HT") ||
            upper.includes("MONTANT HT") ||
            upper.includes("TOTAL HT"))
        ) {
          headerY = line.yPosition;
          // Map columns by token positions
          const elements = [...line.items].sort((a, b) => a.x - b.x);
          elements.forEach((el) => {
            const t = el.text.toLowerCase();
            if (t.includes("réf") || t === "ref" || t.includes("code")) {
              columnThresholds.sku = el.x;
            } else if (t.includes("libell")) {
              columnThresholds.description = el.x;
            } else if (
              t === "q." ||
              t.startsWith("q ") ||
              t.includes("quant")
            ) {
              columnThresholds.quantity = el.x;
            } else if (
              t === "pu" ||
              (t.includes("unit") && t.includes("prix"))
            ) {
              columnThresholds.unitPrice = el.x;
            } else if (
              t.includes("prix ht") ||
              t.includes("montant ht") ||
              t.includes("total")
            ) {
              columnThresholds.total = el.x;
            }
          });
          break;
        }
      }

      if (headerY === -Infinity) {
        return {
          success: false,
          error: "Addict header not found (Libellé/PU/Prix HT)",
        };
      }

      // 2) Parse rows after header
      const items: {
        supplierSku: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }[] = [];
      let pendingDesc: string = "";
      const toleranceY = 0.6;
      for (const line of textLines) {
        if (line.yPosition <= headerY + 0.1) continue;

        const upper = line.text.toUpperCase();
        // Stop at totals/footer sections
        if (
          upper.includes("TOTAL HT") ||
          upper.includes("TOTAL TTC") ||
          upper.includes("TVA") ||
          upper.includes("NET")
        ) {
          break;
        }

        // Build potential continuation description from this line
        const contDesc = this.getContinuationDescription(
          line.items,
          columnThresholds,
        );

        const row = this.parseRow(line.items, columnThresholds);
        if (row) {
          // Prepend any pending continuation captured from prior lines
          if (pendingDesc) {
            row.description = `${pendingDesc} ${row.description || ""}`
              .replace(/\s+/g, " ")
              .trim();
            pendingDesc = "";
          }

          // Final cleanup: never keep quantity token inside description
          if (typeof row.quantity === "number") {
            const q = row.quantity;
            // remove standalone numeric tokens equal to quantity (int or with .00)
            row.description = (row.description || "")
              .replace(new RegExp(`(?:^|\\s)${q}(?:\\.0+)?(?:\\s|$)`), " ")
              .replace(/\s+/g, " ")
              .trim();
          }

          // Keep PDF's Prix HT as total when available; only compute if missing
          if (row.total == null) {
            if (
              typeof row.unitPrice === "number" &&
              typeof row.quantity === "number"
            ) {
              row.total = Math.round(row.unitPrice * row.quantity * 100) / 100;
            }
          }
          items.push(row);
        } else {
          // No full row detected; if we have continuation description, attach it
          if (contDesc) {
            if (items.length > 0) {
              const last = items[items.length - 1];
              last.description = `${last.description || ""} ${contDesc}`
                .replace(/\s+/g, " ")
                .trim();
            } else {
              // Store to prepend to the next parsed row
              pendingDesc = pendingDesc
                ? `${pendingDesc} ${contDesc}`
                : contDesc;
            }
          }
        }
      }

      result.lineItems = items;
      return {
        success: true,
        data: result,
        warnings:
          items.length === 0 ? ["No line items parsed for Addict"] : undefined,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Addict parsing failed",
      };
    }
  }

  private parseRow(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    thresholds: { [key: string]: number },
  ) {
    // Sort left-to-right
    const els = [...elements].sort((a, b) => a.x - b.x);

    const getNear = (target?: number) =>
      target == null
        ? undefined
        : els
            .filter((e) => Math.abs(e.x - target) < 2.5)
            .map((e) => e.text.trim())
            .filter(Boolean);

    // SKU/code
    let sku = "";
    const skuCandidates = getNear(thresholds.sku) || [];
    for (const s of skuCandidates) {
      if (
        s &&
        !/libell/i.test(s) &&
        !/^q\.?$/i.test(s) &&
        s.toLowerCase() !== "pu"
      ) {
        sku = s;
        break;
      }
    }
    if (!sku) return null;

    // Description: concatenate texts between description and quantity columns
    let description = "";
    if (thresholds.description != null && thresholds.quantity != null) {
      const descTexts = els
        .filter(
          (e) =>
            e.x >= thresholds.description - 0.5 &&
            e.x < thresholds.quantity - 0.5,
        )
        .map((e) => e.text.trim())
        .filter((t) => {
          if (!t) return false;
          const tl = t.toLowerCase();
          if (/^q\.?$/i.test(tl)) return false;
          if (tl === "pu") return false;
          // Exclude numeric tokens (integers or decimals)
          if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
          // Exclude price-like tokens
          if (this.isPriceLike(t)) return false;
          return true;
        });
      description = descTexts.join(" ").replace(/\s+/g, " ").trim();
    }

    // Quantity
    let quantity: number | null = null;
    const qtyCandidates = getNear(thresholds.quantity) || [];
    for (const q of qtyCandidates) {
      const val = this.parseNumber(q);
      if (val != null) {
        quantity = val;
        break;
      }
    }

    // Prices: prefer values near the PU and Prix HT columns
    let unitPrice: number | null = null;
    let total: number | null = null;

    unitPrice = this.parsePriceNearColumn(els, thresholds.unitPrice);
    total = this.parsePriceNearColumn(els, thresholds.total);

    // Fallback: scan right of quantity if specific columns not found
    if (unitPrice == null || total == null) {
      const priceTokens = els
        .filter((e) => thresholds.quantity == null || e.x > thresholds.quantity)
        .map((e) => e.text.trim())
        .filter((t) => this.isPriceLike(t));
      if (unitPrice == null && priceTokens.length >= 1)
        unitPrice = this.parsePrice(priceTokens[0]);
      if (total == null && priceTokens.length >= 1)
        total = this.parsePrice(priceTokens[priceTokens.length - 1]);
    }

    if (quantity == null || unitPrice == null || total == null) return null;

    return {
      supplierSku: sku,
      description: description || undefined,
      quantity,
      unitPrice,
      total,
    };
  }

  private parsePriceNearColumn(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    xThreshold?: number,
  ): number | null {
    if (xThreshold == null) return null;
    const window = 3.5; // tolerant enough for split tokens but avoid grabbing adjacent column
    const within = elements
      .filter((e) => Math.abs(e.x - xThreshold) < window)
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ x: e.x, text: e.text.trim() }))
      .filter((e) => e.text.length > 0);
    if (within.length === 0) return null;

    type Cand = { x: number; text: string };
    const candidates: Cand[] = [];

    // Single-token candidates
    for (const tok of within) {
      if (this.isPriceLike(tok.text)) candidates.push(tok);
    }

    // Two-token merged candidates (handle '2' + '478,42' -> '2478,42')
    for (let i = 0; i < within.length - 1; i++) {
      const merged = `${within[i].text}${within[i + 1].text}`;
      if (this.isPriceLike(merged)) {
        candidates.push({
          x: (within[i].x + within[i + 1].x) / 2,
          text: merged,
        });
      }
    }

    if (candidates.length > 0) {
      // Pick candidate closest to the column threshold
      const best = candidates.reduce(
        (best, cur) =>
          Math.abs(cur.x - xThreshold) < Math.abs(best.x - xThreshold)
            ? cur
            : best,
        candidates[0],
      );
      const val = this.parsePrice(best.text);
      if (val || val === 0) return val;
    }

    // Fallback: try each raw token sequentially
    for (const tok of within) {
      const p = this.parsePrice(tok.text);
      if (p || p === 0) return p;
    }

    // Last resort: merge all and try
    const allMerged = within.map((t) => t.text).join("");
    if (this.isPriceLike(allMerged)) {
      const v = this.parsePrice(allMerged);
      if (v || v === 0) return v;
    }
    return null;
  }

  private getContinuationDescription(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    thresholds: { [key: string]: number },
  ): string {
    if (thresholds.description == null || thresholds.quantity == null)
      return "";
    const texts = elements
      .filter(
        (e) =>
          e.x >= thresholds.description - 0.5 &&
          e.x < thresholds.quantity - 0.5,
      )
      .map((e) => e.text.trim())
      .filter((t) => {
        if (!t) return false;
        const tl = t.toLowerCase();
        if (/^q\.?$/i.test(tl)) return false;
        if (tl === "pu") return false;
        // Exclude any numeric tokens (quantities or prices)
        if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
        if (/^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2,}$/.test(t)) return false;
        return true;
      });
    return texts.join(" ").replace(/\s+/g, " ").trim();
  }

  private parseNumber(text: string): number | null {
    const t = text.replace(/\s/g, "").replace(",", ".");
    const num = parseFloat(t);
    return isNaN(num) ? null : num;
  }

  private parsePrice(priceText: string): number {
    // Exact two-decimal parsing preserving PDF value (avoid +0.01 floating drift)
    let s = priceText.trim();
    if (!s) return 0;
    // Strip currency and percent symbols and non-number letters
    s = s.replace(/[€$£%]/g, "");
    // Allow spaces as thousands separators
    s = s.replace(/\s+/g, "");
    const isNegative = s.startsWith("-");
    if (isNegative) s = s.substring(1);
    // Find the last decimal separator followed by exactly two digits
    const decMatch = s.match(/^[^.,]*([.,])(\d{2})$/);
    let integerPart = "";
    let decimals = "";
    if (decMatch) {
      // Simple form like 2478,42 or 2478.42
      const sep = decMatch[1];
      decimals = decMatch[2];
      integerPart = s.slice(0, s.length - (1 + 2));
      integerPart = integerPart.replace(/[.,]/g, "");
    } else {
      // General form with potential thousand separators: capture last [.,]\d{2}
      const m = s.match(/(.*?)([.,])(\d{2})$/);
      if (m) {
        integerPart = (m[1] || "").replace(/[.,]/g, "");
        decimals = m[3];
      } else {
        // No explicit decimals; treat as integer euros
        const digitsOnly = s.replace(/[^0-9]/g, "");
        if (!digitsOnly) return 0;
        const cents = parseInt(digitsOnly, 10) * 100;
        const signed = isNegative ? -cents : cents;
        return signed / 100;
      }
    }
    const intDigits = integerPart.replace(/[^0-9]/g, "");
    if (!/^[0-9]+$/.test(intDigits) || !/^[0-9]{2}$/.test(decimals)) return 0;
    let cents = parseInt(intDigits, 10) * 100 + parseInt(decimals, 10);
    if (isNegative) cents = -cents;
    return cents / 100;
  }

  private isPriceLike(text: string): boolean {
    if (!text) return false;
    // Allow spaces as thousand separators (French format), before decimal comma
    // Examples: "2 478,42", "1 746,36", "1,234.56", "1.234,56", "120,00"
    const t = text.trim();
    const withSpaces = /^-?\d{1,3}(?:[\s.,]\d{3})*[.,]\d{2,}$/.test(t);
    const simple = /^-?\d+[.,]\d{2,}$/.test(t);
    return withSpaces || simple;
  }
}
