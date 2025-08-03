import { writeFile, mkdir, readFile, stat } from "fs/promises";
import { join, extname } from "path";
import { existsSync } from "fs";
import { createReadStream } from "fs";

const UPLOAD_DIR = join(process.cwd(), "public", "pdfs");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = [".pdf"];

export interface UploadResult {
  success: boolean;
  fileName?: string;
  originalFileName?: string;
  filePath?: string;
  fileSize?: number;
  error?: string;
}

export async function ensureUploadDirectory(): Promise<void> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }
}

export function validatePdfFile(file: File): { valid: boolean; error?: string } {
  // Check file type
  if (!file.type.includes("pdf") && !file.name.toLowerCase().endsWith(".pdf")) {
    return { valid: false, error: "Only PDF files are allowed" };
  }

  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File size must be less than ${MAX_FILE_SIZE / (1024 * 1024)}MB` };
  }

  // Check file extension
  const ext = extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: "Only PDF files are allowed" };
  }

  return { valid: true };
}

export async function savePdfFile(file: File, invoiceId: string): Promise<UploadResult> {
  try {
    // Validate file
    const validation = validatePdfFile(file);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    await ensureUploadDirectory();
    
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${invoiceId}_${timestamp}_${sanitizedFileName}`;
    const filePath = join(UPLOAD_DIR, fileName);
    
    await writeFile(filePath, buffer);
    
    return {
      success: true,
      fileName,
      originalFileName: file.name,
      filePath,
      fileSize: buffer.length,
    };
  } catch (error) {
    console.error("Error saving PDF file:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to save file" 
    };
  }
}

export function getPdfFilePath(invoiceId: string, fileName: string): string {
  return join(UPLOAD_DIR, fileName);
}

export function getStoredPdfPath(fileName: string): string {
  return join(UPLOAD_DIR, fileName);
}

export async function getPdfFile(fileName: string): Promise<{
  success: boolean;
  buffer?: Buffer;
  size?: number;
  error?: string;
}> {
  try {
    const filePath = getStoredPdfPath(fileName);
    
    if (!existsSync(filePath)) {
      return { success: false, error: "File not found" };
    }

    const buffer = await readFile(filePath);
    const stats = await stat(filePath);
    
    return {
      success: true,
      buffer,
      size: stats.size,
    };
  } catch (error) {
    console.error("Error reading PDF file:", error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to read file" 
    };
  }
}

export function getPdfUrl(fileName: string): string {
  return `/pdfs/${encodeURIComponent(fileName)}`;
}

export function createPdfStream(fileName: string) {
  const filePath = getStoredPdfPath(fileName);
  return createReadStream(filePath);
}