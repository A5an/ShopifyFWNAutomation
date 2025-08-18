import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useActionData, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Button,
  InlineStack,
  Text,
  TextField,
  Select,
  Banner,
  BlockStack,
  Badge,
  Divider,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getInvoiceById, updateInvoice, getAllSuppliers } from "../utils/invoice.server";
import { getPdfUrl } from "../utils/fileUpload.server";

// Define types for better type safety
interface InvoiceItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface TransformedInvoice {
  id: string;
  supplier: string;
  supplierId: string;
  invoiceDate: string;
  invoiceNumber: string;
  currency: string;
  shippingFee: number;
  items: InvoiceItem[];
  filename: string;
  pdfUrl: string | null;
  pdfFilePath: string | null;
  status: string;
  createdAt: Date;
}

// Transform database invoice data for the UI
function transformInvoiceForUI(invoice: any): TransformedInvoice {
  return {
    id: invoice.id,
    supplier: invoice.supplier.name,
    supplierId: invoice.supplierId,
    invoiceDate: invoice.invoiceDate.toISOString().split('T')[0],
    invoiceNumber: `INV-${invoice.id.slice(-8).toUpperCase()}`,
    currency: invoice.currency,
    shippingFee: invoice.shippingFee,
    items: invoice.items.map((item: any): InvoiceItem => ({
      id: item.id,
      sku: item.sku,
      name: item.description || item.product?.name || item.sku,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
    })),
    filename: invoice.pdfFileName || 'invoice.pdf',
    pdfUrl: invoice.pdfFileName ? getPdfUrl(invoice.pdfFileName) : null,
    pdfFilePath: invoice.pdfFilePath || null,
    status: invoice.status,
    createdAt: invoice.createdAt,
  };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const invoiceId = params.invoiceId;
  
  if (!invoiceId) {
    throw new Response("Invoice ID is required", { status: 400 });
  }
  
  // Get invoice from database
  const invoice = await getInvoiceById(invoiceId);
  
  if (!invoice) {
    throw new Response("Invoice not found", { status: 404 });
  }
  
  // Get all suppliers for the dropdown
  const suppliers = await getAllSuppliers();
  
  // Transform invoice data for UI
  const extractedData = transformInvoiceForUI(invoice);
  
  return json({ 
    extractedData, 
    suppliers: suppliers.map(s => ({ label: s.name, value: s.id })),
    logs: invoice.logs || []
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action") as string;
  const invoiceId = params.invoiceId!;
  
  if (action === "confirm") {
    // Mock confirmation - in real app this would save to database and update WAC
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing
    
    return redirect("/app/history?success=Invoice imported successfully");
  }
  
  if (action === "reject") {
    return redirect("/app/upload?error=Invoice processing cancelled");
  }
  
  if (action === "reparse") {
    try {
      const { reprocessInvoicePdf } = await import("../services/invoiceProcessing.server");
      await reprocessInvoicePdf(invoiceId);
      return json({ success: true, message: "PDF re-parsed successfully" });
    } catch (error) {
      console.error("Re-parsing failed:", error);
      return json({ 
        error: error instanceof Error ? error.message : "Re-parsing failed" 
      }, { status: 500 });
    }
  }
  
  return json({ error: "Invalid action" }, { status: 400 });
};

export default function InvoiceReview() {
  const { extractedData } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [editableItems, setEditableItems] = useState(extractedData.items);
  const [editableSupplier, setEditableSupplier] = useState(extractedData.supplier);
  const [editableInvoiceDate, setEditableInvoiceDate] = useState(extractedData.invoiceDate);
  const [editableShippingFee, setEditableShippingFee] = useState(extractedData.shippingFee.toString());

  const isSubmitting = navigation.state === "submitting";

  const updateItem = (itemId: string, field: string, value: string) => {
    setEditableItems(items => 
      items.map(item => {
        if (item.id === itemId) {
          const updatedItem = { ...item, [field]: field === 'quantity' || field === 'unitPrice' ? parseFloat(value) || 0 : value };
          // Recalculate total when quantity or unitPrice changes
          if (field === 'quantity' || field === 'unitPrice') {
            updatedItem.total = updatedItem.quantity * updatedItem.unitPrice;
          }
          return updatedItem;
        }
        return item;
      })
    );
  };

  const addNewItem = () => {
    const newItem = {
      id: Date.now().toString(),
      sku: "",
      name: "",
      quantity: 0,
      unitPrice: 0,
      total: 0,
    };
    setEditableItems(items => [...items, newItem]);
  };

  const removeItem = (itemId: string) => {
    setEditableItems(items => items.filter(item => item.id !== itemId));
  };

  const calculateSubtotal = () => {
    return editableItems.reduce((sum, item) => sum + item.total, 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + parseFloat(editableShippingFee || "0");
  };

  const supplierOptions = [
    { label: "Bolero", value: "Bolero" },
    { label: "Yamamoto", value: "Yamamoto" },
    { label: "XYZ Foods", value: "XYZ Foods" },
    { label: "ABC Distributors", value: "ABC Distributors" },
    { label: "Fresh Market Co", value: "Fresh Market Co" },
    { label: "Euro Beverages", value: "Euro Beverages" },
    { label: "Swanson", value: "Swanson" },
    { label: "Rabeko", value: "Rabeko" },
  ];

  const tableRows = editableItems.map((item, index) => [
    <TextField
      label=""
      labelHidden
      value={item.sku}
      onChange={(value) => updateItem(item.id, 'sku', value)}
      autoComplete="off"
    />,
    <TextField
      label=""
      labelHidden
      value={item.name}
      onChange={(value) => updateItem(item.id, 'name', value)}
      autoComplete="off"
    />,
    <TextField
      label=""
      labelHidden
      value={item.quantity.toString()}
      onChange={(value) => updateItem(item.id, 'quantity', value)}
      type="number"
      autoComplete="off"
    />,
    <TextField
      label=""
      labelHidden
      value={item.unitPrice.toString()}
      onChange={(value) => updateItem(item.id, 'unitPrice', value)}
      type="number"
      step={0.01}
      autoComplete="off"
    />,
    <Text as="span" variant="bodyMd">
      €{item.total.toFixed(2)}
    </Text>,
    <Button
      variant="plain"
      tone="critical"
      onClick={() => removeItem(item.id)}
      disabled={editableItems.length <= 1}
    >
      Remove
    </Button>,
  ]);

  const headings = ["SKU", "Description", "Quantity", "Unit Price (€)", "Total (€)", "Actions"];

  return (
    <Page>
      <TitleBar title="Review Invoice Data" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <p>Please review the extracted invoice data below. You can edit any fields if needed before confirming the import.</p>
            </Banner>

            {actionData && 'error' in actionData && actionData.error && (
              <Banner tone="critical">
                {actionData.error}
              </Banner>
            )}
            
            {actionData && 'success' in actionData && actionData.success && (
              <Banner tone="success">
                {actionData.message || 'Operation completed successfully'}
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Invoice Information
                </Text>
                
                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <Select
                      label="Supplier"
                      options={supplierOptions}
                      value={editableSupplier}
                      onChange={setEditableSupplier}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Invoice Date"
                      value={editableInvoiceDate}
                      onChange={setEditableInvoiceDate}
                      type="date"
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="400">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Invoice Number"
                      value={extractedData.invoiceNumber}
                      disabled
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Currency"
                      value={extractedData.currency}
                      disabled
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Invoice Items
                </Text>
                
                <DataTable
                  columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text"]}
                  headings={headings}
                  rows={tableRows}
                />

                <InlineStack gap="200">
                  <Button
                    variant="plain"
                    onClick={addNewItem}
                  >
                    + Add Item
                  </Button>
                </InlineStack>

                <Divider />

                <InlineStack gap="400" align="end">
                  <div style={{ minWidth: "200px" }}>
                    <TextField
                      label="Shipping Fee (€)"
                      value={editableShippingFee}
                      onChange={setEditableShippingFee}
                      type="number"
                      step={0.01}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" as="span">Subtotal:</Text>
                      <Text variant="bodyMd" as="span">€{calculateSubtotal().toFixed(2)}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" as="span">Shipping:</Text>
                      <Text variant="bodyMd" as="span">€{parseFloat(editableShippingFee || "0").toFixed(2)}</Text>
                    </InlineStack>
                    <Divider />
                    <InlineStack align="space-between">
                      <Text variant="headingMd" as="h3">Total:</Text>
                      <Text variant="headingMd" as="h3">€{calculateTotal().toFixed(2)}</Text>
                    </InlineStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Actions
                </Text>
                
                <form method="post">
                  <InlineStack gap="300">
                    <button
                      type="submit"
                      name="_action"
                      value="confirm"
                      disabled={isSubmitting}
                      style={{
                        backgroundColor: '#008060',
                        color: 'white',
                        border: 'none',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        opacity: isSubmitting ? 0.6 : 1
                      }}
                    >
                      {isSubmitting && navigation.formData?.get("_action") === "confirm" ? "Importing..." : "Confirm & Import"}
                    </button>
                    
                    <button
                      type="submit"
                      name="_action"
                      value="reject"
                      disabled={isSubmitting}
                      style={{
                        backgroundColor: '#f6f6f7',
                        color: '#202223',
                        border: '1px solid #c9cccf',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                        opacity: isSubmitting ? 0.6 : 1
                      }}
                    >
                      Cancel Import
                    </button>
                    
                    <Button
                      url="/app/upload"
                      disabled={isSubmitting}
                    >
                      Back to Upload
                    </Button>
                  </InlineStack>
                </form>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          {/* PDF Preview */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                PDF Preview
              </Text>
              
              {/* PDF Preview with real file */}
              <div style={{ 
                height: "400px", 
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                overflow: "hidden"
              }}>
                <iframe
                  src={extractedData.pdfFilePath || '/pdfs/inv_1754051006458_5w2rz9yi2_1754051006461_psychology-cheat-sheet.pdf'}
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "none"
                  }}
                  title="PDF Preview"
                />
              </div>
              
              <InlineStack gap="200">
                <Button
                  variant="plain"
                  url={extractedData.pdfUrl || ''}
                  target="_blank"
                >
                  Open in New Tab
                </Button>
                <Button
                  variant="plain"
                  onClick={() => {
                    const link = document.createElement('a');
                    link.href = extractedData.pdfUrl || '';
                    link.download = extractedData.filename;
                    link.click();
                  }}
                >
                  Download Original
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Processing Status */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Processing Status
              </Text>
              
              <Badge tone="success">✅ PDF Processed</Badge>
              <Badge tone="success">✅ Data Extracted</Badge>
              <Badge tone="attention">⏳ Awaiting Confirmation</Badge>
              
              <Text variant="bodyMd" as="p" tone="subdued">
                Original file: {extractedData.filename}
              </Text>
            </BlockStack>
          </Card>

          {/* Processing Timeline */}
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Processing Timeline
              </Text>
              
              <BlockStack gap="200">
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "8px", height: "8px", backgroundColor: "#008060", borderRadius: "50%" }}></div>
                  <Text variant="bodyMd" as="p">
                    Uploaded: Just now
                  </Text>
                </div>
                
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "8px", height: "8px", backgroundColor: "#008060", borderRadius: "50%" }}></div>
                  <Text variant="bodyMd" as="p">
                    Processed: Just now
                  </Text>
                </div>
                
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "8px", height: "8px", backgroundColor: "#FFA500", borderRadius: "50%" }}></div>
                  <Text variant="bodyMd" as="p">
                    Awaiting Review
                  </Text>
                </div>
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                What happens next?
              </Text>
              
              <Text variant="bodyMd" as="p">
                After confirmation, this invoice will:
              </Text>
              
              <BlockStack gap="200">
                <Text variant="bodyMd" as="p">
                  • Be saved to the database
                </Text>
                <Text variant="bodyMd" as="p">
                  • Update weighted average costs (WAC)
                </Text>
                <Text variant="bodyMd" as="p">
                  • Appear in import history
                </Text>
                <Text variant="bodyMd" as="p">
                  • Generate processing summary
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
