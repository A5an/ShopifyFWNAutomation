import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    },
  );
  const responseJson = await response.json();

  const product = responseJson.data!.productCreate!.product!;
  const variantId = product.variants.edges[0]!.node!.id!;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );

  const variantResponseJson = await variantResponse.json();

  return {
    product: responseJson!.data!.productCreate!.product,
    variant:
      variantResponseJson!.data!.productVariantsBulkUpdate!.productVariants,
  };
};

export default function Index() {
  return (
    <Page>
      <TitleBar title="FWN Invoice Management" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Welcome to FWN Invoice Management System 📄
                  </Text>
                  <Text variant="bodyMd" as="p">
                    Automate your supplier invoice processing with our integrated
                    Shopify app. Upload PDF invoices, track processing status, and
                    automatically calculate weighted average costs for your products.
                  </Text>
                </BlockStack>
                
                <BlockStack gap="300">
                  <Text as="h3" variant="headingMd">
                    Quick Actions
                  </Text>
                  <InlineStack gap="300">
                    <Button variant="primary" url="/app/upload">
                      Upload New Invoice
                    </Button>
                    <Button url="/app/history">
                      View Import History
                    </Button>
                  </InlineStack>
                </BlockStack>

                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    How It Works
                  </Text>
                  <List>
                    <List.Item>
                      <strong>Upload:</strong> Select your supplier and upload a PDF invoice
                    </List.Item>
                    <List.Item>
                      <strong>Process:</strong> Our system extracts product data, quantities, and prices
                    </List.Item>
                    <List.Item>
                      <strong>Calculate:</strong> Weighted average costs are automatically updated
                    </List.Item>
                    <List.Item>
                      <strong>Track:</strong> Monitor processing status and download results
                    </List.Item>
                  </List>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    System Status
                  </Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Supported Suppliers
                      </Text>
                      <Text as="span" variant="bodyMd" tone="success">
                        5 Active
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Processing Status
                      </Text>
                      <Text as="span" variant="bodyMd" tone="success">
                        Online
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Last Update
                      </Text>
                      <Text as="span" variant="bodyMd">
                        Just now
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>
              
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Supported Formats
                  </Text>
                  <List>
                    <List.Item>Bolero invoices</List.Item>
                    <List.Item>XYZ Foods invoices</List.Item>
                    <List.Item>ABC Distributors invoices</List.Item>
                    <List.Item>Fresh Market Co invoices</List.Item>
                    <List.Item>Euro Beverages invoices</List.Item>
                  </List>
                  <Text variant="bodyMd" as="p" tone="subdued">
                    More suppliers will be added based on your needs.
                  </Text>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
