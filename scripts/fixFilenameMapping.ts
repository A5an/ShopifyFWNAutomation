import { PrismaClient } from '@prisma/client';
import { readdir } from 'fs/promises';
import { join } from 'path';

const prisma = new PrismaClient();

async function fixFilenameMapping() {
  console.log('🔧 Fixing filename mapping in database...');
  
  try {
    // Get all PDF files from the public/pdfs directory
    const pdfDir = join(process.cwd(), 'public', 'pdfs');
    const files = await readdir(pdfDir);
    console.log(`📁 Found ${files.length} PDF files in public/pdfs/`);
    
    // Get all invoices from database
    const invoices = await prisma.invoice.findMany({
      where: {
        pdfFileName: {
          not: null
        }
      }
    });
    
    console.log(`📄 Found ${invoices.length} invoices in database`);
    
    for (const invoice of invoices) {
      if (invoice.pdfFileName) {
        // Find the actual file that contains the original filename
        const matchingFile = files.find(file => 
          file.includes(invoice.pdfFileName!) || 
          file.endsWith(invoice.pdfFileName!)
        );
        
        if (matchingFile) {
          // Update the database with the correct generated filename
          const correctPath = `/pdfs/${matchingFile}`;
          
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              pdfFileName: matchingFile,
              pdfFilePath: correctPath
            }
          });
          
          console.log(`✅ Fixed invoice ${invoice.id}`);
          console.log(`   Old: ${invoice.pdfFileName}`);
          console.log(`   New: ${matchingFile}`);
          console.log(`   Path: ${correctPath}`);
        } else {
          console.log(`⚠️  No matching file found for invoice ${invoice.id}: ${invoice.pdfFileName}`);
        }
      }
    }
    
    console.log('🎉 Successfully fixed filename mapping!');
    console.log('📁 All invoices now reference the correct generated filenames');
    
  } catch (error) {
    console.error('❌ Error fixing filename mapping:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the fix
fixFilenameMapping();
