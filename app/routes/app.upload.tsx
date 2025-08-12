import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  Select,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  DropZone,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { savePdfFile } from "../utils/fileUpload.server";
import { createInvoice, getAllSuppliers, getSupplierByName, createSupplier } from "../utils/invoice.server";

// Define proper types for Shopify Polaris Select component
interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface Supplier {
  id: string;
  name: string;
}

// Transform suppliers for Select component
function transformSuppliersForSelect(suppliers: Supplier[]): SelectOption[] {
  return [
    { label: "Select a supplier", value: "", disabled: true },
    ...suppliers.map(supplier => ({
      label: supplier.name,
      value: supplier.id,
    })),
  ];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  // Get real suppliers from database
  const suppliers = await getAllSuppliers();
  const selectOptions = transformSuppliersForSelect(suppliers);
  
  return json({ suppliers: selectOptions });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const supplier = formData.get("supplier") as string;
  const file = formData.get("invoice") as File;

  // Validation
  if (!supplier) {
    return json({ error: "Please select a supplier" }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return json({ error: "Please select a PDF file" }, { status: 400 });
  }

  // Generate unique invoice ID
  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Save the PDF file using our upload utility
    const uploadResult = await savePdfFile(file, invoiceId);
    
    if (!uploadResult.success) {
      return json({ error: uploadResult.error || "Failed to upload file" }, { status: 400 });
    }

    // Create invoice record in database with relative path
    const relativePath = `/pdfs/${uploadResult.fileName}`;
    const invoice = await createInvoice({
      supplierId: supplier,
      invoiceDate: new Date(), // Will be updated after PDF parsing
      shippingFee: 0, // Will be updated after PDF parsing
      currency: "EUR",
      status: "PROCESSING", // Start with PROCESSING status
      pdfFileName: uploadResult.fileName,
      pdfFilePath: relativePath, // Store relative path
      pdfFileSize: uploadResult.fileSize,
      items: [], // Will be populated after PDF parsing
    });
    
    console.log("Invoice created successfully:", {
      invoiceId: invoice.id,
      supplier: invoice.supplier.name,
      fileName: uploadResult.fileName,
      fileSize: uploadResult.fileSize,
      originalFileName: uploadResult.originalFileName,
    });
    
    // Process PDF and extract invoice data
    try {
      const { processInvoicePdf } = await import("../services/invoiceProcessing.server");
      await processInvoicePdf(invoice.id);
    } catch (parseError) {
      console.error("PDF parsing failed:", parseError);
      // Note: Invoice status will be set to ERROR by processInvoicePdf
      // We'll still redirect to review so user can see the error details
    }
    
    // Return success with invoice ID for client-side navigation
    return json({ 
      success: true, 
      invoiceId: invoice.id,
      message: "Invoice uploaded successfully!" 
    });
  } catch (error) {
    console.error("Upload error:", error);
    return json({ error: "Failed to process upload. Please try again." }, { status: 500 });
  }
};

export default function Upload() {
  const { suppliers } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);

  // Handle successful upload navigation
  useEffect(() => {
    if (actionData && 'success' in actionData && actionData.success && actionData.invoiceId) {
      // Navigate to review page after successful upload
      navigate(`/app/review/${actionData.invoiceId}`);
    }
  }, [actionData, navigate]);

  const isSubmitting = navigation.state === "submitting";

  const handleDropZoneDrop = (droppedFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
    setSelectedFile(acceptedFiles[0]);
    setRejectedFiles(rejectedFiles);
  };

  const validImageTypes = ['application/pdf'];

  const fileUpload = !selectedFile && <DropZone.FileUpload />;
  const uploadedFiles = selectedFile && (
    <div style={{ padding: '14px' }}>
      <BlockStack gap="200">
        {[selectedFile].map((file: File, index: number) => (
          <InlineStack key={index} gap="200" align="center">
            <Thumbnail
              size="small"
              alt={file.name}
              source="https://cdn.shopify.com/s/files/1/0757/9955/files/New_Post.png?12678548500147524304"
            />
            <div>
              <Text variant="bodySm" as="p">
                {file.name}
              </Text>
              <Text variant="bodySm" as="p">{(file.size / 1024).toFixed(1)} KB</Text>
            </div>
          </InlineStack>
        ))}
      </BlockStack>
    </div>
  );

  const errorMessage = rejectedFiles.length > 0 && (
    <Banner tone="critical">
      <p>The following files were rejected:</p>
      <ul>
        {rejectedFiles.map((file, index) => (
          <li key={index}>{file.name} - Only PDF files are accepted</li>
        ))}
      </ul>
    </Banner>
  );

  return (
    <Page>
      <TitleBar title="Upload Invoice" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Text variant="headingMd" as="h2">
                Import Supplier Invoice
              </Text>
              
              {actionData && 'error' in actionData && (
                <Banner tone="critical">
                  {actionData.error}
                </Banner>
              )}
              


              {errorMessage}

              <form method="post" encType="multipart/form-data">
                <FormLayout>
                  <Select
                    label="Supplier"
                    options={suppliers}
                    onChange={setSelectedSupplier}
                    value={selectedSupplier}
                    name="supplier"
                    placeholder="Select a supplier"
                  />

                  <div>
                    <Text variant="bodyMd" as="p">
                      Invoice PDF
                    </Text>
                    <div style={{ marginTop: '8px' }}>
                      <DropZone
                        accept="application/pdf"
                        type="file"
                        onDrop={handleDropZoneDrop}
                        variableHeight
                      >
                        {uploadedFiles}
                        {fileUpload}
                      </DropZone>
                    </div>
                  </div>

                  {/* Hidden file input for form submission */}
                  {selectedFile && (
                    <input
                      type="file"
                      name="invoice"
                      accept=".pdf"
                      style={{ display: 'none' }}
                      ref={(input) => {
                        if (input && selectedFile) {
                          const dt = new DataTransfer();
                          dt.items.add(selectedFile);
                          input.files = dt.files;
                        }
                      }}
                    />
                  )}

                  <InlineStack gap="200">
                    <Button
                      variant="primary"
                      submit
                      loading={isSubmitting}
                      disabled={!selectedSupplier || !selectedFile || isSubmitting}
                    >
                      {isSubmitting ? "Processing Upload..." : "Upload Invoice"}
                    </Button>
                    
                    <Button
                      url="/app/history"
                      disabled={isSubmitting}
                    >
                      View History
                    </Button>
                  </InlineStack>
                </FormLayout>
              </form>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="200">
              <Text variant="headingMd" as="h3">
                Upload Instructions
              </Text>
              <Text variant="bodyMd" as="p">
                1. Select the supplier from the dropdown menu
              </Text>
              <Text variant="bodyMd" as="p">
                2. Upload a PDF invoice file
              </Text>
              <Text variant="bodyMd" as="p">
                3. Click "Upload Invoice" to process
              </Text>
              <Text variant="bodyMd" as="p">
                The system will automatically extract invoice data and calculate weighted average costs.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
