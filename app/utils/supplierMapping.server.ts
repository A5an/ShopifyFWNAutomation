import db from "../db.server";

// Find FWN product by supplier SKU
export async function findProductBySupplierSku(
  supplierSku: string,
  supplierName?: string
): Promise<{
  product: {
    id: string;
    name: string;
    skuFwn: string;
  } | null;
  mapping: {
    id: string;
    sku: string;
    brand?: string;
  } | null;
}> {
  const mapping = await db.supplierSKU.findFirst({
    where: {
      sku: supplierSku,
      // Optionally filter by brand/supplier if provided
      ...(supplierName && { 
        brand: {
          contains: supplierName
        }
      })
    },
    include: {
      product: true
    }
  });
  
  return {
    product: mapping?.product || null,
    mapping: mapping ? {
      id: mapping.id,
      sku: mapping.sku,
      brand: mapping.brand || undefined
    } : null
  };
}

// Create new supplier SKU mapping
export async function createSupplierSkuMapping(data: {
  productId: string;
  supplierSku: string;
  brand?: string;
}): Promise<{
  id: string;
  sku: string;
  brand?: string;
}> {
  const mapping = await db.supplierSKU.create({
    data: {
      productId: data.productId,
      sku: data.supplierSku,
      brand: data.brand
    }
  });
  
  return {
    id: mapping.id,
    sku: mapping.sku,
    brand: mapping.brand || undefined
  };
}

// Get all unmapped supplier SKUs from recent invoices
export async function getUnmappedSupplierSkus(limit = 50): Promise<Array<{
  sku: string;
  count: number;
  lastSeen: Date;
  supplierName?: string;
}>> {
  // Get invoice items that don't have productId (unmapped)
  const unmappedItems = await db.invoiceItem.findMany({
    where: {
      productId: null
    },
    include: {
      invoice: {
        include: {
          supplier: true
        }
      }
    },
    orderBy: {
      invoice: {
        createdAt: 'desc'
      }
    },
    take: limit * 3 // Get more to account for grouping
  });
  
  // Group by SKU and count occurrences
  const skuMap = new Map<string, {
    count: number;
    lastSeen: Date;
    supplierName?: string;
  }>();
  
  unmappedItems.forEach(item => {
    const existing = skuMap.get(item.sku);
    if (existing) {
      existing.count++;
      if (item.invoice.createdAt > existing.lastSeen) {
        existing.lastSeen = item.invoice.createdAt;
        existing.supplierName = item.invoice.supplier.name;
      }
    } else {
      skuMap.set(item.sku, {
        count: 1,
        lastSeen: item.invoice.createdAt,
        supplierName: item.invoice.supplier.name
      });
    }
  });
  
  // Convert to array and sort by count (most frequent first)
  return Array.from(skuMap.entries())
    .map(([sku, data]) => ({
      sku,
      ...data
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Get supplier SKU mapping statistics
export async function getSupplierSkuStats(): Promise<{
  totalMappings: number;
  mappingsBySupplier: Array<{
    supplier: string;
    mappingCount: number;
  }>;
  recentUnmappedCount: number;
}> {
  // Count total mappings
  const totalMappings = await db.supplierSKU.count();
  
  // Count mappings by brand/supplier
  const mappingsByBrand = await db.supplierSKU.groupBy({
    by: ['brand'],
    _count: {
      id: true
    },
    orderBy: {
      _count: {
        id: 'desc'
      }
    }
  });
  
  // Count recent unmapped items (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentUnmappedCount = await db.invoiceItem.count({
    where: {
      productId: null,
      invoice: {
        createdAt: {
          gte: thirtyDaysAgo
        }
      }
    }
  });
  
  return {
    totalMappings,
    mappingsBySupplier: mappingsByBrand.map(item => ({
      supplier: item.brand || 'Unknown',
      mappingCount: item._count.id
    })),
    recentUnmappedCount
  };
}

// Bulk create supplier SKU mappings from CSV or array
export async function bulkCreateSupplierSkuMappings(
  mappings: Array<{
    fwnSku: string;
    supplierSku: string;
    brand?: string;
  }>
): Promise<{
  created: number;
  errors: Array<{
    row: number;
    error: string;
    data: any;
  }>;
}> {
  let created = 0;
  const errors: Array<{ row: number; error: string; data: any }> = [];
  
  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i];
    
    try {
      // Find FWN product by SKU
      const product = await db.product.findUnique({
        where: { skuFwn: mapping.fwnSku }
      });
      
      if (!product) {
        errors.push({
          row: i + 1,
          error: `FWN SKU '${mapping.fwnSku}' not found`,
          data: mapping
        });
        continue;
      }
      
      // Check if mapping already exists
      const existingMapping = await db.supplierSKU.findFirst({
        where: {
          sku: mapping.supplierSku,
          productId: product.id
        }
      });
      
      if (existingMapping) {
        errors.push({
          row: i + 1,
          error: `Mapping already exists for supplier SKU '${mapping.supplierSku}'`,
          data: mapping
        });
        continue;
      }
      
      // Create mapping
      await db.supplierSKU.create({
        data: {
          productId: product.id,
          sku: mapping.supplierSku,
          brand: mapping.brand
        }
      });
      
      created++;
      
    } catch (error) {
      errors.push({
        row: i + 1,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: mapping
      });
    }
  }
  
  return { created, errors };
}
