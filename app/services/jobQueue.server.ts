import db from "../db.server";
import type { JobStatus, JobType } from "@prisma/client";

export interface JobData {
  [key: string]: any;
}

export interface JobResult {
  [key: string]: any;
}

export interface CreateJobOptions {
  type: JobType;
  data: JobData;
  maxAttempts?: number;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  data: JobData;
  result?: JobResult;
  error?: string;
  attempts: number;
  maxAttempts: number;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Create a new job in the queue
export async function createJob(options: CreateJobOptions): Promise<Job> {
  const job = await db.job.create({
    data: {
      type: options.type,
      data: JSON.stringify(options.data),
      maxAttempts: options.maxAttempts || 3,
    },
  });

  return {
    ...job,
    data: JSON.parse(job.data),
    result: job.result ? JSON.parse(job.result) : undefined,
    error: job.error || undefined,
  };
}

// Get next pending job of a specific type
export async function getNextJob(type: JobType): Promise<Job | null> {
  const job = await db.job.findFirst({
    where: {
      type,
      status: "PENDING",
      attempts: {
        lt: db.job.fields.maxAttempts,
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  if (!job) return null;

  return {
    ...job,
    data: JSON.parse(job.data),
    result: job.result ? JSON.parse(job.result) : undefined,
    error: job.error || undefined,
  };
}

// Mark job as started
export async function startJob(jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "PROCESSING",
      startedAt: new Date(),
      attempts: {
        increment: 1,
      },
    },
  });
}

// Mark job as completed
export async function completeJob(jobId: string, result: JobResult): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      result: JSON.stringify(result),
      completedAt: new Date(),
    },
  });
}

// Mark job as failed
export async function failJob(jobId: string, error: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      error,
      completedAt: new Date(),
    },
  });
}

// Get job by ID
export async function getJobById(jobId: string): Promise<Job | null> {
  const job = await db.job.findUnique({
    where: { id: jobId },
  });

  if (!job) return null;

      return {
      ...job,
      data: JSON.parse(job.data),
      result: job.result ? JSON.parse(job.result) : undefined,
      error: job.error || undefined,
    };
}

// Get jobs by status
export async function getJobsByStatus(status: JobStatus, limit = 50): Promise<Job[]> {
  const jobs = await db.job.findMany({
    where: { status },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return jobs.map(job => ({
    ...job,
    data: JSON.parse(job.data),
    result: job.result ? JSON.parse(job.result) : undefined,
    error: job.error || undefined,
  }));
}

// Get job statistics
export async function getJobStats(): Promise<{
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  byType: Record<JobType, { total: number; pending: number; completed: number; failed: number }>;
}> {
  const [total, pending, processing, completed, failed] = await Promise.all([
    db.job.count(),
    db.job.count({ where: { status: "PENDING" } }),
    db.job.count({ where: { status: "PROCESSING" } }),
    db.job.count({ where: { status: "COMPLETED" } }),
    db.job.count({ where: { status: "FAILED" } }),
  ]);

  // Get stats by type
  const byType = {} as Record<JobType, { total: number; pending: number; completed: number; failed: number }>;
  
  const jobTypes: JobType[] = ["PDF_PROCESSING", "CMP_CALCULATION", "SHOPIFY_SYNC", "GOOGLE_SHEETS_EXPORT"];
  
  for (const type of jobTypes) {
    const [typeTotal, typePending, typeCompleted, typeFailed] = await Promise.all([
      db.job.count({ where: { type } }),
      db.job.count({ where: { type, status: "PENDING" } }),
      db.job.count({ where: { type, status: "COMPLETED" } }),
      db.job.count({ where: { type, status: "FAILED" } }),
    ]);
    
    byType[type] = {
      total: typeTotal,
      pending: typePending,
      completed: typeCompleted,
      failed: typeFailed,
    };
  }

  return {
    total,
    pending,
    processing,
    completed,
    failed,
    byType,
  };
}

// Clean up old completed jobs (older than 30 days)
export async function cleanupOldJobs(daysToKeep = 30): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await db.job.deleteMany({
    where: {
      status: "COMPLETED",
      completedAt: {
        lt: cutoffDate,
      },
    },
  });

  return result.count;
}

// Retry failed jobs
export async function retryFailedJob(jobId: string): Promise<void> {
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      error: null,
      attempts: 0,
      startedAt: null,
      completedAt: null,
    },
  });
}
