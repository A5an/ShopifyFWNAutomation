import { useState } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  InlineStack,
  Text,
  Pagination,
  Select,
  TextField,
  BlockStack,
  Popover,
  ActionList,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ArrowDownIcon, MenuHorizontalIcon, ViewIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getAllInvoices } from "../utils/invoice.server";
import { getPdfUrl } from "../utils/fileUpload.server";

// Transform database invoice data for the UI
function transformInvoicesForUI(invoices: any[]) {
  return invoices.map(invoice => ({
    id: invoice.id,
    supplier: invoice.supplier.name,
    status: invoice.status.toLowerCase(),
    filename: invoice.pdfFileName || 'invoice.pdf',
    createdAt: invoice.createdAt,
    errorMessage: invoice.logs?.find((log: any) => log.status === 'ERROR')?.message || null,
    pdfUrl: invoice.pdfFileName ? getPdfUrl(invoice.pdfFileName) : null,
  }));
}

// Keep mock data as fallback
const MOCK_INVOICES = [
  {
    id: "inv_temp_001",
    date: "2025-07-25",
    supplier: "Bolero",
    status: "pending_review",
    filename: "bolero_invoice_20250725.pdf",
    errorMessage: null,
    createdAt: "2025-07-25T10:30:00Z",
  },
  {
    id: "inv_001",
    date: "2025-07-25",
    supplier: "Bolero",
    status: "success",
    filename: "bolero_invoice_20250725.pdf",
    errorMessage: null,
    createdAt: "2025-07-25T10:30:00Z",
  },
  {
    id: "inv_002", 
    date: "2025-07-24",
    supplier: "XYZ Foods",
    status: "error",
    filename: "xyz_foods_invoice_20250724.pdf",
    errorMessage: "Missing SKU information",
    createdAt: "2025-07-24T14:15:00Z",
  },
  {
    id: "inv_003",
    date: "2025-07-23", 
    supplier: "ABC Distributors",
    status: "processing",
    filename: "abc_invoice_20250723.pdf",
    errorMessage: null,
    createdAt: "2025-07-23T09:45:00Z",
  },
  {
    id: "inv_004",
    date: "2025-07-22",
    supplier: "Fresh Market Co",
    status: "success", 
    filename: "fresh_market_invoice_20250722.pdf",
    errorMessage: null,
    createdAt: "2025-07-22T16:20:00Z",
  },
  {
    id: "inv_005",
    date: "2025-07-21",
    supplier: "Euro Beverages",
    status: "error",
    filename: "euro_beverages_invoice_20250721.pdf", 
    errorMessage: "Invalid file format",
    createdAt: "2025-07-21T11:30:00Z",
  },
  {
    id: "inv_006",
    date: "2025-07-20",
    supplier: "Bolero",
    status: "success",
    filename: "bolero_invoice_20250720.pdf",
    errorMessage: null,
    createdAt: "2025-07-20T13:45:00Z",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  try {
    // Get real invoices from database
    const dbInvoices = await getAllInvoices();
    const invoices = transformInvoicesForUI(dbInvoices);
    
    return json({ invoices });
  } catch (error) {
    console.error('Error loading invoices:', error);
    // Fallback to mock data if database fails
    return json({ invoices: MOCK_INVOICES });
  }
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

export default function History() {
  const { invoices } = useLoaderData<typeof loader>();
  const [currentPage, setCurrentPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [activePopover, setActivePopover] = useState<string | null>(null);

  const itemsPerPage = 10;

  // Filter invoices based on status and supplier
  const filteredInvoices = invoices.filter(invoice => {
    const matchesStatus = statusFilter === "all" || invoice.status === statusFilter;
    const matchesSupplier = !supplierFilter || 
      invoice.supplier.toLowerCase().includes(supplierFilter.toLowerCase());
    return matchesStatus && matchesSupplier;
  });

  // Paginate results
  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedInvoices = filteredInvoices.slice(startIndex, startIndex + itemsPerPage);

  const handleDownload = (invoiceId: string, filename: string) => {
    // Mock download action - in real app this would hit /api/invoices/:id/download
    console.log(`Downloading invoice ${invoiceId}: ${filename}`);
    // You could implement actual file download here
    alert(`Mock download: ${filename}`);
    setActivePopover(null);
  };

  const togglePopover = (invoiceId: string) => {
    setActivePopover(activePopover === invoiceId ? null : invoiceId);
  };

  const renderActionMenu = (invoice: any) => {
    if (invoice.status === "pending_review") {
      return (
        <Button
          variant="primary"
          url={`/app/review/${invoice.id}`}
        >
          Review
        </Button>
      );
    }

    if (invoice.status === "processing") {
      return (
        <Text variant="bodyMd" as="span" tone="subdued">Processing...</Text>
      );
    }

    const actions = [];

    if (invoice.status === "success") {
      actions.push({
        content: 'Download',
        icon: ArrowDownIcon,
        onAction: () => handleDownload(invoice.id, invoice.filename),
      });
    }

    actions.push({
      content: 'View Details',
      icon: ViewIcon,
      url: `/app/invoice/${invoice.id}`,
    });

    return (
      <Popover
        active={activePopover === invoice.id}
        activator={
          <Button
            variant="tertiary"
            icon={MenuHorizontalIcon}
            onClick={() => togglePopover(invoice.id)}
            accessibilityLabel="More actions"
          />
        }
        onClose={() => setActivePopover(null)}
      >
        <ActionList items={actions} />
      </Popover>
    );
  };

  const statusOptions = [
    { label: "All statuses", value: "all" },
    { label: "Success", value: "success" },
    { label: "Error", value: "error" },
    { label: "Processing", value: "processing" },
  ];

  const tableRows = paginatedInvoices.map(invoice => [
    <Button
      variant="plain"
      url={invoice.status === "pending_review" ? `/app/review/${invoice.id}` : `/app/invoice/${invoice.id}`}
      removeUnderline
    >
      {formatDate(invoice.createdAt)}
    </Button>,
    <Button
      variant="plain"
      url={invoice.status === "pending_review" ? `/app/review/${invoice.id}` : `/app/invoice/${invoice.id}`}
      removeUnderline
    >
      {invoice.supplier}
    </Button>,
    getStatusBadge(invoice.status, invoice.errorMessage),
    renderActionMenu(invoice),
  ]);

  const headings = ["Date", "Supplier", "Status", "Actions"];

  return (
    <Page>
      <TitleBar title="Import History" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" align="space-between">
                <Text variant="headingMd" as="h2">
                  Invoice Import History
                </Text>
                <Button variant="primary" url="/app/upload">
                  Upload New Invoice
                </Button>
              </InlineStack>

              {/* Filters */}
              <InlineStack gap="300">
                <div style={{ minWidth: "200px" }}>
                  <Select
                    label="Filter by status"
                    options={statusOptions}
                    onChange={setStatusFilter}
                    value={statusFilter}
                  />
                </div>
                <div style={{ minWidth: "200px" }}>
                  <TextField
                    label="Filter by supplier"
                    value={supplierFilter}
                    onChange={setSupplierFilter}
                    placeholder="Search suppliers..."
                    autoComplete="off"
                  />
                </div>
              </InlineStack>

              {/* Results summary */}
              <Text variant="bodyMd" as="p" tone="subdued">
                Showing {paginatedInvoices.length} of {filteredInvoices.length} invoices
              </Text>

              {/* Data table */}
              <DataTable
                columnContentTypes={["text", "text", "text", "text"]}
                headings={headings}
                rows={tableRows}
                footerContent={
                  totalPages > 1 ? (
                    <Pagination
                      hasPrevious={currentPage > 1}
                      onPrevious={() => setCurrentPage(currentPage - 1)}
                      hasNext={currentPage < totalPages}
                      onNext={() => setCurrentPage(currentPage + 1)}
                      label={`Page ${currentPage} of ${totalPages}`}
                    />
                  ) : undefined
                }
              />

              {filteredInvoices.length === 0 && (
                <div style={{ textAlign: "center", padding: "40px" }}>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    No invoices found matching your filters.
                  </Text>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd" as="h3">
                Import Statistics
              </Text>
              
              <div>
                <Text variant="bodyMd" as="p">
                  <strong>Total Invoices:</strong> {invoices.length}
                </Text>
              </div>
              
              <div>
                <Text variant="bodyMd" as="p">
                  <strong>Successful:</strong> {invoices.filter(i => i.status === "success").length}
                </Text>
              </div>
              
              <div>
                <Text variant="bodyMd" as="p">
                  <strong>Failed:</strong> {invoices.filter(i => i.status === "error").length}
                </Text>
              </div>
              
              <div>
                <Text variant="bodyMd" as="p">
                  <strong>Processing:</strong> {invoices.filter(i => i.status === "processing").length}
                </Text>
              </div>

              <Text variant="bodyMd" as="p" tone="subdued">
                Success Rate: {Math.round((invoices.filter(i => i.status === "success").length / invoices.length) * 100)}%
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
