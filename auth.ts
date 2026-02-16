import { Session } from 'next-auth';
import { User } from 'next-auth'; // Adjust the import based on your User type definition
// Function to validate email using regex pattern
const isValidEmail = (email: string): boolean => {
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return regex.test(email);
};

// Updated authorize callback with improved error handling
const authorize = async (credentials: Record<string, string>): Promise<User | null> => {
    const { email, password } = credentials;

    if (!isValidEmail(email)) {
        throw new Error('Invalid email format');
    }

    try {
        const user = await findUserByEmail(email); // Your logic to find a user
        if (!user) {
            throw new Error('No user found with this email');
        }
        // Logic for password hashing and comparison (remains the same)
        const isMatch = await verifyPassword(password, user.password);
        if (!isMatch) {
            throw new Error('Password does not match');
        }
        return user;  // Assuming user is properly typed
    } catch (error) {
        console.error('Authorization error:', error);
        throw new Error('Authorization failed');
    }
};

// Export your functions as needed
export { authorize, isValidEmail };