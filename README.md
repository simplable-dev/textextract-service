# PDF Table Extraction with AWS Textract

This application extracts tables from PDF documents using AWS Textract and displays them in a user-friendly HTML format.

## How to Run

### Quick Start for Developers

1. **Set up environment variables**:

   ```bash
   cp .env.sample .env
   # Edit .env with your AWS credentials
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Start the server**:

   ```bash
   npm run server
   ```

4. **Access the application**:
   - Open `http://localhost:3000/tables` in your browser
   - For testing without AWS, use `test-server-tables.html` directly in your browser

### Development Notes

- The server runs on port 3000 by default (configurable in .env)
- PDF processing requires valid AWS credentials with Textract and S3 permissions
- For local testing without AWS, use the test HTML file which simulates responses
- Changes to the frontend code in test-server-tables.html don't require server restart

### Troubleshooting

- If you encounter CORS issues, ensure your browser allows local file access
- For AWS credential issues, verify your IAM permissions and region settings
- Check the console logs for detailed error messages during processing

## Features

- Upload PDF files directly from the browser
- Automatically upload PDFs to Amazon S3
- Process PDFs with AWS Textract to extract tables
- Display extracted tables in HTML format
- Extract table images directly from PDF documents
- Download table images with a single click
- Compression of responses for better performance
- Real-time processing status with timer

## Setup

### Prerequisites

- Node.js (v14 or later)
- AWS Account with access to S3 and Textract services
- AWS IAM user with appropriate permissions

### Installation

1. Clone the repository:

   ```
   git clone <repository-url>
   cd <repository-directory>
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Set up environment variables:

   - Copy the sample environment file:
     ```
     cp .env.sample .env
     ```
   - Edit the `.env` file with your AWS credentials and configuration:

     ```
     # AWS Configuration
     AWS_REGION=us-east-1
     AWS_ACCESS_KEY_ID=your_access_key_id
     AWS_SECRET_ACCESS_KEY=your_secret_access_key
     SNS_TOPIC_ARN=your_sns_topic_arn
     SNS_ROLE_ARN=your_sns_role_arn
     S3_BUCKET_NAME=your_s3_bucket_name

     # Server Configuration
     PORT=3000
     ```

### AWS Setup

1. Create an S3 bucket for storing PDF files
2. Set up an SNS topic for Textract notifications
3. Create an IAM role that allows Textract to publish to your SNS topic
4. Create an IAM user with permissions for S3 and Textract operations

## Usage

1. Start the server:

   ```
   npm run server
   ```

2. Open the application in your browser:

   ```
   http://localhost:3000/tables
   ```

3. Use the application in one of two ways:

   - Enter an S3 URL to an existing PDF and click "Send GET Request" or "Send POST Request"
   - Upload a PDF file directly and click "Upload and Process"

4. View and download table images:
   - After processing, tables are displayed in HTML format
   - Upload a PDF file using the file input at the top of the page
   - Click "Extract Table Images from PDF" to process the PDF
   - Each table will have a "Download Image" button to save the table image
   - Images are extracted based on the table coordinates from AWS Textract

## API Endpoints

- `GET /process-pdf?s3Url=<s3-url>`: Process a PDF from an S3 URL (GET request)
- `POST /process-pdf`: Process a PDF from an S3 URL (POST request with JSON body)
- `POST /upload-pdf`: Upload a PDF file to S3 and return the S3 URL

## Security Notes

- Keep your `.env` file secure and never commit it to version control
- Use IAM roles with the principle of least privilege
- Consider using AWS KMS for encrypting sensitive data

## License

[MIT License](LICENSE)
