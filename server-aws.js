// server-aws.js
// A Node.js server that accepts an S3 URL to a PDF file and returns the raw AWS Textract JSON response

import express from 'express';
import compression from 'compression';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
dotenv.config({ override: false });
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

// Load environment variables from .env file

// Validate required environment variables
const requiredEnvVars = [
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'SNS_TOPIC_ARN',
  'SNS_ROLE_ARN',
  'S3_BUCKET_NAME'
];

console.warn('ENV debug:', {
  SNS_TOPIC_ARN: process.env.SNS_TOPIC_ARN,
  SNS_ROLE_ARN: process.env.SNS_ROLE_ARN,
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
});


const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.error('Error: Missing required environment variables:');
  missingEnvVars.forEach((envVar) => console.error(`- ${envVar}`));
  console.error('Please check your .env file');
  process.exit(1);
}
import {
  TextractClient,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
} from '@aws-sdk/client-textract';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

// AWS Configuration from environment variables
const AWS_REGION = process.env.AWS_REGION;
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const SNS_TOPIC_ARN = process.env.SNS_TOPIC_ARN;
const SNS_ROLE_ARN = process.env.SNS_ROLE_ARN;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

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

// Enable CORS for all routes
app.use(
  cors({
    origin: '*', // Allow all origins
    methods: ['GET', 'POST'], // Allow only GET and POST methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allow these headers
  })
);

// Enable gzip compression for all responses
app.use(
  compression({
    // Set compression level (1-9, where 9 is maximum compression)
    level: 6,
    // Only compress responses larger than 1KB
    threshold: 1024,
    // Don't compress responses that have a Cache-Control header with no-transform directive
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        // Don't compress responses if the client specifically asks not to
        return false;
      }
      // Use the default filter function for all other cases
      return compression.filter(req, res);
    },
  })
);

// Middleware to parse JSON bodies
app.use(express.json());

// Middleware to parse URL-encoded bodies
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static('.'));

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store files in memory
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Limit file size to 10MB
  },
  fileFilter: (req, file, cb) => {
    // Accept only PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
});

// Function to upload file to S3
async function uploadToS3(fileBuffer, fileName) {
  try {
    // Generate a unique key for the file
    const timestamp = Date.now();
    const key = `uploads/${timestamp}-${fileName}`;

    // Upload the file to S3
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: 'application/pdf',
    });

    await s3Client.send(command);

    // Return the S3 URL
    return `s3://${S3_BUCKET_NAME}/${key}`;
  } catch (error) {
    console.error('Error uploading to S3:', error);
    throw error;
  }
}

// Middleware to log response size after compression
app.use((req, res, next) => {
  // Store the original end method
  const originalEnd = res.end;

  // Override the end method
  res.end = function (chunk, encoding) {
    // Only log for JSON responses from our API endpoints
    if (
      req.path.includes('/process-pdf') &&
      res.getHeader('Content-Type')?.includes('application/json')
    ) {
      const contentLength =
        res.getHeader('Content-Length') || (chunk ? chunk.length : 0);
      console.log(
        `Response size after compression: ${(contentLength / 1024).toFixed(
          2
        )} KB`
      );

      // Calculate compression ratio if we have the original size
      if (req.originalSize) {
        const ratio = (
          ((req.originalSize - contentLength) / req.originalSize) *
          100
        ).toFixed(2);
        console.log(`Compression ratio: ${ratio}% reduction`);
      }
    }

    // Call the original end method
    return originalEnd.call(this, chunk, encoding);
  };

  next();
});

// Serve the test HTML pages
app.get('/', (req, res) => {
  res.sendFile('test-server.html', { root: '.' });
});

app.get('/tables', (req, res) => {
  res.sendFile('test-server-tables.html', { root: '.' });
});

app.get('/rectangle-extractor', (req, res) => {
  res.sendFile('rectangle-text-extractor.html', { root: '.' });
});

