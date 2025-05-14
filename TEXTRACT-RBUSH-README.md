# TextractRBush

A JavaScript library for creating an RBush spatial index from AWS TextExtract JSON data and querying text by coordinates.

## Overview

TextractRBush provides a simple way to:

1. Create a spatial index (using RBush) from AWS TextExtract JSON data
2. Query text within a specified rectangle with a configurable overlap ratio

This is particularly useful for applications that need to extract text from specific regions of a document, such as when a user draws a selection rectangle on a PDF viewer.

## Dependencies

- [RBush](https://github.com/mourner/rbush) - A high-performance JavaScript library for 2D spatial indexing

## Installation

### Browser

```html
<!-- Include RBush first -->
<script src="https://unpkg.com/rbush@3.0.1/rbush.min.js"></script>
<!-- Then include TextractRBush -->
<script src="textract-rbush.js"></script>
```

### Node.js

```bash
npm install rbush
```

Then in your code:

```javascript
const rbush = require('rbush');
const TextractRBush = require('./textract-rbush.js');
```

## Usage

### Basic Usage

```javascript
// Create a new TextractRBush instance
const textractRBush = TextractRBush();

// Initialize with AWS TextExtract data
textractRBush.initialize(textractData);

// Query text within a rectangle with 50% overlap
const results = textractRBush.query(
    { x: 0.2, y: 0.3, width: 0.1, height: 0.05 },
    0.5
);

// Display results
console.log(results);
```

### API Reference

#### `TextractRBush()`

Factory function that creates a new TextractRBush instance.

#### `initialize(textractData)`

Initializes the RBush index with AWS TextExtract data.

- **Parameters:**
  - `textractData` (Object): The JSON data from AWS TextExtract
- **Returns:** The TextractRBush instance for chaining

#### `query(rect, overlapRatio, page)`

Queries the RBush index with a rectangle and returns text with coordinates.

- **Parameters:**
  - `rect` (Object): The rectangle to query with properties:
    - `x` (Number): The x-coordinate (normalized 0-1)
    - `y` (Number): The y-coordinate (normalized 0-1)
    - `width` (Number): The width (normalized 0-1)
    - `height` (Number): The height (normalized 0-1)
  - `overlapRatio` (Number, optional): The minimum overlap ratio required (0-1), defaults to 0.5
  - `page` (Number, optional): Page number to filter results, defaults to null (all pages)
- **Returns:** Array of text items with their coordinates and metadata

### Result Format

Each item in the results array has the following properties:

```javascript
{
    text: "Sample text",
    type: "LINE",
    confidence: 99.5,
    page: 1,
    boundingBox: {
        Height: 0.01,
        Left: 0.2,
        Top: 0.3,
        Width: 0.1
    },
    overlapPercentage: 0.75
}
```

## Demo

See `textract-rbush-demo.html` for a complete working example.

## Integration with Existing Code

To integrate with the existing rectangle-text-extractor.html:

1. Include the TextractRBush library in your HTML:
   ```html
   <script src="textract-rbush.js"></script>
   ```

2. Replace the existing `buildSpatialIndex` function with:
   ```javascript
   function buildSpatialIndex(blocks) {
     if (!blocks || blocks.length === 0) {
       console.error('No blocks to index');
       return;
     }
     
     // Initialize TextractRBush
     const textractRBushInstance = TextractRBush();
     textractRBushInstance.initialize({ Blocks: blocks });
     
     // Store the instance for later use
     spatialIndex = textractRBushInstance;
     console.log('Spatial index built with TextractRBush');
   }
   ```

3. Update the `extractTextFromRectangle` function to use the new API:
   ```javascript
   function extractTextFromRectangle(x, y, width, height, pageNumber) {
     if (!spatialIndex) {
       alert('Please process the PDF with Textract first!');
       return;
     }
     
     showLoading('Extracting text...');
     
     // Convert canvas coordinates to normalized PDF coordinates
     const selectionRect = {
       x: x / canvasOverlay.width,
       y: y / canvasOverlay.height,
       width: width / canvasOverlay.width,
       height: height / canvasOverlay.height
     };
     
     // Query the spatial index with the selection rectangle
     const results = spatialIndex.query(
       selectionRect, 
       CELL_COVERAGE_THRESHOLD, 
       pageNumber
     );
     
     // Display results
     displayExtractedText(results, pageNumber);
     
     hideLoading();
   }
   ```

## License

MIT
