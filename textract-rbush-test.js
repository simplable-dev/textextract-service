/**
 * TextractRBush Test Script
 * 
 * This script demonstrates how to use the TextractRBush library with Node.js.
 * It loads the sample TextExtract data, initializes the RBush index, and performs
 * some example queries.
 */

const fs = require('fs');
const path = require('path');

// Import RBush (required for TextractRBush to work)
global.rbush = require('rbush');

// Import TextractRBush
const TextractRBush = require('./textract-rbush.js');

// Main function
async function main() {
    try {
        console.log('Loading TextExtract data...');
        
        // Load the sample TextExtract data
        const dataPath = path.join(__dirname, 'hardcoddedData.json');
        const textractData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        
        console.log(`Loaded TextExtract data with ${textractData.Blocks.length} blocks`);
        
        // Initialize TextractRBush
        console.log('Initializing TextractRBush...');
        const textractRBush = TextractRBush();
        textractRBush.initialize(textractData);
        
        console.log('TextractRBush initialized successfully');
        
        // Example 1: Query with a small rectangle in the top-left corner
        console.log('\nExample 1: Small rectangle in top-left corner');
        const results1 = textractRBush.query(
            { x: 0.05, y: 0.05, width: 0.1, height: 0.1 },
            0.5
        );
        
        console.log(`Found ${results1.length} text blocks`);
        printResults(results1, 3);
        
        // Example 2: Query with a larger rectangle in the middle
        console.log('\nExample 2: Larger rectangle in the middle');
        const results2 = textractRBush.query(
            { x: 0.3, y: 0.3, width: 0.4, height: 0.2 },
            0.7
        );
        
        console.log(`Found ${results2.length} text blocks`);
        printResults(results2, 3);
        
        // Example 3: Query with different overlap ratios
        console.log('\nExample 3: Same rectangle with different overlap ratios');
        
        const rect = { x: 0.2, y: 0.2, width: 0.3, height: 0.1 };
        
        for (let ratio = 0.1; ratio <= 0.9; ratio += 0.2) {
            const results = textractRBush.query(rect, ratio);
            console.log(`Overlap ratio ${ratio.toFixed(1)}: Found ${results.length} text blocks`);
        }
        
        // Example 4: Query with page filter
        console.log('\nExample 4: Query with page filter');
        
        const allPagesResults = textractRBush.query(
            { x: 0, y: 0, width: 1, height: 1 },
            0.1
        );
        
        const page1Results = textractRBush.query(
            { x: 0, y: 0, width: 1, height: 1 },
            0.1,
            1
        );
        
        console.log(`All pages: Found ${allPagesResults.length} text blocks`);
        console.log(`Page 1 only: Found ${page1Results.length} text blocks`);
        
        console.log('\nTest completed successfully');
    } catch (error) {
        console.error('Error:', error);
    }
}

// Helper function to print a subset of results
function printResults(results, limit = 3) {
    const count = Math.min(results.length, limit);
    
    for (let i = 0; i < count; i++) {
        const result = results[i];
        console.log(`[${i + 1}] Text: "${result.text || '(No text)'}"`);
        console.log(`    Type: ${result.type}, Page: ${result.page}, Overlap: ${(result.overlapPercentage * 100).toFixed(1)}%`);
        console.log(`    BoundingBox: (${result.boundingBox.Left.toFixed(2)}, ${result.boundingBox.Top.toFixed(2)}) - ${result.boundingBox.Width.toFixed(2)}x${result.boundingBox.Height.toFixed(2)}`);
    }
    
    if (results.length > limit) {
        console.log(`... and ${results.length - limit} more results`);
    }
}

// Run the main function
main();
