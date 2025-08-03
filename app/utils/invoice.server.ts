import db from "../db.server";
import type { InvoiceStatus, LogType } from "@prisma/client";

export interface CreateInvoiceData {
  supplierId: string;
  invoiceDate: Date;
  shippingFee: number;
  currency: string;
  status: InvoiceStatus;
  pdfFileName?: string;
  pdfFilePath?: string;
  pdfFileSize?: number;
  items: {
    sku: string;
    quantity: number;
    unitPrice: number;
    total: number;
    productId?: string;
  }[];
}

export interface UpdateInvoiceData {
  supplierId?: string;
  invoiceDate?: Date;
  shippingFee?: number;
  status?: InvoiceStatus;
  items?: {
    id?: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    total: number;
    productId?: string;
  }[];
}

export async function createInvoice(data: CreateInvoiceData) {
  const invoice = await db.invoice.create({
    data: {
      supplierId: data.supplierId,
      invoiceDate: data.invoiceDate,
      shippingFee: data.shippingFee,
      currency: data.currency,
      status: data.status,
      pdfFileName: data.pdfFileName,
      pdfFilePath: data.pdfFilePath,
      pdfFileSize: data.pdfFileSize,
      pdfUploadedAt: data.pdfFileName ? new Date() : null,
      items: {
        create: data.items.map(item => ({
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.total,
          productId: item.productId,
        })),
      },
    },
    include: {
      supplier: true,
      items: true,
      logs: true,
    },
  });

  // Create initial log entry
  await createLogEntry(invoice.id, "UPLOAD", "SUCCESS", "Invoice uploaded successfully");

  return invoice;
}

export async function getInvoiceById(id: string) {
  return await db.invoice.findUnique({
    where: { id },
    include: {
      supplier: true,
      items: {
        include: {
          product: true,
        },
      },
      logs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });
}

export async function updateInvoice(id: string, data: UpdateInvoiceData) {
  // If items are provided, delete existing items and create new ones
  if (data.items) {
    await db.invoiceItem.deleteMany({
      where: { invoiceId: id },
    });
  }

  const invoice = await db.invoice.update({
    where: { id },
    data: {
      ...(data.supplierId && { supplierId: data.supplierId }),
      ...(data.invoiceDate && { invoiceDate: data.invoiceDate }),
      ...(data.shippingFee !== undefined && { shippingFee: data.shippingFee }),
      ...(data.status && { status: data.status }),
      ...(data.items && {
        items: {
          create: data.items.map(item => ({
            sku: item.sku,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            productId: item.productId,
          })),
        },
      }),
    },
    include: {
      supplier: true,
      items: true,
      logs: true,
    },
  });

  // Create log entry for update
  await createLogEntry(id, "VALIDATION", "SUCCESS", "Invoice updated successfully");

  return invoice;
}

export async function getAllInvoices() {
  return await db.invoice.findMany({
    include: {
      supplier: true,
      items: true,
      logs: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createLogEntry(
  invoiceId: string,
  type: LogType,
  status: string,
  message: string
) {
  return await db.logEntry.create({
    data: {
      invoiceId,
      type,
      status,
      message,
    },
  });
}

export async function getAllSuppliers() {
  return await db.supplier.findMany({
    orderBy: { name: "asc" },
  });
}

export async function getSupplierByName(name: string) {
  return await db.supplier.findFirst({
    where: { name },
  });
}

export async function createSupplier(name: string) {
  return await db.supplier.create({
    data: { name },
  });
}

export async function getAllProducts() {
  return await db.product.findMany({
    orderBy: { name: "asc" },
  });
}

export async function getProductBySku(sku: string) {
  return await db.product.findFirst({
    where: { skuFwn: sku },
  });
}
