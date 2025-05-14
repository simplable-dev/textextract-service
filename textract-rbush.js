/**
 * TextractRBush - A library for creating an RBush spatial index from AWS TextExtract data
 * and querying text by coordinates.
 */

(function(global) {
    'use strict';

    /**
     * TextractRBush class for creating and querying a spatial index of text from AWS TextExtract
     */
    class TextractRBush {
        /**
         * Constructor
         */
        constructor() {
            this.rbush = null;
            this.blockMap = {};
            this.initialized = false;
        }

        /**
         * Initialize the RBush index with AWS TextExtract data
         * @param {Object} textractData - The JSON data from AWS TextExtract
         * @returns {TextractRBush} - Returns this instance for chaining
         */
        initialize(textractData) {
            if (!textractData || !textractData.Blocks || !Array.isArray(textractData.Blocks)) {
                throw new Error('Invalid TextExtract data: Blocks array is missing or invalid');
            }

            // Create a new RBush instance
            this.rbush = new rbush();
            this.blockMap = {};
            
            // First, create a map of all blocks by ID for easy lookup
            textractData.Blocks.forEach(block => {
                this.blockMap[block.Id] = block;
            });

            // Process all blocks with geometry
            const items = [];
            textractData.Blocks.forEach(block => {
                if (block.Geometry && block.Geometry.BoundingBox) {
                    const bbox = block.Geometry.BoundingBox;
                    const text = this._getTextFromBlock(block);
                    
                    // Only include blocks that have text or are of specific types we want to index
                    if (text || this._isIndexableBlockType(block.BlockType)) {
                        items.push({
                            minX: bbox.Left,
                            minY: bbox.Top,
                            maxX: bbox.Left + bbox.Width,
                            maxY: bbox.Top + bbox.Height,
                            block: {
                                id: block.Id,
                                type: block.BlockType,
                                text: text,
                                confidence: block.Confidence,
                                page: block.Page,
                                boundingBox: bbox
                            }
                        });
                    }
                }
            });

            // Load items into the RBush index
            this.rbush.load(items);
            this.initialized = true;
            
            return this;
        }

        /**
         * Query the RBush index with a rectangle
         * @param {Object} rect - The rectangle to query {x, y, width, height} (normalized coordinates 0-1)
         * @param {number} overlapRatio - The minimum overlap ratio required (0-1)
         * @param {number} [page] - Optional page number to filter results
         * @returns {Array} - Array of text items with their coordinates
         */
        query(rect, overlapRatio = 0.5, page = null) {
            if (!this.initialized) {
                throw new Error('TextractRBush not initialized. Call initialize() first.');
            }

            if (!rect || typeof rect.x !== 'number' || typeof rect.y !== 'number' || 
                typeof rect.width !== 'number' || typeof rect.height !== 'number') {
                throw new Error('Invalid rectangle: must have x, y, width, height properties');
            }

            if (typeof overlapRatio !== 'number' || overlapRatio < 0 || overlapRatio > 1) {
                throw new Error('Invalid overlapRatio: must be a number between 0 and 1');
            }

            // Convert rectangle to RBush format
            const searchRect = {
                minX: rect.x,
                minY: rect.y,
                maxX: rect.x + rect.width,
                maxY: rect.y + rect.height
            };

            // Search for intersecting blocks
            let results = this.rbush.search(searchRect);

            // Filter by page if specified
            if (page !== null) {
                results = results.filter(item => item.block.page === page);
            }

            // Filter by overlap ratio
            return results
                .filter(item => {
                    const intersection = this._calculateIntersectionArea(searchRect, {
                        minX: item.minX,
                        minY: item.minY,
                        maxX: item.maxX,
                        maxY: item.maxY
                    });
                    
                    const itemArea = (item.maxX - item.minX) * (item.maxY - item.minY);
                    const overlapPercentage = intersection / itemArea;
                    
                    // Store the overlap percentage for reference
                    item.block.overlapPercentage = overlapPercentage;
                    
                    return overlapPercentage >= overlapRatio;
                })
                .map(item => ({
                    text: item.block.text,
                    type: item.block.type,
                    confidence: item.block.confidence,
                    page: item.block.page,
                    boundingBox: item.block.boundingBox,
                    overlapPercentage: item.block.overlapPercentage
                }));
        }

        /**
         * Calculate the intersection area between two rectangles
         * @private
         * @param {Object} rect1 - First rectangle in RBush format
         * @param {Object} rect2 - Second rectangle in RBush format
         * @returns {number} - Area of intersection
         */
        _calculateIntersectionArea(rect1, rect2) {
            const xOverlap = Math.max(
                0,
                Math.min(rect1.maxX, rect2.maxX) - Math.max(rect1.minX, rect2.minX)
            );
            
            const yOverlap = Math.max(
                0,
                Math.min(rect1.maxY, rect2.maxY) - Math.max(rect1.minY, rect2.minY)
            );
            
            return xOverlap * yOverlap;
        }

        /**
         * Extract text from a block, including text from child blocks if necessary
         * @private
         * @param {Object} block - The TextExtract block
         * @returns {string} - The extracted text
         */
        _getTextFromBlock(block) {
            // If the block has text, return it
            if (block.Text) {
                return block.Text;
            }
            
            // If the block has child relationships, get text from children
            let text = '';
            if (block.Relationships) {
                for (const rel of block.Relationships) {
                    if (rel.Type === 'CHILD') {
                        for (const childId of rel.Ids) {
                            const childBlock = this.blockMap[childId];
                            if (childBlock && childBlock.Text) {
                                text += childBlock.Text + ' ';
                            }
                        }
                    }
                }
            }
            
            return text.trim();
        }

        /**
         * Check if a block type should be indexed
         * @private
         * @param {string} blockType - The TextExtract block type
         * @returns {boolean} - Whether the block should be indexed
         */
        _isIndexableBlockType(blockType) {
            const indexableTypes = [
                'LINE', 'WORD', 'SELECTION_ELEMENT', 
                'TABLE', 'CELL', 'TABLE_TITLE', 'KEY_VALUE_SET'
            ];
            return indexableTypes.includes(blockType);
        }
    }

    // Create a factory function to create new instances
    function createTextractRBush() {
        return new TextractRBush();
    }

    // Export the factory function
    if (typeof module !== 'undefined' && module.exports) {
        // Node.js/CommonJS
        module.exports = createTextractRBush;
    } else {
        // Browser global
        global.TextractRBush = createTextractRBush;
    }

})(typeof window !== 'undefined' ? window : this);
