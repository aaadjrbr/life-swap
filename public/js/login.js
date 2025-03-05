import { auth } from './firebaseConfig.js';
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/9.0.0/firebase-auth.js';

// Elements
const loginForm = document.getElementById('login-form');
const createAccountForm = document.getElementById('create-account-form');
const passwordResetForm = document.getElementById('password-reset-form');
const toggleCreateAccountButton = document.getElementById('toggle-create-account');
const forgotPasswordLink = document.getElementById('forgot-password-link');
const Iremember = document.getElementById('i-remember');
const errorMessage = document.getElementById('error-message');
const createErrorMessage = document.getElementById('create-error-message');
const resetErrorMessage = document.getElementById('reset-error-message');
const resetSuccessMessage = document.getElementById('reset-success-message');
const createSuccessMessage = document.getElementById('create-success-message');
const resendVerificationLink = document.getElementById('resend-verification-link');

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

// Function to handle countdown timer for resending the email (for each independent button)
function startCountdown(buttonElement, messageElement, initialSeconds) {
    let seconds = initialSeconds;
    buttonElement.textContent = `Resend Verification Email (${seconds}s)`;
    buttonElement.disabled = true;  // Disable the button
    buttonElement.style.backgroundColor = "#ccc";  // Gray out button

    // Display countdown in the error message in a nice way
    messageElement.textContent = `Please wait ${seconds} seconds and try again.`;

    const interval = setInterval(() => {
        seconds--;
        buttonElement.textContent = `Resend Verification Email (${seconds}s)`;
        messageElement.textContent = `Please wait ${seconds} seconds and try again.`;
        
        if (seconds <= 0) {
            clearInterval(interval);
            buttonElement.textContent = 'Resend Verification Email';
            buttonElement.disabled = false;  // Re-enable the button
            buttonElement.style.backgroundColor = "";  // Reset color
            messageElement.textContent = '';  // Clear the message
        }
    }, 1000);  // Update every second
}

// Function to display error messages nicely
function displayErrorMessage(element, message) {
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = 'red';
}

// Function to display success messages nicely
function displaySuccessMessage(element, message) {
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = 'green';
}

// Toggle visibility of Create Account form
toggleCreateAccountButton.addEventListener('click', () => {
    createAccountForm.style.display = createAccountForm.style.display === 'none' ? 'block' : 'none';
});

// Handle login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm['email'].value;
    const password = loginForm['password'].value;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        if (user.emailVerified) {
            window.location.href = 'start.html';  // Proceed if email is verified
        } else {
            displayErrorMessage(errorMessage, "Please verify your email before logging in.");
            resendVerificationLink.style.display = 'block';  // Show the resend link
        }
    } catch (error) {
        displayErrorMessage(errorMessage, `Login failed: ${error.message}`);
        resendVerificationLink.style.display = 'none';  // Hide the resend link in case of other errors
        console.error("Login error:", error);
    }
});

// Google Sign-In
const googleProvider = new GoogleAuthProvider();

document.getElementById('google-login-btn').addEventListener('click', async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        window.location.href = 'profiles.html';  // Redirect after login
    } catch (error) {
        displayErrorMessage(errorMessage, `Google sign-in failed: ${error.message}`);
        console.error("Google sign-in failed:", error);
    }
});

// Handle Create Account form submission and send email verification
createAccountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newEmail = createAccountForm['new-email'].value;
    const newPassword = createAccountForm['new-account-password'].value;
    const confirmPassword = createAccountForm['confirm-account-password'].value;
    const termsCheckbox = document.getElementById('agreeTerms');

    // Hide any previous messages
    createErrorMessage.style.display = 'none';
    createSuccessMessage.style.display = 'none';

    // Check if passwords match
    if (newPassword !== confirmPassword) {
        displayErrorMessage(createErrorMessage, "Passwords do not match.");
        return;
    }

    // Check if the terms checkbox is checked
    if (!termsCheckbox.checked) {
        displayErrorMessage(createErrorMessage, "You must agree to the Terms of Service.");
        return;
    }

    try {
        // Create user account
        const userCredential = await createUserWithEmailAndPassword(auth, newEmail, newPassword);
        const user = userCredential.user;

        // Send email verification (with retries)
        await retryOperation(() => sendEmailVerification(user));

        createSuccessMessage.innerHTML = `
            Account created! Please check your email to verify your account before logging in.
            <br><a href="#" id="resend-verification">Resend Verification Email</a>
        `;
        createSuccessMessage.style.display = 'block'; // Show success message

        const resendButton = document.getElementById('resend-verification');
        resendButton.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!resendButton.disabled) { // Ensure button can't be clicked during the countdown
                try {
                    await sendEmailVerification(user);
                    displaySuccessMessage(createSuccessMessage, "Verification email sent. Please check your inbox.");
                    startCountdown(resendButton, createErrorMessage, 60);  // Start 30-second countdown
                } catch (error) {
                    if (error.code === 'auth/too-many-requests') {
                        startCountdown(resendButton, createErrorMessage, 60);  // Start countdown on too-many-requests error
                    } else {
                        displayErrorMessage(createErrorMessage, `Failed to resend verification email: ${error.message}`);
                    }
                }
            }
        });

    } catch (error) {
        displayErrorMessage(createErrorMessage, `Account creation failed: ${error.message}`);
        console.error("Account creation error:", error);
    }
});

// Handle password reset
forgotPasswordLink.addEventListener('click', () => {
    passwordResetForm.style.display = 'block';
    loginForm.style.display = 'none';
    createAccountForm.style.display = 'none';
});

Iremember.addEventListener('click', () => {
    passwordResetForm.style.display = 'none';
    loginForm.style.display = 'block';
    createAccountForm.style.display = 'none';
});

passwordResetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const resetEmail = passwordResetForm['reset-email'].value;

    // Hide any previous messages
    resetErrorMessage.style.display = 'none';
    resetSuccessMessage.style.display = 'none';

    try {
        // Send password reset email (with retries)
        await retryOperation(() => sendPasswordResetEmail(auth, resetEmail));
        displaySuccessMessage(resetSuccessMessage, "Password reset email sent. Please check your inbox.");
    } catch (error) {
        displayErrorMessage(resetErrorMessage, `Failed to send reset email: ${error.message}`);
        console.error("Password reset error:", error);
    }
});

// Handle Resend Verification Email on Login
resendVerificationLink.addEventListener('click', async (e) => {
    e.preventDefault();
    
    const user = auth.currentUser;

    if (!resendVerificationLink.disabled && user && !user.emailVerified) { // Ensure button isn't clickable during countdown
        try {
            await sendEmailVerification(user);
            displaySuccessMessage(errorMessage, "Verification email sent. Please check your inbox.");
            startCountdown(resendVerificationLink, errorMessage, 60);  // Start 30-second countdown
        } catch (error) {
            if (error.code === 'auth/too-many-requests') {
                startCountdown(resendVerificationLink, errorMessage, 60);  // Start countdown on too-many-requests error
            } else {
                displayErrorMessage(errorMessage, `Failed to resend verification email: ${error.message}`);
            }
        }
    }
});

// Password visibility toggle
document.querySelectorAll('.toggle-password').forEach(togglePassword => {
    togglePassword.addEventListener('click', () => {
        const passwordField = togglePassword.previousElementSibling;
        const type = passwordField.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordField.setAttribute('type', type);
        togglePassword.textContent = type === 'password' ? '👀' : '🙈';
    });
});