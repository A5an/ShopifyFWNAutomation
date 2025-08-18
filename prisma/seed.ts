import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // Clean existing data
  await prisma.job.deleteMany();
  await prisma.logEntry.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.cMPRecord.deleteMany();
  await prisma.shopifySale.deleteMany();
  await prisma.supplierSKU.deleteMany();
  await prisma.product.deleteMany();
  await prisma.supplier.deleteMany();

  console.log("🧹 Cleaned existing data");

  // Create Suppliers
  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        name: "Addict",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Bolero",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Buchteiner",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "DSL Global",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Dynveo",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Maiavie",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Ingredient Superfood",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Inlead",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Io genix",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Labz Nutrition",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Life pro",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Liot",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Max protein",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Nakosport",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Novoma",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Nutrimea",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Nutrimeo",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Ostrovit",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Pb Wholesale",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Powerbody",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Pro Supply",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Prolife",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Rabeko",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Shaker store",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Swanson",
      },
    }),
    prisma.supplier.create({
      data: {
        name: "Yamamoto",
      },
    }),
  ]);

  console.log("✅ Created suppliers");

  // Create Products
  const products = await Promise.all([
    prisma.product.create({
      data: {
        name: "Ice Tea Lemon",
        skuFwn: "ICE-LEMON",
      },
    }),
    prisma.product.create({
      data: {
        name: "Ice Tea Peach",
        skuFwn: "ICE-PEACH",
      },
    }),
    prisma.product.create({
      data: {
        name: "Mineral Water 500ml",
        skuFwn: "WATER-500",
      },
    }),
    prisma.product.create({
      data: {
        name: "Energy Drink Original",
        skuFwn: "ENERGY-ORIG",
      },
    }),
    prisma.product.create({
      data: {
        name: "Sparkling Water Lemon",
        skuFwn: "SPARK-LEMON",
      },
    }),
    prisma.product.create({
      data: {
        name: "Orange Juice 1L",
        skuFwn: "JUICE-ORANGE",
      },
    }),
  ]);

  console.log("✅ Created products");

  // Create SupplierSKU mappings (simplified - just product SKUs)
  await Promise.all([
    prisma.supplierSKU.create({
      data: {
        productId: products[0].id, // Ice Tea Lemon
        sku: "BOL-ICE-LEM-001",
        brand: "Bolero",
      },
    }),
    prisma.supplierSKU.create({
      data: {
        productId: products[1].id, // Ice Tea Peach
        sku: "BOL-ICE-PEA-002",
        brand: "Bolero",
      },
    }),
    prisma.supplierSKU.create({
      data: {
        productId: products[2].id, // Mineral Water
        sku: "SWA-WAT-500-001",
        brand: "Swanson",
      },
    }),
    prisma.supplierSKU.create({
      data: {
        productId: products[3].id, // Energy Drink
        sku: "MAX-ENG-ORIG-001",
        brand: "Max protein",
      },
    }),
    prisma.supplierSKU.create({
      data: {
        productId: products[4].id, // Sparkling Water Lemon
        sku: "DSL-SPARK-LEM-001",
        brand: "DSL Global",
      },
    }),
    prisma.supplierSKU.create({
      data: {
        productId: products[5].id, // Orange Juice 1L
        sku: "NUT-JUICE-ORG-001",
        brand: "Nutrimea",
      },
    }),
  ]);

  console.log("✅ Created supplier SKU mappings");

  // Create Sample Invoices
  const invoices = await Promise.all([
    // SUCCESS Invoice
    prisma.invoice.create({
      data: {
        supplierId: suppliers[0].id, // Bolero
        invoiceDate: new Date("2025-07-25"),
        shippingFee: 6.0,
        currency: "EUR",
        status: "SUCCESS",
        pdfFileName: "bolero_invoice_20250725.pdf",
        pdfFilePath: "/uploads/pdfs/inv_001_1722345600000_bolero_invoice_20250725.pdf",
        pdfFileSize: 245760,
        pdfUploadedAt: new Date("2025-07-25T10:30:00Z"),
        items: {
          create: [
            {
              sku: "ICE-LEMON",
              quantity: 20,
              unitPrice: 3.30,
              total: 66.00,
              productId: products[0].id,
            },
            {
              sku: "ICE-PEACH",
              quantity: 15,
              unitPrice: 3.50,
              total: 52.50,
              productId: products[1].id,
            },
          ],
        },
      },
    }),
    // PENDING_REVIEW Invoice
    prisma.invoice.create({
      data: {
        supplierId: suppliers[0].id, // Bolero
        invoiceDate: new Date("2025-07-26"),
        shippingFee: 8.0,
        currency: "EUR",
        status: "PENDING_REVIEW",
        pdfFileName: "bolero_invoice_20250726.pdf",
        pdfFilePath: "/uploads/pdfs/inv_002_1722432000000_bolero_invoice_20250726.pdf",
        pdfFileSize: 198432,
        pdfUploadedAt: new Date("2025-07-26T09:15:00Z"),
        items: {
          create: [
            {
              sku: "ICE-LEMON",
              quantity: 30,
              unitPrice: 3.25,
              total: 97.50,
              productId: products[0].id,
            },
            {
              sku: "WATER-500",
              quantity: 50,
              unitPrice: 1.20,
              total: 60.00,
              productId: products[2].id,
            },
          ],
        },
      },
    }),
    // ERROR Invoice
    prisma.invoice.create({
      data: {
        supplierId: suppliers[1].id, // XYZ Foods
        invoiceDate: new Date("2025-07-24"),
        shippingFee: 5.0,
        currency: "EUR",
        status: "ERROR",
        pdfFileName: "xyz_foods_invoice_20250724.pdf",
        pdfFilePath: "/uploads/pdfs/inv_003_1722259200000_xyz_foods_invoice_20250724.pdf",
        pdfFileSize: 156789,
        pdfUploadedAt: new Date("2025-07-24T14:15:00Z"),
        items: {
          create: [], // No items due to parsing error
        },
      },
    }),
    // PROCESSING Invoice
    prisma.invoice.create({
      data: {
        supplierId: suppliers[2].id, // ABC Distributors
        invoiceDate: new Date("2025-07-27"),
        shippingFee: 7.5,
        currency: "EUR",
        status: "PROCESSING",
        pdfFileName: "abc_invoice_20250727.pdf",
        pdfFilePath: "/uploads/pdfs/inv_004_1722518400000_abc_invoice_20250727.pdf",
        pdfFileSize: 312456,
        pdfUploadedAt: new Date("2025-07-27T08:00:00Z"),
        items: {
          create: [
            {
              sku: "ENERGY-ORIG",
              quantity: 24,
              unitPrice: 2.80,
              total: 67.20,
              productId: products[3].id,
            },
          ],
        },
      },
    }),
    // CANCELLED Invoice
    prisma.invoice.create({
      data: {
        supplierId: suppliers[3].id, // Fresh Market Co
        invoiceDate: new Date("2025-07-23"),
        shippingFee: 4.0,
        currency: "EUR",
        status: "CANCELLED",
        pdfFileName: "fresh_market_invoice_20250723.pdf",
        pdfFilePath: "/uploads/pdfs/inv_005_1722172800000_fresh_market_invoice_20250723.pdf",
        pdfFileSize: 187654,
        pdfUploadedAt: new Date("2025-07-23T11:30:00Z"),
        items: {
          create: [
            {
              sku: "JUICE-ORANGE",
              quantity: 12,
              unitPrice: 4.50,
              total: 54.00,
              productId: products[5].id,
            },
          ],
        },
      },
    }),
  ]);

  console.log("✅ Created sample invoices");

  // Create Log Entries for each invoice
  const logEntries = [];
  
  // SUCCESS Invoice logs
  logEntries.push(
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[0].id,
        type: "UPLOAD",
        status: "SUCCESS",
        message: "PDF uploaded successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[0].id,
        type: "PROCESSING",
        status: "SUCCESS",
        message: "PDF processed successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[0].id,
        type: "PARSING",
        status: "SUCCESS",
        message: "Invoice data extracted successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[0].id,
        type: "CONFIRMATION",
        status: "SUCCESS",
        message: "Invoice confirmed and imported",
      },
    })
  );

  // PENDING_REVIEW Invoice logs
  logEntries.push(
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[1].id,
        type: "UPLOAD",
        status: "SUCCESS",
        message: "PDF uploaded successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[1].id,
        type: "PROCESSING",
        status: "SUCCESS",
        message: "PDF processed successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[1].id,
        type: "PARSING",
        status: "SUCCESS",
        message: "Invoice data extracted, awaiting review",
      },
    })
  );

  // ERROR Invoice logs
  logEntries.push(
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[2].id,
        type: "UPLOAD",
        status: "SUCCESS",
        message: "PDF uploaded successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[2].id,
        type: "PROCESSING",
        status: "ERROR",
        message: "Failed to process PDF - corrupted file",
      },
    })
  );

  // PROCESSING Invoice logs
  logEntries.push(
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[3].id,
        type: "UPLOAD",
        status: "SUCCESS",
        message: "PDF uploaded successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[3].id,
        type: "PROCESSING",
        status: "IN_PROGRESS",
        message: "Processing PDF file...",
      },
    })
  );

  // CANCELLED Invoice logs
  logEntries.push(
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[4].id,
        type: "UPLOAD",
        status: "SUCCESS",
        message: "PDF uploaded successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[4].id,
        type: "PROCESSING",
        status: "SUCCESS",
        message: "PDF processed successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[4].id,
        type: "PARSING",
        status: "SUCCESS",
        message: "Invoice data extracted successfully",
      },
    }),
    prisma.logEntry.create({
      data: {
        invoiceId: invoices[4].id,
        type: "CONFIRMATION",
        status: "CANCELLED",
        message: "Invoice import cancelled by user",
      },
    })
  );

  await Promise.all(logEntries);

  console.log("✅ Created log entries");

  // Create some CMP Records
  await Promise.all([
    prisma.cMPRecord.create({
      data: {
        productId: products[0].id, // Ice Tea Lemon
        quantity: 100,
        totalCost: 320.0,
        cmpValue: 3.20,
      },
    }),
    prisma.cMPRecord.create({
      data: {
        productId: products[1].id, // Ice Tea Peach
        quantity: 80,
        totalCost: 280.0,
        cmpValue: 3.50,
      },
    }),
    prisma.cMPRecord.create({
      data: {
        productId: products[2].id, // Mineral Water
        quantity: 200,
        totalCost: 240.0,
        cmpValue: 1.20,
      },
    }),
  ]);

  console.log("✅ Created CMP records");

  // Create some Shopify Sales data
  await Promise.all([
    prisma.shopifySale.create({
      data: {
        orderId: "SH-001",
        date: new Date("2025-07-20"),
        sku: "ICE-LEMON",
        quantity: 5,
        unitPrice: 5.99,
        cmpAtSale: 3.20,
        marginPct: 46.6,
        productId: products[0].id,
      },
    }),
    prisma.shopifySale.create({
      data: {
        orderId: "SH-002",
        date: new Date("2025-07-21"),
        sku: "ICE-PEACH",
        quantity: 3,
        unitPrice: 6.49,
        cmpAtSale: 3.50,
        marginPct: 46.1,
        productId: products[1].id,
      },
    }),
    prisma.shopifySale.create({
      data: {
        orderId: "SH-003",
        date: new Date("2025-07-22"),
        sku: "WATER-500",
        quantity: 10,
        unitPrice: 2.99,
        cmpAtSale: 1.20,
        marginPct: 59.9,
        productId: products[2].id,
      },
    }),
  ]);

  console.log("✅ Created Shopify sales data");

  console.log("🎉 Database seeded successfully!");
  console.log(`📊 Created:`);
  console.log(`   - ${suppliers.length} suppliers`);
  console.log(`   - ${products.length} products`);
  console.log(`   - ${invoices.length} invoices`);
  console.log(`   - Multiple log entries, CMP records, and sales data`);
}

main()
  .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
