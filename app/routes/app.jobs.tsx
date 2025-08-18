import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useRevalidator, useActionData, Form } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  InlineStack,
  Text,
  BlockStack,
  Popover,
  ActionList,
  Banner,
  ProgressBar,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { MenuHorizontalIcon, RefreshIcon, PlayIcon, PauseCircleIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  
  try {
    const { getJobStats, getJobsByStatus } = await import("../services/jobQueue.server");
    const { backgroundWorker } = await import("../services/backgroundWorker.server");
    
    const [stats, pendingJobs, processingJobs, failedJobs] = await Promise.all([
      getJobStats(),
      getJobsByStatus("PENDING", 10),
      getJobsByStatus("PROCESSING", 10),
      getJobsByStatus("FAILED", 10),
    ]);
    
    return json({ 
      stats, 
      pendingJobs, 
      processingJobs, 
      failedJobs,
      workerStatus: backgroundWorker.getStatus(),
      error: null,
    });
  } catch (error) {
    console.error('Error loading job data:', error);
    return json({ 
      stats: null, 
      pendingJobs: [], 
      processingJobs: [], 
      failedJobs: [],
      workerStatus: { isRunning: false, pollInterval: 5000 },
      error: "Failed to load job data" 
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  
  const formData = await request.formData();
  const action = formData.get("action") as string;
  
  try {
    if (action === "retry") {
      const jobId = formData.get("jobId") as string;
      const { retryFailedJob } = await import("../services/jobQueue.server");
      await retryFailedJob(jobId);
      return json({ success: true });
    }
    
    if (action === "startWorker") {
      const { backgroundWorker } = await import("../services/backgroundWorker.server");
      backgroundWorker.start();
      return json({ success: true });
    }
    
    if (action === "stopWorker") {
      const { backgroundWorker } = await import("../services/backgroundWorker.server");
      backgroundWorker.stop();
      return json({ success: true });
    }
    
    return json({ success: false, error: "Invalid action" });
  } catch (error) {
    return json({ success: false, error: "Action failed" });
  }
};

export default function Jobs() {
  const { stats, pendingJobs, processingJobs, failedJobs, workerStatus, error } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const [activePopover, setActivePopover] = useState<string | null>(null);

  // Auto-refresh every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      revalidator.revalidate();
    }, 10000);

    return () => clearInterval(interval);
  }, [revalidator]);

  // Revalidate when action completes
  useEffect(() => {
    if (actionData?.success) {
      revalidator.revalidate();
    }
  }, [actionData, revalidator]);

  const handleRetryJob = (jobId: string) => {
    setActivePopover(null);
    // The form submission will handle the retry
  };

  const handleStartWorker = () => {
    // The form submission will handle starting the worker
  };

  const handleStopWorker = () => {
    // The form submission will handle stopping the worker
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return <Badge tone="info">⏳ Pending</Badge>;
      case "PROCESSING":
        return <Badge tone="attention">🔄 Processing</Badge>;
      case "COMPLETED":
        return <Badge tone="success">✅ Completed</Badge>;
      case "FAILED":
        return <Badge tone="critical">❌ Failed</Badge>;
      case "CANCELLED":
        return <Badge tone="warning">🚫 Cancelled</Badge>;
      default:
        return <Badge>Unknown</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const renderJobActions = (job: any) => {
    if (job.status === "FAILED") {
      return (
        <Popover
          active={activePopover === job.id}
          activator={
            <Button
              variant="tertiary"
              icon={MenuHorizontalIcon}
              onClick={() => setActivePopover(activePopover === job.id ? null : job.id)}
              accessibilityLabel="More actions"
            />
          }
          onClose={() => setActivePopover(null)}
        >
          <ActionList
            items={[
              {
                content: 'Retry Job',
                onAction: () => {
                  const form = document.createElement('form');
                  form.method = 'post';
                  form.innerHTML = `
                    <input type="hidden" name="action" value="retry" />
                    <input type="hidden" name="jobId" value="${job.id}" />
                  `;
                  document.body.appendChild(form);
                  form.submit();
                  document.body.removeChild(form);
                },
              },
              {
                content: 'View Details',
                onAction: () => console.log('View job details:', job.id),
              },
            ]}
          />
        </Popover>
      );
    }

    return (
      <Text variant="bodyMd" as="span" tone="subdued">
        {job.status === "COMPLETED" ? "Completed" : "No actions available"}
      </Text>
    );
  };

  const createJobTableRows = (jobs: any[]) => {
    return jobs.map(job => [
      <Text variant="bodyMd" as="span">
        <code>{job.id.substring(0, 8)}...</code>
      </Text>,
      getStatusBadge(job.status),
      <Text variant="bodyMd" as="span">
        {job.type.replace(/_/g, ' ')}
      </Text>,
      <Text variant="bodyMd" as="span">
        {job.attempts}/{job.maxAttempts}
      </Text>,
      formatDate(job.createdAt),
      job.startedAt ? formatDate(job.startedAt) : '-',
      job.completedAt ? formatDate(job.completedAt) : '-',
      renderJobActions(job),
    ]);
  };

  if (error) {
    return (
      <Page>
        <TitleBar title="Background Jobs" />
        <Layout>
          <Layout.Section>
            <Banner tone="critical">
              {error}
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Background Jobs" />
      <Layout>
        {/* Worker Status */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" align="space-between">
                <Text variant="headingMd" as="h2">
                  Worker Status
                </Text>
                <InlineStack gap="200">
                  <Form method="post">
                    <input type="hidden" name="action" value="startWorker" />
                    <Button
                      variant="primary"
                      icon={PlayIcon}
                      disabled={workerStatus.isRunning}
                    >
                      Start Worker
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="action" value="stopWorker" />
                    <Button
                      variant="secondary"
                      icon={PauseCircleIcon}
                      disabled={!workerStatus.isRunning}
                    >
                      Stop Worker
                    </Button>
                  </Form>
                  <Button
                    variant="tertiary"
                    icon={RefreshIcon}
                    onClick={() => revalidator.revalidate()}
                  >
                    Refresh
                  </Button>
                </InlineStack>
              </InlineStack>
              
              <InlineStack gap="400">
                <div>
                  <Text variant="bodyMd" as="p">
                    <strong>Status:</strong> {workerStatus.isRunning ? "Running" : "Stopped"}
                  </Text>
                  <Text variant="bodyMd" as="p">
                    <strong>Poll Interval:</strong> {workerStatus.pollInterval / 1000}s
                  </Text>
                </div>
                
                {workerStatus.isRunning && (
                  <div style={{ flex: 1 }}>
                    <Text variant="bodyMd" as="p">
                      <strong>Active:</strong> Processing jobs every {workerStatus.pollInterval / 1000} seconds
                    </Text>
                    <ProgressBar progress={100} size="small" />
                  </div>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Job Statistics */}
        {stats && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Job Statistics
                </Text>
                
                <InlineStack gap="400" wrap={false}>
                  <div style={{ flex: 1 }}>
                    <Text variant="headingLg" as="h3" tone="success">
                      {stats.completed}
                    </Text>
                    <Text variant="bodyMd" as="p">Completed</Text>
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <Text variant="headingLg" as="h3" tone="success">
                      {stats.pending}
                    </Text>
                    <Text variant="bodyMd" as="p">Pending</Text>
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <Text variant="headingLg" as="h3" tone="success">
                      {stats.processing}
                    </Text>
                    <Text variant="bodyMd" as="p">Processing</Text>
                  </div>
                  
                  <div style={{ flex: 1 }}>
                    <Text variant="headingLg" as="h3" tone="critical">
                      {stats.failed}
                    </Text>
                    <Text variant="bodyMd" as="p">Failed</Text>
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Pending Jobs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Pending Jobs ({pendingJobs.length})
              </Text>
              
              {pendingJobs.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Job ID", "Status", "Type", "Attempts", "Created", "Started", "Completed", "Actions"]}
                  rows={createJobTableRows(pendingJobs)}
                />
              ) : (
                <Text variant="bodyMd" as="p" tone="subdued">
                  No pending jobs
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Processing Jobs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Processing Jobs ({processingJobs.length})
              </Text>
              
              {processingJobs.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Job ID", "Status", "Type", "Attempts", "Created", "Started", "Completed", "Actions"]}
                  rows={createJobTableRows(processingJobs)}
                />
              ) : (
                <Text variant="bodyMd" as="p" tone="subdued">
                  No processing jobs
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Failed Jobs */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                Failed Jobs ({failedJobs.length})
              </Text>
              
              {failedJobs.length > 0 ? (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text", "text", "text"]}
                  headings={["Job ID", "Status", "Type", "Attempts", "Created", "Started", "Completed", "Actions"]}
                  rows={createJobTableRows(failedJobs)}
                />
              ) : (
                <Text variant="bodyMd" as="p" tone="subdued">
                  No failed jobs
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
