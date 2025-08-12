import PDFParser from "pdf2json";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Enhanced extraction that captures EVERYTHING pdf2json can provide
async function comprehensivePdfExtraction(pdfPath) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser();
    
    pdfParser.on("pdfParser_dataError", errData => {
      console.error("PDF Parser Error:", errData.parserError);
      reject(errData.parserError);
    });
    
    pdfParser.on("pdfParser_dataReady", pdfData => {
      console.log("=== COMPREHENSIVE PDF EXTRACTION ===\n");
      
      // Capture EVERYTHING the parser provides
      const completeData = {
        timestamp: new Date().toISOString(),
        pdfMeta: pdfData.Meta || {},
        
        // Complete raw pages data
        rawPages: pdfData.Pages,
        
        // Enhanced text extraction with ALL properties
        enhancedTextAnalysis: pdfData.Pages.map((page, pageIndex) => {
          const pageAnalysis = {
            pageNumber: pageIndex + 1,
            width: page.Width || 0,
            height: page.Height || 0,
            totalTexts: page.Texts ? page.Texts.length : 0,
            totalFills: page.Fills ? page.Fills.length : 0,
            texts: []
          };
          
          if (page.Texts) {
            page.Texts.forEach((textBlock, blockIndex) => {
              if (textBlock.R) {
                textBlock.R.forEach((run, runIndex) => {
                  const textInfo = {
                    blockIndex,
                    runIndex,
                    x: textBlock.x,
                    y: textBlock.y,
                    width: textBlock.w || 0,
                    originalText: run.T,
                    decodedText: decodeURIComponent(run.T),
                    // Capture ALL text styling information
                    fontFace: run.TS ? run.TS[0] : null,
                    fontSize: run.TS ? run.TS[1] : null,
                    fontStyle: run.TS ? run.TS[2] : null,
                    fontWeight: run.TS ? run.TS[3] : null,
                    textDecoration: run.TS ? run.TS[4] : null,
                    fontColor: run.TS ? run.TS[5] : null,
                    // Additional properties if available
                    allTextStyles: run.TS || [],
                    rawRun: run
                  };
                  pageAnalysis.texts.push(textInfo);
                });
              }
            });
          }
          
          // Capture fill/shape information if available
          if (page.Fills) {
            pageAnalysis.fills = page.Fills.map(fill => ({
              x: fill.x,
              y: fill.y,
              width: fill.w,
              height: fill.h,
              color: fill.clr || null
            }));
          }
          
          return pageAnalysis;
        }),
        
        // Text organized by similarity in Y position (lines)
        textLines: [],
        
        // Statistical analysis
        statistics: {
          totalPages: pdfData.Pages.length,
          totalTextElements: 0,
          uniqueFontSizes: new Set(),
          uniqueFontFaces: new Set(),
          textWithNumbers: [],
          potentialCurrency: [],
          potentialDates: []
        }
      };
      
      // Analyze and group text into lines with better precision
      const tolerance = 0.5; // Smaller tolerance for better line detection
      const allTexts = [];
      
      completeData.enhancedTextAnalysis.forEach(page => {
        page.texts.forEach(text => {
          allTexts.push({
            ...text,
            page: page.pageNumber
          });
          
          // Update statistics
          completeData.statistics.totalTextElements++;
          if (text.fontSize) completeData.statistics.uniqueFontSizes.add(text.fontSize);
          if (text.fontFace) completeData.statistics.uniqueFontFaces.add(text.fontFace);
          
          // Look for numbers, currency, dates
          const decoded = text.decodedText;
          if (/\d+[.,]\d{2}|\b\d+\b/.test(decoded)) {
            completeData.statistics.textWithNumbers.push(decoded);
          }
          if (/€|USD|EUR|\$|£|¥/.test(decoded)) {
            completeData.statistics.potentialCurrency.push(decoded);
          }
          if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(decoded)) {
            completeData.statistics.potentialDates.push(decoded);
          }
        });
      });
      
      // Group into lines
      const lineGroups = {};
      allTexts.forEach(text => {
        const roundedY = Math.round(text.y / tolerance) * tolerance;
        if (!lineGroups[roundedY]) {
          lineGroups[roundedY] = [];
        }
        lineGroups[roundedY].push(text);
      });
      
      // Convert to sorted lines
      completeData.textLines = Object.keys(lineGroups)
        .map(y => ({
          yPosition: parseFloat(y),
          texts: lineGroups[y].sort((a, b) => a.x - b.x),
          combinedText: lineGroups[y]
            .sort((a, b) => a.x - b.x)
            .map(t => t.decodedText)
            .join(' ')
            .trim()
        }))
        .filter(line => line.combinedText.length > 0)
        .sort((a, b) => a.yPosition - b.yPosition);
      
      // Convert Sets to Arrays for JSON serialization
      completeData.statistics.uniqueFontSizes = Array.from(completeData.statistics.uniqueFontSizes);
      completeData.statistics.uniqueFontFaces = Array.from(completeData.statistics.uniqueFontFaces);
      
      console.log(`📄 Pages: ${completeData.statistics.totalPages}`);
      console.log(`📝 Text Elements: ${completeData.statistics.totalTextElements}`);
      console.log(`🔤 Font Sizes: ${completeData.statistics.uniqueFontSizes.join(', ')}`);
      console.log(`🎨 Font Faces: ${completeData.statistics.uniqueFontFaces.join(', ')}`);
      console.log(`🔢 Numbers Found: ${completeData.statistics.textWithNumbers.length}`);
      console.log(`💰 Currency Symbols: ${completeData.statistics.potentialCurrency.length}`);
      console.log(`📅 Potential Dates: ${completeData.statistics.potentialDates.length}`);
      
      resolve(completeData);
    });
    
    pdfParser.loadPDF(pdfPath);
  });
}

async function main() {
  const pdfPath = join(__dirname, 'Yamamoto.pdf');
  
  console.log(`Testing comprehensive PDF extraction with: ${pdfPath}`);
  console.log(`File exists: ${fs.existsSync(pdfPath)}\n`);
  
  if (!fs.existsSync(pdfPath)) {
    console.error("❌ Yamamoto.pdf not found in project root.");
    console.log("Please place Yamamoto.pdf in the project root directory and run again.");
    return;
  }
  
  try {
    const completeData = await comprehensivePdfExtraction(pdfPath);
    
    // Save comprehensive data
    const outputPath = join(__dirname, 'yamamoto-complete-analysis.json');
    fs.writeFileSync(outputPath, JSON.stringify(completeData, null, 2));
    
    // Also save a human-readable text version
    const textOutputPath = join(__dirname, 'yamamoto-text-only.txt');
    const textOnly = completeData.textLines
      .map((line, index) => `Line ${index + 1}: ${line.combinedText}`)
      .join('\n');
    fs.writeFileSync(textOutputPath, textOnly);
    
    console.log(`\n✅ Complete analysis saved to: ${outputPath}`);
    console.log(`📝 Text-only version saved to: ${textOutputPath}`);
    console.log(`\n🔍 Preview of extracted text lines:`);
    
    // Show first 20 lines as preview
    completeData.textLines.slice(0, 20).forEach((line, index) => {
      console.log(`${index + 1}: ${line.combinedText}`);
    });
    
    if (completeData.textLines.length > 20) {
      console.log(`... and ${completeData.textLines.length - 20} more lines`);
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

main().catch(console.error);