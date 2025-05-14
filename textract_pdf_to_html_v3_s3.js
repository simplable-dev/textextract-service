// textract_pdf_to_html_multipage.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
} from '@aws-sdk/client-textract';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'SNS_TOPIC_ARN',
  'SNS_ROLE_ARN',
  'S3_BUCKET_NAME',
];

const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Error: Missing required environment variables:');
  missingEnvVars.forEach((envVar) => console.error(`- ${envVar}`));
  console.error('Please check your .env file');
  process.exit(1);
}

// Configuration from environment variables
const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const S3_BUCKET = process.env.S3_BUCKET_NAME;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const SNS_ROLE_ARN = process.env.SNS_ROLE_ARN;

// Instantiate AWS SDK clients
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});
const textractClient = new TextractClient({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

// Upload PDF to S3
async function uploadPdfToS3(filePath, bucket, key) {
  const body = fs.readFileSync(filePath);
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/pdf',
    })
  );
}

// Start asynchronous Textract job
async function startAnalysis(bucket, key) {
  const cmd = new StartDocumentAnalysisCommand({
    DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
    FeatureTypes: ['TABLES', 'LAYOUT'],
    NotificationChannel: { RoleArn: SNS_ROLE_ARN, SNSTopicArn: SNS_TOPIC_ARN },
  });
  const { JobId } = await textractClient.send(cmd);
  return JobId;
}

// Poll until job completes and return Blocks
async function getAnalysisResults(jobId) {
  // Wait for job to complete
  let res;
  do {
    await new Promise((r) => setTimeout(r, 5000));
    res = await textractClient.send(
      new GetDocumentAnalysisCommand({ JobId: jobId })
    );
    console.log('Textract job status:', res.JobStatus);
  } while (res.JobStatus === 'IN_PROGRESS');

  if (res.JobStatus !== 'SUCCEEDED')
    throw new Error(`Textract job failed: ${res.JobStatus}`);

  // Collect all blocks from all response pages
  let allBlocks = [...res.Blocks];
  let nextToken = res.NextToken;

  // Continue fetching if there are more pages of results
  while (nextToken) {
    console.log('Fetching next page of Textract results...');
    res = await textractClient.send(
      new GetDocumentAnalysisCommand({
        JobId: jobId,
        NextToken: nextToken,
      })
    );
    allBlocks = [...allBlocks, ...res.Blocks];
    nextToken = res.NextToken;
    console.log(
      `Retrieved ${res.Blocks.length} more blocks, total now: ${allBlocks.length}`
    );
  }

  return allBlocks;
}

// Helper function to check if a bounding box is within another bounding box
function isWithinBoundingBox(innerBox, outerBox) {
  // Check if the inner box is completely within the outer box
  // Allow for some small margin of error (0.01)
  return (
    innerBox.Left >= outerBox.Left - 0.01 &&
    innerBox.Top >= outerBox.Top - 0.01 &&
    innerBox.Left + innerBox.Width <= outerBox.Left + outerBox.Width + 0.01 &&
    innerBox.Top + innerBox.Height <= outerBox.Top + outerBox.Height + 0.01
  );
}

// Recursive text extractor
function getText(block, blockMap) {
  // If the block directly has text, use it
  if (block.Text) {
    return block.Text;
  }

  let txt = '';
  if (!block.Relationships) return txt;

  for (const rel of block.Relationships) {
    if (rel.Type !== 'CHILD') continue;
    for (const id of rel.Ids) {
      const child = blockMap[id];
      if (!child) continue;

      if (child.BlockType === 'WORD' && child.Text) {
        txt += child.Text + ' ';
      } else if (child.BlockType === 'LINE' && child.Text) {
        txt += child.Text + ' ';
      } else {
        txt += getText(child, blockMap) + ' ';
      }
    }
  }
  return txt.trim();
}