// Function to parse S3 URL
function parseS3Url(s3Url) {
  try {
    // Handle URLs in the format: https://bucket-name.s3.region.amazonaws.com/key
    // or s3://bucket-name/key
    let bucket, key;

    if (s3Url.startsWith('https://')) {
      const url = new URL(s3Url);
      const hostParts = url.hostname.split('.');

      if (hostParts[1] === 's3' && hostParts.includes('amazonaws.com')) {
        bucket = hostParts[0];
        // Remove leading slash
        key = url.pathname.substring(1);
      } else {
        throw new Error('Invalid S3 URL format');
      }
    } else if (s3Url.startsWith('s3://')) {
      const parts = s3Url.substring(5).split('/');
      bucket = parts[0];
      key = parts.slice(1).join('/');
    } else {
      throw new Error('Invalid S3 URL format');
    }

    return { bucket, key };
  } catch (error) {
    console.error('Error parsing S3 URL:', error);
    throw new Error('Invalid S3 URL format');
  }
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

// Poll until job completes and return all results
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

  // Create a complete response object
  const completeResponse = {
    JobId: jobId,
    Status: 'SUCCEEDED',
    DocumentMetadata: res.DocumentMetadata,
    Blocks: allBlocks,
  };

  return completeResponse;
}

// Process PDF from S3 URL
async function processPdfFromS3(s3Url) {
  try {
    // Parse the S3 URL to get bucket and key
    const { bucket, key } = parseS3Url(s3Url);
    console.log(`Processing PDF from bucket: ${bucket}, key: ${key}`);

    // Start Textract analysis job
    const jobId = await startAnalysis(bucket, key);
    console.log('Started Textract job:', jobId);

    // Get analysis results
    const results = await getAnalysisResults(jobId);
    console.log(`Retrieved ${results.Blocks.length} blocks from Textract`);

    // Count block types for debugging
    const blockTypeCounts = {};
    results.Blocks.forEach((block) => {
      blockTypeCounts[block.BlockType] =
        (blockTypeCounts[block.BlockType] || 0) + 1;
    });
    console.log('Block type counts:', blockTypeCounts);

    return results;
  } catch (error) {
    console.error('Error processing PDF:', error);
    throw error;
  }
}

// Route to handle S3 URL requests
app.get('/process-pdf', async (req, res) => {
  // Get the S3 URL from the query parameters
  const s3Url = req.query.s3Url;

  if (!s3Url) {
    return res.status(400).json({ error: 'Missing S3 URL parameter' });
  }

  // Log the received S3 URL
  console.log('Received S3 URL:', s3Url);

  try {
    // Process the PDF and get Textract results
    const results = await processPdfFromS3(s3Url);

    // Log response size before compression
    const responseSize = JSON.stringify(results).length;
    console.log(
      `Response size before compression: ${(responseSize / 1024).toFixed(2)} KB`
    );

    // Store original size for compression ratio calculation
    req.originalSize = responseSize;

    // Return the raw Textract JSON response (will be compressed by the middleware)
    res.json(results);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Route to handle file uploads
app.post('/upload-pdf', upload.single('pdfFile'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Upload the file to S3
    const s3Url = await uploadToS3(req.file.buffer, req.file.originalname);

    // Return the S3 URL
    res.json({
      success: true,
      message: 'File uploaded successfully',
      s3Url: s3Url,
      fileName: req.file.originalname,
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: error.message });
  }
});

// Alternative route that accepts POST requests with JSON body
app.post('/process-pdf', async (req, res) => {
  // Get the S3 URL from the request body
  const s3Url = req.body.s3Url;

  if (!s3Url) {
    return res
      .status(400)
      .json({ error: 'Missing S3 URL parameter in request body' });
  }

  app.post('/echo', (req, res) => {
    res.status(200).json(req.body);
  });

  // Log the received S3 URL
  console.log('Received S3 URL:', s3Url);

  try {
    // Process the PDF and get Textract results
    const results = await processPdfFromS3(s3Url);

    // Log response size before compression
    const responseSize = JSON.stringify(results).length;
    console.log(
      `Response size before compression: ${(responseSize / 1024).toFixed(2)} KB`
    );

    // Store original size for compression ratio calculation
    req.originalSize = responseSize;

    // Return the raw Textract JSON response (will be compressed by the middleware)
    res.json(results);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(
    `To test, visit: http://localhost:${port}/process-pdf?s3Url=your-s3-url-here`
  );
  console.log(
    'Or send a POST request to the same endpoint with {"s3Url": "your-s3-url-here"} in the body'
  );
});
