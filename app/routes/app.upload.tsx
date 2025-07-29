import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
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

// Mock suppliers data - in real app this would come from database
const MOCK_SUPPLIERS = [
  { label: "Select a supplier", value: "", disabled: true },
  { label: "Bolero", value: "bolero" },
  { label: "XYZ Foods", value: "xyz-foods" },
  { label: "ABC Distributors", value: "abc-distributors" },
  { label: "Fresh Market Co", value: "fresh-market" },
  { label: "Euro Beverages", value: "euro-beverages" },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return json({ suppliers: MOCK_SUPPLIERS });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const supplier = formData.get("supplier") as string;
  const file = formData.get("invoice") as File;

  // Mock validation and processing
  if (!supplier) {
    return json({ error: "Please select a supplier" }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return json({ error: "Please select a PDF file" }, { status: 400 });
  }

  if (file.type !== "application/pdf") {
    return json({ error: "Only PDF files are allowed" }, { status: 400 });
  }

  // Mock successful upload and processing
  await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing time
  
  const invoiceId = "inv_temp_001"; // Mock invoice ID
  
  // Redirect to review page
  return redirect(`/app/review/${invoiceId}`);
};

export default function Upload() {
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<File[]>([]);

  const isSubmitting = navigation.state === "submitting";

  const handleDropZoneDrop = (droppedFiles: File[], acceptedFiles: File[], rejectedFiles: File[]) => {
    setFiles(acceptedFiles);
    setRejectedFiles(rejectedFiles);
  };

  const validImageTypes = ['application/pdf'];

  const fileUpload = !files.length && <DropZone.FileUpload />;
  const uploadedFiles = files.length > 0 && (
    <div style={{ padding: '14px' }}>
      <BlockStack gap="200">
        {files.map((file, index) => (
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
                    options={MOCK_SUPPLIERS}
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
                  {files.length > 0 && (
                    <input
                      type="file"
                      name="invoice"
                      accept=".pdf"
                      style={{ display: 'none' }}
                      ref={(input) => {
                        if (input && files[0]) {
                          const dt = new DataTransfer();
                          dt.items.add(files[0]);
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
                      disabled={!selectedSupplier || files.length === 0}
                    >
                      {isSubmitting ? "Uploading..." : "Upload Invoice"}
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