// Convert Textract Blocks to HTML focusing on tables
function blocksToHtml(blocks, outFile = '') {
  const blockMap = Object.fromEntries(blocks.map((b) => [b.Id, b]));
  const htmlByPage = {};
  blocks.forEach((b) => {
    if (b.Page) {
      htmlByPage[b.Page] = htmlByPage[b.Page] || [];
    }
  });

  // Add a title to the HTML document
  htmlByPage[1] = htmlByPage[1] || [];
  htmlByPage[1].unshift(
    '<h1 class="document-title">Tables Extracted from PDF</h1>'
  );

  // Add PDF file upload section
  htmlByPage[1].push(`
    <div class="pdf-upload">
      <p>To extract tables as images, upload the original PDF file:</p>
      <input type="file" id="pdf-file-input" accept=".pdf" />
      <button id="load-pdf-btn" onclick="loadPdfFile()">Load PDF</button>
      <p class="pdf-status" id="pdf-status"></p>
    </div>
  `);

  // Count tables per page for the summary
  const tablesByPage = {};
  let totalTables = 0;

  blocks.forEach((block) => {
    if (block.BlockType === 'TABLE' && block.Page) {
      tablesByPage[block.Page] = (tablesByPage[block.Page] || 0) + 1;
      totalTables++;
    }
  });

  // Create summary info
  let summaryHtml = `<p class="document-info">This document contains ${totalTables} table${
    totalTables !== 1 ? 's' : ''
  } extracted from the PDF using Amazon Textract.</p>`;

  // Add table of contents if there are multiple tables
  if (totalTables > 1) {
    summaryHtml += '<div class="table-summary"><h2>Table Summary</h2><ul>';

    Object.keys(tablesByPage)
      .sort((a, b) => parseInt(a) - parseInt(b))
      .forEach((page) => {
        const count = tablesByPage[page];
        summaryHtml += `<li>Page ${page}: ${count} table${
          count !== 1 ? 's' : ''
        }</li>`;
      });

    summaryHtml += '</ul></div>';
  }

  htmlByPage[1].push(summaryHtml);

  // Render tables with titles and page numbers
  Object.keys(htmlByPage)
    .sort((a, b) => a - b)
    .forEach((pageNumStr) => {
      const pageNum = parseInt(pageNumStr, 10);
      const tables = blocks.filter(
        (b) => b.Page === pageNum && b.BlockType === 'TABLE'
      );

      // Find table titles
      const tableTitles = blocks.filter(
        (b) => b.Page === pageNum && b.BlockType === 'TABLE_TITLE'
      );

      for (const table of tables) {
        const cells = [];
        if (table.Relationships) {
          for (const rel of table.Relationships) {
            if (rel.Type !== 'CHILD') continue;
            for (const id of rel.Ids) {
              const c = blockMap[id];
              if (c && c.BlockType === 'CELL') cells.push(c);
            }
          }
        }

        // Skip empty tables
        if (cells.length === 0) continue;

        const maxRow = Math.max(...cells.map((c) => c.RowIndex || 0));
        const maxCol = Math.max(...cells.map((c) => c.ColumnIndex || 0));

        // Skip invalid tables
        if (maxRow === 0 || maxCol === 0) continue;

        // Find a title for this table based on proximity
        let tableTitle = '';
        if (tableTitles.length > 0 && table.Geometry) {
          // Find the closest title above the table
          const tableTop = table.Geometry.BoundingBox.Top;
          const titlesAbove = tableTitles.filter(
            (t) => t.Geometry && t.Geometry.BoundingBox.Top < tableTop
          );

          if (titlesAbove.length > 0) {
            // Get the closest title
            const closestTitle = titlesAbove.reduce((closest, current) => {
              const closestDist = Math.abs(
                closest.Geometry.BoundingBox.Top - tableTop
              );
              const currentDist = Math.abs(
                current.Geometry.BoundingBox.Top - tableTop
              );
              return currentDist < closestDist ? current : closest;
            });

            tableTitle = closestTitle.Text || getText(closestTitle, blockMap);
          }
        }

        // Extract table coordinates
        let tableCoordinates = '';
        if (table.Geometry && table.Geometry.BoundingBox) {
          const bbox = table.Geometry.BoundingBox;
          // Store coordinates as data attributes (normalized 0-1 values)
          tableCoordinates = `data-page="${pageNum}" data-left="${bbox.Left.toFixed(
            4
          )}" data-top="${bbox.Top.toFixed(
            4
          )}" data-width="${bbox.Width.toFixed(
            4
          )}" data-height="${bbox.Height.toFixed(4)}"`;
        }

        // Start table with title and page number
        htmlByPage[pageNum].push(
          `<div class="table-container" ${tableCoordinates}>`
        );
        htmlByPage[pageNum].push(
          `<div class="table-page">Page ${pageNum}</div>`
        );
        if (tableTitle) {
          htmlByPage[pageNum].push(
            `<div class="table-title">${tableTitle}</div>`
          );
        } else {
          // If no title found, create a generic one
          htmlByPage[pageNum].push(
            `<div class="table-title">Table from Page ${pageNum}</div>`
          );
        }

        // Add toggle button and container for the image (hidden by default)
        htmlByPage[pageNum].push(`
          <div class="table-controls">
            <button class="toggle-view-btn" onclick="toggleTableView(this.parentNode.parentNode)" disabled>Upload PDF First</button>
            <span class="view-status">Showing: HTML Table</span>
          </div>
          <div class="table-image-container" style="display:none;">
            <img class="table-image" alt="Table image will appear here after PDF is loaded" />
          </div>
        `);

        htmlByPage[pageNum].push('<table>');

        for (let r = 1; r <= maxRow; r++) {
          htmlByPage[pageNum].push('<tr>');
          for (let c = 1; c <= maxCol; c++) {
            const cell = cells.find(
              (x) => x.RowIndex === r && x.ColumnIndex === c
            );

            // Get text from the cell - try direct text first, then relationships
            let text = '';
            if (cell) {
              // If the cell has direct text, use it
              if (cell.Text) {
                text = cell.Text;
              } else {
                // Otherwise use the getText function which handles relationships
                text = getText(cell, blockMap);
              }

              // If still no text, try to find WORD blocks directly
              if (!text.trim() && cell.Geometry) {
                // Find all WORD blocks that are within this cell's bounding box
                const cellWords = blocks.filter(
                  (b) =>
                    b.Page === pageNum &&
                    b.BlockType === 'WORD' &&
                    b.Text &&
                    b.Geometry &&
                    isWithinBoundingBox(
                      b.Geometry.BoundingBox,
                      cell.Geometry.BoundingBox
                    )
                );

                if (cellWords.length > 0) {
                  // Sort words by position (top to bottom, left to right)
                  cellWords.sort((a, b) => {
                    const ay = a.Geometry.BoundingBox.Top;
                    const by = b.Geometry.BoundingBox.Top;
                    if (Math.abs(ay - by) > 0.01) return ay - by;
                    return (
                      a.Geometry.BoundingBox.Left - b.Geometry.BoundingBox.Left
                    );
                  });

                  text = cellWords.map((w) => w.Text).join(' ');
                }
              }
            }

            // Check if this is a header cell (first row)
            if (r === 1) {
              // Add scope attribute for better accessibility
              htmlByPage[pageNum].push(`<th scope="col">${text}</th>`);
            } else {
              // For the first column, consider it as a row header if it contains text
              if (c === 1 && text.trim()) {
                htmlByPage[pageNum].push(`<th scope="row">${text}</th>`);
              } else {
                htmlByPage[pageNum].push(`<td>${text}</td>`);
              }
            }
          }
          htmlByPage[pageNum].push('</tr>');
        }
        htmlByPage[pageNum].push('</table>');
        htmlByPage[pageNum].push('</div>'); // Close table-container
      }
    });

  // Wrap pages and concatenate
  const htmlContent = Object.entries(htmlByPage)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
    .map(
      ([page, segs]) => `<div class="page" data-page="${page}">
${segs.join('\n')}
</div>`
    )
    .join('\n');

  // Add basic CSS styling
  const cssStyles = `
<style>
  body {
    font-family: "Times New Roman", Times, serif;
    line-height: 1.4;
    margin: 0;
    padding: 40px;
    color: #000;
    background-color: #fff;
    max-width: 1000px;
    margin: 0 auto;
  }
  .page {
    margin-bottom: 40px;
    padding-bottom: 40px;
    border-bottom: 1px solid #ccc;
    page-break-after: always;
  }
  .document-title {
    color: #000;
    font-size: 24px;
    margin-bottom: 16px;
    font-weight: bold;
    text-align: center;
  }
  .document-info {
    color: #444;
    margin-bottom: 24px;
    text-align: center;
  }
  .table-summary {
    background-color: #f9f9f9;
    border: 1px solid #ddd;
    padding: 16px;
    margin-bottom: 32px;
    font-family: Arial, sans-serif;
    font-size: 14px;
  }
  .table-summary h2 {
    color: #000;
    font-size: 16px;
    margin-top: 0;
    margin-bottom: 12px;
    font-weight: bold;
  }
  .table-summary ul {
    margin: 0;
    padding-left: 24px;
  }
  .table-summary li {
    margin-bottom: 6px;
  }
  h2 {
    color: #000;
    margin-top: 24px;
    font-weight: bold;
  }
  p {
    margin: 12px 0;
  }
  .table-container {
    margin: 24px 0 32px 0;
    page-break-inside: avoid;
  }
  .table-title {
    font-weight: bold;
    font-size: 16px;
    margin-bottom: 8px;
    text-align: center;
  }
  .table-page {
    color: #666;
    font-size: 12px;
    text-align: right;
    margin-bottom: 4px;
    font-style: italic;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 0;
    font-size: 14px;
  }
  th, td {
    border: 0.5px solid #000;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background-color: #f2f2f2;
    font-weight: bold;
  }
  th[scope="col"] {
    background-color: #e6e6e6;
    border-bottom: 1px solid #999;
  }
  th[scope="row"] {
    background-color: #f5f5f5;
    text-align: left;
    font-weight: bold;
  }
  tr:nth-child(even) {
    background-color: #f9f9f9;
  }

  /* Footer styles */
  footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid #ddd;
    font-size: 12px;
    color: #666;
    text-align: center;
  }
  .source-info, .generation-info {
    margin: 5px 0;
  }

  /* Print-specific styles */
  @media print {
    body {
      padding: 0;
      font-size: 12pt;
    }
    .table-container {
      break-inside: avoid;
    }
    .table-summary {
      background-color: transparent;
      border: none;
      padding: 0;
    }
    footer {
      position: fixed;
      bottom: 0;
      width: 100%;
      border-top: 0.5px solid #ddd;
    }
  }
  dl.key-value-pairs {
    display: grid;
    grid-template-columns: max-content auto;
    gap: 10px;
    margin: 15px 0;
  }
  dt {
    font-weight: bold;
    grid-column: 1;
  }
  dd {
    grid-column: 2;
    margin: 0;
  }
</style>
`;

  // Get the original filename for reference
  const originalFilename = path.basename(outFile, '.html');

  // Add JavaScript for PDF.js and table extraction
  const jsCode = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.min.js"></script>
<script>
  // Set PDF.js worker path
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

  // Store the PDF data and loaded state
  let pdfData = null;
  let pdfLoaded = false;

  // Function to load the PDF file and extract all table images
  async function loadPdfFile() {
    const fileInput = document.getElementById('pdf-file-input');
    const statusElement = document.getElementById('pdf-status');

    if (!fileInput.files || fileInput.files.length === 0) {
      statusElement.textContent = 'Please select a PDF file first';
      statusElement.style.color = 'red';
      return;
    }

    const file = fileInput.files[0];
    if (file.type !== 'application/pdf') {
      statusElement.textContent = 'Please select a valid PDF file';
      statusElement.style.color = 'red';
      return;
    }

    statusElement.textContent = 'Loading PDF...';
    statusElement.style.color = 'blue';

    try {
      // Read the file as ArrayBuffer
      const arrayBuffer = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      // Store the PDF data
      pdfData = new Uint8Array(arrayBuffer);

      // Update status
      statusElement.textContent = 'PDF loaded. Extracting table images...';

      // Get all table containers
      const tableContainers = document.querySelectorAll('.table-container');

      // Process each table container
      for (let i = 0; i < tableContainers.length; i++) {
        const container = tableContainers[i];
        statusElement.textContent = 'Extracting table ' + (i+1) + ' of ' + tableContainers.length + '...';

        // Extract the image for this table
        await extractTableImage(container, false);

        // Update the button text and enable it
        const button = container.querySelector('.toggle-view-btn');
        button.textContent = 'Show Image View';
        button.disabled = false;
      }

      // Mark PDF as loaded
      pdfLoaded = true;

      // Update status
      statusElement.textContent = 'PDF loaded successfully! Extracted ' + tableContainers.length + ' table images.';
      statusElement.style.color = 'green';
    } catch (error) {
      console.error('Error loading PDF:', error);
      statusElement.textContent = 'Error loading PDF: ' + error.message;
      statusElement.style.color = 'red';
    }
  }

  // Function to toggle between HTML table and image view
  function toggleTableView(tableContainer) {
    if (!pdfLoaded) {
      alert('Please load a PDF file first');
      return;
    }

    const tableElement = tableContainer.querySelector('table');
    const imageContainer = tableContainer.querySelector('.table-image-container');
    const button = tableContainer.querySelector('.toggle-view-btn');
    const statusText = tableContainer.querySelector('.view-status');

    if (tableElement.style.display !== 'none') {
      // Switch to image view
      tableElement.style.display = 'none';
      imageContainer.style.display = 'block';
      button.textContent = 'Show HTML Table';
      statusText.textContent = 'Showing: Image View';
    } else {
      // Switch to HTML table view
      tableElement.style.display = '';
      imageContainer.style.display = 'none';
      button.textContent = 'Show Image View';
      statusText.textContent = 'Showing: HTML Table';
    }
  }

  // Function to extract table as image
  async function extractTableImage(tableContainer, download = false) {
    try {
      // Get table coordinates from data attributes
      const page = parseInt(tableContainer.getAttribute('data-page'));
      const left = parseFloat(tableContainer.getAttribute('data-left'));
      const top = parseFloat(tableContainer.getAttribute('data-top'));
      const width = parseFloat(tableContainer.getAttribute('data-width'));
      const height = parseFloat(tableContainer.getAttribute('data-height'));

      if (!page || isNaN(left) || isNaN(top) || isNaN(width) || isNaN(height)) {
        alert('Missing coordinate data for this table');
        return;
      }

      // Check if PDF data is available
      if (!pdfData) {
        alert('Please load a PDF file first using the button at the top of the page');
        return;
      }

      // Get the button and image elements
      const button = tableContainer.querySelector('.toggle-view-btn');
      const imageElement = tableContainer.querySelector('.table-image');

      // Load the PDF
      const loadingTask = pdfjsLib.getDocument(pdfData);
      const pdf = await loadingTask.promise;

      // Get the specific page
      const pdfPage = await pdf.getPage(page);

      // Get the viewport at a higher scale for better quality
      const scale = 2.0;
      const viewport = pdfPage.getViewport({ scale });

      // Calculate the dimensions in pixels
      const pixelLeft = left * viewport.width;
      const pixelTop = top * viewport.height;
      const pixelWidth = width * viewport.width;
      const pixelHeight = height * viewport.height;

      // Create a canvas element
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');

      // Set canvas dimensions to match the table
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;

      // Set up rendering parameters
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
        transform: [1, 0, 0, 1, -pixelLeft, -pixelTop]
      };

      // Render the page to the canvas
      await pdfPage.render(renderContext).promise;

      // Convert canvas to image
      const imageDataUrl = canvas.toDataURL('image/png');

      // Set the image source
      imageElement.src = imageDataUrl;

      // If download is requested, trigger download
      if (download) {
        const link = document.createElement('a');
        link.href = imageDataUrl;
        link.download = 'table_page' + page + '_' + left.toFixed(2) + '_' + top.toFixed(2) + '.png';
        link.click();
      }

      return imageDataUrl;
    } catch (error) {
      console.error('Error extracting table:', error);
      if (download) {
        alert('Error extracting table: ' + error.message);
      }
      return null;
    }
  }
