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

  if (normalizedName.includes("maiavie")) {
    return new MaiavieParser();
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
    try {
      const result: ParsedInvoiceData = {
        supplierInfo: {},
        invoiceMetadata: { currency: "EUR", shippingFee: 0 },
        lineItems: [],
      };

      // Detect header with: Description | Article code | Quantity | Unit price | Subtotal
      const thresholds: { [key: string]: number } = {};
      let headerY = -Infinity;
      for (const line of textLines) {
        const up = line.text.toLowerCase();
        if (
          up.includes("description") &&
          (up.includes("article") || up.includes("code")) &&
          (up.includes("quantity") || up.includes("qty")) &&
          up.includes("unit price") &&
          (up.includes("subtotal") ||
            up.includes("sub total") ||
            up.includes("sub-total") ||
            up.includes("total"))
        ) {
          headerY = line.yPosition;
          const items = [...line.items].sort((a, b) => a.x - b.x);
          for (const el of items) {
            const t = el.text.toLowerCase();
            if (t.includes("article") && t.includes("code"))
              thresholds.sku = el.x;
            else if (t.includes("description")) thresholds.description = el.x;
            else if (t.includes("quantity") || t === "qty")
              thresholds.quantity = el.x;
            else if (t.includes("unit") && t.includes("price"))
              thresholds.unitPrice = el.x;
            else if (
              t.includes("subtotal") ||
              t.includes("sub total") ||
              t.includes("sub-total") ||
              (t.includes("total") && !t.includes("unit"))
            )
              thresholds.total = el.x;
          }
          break;
        }
      }

      if (headerY === -Infinity) {
        // Fallback: infer column thresholds from data patterns
        // Header not found; try to infer thresholds heuristically
        (this as any)._inferBoleroThresholdsFromData?.(textLines, thresholds);
        // Proceed even if some thresholds are missing; parseRow has fallbacks
      }

      const items: {
        supplierSku: string;
        description?: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }[] = [];
      let pendingDesc = "";
      for (const line of textLines) {
        if (line.yPosition <= headerY + 0.1) continue;

        const contDesc = this.getContinuationDescription(
          line.items,
          thresholds,
        );
        let row = this.parseRow(line.items, thresholds);
        if (!row) {
          // Heuristic fallback when thresholds or header matching are imperfect
          row = this.parseRowByHeuristics(line.items);
        }
        if (row) {
          if (pendingDesc) {
            row.description = `${pendingDesc} ${row.description || ""}`
              .replace(/\s+/g, " ")
              .trim();
            pendingDesc = "";
          }
          if (typeof row.quantity === "number") {
            const q = row.quantity;
            row.description = (row.description || "")
              .replace(new RegExp(`(?:^|\\s)${q}(?:\\.0+)?(?:\\s|$)`), " ")
              .replace(/\s+/g, " ")
              .trim();
          }
          // Keep Subtotal from PDF if present; otherwise compute
          if (
            row.total == null &&
            typeof row.unitPrice === "number" &&
            typeof row.quantity === "number"
          ) {
            row.total = Math.round(row.unitPrice * row.quantity * 100) / 100;
          }
          items.push(row);
        } else if (contDesc) {
          if (items.length) {
            const last = items[items.length - 1];
            last.description = `${last.description || ""} ${contDesc}`
              .replace(/\s+/g, " ")
              .trim();
          } else {
            pendingDesc = pendingDesc ? `${pendingDesc} ${contDesc}` : contDesc;
          }
        }
      }

      // If nothing parsed with per-line logic, try robust global row detection by prices
      if (items.length === 0) {
        const globalItems = this.parseByGlobalHeuristics(textLines);
        items.push(...globalItems);
      }

      // Extract shipping cost into metadata (do not add as line item)
      const shipping = this.extractShippingAmount(textLines);
      if (shipping != null) {
        result.invoiceMetadata.shippingFee = shipping;
      }

      result.lineItems = items;
      return {
        success: true,
        data: result,
        warnings:
          items.length === 0 ? ["No line items parsed for Bolero"] : undefined,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Bolero parsing failed",
      };
    }
  }

  private appendServiceLines(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
    items: Array<{
      supplierSku: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }>,
  ) {
    const already = new Set(
      items.map((i) => `${(i.description || "").toLowerCase()}|${i.total}`),
    );
    // Collect shipping line (only) and append it last
    let shippingCandidate: { unitPrice: number; total: number } | null = null;
    for (const line of textLines) {
      const compact = line.items
        .map((e) => (e.text || "").trim())
        .join("")
        .toLowerCase();
      const isShipping =
        compact.includes("shipping") && compact.includes("handl");
      if (!isShipping) continue;
      // Reconstruct prices from '€' token sequences on the same line
      const els = [...line.items]
        .map((e) => ({ x: e.x, text: (e.text || "").trim() }))
        .filter((e) => e.text.length > 0)
        .sort((a, b) => a.x - b.x);
      const euroIdxs: number[] = [];
      for (let i = 0; i < els.length; i++)
        if (els[i].text === "€") euroIdxs.push(i);
      const readAfterEuro = (idx: number): number | null => {
        let s = "";
        let j = idx + 1;
        while (j < els.length && /[0-9.,]/.test(els[j].text)) {
          s += els[j].text;
          j++;
        }
        const v = this.parsePrice(s);
        return v == null ? null : v;
      };
      const values = euroIdxs
        .map(readAfterEuro)
        .filter((v) => v != null) as number[];
      if (values.length === 0) {
        shippingCandidate = { unitPrice: 0, total: 0 };
        continue;
      }
      const unitPrice = values[0] ?? 0;
      const total = values[values.length - 1] ?? unitPrice;
      shippingCandidate = { unitPrice, total };
    }
    if (shippingCandidate) {
      const key = `shipping & handling|${shippingCandidate.total}`;
      if (!already.has(key)) {
        items.push({
          supplierSku: "-",
          description: "Shipping & handling",
          quantity: 1,
          unitPrice: shippingCandidate.unitPrice,
          total: shippingCandidate.total,
        });
        already.add(key);
      }
    }
  }

  private extractShippingAmount(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
  ): number | null {
    // Find a line that contains Shipping & handling (compact tokens) and read rightmost € value as total
    for (const line of textLines) {
      const compact = line.items
        .map((e) => (e.text || "").trim())
        .join("")
        .toLowerCase();
      if (!(compact.includes("shipping") && compact.includes("handl")))
        continue;
      const els = [...line.items]
        .map((e) => ({ x: e.x, text: (e.text || "").trim() }))
        .filter((e) => e.text.length > 0)
        .sort((a, b) => a.x - b.x);
      const euroIdxs: number[] = [];
      for (let i = 0; i < els.length; i++)
        if (els[i].text === "€") euroIdxs.push(i);
      if (euroIdxs.length === 0) return 0;
      const readValueAfterEuro = (
        idx: number,
      ): { value: number | null; x: number } => {
        let s = "";
        let j = idx + 1;
        let seenSep = false;
        let decimals = 0;
        while (j < els.length && /[0-9.,]/.test(els[j].text)) {
          const ch = els[j].text;
          s += ch;
          if (ch === "," || ch === ".") {
            seenSep = true;
            decimals = 0;
          } else if (seenSep && /\d/.test(ch)) {
            decimals += 1;
            if (decimals >= 2) break;
          }
          j++;
        }
        const v = this.parsePrice(s);
        return { value: v == null ? null : v, x: els[idx].x };
      };
      const vals = euroIdxs
        .map((i) => readValueAfterEuro(i))
        .filter((e) => e.value != null) as Array<{ value: number; x: number }>;
      if (!vals.length) return 0;
      // Rightmost price is the Subtotal
      const total = vals.reduce((p, c) => (c.x > p.x ? c : p)).value;
      return total;
    }
    return null;
  }

  private parseRow(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    thresholds: { [key: string]: number },
  ) {
    const els = [...elements].sort((a, b) => a.x - b.x);
    const getNear = (x?: number) =>
      x == null
        ? []
        : els
            .filter((e) => Math.abs(e.x - x) < 2.5)
            .map((e) => e.text.trim())
            .filter(Boolean);

    // SKU
    let sku = "";
    for (const s of getNear(thresholds.sku)) {
      const tl = s.toLowerCase();
      if (
        !tl.includes("description") &&
        !tl.includes("unit") &&
        !tl.includes("price") &&
        !/^q\.?$/.test(tl)
      ) {
        sku = s;
        break;
      }
    }
    if (!sku) return null;

    // Description between description and quantity columns
    let description = "";
    if (thresholds.description != null && thresholds.quantity != null) {
      const desc = els
        .filter(
          (e) =>
            e.x >= thresholds.description - 0.5 &&
            e.x < thresholds.quantity - 0.5,
        )
        .map((e) => e.text.trim())
        .filter((t) => {
          if (!t) return false;
          const tl = t.toLowerCase();
          if (/^q\.?$/.test(tl)) return false;
          if (tl.includes("unit") && tl.includes("price")) return false;
          if (this.isPriceLike(t)) return false;
          if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
          return true;
        });
      description = desc.join(" ").replace(/\s+/g, " ").trim();
    }

    // Quantity
    let quantity: number | null = null;
    if (thresholds.quantity != null) {
      for (const q of getNear(thresholds.quantity)) {
        const n = this.parseNumber(q);
        if (n != null) {
          quantity = n;
          break;
        }
      }
    } else {
      // Fallback: choose integer token nearest to unitPrice column and less than it
      const unitX = thresholds.unitPrice ?? thresholds.total ?? null;
      const intTokens = els
        .map((e) => ({ x: e.x, t: e.text.trim() }))
        .filter((e) => /^\d+$/.test(e.t));
      if (intTokens.length) {
        let best: { x: number; t: string } | null = null;
        for (const tok of intTokens) {
          if (unitX != null && tok.x >= unitX) continue; // must be left of price
          if (!best) best = tok;
          else if (unitX != null) {
            if (Math.abs(tok.x - unitX) < Math.abs(best.x - unitX)) best = tok;
          }
        }
        if (best) {
          const n = this.parseNumber(best.t);
          if (n != null) quantity = n;
        }
      }
    }

    // Prices
    const unitPrice = this.parsePriceNearColumn(els, thresholds.unitPrice);
    const total = this.parsePriceNearColumn(els, thresholds.total);
    if (quantity == null || unitPrice == null || total == null) return null;
    return {
      supplierSku: sku,
      description: description || undefined,
      quantity,
      unitPrice,
      total,
    };
  }

  private getContinuationDescription(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    thresholds: { [key: string]: number },
  ): string {
    if (thresholds.description == null || thresholds.quantity == null)
      return "";
    const parts = elements
      .filter(
        (e) =>
          e.x >= thresholds.description - 0.5 &&
          e.x < thresholds.quantity - 0.5,
      )
      .map((e) => e.text.trim())
      .filter(
        (t) =>
          t &&
          !/^q\.?$/i.test(t) &&
          !this.isPriceLike(t) &&
          !/^-?\d+(?:[.,]\d+)?$/.test(t),
      );
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }

  private parseByGlobalHeuristics(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
  ): Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }> {
    const items: Array<{ x: number; y: number; text: string }> = [];
    for (const line of textLines) {
      for (const it of line.items) {
        const t = it.text?.trim();
        if (!t) continue;
        items.push({ x: it.x, y: it.y, text: t });
      }
    }
    // Group by row using Y tolerance
    const tol = 0.5;
    const rowsMap = new Map<
      number,
      Array<{ x: number; y: number; text: string }>
    >();
    for (const it of items) {
      const key = Math.round(it.y / tol) * tol;
      const row = rowsMap.get(key) || [];
      row.push(it);
      rowsMap.set(key, row);
    }
    const rowYs = [...rowsMap.keys()].sort((a, b) => a - b);
    const results: Array<{
      supplierSku: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }> = [];
    for (const y of rowYs) {
      const row = rowsMap.get(y)!;
      const els = row
        .map((e) => ({ x: e.x, text: e.text.trim() }))
        .filter((e) => e.text.length > 0)
        .sort((a, b) => a.x - b.x);
      if (!els.length) continue;
      const compactRow = els
        .map((e) => e.text)
        .join("")
        .toLowerCase();
      if (
        compactRow.includes("shipping") ||
        compactRow.includes("handling") ||
        compactRow.includes("payment")
      ) {
        // Defer service lines to appendServiceLines so they appear at the end
        continue;
      }
      // Rebuild prices from '€' followed by number tokens (e.g., 3 , 2 4)
      const euroIdxs: number[] = [];
      for (let i = 0; i < els.length; i++)
        if (els[i].text === "€") euroIdxs.push(i);
      if (euroIdxs.length === 0) continue;
      const parseEuroAt = (
        idx: number,
      ): { value: number | null; x: number } => {
        let s = "";
        let j = idx + 1;
        while (j < els.length && /[0-9.,]/.test(els[j].text)) {
          s += els[j].text;
          j++;
        }
        return { value: this.parsePrice(s), x: els[idx].x };
      };
      const euroValues = euroIdxs
        .map((i) => parseEuroAt(i))
        .filter((e) => e.value != null) as Array<{ value: number; x: number }>;
      if (euroValues.length === 0) continue;
      const total = euroValues[euroValues.length - 1].value;
      const unitPrice = euroValues[0].value;
      const priceX = euroValues[0].x;

      // Quantity: try rightmost integer left of price, else derive from total/unitPrice
      const qtyCandidates = els.filter(
        (e) => e.x < priceX && /^\d+$/.test(e.text),
      );
      let quantity: number | null = null;
      if (qtyCandidates.length) {
        const qtyTok = [...qtyCandidates].sort((a, b) => b.x - a.x)[0];
        quantity = this.parseNumber(qtyTok.text);
      }
      if (
        (quantity == null || quantity === 0) &&
        unitPrice != null &&
        total != null
      ) {
        const q = Math.round((total / unitPrice) * 100) / 100;
        const qi = Math.round(q);
        if (qi > 0 && Math.abs(q - qi) < 0.05) quantity = qi;
      }
      // Detect service lines (Shipping/Handling/Payment) and force quantity to 1 if missing
      const rowText = els
        .map((e) => e.text)
        .join(" ")
        .toLowerCase();
      const isServiceLine =
        compactRow.includes("shipping") ||
        compactRow.includes("handling") ||
        compactRow.includes("payment");
      if (isServiceLine && (quantity == null || quantity === 0)) {
        quantity = 1;
      }
      if (quantity == null || quantity === 0) continue;

      // SKU (Article code): tokens of digits and dots between last 'L' before price and first '€'
      const firstEuroX = priceX;
      let lastLIdx = -1;
      for (let i = 0; i < els.length; i++)
        if (els[i].text.toUpperCase() === "L" && els[i].x < firstEuroX)
          lastLIdx = i;
      const startIdx = lastLIdx >= 0 ? lastLIdx + 1 : 0;
      const codeTokens = els.filter(
        (e, idx) =>
          idx >= startIdx && e.x < firstEuroX && /^[0-9.]$/.test(e.text),
      );
      let sku = codeTokens
        .map((t) => t.text)
        .join("")
        .replace(/\.{2,}/g, ".")
        .replace(/^\./, "")
        .replace(/\.$/, "");
      if (!sku && isServiceLine) {
        sku = "-";
      }
      if (!sku) continue;

      // Description: rebuild as "Name | 9g | 1,5L"
      const pipeIdxs: number[] = [];
      for (let i = 0; i < els.length; i++) {
        if (els[i].text === "|" && els[i].x < firstEuroX) pipeIdxs.push(i);
      }
      const nameEndIdx =
        pipeIdxs.length > 0
          ? pipeIdxs[0]
          : lastLIdx >= 0
            ? lastLIdx + 1
            : Math.max(0, startIdx);
      const nameTokens = els.slice(0, Math.max(0, nameEndIdx));

      const buildName = (tokens: Array<{ x: number; text: string }>) => {
        let out = "";
        for (const tk of tokens) {
          const raw = tk.text;
          // Insert a space if token carried space visually
          if (out && /\s/.test(raw) && out[out.length - 1] !== " ") out += " ";
          const letters = raw.replace(/[^A-Za-z]/g, "");
          for (const ch of letters) {
            const last = out[out.length - 1] || "";
            if (out && /[a-z]/.test(last) && /[A-Z]/.test(ch)) out += " ";
            out += ch;
          }
        }
        return out.replace(/\s+/g, " ").trim();
      };

      const buildCompact = (tokens: Array<{ x: number; text: string }>) => {
        const s = tokens
          .map((t) => t.text)
          .filter((t) => /^[0-9A-Za-z,]$/.test(t))
          .join("");
        return s;
      };

      const namePart = isServiceLine
        ? compactRow.includes("shipping")
          ? "Shipping & handling"
          : compactRow.includes("payment")
            ? "Payment costs"
            : buildName(nameTokens)
        : buildName(nameTokens);
      let size1 = "";
      let size2 = "";
      if (pipeIdxs.length >= 1) {
        const a = pipeIdxs[0];
        const b = pipeIdxs.length >= 2 ? pipeIdxs[1] : -1;
        if (a >= 0)
          size1 = buildCompact(
            els.slice(a + 1, b >= 0 ? b : lastLIdx >= 0 ? lastLIdx + 1 : a + 1),
          );
        if (b >= 0)
          size2 = buildCompact(
            els.slice(b + 1, lastLIdx >= 0 ? lastLIdx + 1 : b + 1),
          );
      }
      const description = [
        namePart,
        !isServiceLine && size1 && `| ${size1}`,
        !isServiceLine && size2 && `| ${size2}`,
      ]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      results.push({
        supplierSku: sku,
        description: description || undefined,
        quantity,
        unitPrice: unitPrice ?? 0,
        total,
      });
    }
    return results;
  }
  private parseRowByHeuristics(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
  ) {
    const els = elements
      .map((e) => ({ x: e.x, text: e.text.trim() }))
      .filter((e) => e.text.length > 0)
      .sort((a, b) => a.x - b.x);
    if (els.length === 0) return null;

    // Service line detection (e.g., Shipping & handling, Payment costs)
    const compactRow = els
      .map((e) => e.text)
      .join("")
      .toLowerCase();
    if (
      compactRow.includes("shipping") ||
      compactRow.includes("handling") ||
      compactRow.includes("payment")
    ) {
      // Defer service lines to appendServiceLines so they appear at the end
      return null;
    }

    // Identify price-like tokens
    const prices = els.filter((e) => this.isPriceLike(e.text));
    if (prices.length === 0) return null;
    const totalTok = prices[prices.length - 1];
    const unitTok = prices.length >= 2 ? prices[prices.length - 2] : null;
    const total = this.parsePrice(totalTok.text);
    const unitPrice = unitTok ? this.parsePrice(unitTok.text) : null;

    // Quantity: rightmost integer token to the left of the leftmost price
    const priceX = unitTok ? Math.min(unitTok.x, totalTok.x) : totalTok.x;
    const qtyTokens = els.filter((e) => e.x < priceX && /^\d+$/.test(e.text));
    let quantity: number | null = null;
    if (qtyTokens.length) {
      const rightmost = [...qtyTokens].sort((a, b) => b.x - a.x)[0];
      const n = this.parseNumber(rightmost.text);
      if (n != null) quantity = n;
    }
    if (quantity == null) return null;

    // SKU: pick first clean token on the left area
    const skuArea = els.filter((e) => e.x < (qtyTokens[0]?.x ?? priceX));
    let sku = "";
    for (const t of skuArea) {
      if (/^[A-Za-z0-9_.\-]+$/.test(t.text)) {
        sku = t.text;
        break;
      }
    }
    if (!sku) return null;

    // Description: tokens between sku and quantity, excluding numeric/price terms
    const skuX = skuArea.find((e) => e.text === sku)?.x ?? skuArea[0]?.x ?? 0;
    const qtyX = qtyTokens[0]?.x ?? priceX;
    const descParts = els
      .filter((e) => e.x > skuX && e.x < qtyX)
      .map((e) => e.text)
      .filter((t) => {
        const tl = t.toLowerCase();
        if (this.isPriceLike(t)) return false;
        if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
        if (/^q\.?$/.test(tl)) return false;
        if (tl.includes("unit") && tl.includes("price")) return false;
        return true;
      });
    let description = descParts.join(" ").replace(/\s+/g, " ").trim();
    description = description
      .replace(new RegExp(`(?:^|\\s)${quantity}(?:\\.0+)?(?:\\s|$)`), " ")
      .replace(/\s+/g, " ")
      .trim();

    return {
      supplierSku: sku,
      description: description || undefined,
      quantity,
      unitPrice: unitPrice ?? 0,
      total,
    };
  }
  private parsePriceNearColumn(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    xThreshold?: number,
  ): number | null {
    if (xThreshold == null) return null;
    const window = 3.5;
    const within = elements
      .filter((e) => Math.abs(e.x - xThreshold) < window)
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ x: e.x, text: e.text.trim() }))
      .filter((e) => e.text.length > 0);
    if (!within.length) return null;
    type Cand = { x: number; text: string };
    const cands: Cand[] = [];
    for (const t of within) if (this.isPriceLike(t.text)) cands.push(t);
    for (let i = 0; i < within.length - 1; i++) {
      const merged = `${within[i].text}${within[i + 1].text}`;
      if (this.isPriceLike(merged))
        cands.push({ x: (within[i].x + within[i + 1].x) / 2, text: merged });
    }
    if (cands.length) {
      const best = cands.reduce(
        (b, cur) =>
          Math.abs(cur.x - xThreshold) < Math.abs(b.x - xThreshold) ? cur : b,
        cands[0],
      );
      const v = this.parsePrice(best.text);
      if (v || v === 0) return v;
    }
    for (const t of within) {
      const v = this.parsePrice(t.text);
      if (v || v === 0) return v;
    }
    const all = within.map((t) => t.text).join("");
    if (this.isPriceLike(all)) {
      const v = this.parsePrice(all);
      if (v || v === 0) return v;
    }
    return null;
  }

  private parseNumber(text: string): number | null {
    const t = text.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  }
  private isPriceLike(text: string): boolean {
    if (!text) return false;
    const t = text.trim();
    return (
      /^-?\d{1,3}(?:[\s.,]\d{3})*[.,]\d{2,}$/.test(t) ||
      /^-?\d+[.,]\d{2,}$/.test(t)
    );
  }
  private parsePrice(text: string): number {
    let s = text.trim();
    if (!s) return 0;
    s = s.replace(/[€$£%]/g, "").replace(/\s+/g, "");
    const neg = s.startsWith("-");
    if (neg) s = s.substring(1);
    const m = s.match(/(.*?)[.,](\d{2})$/);
    if (!m) {
      const d = s.replace(/[^0-9]/g, "");
      if (!d) return 0;
      const cents = parseInt(d, 10) * 100;
      return (neg ? -cents : cents) / 100;
    }
    const intPart = (m[1] || "").replace(/[.,]/g, "");
    const dec = m[2];
    if (!/^[0-9]+$/.test(intPart) || !/^[0-9]{2}$/.test(dec)) return 0;
    let cents = parseInt(intPart, 10) * 100 + parseInt(dec, 10);
    if (neg) cents = -cents;
    return cents / 100;
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

// Maiavie (Dolibarr, FR) invoice parser
class MaiavieParser implements InvoiceParser {
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

      // Detect table header and approximate column thresholds
      const thresholds: { [key: string]: number } = {};
      let headerY = -Infinity;
      for (const line of textLines) {
        const up = line.text.toUpperCase();
        // Dolibarr FR/EN header variants
        const looksLikeHeader =
          ((up.includes("DÉSIGNATION") ||
            up.includes("DESIGNATION") ||
            up.includes("LIBELL") ||
            up.includes("LIBELLÉ") ||
            up.includes("LABEL") ||
            up.includes("DESCRIPTION")) &&
            (up.includes("PU") || up.includes("UNIT") || up.includes("P.U")) &&
            (up.includes("PRIX HT") ||
              up.includes("MONTANT HT") ||
              up.includes("TOTAL HT") ||
              up.includes("AMOUNT") ||
              up.includes("TOTAL"))) ||
          // Sometimes headers are split; fallback if we see multiple typical header tokens
          (up.includes("REF") &&
            (up.includes("Q.") || up.includes("QTY")) &&
            (up.includes("PU") || up.includes("UNIT")));
        if (!looksLikeHeader) continue;

        headerY = line.yPosition;
        const items = [...line.items].sort((a, b) => a.x - b.x);
        for (const el of items) {
          const t = el.text.toLowerCase();
          if (
            t.includes("réf") ||
            t === "ref" ||
            t.includes("code") ||
            t.includes("sku")
          )
            thresholds.sku = el.x;
          else if (
            t.includes("libell") ||
            t.includes("label") ||
            t.includes("description") ||
            t.includes("désign") ||
            t.includes("design")
          )
            thresholds.description = el.x;
          else if (
            t === "q." ||
            t.startsWith("q ") ||
            t.includes("quant") ||
            t.includes("qty") ||
            t.includes("qt") ||
            t.includes("qte") ||
            t.includes("qté")
          )
            thresholds.quantity = el.x;
          else if (
            t === "pu" ||
            (t.includes("unit") && t.includes("price")) ||
            t.includes("p.u")
          )
            thresholds.unitPrice = el.x;
          else if (
            t.includes("prix ht") ||
            t.includes("montant ht") ||
            t.includes("total") ||
            t.includes("amount")
          )
            thresholds.total = el.x;
        }
        break;
      }

      // Try strict header-based continuation parsing
      const parsed = this.parseDolibarrByHeaderContinuations(
        textLines,
        thresholds,
        headerY,
      );
      if (parsed.length > 0) {
        result.lineItems = parsed;
      } else {
        // Fallbacks
        const alt = this.parseDolibarrHyphenStreaming(textLines, headerY);
        if (alt.length > 0) {
          result.lineItems = alt;
        } else {
          result.lineItems = this.parseDolibarrHyphenForward(
            textLines,
            headerY,
          );
        }
      }
      return {
        success: true,
        data: result,
        warnings:
          (result.lineItems?.length ?? 0) === 0
            ? ["No line items parsed for Maiavie"]
            : undefined,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Maiavie parsing failed",
      };
    }
  }

  private parseDolibarrByHeaderContinuations(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
    thresholds: { [key: string]: number },
    headerY: number,
  ): Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }> {
    if (
      thresholds.description == null ||
      thresholds.unitPrice == null ||
      thresholds.total == null
    )
      return [];
    const out: Array<{
      supplierSku: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }> = [];

    let current: {
      sku: string;
      descParts: string[];
      qty?: number;
      unit?: number;
      tot?: number;
    } | null = null;

    const isFooter = (s: string) =>
      /total ht|total ttc|tva|net|règlement|reglement/i.test(s);

    for (const line of textLines) {
      if (line.yPosition <= headerY + 0.1) continue;
      const up = (line.text || "").toUpperCase();
      if (isFooter(up)) break;

      const els = [...line.items]
        .map((e) => ({ x: e.x, text: (e.text || "").trim() }))
        .filter((e) => e.text.length > 0)
        .sort((a, b) => a.x - b.x);
      if (!els.length) continue;

      const near = (x?: number, w = 2.5) =>
        x == null
          ? []
          : els.filter((e) => Math.abs(e.x - x) < w).map((e) => e.text);

      const unitHere = near(thresholds.unitPrice).find((t) =>
        this.isPriceLike(t),
      );
      const qtyHere = near(thresholds.quantity).find((t) => /^\d+$/.test(t));
      const totalHere = near(thresholds.total).find((t) => this.isPriceLike(t));
      const isPriceRow = !!unitHere && !!totalHere;

      if (isPriceRow) {
        // Flush previous
        if (
          current &&
          current.qty != null &&
          current.unit != null &&
          current.tot != null
        ) {
          out.push({
            supplierSku: current.sku,
            description:
              current.descParts.join(" ").replace(/\s+/g, " ").trim() ||
              undefined,
            quantity: current.qty,
            unitPrice: current.unit,
            total: current.tot,
          });
        }

        // Parse first token as "SKU - Desc"
        const left = els[0]?.text || "";
        let sku = "-";
        let firstDesc = "";
        const dash = left.indexOf("-");
        if (dash > 0) {
          sku = left.substring(0, dash).trim();
          firstDesc = left.substring(dash + 1).trim();
        } else {
          sku = left.trim();
        }
        const unit = this.parsePrice(unitHere!);
        let tot = this.parsePrice(totalHere!);
        if (tot == null) {
          const rm = this.extractRightmostPriceFromLine(line.items);
          if (rm != null) tot = rm;
        }
        let qty = qtyHere
          ? (this.parseNumber(qtyHere) ?? undefined)
          : undefined;
        if (
          (qty == null || qty === 0) &&
          unit != null &&
          tot != null &&
          unit !== 0
        ) {
          const q = Math.round((tot / unit) * 100) / 100;
          const qi = Math.round(q);
          if (qi > 0 && Math.abs(q - qi) < 0.05) qty = qi;
        }
        if (qty == null || qty === 0) qty = 1;

        current = {
          sku,
          descParts: firstDesc ? [firstDesc] : [],
          qty,
          unit: unit ?? undefined,
          tot: tot ?? undefined,
        };
        continue;
      }

      // Not a price row: if only left-column content, treat as continuation description
      if (current) {
        const rightTouched = els.some(
          (e) =>
            (thresholds.unitPrice != null &&
              e.x >= thresholds.unitPrice - 1.0) ||
            (thresholds.quantity != null && e.x >= thresholds.quantity - 1.0) ||
            (thresholds.total != null && e.x >= thresholds.total - 1.0),
        );
        if (!rightTouched) {
          const extra = this.collectPlainText(line.items);
          if (extra) current.descParts.push(extra);
        }
      }
    }

    // Flush last
    if (
      current &&
      current.qty != null &&
      current.unit != null &&
      current.tot != null
    ) {
      out.push({
        supplierSku: current.sku,
        description:
          current.descParts.join(" ").replace(/\s+/g, " ").trim() || undefined,
        quantity: current.qty,
        unitPrice: current.unit,
        total: current.tot,
      });
    }
    return out;
  }
  // Dolibarr forward scan: find "SKU - Desc" line, then scan forward for the first price row
  private parseDolibarrHyphenForward(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
    headerY: number,
  ): Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }> {
    const lines = textLines
      .filter((l) => l.yPosition > headerY + 0.1)
      .map((l) => ({
        items: [...l.items].sort((a, b) => a.x - b.x),
        text: [...l.items]
          .sort((a, b) => a.x - b.x)
          .map((e) => (e.text || "").trim())
          .filter(Boolean)
          .join(" "),
      }));
    const isMeta = (t: string) =>
      /\btva\b/i.test(t) || /\bvat\b/i.test(t) || /%/.test(t);
    const out: Array<{
      supplierSku: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }> = [];

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].text.trim();
      if (!t || isMeta(t)) continue;
      const m = t.match(/^\s*([A-Za-z0-9]+)\s*[-–—]\s*(.+)$/);
      if (!m) continue;
      const sku = m[1].trim();
      const descParts: string[] = [m[2].trim()];
      // accumulate description lines until price row
      let unit: number | null = null;
      let tot: number | null = null;
      let qty: number | null = null;
      let j = i + 1;
      for (; j < lines.length; j++) {
        const tj = lines[j].text.trim();
        if (!tj) continue;
        if (isMeta(tj)) continue;
        const prices = this.extractPricesWithX(lines[j].items);
        if (prices.length === 0) {
          const extra = this.collectPlainText(lines[j].items);
          if (extra) descParts.push(extra);
          continue;
        }
        // price row
        const right = prices.reduce((b, c) => (c.x > b.x ? c : b));
        tot = right.val;
        const lefts = prices.filter((p) => p.x < right.x);
        if (lefts.length)
          unit = lefts.reduce((b, c) => (c.x > b.x ? c : b)).val;
        if (unit == null && prices.length >= 2) unit = prices[0].val;
        const firstPriceX = prices.map((p) => p.x).sort((a, b) => a - b)[0];
        qty = this.extractRightmostIntegerLeftOf(lines[j].items, firstPriceX);
        if ((qty == null || qty === 0) && unit && tot && unit !== 0) {
          const q = Math.round((tot / unit) * 100) / 100;
          const qi = Math.round(q);
          if (qi > 0 && Math.abs(q - qi) < 0.05) qty = qi;
        }
        if (qty == null || qty === 0) qty = 1;
        break;
      }
      if (unit != null && tot != null && qty != null) {
        const description = descParts.join(" ").replace(/\s+/g, " ").trim();
        out.push({
          supplierSku: sku || "-",
          description: description || undefined,
          quantity: qty,
          unitPrice: unit,
          total: tot,
        });
        i = j; // jump past price row
      }
    }
    return out;
  }

  // Dolibarr: rows start with "SKU - Description" followed by a price row with Qte / PU / Montant HT
  private parseDolibarrHyphenStreaming(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
    headerY: number,
  ): Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }> {
    const lines = textLines
      .filter((l) => l.yPosition > headerY + 0.1)
      .map((l) => ({
        items: [...l.items].sort((a, b) => a.x - b.x),
        text: [...l.items]
          .sort((a, b) => a.x - b.x)
          .map((e) => (e.text || "").trim())
          .filter(Boolean)
          .join(" "),
      }));
    const results: Array<{
      supplierSku: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }> = [];

    const isMeta = (t: string) =>
      /\btva\b/i.test(t) || /\bvat\b/i.test(t) || /%/.test(t);

    // Price-anchored scan: each price row forms an item; look upwards for "SKU - desc" and collect interim description lines
    for (let j = 0; j < lines.length; j++) {
      const prices = this.extractPricesWithX(lines[j].items);
      if (prices.length === 0) continue;
      const right = prices.reduce((b, c) => (c.x > b.x ? c : b));
      let tot: number | null = right.val;
      let unit: number | null = null;
      const lefts = prices.filter((p) => p.x < right.x);
      if (lefts.length) unit = lefts.reduce((b, c) => (c.x > b.x ? c : b)).val;
      if (unit == null && prices.length >= 2) unit = prices[0].val;
      const firstPriceX = prices.map((p) => p.x).sort((a, b) => a - b)[0];
      let qty = this.extractRightmostIntegerLeftOf(lines[j].items, firstPriceX);
      let sku: string | null = null;
      const descParts: string[] = [];
      const backLimit = Math.max(0, j - 12);
      for (let i = j - 1; i >= backLimit; i--) {
        const t = lines[i].text.trim();
        if (!t) continue;
        if (isMeta(t)) continue;
        const toks = lines[i].items
          .map((e) => (e.text || "").trim())
          .filter(Boolean);
        const di = toks.findIndex((s) => s === "-" || s === "–" || s === "—");
        if (di > 0) {
          let skuTok = "";
          for (let k = di - 1; k >= 0; k--) {
            const s = toks[k];
            const sl = s.toLowerCase();
            if (/^réf\.?$/i.test(sl) || /^ref\.?$/i.test(sl)) continue;
            if (/^[A-Za-z0-9]+$/.test(s)) {
              skuTok = s;
              break;
            }
          }
          if (skuTok) {
            sku = skuTok;
            const after =
              di + 1 < toks.length
                ? toks
                    .slice(di + 1)
                    .join(" ")
                    .trim()
                : "";
            if (after) descParts.unshift(after);
            for (let k = i + 1; k < j; k++) {
              const extra = this.collectPlainText(lines[k].items);
              if (extra) descParts.push(extra);
            }
            break;
          }
        } else {
          const exPrices = this.extractPricesWithX(lines[i].items);
          if (exPrices.length === 0) {
            const extra = this.collectPlainText(lines[i].items);
            if (extra) descParts.unshift(extra);
          }
        }
      }
      // If not found above, look below the price row for hyphenized title and description fragments
      if (!sku) {
        const fwdLimit = Math.min(lines.length - 1, j + 8);
        let foundAt = -1;
        for (let i = j + 1; i <= fwdLimit; i++) {
          const t = lines[i].text.trim();
          if (!t) continue;
          if (isMeta(t)) continue;
          const toks = lines[i].items
            .map((e) => (e.text || "").trim())
            .filter(Boolean);
          const di = toks.findIndex((s) => s === "-" || s === "–" || s === "—");
          if (di > 0) {
            let skuTok = "";
            for (let k = di - 1; k >= 0; k--) {
              const s = toks[k];
              const sl = s.toLowerCase();
              if (/^réf\.?$/i.test(sl) || /^ref\.?$/i.test(sl)) continue;
              if (/^[A-Za-z0-9]+$/.test(s)) {
                skuTok = s;
                break;
              }
            }
            if (skuTok) {
              sku = skuTok;
              const after =
                di + 1 < toks.length
                  ? toks
                      .slice(di + 1)
                      .join(" ")
                      .trim()
                  : "";
              if (after) descParts.push(after);
              foundAt = i;
              break;
            }
          }
        }
        if (foundAt !== -1) {
          for (
            let k = foundAt + 1;
            k < Math.min(lines.length, foundAt + 6);
            k++
          ) {
            const extraPrices = this.extractPricesWithX(lines[k].items);
            if (extraPrices.length) break; // next item starts
            const extra = this.collectPlainText(lines[k].items);
            if (extra) descParts.push(extra);
          }
        }
      }
      if (!sku) continue;
      if ((qty == null || qty === 0) && unit && tot && unit !== 0) {
        const q = Math.round((tot / unit) * 100) / 100;
        const qi = Math.round(q);
        if (qi > 0 && Math.abs(q - qi) < 0.05) qty = qi;
      }
      if (qty == null || qty === 0) qty = 1;
      const description = descParts.join(" ").replace(/\s+/g, " ").trim();
      results.push({
        supplierSku: sku,
        description: description || undefined,
        quantity: qty,
        unitPrice: unit ?? 0,
        total: tot ?? 0,
      });
    }
    return results;
  }

  private collectPlainText(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
  ): string {
    return [...elements]
      .sort((a, b) => a.x - b.x)
      .map((e) => (e.text || "").trim())
      .filter((t) => {
        if (!t) return false;
        const tl = t.toLowerCase();
        if (/^\d+(?:[.,]\d+)?%$/.test(t.replace(/\s+/g, ""))) return false;
        if (this.isPriceLike(t)) return false;
        if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
        if (tl === "pu" || tl === "q." || /\bqty?\b/i.test(tl)) return false;
        return true;
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractPricesWithX(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
  ): Array<{ x: number; val: number }> {
    const toks = [...elements]
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ x: e.x, t: (e.text || "").trim() }))
      .filter((e) => e.t.length > 0);
    const groups: Array<{ x: number; text: string }> = [];
    let cur = "";
    let startX = 0;
    let prevX = Number.NEGATIVE_INFINITY;
    const isFrag = (s: string) => /^[0-9]+$/.test(s) || /^[.,]$/.test(s);
    for (const tok of toks) {
      const s = tok.t;
      if (isFrag(s)) {
        if (cur && tok.x - prevX > 1.2) {
          groups.push({ x: startX, text: cur });
          cur = "";
        }
        if (!cur) startX = tok.x;
        cur += s;
        prevX = tok.x;
      } else if (this.isPriceLike(s)) {
        groups.push({ x: tok.x, text: s });
        cur = "";
        prevX = Number.NEGATIVE_INFINITY;
      } else {
        if (cur) {
          groups.push({ x: startX, text: cur });
          cur = "";
        }
        prevX = Number.NEGATIVE_INFINITY;
      }
    }
    if (cur) groups.push({ x: startX, text: cur });
    const out: Array<{ x: number; val: number }> = [];
    for (const g of groups) {
      const v = this.parsePrice(g.text);
      if (v != null) out.push({ x: g.x, val: v });
    }
    return out;
  }

  private extractRightmostIntegerLeftOf(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    limitX: number,
  ): number | null {
    const toks = [...elements]
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ x: e.x, t: (e.text || "").trim() }))
      .filter((e) => e.t.length > 0 && e.x < limitX);
    const ints = toks.filter((e) => /^\d+$/.test(e.t));
    if (!ints.length) return null;
    const right = ints.reduce((b, c) => (c.x > b.x ? c : b));
    const n = parseInt(right.t, 10);
    return isNaN(n) ? null : n;
  }

  private extractRightmostPriceFromLine(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
  ): number | null {
    // Build a space-joined line of tokens, then find the rightmost price like 7 390,39 or 7390,39 or 7,390.39
    const lineText = elements
      .map((e) => (e.text || "").trim())
      .filter((t) => t.length > 0)
      .join(" ");
    // Match prices with optional thousand groups separated by spaces, commas or periods
    const regex = /(\d{1,3}(?:[\s.,]\d{3})*[.,]\d{2})/g;
    let match: RegExpExecArray | null;
    let last: string | null = null;
    while ((match = regex.exec(lineText)) !== null) {
      last = match[1];
    }
    if (!last) return null;
    // Normalize by removing spaces then parse
    const normalized = last.replace(/\s+/g, "");
    return this.parsePrice(normalized);
  }

  private collectDescriptionTokens(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    thresholds: { [key: string]: number },
  ): string[] {
    if (thresholds.description == null) return [];
    const left = thresholds.description - 0.5;
    const right =
      thresholds.quantity != null
        ? thresholds.quantity - 0.5
        : thresholds.unitPrice != null
          ? thresholds.unitPrice - 0.5
          : undefined;
    const els = [...elements]
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ x: e.x, text: (e.text || "").trim() }))
      .filter((e) => e.text.length > 0);
    const inRange = els.filter((e) => {
      if (e.x < left) return false;
      if (right != null && e.x >= right) return false;
      return true;
    });
    const tokens = inRange
      .map((e) => e.text)
      .filter((t) => {
        const tl = t.toLowerCase();
        if (!t) return false;
        if (/^q\.?$/.test(tl)) return false;
        if (tl === "pu") return false;
        if (/^\d+(?:[.,]\d+)?%$/.test(t.replace(/\s+/g, ""))) return false; // drop VAT % like 5,5%
        if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
        if (/^-?\d{1,3}(?:[\s.,]\d{3})*[.,]\d{2,}$/.test(t)) return false;
        return true;
      });
    return tokens;
  }

  private parseRow(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    thresholds: { [key: string]: number },
  ) {
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
    if (!sku) sku = "-";

    // Description
    let description = "";
    if (thresholds.description != null && thresholds.quantity != null) {
      const parts = els
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
          if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
          if (this.isPriceLike(t)) return false;
          return true;
        });
      description = parts.join(" ").replace(/\s+/g, " ").trim();
    }

    // Quantity
    let quantity: number | null = null;
    const qtyCands = getNear(thresholds.quantity) || [];
    for (const q of qtyCands) {
      const n = this.parseNumber(q);
      if (n != null) {
        quantity = n;
        break;
      }
    }

    // Prices
    let unitPrice = this.parsePriceNearColumn(els, thresholds.unitPrice);
    let total = this.parsePriceNearColumn(els, thresholds.total);
    if ((unitPrice == null || total == null) && thresholds.quantity != null) {
      const priceTokens = els
        .filter((e) => e.x > thresholds.quantity!)
        .map((e) => e.text.trim())
        .filter((t) => this.isPriceLike(t));
      if (unitPrice == null && priceTokens.length >= 1)
        unitPrice = this.parsePrice(priceTokens[0]);
      if (total == null && priceTokens.length >= 1)
        total = this.parsePrice(priceTokens[priceTokens.length - 1]);
    }

    // Derive quantity from prices if missing; last resort assume 1
    if (
      (quantity == null || quantity === 0) &&
      unitPrice != null &&
      total != null &&
      unitPrice !== 0
    ) {
      const q = Math.round((total / unitPrice) * 100) / 100;
      const qi = Math.round(q);
      if (qi > 0 && Math.abs(q - qi) < 0.05) quantity = qi;
    }

    if (unitPrice == null || total == null) return null;
    if (quantity == null || quantity === 0) quantity = 1;

    return {
      supplierSku: sku,
      description: description || undefined,
      quantity,
      unitPrice,
      total,
    };
  }

  private parseByGlobalHeuristics(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
    headerY: number,
  ): Array<{
    supplierSku: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }> {
    const tol = 0.5;
    const rowsMap = new Map<
      number,
      Array<{ x: number; y: number; text: string }>
    >();
    for (const line of textLines) {
      if (headerY !== -Infinity && line.yPosition <= headerY + 0.1) continue;
      const up = line.text.toUpperCase();
      if (
        up.includes("TOTAL HT") ||
        up.includes("TOTAL TTC") ||
        up.includes("TVA") ||
        up.includes("NET") ||
        up.includes("RÈGLEMENT") ||
        up.includes("REGLEMENT")
      ) {
        continue;
      }
      for (const it of line.items) {
        const t = (it.text || "").trim();
        if (!t) continue;
        const key = Math.round(it.y / tol) * tol;
        const row = rowsMap.get(key) || [];
        row.push({ x: it.x, y: it.y, text: t });
        rowsMap.set(key, row);
      }
    }
    const ys = [...rowsMap.keys()].sort((a, b) => a - b);
    const results: Array<{
      supplierSku: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      total: number;
    }> = [];
    for (const y of ys) {
      const row = (rowsMap.get(y) || [])
        .map((e) => ({ x: e.x, text: e.text.trim() }))
        .filter((e) => e.text.length > 0)
        .sort((a, b) => a.x - b.x);
      if (!row.length) continue;

      // Price-like tokens (including merged neighbors)
      type Tok = { x: number; text: string };
      const priceCands: Tok[] = [];
      for (const tok of row)
        if (this.isPriceLike(tok.text)) priceCands.push(tok);
      for (let i = 0; i < row.length - 1; i++) {
        const merged = `${row[i].text}${row[i + 1].text}`;
        if (this.isPriceLike(merged))
          priceCands.push({ x: (row[i].x + row[i + 1].x) / 2, text: merged });
      }
      if (priceCands.length === 0) continue;
      const unitPrice = this.parsePrice(priceCands[0].text);
      const total = this.parsePrice(priceCands[priceCands.length - 1].text);
      const priceX = priceCands[0].x;

      // Quantity: rightmost integer left of first price; else derive; else 1
      const intLeft = row.filter((e) => e.x < priceX && /^\d+$/.test(e.text));
      let quantity: number | null = null;
      if (intLeft.length) {
        const rightmost = [...intLeft].sort((a, b) => b.x - a.x)[0];
        quantity = this.parseNumber(rightmost.text);
      }
      if (
        (quantity == null || quantity === 0) &&
        unitPrice &&
        total &&
        unitPrice !== 0
      ) {
        const q = Math.round((total / unitPrice) * 100) / 100;
        const qi = Math.round(q);
        if (qi > 0 && Math.abs(q - qi) < 0.05) quantity = qi;
      }
      if (quantity == null || quantity === 0) quantity = 1;

      // SKU: first clean token left of first price
      let sku = "-";
      const leftSide = row.filter((e) => e.x < priceX);
      for (const t of leftSide) {
        if (/^[A-Za-z0-9_.\-]+$/.test(t.text)) {
          sku = t.text;
          break;
        }
      }

      // Description: between sku and price, excluding numbers/price markers
      const skuX =
        leftSide.find((e) => e.text === sku)?.x ?? leftSide[0]?.x ?? 0;
      const descParts = row
        .filter((e) => e.x > skuX && e.x < priceX)
        .map((e) => e.text)
        .filter((t) => {
          const tl = t.toLowerCase();
          if (this.isPriceLike(t)) return false;
          if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
          if (/^q\.?$/i.test(tl)) return false;
          if (tl === "pu") return false;
          return true;
        });
      const description = descParts.join(" ").replace(/\s+/g, " ").trim();

      results.push({
        supplierSku: sku,
        description: description || undefined,
        quantity,
        unitPrice: unitPrice ?? 0,
        total,
      });
    }
    return results;
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
        if (/^-?\d+(?:[.,]\d+)?$/.test(t)) return false;
        if (/^-?\d{1,3}(?:[.,]\d{3})*[.,]\d{2,}$/.test(t)) return false;
        return true;
      });
    return texts.join(" ").replace(/\s+/g, " ").trim();
  }

  private parsePriceNearColumn(
    elements: Array<{ x: number; y: number; text: string; fontSize?: number }>,
    xThreshold?: number,
  ): number | null {
    if (xThreshold == null) return null;
    const window = 3.5;
    const within = elements
      .filter((e) => Math.abs(e.x - xThreshold) < window)
      .sort((a, b) => a.x - b.x)
      .map((e) => ({ x: e.x, text: e.text.trim() }))
      .filter((e) => e.text.length > 0);
    if (within.length === 0) return null;

    type Cand = { x: number; text: string };
    const candidates: Cand[] = [];
    for (const tok of within)
      if (this.isPriceLike(tok.text)) candidates.push(tok);
    for (let i = 0; i < within.length - 1; i++) {
      const merged = `${within[i].text}${within[i + 1].text}`;
      if (this.isPriceLike(merged))
        candidates.push({
          x: (within[i].x + within[i + 1].x) / 2,
          text: merged,
        });
    }
    if (candidates.length) {
      const best = candidates.reduce(
        (b, c) =>
          Math.abs(c.x - xThreshold) < Math.abs(b.x - xThreshold) ? c : b,
        candidates[0],
      );
      const v = this.parsePrice(best.text);
      if (v || v === 0) return v;
    }
    for (const tok of within) {
      const v = this.parsePrice(tok.text);
      if (v || v === 0) return v;
    }
    const all = within.map((t) => t.text).join("");
    if (this.isPriceLike(all)) {
      const v = this.parsePrice(all);
      if (v || v === 0) return v;
    }
    return null;
  }

  private parseNumber(text: string): number | null {
    const t = text.replace(/\s/g, "").replace(",", ".");
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  }

  private parsePrice(priceText: string): number {
    let s = priceText.trim();
    if (!s) return 0;
    s = s.replace(/[€$£%]/g, "").replace(/\s+/g, "");
    const neg = s.startsWith("-");
    if (neg) s = s.substring(1);
    const m = s.match(/(.*?)[.,](\d{2})$/);
    if (!m) {
      const d = s.replace(/[^0-9]/g, "");
      if (!d) return 0;
      const cents = parseInt(d, 10) * 100;
      return (neg ? -cents : cents) / 100;
    }
    const intPart = (m[1] || "").replace(/[.,]/g, "");
    const dec = m[2];
    if (!/^[0-9]+$/.test(intPart) || !/^[0-9]{2}$/.test(dec)) return 0;
    let cents = parseInt(intPart, 10) * 100 + parseInt(dec, 10);
    if (neg) cents = -cents;
    return cents / 100;
  }

  private isPriceLike(text: string): boolean {
    if (!text) return false;
    const t = text.trim();
    return (
      /^-?\d{1,3}(?:[\s.,]\d{3})*[.,]\d{2,}$/.test(t) ||
      /^-?\d+[.,]\d{2,}$/.test(t)
    );
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
          // Treat shipping line (e.g., "PORT FRAIS DE PORT") as shipping fee, not a product item
          const descLower = (row.description || "").toLowerCase();
          const lineLower = line.text.toLowerCase();
          const isShippingLine =
            descLower.includes("frais de port") ||
            descLower.includes("port frais de port") ||
            lineLower.includes("frais de port") ||
            lineLower.includes("livraison");
          if (isShippingLine) {
            const fee =
              typeof row.total === "number" && row.total > 0
                ? row.total
                : typeof row.unitPrice === "number" && row.unitPrice > 0
                  ? row.unitPrice
                  : 0;
            if (fee > 0) {
              // Prefer the detected fee; do not duplicate as a line item
              result.invoiceMetadata.shippingFee = fee;
            }
            continue;
          }

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

  // Heuristic inference for Bolero when header not matched
  // Exposed with a name that's robust to minification when called via any
  private _inferBoleroThresholdsFromData(
    textLines: Array<{
      yPosition: number;
      text: string;
      items: Array<{ x: number; y: number; text: string; fontSize?: number }>;
    }>,
    thresholds: { [key: string]: number },
  ) {
    // Scan lines and pick the rightmost two price-like X as unitPrice and total; leftmost integer as quantity; earliest text as description
    const priceXs: number[] = [];
    for (const line of textLines) {
      const prices = line.items
        .map((it) => ({ x: it.x, t: it.text.trim() }))
        .filter((it) => this.isPriceLike(it.t))
        .sort((a, b) => a.x - b.x);
      if (prices.length >= 2) {
        // Accumulate typical positions
        priceXs.push(prices[prices.length - 2].x); // candidate unit price
        priceXs.push(prices[prices.length - 1].x); // candidate total
      }
    }
    if (priceXs.length >= 2) {
      // Use median-ish by sorting
      priceXs.sort((a, b) => a - b);
      const mid = Math.floor(priceXs.length / 2);
      thresholds.unitPrice = priceXs[mid - 1] ?? priceXs[0];
      thresholds.total = priceXs[mid] ?? priceXs[priceXs.length - 1];
    }
    // Quantity: try to find a common integer X to the left of unit price
    if (thresholds.unitPrice != null) {
      const qtyXs: number[] = [];
      for (const line of textLines) {
        const ints = line.items
          .filter((it) => it.x < thresholds.unitPrice!)
          .map((it) => it.text.trim())
          .filter((t) => /^\d+$/.test(t));
        if (ints.length > 0) {
          // Take the rightmost integer before unit price as likely quantity
          const rightmost = line.items
            .filter(
              (it) =>
                /^\d+$/.test(it.text.trim()) && it.x < thresholds.unitPrice!,
            )
            .sort((a, b) => b.x - a.x)[0];
          if (rightmost) qtyXs.push(rightmost.x);
        }
      }
      if (qtyXs.length) {
        qtyXs.sort((a, b) => a - b);
        thresholds.quantity = qtyXs[Math.floor(qtyXs.length / 2)];
      }
    }
    // Description: choose a common left-side block
    if (thresholds.quantity != null) {
      thresholds.description =
        thresholds.description ?? thresholds.quantity - 10;
    }
  }
}
