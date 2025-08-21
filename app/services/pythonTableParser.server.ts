import { PdfExtractionResult, ParsedInvoiceData } from './pdfParsing.server';
import { extractPdfTablesEnhanced } from './pythonPdfExtractor.server';

// Define types for Python extraction results
interface PythonTable {
  page: number | string;
  method: string;
  table_number: number;
  shape: [number, number];
  data: any[][];
  headers: string[];
}

interface PythonExtractionResult {
  tables?: PythonTable[];
  total_found?: number;
  method?: string;
  error?: string;
}

/**
 * Python-based parser for complex PDF tables
 * This parser uses Python libraries for better table extraction
 */
export class PythonTableParser {
  async parse(pdfPath: string): Promise<PdfExtractionResult> {
    try {
      console.log('🐍 Using Python-based table extraction');
      
      // Extract tables using Python libraries
      const tableResult = await extractPdfTablesEnhanced(pdfPath);
      
      if (!tableResult.tables || tableResult.tables.length === 0) {
        return {
          success: false,
          error: 'No tables found in PDF using Python extraction'
        };
      }
      
      console.log(`🐍 Found ${tableResult.tables.length} tables using Python extraction`);
      
      // Convert extracted tables to our invoice format
      const parsedData = this.convertTablesToInvoiceData(tableResult.tables);
      
      return {
        success: true,
        data: parsedData
      };
      
    } catch (error: any) {
      console.error('🐍 Python table parsing failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Python table parsing failed'
      };
    }
  }
  
  /**
   * Convert extracted tables to our invoice data format
   * @param tables - Array of extracted tables
   * @returns ParsedInvoiceData
   */
  private convertTablesToInvoiceData(tables: PythonTable[]): ParsedInvoiceData {
    const result: ParsedInvoiceData = {
      supplierInfo: {},
      invoiceMetadata: {
        currency: "EUR",
        shippingFee: 0
      },
      lineItems: []
    };
    
    console.log(`🐍 Converting ${tables.length} tables to invoice data`);
    
    // Process each table to find line items
    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      console.log(`🐍 Processing table ${i}:`, JSON.stringify(table, null, 2));
      const lineItems = this.parseTableForLineItems(table);
      console.log(`🐍 Found ${lineItems.length} line items in table ${i}`);
      result.lineItems.push(...lineItems);
    }
    
    // Try to extract metadata from any table
    this.extractMetadataFromTables(tables, result);
    
    console.log(`🐍 Final result: ${result.lineItems.length} line items, shipping fee: €${result.invoiceMetadata.shippingFee}`);
    
