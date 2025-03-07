import { auth } from './firebaseConfig.js';
import { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';

// DOM Elements
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

// Utility function to retry an operation with error handling
async function retryOperation(operation, retries = 3) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            await operation();
            return;
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${i + 1} failed:`, error);
            if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between retries
        }
    }
    throw lastError;
}

// Countdown timer for resend functionality
function startCountdown(buttonElement, messageElement, initialSeconds) {
    let seconds = initialSeconds;
    buttonElement.textContent = `Resend Verification Email (${seconds}s)`;
    buttonElement.disabled = true;
    buttonElement.style.backgroundColor = "#ccc";

    messageElement.textContent = `Please wait ${seconds} seconds to resend.`;

    const interval = setInterval(() => {
        seconds--;
        buttonElement.textContent = `Resend Verification Email (${seconds}s)`;
        messageElement.textContent = `Please wait ${seconds} seconds to resend.`;
        if (seconds <= 0) {
            clearInterval(interval);
            buttonElement.textContent = 'Resend Verification Email';
            buttonElement.disabled = false;
            buttonElement.style.backgroundColor = "";
            messageElement.textContent = '';
        }
    }, 1000);
}

// Display error messages
function displayErrorMessage(element, message) {
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = 'red';
}

// Display success messages
function displaySuccessMessage(element, message) {
    element.textContent = message;
    element.style.display = 'block';
    element.style.color = 'green';
}

// Toggle Create Account form visibility
toggleCreateAccountButton.addEventListener('click', () => {
    createAccountForm.style.display = createAccountForm.style.display === 'none' ? 'block' : 'none';
});

// Monitor auth state to show/hide resend link
auth.onAuthStateChanged((user) => {
    if (user) {
        console.log('Auth state changed: User signed in:', user.email, 'Verified:', user.emailVerified);
        if (!user.emailVerified) {
            resendVerificationLink.style.display = 'block';
        } else {
            resendVerificationLink.style.display = 'none';
        }
    } else {
        console.log('Auth state changed: No user signed in');
        resendVerificationLink.style.display = 'none';
    }
});

// Handle login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = loginForm['email'].value;
    const password = loginForm['password'].value;

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log('Login successful:', user.email, 'Verified:', user.emailVerified);

        if (user.emailVerified) {
            window.location.href = 'loading.html';
        } else {
            displayErrorMessage(errorMessage, 'Please verify your email before logging in.');
            resendVerificationLink.style.display = 'block';
        }
    } catch (error) {
        displayErrorMessage(errorMessage, `Login failed: ${error.message}`);
        resendVerificationLink.style.display = 'none';
        console.error('Login error:', error);
    }
});

// Google Sign-In
const googleProvider = new GoogleAuthProvider();
document.getElementById('google-login-btn').addEventListener('click', async () => {
    try {
        await signInWithPopup(auth, googleProvider);
        console.log('Google sign-in successful');
        window.location.href = 'loading.html';
    } catch (error) {
        displayErrorMessage(errorMessage, `Google sign-in failed: ${error.message}`);
        console.error('Google sign-in error:', error);
    }
});

// Handle Create Account form submission
createAccountForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newEmail = createAccountForm['new-email'].value;
    const newPassword = createAccountForm['new-account-password'].value;
    const confirmPassword = createAccountForm['confirm-account-password'].value;
    const termsCheckbox = document.getElementById('agreeTerms');

    createErrorMessage.style.display = 'none';
    createSuccessMessage.style.display = 'none';

    if (newPassword !== confirmPassword) {
        displayErrorMessage(createErrorMessage, 'Passwords do not match.');
        return;
    }

    if (!termsCheckbox.checked) {
        displayErrorMessage(createErrorMessage, 'You must agree to the Terms of Service.');
        return;
    }

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, newEmail, newPassword);
        const user = userCredential.user;
        console.log('Account created:', user.email);

        await retryOperation(() => sendEmailVerification(user));
        console.log('Verification email sent to:', user.email);

        createSuccessMessage.innerHTML = `
            Account created! Please check your email to verify your account before logging in.
            <br><a href="#" id="resend-verification">Resend Verification Email</a>
        `;
        createSuccessMessage.style.display = 'block';

        const resendButton = document.getElementById('resend-verification');
        resendButton.addEventListener('click', async (e) => {
            e.preventDefault();
            if (resendButton.disabled) return;

            try {
                const currentUser = auth.currentUser;
                if (!currentUser) {
                    displayErrorMessage(createErrorMessage, 'User not signed in. Please log in again.');
                    return;
                }
                await retryOperation(() => sendEmailVerification(currentUser));
                displaySuccessMessage(createSuccessMessage, 'Verification email sent. Please check your inbox.');
                console.log('Resend verification email sent to:', currentUser.email);
                startCountdown(resendButton, createErrorMessage, 30); // 30-second countdown
            } catch (error) {
                if (error.code === 'auth/too-many-requests') {
                    displayErrorMessage(createErrorMessage, 'Too many requests. Please wait before resending.');
                    startCountdown(resendButton, createErrorMessage, 30);
                } else {
                    displayErrorMessage(createErrorMessage, `Failed to resend verification email: ${error.message}`);
                }
                console.error('Resend verification error:', error);
            }
        });
    } catch (error) {
        displayErrorMessage(createErrorMessage, `Account creation failed: ${error.message}`);
        console.error('Account creation error:', error);
    }
});

// Handle password reset form
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

    resetErrorMessage.style.display = 'none';
    resetSuccessMessage.style.display = 'none';

    try {
        await retryOperation(() => sendPasswordResetEmail(auth, resetEmail));
        displaySuccessMessage(resetSuccessMessage, 'Password reset email sent. Please check your inbox.');
        console.log('Password reset email sent to:', resetEmail);
    } catch (error) {
        displayErrorMessage(resetErrorMessage, `Failed to send reset email: ${error.message}`);
        console.error('Password reset error:', error);
    }
});

// Handle resend verification email on login page
resendVerificationLink.addEventListener('click', async (e) => {
    e.preventDefault();
    if (resendVerificationLink.disabled) return;

    const user = auth.currentUser;

    if (!user) {
        displayErrorMessage(errorMessage, 'User not signed in. Please log in again.');
        console.log('Resend attempted but no user signed in');
        return;
    }

    if (user.emailVerified) {
        displayErrorMessage(errorMessage, 'Email already verified. Please proceed to login.');
        resendVerificationLink.style.display = 'none';
        return;
    }

    try {
        await retryOperation(() => sendEmailVerification(user));
        displaySuccessMessage(errorMessage, 'Verification email sent. Please check your inbox.');
        console.log('Resend verification email sent to:', user.email);
        startCountdown(resendVerificationLink, errorMessage, 30); // 30-second countdown
    } catch (error) {
        if (error.code === 'auth/too-many-requests') {
            displayErrorMessage(errorMessage, 'Too many requests. Please wait before resending.');
            startCountdown(resendVerificationLink, errorMessage, 30);
        } else {
            displayErrorMessage(errorMessage, `Failed to resend verification email: ${error.message}`);
        }
        console.error('Resend verification error:', error);
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