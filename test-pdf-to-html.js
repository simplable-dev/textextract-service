// test-pdf-to-html.js
// Simple script to test the PDF to HTML conversion

import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Check if a PDF file was provided as an argument
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Please provide a path to a PDF file as an argument');
  console.error('Usage: node test-pdf-to-html.js path/to/your/file.pdf');
  process.exit(1);
}

// Make sure the file exists
if (!fs.existsSync(pdfPath)) {
  console.error(`File not found: ${pdfPath}`);
  process.exit(1);
}

// Generate a unique S3 key based on the filename
const s3Key = `test-${path.basename(pdfPath)}-${Date.now()}`;

// Run the conversion script
console.log(`Converting ${pdfPath} to HTML...`);
exec(`node textract_pdf_to_html_v3_s3.js "${pdfPath}" "${s3Key}"`, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.error(`stderr: ${stderr}`);
    return;
  }
  console.log(stdout);
  
  // Check if the HTML file was created
  const htmlPath = path.basename(pdfPath, path.extname(pdfPath)) + '.html';
  if (fs.existsSync(htmlPath)) {
    console.log(`\nHTML file created: ${htmlPath}`);
    console.log(`You can open it in your browser to view the result.`);
  } else {
    console.error(`\nHTML file was not created.`);
  }
});
