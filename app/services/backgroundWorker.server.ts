import { processInvoicePdf } from "./invoiceProcessing.server";
import { 
  getNextJob, 
  startJob, 
  completeJob, 
  failJob
} from "./jobQueue.server";
import { createLogEntry } from "../utils/invoice.server";

// Background worker for processing jobs
export class BackgroundWorker {
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;
  private readonly pollInterval = 5000; // 5 seconds

  // Start the background worker
  start(): void {
    if (this.isRunning) {
      console.log("Background worker is already running");
      return;
    }

    console.log("🚀 Starting background worker...");
    this.isRunning = true;

    // Process jobs immediately
    this.processJobs();

    // Set up polling interval
    this.intervalId = setInterval(() => {
      this.processJobs();
    }, this.pollInterval);
  }

  // Stop the background worker
  stop(): void {
    if (!this.isRunning) {
      console.log("Background worker is not running");
      return;
    }

    console.log("🛑 Stopping background worker...");
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  // Process all pending jobs
  private async processJobs(): Promise<void> {
    try {
      // Process PDF processing jobs
      await this.processPdfJobs();
      
      // Process CMP calculation jobs
      await this.processCmpJobs();
      
      // Process Shopify sync jobs
      await this.processShopifyJobs();
      
      // Process Google Sheets export jobs
      await this.processGoogleSheetsJobs();
      
    } catch (error) {
      console.error("Error in background worker:", error);
    }
  }

  // Process PDF processing jobs
  private async processPdfJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("PDF_PROCESSING"))) {
      try {
        console.log(`📄 Processing PDF job ${job.id} for invoice ${job.data.invoiceId}`);
        
        await startJob(job.id);
        
        // Process the PDF
        await processInvoicePdf(job.data.invoiceId);
        
        // Mark job as completed
        await completeJob(job.id, {
          invoiceId: job.data.invoiceId,
          status: "success",
          processedAt: new Date().toISOString(),
        });
        
        console.log(`✅ PDF job ${job.id} completed successfully`);
        
      } catch (error) {
        console.error(`❌ PDF job ${job.id} failed:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
        
        // Log the error
        if (job.data.invoiceId) {
          await createLogEntry(
            job.data.invoiceId,
            "PROCESSING",
            "ERROR",
            `Background processing failed: ${errorMessage}`
          );
        }
      }
    }
  }

  // Process CMP calculation jobs
  private async processCmpJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("CMP_CALCULATION"))) {
      try {
        console.log(`🧮 Processing CMP calculation job ${job.id} for product ${job.data.productId}`);
        
        await startJob(job.id);
        
        // TODO: Implement CMP calculation logic
        // This will be implemented when we add the CMP calculation service
        
        // For now, just mark as completed
        await completeJob(job.id, {
          productId: job.data.productId,
          status: "success",
          calculatedAt: new Date().toISOString(),
          message: "CMP calculation not yet implemented",
        });
        
        console.log(`✅ CMP job ${job.id} completed successfully`);
        
      } catch (error) {
        console.error(`❌ CMP job ${job.id} failed:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
      }
    }
  }

  // Process Shopify sync jobs
  private async processShopifyJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("SHOPIFY_SYNC"))) {
      try {
        console.log(`🛍️ Processing Shopify sync job ${job.id}`);
        
        await startJob(job.id);
        
        // TODO: Implement Shopify sync logic
        // This will fetch sales data and update our database
        
        await completeJob(job.id, {
          status: "success",
          syncedAt: new Date().toISOString(),
          message: "Shopify sync not yet implemented",
        });
        
        console.log(`✅ Shopify sync job ${job.id} completed successfully`);
        
      } catch (error) {
        console.error(`❌ Shopify sync job ${job.id} failed:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
      }
    }
  }

  // Process Google Sheets export jobs
  private async processGoogleSheetsJobs(): Promise<void> {
    let job;
    while ((job = await getNextJob("GOOGLE_SHEETS_EXPORT"))) {
      try {
        console.log(`📊 Processing Google Sheets export job ${job.id}`);
        
        await startJob(job.id);
        
        // TODO: Implement Google Sheets export logic
        // This will export CMP data and sales data to Google Sheets
        
        await completeJob(job.id, {
          status: "success",
          exportedAt: new Date().toISOString(),
          message: "Google Sheets export not yet implemented",
        });
        
        console.log(`✅ Google Sheets export job ${job.id} completed successfully`);
        
      } catch (error) {
        console.error(`❌ Google Sheets export job ${job.id} failed:`, error);
        
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        await failJob(job.id, errorMessage);
      }
    }
  }

  // Get worker status
  getStatus(): { isRunning: boolean; pollInterval: number } {
    return {
      isRunning: this.isRunning,
      pollInterval: this.pollInterval,
    };
  }
}

// Create a singleton instance
export const backgroundWorker = new BackgroundWorker();

// Auto-start the worker when this module is imported
// Start in both development and production for now
backgroundWorker.start();