</script>
`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Tables from ${originalFilename}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${cssStyles}
  <style>
    .pdf-upload {
      background-color: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 5px;
      padding: 15px;
      margin: 20px 0;
      text-align: center;
    }
    .pdf-upload p {
      margin: 10px 0;
    }
    .pdf-upload input[type="file"] {
      margin: 10px 0;
    }
    .pdf-status {
      font-style: italic;
      margin-top: 10px;
    }
    #load-pdf-btn {
      background-color: #007bff;
      color: white;
      border: none;
      padding: 8px 15px;
      text-align: center;
      text-decoration: none;
      display: inline-block;
      font-size: 14px;
      margin: 4px 2px;
      cursor: pointer;
      border-radius: 4px;
    }
    #load-pdf-btn:hover {
      background-color: #0069d9;
    }
    .table-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 8px 0;
    }
    .toggle-view-btn {
      background-color: #4CAF50;
      color: white;
      border: none;
      padding: 5px 10px;
      text-align: center;
      text-decoration: none;
      display: inline-block;
      font-size: 12px;
      margin: 4px 2px;
      cursor: pointer;
      border-radius: 4px;
    }
    .toggle-view-btn:hover {
      background-color: #45a049;
    }
    .toggle-view-btn:disabled {
      background-color: #cccccc;
      color: #666666;
      cursor: not-allowed;
    }
    .view-status {
      font-size: 12px;
      color: #666;
      font-style: italic;
    }
    .table-image-container {
      width: 100%;
      overflow: auto;
      border: 1px solid #ddd;
      margin-bottom: 15px;
    }
    .table-image {
      max-width: 100%;
      display: block;
    }
  </style>
</head>
<body>
  ${htmlContent}
  <footer>
    <p class="source-info">Source: ${originalFilename}</p>
    <p class="generation-info">Generated on ${new Date().toLocaleString()}</p>
  </footer>
  ${jsCode}
</body>
</html>`;
}

