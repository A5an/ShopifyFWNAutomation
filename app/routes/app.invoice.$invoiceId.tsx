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
  Frame,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ArrowDownIcon, EditIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

// Mock invoice data - in real app this would come from database
const MOCK_INVOICE_DATA = {
  inv_001: {
    id: "inv_001",
    supplier: "Bolero",
    invoiceDate: "2025-07-25",
    invoiceNumber: "BOL-2025-0725",
    currency: "EUR",
    shippingFee: 6.00,
    status: "success",
    filename: "bolero_invoice_20250725.pdf",
    pdfUrl: "/mock-pdf-preview.pdf",
    errorMessage: null,
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
    ],
    subtotal: 118.50,
    totalAmount: 124.50,
    createdAt: "2025-07-25T10:30:00Z",
    processedAt: "2025-07-25T10:32:00Z",
    confirmedAt: "2025-07-25T10:35:00Z",
  },
  inv_002: {
    id: "inv_002",
    supplier: "XYZ Foods",
    invoiceDate: "2025-07-24",
    invoiceNumber: "XYZ-2025-0724",
    currency: "EUR",
    shippingFee: 8.00,
    status: "error",
    filename: "xyz_foods_invoice_20250724.pdf",
    pdfUrl: "/mock-pdf-preview.pdf",
    errorMessage: "Missing SKU information",
    items: [],
    subtotal: 0,
    totalAmount: 0,
    createdAt: "2025-07-24T14:15:00Z",
    processedAt: "2025-07-24T14:17:00Z",
    confirmedAt: null,
  },
  inv_003: {
    id: "inv_003",
    supplier: "ABC Distributors",
    invoiceDate: "2025-07-23",
    invoiceNumber: "ABC-2025-0723",
    currency: "EUR",
    shippingFee: 5.00,
    status: "cancelled",
    filename: "abc_invoice_20250723.pdf",
    pdfUrl: "/mock-pdf-preview.pdf",
    errorMessage: "Import cancelled by user",
    items: [
      {
        id: "1",
        sku: "WATER-500",
        name: "Mineral Water 500ml",
        quantity: 50,
        unitPrice: 1.20,
        total: 60.00,
      },
    ],
    subtotal: 60.00,
    totalAmount: 65.00,
    createdAt: "2025-07-23T09:45:00Z",
    processedAt: "2025-07-23T09:47:00Z",
    confirmedAt: null,
  },
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  const invoiceId = params.invoiceId;
  
  // Mock data lookup - in real app this would query database
  const invoiceData = MOCK_INVOICE_DATA[invoiceId as keyof typeof MOCK_INVOICE_DATA];
  
  if (!invoiceData) {
    throw new Response("Invoice not found", { status: 404 });
  }
  
  return json({ invoiceData });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("_action") as string;
  
  if (action === "download") {
    // Mock download - in real app this would serve the actual PDF
    return json({ success: true, message: "Download initiated", error: null });
  }
  
  return json({ success: false, message: null, error: "Invalid action" }, { status: 400 });
};

