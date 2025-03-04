        // Import the auth object from firebaseConfig.js
        import { auth } from './firebaseConfig.js';

        // Import the signInWithEmailAndPassword function from Firebase Auth
        import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

        // Login form submission
        const loginForm = document.getElementById('loginForm');
        const messageDiv = document.getElementById('message');

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault(); // Prevent form submission

            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;

            try {
                // Sign in with email and password
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;

                // Display success message
                messageDiv.textContent = "Login successful! Redirecting...";
                messageDiv.classList.add('success');
                messageDiv.classList.remove('message');

                // Redirect to another page after successful login
                setTimeout(() => {
                    window.location.href = "/new/start.html"; // Change this to your desired redirect URL
                }, 2000);
            } catch (error) {
                // Handle errors
                messageDiv.textContent = error.message;
                messageDiv.classList.remove('success');
                messageDiv.classList.add('message');
            }
        });