// Main execution
async function main() {
  const [, , localPath, s3Key] = process.argv;
  if (!localPath || !s3Key) {
    console.error(
      'Usage: node textract_pdf_to_html_v3_s3.js <localPdfPath> <s3Key>'
    );
    process.exit(1);
  }
  await uploadPdfToS3(localPath, S3_BUCKET, s3Key);
  console.log('Uploaded to S3:', s3Key);
  const jobId = await startAnalysis(S3_BUCKET, s3Key);
  console.log('Started Textract job:', jobId);
  const blocks = await getAnalysisResults(jobId);
  console.log(`Retrieved ${blocks.length} blocks from Textract`);
  // Count block types for debugging
  const blockTypeCounts = {};
  blocks.forEach((block) => {
    blockTypeCounts[block.BlockType] =
      (blockTypeCounts[block.BlockType] || 0) + 1;
  });
  console.log('Block type counts:', blockTypeCounts);

  // Generate output filename
  const outFile = path.basename(localPath, path.extname(localPath)) + '.html';

  // Generate HTML
  const html = blocksToHtml(blocks, outFile);

  // Save HTML file
  fs.writeFileSync(outFile, html);
  console.log('HTML written to', outFile);

  // Also save raw blocks for debugging if needed
  const debugFile =
    path.basename(localPath, path.extname(localPath)) + '-debug.json';
  fs.writeFileSync(debugFile, JSON.stringify(blocks, null, 2));
  console.log('Debug data written to', debugFile);
}

main().catch((err) => console.error(err));
