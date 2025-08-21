import { spawn } from "child_process";
import { join } from "path";

// Define types for our Python extraction results
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
  camelot?: PythonTable[];
  pdfplumber?: PythonTable[];
  tabula?: PythonTable[];
  method?: string;
  error?: string;
  all_tables?: any;
}

/**
 * Execute Python script to extract tables from PDF
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} method - Extraction method ('all', 'camelot', 'pdfplumber', 'tabula', 'invoice')
 * @returns {Promise<PythonExtractionResult>} - Parsed JSON result from Python script
 */
export async function extractPdfTables(
  pdfPath: string,
  method: string = "invoice",
): Promise<PythonExtractionResult> {
  return new Promise((resolve, reject) => {
    // Use process.cwd() to get the current working directory
    const pythonScript = join(process.cwd(), "python/pdf_table_extractor.py");
    const args = [pythonScript, pdfPath, "--method", method];

    console.log(`🔍 Extracting tables from ${pdfPath} using ${method} method`);

    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const pythonProcess = spawn(pythonCmd, args, {
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    pythonProcess.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    pythonProcess.on("close", (code) => {
      if (code !== 0) {
        console.error(`❌ Python script exited with code ${code}`);
        console.error(`stderr: ${stderr}`);
        reject(new Error(`Python script failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        // Only parse the last JSON object from stdout (in case there are multiple)
        const lines = stdout.trim().split("\n");
        let lastJsonLine = "";

        // Find the last line that looks like JSON
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith("{") && line.endsWith("}")) {
            lastJsonLine = line;
            break;
          }
        }

        if (!lastJsonLine) {
          throw new Error(
            `No valid JSON found in output. stdout: ${stdout}, stderr: ${stderr}`,
          );
        }

        const result: PythonExtractionResult = JSON.parse(lastJsonLine);
        console.log(
          `✅ Successfully extracted ${result.total_found || (result.tables ? result.tables.length : 0)} tables`,
        );
        resolve(result);
      } catch (parseError: any) {
        console.error(
          `❌ Failed to parse Python output: ${parseError.message}`,
        );
        console.error(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
        reject(
          new Error(`Failed to parse Python output: ${parseError.message}`),
        );
      }
    });

    pythonProcess.on("error", (error) => {
      console.error(`❌ Failed to start Python process: ${error.message}`);
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

/**
 * Enhanced PDF table extraction using Python libraries
 * This function tries multiple methods and returns the best result
 * @param {string} pdfPath - Path to the PDF file
 * @returns {Promise<PythonExtractionResult>} - Best extracted table data
 */
export async function extractPdfTablesEnhanced(
  pdfPath: string,
): Promise<PythonExtractionResult> {
  try {
    // First try the invoice-specific method
    console.log("🤖 Trying invoice-specific extraction...");
    const invoiceResult = await extractPdfTables(pdfPath, "invoice");

    // If we got tables, return them
    if (invoiceResult.tables && invoiceResult.tables.length > 0) {
      console.log(`🎯 Found ${invoiceResult.tables.length} invoice tables`);
      return invoiceResult;
    }

    // If there was an error, try the all method
    if (invoiceResult.error) {
      console.log(
        "🔄 Trying all methods extraction due to invoice method error...",
      );
      const allResult = await extractPdfTables(pdfPath, "all");

      // Process the all result
      const allTables = [
        ...(allResult.camelot || []),
        ...(allResult.pdfplumber || []),
        ...(allResult.tabula || []),
      ];

      if (allTables.length > 0) {
        // Filter for tables that look like invoices
        const invoiceTables = allTables.filter((table) => {
          // Heuristics for invoice-like tables
          return (
            table.shape[1] >= 3 && // At least 3 columns
            table.shape[0] >= 1 && // At least 1 row
            table.shape[0] <= 100 && // Reasonable number of rows
            table.headers &&
            table.headers.length > 0
          );
        });

        if (invoiceTables.length > 0) {
          console.log(
            `🎯 Found ${invoiceTables.length} potential invoice tables`,
          );
          return {
            tables: invoiceTables,
            total_found: invoiceTables.length,
            method: "enhanced",
          };
        }
      }

      // Return the raw all result if no invoice tables found
      console.log("⚠️ No suitable tables found, returning raw results");
      return {
        tables: allTables,
        total_found: allTables.length,
        method: "all",
      };
    }

    // Fall back to trying all methods if invoice method returned no error but no tables
    console.log("🔄 Falling back to all methods extraction...");
    const allResult = await extractPdfTables(pdfPath, "all");

    // Find the best table (most likely to be invoice)
    const allTables = [
      ...(allResult.camelot || []),
      ...(allResult.pdfplumber || []),
      ...(allResult.tabula || []),
    ];

    if (allTables.length > 0) {
      // Filter for tables that look like invoices
      const invoiceTables = allTables.filter((table) => {
        // Heuristics for invoice-like tables
        return (
          table.shape[1] >= 3 && // At least 3 columns
          table.shape[0] >= 1 && // At least 1 row
          table.shape[0] <= 100 && // Reasonable number of rows
          table.headers &&
          table.headers.length > 0
        );
      });

      if (invoiceTables.length > 0) {
        console.log(
          `🎯 Found ${invoiceTables.length} potential invoice tables`,
        );
        return {
          tables: invoiceTables,
          total_found: invoiceTables.length,
          method: "enhanced",
        };
      }
    }

    console.log("⚠️ No suitable tables found, returning raw results");
    return {
      tables: allTables,
      total_found: allTables.length,
      method: "raw",
    };
  } catch (error: any) {
    console.error(`❌ Enhanced extraction failed: ${error.message}`);
    throw error;
  }
}