function getStatusBadge(status: string, errorMessage?: string | null) {
  switch (status) {
    case "success":
      return <Badge tone="success">✅ Success</Badge>;
    case "error":
      return (
        <Badge tone="critical">
          {`❌ Error: ${errorMessage || "Unknown error"}`}
        </Badge>
      );
    case "processing":
      return <Badge tone="info">⏳ Processing...</Badge>;
    case "pending_review":
      return <Badge tone="attention">📋 Pending Review</Badge>;
    default:
      return <Badge>Unknown</Badge>;
  }
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function InvoiceDetail() {
  const { invoiceData } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [isEditing, setIsEditing] = useState(false);

  const isSubmitting = navigation.state === "submitting";
  const canEdit = invoiceData.status === "pending_review";
  const canDownload = invoiceData.status === "success";

  const handleDownload = () => {
    // Mock download action
    console.log(`Downloading invoice ${invoiceData.id}: ${invoiceData.filename}`);
    alert(`Mock download: ${invoiceData.filename}`);
  };

  const tableRows = invoiceData.items.filter(item => item !== null).map((item) => [
    item.sku,
    item.name,
    item.quantity.toString(),
    `€${item.unitPrice.toFixed(2)}`,
    `€${item.total.toFixed(2)}`,
  ]);

  const headings = ["SKU", "Product Name", "Quantity", "Unit Price", "Total"];

  return (
    <Page>
      <TitleBar title={`Invoice ${invoiceData.invoiceNumber}`} />
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {actionData?.error && (
              <Banner tone="critical">
                {actionData.error}
              </Banner>
            )}

            {actionData?.success && actionData?.message && (
              <Banner tone="success">
                {actionData.message}
              </Banner>
            )}

            {/* Invoice Header */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingLg" as="h1">
                    Invoice {invoiceData.invoiceNumber}
                  </Text>
                  <InlineStack gap="200">
                    {getStatusBadge(invoiceData.status, invoiceData.errorMessage)}
                    {canEdit && (
                      <Button
                        variant="primary"
                        url={`/app/review/${invoiceData.id}`}
                      >
                        Edit & Review
                      </Button>
                    )}
                    {canDownload && (
                      <Button
                        icon={ArrowDownIcon}
                        onClick={handleDownload}
                      >
                        Download PDF
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>

                <InlineStack gap="600">
                  <div>
                    <Text variant="bodyMd" as="p">
                      <strong>Supplier:</strong> {invoiceData.supplier}
                    </Text>
                    <Text variant="bodyMd" as="p">
                      <strong>Invoice Date:</strong> {invoiceData.invoiceDate}
                    </Text>
                    <Text variant="bodyMd" as="p">
                      <strong>Currency:</strong> {invoiceData.currency}
                    </Text>
                  </div>
                  <div>
                    <Text variant="bodyMd" as="p">
                      <strong>Created:</strong> {formatDate(invoiceData.createdAt)}
                    </Text>
                    {invoiceData.processedAt && (
                      <Text variant="bodyMd" as="p">
                        <strong>Processed:</strong> {formatDate(invoiceData.processedAt)}
                      </Text>
                    )}
                    {invoiceData.confirmedAt && (
                      <Text variant="bodyMd" as="p">
                        <strong>Confirmed:</strong> {formatDate(invoiceData.confirmedAt)}
                      </Text>
                    )}
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Invoice Items */}
            {invoiceData.items.length > 0 ? (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Invoice Items
                  </Text>
                  
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "numeric", "numeric"]}
                    headings={headings}
                    rows={tableRows}
                  />

                  <Divider />

                  <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span">Subtotal:</Text>
                        <Text variant="bodyMd" as="span">€{invoiceData.subtotal.toFixed(2)}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" as="span">Shipping:</Text>
                        <Text variant="bodyMd" as="span">€{invoiceData.shippingFee.toFixed(2)}</Text>
                      </InlineStack>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text variant="headingMd" as="h3">Total:</Text>
                        <Text variant="headingMd" as="h3">€{invoiceData.totalAmount.toFixed(2)}</Text>
                      </InlineStack>
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">
                    Invoice Items
                  </Text>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    No items could be extracted from this invoice.
                  </Text>
                  {invoiceData.errorMessage && (
                    <Text variant="bodyMd" as="p" tone="critical">
                      Error: {invoiceData.errorMessage}
                    </Text>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* Actions */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Actions
                </Text>
                
                <InlineStack gap="300">
                  <Button
                    url="/app/history"
                  >
                    Back to History
                  </Button>
                  
                  {canEdit && (
                    <Button
                      variant="primary"
                      url={`/app/review/${invoiceData.id}`}
                    >
                      Review & Confirm
                    </Button>
                  )}
                  
                  {canDownload && (
                    <Button
                      icon={ArrowDownIcon}
                      onClick={handleDownload}
                    >
                      Download PDF
                    </Button>
                  )}
                </InlineStack>
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
                  {invoiceData.filename}
                </Text>
                <Button
                  variant="plain"
                  onClick={handleDownload}
                  disabled={!canDownload}
                >
                  {canDownload ? "Download Original" : "Processing..."}
                </Button>
              </div>
              
              <Text variant="bodyMd" as="p" tone="subdued">
                In a real implementation, this would show an embedded PDF viewer or preview image.
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
                    Uploaded: {formatDate(invoiceData.createdAt)}
                  </Text>
                </div>
                
                {invoiceData.processedAt && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "8px", height: "8px", backgroundColor: "#008060", borderRadius: "50%" }}></div>
                    <Text variant="bodyMd" as="p">
                      Processed: {formatDate(invoiceData.processedAt)}
                    </Text>
                  </div>
                )}
                
                {invoiceData.confirmedAt ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "8px", height: "8px", backgroundColor: "#008060", borderRadius: "50%" }}></div>
                    <Text variant="bodyMd" as="p">
                      Confirmed: {formatDate(invoiceData.confirmedAt)}
                    </Text>
                  </div>
                ) : invoiceData.status === "pending_review" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "8px", height: "8px", backgroundColor: "#FFA500", borderRadius: "50%" }}></div>
                    <Text variant="bodyMd" as="p">
                      Awaiting Review
                    </Text>
                  </div>
                ) : invoiceData.status === "error" ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "8px", height: "8px", backgroundColor: "#D72C0D", borderRadius: "50%" }}></div>
                    <Text variant="bodyMd" as="p">
                      Processing Failed
                    </Text>
                  </div>
                ) : null}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