    return result;
  }
  
  /**
   * Parse a single table for line items
   * @param table - Extracted table data
   * @returns Array of line items
   */
  private parseTableForLineItems(table: PythonTable): any[] {
    const lineItems: any[] = [];
    
    if (!table.data || !Array.isArray(table.data)) {
      return lineItems;
    }
    
    // Get headers if available
    const headers = table.headers || [];
    const dataRows = table.data;
    
    // Special handling for Yamamoto format (single row with newline-separated values)
    if (this.isYamamotoFormat(dataRows)) {
      console.log('🐍 Detected Yamamoto format table');
      return this.parseYamamotoFormat(dataRows);
    }
    
    // Special handling for Rabeko format (French headers)
    if (this.isRabekoFormat(headers, dataRows)) {
      console.log('🐍 Detected Rabeko format table');
      return this.parseRabekoFormat(dataRows, headers);
    }
    
    // Try to identify column positions
    const columnMap = this.identifyColumns(headers, dataRows);
    
    // Check if this is a Swanson table (has specific headers)
    const isSwansonTable = headers.some(header => 
      String(header).toLowerCase().includes('exp. date') || 
      String(header).toLowerCase().includes('unit price')
    );

    // Check if this is an Addict-like French table
    const isAddictTable = headers.some(header => {
      const h = String(header).toLowerCase();
      return h.includes('libell') || h.includes('prix ht') || h === 'pu' || h === 'q.';
    });
    
    // Process each row
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      // Skip header rows
      if (i === 0 && this.isHeaderRow(row, headers)) {
        continue;
      }
      
      // For Swanson tables, check if this is a shipping row
      if (isSwansonTable && this.isShippingRow(row)) {
        const shippingFee = this.extractShippingFee(row, columnMap);
        // We'll handle shipping fee at the metadata level
        continue;
      }
      
      // Parse row for line item data
      const lineItem = this.parseRow(row, columnMap, isSwansonTable);
      if (lineItem) {
        // For Addict tables, ensure numbers are normalized and compute total if missing
        if (isAddictTable) {
          if (typeof lineItem.unitPrice === 'number' && typeof lineItem.quantity === 'number') {
            lineItem.total = Math.round(lineItem.unitPrice * lineItem.quantity * 100) / 100;
          }
        }
        lineItems.push(lineItem);
      }
    }
    
    return lineItems;
  }
  
  /**
   * Check if this is a Yamamoto format table (single row with newline-separated values)
   * @param dataRows - Table data rows
   * @returns boolean
   */
  private isYamamotoFormat(dataRows: any[][]): boolean {
    // Yamamoto format has 2 rows: header row and a single data row with newline-separated values
    if (dataRows.length !== 2) {
      return false;
    }
    
    // Check if the second row has newline-separated values in multiple columns
    const dataRow = dataRows[1];
    let newlineCount = 0;
    
    // Count columns with newlines
    for (let i = 0; i < Math.min(dataRow.length, 8); i++) { // Check first 8 columns
      const cell = dataRow[i];
      if (cell && String(cell).includes('\n')) {
        newlineCount++;
      }
    }
    
    // If multiple columns have newlines, it's likely Yamamoto format
    return newlineCount >= 3;
  }
  
  /**
   * Parse Yamamoto format table (single row with newline-separated values)
   * @param dataRows - Table data rows
   * @returns Array of line items
   */
  private parseYamamotoFormat(dataRows: any[][]): any[] {
    const lineItems: any[] = [];
    
    if (dataRows.length < 2) {
      return lineItems;
    }
    
    const dataRow = dataRows[1]; // Second row contains all the data
    
    // Extract columns (based on the Yamamoto structure we saw in logs)
    const skus = dataRow[0] ? String(dataRow[0]).split('\n') : [];
    const descriptions = dataRow[1] ? String(dataRow[1]).split('\n') : [];
    const units = dataRow[2] ? String(dataRow[2]).split('\n') : []; // Usually "PZ"
    const quantities = dataRow[3] ? String(dataRow[3]).split('\n') : [];
    const unitPrices = dataRow[4] ? String(dataRow[4]).split('\n') : [];
    const amounts = dataRow[6] ? String(dataRow[6]).split('\n') : []; // Skip index 5 (%DS.)
    const vatCodes = dataRow[7] ? String(dataRow[7]).split('\n') : [];
    
    console.log(`🐍 Found ${skus.length} potential line items in Yamamoto format`);
    
    // Process each line item
    const itemCount = Math.min(
      skus.length, 
      quantities.length, 
      unitPrices.length, 
      amounts.length
    );
    
    for (let i = 0; i < itemCount; i++) {
      try {
        const sku = skus[i]?.trim() || '';
        let description = '';
        const quantityStr = quantities[i]?.trim() || '';
        const unitPriceStr = unitPrices[i]?.trim() || '';
        const amountStr = amounts[i]?.trim() || '';
        
        // Validate SKU format
        if (!sku || !/^(IAF|FITT|YAM)[A-Z0-9]*\d+/.test(sku)) {
          console.log(`🐍 Skipping invalid SKU: \${sku}`);
          continue;
        }
        
        // Handle multi-line descriptions - combine product name with tariff info
        if (descriptions.length > i) {
          // Get the main product description
          description = descriptions[i]?.trim() || '';
          
          // Check if the next line might be tariff info
          if (descriptions.length > i + 1) {
            const nextLine = descriptions[i + 1]?.trim() || '';
            // If it looks like tariff info, append it
            if (nextLine.includes('tariff:') || nextLine.includes('Custom') || nextLine.includes('custom')) {
              description += ' ' + nextLine;
            }
          }
        }
        
        // Parse numbers correctly
        const quantity = this.parseYamamotoQuantity(quantityStr);
        const unitPrice = this.parsePrice(unitPriceStr, true); // Allow multi-digit decimals
        
        if (quantity === null || unitPrice === null) {
          console.log(`🐍 Skipping item with invalid numbers: qty=\${quantityStr}, price=\${unitPriceStr}`);
          continue;
        }
        
        // Calculate the final amount from quantity × unit price
        const calculatedTotal = Math.round((quantity * unitPrice) * 100) / 100;
        
        // Get parsed total for comparison/validation
        const parsedTotal = this.parsePrice(amountStr, true);
        
        console.log(`🐍 Parsed Yamamoto item: \${sku}, qty=\${quantity}, price=\${unitPrice}, calculated_total=\${calculatedTotal}, parsed_total=\${parsedTotal}`);
        
        lineItems.push({
          supplierSku: sku,
          description: description,
          quantity: quantity,
          unitPrice: unitPrice,
          total: calculatedTotal // Use calculated total, not parsed
        });
        
      } catch (error) {
        console.error(`🐍 Error parsing Yamamoto item \${i}:`, error);
      }
    }
    
    return lineItems;
  }
  
  /**
   * Parse Yamamoto quantity string (15,00 → 15)
   * @param qtyStr - Quantity string
   * @returns Parsed quantity or null
   */
  private parseYamamotoQuantity(qtyStr: string): number | null {
    try {
      const cleanStr = qtyStr.trim();
      
      // Handle comma-separated numbers (15,00 → 15)
      if (cleanStr.includes(',')) {
        const parts = cleanStr.split(',');
        // If it ends with ,00 or ,0, it's likely a whole number with decimal zeros
        if (parts.length === 2 && (parts[1] === '00' || parts[1] === '0')) {
          const qty = parseInt(parts[0], 10);
          return isNaN(qty) ? null : qty;
        }
      }
      
      // Parse as regular integer
      const qty = parseInt(cleanStr, 10);
      return isNaN(qty) ? null : qty;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Check if a row is a shipping row
   * @param row - Row data
   * @returns boolean
   */
  private isShippingRow(row: any[]): boolean {
    return row.some(cell => {
      const text = String(cell || '').toLowerCase();
      return text.includes('shipping') || text.includes('spedizione') || 
             text.includes('envío') || text.includes('livraison') ||
             text.includes('transport') || // French/German for shipping
             text.includes('fracht') ||    // German for freight
             text.includes('frais');       // French for fees
    });
  }
  
  /**
   * Extract shipping fee from a shipping row
   * @param row - Row data
   * @param columnMap - Column mapping
   * @returns shipping fee or 0
   */
  private extractShippingFee(row: any[], columnMap: any): number {
    try {
      // Look for price in the amount column first (if we have column mapping)
      if (columnMap.total !== undefined && row[columnMap.total]) {
        const cell = row[columnMap.total];
        const text = String(cell).trim();
        // Look for € amount pattern
        const euroMatch = text.match(/€?\s*(\d+(?:[.,]\d+)?)/i);
        if (euroMatch) {
          const value = this.parsePrice(euroMatch[1]);
          if (value && value > 0) {
            return value;
          }
        }
        // Look for plain decimal number
        const decimalMatch = text.match(/(\d+[.,]\d{2,})/);
        if (decimalMatch) {
          const value = this.parsePrice(decimalMatch[1]);
          if (value && value > 0) {
            return value;
          }
        }
      }
      
      // Fallback: Look for price in any column with price format
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (cell) {
          const text = String(cell).trim();
          // Look for € amount pattern
          const euroMatch = text.match(/€?\s*(\d+(?:[.,]\d+)?)/i);
          if (euroMatch) {
            const value = this.parsePrice(euroMatch[1]);
            if (value && value > 0) {
              return value;
            }
          }
          // Look for plain decimal number
          const decimalMatch = text.match(/(\d+[.,]\d{2,})/);
          if (decimalMatch) {
            const value = this.parsePrice(decimalMatch[1]);
            if (value && value > 0) {
              return value;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error extracting shipping fee:', error);
    }
    return 0;
  }
  
  /**
   * Identify column positions based on headers
   * @param headers - Table headers
   * @param dataRows - Table data rows
   * @returns Column mapping
   */
  private identifyColumns(headers: string[], dataRows: any[][]): any {
    const columnMap: any = {};
    
    // If we have headers, use them
    if (headers.length > 0) {
      headers.forEach((header, index) => {
        const normalized = String(header).toLowerCase();
        // French variants for Addict invoices: Libellé (description), Q. (quantity), PU (unit price), Prix HT (total)
        if (
          normalized.includes('item') ||
          normalized.includes('sku') ||
          normalized.includes('code') ||
          normalized.includes('réf') || // Réf. / reference
          normalized.includes('ref')
        ) {
          columnMap.sku = index;
        } else if (
          normalized.includes('description') ||
          normalized.includes('libell') || // Libellé
          normalized.includes('product') ||
          normalized.includes('name')
        ) {
          columnMap.description = index;
        } else if (
          normalized.includes('qty') ||
          normalized.includes('quantity') ||
          normalized === 'q.' ||
          normalized.startsWith('q ')
        ) {
          columnMap.quantity = index;
        } else if (
          (normalized.includes('unit') && normalized.includes('price')) ||
          normalized.includes('unit price') ||
          normalized === 'pu' // Prix unitaire
        ) {
          columnMap.unitPrice = index;
        } else if (
          normalized.includes('amount') ||
          normalized.includes('total') ||
          normalized.includes('prix ht') || // Prix HT column
          normalized.includes('montant ht')
        ) {
          columnMap.total = index;
        } else if (normalized.includes('exp') && normalized.includes('date')) {
          columnMap.expDate = index;
        }
      });
    }
    
    // If no headers or incomplete mapping, try to infer from data
    if (Object.keys(columnMap).length < 3) {
      this.inferColumnsFromData(dataRows, columnMap);
    }
    
    return columnMap;
  }
  
  /**
   * Infer column positions from data patterns
   * @param dataRows - Table data rows
   * @param columnMap - Existing column mapping to update
   */
  private inferColumnsFromData(dataRows: any[][], columnMap: any): void {
    if (dataRows.length === 0) return;
    
    // Look at first few rows to identify patterns
    const sampleRows = dataRows.slice(0, Math.min(5, dataRows.length));
    const columnCount = dataRows[0].length;
    
    for (let col = 0; col < columnCount; col++) {
      // Skip already mapped columns
      if (Object.values(columnMap).includes(col)) continue;
      
      // Collect sample values from this column
      const values = sampleRows
        .map(row => row[col])
        .filter(val => val != null)
        .map(val => String(val).trim());
      
      if (values.length === 0) continue;
      
      // Check for SKU patterns
      const skuMatches = values.filter(val => /^(IAF|FITT|YAM|SW)[A-Z0-9]*\d+/.test(val));
      if (skuMatches.length >= values.length * 0.6) { // 60% match
        columnMap.sku = col;
        continue;
      }
      // Generic code-like pattern (alphanumeric without spaces, not purely numeric)
      const genericCodeMatches = values.filter(val => /^[A-Za-z0-9\-_.]{3,}$/.test(val) && !/^\d+$/.test(val));
      if (!columnMap.sku && genericCodeMatches.length >= values.length * 0.6) {
        columnMap.sku = col;
        continue;
      }
      
      // Check for quantity patterns (numbers)
      const qtyMatches = values.filter(val => /^\d+(?:[.,]\d+)?$/.test(val));
      if (qtyMatches.length >= values.length * 0.8) { // 80% match
        columnMap.quantity = col;
        continue;
      }
      
      // Check for price patterns (including multi-digit decimals)
      const priceMatches = values.filter(val => /^-?\d+[.,]\d{2,}$/.test(val) || /^€?\s*-?\d+[.,]?\d*$/.test(val));
      if (priceMatches.length >= values.length * 0.6) { // 60% match
        if (columnMap.unitPrice === undefined) {
          columnMap.unitPrice = col;
        } else if (columnMap.total === undefined) {
          columnMap.total = col;
        }
        continue;
      }
    }
  }
  
  /**
   * Check if a row is a header row
   * @param row - Row data
   * @param headers - Headers array
   * @returns boolean
   */
  private isHeaderRow(row: any[], headers: string[]): boolean {
    // If headers match row exactly, it's a header row
    if (headers.length === row.length) {
      return headers.every((header, index) => 
        String(header).toLowerCase() === String(row[index]).toLowerCase()
      );
    }
    return false;
  }
  
  /**
   * Parse a single row for line item data
   * @param row - Row data
   * @param columnMap - Column mapping
   * @param isSwansonTable - Whether this is a Swanson table format
   * @returns Line item object or null
   */
  private parseRow(row: any[], columnMap: any, isSwansonTable: boolean = false): any | null {
    try {
      const lineItem: any = {};
      
      // Extract SKU: if a SKU column is identified, accept any non-empty string (to support suppliers like Addict)
      if (columnMap.sku !== undefined && row[columnMap.sku]) {
        const skuValue = String(row[columnMap.sku]).trim();
        if (skuValue) {
          lineItem.supplierSku = skuValue;
        }
      }
      
      // Extract description
      if (columnMap.description !== undefined && row[columnMap.description]) {
        lineItem.description = String(row[columnMap.description]).trim();
      }
      
      // Extract quantity
      if (columnMap.quantity !== undefined && row[columnMap.quantity]) {
        const qtyValue = String(row[columnMap.quantity]).trim();
        // Support European formats and decimals by normalizing separators
        const normalizedQty = qtyValue.replace(/\s/g, '').replace(',', '.');
        const qty = parseFloat(normalizedQty);
        if (!isNaN(qty)) {
          // Quantities are usually integers; if decimal, keep as number
          lineItem.quantity = qty;
        }
      }
      
      // Extract unit price (handle multi-digit decimals for Swanson)
      if (columnMap.unitPrice !== undefined && row[columnMap.unitPrice]) {
        const priceValue = String(row[columnMap.unitPrice]).trim();
        const price = this.parsePrice(priceValue, isSwansonTable);
        if (price !== null) {
          lineItem.unitPrice = price;
        }
      }
      
      // Extract total
      if (columnMap.total !== undefined && row[columnMap.total]) {
        const totalValue = String(row[columnMap.total]).trim();
        const total = this.parsePrice(totalValue, isSwansonTable);
        if (total !== null) {
          lineItem.total = total;
        }
      }
      
      // If we have at least SKU and quantity, it's a valid line item
      if (lineItem.supplierSku && lineItem.quantity) {
        // Always calculate the total from quantity × unit price
        // This ensures consistency and validates against parsed totals
        if (lineItem.unitPrice !== undefined) {
          lineItem.total = Math.round((lineItem.unitPrice * lineItem.quantity) * 100) / 100;
        } else if (lineItem.total !== undefined && lineItem.quantity !== 0) {
          // Calculate unit price from total and quantity if needed
          lineItem.unitPrice = Math.round((lineItem.total / lineItem.quantity) * 10000) / 10000;
        }
        
        return lineItem;
      }
      
      return null;
    } catch (error) {
      console.error('Error parsing row:', error);
      return null;
    }
  }
  
  /**
   * Parse price string to number with support for multi-digit decimals
   * @param priceStr - Price string
   * @param allowMultiDigitDecimals - Whether to allow more than 2 decimal places
   * @returns Parsed price or null
   */
  private parsePrice(priceStr: string, allowMultiDigitDecimals: boolean = false): number | null {
    try {
      let cleanStr = priceStr.trim();
      
      // Handle negative sign
      const isNegative = cleanStr.startsWith('-');
      if (isNegative) {
        cleanStr = cleanStr.substring(1);
      }
      
      // Remove currency symbols and extra spaces
      cleanStr = cleanStr.replace(/[€$£¥]/g, '').trim();
      
      // Handle thousand separators and decimal separators
      if (cleanStr.includes(',') && cleanStr.includes('.')) {
        // Multiple separators - determine which is thousands vs decimal
        const lastComma = cleanStr.lastIndexOf(',');
        const lastPeriod = cleanStr.lastIndexOf('.');
        
        // The rightmost separator with fewer than 3 digits after is likely decimal
        if (lastComma > lastPeriod) {
          // Format like 1.234,56
          const parts = cleanStr.split(',');
          if (parts[parts.length - 1].length <= 3) {
            // Last part is decimal
            cleanStr = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
          } else {
            // Last comma is thousands
            cleanStr = cleanStr.replace(/,/g, '');
          }
        } else {
          // Format like 1,234.56
          const parts = cleanStr.split('.');
          if (parts[parts.length - 1].length <= 3) {
            // Last part is decimal
            cleanStr = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
          } else {
            // Last period is thousands
            cleanStr = cleanStr.replace(/\./g, '');
          }
        }
      } else if (cleanStr.includes(',')) {
        // Single comma separator
        const parts = cleanStr.split(',');
        if (parts.length === 2 && parts[1].length <= 3) {
          // Decimal separator: 123,45 → 123.45
          cleanStr = parts[0] + '.' + parts[1];
        } else {
          // Thousands separator: 1,234 → 1234
          cleanStr = cleanStr.replace(/,/g, '');
        }
      }
      
      const price = parseFloat(cleanStr);
      if (isNaN(price)) {
        return null;
      }
      
      let result = price;
      if (isNegative) {
        result = -result;
      }
      
      // For Yamamoto/Swanson, we want to preserve multi-digit decimals
      if (allowMultiDigitDecimals) {
        // Round to reasonable precision (up to 4 decimal places)
        return Math.round(result * 10000) / 10000;
      } else {
        // Standard 2 decimal places
        return Math.round(result * 100) / 100;
      }
      
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Extract metadata from tables
   * @param tables - Extracted tables
   * @param result - Parsed invoice data to update
   */
  private extractMetadataFromTables(tables: PythonTable[], result: ParsedInvoiceData): void {
    let maxShippingFee = 0;
    
    // Look through all table data for metadata
    for (const table of tables) {
      if (!table.data || !Array.isArray(table.data)) continue;
      
      // Check headers for shipping information
      if (table.headers) {
        const headerText = table.headers.join(' ').toLowerCase();
        if (headerText.includes('shipping') || headerText.includes('spedizione')) {
          // Look for shipping value in the data
          for (const row of table.data) {
            for (const cell of row) {
              const cellText = String(cell || '').trim();
              const shippingMatch = cellText.match(/(?:€|eur)?\s*(\d+[.,]\d{2,})/i);
              if (shippingMatch) {
                const shippingValue = this.parsePrice(shippingMatch[1]);
                if (shippingValue && shippingValue > maxShippingFee) {
                  maxShippingFee = shippingValue;
                }
              }
            }
          }
        }
      }
      
      // Look for shipping rows in the table data and extract their shipping fees
          for (const row of table.data) {
            if (this.isShippingRow(row)) {
              // Try to extract the shipping fee from the amount column
              // Look for cells with € currency symbol or numeric values
              for (const cell of row) {
                const cellText = String(cell || '').trim();
                // Look for € amount pattern
                const euroMatch = cellText.match(/(?:€|eur)?\s*(\d+(?:[.,]\d+)?)/i);
                if (euroMatch) {
                  const shippingValue = this.parsePrice(euroMatch[1]);
                  if (shippingValue && shippingValue > maxShippingFee) {
                    maxShippingFee = shippingValue;
                  }
                }
                // Also try to parse any numeric value as potential shipping fee
                else if (!euroMatch) {
                  const numericMatch = cellText.match(/(\d+(?:[.,]\d+)?)/);
                  if (numericMatch) {
                    const potentialValue = this.parsePrice(numericMatch[1]);
                    // Consider reasonable shipping fee range (typically 10-200€)
                    if (potentialValue && potentialValue >= 10 && potentialValue <= 200 && potentialValue > maxShippingFee) {
                      maxShippingFee = potentialValue;
                    }
                  }
                }
              }
            }
          }
      
      // Look through data rows for dates and invoice numbers
      for (const row of table.data) {
        for (const cell of row) {
          const cellText = String(cell || '').trim();
          
          // Extract invoice date (various formats)
          const dateMatch = cellText.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/) ||
                           cellText.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
          if (dateMatch && !result.invoiceMetadata.invoiceDate) {
            try {
              if (dateMatch[1].length === 4) {
                // YYYY-MM-DD format
                result.invoiceMetadata.invoiceDate = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`);
              } else {
                // DD/MM/YYYY format
                result.invoiceMetadata.invoiceDate = new Date(`${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`);
              }
            } catch (e) {
              // Ignore invalid dates
            }
          }
          
          // Extract invoice number - improve the regex
          const invoiceMatch = cellText.match(/(?:invoice|no\.?|n\.?|number)[\s:]*([A-Z0-9\-_]+)/i) ||
                              cellText.match(/No:[\s]*([A-Z0-9\-_]+)/i);
          if (invoiceMatch && !result.invoiceMetadata.invoiceNumber) {
            result.invoiceMetadata.invoiceNumber = invoiceMatch[1];
          }
          
          // Look for shipping costs in regular rows
          const lowerText = cellText.toLowerCase();
          if (lowerText.includes('shipping') || lowerText.includes('spedizione') || 
              lowerText.includes('envío') || lowerText.includes('livraison') ||
              lowerText.includes('transport') || lowerText.includes('fracht') ||
              lowerText.includes('frais')) {
            // Look for price in nearby cells or in the same cell
            const euroMatch = cellText.match(/(?:€|eur)?\s*(\d+[.,]\d{2,})/i);
            if (euroMatch) {
              const shippingValue = this.parsePrice(euroMatch[1]);
              if (shippingValue && shippingValue > maxShippingFee) {
                maxShippingFee = shippingValue;
              }
            }
          }
        }
      }
    }
    
    // Set the shipping fee if found
    if (maxShippingFee > 0) {
      result.invoiceMetadata.shippingFee = maxShippingFee;
    }
  }
  
  /**
   * Check if this is a Rabeko format table
   * @param headers - Table headers
   * @param dataRows - Table data rows
   * @returns boolean
   */
  private isRabekoFormat(headers: string[], dataRows: any[][]): boolean {
    // Check for Rabeko-specific headers (French)
    if (headers.length >= 4) {
      const headerText = headers.join(' ').toLowerCase();
      if (headerText.includes('description') && 
          headerText.includes('quantité') && 
          headerText.includes('unitaire') && 
          headerText.includes('total')) {
        console.log('🐍 Detected Rabeko format table (French headers)');
        return true;
      }
    }
    
    // Check for Rabeko content patterns in data
    if (dataRows.length > 2) {
      // Look for typical Rabeko product descriptions
      const sampleRows = dataRows.slice(1, Math.min(5, dataRows.length)); // Skip header row
      for (const row of sampleRows) {
        if (row.length >= 4) {
          const description = String(row[0] || '').toLowerCase();
          // Look for characteristic Rabeko product names
          if (description.includes('zero confiture') || 
              description.includes('sirop zero') || 
              description.includes('sauce zero') ||
              description.includes('choco sirop') ||
              description.includes('salted caramel')) {
            console.log('🐍 Detected Rabeko format table (content patterns)');
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Parse Rabeko format table
   * @param dataRows - Table data rows
   * @param headers - Table headers
   * @returns Array of line items
   */
  private parseRabekoFormat(dataRows: any[][], headers: string[]): any[] {
    const lineItems: any[] = [];
    
    if (dataRows.length < 2) {
      return lineItems;
    }
    
    console.log('🐍 Parsing Rabeko format table');
    
    // Identify column positions from headers
    const columnMap: any = {};
    headers.forEach((header, index) => {
      const normalized = String(header).toLowerCase();
      if (normalized.includes('description')) {
        columnMap.description = index;
      } else if (normalized.includes('quantité')) {
        columnMap.quantity = index;
      } else if (normalized.includes('unitaire')) {
        columnMap.unitPrice = index;
      } else if (normalized.includes('tva')) {
        columnMap.vat = index;
      } else if (normalized.includes('total')) {
        columnMap.total = index;
      }
    });
    
    console.log(`🐍 Rabeko column mapping:`, columnMap);
    
    // Process each row (skip header row)
    for (let i = 1; i < dataRows.length; i++) {
      const row = dataRows[i];
      
      // Skip empty rows
      if (!row || row.length === 0 || row.every(cell => !cell || String(cell).trim() === '')) {
        continue;
      }
      
      try {
        const description = columnMap.description !== undefined && row[columnMap.description] ? 
          String(row[columnMap.description]).trim() : '';
        
        // Skip if description is empty
        if (!description) {
          continue;
        }
        
        // Skip shipping items - they should be handled as shipping fee, not line items
        if (description.toLowerCase().includes('transport')) {
          console.log(`🐍 Skipping Rabeko shipping item: ${description} (will be handled as shipping fee)`);
          continue;
        }
        
        // Parse quantity
        let quantity = 1;
        if (columnMap.quantity !== undefined && row[columnMap.quantity]) {
          const qtyStr = String(row[columnMap.quantity]).trim();
          // Handle European format (comma as decimal separator)
          const qtyValue = parseInt(qtyStr.replace(',', ''), 10);
          if (!isNaN(qtyValue) && qtyValue > 0) {
            quantity = qtyValue;
          }
        }
        
        // Parse unit price
        let unitPrice = 0;
        if (columnMap.unitPrice !== undefined && row[columnMap.unitPrice]) {
          const priceStr = String(row[columnMap.unitPrice]).trim();
          const priceValue = this.parsePrice(priceStr, true);
          if (priceValue !== null) {
            unitPrice = priceValue;
          }
        }
        
        // Parse total
        let total = 0;
        if (columnMap.total !== undefined && row[columnMap.total]) {
          const totalStr = String(row[columnMap.total]).trim();
          const totalValue = this.parsePrice(totalStr, true);
          if (totalValue !== null) {
            total = totalValue;
          }
        } else {
          // Calculate total if not provided
          total = Math.round((quantity * unitPrice) * 100) / 100;
        }
        
        // Skip rows with zero values (likely empty/footer rows)
        if (quantity === 0 && unitPrice === 0 && total === 0) {
          continue;
        }
        
        // Regular product item
        console.log(`🐍 Parsed Rabeko item: ${description}, qty=${quantity}, price=${unitPrice}, total=${total}`);
        
        // For Rabeko, we need to generate a pseudo-SKU since they don't provide real SKUs
        const pseudoSku = this.generatePseudoSku(description);
        
        lineItems.push({
          supplierSku: pseudoSku,
          description: description,
          quantity: quantity,
          unitPrice: unitPrice,
          total: total
        });
        
      } catch (error) {
        console.error(`🐍 Error parsing Rabeko row ${i}:`, error);
      }
    }
    
    return lineItems;
  }
  
  /**
   * Generate pseudo-SKU from description for suppliers that don't provide real SKUs
   * @param description - Product description
   * @returns Generated pseudo-SKU
   */
  private generatePseudoSku(description: string): string {
    // Create a hash-based SKU from the description
    let hash = 0;
    for (let i = 0; i < description.length; i++) {
      const char = description.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    
    // Convert to positive number and format as pseudo-SKU
    const positiveHash = Math.abs(hash).toString(16).toUpperCase().substring(0, 8);
    return `RABEKO_${positiveHash}`;
  }
}