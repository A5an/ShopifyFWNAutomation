import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function updateToPublicPaths() {
  console.log('🔄 Updating PDF paths to use public folder format...');
  
  try {
    // Get all invoices with PDF files
    const invoices = await prisma.invoice.findMany({
      where: {
        pdfFileName: {
          not: null
        }
      }
    });

    console.log(`📄 Found ${invoices.length} invoices to update`);

    for (const invoice of invoices) {
      if (invoice.pdfFileName) {
        // Create the relative public path format: /pdfs/filename.pdf
        const publicPath = `/pdfs/${invoice.pdfFileName}`;
        
        // Update the database record
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: {
            pdfFilePath: publicPath
          }
        });
        
        console.log(`✅ Updated invoice ${invoice.id}`);
        console.log(`   File: ${invoice.pdfFileName}`);
        console.log(`   New path: ${publicPath}`);
      }
    }

    console.log('🎉 Successfully updated all PDF paths to public format!');
    console.log('📁 PDFs are now accessible directly via /pdfs/filename.pdf URLs');
    
  } catch (error) {
    console.error('❌ Error updating PDF paths:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the update
updateToPublicPaths();
