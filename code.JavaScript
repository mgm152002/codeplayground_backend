// Function to calculate factorial
function factorial(n) {
    if (n === 0 || n === 1) {
        return 1; // Base case: factorial of 0 and 1 is 1
    }
    return n * factorial(n - 1); // Recursive case
}

let num = 5;  // Predefined number
// Calculate and print factorial
console.log(`The factorial of ${num} is: ${factorial(num)}`);