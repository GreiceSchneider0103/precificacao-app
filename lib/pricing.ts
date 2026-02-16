// Updated lib/pricing.ts with improved validation and error handling for solvePOR and solveWithShopeeTiered functions

/**
 * Function to solve the POR calculation.
 * Performs validation and includes mathematical safety checks.
 */
function solvePOR(param1, param2) {
    // Parameter validation
    if (typeof param1 !== 'number' || param1 < 0) {
        throw new Error('Invalid param1: must be a non-negative number');
    }
    if (typeof param2 !== 'number' || param2 < 0) {
        throw new Error('Invalid param2: must be a non-negative number');
    }

    // Example mathematical safety check (preventing division by zero)
    if (param2 === 0) {
        throw new Error('Invalid input: param2 must not be zero');
    }

    // Proceed with calculations
    const result = param1 / param2; // Example calculation
    return result;
}

/**
 * Function to solve tiered pricing for Shopee.
 * Includes parameter validation and error handling.
 */
function solveWithShopeeTiered(input) {
    // Validate input is an array
    if (!Array.isArray(input)) {
        throw new Error('Invalid input: must be an array');
    }

    // Validate array content
    input.forEach((item, index) => {
        if (typeof item.price !== 'number' || item.price < 0) {
            throw new Error(`Invalid price at index ${index}: must be a non-negative number`);
        }
        if (typeof item.quantity !== 'number' || item.quantity < 0) {
            throw new Error(`Invalid quantity at index ${index}: must be a non-negative number`);
        }
    });

    // Perform the calculations
    let total = 0;
    input.forEach(item => {
        total += item.price * item.quantity;
    });
    return total;
}