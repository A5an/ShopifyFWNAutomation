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

// Mock extracted invoice data - in real app this would come from PDF processing
const MOCK_EXTRACTED_DATA = {
  inv_temp_001: {
    id: "inv_temp_001",
    supplier: "Bolero",
    invoiceDate: "2025-07-25",
    invoiceNumber: "BOL-2025-0725",
    currency: "EUR",
    shippingFee: 6.00,
    items: [
      {
        id: "1",
        sku: "ICE-LEMON",
        name: "Ice Tea Lemon",
        quantity: 20,
        unitPrice: 3.30,
        total: 66.00,
      },
      {
        id: "2", 
        sku: "ICE-PEACH",
        name: "Ice Tea Peach",
        quantity: 15,
        unitPrice: 3.50,
        total: 52.50,
      },
      {
        id: "3",
        sku: "WATER-500",
        name: "Mineral Water 500ml",
        quantity: 30,
        unitPrice: 1.20,
        total: 36.00,
      },
    ],
    subtotal: 154.50,
    totalAmount: 160.50,
    filename: "bolero_invoice_20250725.pdf",
  }
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const invoiceId = params.invoiceId;
  
  // Mock data lookup - in real app this would query database
  const extractedData = MOCK_EXTRACTED_DATA[invoiceId as keyof typeof MOCK_EXTRACTED_DATA];
  
  if (!extractedData) {
    throw new Response("Invoice not found", { status: 404 });
  }
  
  return json({ extractedData });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action") as string;
  
  if (action === "confirm") {
    // Mock confirmation - in real app this would save to database and update WAC
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing
    
    return redirect("/app/history?success=Invoice imported successfully");
  }
  
  if (action === "reject") {
    return redirect("/app/upload?error=Invoice processing cancelled");
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
    { label: "XYZ Foods", value: "XYZ Foods" },
    { label: "ABC Distributors", value: "ABC Distributors" },
    { label: "Fresh Market Co", value: "Fresh Market Co" },
    { label: "Euro Beverages", value: "Euro Beverages" },
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

  const headings = ["SKU", "Product Name", "Quantity", "Unit Price (€)", "Total (€)", "Actions"];

  return (
    <Page>
      <TitleBar title="Review Invoice Data" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="info">
              <p>Please review the extracted invoice data below. You can edit any fields if needed before confirming the import.</p>
            </Banner>

            {actionData?.error && (
              <Banner tone="critical">
                {actionData.error}
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
              
              <div style={{ 
                height: "400px", 
                backgroundColor: "#f6f6f7", 
                border: "1px solid #c9cccf",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: "16px"
              }}>
                <Text variant="bodyMd" as="p" tone="subdued">
                  📄 PDF Preview
                </Text>
                <Text variant="bodyMd" as="p" tone="subdued">
                  {extractedData.filename}
                </Text>
                <Button
                  variant="plain"
                  onClick={() => alert(`Mock download: ${extractedData.filename}`)}
                >
                  Download Original
                </Button>
              </div>
              
              <Text variant="bodyMd" as="p" tone="subdued">
                In a real implementation, this would show an embedded PDF viewer.
              </Text>
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
