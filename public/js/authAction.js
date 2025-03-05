import { auth } from './firebaseConfig.js';
import { applyActionCode, verifyPasswordResetCode, confirmPasswordReset } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Get the action mode and action code from the URL
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
const mode = urlParams.get('mode');
const actionCode = urlParams.get('oobCode');
const messageElement = document.getElementById('message');
const passwordResetForm = document.getElementById('password-reset-form');
const resetErrorMessage = document.getElementById('reset-error-message');
const emailVerificationSuccess = document.getElementById('email-verification-success');

// Function to retry an operation
async function retryOperation(operation, retries = 3) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            await operation();
            return;
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${i + 1} failed:`, error);
        }
    }
    throw lastError;
}

// Handle different action types
switch (mode) {
    case 'resetPassword':
        handleResetPassword(actionCode);
        break;
    case 'verifyEmail':
        handleVerifyEmail(actionCode);
        break;
    default:
        messageElement.textContent = 'Unknown request. Please check the link and try again.';
        messageElement.style.color = 'red';
}

// Handle password reset
async function handleResetPassword(actionCode) {
    try {
        // Verify the reset code (with retries)
        await retryOperation(() => verifyPasswordResetCode(auth, actionCode));

        // Show the reset password form if the code is valid
        messageElement.style.display = 'none';
        passwordResetForm.style.display = 'block';

        // Handle form submission for password reset
        passwordResetForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            // Validate passwords
            if (newPassword !== confirmPassword) {
                resetErrorMessage.textContent = "Passwords do not match. Please try again.";
                resetErrorMessage.style.color = 'red';
                return;
            }

            // Perform password reset (with retries)
            try {
                await retryOperation(() => confirmPasswordReset(auth, actionCode, newPassword));
                messageElement.textContent = '✅ Password has been reset successfully!';
                messageElement.style.color = 'green';
                passwordResetForm.style.display = 'none';
            } catch (error) {
                resetErrorMessage.textContent = '❌ Error resetting password. Please try again.';
                resetErrorMessage.style.color = 'red';
                console.error('Password reset error:', error);
            }
        });
    } catch (error) {
        messageElement.textContent = '❌ Error resetting your password. The link may be invalid or expired. Please try again.';
        messageElement.style.color = 'red';
        console.error('Verify reset code error:', error);
    }
}

// Handle email verification
async function handleVerifyEmail(actionCode) {
    try {
        // Apply action code for email verification (with retries)
        await retryOperation(() => applyActionCode(auth, actionCode));

        // Show success message
        messageElement.style.display = 'none';
        emailVerificationSuccess.style.display = 'block';
    } catch (error) {
        // Handle specific errors for email verification
        switch (error.code) {
            case 'auth/invalid-action-code':
                messageElement.textContent = '❌ Invalid or expired verification link. Please request a new verification email.';
                break;
            case 'auth/expired-action-code':
                messageElement.textContent = '❌ Verification link has expired. Please request a new verification email.';
                break;
            case 'auth/email-already-verified':
                messageElement.textContent = '✅ Your email has already been verified. You can log in.';
                messageElement.style.color = 'green';
                break;
            default:
                messageElement.textContent = `❌ Error verifying your email: ${error.message}`;
        }
        messageElement.style.color = 'red';
        console.error('Email verification error:', error);
    }
}
